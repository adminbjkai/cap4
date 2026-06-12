import { createHash } from "node:crypto";
import type { DocModelClient } from "./model-client.js";
import { DocOutputSchema, type DocOutput, type ManifestFrame } from "./schema.js";
import { splitIntoChapters, type Chapter } from "./stage-a.js";

export const PROMPT_VERSION = "v1";

export type DocTranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

const DOC_SYSTEM_PROMPT =
  "You turn a screen-recording transcript plus extracted screenshots into a precise how-to document. " +
  "Read the referenced frame images from disk before writing. Return ONLY a JSON object of this exact shape " +
  "(no prose, no code fences):\n" +
  `{"title":"...","doc_type":"runbook|tutorial|sop","sections":[{"heading":"...","body_md":"...",` +
  `"steps":[{"text":"...","frame_id":"f_087","crop":{"x":0.6,"y":0.1,"w":0.35,"h":0.3},"alt":"...","callout":"..."}],` +
  `"source_span":{"start_s":261,"end_s":318}}],"unused_frames":[],"confidence_notes":[]}\n` +
  "Rules: frame_id MUST be one of the manifest ids (omit it rather than guess); crop is an optional fractional " +
  "box highlighting the relevant region; source_span gives the transcript seconds the section came from; " +
  "list manifest frames you did not use in unused_frames; put any uncertainty into confidence_notes.";

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTranscript(segments: DocTranscriptSegment[]): string {
  return segments
    .map((seg) => `[${formatTimestamp(seg.startSeconds)}] ${seg.text.trim()}`)
    .join("\n");
}

function formatManifest(frames: ManifestFrame[]): string {
  return frames
    .map((f) => {
      const caption = f.caption ? ` — ${f.caption}` : "";
      return `${f.frameId} at ${formatTimestamp(f.ts)} (file: ${f.fileName})${caption}`;
    })
    .join("\n");
}

export function buildDocCacheKey(opts: {
  transcriptText: string;
  manifestText: string;
  model: string;
  chapterLabel: string;
  retrySuffix?: string;
}): string {
  const transcriptHash = createHash("sha256").update(opts.transcriptText).digest("hex");
  const manifestHash = createHash("sha256").update(opts.manifestText).digest("hex");
  return createHash("sha256")
    .update(`doc:${transcriptHash}:${manifestHash}:${PROMPT_VERSION}:${opts.model}:${opts.chapterLabel}:${opts.retrySuffix ?? ""}`)
    .digest("hex");
}

async function docCall(opts: {
  client: DocModelClient;
  model: string;
  segments: DocTranscriptSegment[];
  frames: ManifestFrame[];
  workdir: string;
  videoId: string;
  chapterLabel: string;
  correction?: string;
}): Promise<DocOutput> {
  const transcriptText = formatTranscript(opts.segments);
  const manifestText = formatManifest(opts.frames);
  const correction = opts.correction
    ? `\n\nIMPORTANT CORRECTION: ${opts.correction}`
    : "";

  return opts.client.generateStructured({
    systemPrompt: DOC_SYSTEM_PROMPT,
    userPrompt:
      `Frame manifest (${opts.frames.length} frames):\n${manifestText}\n\n` +
      `Transcript:\n${transcriptText}${correction}`,
    imagePaths: opts.frames.map((f) => f.fileName),
    schema: DocOutputSchema,
    model: opts.model,
    workdir: opts.workdir,
    cacheKey: buildDocCacheKey({
      transcriptText,
      manifestText,
      model: opts.model,
      chapterLabel: opts.chapterLabel,
      retrySuffix: opts.correction ? "retry1" : undefined
    }),
    videoId: opts.videoId,
    purpose: `doc:${opts.chapterLabel}`
  });
}

const MERGE_SYSTEM_PROMPT =
  "You merge per-chapter how-to documents (JSON) generated from one screen recording into a single coherent " +
  "document of the same JSON shape. Unify the title and headings, remove repeated intro/outro sections, keep " +
  "all steps and their frame_id/crop references exactly as given, and preserve source_span values. " +
  "Return ONLY the merged JSON object.";

/** Deterministic fallback when the merge call fails: concatenate chapters. */
export function concatChapterDocs(docs: DocOutput[]): DocOutput {
  const first = docs[0]!;
  return {
    title: first.title,
    doc_type: first.doc_type,
    sections: docs.flatMap((d) => d.sections),
    unused_frames: [...new Set(docs.flatMap((d) => d.unused_frames))],
    confidence_notes: [
      ...new Set(docs.flatMap((d) => d.confidence_notes)),
      "chapter outputs were concatenated without a merge pass"
    ]
  };
}

/**
 * Stage C: one strong-model call per recording, or one per chapter when the
 * recording exceeds 25 minutes, followed by a triage-model merge pass.
 */
export async function generateDoc(opts: {
  client: DocModelClient;
  strongModel: string;
  triageModel: string | undefined;
  segments: DocTranscriptSegment[];
  manifest: ManifestFrame[];
  durationSeconds: number;
  chapterBoundaries: number[];
  workdir: string;
  videoId: string;
  correction?: string;
  log: (event: string, fields: Record<string, unknown>) => void;
}): Promise<DocOutput> {
  const chapters: Chapter[] = splitIntoChapters(opts.durationSeconds, opts.chapterBoundaries);

  if (chapters.length === 1) {
    return docCall({
      client: opts.client,
      model: opts.strongModel,
      segments: opts.segments,
      frames: opts.manifest,
      workdir: opts.workdir,
      videoId: opts.videoId,
      chapterLabel: "full",
      correction: opts.correction
    });
  }

  const chapterDocs: DocOutput[] = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]!;
    const segments = opts.segments.filter(
      (s) => s.startSeconds >= chapter.start && s.startSeconds < chapter.end
    );
    const frames = opts.manifest.filter((f) => f.ts >= chapter.start && f.ts < chapter.end);
    chapterDocs.push(
      await docCall({
        client: opts.client,
        model: opts.strongModel,
        segments,
        frames,
        workdir: opts.workdir,
        videoId: opts.videoId,
        chapterLabel: `chapter${i + 1}of${chapters.length}`,
        correction: opts.correction
      })
    );
  }

  const mergeModel = opts.triageModel;
  if (mergeModel) {
    try {
      const chapterJson = JSON.stringify(chapterDocs);
      return await opts.client.generateStructured({
        systemPrompt: MERGE_SYSTEM_PROMPT,
        userPrompt: `Merge these ${chapterDocs.length} chapter documents:\n${chapterJson}`,
        imagePaths: [],
        schema: DocOutputSchema,
        model: mergeModel,
        workdir: opts.workdir,
        cacheKey: createHash("sha256")
          .update(`merge:${createHash("sha256").update(chapterJson).digest("hex")}:${PROMPT_VERSION}:${mergeModel}`)
          .digest("hex"),
        videoId: opts.videoId,
        purpose: "merge"
      });
    } catch (error) {
      opts.log("doc.merge.failed_concat", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return concatChapterDocs(chapterDocs);
}

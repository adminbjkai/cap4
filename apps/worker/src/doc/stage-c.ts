import { createHash } from "node:crypto";
import type { DocModelClient } from "./model-client.js";
import { DocOutputSchema, type DocOutput, type ManifestFrame } from "./schema.js";

export const PROMPT_VERSION = "v3";

// Vision tokens dominate the cost of the doc call — send at most this many
// frame images, evenly thinned across the timeline.
const MAX_FRAMES_PER_DOC_CALL = 16;

export function thinFrames<T>(frames: T[], max = MAX_FRAMES_PER_DOC_CALL): T[] {
  if (frames.length <= max) return frames;
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    out.push(frames[Math.floor((i * frames.length) / max)]!);
  }
  return out;
}

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
  "Rules: frame_id MUST be one of the manifest ids (omit it rather than guess). " +
  "Attach AT MOST 5 screenshots in the entire document — only the few moments where seeing the screen is " +
  "essential (a key dialog, setting, error, or result). Most steps have NO frame_id. Never attach the same " +
  "frame twice and never slice one frame into thin strips. A crop is optional and must cover a meaningful " +
  "region (at least 15% of the frame's width and height). source_span gives the transcript seconds the " +
  "section came from; list unused manifest frames in unused_frames; put any uncertainty into confidence_notes.";

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
  retrySuffix?: string;
}): string {
  const transcriptHash = createHash("sha256").update(opts.transcriptText).digest("hex");
  const manifestHash = createHash("sha256").update(opts.manifestText).digest("hex");
  return createHash("sha256")
    .update(`doc:${transcriptHash}:${manifestHash}:${PROMPT_VERSION}:${opts.model}:${opts.retrySuffix ?? ""}`)
    .digest("hex");
}

/**
 * Stage C: ONE strong-model call per recording — full transcript plus at
 * most MAX_FRAMES_PER_DOC_CALL frame images. No triage, no chaptering, no
 * merge pass: one recording, one call.
 */
export async function generateDoc(opts: {
  client: DocModelClient;
  strongModel: string;
  segments: DocTranscriptSegment[];
  manifest: ManifestFrame[];
  workdir: string;
  videoId: string;
  correction?: string;
  log: (event: string, fields: Record<string, unknown>) => void;
}): Promise<DocOutput> {
  const frames = thinFrames(opts.manifest);
  const transcriptText = formatTranscript(opts.segments);
  const manifestText = formatManifest(frames);
  const correction = opts.correction ? `\n\nIMPORTANT CORRECTION: ${opts.correction}` : "";

  return opts.client.generateStructured({
    systemPrompt: DOC_SYSTEM_PROMPT,
    userPrompt:
      `Frame manifest (${frames.length} frames):\n${manifestText}\n\n` +
      `Transcript:\n${transcriptText}${correction}`,
    imagePaths: frames.map((f) => f.fileName),
    schema: DocOutputSchema,
    model: opts.strongModel,
    workdir: opts.workdir,
    cacheKey: buildDocCacheKey({
      transcriptText,
      manifestText,
      model: opts.strongModel,
      retrySuffix: opts.correction ? "retry1" : undefined
    }),
    videoId: opts.videoId,
    purpose: "doc"
  });
}

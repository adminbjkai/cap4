import { runProcess } from "./exec.js";
import type { DocOutput, DocStep } from "./schema.js";

/** Returns every step frame_id that does not exist in the manifest. */
export function findInvalidFrameRefs(doc: DocOutput, manifestIds: Set<string>): string[] {
  const invalid = new Set<string>();
  for (const section of doc.sections) {
    for (const step of section.steps) {
      if (step.frame_id && !manifestIds.has(step.frame_id)) {
        invalid.add(step.frame_id);
      }
    }
  }
  return [...invalid];
}

/**
 * Removes hallucinated frame refs that survived the corrective retry. The
 * affected steps keep their text but lose the image, and each dropped ref is
 * recorded in confidence_notes — nothing is rendered silently.
 */
export function stripInvalidFrameRefs(doc: DocOutput, invalid: string[]): DocOutput {
  if (invalid.length === 0) return doc;
  const invalidSet = new Set(invalid);
  return {
    ...doc,
    sections: doc.sections.map((section) => ({
      ...section,
      steps: section.steps.map((step) =>
        step.frame_id && invalidSet.has(step.frame_id)
          ? { ...step, frame_id: null, crop: null }
          : step
      )
    })),
    confidence_notes: [
      ...doc.confidence_notes,
      ...invalid.map((id) => `dropped hallucinated frame reference ${id} (not in manifest)`)
    ]
  };
}

const MAX_IMAGES_PER_DOC = 6;
const MAX_IMAGE_USES_PER_FRAME = 2;
const MIN_CROP_FRACTION = 0.12;

/**
 * Deterministic guard against screenshot spam (the model slicing one frame
 * into many thin row-crops, or attaching the same frame to every step):
 * - at most 6 screenshots in the whole document
 * - a frame may illustrate at most 2 steps
 * - an identical frame+crop never renders twice
 * - sliver crops are widened to a usable region (≥12% of the frame, centered
 *   on the original box)
 * Steps keep their text; only the image is dropped. One summary confidence
 * note records how many were removed.
 */
export function dedupeStepImages(doc: DocOutput): DocOutput {
  const usesPerFrame = new Map<string, number>();
  const seenFrameCrops = new Set<string>();
  let total = 0;
  let removed = 0;

  const widen = (value: number, size: number): { value: number; size: number } => {
    if (size >= MIN_CROP_FRACTION) return { value, size };
    const grown = MIN_CROP_FRACTION;
    const shifted = value - (grown - size) / 2;
    return { value: Math.min(Math.max(shifted, 0), 1 - grown), size: grown };
  };

  const sections = doc.sections.map((section) => ({
    ...section,
    steps: section.steps.map((step) => {
      if (!step.frame_id) return step;
      let crop = step.crop ?? null;
      if (crop) {
        const x = widen(crop.x, crop.w);
        const y = widen(crop.y, crop.h);
        crop = { x: x.value, w: x.size, y: y.value, h: y.size };
      }
      const cropKey = crop ? [crop.x, crop.y, crop.w, crop.h].map((v) => v.toFixed(2)).join(",") : "full";
      const uses = usesPerFrame.get(step.frame_id) ?? 0;
      if (
        total >= MAX_IMAGES_PER_DOC ||
        uses >= MAX_IMAGE_USES_PER_FRAME ||
        seenFrameCrops.has(`${step.frame_id}:${cropKey}`)
      ) {
        removed += 1;
        return { ...step, frame_id: null, crop: null };
      }
      total += 1;
      usesPerFrame.set(step.frame_id, uses + 1);
      seenFrameCrops.add(`${step.frame_id}:${cropKey}`);
      return { ...step, crop };
    })
  }));

  if (removed === 0) return { ...doc, sections };
  return {
    ...doc,
    sections,
    confidence_notes: [
      ...doc.confidence_notes,
      `removed ${removed} extra screenshot${removed === 1 ? "" : "s"} (budget: ${MAX_IMAGES_PER_DOC} per doc, ${MAX_IMAGE_USES_PER_FRAME} per frame, no duplicates)`
    ]
  };
}

/** Applies a fractional crop box to a frame JPEG with ffmpeg. */
export async function cropFrame(
  inputPath: string,
  crop: { x: number; y: number; w: number; h: number },
  outPath: string
): Promise<void> {
  const filter = `crop=iw*${crop.w}:ih*${crop.h}:iw*${crop.x}:ih*${crop.y}`;
  // -q:v 2 (high quality): crops are sourced from the high-res frame, so keep
  // the cropped screenshot crisp too (used in the doc download/export).
  const result = await runProcess({
    bin: "ffmpeg",
    args: ["-y", "-i", inputPath, "-vf", filter, "-q:v", "2", outPath]
  });
  if (result.code !== 0) {
    throw new Error(`ffmpeg crop failed: ${result.stderr.slice(-300)}`);
  }
}

function formatSpan(span: { start_s: number; end_s: number }): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };
  return `[${fmt(span.start_s)}–${fmt(span.end_s)}]`;
}

/**
 * Renders the validated doc as markdown. imageUrlFor returns the public URL
 * for a step's image (the cropped variant when the step has a crop) or null
 * when the frame is unavailable. Crops are per-step, hence the indices.
 */
export function renderMarkdown(
  doc: DocOutput,
  imageUrlFor: (sectionIndex: number, stepIndex: number, step: DocStep) => string | null
): string {
  const lines: string[] = [`# ${doc.title}`, "", `> Type: ${doc.doc_type}`, ""];

  doc.sections.forEach((section, sectionIndex) => {
    const span = section.source_span ? ` _${formatSpan(section.source_span)}_` : "";
    lines.push(`## ${section.heading}${span}`, "");
    if (section.body_md.trim()) {
      lines.push(section.body_md.trim(), "");
    }
    section.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.text}`);
      if (step.frame_id) {
        const url = imageUrlFor(sectionIndex, index, step);
        if (url) {
          lines.push("", `   ![${step.alt ?? step.frame_id}](${url})`);
        }
      }
      if (step.callout) {
        lines.push("", `   > ${step.callout}`);
      }
      lines.push("");
    });
  });

  if (doc.confidence_notes.length > 0) {
    lines.push("---", "", "**Confidence notes:**", "");
    for (const note of doc.confidence_notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

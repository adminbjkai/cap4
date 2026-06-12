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

/** Applies a fractional crop box to a frame JPEG with ffmpeg. */
export async function cropFrame(
  inputPath: string,
  crop: { x: number; y: number; w: number; h: number },
  outPath: string
): Promise<void> {
  const filter = `crop=iw*${crop.w}:ih*${crop.h}:iw*${crop.x}:ih*${crop.y}`;
  const result = await runProcess({
    bin: "ffmpeg",
    args: ["-y", "-i", inputPath, "-vf", filter, "-q:v", "4", outPath]
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

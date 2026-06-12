import { createHash } from "node:crypto";
import type { DocModelClient } from "./model-client.js";
import { TriageOutputSchema, type ManifestFrame } from "./schema.js";
import { PROMPT_VERSION } from "./stage-c.js";

const TRIAGE_SYSTEM_PROMPT =
  "You are classifying screenshots extracted from a screen recording. " +
  "For every frame you are given, read the image from disk, then return ONLY a JSON object " +
  '{"frames":[{"frame_id":"...","caption":"one sentence","classification":"content|transition|junk"}]} ' +
  "covering every frame. junk = blank/loading/blurred mid-transition frames with no informational value; " +
  "transition = window/app switches; content = anything showing meaningful UI, code, or text.";

function normalizeCaption(caption: string): string {
  return caption.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

/**
 * Stage B: one batched triage call — caption + classify every frame, drop
 * junk and consecutive near-duplicate captions. On ANY failure (model not
 * configured, budget, malformed output) falls back to passing all frames
 * through with empty captions: triage can only improve the doc, never block it.
 */
export async function triageFrames(opts: {
  client: DocModelClient;
  model: string | undefined;
  frames: ManifestFrame[];
  workdir: string;
  videoId: string;
  log: (event: string, fields: Record<string, unknown>) => void;
}): Promise<{ manifest: ManifestFrame[]; classifications: Map<string, string>; triaged: boolean }> {
  const passthrough = { manifest: opts.frames, classifications: new Map<string, string>(), triaged: false };
  if (!opts.model) {
    opts.log("doc.triage.skipped", { reason: "DOC_MODEL_TRIAGE not set" });
    return passthrough;
  }

  const frameList = opts.frames
    .map((f) => `${f.frameId} at ${f.ts.toFixed(1)}s: ${f.fileName}`)
    .join("\n");
  const manifestHash = createHash("sha256").update(frameList).digest("hex");
  const cacheKey = createHash("sha256")
    .update(`triage:${manifestHash}:${PROMPT_VERSION}:${opts.model}`)
    .digest("hex");

  try {
    const output = await opts.client.generateStructured({
      systemPrompt: TRIAGE_SYSTEM_PROMPT,
      userPrompt: `Caption and classify each of these ${opts.frames.length} frames:\n${frameList}`,
      imagePaths: opts.frames.map((f) => f.fileName),
      schema: TriageOutputSchema,
      model: opts.model,
      workdir: opts.workdir,
      cacheKey,
      videoId: opts.videoId,
      purpose: "triage"
    });

    const byId = new Map(output.frames.map((f) => [f.frame_id, f]));
    const classifications = new Map<string, string>();
    const manifest: ManifestFrame[] = [];
    let lastCaption = "";
    for (const frame of opts.frames) {
      const triage = byId.get(frame.frameId);
      // Frames the model failed to mention stay in — same rationale as the
      // full fallback: triage only ever removes provably useless frames.
      if (!triage) {
        manifest.push(frame);
        continue;
      }
      classifications.set(frame.frameId, triage.classification);
      if (triage.classification === "junk") continue;
      const normalized = normalizeCaption(triage.caption);
      if (normalized && normalized === lastCaption) continue; // near-duplicate of previous
      lastCaption = normalized;
      manifest.push({ ...frame, caption: triage.caption });
    }
    return { manifest, classifications, triaged: true };
  } catch (error) {
    opts.log("doc.triage.failed_passthrough", {
      error: error instanceof Error ? error.message : String(error)
    });
    return passthrough;
  }
}

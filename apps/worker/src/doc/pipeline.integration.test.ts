/**
 * Full Stage A→D pipeline over a real (generated) video with the model layer
 * MOCKED — fixture JSON responses, in-memory S3. Requires ffmpeg on the host
 * (same requirement as the existing integration suite). Verifies the exit
 * criteria: the emitted doc has ≥1 valid frame per step and zero unvalidated
 * frame refs reach the render.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runProcess } from "./exec.js";
import type { DocModelClient, GenerateStructuredParams } from "./model-client.js";
import type { DocOutput } from "./schema.js";
import { runDocPipeline, type DocPipelineResult } from "./generate-doc.js";

const VIDEO_ID = "11111111-2222-3333-4444-555555555555";

function manifestIdsFrom(prompt: string): string[] {
  // Only ids from the manifest block — the corrective retry prompt also
  // mentions the hallucinated id, which must not be re-extracted.
  const ids = [...new Set(prompt.match(/f_\d{4}/g) ?? [])];
  return ids.filter((id) => id !== "f_9999");
}

function fixtureDoc(ids: string[], includeHallucination: boolean): DocOutput {
  return {
    title: "Switch from the red screen to the blue screen",
    doc_type: "tutorial",
    sections: [
      {
        heading: "Walkthrough",
        body_md: "The recording shows a color switch.",
        steps: [
          {
            text: "Observe the red screen",
            frame_id: includeHallucination ? "f_9999" : ids[0]!,
            crop: includeHallucination ? null : { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
            alt: "red screen"
          },
          {
            text: "Observe the blue screen",
            frame_id: ids[ids.length - 1]!,
            alt: "blue screen"
          }
        ],
        source_span: { start_s: 0, end_s: 6 }
      }
    ],
    unused_frames: [],
    confidence_notes: []
  };
}

describe("doc pipeline (mocked model)", () => {
  let workdir: string;
  let mediaPath: string;
  const uploads = new Map<string, Buffer>();
  const modelCalls: GenerateStructuredParams<unknown>[] = [];
  let result: DocPipelineResult;

  const mockedClient: DocModelClient = {
    async generateStructured(params) {
      modelCalls.push(params as GenerateStructuredParams<unknown>);
      const ids = manifestIdsFrom(params.userPrompt);
      const isCorrective = params.userPrompt.includes("IMPORTANT CORRECTION");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fixtureDoc(ids, !isCorrective) as any;
    }
  };

  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), "doc-pipeline-test-"));
    mediaPath = join(workdir, "fixture.mp4");
    const ffmpeg = await runProcess({
      bin: "ffmpeg",
      args: [
        "-y",
        "-f", "lavfi", "-i", "color=red:s=320x240:d=3:r=10",
        "-f", "lavfi", "-i", "color=blue:s=320x240:d=3:r=10",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]",
        "-map", "[v]",
        "-pix_fmt", "yuv420p",
        mediaPath
      ]
    });
    expect(ffmpeg.code).toBe(0);

    result = await runDocPipeline({
      videoId: VIDEO_ID,
      mediaPath,
      workdir,
      durationSeconds: null, // exercises ffprobe duration fallback
      segments: [
        { startSeconds: 0, endSeconds: 2.5, text: "First we look at the red screen" },
        { startSeconds: 3.2, endSeconds: 5.5, text: "and then we switch to the blue screen" }
      ],
      client: mockedClient,
      strongModel: "mock-strong",
      uploadObject: async (key, body) => {
        uploads.set(key, body);
      },
      publicUrlFor: (key) => `/cap4/${key}`,
      log: () => undefined
    });
  }, 120_000);

  afterAll(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  it("extracts, dedupes and uploads candidate frames", () => {
    expect(result.frames.length).toBeGreaterThanOrEqual(1);
    for (const frame of result.frames) {
      expect(uploads.has(frame.s3Key)).toBe(true);
      expect(frame.s3Key).toBe(`videos/${VIDEO_ID}/frames/${frame.frameId}.jpg`);
    }
  });

  it("makes one doc call plus one corrective retry on the hallucinated ref", () => {
    expect(modelCalls.length).toBe(2);
    expect(modelCalls.every((c) => c.purpose === "doc")).toBe(true);
    expect(modelCalls[1]!.userPrompt).toContain("f_9999");
    expect(modelCalls[1]!.userPrompt).toContain("IMPORTANT CORRECTION");
  });

  it("emits a doc with ≥1 valid frame per step and zero unvalidated refs", () => {
    const validIds = new Set(result.frames.map((f) => f.frameId));
    let steps = 0;
    for (const section of result.doc.sections) {
      for (const step of section.steps) {
        steps += 1;
        expect(step.frame_id).toBeTruthy();
        expect(validIds.has(step.frame_id!)).toBe(true);
      }
    }
    expect(steps).toBeGreaterThan(0);
  });

  it("applies crops with ffmpeg and uploads them", () => {
    const cropKeys = [...uploads.keys()].filter((k) => k.includes("/doc/crops/"));
    expect(cropKeys.length).toBe(1);
    expect(cropKeys[0]).toMatch(new RegExp(`^videos/${VIDEO_ID}/doc/crops/s0_0_f_\\d{4}\\.jpg$`));
  });

  it("renders markdown with images and no hallucinated refs", () => {
    expect(result.markdown).toContain("# Switch from the red screen to the blue screen");
    expect(result.markdown).toContain("> Type: tutorial");
    expect(result.markdown).toContain(`/cap4/videos/${VIDEO_ID}/`);
    expect(result.markdown).not.toContain("f_9999");
    // the cropped step links the crop, not the raw frame
    expect(result.markdown).toContain("/doc/crops/");
  });
});

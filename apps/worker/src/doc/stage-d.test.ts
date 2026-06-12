import { describe, expect, it } from "vitest";
import type { DocOutput, DocStep } from "./schema.js";
import { dedupeStepImages, findInvalidFrameRefs, renderMarkdown, stripInvalidFrameRefs } from "./stage-d.js";

const baseDoc: DocOutput = {
  title: "Deploy the service",
  doc_type: "runbook",
  sections: [
    {
      heading: "Build",
      body_md: "Build the image first.",
      steps: [
        { text: "Run the build", frame_id: "f_0001", alt: "build output", callout: "Takes ~2 min" },
        { text: "Check the logs", frame_id: "f_0099" }
      ],
      source_span: { start_s: 261, end_s: 318 }
    }
  ],
  unused_frames: [],
  confidence_notes: []
};

describe("findInvalidFrameRefs", () => {
  it("returns refs missing from the manifest", () => {
    expect(findInvalidFrameRefs(baseDoc, new Set(["f_0001"]))).toEqual(["f_0099"]);
  });

  it("returns empty when all refs are valid", () => {
    expect(findInvalidFrameRefs(baseDoc, new Set(["f_0001", "f_0099"]))).toEqual([]);
  });
});

describe("stripInvalidFrameRefs", () => {
  it("removes the ref but keeps the step, and records a note", () => {
    const stripped = stripInvalidFrameRefs(baseDoc, ["f_0099"]);
    const steps = stripped.sections[0]!.steps;
    expect(steps.length).toBe(2);
    expect(steps[1]!.frame_id).toBeNull();
    expect(steps[0]!.frame_id).toBe("f_0001");
    expect(stripped.confidence_notes).toEqual([
      "dropped hallucinated frame reference f_0099 (not in manifest)"
    ]);
  });

  it("is a no-op for an empty invalid list", () => {
    expect(stripInvalidFrameRefs(baseDoc, [])).toBe(baseDoc);
  });
});

describe("dedupeStepImages", () => {
  const docWith = (steps: DocStep[]): DocOutput => ({
    title: "T",
    doc_type: "runbook",
    sections: [{ heading: "S", body_md: "", steps, source_span: null }],
    unused_frames: [],
    confidence_notes: []
  });

  it("caps a frame at 2 step images and records one summary note", () => {
    const result = dedupeStepImages(
      docWith([
        { text: "a", frame_id: "f_0001", crop: { x: 0, y: 0.1, w: 0.5, h: 0.2 } },
        { text: "b", frame_id: "f_0001", crop: { x: 0, y: 0.4, w: 0.5, h: 0.2 } },
        { text: "c", frame_id: "f_0001", crop: { x: 0, y: 0.7, w: 0.5, h: 0.2 } }
      ])
    );
    const steps = result.sections[0]!.steps;
    expect(steps[0]!.frame_id).toBe("f_0001");
    expect(steps[1]!.frame_id).toBe("f_0001");
    expect(steps[2]!.frame_id).toBeNull();
    expect(steps[2]!.text).toBe("c"); // text survives
    expect(result.confidence_notes).toEqual([
      "removed 1 repetitive screenshot (same frame reused across steps)"
    ]);
  });

  it("drops an exact frame+crop duplicate", () => {
    const crop = { x: 0, y: 0.5, w: 0.6, h: 0.2 };
    const result = dedupeStepImages(
      docWith([
        { text: "a", frame_id: "f_0001", crop },
        { text: "b", frame_id: "f_0001", crop: { ...crop } }
      ])
    );
    expect(result.sections[0]!.steps[1]!.frame_id).toBeNull();
  });

  it("widens sliver crops to a usable centered region", () => {
    const result = dedupeStepImages(
      docWith([{ text: "a", frame_id: "f_0001", crop: { x: 0, y: 0.5, w: 0.62, h: 0.05 } }])
    );
    const crop = result.sections[0]!.steps[0]!.crop!;
    expect(crop.h).toBeCloseTo(0.12);
    expect(crop.y).toBeCloseTo(0.465); // centered on the original strip
    expect(crop.w).toBeCloseTo(0.62); // already large enough — unchanged
  });

  it("is a no-op (no note) on a clean doc", () => {
    const result = dedupeStepImages(
      docWith([
        { text: "a", frame_id: "f_0001" },
        { text: "b", frame_id: "f_0002" }
      ])
    );
    expect(result.confidence_notes).toEqual([]);
    expect(result.sections[0]!.steps.map((s) => s.frame_id)).toEqual(["f_0001", "f_0002"]);
  });
});

describe("renderMarkdown", () => {
  it("renders title, sections, steps, images, callouts and spans", () => {
    const md = renderMarkdown(baseDoc, (s, i, step) =>
      step.frame_id === "f_0001" ? "/cap4/videos/v1/frames/f_0001.jpg" : null
    );
    expect(md).toContain("# Deploy the service");
    expect(md).toContain("> Type: runbook");
    expect(md).toContain("## Build _[04:21–05:18]_");
    expect(md).toContain("1. Run the build");
    expect(md).toContain("![build output](/cap4/videos/v1/frames/f_0001.jpg)");
    expect(md).toContain("> Takes ~2 min");
    // the f_0099 step renders without an image
    expect(md).toContain("2. Check the logs");
    expect(md).not.toContain("f_0099");
  });

  it("renders confidence notes when present", () => {
    const md = renderMarkdown(
      { ...baseDoc, confidence_notes: ["audio unclear at 03:10"] },
      () => null
    );
    expect(md).toContain("**Confidence notes:**");
    expect(md).toContain("- audio unclear at 03:10");
  });
});

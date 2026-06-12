import { describe, expect, it } from "vitest";
import type { DocOutput } from "./schema.js";
import { findInvalidFrameRefs, renderMarkdown, stripInvalidFrameRefs } from "./stage-d.js";

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

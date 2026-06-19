import { describe, expect, it } from "vitest";
import type { GenerateStructuredParams, DocModelClient } from "./model-client.js";
import type { DocOutput, ManifestFrame } from "./schema.js";
import { buildDocCacheKey, formatTranscript, generateDoc, thinFrames } from "./stage-c.js";

const noop = () => undefined;

function doc(title: string): DocOutput {
  return {
    title,
    doc_type: "runbook",
    sections: [
      {
        heading: `${title} section`,
        body_md: "",
        steps: [{ text: "do the thing", frame_id: "f_0001" }],
        source_span: { start_s: 0, end_s: 10 }
      }
    ],
    unused_frames: [],
    confidence_notes: []
  };
}

function manifestFrame(frameId: string, ts: number): ManifestFrame {
  return { frameId, ts, caption: "", fileName: `${frameId}.jpg` };
}

function fakeClient(impl: (params: GenerateStructuredParams<unknown>) => unknown): DocModelClient & { calls: GenerateStructuredParams<unknown>[] } {
  const calls: GenerateStructuredParams<unknown>[] = [];
  return {
    calls,
    async generateStructured(params) {
      calls.push(params as GenerateStructuredParams<unknown>);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return impl(params as GenerateStructuredParams<unknown>) as any;
    }
  };
}

describe("buildDocCacheKey", () => {
  const base = { transcriptText: "t", manifestText: "m", model: "model-a" };

  it("is deterministic", () => {
    expect(buildDocCacheKey(base)).toBe(buildDocCacheKey({ ...base }));
  });

  it("changes when any input changes", () => {
    const key = buildDocCacheKey(base);
    expect(buildDocCacheKey({ ...base, transcriptText: "t2" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, manifestText: "m2" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, model: "model-b" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, retrySuffix: "retry1" })).not.toBe(key);
  });
});

describe("formatTranscript", () => {
  it("prefixes segments with mm:ss timestamps", () => {
    const text = formatTranscript([
      { startSeconds: 0, endSeconds: 4, text: "hello" },
      { startSeconds: 65, endSeconds: 70, text: "world" }
    ]);
    expect(text).toBe("[00:00] hello\n[01:05] world");
  });
});

describe("thinFrames", () => {
  it("returns short lists unchanged", () => {
    const frames = [1, 2, 3];
    expect(thinFrames(frames, 40)).toBe(frames);
  });

  it("thins long lists evenly, preserving order", () => {
    const frames = Array.from({ length: 100 }, (_, i) => i);
    const thinned = thinFrames(frames, 40);
    expect(thinned.length).toBe(40);
    expect(thinned[0]).toBe(0);
    expect([...thinned].sort((a, b) => a - b)).toEqual(thinned);
  });
});

describe("generateDoc", () => {
  const segments = [{ startSeconds: 0, endSeconds: 10, text: "short" }];

  it("makes exactly one strong-model call", async () => {
    const client = fakeClient(() => doc("Short"));
    const result = await generateDoc({
      client,
      strongModel: "strong",
      segments,
      manifest: [manifestFrame("f_0001", 1)],
      workdir: "/tmp",
      videoId: "v1",
      log: noop
    });
    expect(result.title).toBe("Short");
    expect(client.calls.length).toBe(1);
    expect(client.calls[0]!.model).toBe("strong");
    expect(client.calls[0]!.purpose).toBe("doc");
    expect(client.calls[0]!.userPrompt).toContain("f_0001");
    expect(client.calls[0]!.cacheKey).toBeTruthy();
  });

  it("sends at most 16 frame images even for frame-heavy recordings", async () => {
    const client = fakeClient(() => doc("Long"));
    const manifest = Array.from({ length: 40 }, (_, i) =>
      manifestFrame(`f_${String(i + 1).padStart(4, "0")}`, i * 10)
    );
    await generateDoc({
      client,
      strongModel: "strong",
      segments,
      manifest,
      workdir: "/tmp",
      videoId: "v1",
      log: noop
    });
    expect(client.calls[0]!.imagePaths.length).toBe(16);
  });
});

import { describe, expect, it } from "vitest";
import type { GenerateStructuredParams, DocModelClient } from "./model-client.js";
import type { DocOutput, ManifestFrame } from "./schema.js";
import { buildDocCacheKey, concatChapterDocs, formatTranscript, generateDoc, thinFrames } from "./stage-c.js";

const noop = () => undefined;

function doc(title: string, frameId?: string): DocOutput {
  return {
    title,
    doc_type: "runbook",
    sections: [
      {
        heading: `${title} section`,
        body_md: "",
        steps: frameId ? [{ text: "do the thing", frame_id: frameId }] : [],
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
  const base = { transcriptText: "t", manifestText: "m", model: "model-a", chapterLabel: "full" };

  it("is deterministic", () => {
    expect(buildDocCacheKey(base)).toBe(buildDocCacheKey({ ...base }));
  });

  it("changes when any input changes", () => {
    const key = buildDocCacheKey(base);
    expect(buildDocCacheKey({ ...base, transcriptText: "t2" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, manifestText: "m2" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, model: "model-b" })).not.toBe(key);
    expect(buildDocCacheKey({ ...base, chapterLabel: "chapter1of2" })).not.toBe(key);
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

describe("generateDoc", () => {
  const segments = [{ startSeconds: 0, endSeconds: 10, text: "short" }];

  it("makes a single strong-model call for short recordings", async () => {
    const client = fakeClient(() => doc("Short"));
    const result = await generateDoc({
      client,
      strongModel: "strong",
      triageModel: "triage",
      segments,
      manifest: [manifestFrame("f_0001", 1)],
      durationSeconds: 600,
      chapterBoundaries: [],
      workdir: "/tmp",
      videoId: "v1",
      log: noop
    });
    expect(result.title).toBe("Short");
    expect(client.calls.length).toBe(1);
    expect(client.calls[0]!.model).toBe("strong");
    expect(client.calls[0]!.userPrompt).toContain("f_0001");
    expect(client.calls[0]!.cacheKey).toBeTruthy();
  });

  it("chapters long recordings and merges with the triage model", async () => {
    const client = fakeClient((params) =>
      params.purpose === "merge" ? doc("Merged") : doc(`Chapter ${params.purpose}`)
    );
    const longSegments = [
      { startSeconds: 0, endSeconds: 100, text: "first half" },
      { startSeconds: 1600, endSeconds: 1700, text: "second half" }
    ];
    const result = await generateDoc({
      client,
      strongModel: "strong",
      triageModel: "triage",
      segments: longSegments,
      manifest: [manifestFrame("f_0001", 10), manifestFrame("f_0002", 1650)],
      durationSeconds: 40 * 60,
      chapterBoundaries: [20 * 60],
      workdir: "/tmp",
      videoId: "v1",
      log: noop
    });
    expect(result.title).toBe("Merged");
    const purposes = client.calls.map((c) => c.purpose);
    expect(purposes).toEqual(["doc:chapter1of2", "doc:chapter2of2", "merge"]);
    expect(client.calls[2]!.model).toBe("triage");
    // chapter calls only see their own frames/transcript
    expect(client.calls[0]!.userPrompt).toContain("f_0001");
    expect(client.calls[0]!.userPrompt).not.toContain("f_0002");
    expect(client.calls[1]!.userPrompt).toContain("second half");
    expect(client.calls[1]!.userPrompt).not.toContain("first half");
  });

  it("falls back to concatenation when the merge call fails", async () => {
    const client = fakeClient((params) => {
      if (params.purpose === "merge") throw new Error("merge exploded");
      return doc(`C${params.purpose}`, undefined);
    });
    const result = await generateDoc({
      client,
      strongModel: "strong",
      triageModel: "triage",
      segments,
      manifest: [],
      durationSeconds: 40 * 60,
      chapterBoundaries: [20 * 60],
      workdir: "/tmp",
      videoId: "v1",
      log: noop
    });
    expect(result.sections.length).toBe(2);
    expect(result.confidence_notes).toContain("chapter outputs were concatenated without a merge pass");
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

describe("concatChapterDocs", () => {
  it("concatenates sections and dedupes notes", () => {
    const merged = concatChapterDocs([doc("A", "f_0001"), doc("B", "f_0002")]);
    expect(merged.title).toBe("A");
    expect(merged.sections.length).toBe(2);
  });
});

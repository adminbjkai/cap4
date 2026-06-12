import { describe, expect, it } from "vitest";
import {
  chooseCaptureTimes,
  computeChapterBoundaries,
  parseSceneChanges,
  splitIntoChapters
} from "./stage-a.js";

describe("parseSceneChanges", () => {
  it("parses pts_time + scene_score pairs from ffmpeg metadata output", () => {
    const output = [
      "frame:0    pts:107520  pts_time:4.2",
      "lavfi.scene_score=0.392817",
      "frame:1    pts:281600  pts_time:11.0",
      "lavfi.scene_score=0.151200",
      "trailing junk line"
    ].join("\n");
    expect(parseSceneChanges(output)).toEqual([
      { ts: 4.2, score: 0.392817 },
      { ts: 11.0, score: 0.1512 }
    ]);
  });

  it("returns empty for empty output", () => {
    expect(parseSceneChanges("")).toEqual([]);
  });
});

describe("chooseCaptureTimes", () => {
  it("captures at scene change + 500ms", () => {
    const times = chooseCaptureTimes([{ ts: 4.0, score: 0.5 }], 300);
    expect(times).toContain(4.5);
  });

  it("clamps captures to the video duration", () => {
    const times = chooseCaptureTimes([{ ts: 9.8, score: 0.9 }], 10);
    expect(Math.max(...times)).toBeLessThan(10);
  });

  it("caps at 150 frames keeping the strongest scene changes", () => {
    const scenes = Array.from({ length: 300 }, (_, i) => ({ ts: i * 10, score: i < 200 ? 0.1 : 0.9 }));
    const times = chooseCaptureTimes(scenes, 3000);
    expect(times.length).toBe(150);
    // the 100 strongest (ts ≥ 2000) must all survive
    expect(times.filter((t) => t >= 2000).length).toBe(100);
    // returned in chronological order
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("supplements sparse scene changes with uniform samples up to 50", () => {
    const times = chooseCaptureTimes([{ ts: 100, score: 0.9 }], 600);
    expect(times.length).toBeGreaterThanOrEqual(50);
  });

  it("relaxes the minimum for short videos (~one frame per 2s)", () => {
    const times = chooseCaptureTimes([], 6);
    expect(times.length).toBe(3);
  });
});

describe("computeChapterBoundaries", () => {
  const segments = [
    { startSeconds: 0, endSeconds: 60 },
    { startSeconds: 65, endSeconds: 120 }, // 5s gap
    { startSeconds: 121, endSeconds: 180 } // 1s gap — too short
  ];

  it("marks a boundary where a silence gap coincides with a scene change", () => {
    const boundaries = computeChapterBoundaries(segments, [{ ts: 62, score: 0.8 }]);
    expect(boundaries).toEqual([65]);
  });

  it("ignores silence gaps with no nearby scene change", () => {
    const boundaries = computeChapterBoundaries(segments, [{ ts: 150, score: 0.8 }]);
    expect(boundaries).toEqual([]);
  });
});

describe("splitIntoChapters", () => {
  it("keeps recordings within 25 minutes as a single chapter", () => {
    expect(splitIntoChapters(20 * 60, [300, 600])).toEqual([{ start: 0, end: 1200 }]);
  });

  it("splits long recordings at boundaries", () => {
    const chapters = splitIntoChapters(40 * 60, [20 * 60]);
    expect(chapters).toEqual([
      { start: 0, end: 1200 },
      { start: 1200, end: 2400 }
    ]);
  });

  it("splits oversized boundary-free spans evenly", () => {
    const chapters = splitIntoChapters(60 * 60, []);
    expect(chapters.length).toBe(3);
    for (const chapter of chapters) {
      expect(chapter.end - chapter.start).toBeLessThanOrEqual(25 * 60);
    }
    expect(chapters[0]!.start).toBe(0);
    expect(chapters[chapters.length - 1]!.end).toBe(3600);
  });
});

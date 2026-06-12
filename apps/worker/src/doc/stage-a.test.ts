import { describe, expect, it } from "vitest";
import { chooseCaptureTimes, parseSceneChanges } from "./stage-a.js";

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

  it("caps at 40 frames keeping the strongest scene changes", () => {
    const scenes = Array.from({ length: 300 }, (_, i) => ({ ts: i * 10, score: i < 200 ? 0.1 : 0.9 }));
    const times = chooseCaptureTimes(scenes, 3000);
    expect(times.length).toBe(40);
    // only the strongest scene changes (ts ≥ 2000) survive the cap
    expect(times.every((t) => t >= 2000)).toBe(true);
    // returned in chronological order
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("supplements sparse scene changes with uniform samples up to ~12", () => {
    const times = chooseCaptureTimes([{ ts: 100, score: 0.9 }], 600);
    // one uniform sample can collide with the existing capture and be skipped
    expect(times.length).toBeGreaterThanOrEqual(11);
    expect(times.length).toBeLessThanOrEqual(13);
  });

  it("relaxes the minimum for short videos (~one frame per 2s)", () => {
    const times = chooseCaptureTimes([], 6);
    expect(times.length).toBe(3);
  });
});


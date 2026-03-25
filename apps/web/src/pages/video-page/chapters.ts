import type { VideoStatusResponse } from "../../lib/api";

export type VideoChapterItem = {
  title: string;
  seconds: number;
};

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

export function deriveVideoChapters(
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined,
  segments: NonNullable<VideoStatusResponse["transcript"]>["segments"],
): VideoChapterItem[] {
  if (!aiOutput) return [];

  const apiChapters = Array.isArray(aiOutput.chapters)
    ? aiOutput.chapters
        .filter((chapter) => Number.isFinite(chapter.seconds) && chapter.seconds >= 0 && chapter.title.trim())
        .map((chapter) => ({ title: chapter.title.trim(), seconds: chapter.seconds }))
    : [];
  if (apiChapters.length > 0) {
    const deduped = new Map<string, VideoChapterItem>();
    for (const chapter of apiChapters) {
      const key = `${Math.round(chapter.seconds * 10)}-${chapter.title.toLowerCase()}`;
      if (!deduped.has(key)) deduped.set(key, chapter);
    }
    return Array.from(deduped.values()).sort((a, b) => a.seconds - b.seconds);
  }

  if (aiOutput.keyPoints.length === 0) return [];

  const usableSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Number(segment.startSeconds);
      const text = String(segment.text ?? "").trim();
      if (!Number.isFinite(start) || !text) return null;
      return { startSeconds: start, words: new Set(normalizeWords(text)) };
    })
    .filter((segment): segment is { startSeconds: number; words: Set<string> } => Boolean(segment))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const chapters = aiOutput.keyPoints.map((point, index) => {
    if (usableSegments.length === 0) return { title: point, seconds: index * 15 };

    const pointWords = normalizeWords(point);
    let bestMatchSeconds: number | null = null;
    let bestScore = 0;

    for (const segment of usableSegments) {
      const score = pointWords.reduce(
        (total, word) => total + (segment.words.has(word) ? 1 : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestMatchSeconds = segment.startSeconds;
      }
    }

    if (bestMatchSeconds !== null && bestScore > 0) return { title: point, seconds: bestMatchSeconds };

    const fallbackIndex = Math.min(
      usableSegments.length - 1,
      Math.floor((index / Math.max(aiOutput.keyPoints.length - 1, 1)) * (usableSegments.length - 1)),
    );
    return { title: point, seconds: usableSegments[fallbackIndex]?.startSeconds ?? 0 };
  });

  const deduped = new Map<string, VideoChapterItem>();
  for (const chapter of chapters) {
    const key = `${Math.round(chapter.seconds)}-${chapter.title.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, chapter);
  }
  return Array.from(deduped.values()).sort((a, b) => a.seconds - b.seconds);
}

export function buildWatchIdempotencyKey(): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `watch-edits-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

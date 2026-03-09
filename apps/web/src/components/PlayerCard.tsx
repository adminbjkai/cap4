import { useEffect, useMemo, useRef, useState } from "react";
import { buildPublicObjectUrl } from "../lib/format";

type SeekRequest = {
  seconds: number;
  requestId: number;
};

type ChapterItem = {
  title: string;
  seconds: number;
};

function formatTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.floor(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PlayerCard({
  resultKey,
  thumbnailKey,
  seekRequest,
  onPlaybackTimeChange,
  onDurationChange,
  chapters,
  onSeekToSeconds
}: {
  resultKey: string | null;
  thumbnailKey: string | null;
  seekRequest: SeekRequest | null;
  onPlaybackTimeChange?: (seconds: number) => void;
  onDurationChange?: (seconds: number) => void;
  chapters: ChapterItem[];
  onSeekToSeconds: (seconds: number) => void;
}) {
  const [playbackTimeSeconds, setPlaybackTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [hoveredChapterIndex, setHoveredChapterIndex] = useState<number | null>(null);
  const [pinnedTooltipChapterIndex, setPinnedTooltipChapterIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!seekRequest) return;
    const player = videoRef.current;
    if (!player) return;
    const clamped = Math.max(0, seekRequest.seconds);
    player.currentTime = clamped;
    setPlaybackTimeSeconds(clamped);
    onPlaybackTimeChange?.(clamped);
  }, [seekRequest, onPlaybackTimeChange]);

  const hasResult = Boolean(resultKey);
  const videoUrl = resultKey ? buildPublicObjectUrl(resultKey) : null;
  const thumbnailUrl = thumbnailKey ? buildPublicObjectUrl(thumbnailKey) : null;
  const timelineChapters = durationSeconds > 0 ? chapters.filter((chapter) => chapter.seconds >= 0 && chapter.seconds <= durationSeconds) : [];

  const activeChapterIndex = useMemo(() => {
    if (timelineChapters.length === 0) return -1;
    let active = 0;
    for (let index = 0; index < timelineChapters.length; index += 1) {
      if (timelineChapters[index]!.seconds <= playbackTimeSeconds + 0.1) {
        active = index;
      } else {
        break;
      }
    }
    return active;
  }, [timelineChapters, playbackTimeSeconds]);

  const currentChapter = activeChapterIndex >= 0 ? timelineChapters[activeChapterIndex] : null;
  const nextChapter = activeChapterIndex >= 0 ? timelineChapters[activeChapterIndex + 1] ?? null : timelineChapters[0] ?? null;
  const tooltipChapterIndex = pinnedTooltipChapterIndex ?? hoveredChapterIndex;

  const handleChapterSeek = (seconds: number) => {
    const clamped = Math.max(0, seconds);
    const player = videoRef.current;
    if (player) {
      player.currentTime = clamped;
    }
    window.dispatchEvent(new CustomEvent("cap:seek", { detail: { seconds: clamped } }));
    setPlaybackTimeSeconds(clamped);
    onPlaybackTimeChange?.(clamped);
    onSeekToSeconds(clamped);
  };

  const goToPrevChapter = () => {
    if (activeChapterIndex <= 0) return;
    const prev = timelineChapters[activeChapterIndex - 1];
    if (!prev) return;
    handleChapterSeek(prev.seconds);
  };

  const goToNextChapter = () => {
    if (activeChapterIndex < 0 || activeChapterIndex >= timelineChapters.length - 1) return;
    const next = timelineChapters[activeChapterIndex + 1];
    if (!next) return;
    handleChapterSeek(next.seconds);
  };

  if (!hasResult) {
    return (
      <div className="rounded-xl border bg-surface shadow-sm overflow-hidden">
        <div className="aspect-video bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
          <div className="text-center">
            <svg className="h-10 w-10 text-muted mx-auto mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-muted font-medium">Video processing…</p>
            <p className="text-xs text-muted mt-1">This page updates automatically</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-surface shadow-sm overflow-hidden">
      {/* Video */}
      <div className="video-frame bg-black">
        <video
          ref={videoRef}
          controls
          playsInline
          className="aspect-video w-full bg-black"
          src={videoUrl ?? undefined}
          poster={thumbnailUrl ?? undefined}
          onLoadedMetadata={(event) => {
            const time = event.currentTarget.currentTime || 0;
            const duration = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0;
            setPlaybackTimeSeconds(time);
            setDurationSeconds(duration);
            onPlaybackTimeChange?.(time);
            onDurationChange?.(duration);
          }}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime || 0;
            setPlaybackTimeSeconds(time);
            onPlaybackTimeChange?.(time);
          }}
        />
      </div>

      {/* Time display */}
      <div className="px-4 pt-2.5 pb-2 flex items-center justify-center text-sm text-muted font-mono">
        {formatTimestamp(playbackTimeSeconds)} / {durationSeconds > 0 ? formatTimestamp(durationSeconds) : "--:--"}
      </div>

      {/* Chapter timeline — only if chapters exist */}
      {timelineChapters.length > 0 && durationSeconds > 0 && (
        <div className="px-4 pb-4">
          {/* Chapter name */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2.5 text-xs text-muted">
            <span>
              Now: <span className="font-medium text-foreground">{currentChapter ? currentChapter.title : "Start"}</span>
            </span>
            {nextChapter && (
              <span>
                Next: <span className="font-medium">{formatTimestamp(nextChapter.seconds)} {nextChapter.title}</span>
              </span>
            )}
          </div>

          {/* Timeline scrubber with chapter markers */}
          <div className="relative h-8">
            <div className="progress-track absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full" />
            {timelineChapters.map((chapter, index) => {
              const leftPercent = Math.max(0, Math.min(100, (chapter.seconds / durationSeconds) * 100));
              const isActive = index === activeChapterIndex;
              return (
                <div
                  key={`${chapter.title}-${index}-${chapter.seconds}`}
                  className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${leftPercent}%` }}
                >
                  {tooltipChapterIndex === index && (
                    <div className="popover-panel pointer-events-none absolute bottom-full left-1/2 mb-2 w-52 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-left shadow-soft">
                      <p className="font-mono text-[11px] font-semibold text-muted">{formatTimestamp(chapter.seconds)}</p>
                      <p className="text-xs leading-snug">{chapter.title}</p>
                    </div>
                  )}
                  <button
                    type="button"
                    title={`${formatTimestamp(chapter.seconds)} ${chapter.title}`}
                    onClick={() => {
                      setPinnedTooltipChapterIndex(index);
                      handleChapterSeek(chapter.seconds);
                    }}
                    onMouseEnter={() => setHoveredChapterIndex(index)}
                    onMouseLeave={() => setHoveredChapterIndex((current) => (current === index ? null : current))}
                    onFocus={() => setHoveredChapterIndex(index)}
                    onBlur={() => setHoveredChapterIndex((current) => (current === index ? null : current))}
                    onTouchStart={() => setPinnedTooltipChapterIndex(index)}
                    className={`chapter-handle ${isActive ? "chapter-handle-active" : ""}`}
                  >
                    <span className="sr-only">Jump to chapter {chapter.title}</span>
                  </button>
                </div>
              );
            })}
          </div>

          {/* Prev / Next chapter nav */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="text-xs text-muted">
              Chapter {activeChapterIndex >= 0 ? activeChapterIndex + 1 : 1}/{timelineChapters.length}
            </p>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={goToPrevChapter}
                disabled={activeChapterIndex <= 0}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={goToNextChapter}
                disabled={activeChapterIndex < 0 || activeChapterIndex >= timelineChapters.length - 1}
                className="btn-secondary px-2.5 py-1 text-xs disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

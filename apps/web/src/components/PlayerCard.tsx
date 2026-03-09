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
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [playbackTimeSeconds, setPlaybackTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [hoveredChapterIndex, setHoveredChapterIndex] = useState<number | null>(null);
  const [pinnedTooltipChapterIndex, setPinnedTooltipChapterIndex] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`${label} copied`);
    } catch {
      setCopyFeedback(`Unable to copy ${label.toLowerCase()}.`);
    }
    window.setTimeout(() => setCopyFeedback(null), 1600);
  };

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

  return (
    <section className="workspace-card">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="workspace-label">Playback</p>
          <h2 className="workspace-title">Watch</h2>
          <p className="workspace-copy">Review output, navigate chapters, and keep transcript context in sync.</p>
        </div>
      </div>

      {!hasResult ? (
        <div className="panel-subtle rounded-lg border-dashed px-4 py-7">
          <p className="text-sm font-medium">Result video is not available yet.</p>
          <p className="mt-1 text-sm text-muted">Keep this page open while processing runs. This workspace updates automatically.</p>
        </div>
      ) : (
        <>
          <div className="video-frame overflow-hidden rounded-lg">
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

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-medium text-muted">
            <p>Playhead: {formatTimestamp(playbackTimeSeconds)}</p>
            <p>Duration: {durationSeconds > 0 ? formatTimestamp(durationSeconds) : "--:--"}</p>
          </div>

          {timelineChapters.length > 0 && durationSeconds > 0 ? (
            <div className="panel-subtle mt-3 rounded-lg px-3 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs legacy-muted">
                <p>
                  Current chapter: <span className="font-semibold">{currentChapter ? currentChapter.title : "Starting"}</span>
                </p>
                <p>
                  Next: <span className="font-semibold">{nextChapter ? `${formatTimestamp(nextChapter.seconds)} ${nextChapter.title}` : "End"}</span>
                </p>
              </div>
              <div className="relative h-8">
                <div className="progress-track absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full" />
                {timelineChapters.map((chapter, index) => {
                  const leftPercent = Math.max(0, Math.min(100, (chapter.seconds / durationSeconds) * 100));
                  const isActive = index === activeChapterIndex;
                  return (
                    <div key={`${chapter.title}-${index}-${chapter.seconds}`} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${leftPercent}%` }}>
                      {tooltipChapterIndex === index ? (
                        <div className="popover-panel pointer-events-none absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-md px-2.5 py-1.5 text-left shadow-soft">
                          <p className="font-mono text-[11px] font-semibold text-muted">{formatTimestamp(chapter.seconds)}</p>
                          <p className="text-xs leading-snug">{chapter.title}</p>
                        </div>
                      ) : null}
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
              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs font-medium legacy-muted">
                  Chapter {activeChapterIndex >= 0 ? activeChapterIndex + 1 : 1}/{timelineChapters.length}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={goToPrevChapter}
                    disabled={activeChapterIndex <= 0}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={goToNextChapter}
                    disabled={activeChapterIndex < 0 || activeChapterIndex >= timelineChapters.length - 1}
                    className="btn-secondary px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <a
              className="btn-primary"
              href={videoUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
            >
              Download video
            </a>
            <details className="relative">
              <summary className="btn-secondary cursor-pointer list-none">More actions</summary>
              <div className="popover-panel absolute right-0 z-10 mt-2 grid min-w-56 gap-1 rounded-lg p-2 shadow-soft">
                <button
                  type="button"
                  className="btn-secondary w-full justify-start"
                  onClick={() => void copyToClipboard(videoUrl ?? "", "Result URL")}
                >
                  Copy result URL
                </button>
                {thumbnailUrl ? (
                  <>
                    <a
                      className="btn-secondary w-full justify-start"
                      href={thumbnailUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download thumbnail
                    </a>
                    <button
                      type="button"
                      className="btn-secondary w-full justify-start"
                      onClick={() => void copyToClipboard(thumbnailUrl, "Thumbnail URL")}
                    >
                      Copy thumbnail URL
                    </button>
                  </>
                ) : (
                  <span className="panel-subtle rounded-md px-3 py-2 text-left text-xs">Thumbnail not ready</span>
                )}
              </div>
            </details>
          </div>

        </>
      )}

      {copyFeedback ? (
        <p className="panel-subtle mt-3 text-xs font-medium">{copyFeedback}</p>
      ) : null}
    </section>
  );
}

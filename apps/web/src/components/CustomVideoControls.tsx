import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject, type TouchEvent } from "react";

type ChapterItem = { title: string; seconds: number };

type Props = {
  videoRef: RefObject<HTMLVideoElement | null>;
  containerRef?: RefObject<HTMLElement | null>;
  playbackTimeSeconds: number;
  durationSeconds: number;
  chapters: ChapterItem[];
  isBuffering: boolean;
  onSeek: (seconds: number) => void;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

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

export function CustomVideoControls({
  videoRef,
  containerRef,
  playbackTimeSeconds,
  durationSeconds,
  chapters,
  isBuffering,
  onSeek,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [bufferedSeconds, setBufferedSeconds] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isInPip, setIsInPip] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [progressHover, setProgressHover] = useState<{ pct: number; seconds: number } | null>(null);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const bufferedPct = durationSeconds > 0 ? Math.max(0, Math.min(100, (bufferedSeconds / durationSeconds) * 100)) : 0;
  const playedPct = durationSeconds > 0 ? Math.max(0, Math.min(100, (playbackTimeSeconds / durationSeconds) * 100)) : 0;
  const timelineChapters = useMemo(() => {
    if (durationSeconds <= 0) return [];
    return chapters.filter((chapter) => chapter.seconds >= 0 && chapter.seconds <= durationSeconds);
  }, [chapters, durationSeconds]);

  const clearHideTimer = () => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = window.setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && !isDraggingProgress) {
        setShowControls(false);
      }
    }, 3000);
  }, [isDraggingProgress, videoRef]);

  const syncFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setIsPlaying(!video.paused && !video.ended);
    setVolume(video.volume);
    setIsMuted(video.muted || video.volume <= 0.001);
    setPlaybackRate(video.playbackRate || 1);
    let bufferedEnd = 0;
    for (let i = 0; i < video.buffered.length; i += 1) {
      const start = video.buffered.start(i);
      const end = video.buffered.end(i);
      if (playbackTimeSeconds >= start && playbackTimeSeconds <= end) {
        bufferedEnd = end;
        break;
      }
      bufferedEnd = Math.max(bufferedEnd, end);
    }
    setBufferedSeconds(bufferedEnd);
  }, [playbackTimeSeconds, videoRef]);

  useEffect(() => {
    syncFromVideo();
  }, [syncFromVideo]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => {
      setIsPlaying(true);
      setShowControls(true);
      scheduleHide();
    };
    const onPause = () => {
      setIsPlaying(false);
      setShowControls(true);
      clearHideTimer();
    };
    const onProgress = () => syncFromVideo();
    const onVolumeChange = () => syncFromVideo();
    const onRateChange = () => syncFromVideo();

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("progress", onProgress);
    video.addEventListener("volumechange", onVolumeChange);
    video.addEventListener("ratechange", onRateChange);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("volumechange", onVolumeChange);
      video.removeEventListener("ratechange", onRateChange);
    };
  }, [scheduleHide, syncFromVideo, videoRef]);

  useEffect(() => {
    const onFsChange = () => {
      const fsTarget = containerRef?.current ?? hostRef.current;
      setIsFullscreen(Boolean(fsTarget && document.fullscreenElement === fsTarget));
    };
    const onPipEnter = () => setIsInPip(true);
    const onPipLeave = () => setIsInPip(false);

    document.addEventListener("fullscreenchange", onFsChange);
    const video = videoRef.current;
    if (video) {
      video.addEventListener("enterpictureinpicture", onPipEnter);
      video.addEventListener("leavepictureinpicture", onPipLeave);
    }

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      if (video) {
        video.removeEventListener("enterpictureinpicture", onPipEnter);
        video.removeEventListener("leavepictureinpicture", onPipLeave);
      }
    };
  }, [containerRef, videoRef]);

  useEffect(() => {
    return () => clearHideTimer();
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(durationSeconds || Number.MAX_SAFE_INTEGER, seconds));
      video.currentTime = clamped;
      onSeek(clamped);
      syncFromVideo();
    },
    [durationSeconds, onSeek, syncFromVideo, videoRef]
  );

  const getProgressPosition = (clientX: number) => {
    const track = progressRef.current;
    if (!track || durationSeconds <= 0) return null;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return { pct, seconds: pct * durationSeconds };
  };

  const onProgressPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    setIsDraggingProgress(true);
    const point = getProgressPosition(event.clientX);
    if (point) {
      setProgressHover({ pct: point.pct * 100, seconds: point.seconds });
      seekTo(point.seconds);
    }
  };

  const onProgressPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = getProgressPosition(event.clientX);
    if (!point) return;
    setProgressHover({ pct: point.pct * 100, seconds: point.seconds });
    if (isDraggingProgress) seekTo(point.seconds);
  };

  const onProgressPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    setIsDraggingProgress(false);
    scheduleHide();
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
      return;
    }
    video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume <= 0.001) {
      video.muted = false;
      video.volume = Math.max(volume, 0.25);
      return;
    }
    video.muted = true;
  };

  const updateVolume = (nextVolume: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(1, nextVolume));
    video.volume = clamped;
    video.muted = clamped === 0;
    syncFromVideo();
  };

  const seekBy = (deltaSeconds: number) => {
    seekTo(playbackTimeSeconds + deltaSeconds);
  };

  const toggleFullscreen = async () => {
    const fsTarget = containerRef?.current ?? hostRef.current;
    if (!fsTarget) return;
    if (document.fullscreenElement === fsTarget) {
      await document.exitFullscreen();
      return;
    }
    await fsTarget.requestFullscreen();
  };

  const togglePip = async () => {
    const video = videoRef.current;
    if (!video || !("pictureInPictureEnabled" in document)) return;
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
        return;
      }
      await video.requestPictureInPicture();
    } catch {
      // no-op: browser policy may block PiP based on user gesture constraints.
    }
  };

  const setSpeed = (speed: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    setSpeedOpen(false);
    syncFromVideo();
  };

  const onProgressKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(5);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      seekBy(-5);
    }
    if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      seekTo(durationSeconds);
    }
  };

  const onHostInteract = () => {
    setShowControls(true);
    scheduleHide();
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
    onHostInteract();
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaY) > 40) return;
    if (Math.abs(deltaX) < 80) return;
    seekBy(deltaX > 0 ? 10 : -10);
  };

  const currentLabel = formatTimestamp(playbackTimeSeconds);
  const durationLabel = durationSeconds > 0 ? formatTimestamp(durationSeconds) : "--:--";
  const remainingLabel = durationSeconds > 0 ? `-${formatTimestamp(Math.max(0, durationSeconds - playbackTimeSeconds))}` : "--:--";
  const volumeBars = Math.max(1, Math.round((isMuted ? 0 : volume) * 4));

  return (
    <div
      ref={hostRef}
      className={`custom-video-shell group ${isFullscreen ? "custom-video-shell-fullscreen" : ""}`}
      onMouseMove={onHostInteract}
      onMouseEnter={onHostInteract}
      onMouseLeave={() => !isPlaying && setShowControls(true)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {isBuffering && (
        <div className="buffering-overlay" aria-live="polite" aria-label="Buffering video">
          <div className="buffering-pulse" />
        </div>
      )}

      <div className={`controls-overlay ${showControls || !isPlaying ? "controls-overlay-visible" : ""}`}>
        <div
          ref={progressRef}
          className="controls-progress"
          role="slider"
          aria-label="Seek timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSeconds || 0)}
          aria-valuenow={Math.round(playbackTimeSeconds || 0)}
          tabIndex={0}
          onPointerDown={onProgressPointerDown}
          onPointerMove={onProgressPointerMove}
          onPointerUp={onProgressPointerUp}
          onPointerCancel={() => setIsDraggingProgress(false)}
          onMouseLeave={() => !isDraggingProgress && setProgressHover(null)}
          onKeyDown={onProgressKeyDown}
        >
          <div className="controls-progress-track" />
          <div className="controls-progress-buffered" style={{ width: `${bufferedPct}%` }} />
          <div className="controls-progress-played" style={{ width: `${playedPct}%` }} />
          {timelineChapters.map((chapter, index) => {
            const left = Math.max(0, Math.min(100, (chapter.seconds / durationSeconds) * 100));
            return (
              <button
                key={`${chapter.title}-${chapter.seconds}-${index}`}
                type="button"
                className="controls-chapter-dot"
                style={{ left: `${left}%` }}
                title={`${formatTimestamp(chapter.seconds)} - ${chapter.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  seekTo(chapter.seconds);
                }}
              >
                <span className="sr-only">Seek to chapter {chapter.title}</span>
              </button>
            );
          })}
          {progressHover && (
            <div className="controls-progress-tooltip" style={{ left: `${Math.min(Math.max(progressHover.pct, 6), 94)}%` }}>
              {formatTimestamp(progressHover.seconds)}
            </div>
          )}
        </div>

        <div className="controls-bar">
          <button type="button" className="controls-btn controls-btn-primary" onClick={() => void togglePlay()} aria-label={isPlaying ? "Pause" : "Play"}>
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <polygon
                points="8,6 18,12 8,18"
                className={`icon-play ${isPlaying ? "icon-hidden" : ""}`}
                fill="currentColor"
              />
              <rect x="7" y="6" width="3.8" height="12" rx="1" className={`icon-pause ${isPlaying ? "" : "icon-hidden"}`} fill="currentColor" />
              <rect x="13" y="6" width="3.8" height="12" rx="1" className={`icon-pause ${isPlaying ? "" : "icon-hidden"}`} fill="currentColor" />
            </svg>
          </button>

          <div className="controls-volume-wrap">
            <button type="button" className="controls-btn" onClick={toggleMute} aria-label={isMuted ? "Unmute" : "Mute"}>
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path d="M4 10v4h4l5 4V6L8 10H4z" fill="currentColor" />
                {isMuted ? (
                  <path d="M18 8L10 16M10 8l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                ) : (
                  <g className="wave-bars">
                    {Array.from({ length: volumeBars }).map((_, idx) => (
                      <rect
                        key={idx}
                        x={15 + idx * 1.8}
                        y={12 - (idx + 1) * 1.1}
                        width="1.2"
                        height={(idx + 1) * 2.2}
                        rx="0.6"
                        fill="currentColor"
                      />
                    ))}
                  </g>
                )}
              </svg>
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              className="controls-volume-slider"
              aria-label="Volume"
              onChange={(event) => updateVolume(Number(event.target.value))}
            />
          </div>

          <button type="button" className="controls-btn" onClick={() => seekBy(-10)} aria-label="Seek back 10 seconds">
            -10s
          </button>
          <button type="button" className="controls-btn" onClick={() => seekBy(10)} aria-label="Seek forward 10 seconds">
            +10s
          </button>

          <button type="button" className="controls-time" onClick={() => setShowRemaining((prev) => !prev)} aria-label="Toggle remaining time">
            <span>{currentLabel}</span>
            <span>/</span>
            <span>{showRemaining ? remainingLabel : durationLabel}</span>
          </button>

          <div className="controls-speed">
            <button
              type="button"
              className="controls-btn"
              aria-haspopup="listbox"
              aria-expanded={speedOpen}
              onClick={() => setSpeedOpen((prev) => !prev)}
            >
              {playbackRate.toFixed(2).replace(/\.00$/, "")}
              x
            </button>
            {speedOpen && (
              <div role="listbox" className="controls-speed-menu" aria-label="Playback speed">
                {SPEEDS.map((speed) => (
                  <button
                    type="button"
                    key={speed}
                    role="option"
                    aria-selected={Math.abs(playbackRate - speed) < 0.01}
                    className={`controls-speed-option ${Math.abs(playbackRate - speed) < 0.01 ? "controls-speed-option-active" : ""}`}
                    onClick={() => setSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" className="controls-btn" onClick={() => void togglePip()} aria-pressed={isInPip} aria-label="Picture in picture">
            PiP
          </button>
          <button type="button" className="controls-btn controls-btn-full" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {isFullscreen ? "Exit" : "Full"}
          </button>
        </div>
      </div>
    </div>
  );
}

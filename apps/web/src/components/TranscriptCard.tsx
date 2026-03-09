import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { VideoStatusResponse } from "../lib/api";

type TranscriptCardProps = {
  transcriptionStatus: VideoStatusResponse["transcriptionStatus"] | undefined;
  transcript: VideoStatusResponse["transcript"] | null | undefined;
  errorMessage: string | null | undefined;
  playbackTimeSeconds: number;
  onSeekToSeconds: (seconds: number) => void;
  onSaveTranscript: (text: string) => Promise<boolean>;
  /** When true, omits the outer card wrapper — for embedding in the right rail */
  compact?: boolean;
};

type TranscriptLine = {
  index: number;
  startSeconds: number;
  endSeconds: number | null;
  text: string;
  originalText: string | null;
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

export function TranscriptCard({
  transcriptionStatus,
  transcript,
  errorMessage,
  playbackTimeSeconds,
  onSeekToSeconds,
  onSaveTranscript,
  compact = false
}: TranscriptCardProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [observedPlaybackTime, setObservedPlaybackTime] = useState<number | null>(null);
  const [seekFocusSeconds, setSeekFocusSeconds] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [textViewMode, setTextViewMode] = useState<"current" | "original">("current");
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const player = document.querySelector("video");
      if (!(player instanceof HTMLVideoElement)) return;
      const next = player.currentTime;
      if (Number.isFinite(next)) {
        setObservedPlaybackTime(next);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let resetTimer: number | null = null;
    const onSeek = (event: Event) => {
      const customEvent = event as CustomEvent<{ seconds?: number }>;
      const seconds = customEvent.detail?.seconds;
      if (!Number.isFinite(seconds)) return;
      setSeekFocusSeconds(seconds as number);
      if (resetTimer) window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => setSeekFocusSeconds(null), 900);
    };
    window.addEventListener("cap:seek", onSeek as EventListener);
    return () => {
      window.removeEventListener("cap:seek", onSeek as EventListener);
      if (resetTimer) window.clearTimeout(resetTimer);
    };
  }, []);

  const transcriptLines = useMemo<TranscriptLine[]>(() => {
    const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    return segments
      .map((segment, index) => {
        const text = String(segment.text ?? "").trim();
        const start = Number(segment.startSeconds);
        const end = Number(segment.endSeconds);
        if (!text || !Number.isFinite(start)) return null;
        return {
          index,
          startSeconds: start,
          endSeconds: Number.isFinite(end) ? Math.max(start, end) : null,
          text,
          originalText: typeof segment.originalText === "string" && segment.originalText.trim().length > 0 ? segment.originalText : null
        };
      })
      .filter((line): line is TranscriptLine => Boolean(line))
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }, [transcript?.segments]);

  const transcriptText = useMemo(() => {
    if (transcriptLines.length > 0) {
      return transcriptLines.map((line) => line.text).join("\n").trim();
    }
    return transcript?.text?.trim() ?? "";
  }, [transcript?.text, transcriptLines]);

  const originalTranscriptText = useMemo(() => {
    const withOriginal = transcriptLines.filter((line) => line.originalText && line.originalText.trim().length > 0);
    if (withOriginal.length > 0) {
      return withOriginal.map((line) => line.originalText as string).join("\n").trim();
    }
    return transcriptText;
  }, [transcriptLines, transcriptText]);

  useEffect(() => {
    if (!isEditing) {
      setDraftText(transcriptText);
      setSaveError(null);
    }
  }, [isEditing, transcriptText]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timeout = window.setTimeout(() => setSaveFeedback(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveFeedback]);

  const activeLineIndex = useMemo(() => {
    if (transcriptLines.length === 0) return -1;
    const sourceTime = Number.isFinite(seekFocusSeconds ?? NaN)
      ? (seekFocusSeconds as number)
      : Number.isFinite(observedPlaybackTime ?? NaN)
        ? (observedPlaybackTime as number)
        : playbackTimeSeconds;
    const current = Number.isFinite(sourceTime) ? Math.max(0, sourceTime) : 0;
    const epsilon = 0.1;
    let nearestIndex = 0;
    for (let index = 0; index < transcriptLines.length; index += 1) {
      const line = transcriptLines[index]!;
      if (line.startSeconds <= current + epsilon) {
        nearestIndex = index;
        continue;
      }
      break;
    }
    return nearestIndex;
  }, [playbackTimeSeconds, observedPlaybackTime, seekFocusSeconds, transcriptLines]);

  useEffect(() => {
    if (activeLineIndex < 0 || isEditing) return;
    const container = transcriptScrollRef.current;
    if (!container) return;
    const activeNode = container.querySelector<HTMLElement>(`[data-transcript-line-index="${activeLineIndex}"]`);
    if (!activeNode) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = activeNode.getBoundingClientRect();
    const notFullyVisible = nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8;
    if (notFullyVisible) {
      activeNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeLineIndex, isEditing]);

  const copyTranscript = async () => {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopyFeedback("Transcript copied");
    } catch {
      setCopyFeedback("Unable to copy transcript.");
    }
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };

  const submitEdit = async () => {
    const normalized = draftText.trim();
    if (!normalized) {
      setSaveError("Transcript cannot be empty.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const ok = await onSaveTranscript(normalized);
    setIsSaving(false);
    if (ok) {
      setIsEditing(false);
      setSaveFeedback("Transcript saved.");
      return;
    }
    setSaveError("Unable to save transcript edits.");
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (isSaving) return;
      setDraftText(transcriptText);
      setIsEditing(false);
      setSaveError(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (!isSaving) {
        void submitEdit();
      }
    }
  };

  const Inner = (
    <div className={compact ? "flex flex-col h-full" : ""}>
      {/* Header — hidden in compact mode (tab bar in VideoPage handles it) */}
      {!compact && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="workspace-label">Workspace panel</p>
            <h2 className="workspace-title">Transcript</h2>
          </div>
          <span className="status-chip">{transcriptionStatus ?? "not_started"}</span>
        </div>
      )}

      {/* Status messages */}
      {(transcriptionStatus === "queued" || transcriptionStatus === "processing") && (
        <p className={`text-sm legacy-muted ${compact ? "px-4 pt-4" : ""}`}>Transcription is running. This section updates automatically.</p>
      )}
      {transcriptionStatus === "not_started" && (
        <p className={`text-sm legacy-muted ${compact ? "px-4 pt-4" : ""}`}>Transcription will start after processing completes.</p>
      )}
      {transcriptionStatus === "no_audio" && (
        <p className={`panel-subtle ${compact ? "m-4" : ""}`}>No audio track was detected for this recording.</p>
      )}
      {transcriptionStatus === "failed" && (
        <p className={`panel-danger ${compact ? "m-4" : ""}`}>
          {errorMessage ? `Transcription failed: ${errorMessage}` : "Transcription failed after retries."}
        </p>
      )}
      {transcriptionStatus === "complete" && transcriptText.length === 0 && (
        <p className={`panel-subtle ${compact ? "m-4" : ""}`}>Transcript completed, but no text was returned.</p>
      )}

      {transcriptionStatus === "complete" && transcriptText.length > 0 && (
        <div className={`space-y-3 ${compact ? "flex flex-col flex-1 min-h-0 px-3 pt-3 pb-2" : ""}`}>
          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="pill-toggle">
              <button
                type="button"
                onClick={() => setTextViewMode("current")}
                className={`pill-toggle-btn ${textViewMode === "current" ? "pill-toggle-btn-active" : ""}`}
                aria-pressed={textViewMode === "current"}
              >
                Current
              </button>
              <button
                type="button"
                onClick={() => setTextViewMode("original")}
                className={`pill-toggle-btn ${textViewMode === "original" ? "pill-toggle-btn-active" : ""}`}
                aria-pressed={textViewMode === "original"}
              >
                Original
              </button>
            </div>
            <button type="button" onClick={() => void copyTranscript()} className="btn-secondary text-xs px-2.5 py-1">
              Copy
            </button>
            {!isEditing && (
              <button type="button" onClick={() => setIsEditing(true)} className="btn-secondary text-xs px-2.5 py-1">
                Edit
              </button>
            )}
          </div>

          {/* Edit mode */}
          {isEditing ? (
            <div className="panel-subtle space-y-2 rounded-lg p-3">
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={onEditKeyDown}
                className="input-control min-h-56 rounded-lg p-3 text-sm leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void submitEdit()} disabled={isSaving} className="btn-primary">
                  {isSaving ? "Saving..." : "Save transcript"}
                </button>
                <button
                  type="button"
                  onClick={() => { setDraftText(transcriptText); setIsEditing(false); setSaveError(null); }}
                  disabled={isSaving}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <span className="text-xs text-muted">Cmd/Ctrl+Enter to save • Esc to cancel</span>
                {saveError && <span className="text-xs text-red-700">{saveError}</span>}
              </div>
            </div>
          ) : transcriptLines.length > 0 ? (
            <div
              ref={transcriptScrollRef}
              className={`scroll-panel space-y-1 overflow-auto rounded-lg p-1 ${
                compact ? "flex-1 min-h-0" : "max-h-[32rem]"
              }`}
            >
              {transcriptLines.map((line, index) => {
                const isActive = index === activeLineIndex && textViewMode === "current";
                const lineText = textViewMode === "original" && line.originalText ? line.originalText : line.text;
                return (
                  <button
                    key={`${line.index}-${line.startSeconds}`}
                    type="button"
                    data-transcript-line-index={index}
                    onClick={() => onSeekToSeconds(line.startSeconds)}
                    className={`line-item w-full rounded-md px-3 py-2 text-left transition focus-visible:outline-none ${
                      isActive ? "line-item-active" : ""
                    }`}
                  >
                    <span className="mr-2 inline-block min-w-[52px] font-mono text-xs text-muted">{formatTimestamp(line.startSeconds)}</span>
                    <span className="text-sm leading-relaxed">{lineText}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <pre className={`scroll-panel overflow-auto whitespace-pre-wrap rounded-lg p-4 text-sm leading-relaxed ${compact ? "flex-1 min-h-0" : "max-h-[28rem]"}`}>
              {textViewMode === "original" ? originalTranscriptText : transcriptText}
            </pre>
          )}

          {transcript?.vttKey && (
            <span className="text-xs text-muted">VTT key: <span className="font-mono">{transcript.vttKey}</span></span>
          )}
        </div>
      )}

      {copyFeedback && <p className={`text-xs font-medium text-muted ${compact ? "px-4 pb-2" : "mt-3"}`}>{copyFeedback}</p>}
      {saveFeedback && <p className={`text-xs font-medium text-accent-700 ${compact ? "px-4 pb-2" : "mt-2"}`}>{saveFeedback}</p>}
    </div>
  );

  if (compact) return Inner;
  return <section className="workspace-card">{Inner}</section>;
}

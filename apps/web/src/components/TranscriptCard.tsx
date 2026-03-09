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
  confidence: number | null;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  // Confidence review mode
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  // Track verified segments in localStorage
  const videoId = transcript?.vttKey?.split("/")[0] ?? "unknown";
  const verifiedSegmentsKey = `cap4:verified-segments:${videoId}`;
  const [verifiedSegments, setVerifiedSegments] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem(verifiedSegmentsKey);
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });

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
        const confidence = typeof segment.confidence === "number" ? segment.confidence : null;
        if (!text || !Number.isFinite(start)) return null;
        return {
          index,
          startSeconds: start,
          endSeconds: Number.isFinite(end) ? Math.max(start, end) : null,
          text,
          originalText: typeof segment.originalText === "string" && segment.originalText.trim().length > 0 ? segment.originalText : null,
          confidence
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

  // Find all matches for the search query
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const matches: Array<{ lineIndex: number; matchText: string; startPos: number; endPos: number }> = [];

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      const lineText = textViewMode === "original" && line.originalText ? line.originalText : line.text;
      const lowerText = lineText.toLowerCase();
      let searchPos = 0;

      while (true) {
        const matchPos = lowerText.indexOf(query, searchPos);
        if (matchPos === -1) break;
        matches.push({
          lineIndex: i,
          matchText: lineText.substring(matchPos, matchPos + query.length),
          startPos: matchPos,
          endPos: matchPos + query.length,
        });
        searchPos = matchPos + 1;
      }
    }

    return matches;
  }, [searchQuery, transcriptLines, textViewMode]);

  // Confidence stats
  const confidenceStats = useMemo(() => {
    const withConfidence = transcriptLines.filter((line) => line.confidence !== null);
    if (withConfidence.length === 0) return null;
    const highConfidenceCount = withConfidence.filter((line) => line.confidence! >= 0.8).length;
    const percentage = Math.round((highConfidenceCount / withConfidence.length) * 100);
    return { percentage, total: withConfidence.length, highCount: highConfidenceCount };
  }, [transcriptLines]);

  // Uncertain segments (confidence < 80%)
  const uncertainSegments = useMemo(() => {
    return transcriptLines
      .map((line, idx) => ({ line, lineIndex: idx }))
      .filter(({ line }) => line.confidence !== null && line.confidence < 0.8);
  }, [transcriptLines]);

  const originalTranscriptText = useMemo(() => {
    const withOriginal = transcriptLines.filter((line) => line.originalText && line.originalText.trim().length > 0);
    if (withOriginal.length > 0) {
      return withOriginal.map((line) => line.originalText as string).join("\n").trim();
    }
    return transcriptText;
  }, [transcriptLines, transcriptText]);

  // Save verified segments to localStorage whenever it changes
  useEffect(() => {
    if (verifiedSegments.size === 0) {
      try { localStorage.removeItem(verifiedSegmentsKey); } catch { /* ignore */ }
    } else {
      try {
        localStorage.setItem(verifiedSegmentsKey, JSON.stringify(Array.from(verifiedSegments)));
      } catch { /* quota exceeded */ }
    }
  }, [verifiedSegments, verifiedSegmentsKey]);

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

  // Reset active match when search query changes (debounced)
  useEffect(() => {
    setActiveMatchIndex(searchQuery.trim() ? 0 : -1);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
  }, [searchQuery]);

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

  // Auto-scroll to active match
  useEffect(() => {
    if (activeMatchIndex < 0 || !searchQuery.trim() || isEditing) return;
    const match = searchMatches[activeMatchIndex];
    if (!match) return;

    const container = transcriptScrollRef.current;
    if (!container) return;

    const matchNode = container.querySelector<HTMLElement>(
      `[data-transcript-line-index="${match.lineIndex}"]`
    );
    if (!matchNode) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = matchNode.getBoundingClientRect();
    const notFullyVisible = nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8;
    if (notFullyVisible) {
      matchNode.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeMatchIndex, searchMatches, searchQuery, isEditing]);

  // Handle search keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: Event) => {
      const kbd = event as unknown as globalThis.KeyboardEvent;
      // Cmd/Ctrl+F to focus search
      if ((kbd.metaKey || kbd.ctrlKey) && kbd.key === "f") {
        kbd.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Only handle navigation keys if search is active
      if (!searchQuery.trim() || !searchInputRef.current || document.activeElement !== searchInputRef.current) {
        return;
      }

      if (kbd.key === "ArrowDown" || (kbd.shiftKey === false && kbd.key === "Enter")) {
        kbd.preventDefault();
        setActiveMatchIndex((current) => {
          const nextIndex = (current + 1) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) {
            onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          }
          return nextIndex;
        });
      } else if (kbd.key === "ArrowUp" || (kbd.shiftKey && kbd.key === "Enter")) {
        kbd.preventDefault();
        setActiveMatchIndex((current) => {
          const nextIndex = (current - 1 + searchMatches.length) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) {
            onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          }
          return nextIndex;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery, searchMatches, transcriptLines, onSeekToSeconds]);

  // Review mode helpers
  const toggleReviewMode = () => {
    setIsReviewMode((prev) => !prev);
    setReviewIndex(0);
    if (!isReviewMode && uncertainSegments.length > 0) {
      onSeekToSeconds(uncertainSegments[0]!.line.startSeconds);
    }
  };

  const navigateReview = (direction: "prev" | "next") => {
    if (uncertainSegments.length === 0) return;
    const newIndex = direction === "next"
      ? (reviewIndex + 1) % uncertainSegments.length
      : (reviewIndex - 1 + uncertainSegments.length) % uncertainSegments.length;
    setReviewIndex(newIndex);
    onSeekToSeconds(uncertainSegments[newIndex]!.line.startSeconds);
  };

  const toggleVerified = (segmentIndex: number) => {
    setVerifiedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentIndex)) {
        next.delete(segmentIndex);
      } else {
        next.add(segmentIndex);
      }
      return next;
    });
  };

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

  const highlightText = (text: string, lineIndex: number): React.ReactNode => {
    if (!searchQuery.trim()) return text;

    const matches = searchMatches.filter((m) => m.lineIndex === lineIndex).sort((a, b) => a.startPos - b.startPos);
    if (matches.length === 0) return text;

    const parts: React.ReactNode[] = [];
    let lastPos = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      if (match.startPos > lastPos) {
        parts.push(text.substring(lastPos, match.startPos));
      }

      const isActive = searchMatches.indexOf(match) === activeMatchIndex;
      parts.push(
        <span
          key={`match-${i}`}
          className={`transition-colors ${isActive ? "bg-yellow-400 dark:bg-yellow-600" : "bg-yellow-200 dark:bg-yellow-800"}`}
        >
          {text.substring(match.startPos, match.endPos)}
        </span>
      );
      lastPos = match.endPos;
    }

    if (lastPos < text.length) {
      parts.push(text.substring(lastPos));
    }

    return parts;
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
    <div>
      {/* Header — hidden in compact mode (VideoPage rail header handles it) */}
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
        <p className={`legacy-muted ${compact ? "px-3 py-3 text-[13px]" : "text-sm"}`}>
          Transcription is running. Updates automatically.
        </p>
      )}
      {transcriptionStatus === "not_started" && (
        <p className={`legacy-muted ${compact ? "px-3 py-3 text-[13px]" : "text-sm"}`}>
          Transcription will start after processing completes.
        </p>
      )}
      {transcriptionStatus === "no_audio" && (
        <p className={`panel-subtle ${compact ? "m-3 text-[13px]" : ""}`}>
          No audio track was detected for this recording.
        </p>
      )}
      {transcriptionStatus === "failed" && (
        <p className={`panel-danger ${compact ? "m-3 text-[13px]" : ""}`}>
          {errorMessage ? `Transcription failed: ${errorMessage}` : "Transcription failed after retries."}
        </p>
      )}
      {transcriptionStatus === "complete" && transcriptText.length === 0 && (
        <p className={`panel-subtle ${compact ? "m-3 text-[13px]" : ""}`}>
          Transcript completed, but no text was returned.
        </p>
      )}

      {transcriptionStatus === "complete" && transcriptText.length > 0 && (
        <div className={compact ? "" : "space-y-3"}>
          {/* Search bar */}
          {!isEditing && (
            <div className={`flex items-center gap-1.5 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}>
              <div className="flex-1 flex items-center gap-1.5 bg-surface-subtle rounded-md border px-2 py-1.5"
                   style={{ borderColor: "var(--border-default)" }}>
                <svg className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transcript…"
                  className="flex-1 bg-transparent text-[13px] outline-none"
                  style={{ color: "var(--text-primary)" }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => { setSearchQuery(""); setActiveMatchIndex(-1); }}
                    className="text-[13px] font-medium"
                    style={{ color: "var(--text-muted)" }}
                    title="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              {searchQuery && (
                <span className="text-[11px] font-medium whitespace-nowrap"
                      style={{ color: "var(--text-secondary)" }}>
                  {searchMatches.length === 0
                    ? "No matches"
                    : `${activeMatchIndex + 1}/${searchMatches.length}`}
                </span>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "px-2.5 py-2 border-b" : "mb-3"}`}>
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
            <button type="button" onClick={() => void copyTranscript()} className="btn-secondary text-[11px] px-2 py-0.5">
              Copy
            </button>
            {!isEditing && (
              <button type="button" onClick={() => setIsEditing(true)} className="btn-secondary text-[11px] px-2 py-0.5">
                Edit
              </button>
            )}
            {/* Confidence stats badge */}
            {confidenceStats && (
              <span className="confidence-badge" title={`${confidenceStats.highCount}/${confidenceStats.total} segments with ≥80% confidence`}>
                {confidenceStats.percentage}% high confidence
              </span>
            )}
            {/* Review mode toggle */}
            {uncertainSegments.length > 0 && !isEditing && (
              <button
                type="button"
                onClick={toggleReviewMode}
                className={`btn-secondary text-[11px] px-2 py-0.5 ${isReviewMode ? "!bg-amber-50 !border-amber-300 !text-amber-900" : ""}`}
                title={`${uncertainSegments.length} uncertain segments (<80% confidence)`}
              >
                {isReviewMode ? `Reviewing (${reviewIndex + 1}/${uncertainSegments.length})` : "Review uncertain"}
              </button>
            )}
            {/* Review mode navigation */}
            {isReviewMode && uncertainSegments.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => navigateReview("prev")}
                  className="btn-secondary text-[11px] px-2 py-0.5"
                  title="Previous uncertain segment"
                >
                  ‹ Prev
                </button>
                <button
                  type="button"
                  onClick={() => navigateReview("next")}
                  className="btn-secondary text-[11px] px-2 py-0.5"
                  title="Next uncertain segment"
                >
                  Next ›
                </button>
              </>
            )}
          </div>

          {/* Edit mode */}
          {isEditing ? (
            <div className={`panel-subtle space-y-2 rounded-lg p-3 ${compact ? "mx-2.5 mb-2.5" : ""}`}>
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                onKeyDown={onEditKeyDown}
                className="input-control min-h-48 rounded-lg p-2.5 text-[13px] leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => void submitEdit()} disabled={isSaving} className="btn-primary text-xs px-2.5 py-1">
                  {isSaving ? "Saving…" : "Save transcript"}
                </button>
                <button
                  type="button"
                  onClick={() => { setDraftText(transcriptText); setIsEditing(false); setSaveError(null); }}
                  disabled={isSaving}
                  className="btn-secondary text-xs px-2.5 py-1"
                >
                  Cancel
                </button>
                <span className="text-[11px] text-muted">Cmd+Enter to save • Esc to cancel</span>
                {saveError && <span className="text-[11px] text-red-700">{saveError}</span>}
              </div>
            </div>
          ) : transcriptLines.length > 0 ? (
            /* Transcript lines — in compact mode we DON'T add overflow here;
               the outer container in VideoPage controls the scroll */
            <div
              ref={transcriptScrollRef}
              className={`space-y-0 relative ${compact ? "" : "scroll-panel max-h-[32rem] overflow-auto rounded-lg p-1"}`}
            >
              {transcriptLines.map((line, index) => {
                // Review mode filtering
                if (isReviewMode && (line.confidence === null || line.confidence >= 0.8)) return null;

                const isActive = index === activeLineIndex && textViewMode === "current";
                const lineText = textViewMode === "original" && line.originalText ? line.originalText : line.text;
                const highlightedContent = highlightText(lineText, index);
                const isVerified = verifiedSegments.has(line.index);

                // Determine confidence class
                let confidenceClass = "";
                if (line.confidence !== null && line.confidence < 0.8) {
                  confidenceClass = line.confidence < 0.6 ? "confidence-very-low" : "confidence-low";
                }

                return (
                  <button
                    key={`${line.index}-${line.startSeconds}`}
                    type="button"
                    data-transcript-line-index={index}
                    onClick={() => onSeekToSeconds(line.startSeconds)}
                    onMouseEnter={(e) => {
                      setHoveredLineIndex(index);
                      if (line.confidence !== null && line.confidence < 1.0) {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 8 });
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredLineIndex(null);
                      setTooltipPosition(null);
                    }}
                    className={`line-item w-full rounded-none px-3 py-2 text-left transition focus-visible:outline-none ${
                      isActive ? "line-item-active" : ""
                    }`}
                  >
                    <span className="mr-2 inline-block min-w-[44px] font-mono text-[11px] text-muted leading-[1.4]">
                      {formatTimestamp(line.startSeconds)}
                    </span>
                    <span className={`text-[13px] leading-[1.4] ${confidenceClass}`}>
                      {highlightedContent}
                    </span>
                    {/* Verified marker */}
                    {isVerified && (
                      <span className="verified-marker ml-2 inline-flex" title="Verified">
                        <svg className="h-2 w-2" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </span>
                    )}
                    {/* Verify button in review mode */}
                    {isReviewMode && !isVerified && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); toggleVerified(line.index); }}
                        className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 hover:bg-green-200"
                        title="Mark as verified"
                      >
                        ✓ Verify
                      </button>
                    )}
                  </button>
                );
              })}

              {/* Confidence tooltip */}
              {hoveredLineIndex !== null && tooltipPosition && transcriptLines[hoveredLineIndex]?.confidence !== null && (
                <div
                  className="confidence-tooltip"
                  style={{
                    position: "fixed",
                    left: `${tooltipPosition.x}px`,
                    top: `${tooltipPosition.y}px`,
                    transform: "translate(-50%, -100%)"
                  }}
                >
                  Confidence: {Math.round(transcriptLines[hoveredLineIndex]!.confidence! * 100)}%
                </div>
              )}
            </div>
          ) : (
            <pre className={`overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed ${compact ? "px-3 py-2" : "scroll-panel max-h-[28rem] rounded-lg p-4"}`}>
              {textViewMode === "original" ? originalTranscriptText : transcriptText}
            </pre>
          )}

          {transcript?.vttKey && (
            <span className={`text-[11px] text-muted block ${compact ? "px-3 pb-2" : ""}`}>
              VTT: <span className="font-mono">{transcript.vttKey}</span>
            </span>
          )}
        </div>
      )}

      {copyFeedback && (
        <p className={`text-[11px] font-medium text-muted ${compact ? "px-3 pb-2" : "mt-3"}`}>{copyFeedback}</p>
      )}
      {saveFeedback && (
        <p className={`text-[11px] font-medium text-accent-700 ${compact ? "px-3 pb-2" : "mt-2"}`}>{saveFeedback}</p>
      )}
    </div>
  );

  if (compact) return Inner;
  return <section className="workspace-card">{Inner}</section>;
}

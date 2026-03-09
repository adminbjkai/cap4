import { useMemo, useState } from "react";
import type { VideoStatusResponse } from "../lib/api";

type SummaryCardProps = {
  aiStatus: VideoStatusResponse["aiStatus"] | undefined;
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined;
  errorMessage: string | null | undefined;
  shareableResultUrl: string | null;
  chapters: Array<{ title: string; seconds: number }>;
  onJumpToSeconds: (seconds: number) => void;
  /** When true, omits the outer card wrapper — for embedding in the right rail */
  compact?: boolean;
};

type TimedKeyPoint = {
  title: string;
  jumpSeconds: number | null;
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

export function SummaryCard({ aiStatus, aiOutput, errorMessage, shareableResultUrl, chapters, onJumpToSeconds, compact = false }: SummaryCardProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const summaryForCopy = useMemo(() => {
    if (!aiOutput) return null;
    const title = aiOutput.title?.trim() ? `Title: ${aiOutput.title.trim()}` : null;
    const summary = aiOutput.summary?.trim() ? `Summary: ${aiOutput.summary.trim()}` : null;
    const points = aiOutput.keyPoints.length > 0 ? `Key points:\n${aiOutput.keyPoints.map((point) => `- ${point}`).join("\n")}` : null;
    return [title, summary, points].filter((value) => Boolean(value)).join("\n\n");
  }, [aiOutput]);

  const copyValue = async (value: string, successLabel: string, failureLabel: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(successLabel);
    } catch {
      setCopyFeedback(failureLabel);
    }
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };

  const chapterItems = useMemo<TimedKeyPoint[]>(() => {
    const usableChapters = chapters.filter((chapter) => Number.isFinite(chapter.seconds) && chapter.seconds >= 0);
    if (usableChapters.length > 0) {
      return usableChapters.map((chapter) => ({ title: chapter.title, jumpSeconds: chapter.seconds }));
    }
    if (!aiOutput) return [];
    return aiOutput.keyPoints.map((point) => ({ title: point, jumpSeconds: null }));
  }, [aiOutput, chapters]);

  const Inner = (
    <div className={compact ? "flex flex-col h-full overflow-auto" : ""}>
      {/* Header — hidden in compact/rail mode */}
      {!compact && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="workspace-label">Summary</p>
            <h2 className="workspace-title">Summary and Chapters</h2>
          </div>
          <span className="status-chip">{aiStatus ?? "not_started"}</span>
        </div>
      )}

      {/* Status messages */}
      {(aiStatus === "queued" || aiStatus === "processing") && (
        <p className={`text-sm legacy-muted ${compact ? "px-4 pt-4" : ""}`}>Summary generation is in progress.</p>
      )}
      {aiStatus === "not_started" && (
        <p className={`text-sm legacy-muted ${compact ? "px-4 pt-4" : ""}`}>Summary generation starts after transcript completion.</p>
      )}
      {aiStatus === "skipped" && (
        <p className={`panel-subtle ${compact ? "m-4" : ""}`}>Summary was skipped because transcript input was not available.</p>
      )}
      {aiStatus === "failed" && (
        <p className={`panel-danger ${compact ? "m-4" : ""}`}>
          {errorMessage ? `Summary failed: ${errorMessage}` : "Summary failed after retries."}
        </p>
      )}
      {aiStatus === "complete" && !aiOutput?.summary && !aiOutput?.title && (
        <p className={`panel-subtle ${compact ? "m-4" : ""}`}>Summary completed, but no content was returned.</p>
      )}

      {aiStatus === "complete" && aiOutput && (
        <div className={`space-y-4 ${compact ? "px-4 py-3" : ""}`}>
          {/* Copy actions */}
          <div className="flex flex-wrap gap-2">
            {summaryForCopy && (
              <button
                type="button"
                onClick={() => void copyValue(summaryForCopy, "Summary copied", "Unable to copy summary.")}
                className="btn-secondary text-xs px-2.5 py-1"
              >
                Copy summary
              </button>
            )}
          </div>

          {/* AI title (only in compact mode — full title shown in VideoPage header) */}
          {compact && aiOutput.title && (
            <h3 className="text-base font-semibold">{aiOutput.title}</h3>
          )}
          {!compact && aiOutput.title && (
            <h3 className="text-xl font-semibold">{aiOutput.title}</h3>
          )}

          {/* Summary text */}
          {aiOutput.summary && (
            <p className={`text-sm leading-relaxed ${compact ? "text-secondary" : "panel-subtle rounded-lg px-4 py-3"}`}>
              {aiOutput.summary}
            </p>
          )}

          {/* Chapter list in summary tab */}
          {chapterItems.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Chapters</p>
              <ol className="space-y-1">
                {chapterItems.map((chapter, index) => (
                  <li key={`${chapter.title}-${index}-${chapter.jumpSeconds ?? "na"}`}>
                    <button
                      type="button"
                      onClick={() => { if (chapter.jumpSeconds !== null) onJumpToSeconds(chapter.jumpSeconds); }}
                      disabled={chapter.jumpSeconds === null}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-muted disabled:opacity-60"
                    >
                      <span className="font-mono text-xs text-muted w-12 shrink-0">
                        {chapter.jumpSeconds !== null ? formatTimestamp(chapter.jumpSeconds) : "--:--"}
                      </span>
                      <span className="flex-1 text-sm leading-snug">{chapter.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {copyFeedback && <p className={`text-xs font-medium text-muted ${compact ? "px-4 pb-2" : "mt-3"}`}>{copyFeedback}</p>}
    </div>
  );

  if (compact) return Inner;
  return <section className="workspace-card">{Inner}</section>;
}

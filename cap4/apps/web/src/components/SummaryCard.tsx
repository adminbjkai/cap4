import { useMemo, useState } from "react";
import type { VideoStatusResponse } from "../lib/api";

type SummaryCardProps = {
  aiStatus: VideoStatusResponse["aiStatus"] | undefined;
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined;
  errorMessage: string | null | undefined;
  shareableResultUrl: string | null;
  chapters: Array<{ title: string; seconds: number }>;
  onJumpToSeconds: (seconds: number) => void;
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

export function SummaryCard({ aiStatus, aiOutput, errorMessage, shareableResultUrl, chapters, onJumpToSeconds }: SummaryCardProps) {
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

  return (
    <section className="workspace-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="workspace-label">Summary</p>
          <h2 className="workspace-title">Summary and Chapters</h2>
          <p className="workspace-copy">Use this editorial view for quick understanding and chapter navigation.</p>
        </div>
        <span className="status-chip">
          {aiStatus ?? "not_started"}
        </span>
      </div>

      {(aiStatus === "queued" || aiStatus === "processing") && (
        <p className="text-sm legacy-muted">Summary generation is in progress.</p>
      )}

      {aiStatus === "not_started" && (
        <p className="text-sm legacy-muted">Summary generation starts after transcript completion.</p>
      )}

      {aiStatus === "skipped" && (
        <p className="panel-subtle">
          Summary was skipped because transcript input was not available.
        </p>
      )}

      {aiStatus === "failed" && (
        <p className="panel-danger">
          {errorMessage ? `Summary failed: ${errorMessage}` : "Summary failed after retries."}
        </p>
      )}

      {aiStatus === "complete" && !aiOutput?.summary && !aiOutput?.title && (
        <p className="panel-subtle">Summary completed, but no content was returned.</p>
      )}

      {aiStatus === "complete" && aiOutput && (
        <div className="space-y-4">
          <div className="action-group">
            {summaryForCopy ? (
              <button
                type="button"
                onClick={() => void copyValue(summaryForCopy, "Summary copied", "Unable to copy summary.")}
                className="btn-secondary"
              >
                Copy summary
              </button>
            ) : null}
            {shareableResultUrl ? (
              <button
                type="button"
                onClick={() => void copyValue(shareableResultUrl, "Shareable result URL copied", "Unable to copy result URL.")}
                className="btn-tertiary"
              >
                Copy shareable result URL
              </button>
            ) : null}
          </div>

          {aiOutput.title ? <h3 className="text-xl font-semibold">{aiOutput.title}</h3> : null}
          {aiOutput.summary ? <p className="panel-subtle rounded-lg px-4 py-3 text-sm leading-relaxed">{aiOutput.summary}</p> : null}
          {chapterItems.length > 0 ? (
            <div className="chapter-list-card space-y-3 rounded-lg p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Chapters</p>
                <span className="tone-elevated rounded-full px-2 py-0.5 text-[11px] font-medium text-muted">{chapterItems.length} items</span>
              </div>
              <ol className="space-y-2">
                {chapterItems.map((chapter, index) => (
                  <li key={`${chapter.title}-${index}-${chapter.jumpSeconds ?? "na"}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (chapter.jumpSeconds !== null) onJumpToSeconds(chapter.jumpSeconds);
                      }}
                      disabled={chapter.jumpSeconds === null}
                      className="chapter-row group flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition disabled:cursor-not-allowed disabled:opacity-80"
                    >
                      {chapter.jumpSeconds !== null ? (
                        <span className="chapter-time-chip rounded px-2 py-1 font-mono text-xs">{formatTimestamp(chapter.jumpSeconds)}</span>
                      ) : (
                        <span className="chapter-time-chip rounded px-2 py-1 text-xs">No timestamp</span>
                      )}
                      <span className="flex-1 text-sm font-medium leading-snug">{chapter.title}</span>
                      <span className="text-secondary text-xs font-medium">
                        {chapter.jumpSeconds !== null ? "Jump" : "Unavailable"}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}

      {copyFeedback ? <p className="mt-3 text-xs font-medium text-muted">{copyFeedback}</p> : null}
    </section>
  );
}

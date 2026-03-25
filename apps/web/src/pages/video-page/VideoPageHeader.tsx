import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { VideoStatusResponse } from "../../lib/api";

type VideoPageHeaderProps = {
  displayTitle: string;
  isTitleEditing: boolean;
  titleDraft: string;
  isSavingTitle: boolean;
  titleSaveMessage: string | null;
  onStartTitleEdit: () => void;
  onTitleDraftChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTitleDraftKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onSaveTitle: () => void;
  onCancelTitleEdit: () => void;
  shareableResultUrl: string | null;
  videoUrl: string | null;
  onCopyUrl: () => void;
  onRefresh: () => void;
  loading: boolean;
  onOpenDeleteDialog: () => void;
  isProcessing: boolean;
  processingPhase: VideoStatusResponse["processingPhase"] | undefined;
  processingProgress: number | null | undefined;
  lastUpdatedAt: string | null;
  errorMessage: string | null;
  copyFeedback: string | null;
  showRetryButton: boolean;
  isRetrying: boolean;
  retryMessage: string | null;
  onRetry: () => void;
  jobStatusLabel: string | null;
};

export function VideoPageHeader({
  displayTitle,
  isTitleEditing,
  titleDraft,
  isSavingTitle,
  titleSaveMessage,
  onStartTitleEdit,
  onTitleDraftChange,
  onTitleDraftKeyDown,
  onSaveTitle,
  onCancelTitleEdit,
  shareableResultUrl,
  videoUrl,
  onCopyUrl,
  onRefresh,
  loading,
  onOpenDeleteDialog,
  isProcessing,
  processingPhase,
  processingProgress,
  lastUpdatedAt,
  errorMessage,
  copyFeedback,
  showRetryButton,
  isRetrying,
  retryMessage,
  onRetry,
  jobStatusLabel,
}: VideoPageHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {!isTitleEditing ? (
            <div className="flex flex-wrap items-baseline gap-2">
              <h1
                className="truncate text-xl font-bold tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {displayTitle}
              </h1>
              <button
                type="button"
                onClick={onStartTitleEdit}
                className="text-[11px] transition-colors"
                style={{ color: "var(--text-muted)" }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.color = "var(--text-secondary)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                Edit
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                value={titleDraft}
                onChange={onTitleDraftChange}
                onKeyDown={onTitleDraftKeyDown}
                autoFocus
                aria-label="Edit title"
                className="input-control max-w-md w-full text-base font-bold"
              />
              <button
                type="button"
                onClick={onSaveTitle}
                disabled={isSavingTitle}
                className="btn-primary px-2.5 py-1 text-xs"
              >
                {isSavingTitle ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={onCancelTitleEdit}
                disabled={isSavingTitle}
                className="btn-secondary px-2.5 py-1 text-xs"
              >
                Cancel
              </button>
            </div>
          )}
          {titleSaveMessage && (
            <p
              className={`mt-0.5 text-xs font-medium ${
                titleSaveMessage.includes("Unable") || titleSaveMessage.includes("cannot")
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {titleSaveMessage}
            </p>
          )}

          <div
            className="mt-1 flex flex-wrap items-center gap-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            {isProcessing && (
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="h-1.5 w-1.5 rounded-full animate-pulse"
                  style={{ background: "var(--accent-blue)" }}
                />
                Processing
              </span>
            )}
            {!isProcessing && processingPhase === "complete" && (
              <span className="inline-flex items-center gap-1 status-chip-success">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Complete
              </span>
            )}
            {processingPhase === "failed" && (
              <span className="status-chip status-chip-danger">Failed</span>
            )}
            {lastUpdatedAt && <span>Updated {new Date(lastUpdatedAt).toLocaleTimeString()}</span>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {shareableResultUrl && (
            <div
              className="flex max-w-[200px] items-center gap-1 overflow-hidden rounded-md border px-2 py-1"
              style={{
                borderColor: "var(--border-default)",
                background: "var(--bg-surface-subtle)",
              }}
            >
              <span className="truncate font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                {shareableResultUrl.replace(/^https?:\/\//, "")}
              </span>
              <button
                type="button"
                onClick={onCopyUrl}
                className="shrink-0 transition-colors"
                style={{ color: "var(--text-muted)" }}
                title="Copy URL"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                </svg>
              </button>
            </div>
          )}
          {videoUrl && (
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary flex items-center gap-1 px-2.5 py-1 text-xs"
              title="Download video"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Download
            </a>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="btn-secondary p-1.5"
            title="Refresh status"
          >
            <svg
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onOpenDeleteDialog}
            className="btn-secondary px-2.5 py-1 text-xs"
            style={{ color: "var(--danger-text)" }}
          >
            Delete
          </button>
        </div>
      </div>

      {isProcessing && processingPhase && (
        <div
          className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-1.5"
          style={{
            borderColor: "var(--accent-blue-border)",
            background: "var(--accent-blue-subtle)",
          }}
        >
          <div className="h-1 flex-1 rounded-full" style={{ background: "var(--bg-surface-muted)" }}>
            <div
              className="progress-active-bar h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(5, processingProgress ?? 0)}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-medium" style={{ color: "var(--accent-blue)" }}>
            {processingProgress != null ? `${processingProgress}%` : processingPhase}
          </span>
        </div>
      )}

      {errorMessage && <p className="panel-warning mt-2 text-xs">{errorMessage}</p>}
      {copyFeedback && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {copyFeedback}
        </p>
      )}

      {showRetryButton && (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="btn-primary flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            <svg
              className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {isRetrying ? "Retrying…" : "Retry processing"}
          </button>
          {retryMessage && (
            <span
              className={`text-xs font-medium ${
                retryMessage.includes("Failed") || retryMessage.includes("failed")
                  ? "text-red-600"
                  : "text-green-600"
              }`}
            >
              {retryMessage}
            </span>
          )}
        </div>
      )}

      {jobStatusLabel ? <p className="sr-only">Queue status: {jobStatusLabel}</p> : null}
    </div>
  );
}

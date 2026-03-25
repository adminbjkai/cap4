type ConfidenceStats = {
  percentage: number;
  total: number;
  highCount: number;
} | null;

export function TranscriptControls({
  compact,
  isEditing,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
  searchMatchesCount,
  activeMatchIndex,
  textViewMode,
  onSetTextViewMode,
  onCopy,
  onEdit,
  confidenceStats,
  uncertainSegmentsCount,
  isReviewMode,
  reviewIndex,
  onToggleReviewMode,
  onNavigateReview,
  speakerIds,
  hiddenSpeakers,
  getSpeakerLabel,
  onToggleSpeakerVisibility,
  speakerColor,
  speakerSaveError,
}: {
  compact: boolean;
  isEditing: boolean;
  searchInputRef: { current: HTMLInputElement | null };
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onClearSearch: () => void;
  searchMatchesCount: number;
  activeMatchIndex: number;
  textViewMode: "current" | "original";
  onSetTextViewMode: (mode: "current" | "original") => void;
  onCopy: () => void;
  onEdit: () => void;
  confidenceStats: ConfidenceStats;
  uncertainSegmentsCount: number;
  isReviewMode: boolean;
  reviewIndex: number;
  onToggleReviewMode: () => void;
  onNavigateReview: (direction: "prev" | "next") => void;
  speakerIds: number[];
  hiddenSpeakers: Set<number>;
  getSpeakerLabel: (speaker: number) => string | null;
  onToggleSpeakerVisibility: (speaker: number) => void;
  speakerColor: (speaker: number) => string;
  speakerSaveError: string | null;
}) {
  return (
    <>
      {!isEditing && (
        <div className={`flex items-center gap-1.5 ${compact ? "px-2.5 py-2" : "px-3 py-2"}`}>
          <div
            className="flex-1 flex items-center gap-1.5 bg-surface-subtle rounded-md border px-2 py-1.5"
            style={{ borderColor: "var(--border-default)" }}
          >
            <svg
              className="h-3.5 w-3.5 flex-shrink-0"
              style={{ color: "var(--text-muted)" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search transcript…"
              className="flex-1 bg-transparent text-[13px] outline-none"
              style={{ color: "var(--text-primary)" }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={onClearSearch}
                className="text-[13px] font-medium"
                style={{ color: "var(--text-muted)" }}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {searchQuery && (
            <span
              className="text-[11px] font-medium whitespace-nowrap"
              style={{ color: "var(--text-secondary)" }}
            >
              {searchMatchesCount === 0 ? "No matches" : `${activeMatchIndex + 1}/${searchMatchesCount}`}
            </span>
          )}
        </div>
      )}

      <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "px-2.5 py-2 border-b" : "mb-3"}`}>
        <div className="pill-toggle">
          <button
            type="button"
            onClick={() => onSetTextViewMode("current")}
            className={`pill-toggle-btn ${textViewMode === "current" ? "pill-toggle-btn-active" : ""}`}
            aria-pressed={textViewMode === "current"}
          >
            Current
          </button>
          <button
            type="button"
            onClick={() => onSetTextViewMode("original")}
            className={`pill-toggle-btn ${textViewMode === "original" ? "pill-toggle-btn-active" : ""}`}
            aria-pressed={textViewMode === "original"}
          >
            Original
          </button>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="btn-secondary text-[11px] px-2 py-0.5"
        >
          Copy
        </button>
        {!isEditing && (
          <button
            type="button"
            onClick={onEdit}
            className="btn-secondary text-[11px] px-2 py-0.5"
          >
            Edit
          </button>
        )}
        {confidenceStats && (
          <span
            className="confidence-badge"
            title={`${confidenceStats.highCount}/${confidenceStats.total} segments with ≥80% confidence`}
          >
            {confidenceStats.percentage}% high confidence
          </span>
        )}
        {uncertainSegmentsCount > 0 && !isEditing && (
          <button
            type="button"
            onClick={onToggleReviewMode}
            className={`btn-secondary text-[11px] px-2 py-0.5 ${isReviewMode ? "!bg-amber-50 !border-amber-300 !text-amber-900" : ""}`}
            title={`${uncertainSegmentsCount} uncertain segments (<80% confidence)`}
          >
            {isReviewMode
              ? `Reviewing (${reviewIndex + 1}/${uncertainSegmentsCount})`
              : "Review uncertain"}
          </button>
        )}
        {isReviewMode && uncertainSegmentsCount > 1 && (
          <>
            <button
              type="button"
              onClick={() => onNavigateReview("prev")}
              className="btn-secondary text-[11px] px-2 py-0.5"
              title="Previous uncertain segment"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              onClick={() => onNavigateReview("next")}
              className="btn-secondary text-[11px] px-2 py-0.5"
              title="Next uncertain segment"
            >
              Next ›
            </button>
          </>
        )}
      </div>

      {speakerIds.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "px-2.5 pb-2" : "mb-3"}`}>
          <span className="text-[11px] font-medium text-muted">Speakers:</span>
          {speakerIds.map((speaker) => {
            const isHidden = hiddenSpeakers.has(speaker);
            return (
              <button
                key={`speaker-filter-${speaker}`}
                type="button"
                onClick={() => onToggleSpeakerVisibility(speaker)}
                className={`speaker-filter-chip ${isHidden ? "speaker-filter-chip-hidden" : ""}`}
                style={{
                  borderColor: speakerColor(speaker),
                  color: isHidden ? "var(--text-muted)" : speakerColor(speaker),
                }}
                title={isHidden ? "Show speaker" : "Hide speaker"}
              >
                {getSpeakerLabel(speaker)}
              </button>
            );
          })}
        </div>
      )}

      {speakerSaveError && (
        <p className={`text-[11px] text-red-700 ${compact ? "px-2.5 pb-2" : "mb-3"}`}>
          {speakerSaveError}
        </p>
      )}
    </>
  );
}

import { useMemo } from "react";

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

export function ChapterList({
  chapters,
  currentSeconds,
  durationSeconds,
  onSeek,
  title = "Chapters",
  inline = false
}: {
  chapters: ChapterItem[];
  currentSeconds: number;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
  title?: string;
  /** When true, renders as a plain flat list without the card wrapper (for use in VideoPage below-the-fold) */
  inline?: boolean;
}) {
  const validChapters = useMemo(() => {
    if (durationSeconds <= 0) return chapters;
    return chapters.filter((c) => c.seconds >= 0 && c.seconds <= durationSeconds);
  }, [chapters, durationSeconds]);

  const activeIndex = useMemo(() => {
    if (validChapters.length === 0) return -1;
    let active = 0;
    for (let i = 0; i < validChapters.length; i++) {
      if (validChapters[i]!.seconds <= currentSeconds + 0.1) {
        active = i;
      } else {
        break;
      }
    }
    return active;
  }, [validChapters, currentSeconds]);

  if (validChapters.length === 0) {
    if (inline) return null;
    return (
      <div className="workspace-card h-full">
        <div className="mb-3">
          <p className="workspace-label">Navigation</p>
          <h3 className="workspace-title">{title}</h3>
        </div>
        <p className="panel-subtle rounded-md border-dashed px-3 py-4 text-sm text-center">
          No chapters available for this video.
        </p>
      </div>
    );
  }

  /* ── Inline mode: Cap-style clean table ───────────────────────── */
  if (inline) {
    return (
      <div className="divide-y divide-default rounded-xl border">
        {validChapters.map((chapter, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${chapter.title}-${index}-${chapter.seconds}`}
              type="button"
              onClick={() => onSeek(chapter.seconds)}
              className={`w-full flex items-center gap-4 px-4 py-2 text-left transition-colors hover:bg-surface-muted ${
                isActive ? "bg-surface-muted" : ""
              }`}
            >
              <span className={`font-mono text-[11px] w-10 shrink-0 ${isActive ? "font-semibold text-foreground" : "text-muted"}`}>
                {formatTimestamp(chapter.seconds)}
              </span>
              <span className={`text-[13px] flex-1 leading-snug ${isActive ? "font-medium text-foreground" : "text-secondary"}`}>
                {chapter.title}
              </span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--accent-blue)" }} />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  /* ── Sidebar mode: original card style ────────────────────────── */
  return (
    <div className="workspace-card h-full flex flex-col">
      <div className="mb-3">
        <p className="workspace-label">Navigation</p>
        <h3 className="workspace-title">{title}</h3>
        <p className="workspace-copy">Click a chapter to jump to that section.</p>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0 max-h-[400px] space-y-1 pr-1">
        {validChapters.map((chapter, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${chapter.title}-${index}-${chapter.seconds}`}
              type="button"
              onClick={() => onSeek(chapter.seconds)}
              className={`w-full text-left p-2.5 rounded-lg transition-all duration-200 group ${
                isActive
                  ? "chapter-row-active border"
                  : "hover:bg-surface-muted border border-transparent"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="font-mono text-xs font-medium whitespace-nowrap mt-0.5"
                      style={{ color: isActive ? "var(--accent-blue)" : "var(--text-muted)" }}>
                  {formatTimestamp(chapter.seconds)}
                </span>
                <span className="text-sm leading-snug"
                      style={{ color: "var(--text-secondary)", fontWeight: isActive ? 500 : 400 }}>
                  {chapter.title}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-default">
        <p className="text-xs text-muted text-center">
          {activeIndex >= 0 ? (
            <>Chapter <span className="font-medium">{activeIndex + 1}</span> of <span className="font-medium">{validChapters.length}</span></>
          ) : (
            <>Select a chapter to navigate</>
          )}
        </p>
      </div>
    </div>
  );
}

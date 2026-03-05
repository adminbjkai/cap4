import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { getLibraryVideos, type LibraryVideoCard } from "../lib/api";
import { buildPublicObjectUrl, formatDuration } from "../lib/format";
import { loadRecentSessions } from "../lib/sessions";

export function HomePage() {
  const sessions = useMemo(() => loadRecentSessions(), []);
  const [libraryItems, setLibraryItems] = useState<LibraryVideoCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const phaseLabel = (phase?: string | null) => {
    const labels: Record<string, string> = {
      queued: "Queued",
      downloading: "Downloading",
      probing: "Probing",
      processing: "Processing",
      uploading: "Uploading",
      generating_thumbnail: "Thumbnail",
      complete: "Complete",
      failed: "Failed",
      cancelled: "Cancelled"
    };
    return phase ? labels[phase] ?? phase : "Queued";
  };
  const dateLabel = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  useEffect(() => {
    const load = async () => {
      setLoadingLibrary(true);
      setLibraryError(null);
      try {
        const response = await getLibraryVideos({ limit: 18, sort: "created_desc" });
        setLibraryItems(response.items);
        setNextCursor(response.nextCursor);
      } catch (error) {
        setLibraryError(error instanceof Error ? error.message : "Unable to load global library.");
      } finally {
        setLoadingLibrary(false);
      }
    };
    void load();
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingLibrary) return;
    setLoadingLibrary(true);
    try {
      const response = await getLibraryVideos({ cursor: nextCursor, limit: 18, sort: "created_desc" });
      setLibraryItems((current) => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Unable to load more items.");
    } finally {
      setLoadingLibrary(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="workspace-card">
        <p className="workspace-label">Workspace</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Record, process, and share</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 legacy-muted">
          Start a screen recording with microphone audio, upload it, and follow processing until the result is ready.
        </p>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link to="/record" className="btn-primary px-4 py-2">New recording</Link>
          <Link to="/record" className="btn-secondary px-4 py-2">Upload file</Link>
        </div>
      </section>

      <section className="workspace-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Library</h2>
          <button
            type="button"
            onClick={() => {
              setNextCursor(null);
              setLibraryItems([]);
              setLoadingLibrary(true);
              setLibraryError(null);
              void getLibraryVideos({ limit: 18, sort: "created_desc" })
                .then((response) => {
                  setLibraryItems(response.items);
                  setNextCursor(response.nextCursor);
                })
                .catch((error) => setLibraryError(error instanceof Error ? error.message : "Unable to refresh library."))
                .finally(() => setLoadingLibrary(false));
            }}
            className="btn-secondary px-3 py-1.5"
          >
            Refresh
          </button>
        </div>
        <p className="mt-1 text-sm legacy-muted">Global library sourced from server state across sessions and devices.</p>

        {loadingLibrary && libraryItems.length === 0 ? (
          <div className="panel-subtle mt-4 text-sm">Loading library…</div>
        ) : null}

        {libraryError ? (
          <div className="panel-danger mt-4">{libraryError}</div>
        ) : null}

        {!loadingLibrary && libraryItems.length === 0 && !libraryError ? (
          <div className="panel-subtle mt-3 border-dashed">
            <p className="text-sm font-medium">No videos in global library yet.</p>
            <p className="mt-1 text-sm legacy-muted">Start a new recording to create your first processed video.</p>
            <Link to="/record" className="btn-secondary mt-3 inline-flex px-3 py-1.5">Go to recorder</Link>
          </div>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {libraryItems.map((item) => (
              <li key={item.videoId} className="workspace-card p-3">
                <div className="flex gap-3">
                  <div className="tone-border tone-surface-muted h-16 w-24 shrink-0 overflow-hidden rounded-md border">
                    {item.thumbnailKey ? (
                      <img src={buildPublicObjectUrl(item.thumbnailKey)} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[11px] text-muted">No preview</div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.displayTitle}</p>
                    <p className="mt-1 text-xs text-muted">
                      {dateLabel(item.createdAt)} · {item.durationSeconds !== null ? formatDuration(item.durationSeconds) : "--:--"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="status-chip">P: {phaseLabel(item.processingPhase)}</span>
                      <span className="status-chip">T: {item.transcriptionStatus}</span>
                      <span className="status-chip">AI: {item.aiStatus}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted">{item.hasResult ? "Result ready" : "Processing"}</span>
                  <Link to={`/video/${item.videoId}`} className="btn-secondary px-3 py-1.5 text-sm">Open</Link>
                </div>
              </li>
            ))}
          </ul>
        )}

        {nextCursor ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingLibrary}
              className="btn-secondary px-3 py-1.5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loadingLibrary ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </section>

      <section className="workspace-card p-5">
        <h2 className="text-base font-semibold">Local session cache (secondary)</h2>
        <p className="mt-1 text-sm legacy-muted">This local list is de-emphasized and no longer the primary library source.</p>

        {sessions.length === 0 ? (
          <p className="mt-3 text-sm legacy-muted">No local sessions in this browser.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {sessions.slice(0, 5).map((session) => (
              <li key={session.videoId} className="panel-subtle">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{session.videoId}</p>
                    <p className="text-xs text-muted">
                      {new Date(session.createdAt).toLocaleString()} · {phaseLabel(session.processingPhase)} · {session.processingProgress ?? 0}%
                    </p>
                  </div>
                  <Link to={`/video/${session.videoId}${session.jobId ? `?jobId=${session.jobId}` : ""}`} className="btn-secondary px-3 py-1.5 text-sm">Open</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

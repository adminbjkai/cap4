import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  deleteVideo,
  getLibraryVideos,
  getSystemProviderStatus,
  type LibraryVideoCard,
  type ProviderStatusResponse,
} from '../lib/api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ProviderStatusPanel } from '../components/ProviderStatusPanel';
import { buildPublicObjectUrl, formatDuration } from '../lib/format';

type LibrarySort = 'date_desc' | 'name_asc' | 'duration_desc';
type LibraryFilter = 'all' | 'processing' | 'complete' | 'failed';

export function HomePage() {
  const [libraryItems, setLibraryItems] = useState<LibraryVideoCard[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [loadingProviderStatus, setLoadingProviderStatus] = useState(false);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryVideoCard | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<LibrarySort>('date_desc');
  const [filterBy, setFilterBy] = useState<LibraryFilter>('all');
  const [deletingVideoIds, setDeletingVideoIds] = useState<string[]>([]);
  const loadingSkeletonCount = 8;

  const phaseLabel = (phase?: string | null) => {
    const labels: Record<string, string> = {
      queued: 'Queued',
      downloading: 'Downloading',
      probing: 'Probing',
      processing: 'Processing',
      uploading: 'Uploading',
      generating_thumbnail: 'Thumbnail',
      complete: 'Complete',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };
    return phase ? (labels[phase] ?? phase) : 'Queued';
  };

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  const phaseBucket = (phase?: string | null): LibraryFilter => {
    if (
      !phase ||
      phase === 'queued' ||
      phase === 'downloading' ||
      phase === 'probing' ||
      phase === 'processing' ||
      phase === 'uploading' ||
      phase === 'generating_thumbnail'
    ) {
      return 'processing';
    }
    if (phase === 'complete') return 'complete';
    if (phase === 'failed' || phase === 'cancelled') return 'failed';
    return 'processing';
  };

  const refreshLibrary = async () => {
    setLoadingLibrary(true);
    setLibraryError(null);
    try {
      const response = await getLibraryVideos({ limit: 20, sort: 'created_desc' });
      setLibraryItems(response.items);
      setNextCursor(response.nextCursor);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : 'Unable to load library.');
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    void refreshLibrary();
    const loadStatus = async () => {
      setLoadingProviderStatus(true);
      try {
        setProviderStatus(await getSystemProviderStatus());
      } catch {
        setProviderStatusError('Status check failed');
      } finally {
        setLoadingProviderStatus(false);
      }
    };
    void loadStatus();
  }, []);

  const loadMore = async () => {
    if (!nextCursor || loadingLibrary) return;
    setLoadingLibrary(true);
    try {
      const response = await getLibraryVideos({
        cursor: nextCursor,
        limit: 20,
        sort: 'created_desc',
      });
      setLibraryItems(current => [...current, ...response.items]);
      setNextCursor(response.nextCursor);
    } catch {
      setLibraryError('Unable to load more items.');
    } finally {
      setLoadingLibrary(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteVideo(deleteTarget.videoId);
      const removedId = deleteTarget.videoId;
      setDeletingVideoIds(current => [...current, removedId]);
      window.setTimeout(() => {
        setLibraryItems(current => current.filter(i => i.videoId !== removedId));
        setDeletingVideoIds(current => current.filter(id => id !== removedId));
      }, 200);
      setDeleteTarget(null);
    } catch {
      setDeleteError('Delete failed');
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredItems = libraryItems.filter(item =>
    filterBy === 'all' ? true : phaseBucket(item.processingPhase) === filterBy
  );
  const visibleItems = [...filteredItems].sort((a, b) => {
    if (sortBy === 'name_asc') return a.displayTitle.localeCompare(b.displayTitle);
    if (sortBy === 'duration_desc') return (b.durationSeconds ?? -1) - (a.durationSeconds ?? -1);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete video?"
        message={`Delete "${deleteTarget?.displayTitle ?? 'this video'}"? This action cannot be undone.`}
        confirmLabel="Delete"
        busy={isDeleting}
        errorMessage={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Your Videos</h1>
          <p className="text-sm text-secondary mt-1">
            Manage, review, and share your screen recordings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/record" className="btn-secondary">
            Upload
          </Link>
          <Link to="/record" className="btn-primary">
            New Recording
          </Link>
        </div>
      </header>

      <ProviderStatusPanel
        data={providerStatus}
        loading={loadingProviderStatus}
        errorMessage={providerStatusError}
      />

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold px-1">Library</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Sort library"
              value={sortBy}
              onChange={event => setSortBy(event.target.value as LibrarySort)}
              className="input-control h-9 w-auto min-w-[10rem] px-3 py-1.5 text-xs font-semibold"
            >
              <option value="date_desc">Date (Newest)</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="duration_desc">Duration (Longest)</option>
            </select>
            <select
              aria-label="Filter library"
              value={filterBy}
              onChange={event => setFilterBy(event.target.value as LibraryFilter)}
              className="input-control h-9 w-auto min-w-[10rem] px-3 py-1.5 text-xs font-semibold"
            >
              <option value="all">All Statuses</option>
              <option value="processing">Processing</option>
              <option value="complete">Complete</option>
              <option value="failed">Failed</option>
            </select>
            <button
              onClick={() => void refreshLibrary()}
              className="text-xs font-medium hover:underline text-muted"
            >
              {loadingLibrary ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {libraryError && <div className="panel-danger mb-4">{libraryError}</div>}

        {loadingLibrary && libraryItems.length === 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: loadingSkeletonCount }).map((_, index) => (
              <div
                key={`library-skeleton-${index}`}
                className="library-card-reveal overflow-hidden rounded-xl border border-default bg-surface"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="skeleton-block aspect-video w-full" />
                <div className="space-y-2 p-4">
                  <div className="skeleton-block h-3 w-4/5 rounded-md" />
                  <div className="skeleton-block h-2.5 w-2/5 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : !loadingLibrary && libraryItems.length === 0 && !libraryError ? (
          <div className="panel-subtle border-dashed flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted">
              <svg
                className="h-6 w-6 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h3 className="font-semibold">No videos yet</h3>
            <p className="mt-1 max-w-xs text-sm text-muted">
              Record or upload your first clip to start building your library.
            </p>
            <Link to="/record" className="btn-primary mt-6">
              Create first recording
            </Link>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="panel-subtle border-dashed py-10 text-center">
            <p className="text-sm text-muted">No videos match the selected filter.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {visibleItems.map((item, index) => (
              <div
                key={item.videoId}
                className={`library-card-reveal hover-action-container group relative flex flex-col overflow-hidden rounded-xl border border-default bg-surface transition-all ${
                  deletingVideoIds.includes(item.videoId)
                    ? 'library-card-deleting'
                    : 'hover:-translate-y-1 hover:scale-[1.03] hover:border-strong hover:shadow-2xl'
                } ${phaseBucket(item.processingPhase) === 'processing' ? 'library-card-processing' : ''}`}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Link
                  to={`/video/${item.videoId}`}
                  className="relative aspect-video w-full overflow-hidden bg-surface-muted"
                >
                  {item.thumbnailKey ? (
                    <img
                      src={buildPublicObjectUrl(item.thumbnailKey)}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[10px] font-bold uppercase tracking-tighter text-muted">
                      No Preview
                    </div>
                  )}
                  {item.thumbnailKey ? (
                    <>
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 via-black/35 to-transparent" />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-xl backdrop-blur-sm">
                          <svg
                            className="h-6 w-6 translate-x-[1px]"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </span>
                      </div>
                    </>
                  ) : null}
                  {item.durationSeconds && (
                    <div className="absolute right-2 top-2 rounded-full border border-white/20 bg-black/55 px-2 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                      {formatDuration(item.durationSeconds)}
                    </div>
                  )}
                </Link>

                <div className="relative z-10 -mt-10 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className={`truncate text-sm font-bold leading-none ${
                        item.thumbnailKey ? 'text-white drop-shadow-sm' : 'text-foreground'
                      }`}
                    >
                      {item.displayTitle}
                    </h3>
                    <span
                      className={`status-chip ${
                        phaseBucket(item.processingPhase) === 'complete'
                          ? 'status-chip-success'
                          : phaseBucket(item.processingPhase) === 'failed'
                            ? 'status-chip-failed'
                            : 'status-chip-processing'
                      }`}
                    >
                      {phaseLabel(item.processingPhase)}
                    </span>
                  </div>
                  <p className="mt-2 text-[10px] font-medium text-muted uppercase tracking-wider">
                    {dateLabel(item.createdAt)}
                  </p>
                </div>

                {/* Hover Actions Overlay */}
                <div className="hover-action absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between border-t border-default bg-surface/90 p-2 backdrop-blur-md">
                  <button
                    onClick={e => {
                      e.preventDefault();
                      setDeleteTarget(item);
                    }}
                    className="destructive-icon-btn"
                    aria-label={`Delete ${item.displayTitle}`}
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                  <Link to={`/video/${item.videoId}`} className="btn-primary h-8 px-3 text-xs">
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="mt-12 flex justify-center">
            <button
              onClick={() => void loadMore()}
              disabled={loadingLibrary}
              className="btn-secondary px-8"
            >
              {loadingLibrary ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

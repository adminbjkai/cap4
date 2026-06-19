import { Link, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteVideo,
  getLibraryVideos,
  getSystemProviderStatus,
  type LibraryVideoCard,
  type ProviderStatusResponse,
} from '../lib/api';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { ProviderStatusPanel } from '../components/ProviderStatusPanel';
import { buildPublicObjectUrl, formatDate, formatDateTimeEST, formatDuration } from '../lib/format';

type SortKey = 'created' | 'title' | 'duration' | 'originalFile' | 'status' | 'note';
type SortDir = 'asc' | 'desc';
type SortState = { key: SortKey; dir: SortDir };
type LibraryFilter = 'all' | 'processing' | 'complete' | 'failed';
type LibraryView = 'grid' | 'list';
type ColumnId = 'thumbnail' | 'title' | 'status' | 'duration' | 'created' | 'originalFile' | 'note';

const VIEW_STORAGE_KEY = 'cap4:libraryView';
const COLUMNS_STORAGE_KEY = 'cap4:libraryColumns';
const noteStorageKey = (videoId: string) => `cap4:notes:${videoId}`;

const DEFAULT_COLUMN_ORDER: ColumnId[] = [
  'thumbnail',
  'title',
  'status',
  'duration',
  'created',
  'originalFile',
  'note',
];

const COLUMN_META: Record<
  ColumnId,
  { label: string; sortable: boolean; sortKey?: SortKey; filterable: boolean; canHide: boolean; align?: 'right' }
> = {
  thumbnail: { label: '', sortable: false, filterable: false, canHide: true },
  title: { label: 'Title', sortable: true, sortKey: 'title', filterable: true, canHide: false },
  status: { label: 'Status', sortable: true, sortKey: 'status', filterable: true, canHide: true },
  duration: { label: 'Duration', sortable: true, sortKey: 'duration', filterable: true, canHide: true, align: 'right' },
  created: { label: 'Uploaded (EST)', sortable: true, sortKey: 'created', filterable: true, canHide: true },
  originalFile: { label: 'File created (EST)', sortable: true, sortKey: 'originalFile', filterable: true, canHide: true },
  note: { label: 'Note', sortable: true, sortKey: 'note', filterable: true, canHide: true },
};

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

// Display text used for per-column filtering (and for the grid card).
function cellText(item: LibraryVideoCard, col: ColumnId, notes: Record<string, string>): string {
  switch (col) {
    case 'title':
      return item.displayTitle;
    case 'status':
      return phaseLabel(item.processingPhase);
    case 'duration':
      return item.durationSeconds ? formatDuration(item.durationSeconds) : '';
    case 'created':
      return formatDateTimeEST(item.createdAt);
    case 'originalFile':
      return formatDateTimeEST(item.originalFileCreatedAt);
    case 'note':
      return notes[item.videoId] ?? '';
    default:
      return '';
  }
}

function compareRows(
  a: LibraryVideoCard,
  b: LibraryVideoCard,
  sort: SortState,
  notes: Record<string, string>,
): number {
  const mult = sort.dir === 'asc' ? 1 : -1;
  switch (sort.key) {
    case 'title':
      return mult * a.displayTitle.localeCompare(b.displayTitle);
    case 'duration':
      return mult * ((a.durationSeconds ?? -1) - (b.durationSeconds ?? -1));
    case 'status':
      return mult * phaseBucket(a.processingPhase).localeCompare(phaseBucket(b.processingPhase));
    case 'note': {
      const av = (notes[a.videoId] ?? '').toLowerCase();
      const bv = (notes[b.videoId] ?? '').toLowerCase();
      if (!av && !bv) return 0;
      if (!av) return 1; // empties always last
      if (!bv) return -1;
      return mult * av.localeCompare(bv);
    }
    case 'originalFile': {
      const av = a.originalFileCreatedAt ? new Date(a.originalFileCreatedAt).getTime() : null;
      const bv = b.originalFileCreatedAt ? new Date(b.originalFileCreatedAt).getTime() : null;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return mult * (av - bv);
    }
    case 'created':
    default:
      return mult * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
}

function loadColumnConfig(): { order: ColumnId[]; hidden: ColumnId[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY) || '{}');
    const savedOrder: ColumnId[] = Array.isArray(raw.order)
      ? raw.order.filter((c: ColumnId) => DEFAULT_COLUMN_ORDER.includes(c))
      : [];
    // Append any columns not present in the saved order (handles new columns).
    const order = [...savedOrder, ...DEFAULT_COLUMN_ORDER.filter(c => !savedOrder.includes(c))];
    const hidden: ColumnId[] = Array.isArray(raw.hidden)
      ? raw.hidden.filter((c: ColumnId) => DEFAULT_COLUMN_ORDER.includes(c) && COLUMN_META[c as ColumnId].canHide)
      : [];
    return { order, hidden };
  } catch {
    return { order: [...DEFAULT_COLUMN_ORDER], hidden: [] };
  }
}

export function HomePage() {
  const navigate = useNavigate();
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
  const [sort, setSort] = useState<SortState>({ key: 'created', dir: 'desc' });
  const [filterBy, setFilterBy] = useState<LibraryFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingVideoIds, setDeletingVideoIds] = useState<string[]>([]);
  const [view, setView] = useState<LibraryView>(() => {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const loadingSkeletonCount = 8;

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [view]);

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

  const toggleSort = useCallback((key: SortKey) => {
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'title' || key === 'status' || key === 'note' ? 'asc' : 'desc' }
    );
  }, []);

  const clearGlobalFilters = useCallback(() => {
    setSearchQuery('');
    setFilterBy('all');
  }, []);

  // Items filtered by the global search + status (shared across both views).
  const baseItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return libraryItems.filter(item => {
      const matchesFilter = filterBy === 'all' ? true : phaseBucket(item.processingPhase) === filterBy;
      const matchesSearch = q === '' ? true : item.displayTitle.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [libraryItems, filterBy, searchQuery]);

  // Grid view sorts here; list view delegates sorting (incl. notes) to the table.
  const gridItems = useMemo(() => [...baseItems].sort((a, b) => compareRows(a, b, sort, {})), [baseItems, sort]);

  const hasItems = libraryItems.length > 0;
  const hasGlobalFilters = searchQuery.trim() !== '' || filterBy !== 'all';

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
            <div className="library-view-toggle" role="group" aria-label="Library view">
              <button
                type="button"
                onClick={() => setView('grid')}
                className={`library-view-button ${view === 'grid' ? 'library-view-button-active' : ''}`}
                aria-pressed={view === 'grid'}
                title="Grid view"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span className="sr-only">Grid view</span>
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className={`library-view-button ${view === 'list' ? 'library-view-button-active' : ''}`}
                aria-pressed={view === 'list'}
                title="List view"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                <span className="sr-only">List view</span>
              </button>
            </div>

            <input
              type="search"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="Search titles…"
              aria-label="Search library by title"
              className="input-control h-9 w-44 px-3 py-1.5 text-xs"
            />

            <select
              aria-label="Sort library"
              value={`${sort.key}_${sort.dir}`}
              onChange={event => {
                const [key, dir] = event.target.value.split('_') as [SortKey, SortDir];
                setSort({ key, dir });
              }}
              className="input-control h-9 w-auto min-w-[10rem] px-3 py-1.5 text-xs font-semibold"
            >
              <option value="created_desc">Uploaded (Newest)</option>
              <option value="created_asc">Uploaded (Oldest)</option>
              <option value="originalFile_desc">File date (Newest)</option>
              <option value="originalFile_asc">File date (Oldest)</option>
              <option value="title_asc">Name (A–Z)</option>
              <option value="title_desc">Name (Z–A)</option>
              <option value="duration_desc">Duration (Longest)</option>
              <option value="duration_asc">Duration (Shortest)</option>
              <option value="status_asc">Status</option>
            </select>
            <select
              aria-label="Filter library"
              value={filterBy}
              onChange={event => setFilterBy(event.target.value as LibraryFilter)}
              className="input-control h-9 w-auto min-w-[9rem] px-3 py-1.5 text-xs font-semibold"
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

        {loadingLibrary && !hasItems ? (
          view === 'list' ? (
            <div className="space-y-2">
              {Array.from({ length: loadingSkeletonCount }).map((_, index) => (
                <div
                  key={`library-row-skeleton-${index}`}
                  className="library-card-reveal flex items-center gap-4 rounded-lg border border-default bg-surface p-3"
                  style={{ animationDelay: `${index * 40}ms` }}
                >
                  <div className="skeleton-block h-10 w-16 rounded-md" />
                  <div className="skeleton-block h-3 flex-1 rounded-md" />
                  <div className="skeleton-block h-3 w-20 rounded-md" />
                  <div className="skeleton-block h-3 w-20 rounded-md" />
                </div>
              ))}
            </div>
          ) : (
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
          )
        ) : !loadingLibrary && !hasItems && !libraryError ? (
          <div className="panel-subtle border-dashed flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted">
              <svg className="h-6 w-6 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
        ) : view === 'list' ? (
          <LibraryTable
            items={baseItems}
            deletingVideoIds={deletingVideoIds}
            sort={sort}
            onToggleSort={toggleSort}
            onOpen={videoId => navigate(`/video/${videoId}`)}
            onRequestDelete={setDeleteTarget}
            hasGlobalFilters={hasGlobalFilters}
            onClearGlobalFilters={clearGlobalFilters}
          />
        ) : gridItems.length === 0 ? (
          <div className="panel-subtle border-dashed py-10 text-center">
            <p className="text-sm text-muted">No videos match the selected filter.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {gridItems.map((item, index) => (
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
                          <svg className="h-6 w-6 translate-x-[1px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
                    {formatDate(item.createdAt)}
                  </p>
                </div>

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
            <button onClick={() => void loadMore()} disabled={loadingLibrary} className="btn-secondary px-8">
              {loadingLibrary ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

/* ── List / table view ────────────────────────────────────────────────────── */

function SortCaret({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`lib-sort-caret ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden="true">
      {active && dir === 'asc' ? '▲' : '▼'}
    </span>
  );
}

function LibraryTable({
  items,
  deletingVideoIds,
  sort,
  onToggleSort,
  onOpen,
  onRequestDelete,
  hasGlobalFilters,
  onClearGlobalFilters,
}: {
  items: LibraryVideoCard[];
  deletingVideoIds: string[];
  sort: SortState;
  onToggleSort: (key: SortKey) => void;
  onOpen: (videoId: string) => void;
  onRequestDelete: (item: LibraryVideoCard) => void;
  hasGlobalFilters: boolean;
  onClearGlobalFilters: () => void;
}) {
  const [config, setConfig] = useState(() => loadColumnConfig());
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnId, string>>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragCol, setDragCol] = useState<ColumnId | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ColumnId | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const saveTimers = useRef<Record<string, number>>({});

  // Persist column order + visibility.
  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(config));
    } catch {
      /* ignore */
    }
  }, [config]);

  // Hydrate notes for the currently-loaded items from localStorage.
  useEffect(() => {
    setNotes(prev => {
      const next = { ...prev };
      for (const item of items) {
        if (!(item.videoId in next)) {
          try {
            next[item.videoId] = localStorage.getItem(noteStorageKey(item.videoId)) ?? '';
          } catch {
            next[item.videoId] = '';
          }
        }
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    const timers = saveTimers.current;
    return () => {
      Object.values(timers).forEach(id => window.clearTimeout(id));
    };
  }, []);

  const updateNote = (videoId: string, value: string) => {
    setNotes(prev => ({ ...prev, [videoId]: value }));
    if (saveTimers.current[videoId]) window.clearTimeout(saveTimers.current[videoId]);
    saveTimers.current[videoId] = window.setTimeout(() => {
      try {
        localStorage.setItem(noteStorageKey(videoId), value);
      } catch {
        /* quota */
      }
    }, 400);
  };

  const visibleColumns = useMemo(
    () => config.order.filter(c => !config.hidden.includes(c)),
    [config],
  );

  const activeColumnFilters = useMemo(
    () => (Object.entries(columnFilters) as [ColumnId, string][]).filter(([, v]) => v.trim() !== ''),
    [columnFilters],
  );

  const rows = useMemo(() => {
    const filtered = items.filter(item =>
      activeColumnFilters.every(([col, value]) =>
        cellText(item, col, notes).toLowerCase().includes(value.trim().toLowerCase()),
      ),
    );
    return [...filtered].sort((a, b) => compareRows(a, b, sort, notes));
  }, [items, activeColumnFilters, notes, sort]);

  const moveColumn = (from: ColumnId, to: ColumnId) => {
    if (from === to) return;
    setConfig(prev => {
      const order = prev.order.filter(c => c !== from);
      const targetIndex = order.indexOf(to);
      order.splice(targetIndex, 0, from);
      return { ...prev, order };
    });
  };

  const toggleColumnHidden = (col: ColumnId) => {
    setConfig(prev => ({
      ...prev,
      hidden: prev.hidden.includes(col) ? prev.hidden.filter(c => c !== col) : [...prev.hidden, col],
    }));
  };

  const clearAllFilters = () => {
    setColumnFilters({});
    onClearGlobalFilters();
  };

  const anyFilterActive = hasGlobalFilters || activeColumnFilters.length > 0;

  return (
    <div className="animate-in fade-in duration-300">
      {/* List controls */}
      <div className="lib-controls">
        <div className="lib-col-menu-wrap">
          <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setMenuOpen(o => !o)} aria-expanded={menuOpen}>
            Columns ▾
          </button>
          {menuOpen && (
            <>
              <div className="lib-menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="lib-col-menu" role="menu">
                <p className="lib-col-menu-title">Show columns</p>
                {config.order
                  .filter(c => COLUMN_META[c].canHide)
                  .map(col => (
                    <label key={col} className="lib-col-menu-item">
                      <input
                        type="checkbox"
                        checked={!config.hidden.includes(col)}
                        onChange={() => toggleColumnHidden(col)}
                      />
                      <span>{COLUMN_META[col].label || 'Thumbnail'}</span>
                    </label>
                  ))}
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          className={`btn-secondary h-8 px-3 text-xs ${showFilters ? 'lib-control-active' : ''}`}
          onClick={() => setShowFilters(s => !s)}
          aria-pressed={showFilters}
        >
          Filters {activeColumnFilters.length > 0 ? `(${activeColumnFilters.length})` : ''}
        </button>
        {anyFilterActive && (
          <button type="button" className="text-xs font-medium text-muted hover:underline" onClick={clearAllFilters}>
            Clear all filters
          </button>
        )}
        <span className="ml-auto text-xs text-muted">{rows.length} shown</span>
      </div>

      <div className="lib-table-wrap">
        <table className="lib-table">
          <thead>
            <tr>
              {visibleColumns.map(col => {
                const meta = COLUMN_META[col];
                const isActiveSort = meta.sortKey != null && sort.key === meta.sortKey;
                return (
                  <th
                    key={col}
                    scope="col"
                    className={`lib-th ${meta.align === 'right' ? 'text-right' : 'text-left'} ${col === 'thumbnail' ? 'lib-th-thumb' : ''} ${dragOverCol === col ? 'lib-th-dragover' : ''}`}
                    draggable
                    onDragStart={() => setDragCol(col)}
                    onDragOver={e => {
                      e.preventDefault();
                      if (dragOverCol !== col) setDragOverCol(col);
                    }}
                    onDragLeave={() => setDragOverCol(prev => (prev === col ? null : prev))}
                    onDrop={e => {
                      e.preventDefault();
                      if (dragCol) moveColumn(dragCol, col);
                      setDragCol(null);
                      setDragOverCol(null);
                    }}
                    onDragEnd={() => {
                      setDragCol(null);
                      setDragOverCol(null);
                    }}
                    title="Drag to reorder"
                  >
                    <div className={`lib-th-inner ${meta.align === 'right' ? 'justify-end' : ''}`}>
                      <span className="lib-grip" aria-hidden="true">⠿</span>
                      {meta.sortable && meta.sortKey ? (
                        <button
                          type="button"
                          onClick={() => onToggleSort(meta.sortKey!)}
                          className={`lib-th-button ${isActiveSort ? 'lib-th-active' : ''}`}
                          aria-label={`Sort by ${meta.label}`}
                        >
                          <span>{meta.label}</span>
                          <SortCaret active={isActiveSort} dir={sort.dir} />
                        </button>
                      ) : (
                        <span className="lib-th-static">{meta.label}</span>
                      )}
                    </div>
                  </th>
                );
              })}
              <th scope="col" className="lib-th text-right">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
            {showFilters && (
              <tr className="lib-filter-row">
                {visibleColumns.map(col => (
                  <th key={col} className="lib-filter-cell">
                    {COLUMN_META[col].filterable ? (
                      <input
                        type="text"
                        value={columnFilters[col] ?? ''}
                        onChange={e => setColumnFilters(prev => ({ ...prev, [col]: e.target.value }))}
                        placeholder={`Filter ${COLUMN_META[col].label.replace(' (EST)', '')}…`}
                        aria-label={`Filter by ${COLUMN_META[col].label}`}
                        className="lib-filter-input"
                      />
                    ) : null}
                  </th>
                ))}
                <th className="lib-filter-cell" />
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="lib-td text-muted" colSpan={visibleColumns.length + 1}>
                  No videos match the active filters.
                </td>
              </tr>
            ) : (
              rows.map(item => {
                const bucket = phaseBucket(item.processingPhase);
                return (
                  <tr
                    key={item.videoId}
                    onClick={() => onOpen(item.videoId)}
                    className={`lib-row ${deletingVideoIds.includes(item.videoId) ? 'library-card-deleting' : ''}`}
                  >
                    {visibleColumns.map(col => {
                      switch (col) {
                        case 'thumbnail':
                          return (
                            <td key={col} className="lib-td lib-td-thumb">
                              <div className="lib-thumb">
                                {item.thumbnailKey ? (
                                  <img src={buildPublicObjectUrl(item.thumbnailKey)} alt="" loading="lazy" />
                                ) : (
                                  <span className="lib-thumb-empty">—</span>
                                )}
                              </div>
                            </td>
                          );
                        case 'title':
                          return (
                            <td key={col} className="lib-td lib-td-title">
                              <span className="lib-title-text">{item.displayTitle}</span>
                            </td>
                          );
                        case 'status':
                          return (
                            <td key={col} className="lib-td">
                              <span
                                className={`status-chip ${
                                  bucket === 'complete'
                                    ? 'status-chip-success'
                                    : bucket === 'failed'
                                      ? 'status-chip-failed'
                                      : 'status-chip-processing'
                                }`}
                              >
                                {phaseLabel(item.processingPhase)}
                              </span>
                            </td>
                          );
                        case 'duration':
                          return (
                            <td key={col} className="lib-td text-right tabular-nums">
                              {item.durationSeconds ? formatDuration(item.durationSeconds) : '—'}
                            </td>
                          );
                        case 'created':
                          return (
                            <td key={col} className="lib-td text-muted whitespace-nowrap">
                              {formatDateTimeEST(item.createdAt)}
                            </td>
                          );
                        case 'originalFile':
                          return (
                            <td key={col} className="lib-td text-muted whitespace-nowrap">
                              {formatDateTimeEST(item.originalFileCreatedAt)}
                            </td>
                          );
                        case 'note':
                          return (
                            <td key={col} className="lib-td lib-td-note">
                              <input
                                type="text"
                                value={notes[item.videoId] ?? ''}
                                onChange={e => updateNote(item.videoId, e.target.value)}
                                onClick={e => e.stopPropagation()}
                                placeholder="Add note…"
                                aria-label={`Note for ${item.displayTitle}`}
                                className="lib-note-input"
                              />
                            </td>
                          );
                        default:
                          return null;
                      }
                    })}
                    <td className="lib-td text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/video/${item.videoId}`}
                          onClick={e => e.stopPropagation()}
                          className="btn-secondary h-7 px-2.5 text-xs"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            onRequestDelete(item);
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
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

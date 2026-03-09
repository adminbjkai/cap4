import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  deleteVideo,
  getJobStatus,
  getVideoStatus,
  saveWatchEdits,
  retryVideo,
  type JobStatusResponse,
  type VideoStatusResponse,
} from "../lib/api";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { upsertRecentSession } from "../lib/sessions";
import { PlayerCard } from "../components/PlayerCard";
import { TranscriptCard } from "../components/TranscriptCard";
import { SummaryCard } from "../components/SummaryCard";
import { ChapterList } from "../components/ChapterList";
import { buildPublicObjectUrl } from "../lib/format";
import { useKeyboardShortcuts } from "../hooks/useKeyboardShortcuts";

/* ── Terminal-state sets ─────────────────────────────────────────────────── */
const TERMINAL_PROCESSING_PHASES  = new Set(["complete", "failed", "cancelled"]);
const TERMINAL_TRANSCRIPTION_STATUSES = new Set(["complete", "no_audio", "skipped", "failed"]);
const TERMINAL_AI_STATUSES        = new Set(["complete", "skipped", "failed"]);

function hasReachedTerminalState(status: VideoStatusResponse | null): boolean {
  if (!status) return false;
  return (
    TERMINAL_PROCESSING_PHASES.has(status.processingPhase) &&
    TERMINAL_TRANSCRIPTION_STATUSES.has(status.transcriptionStatus) &&
    TERMINAL_AI_STATUSES.has(status.aiStatus)
  );
}

/* ── Types ───────────────────────────────────────────────────────────────── */
type ChapterItem = { title: string; seconds: number };
type RailTab     = "notes" | "summary" | "transcript";

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function deriveChapters(
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined,
  segments: NonNullable<VideoStatusResponse["transcript"]>["segments"],
): ChapterItem[] {
  if (!aiOutput || aiOutput.keyPoints.length === 0) return [];

  const usableSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Number(segment.startSeconds);
      const text  = String(segment.text ?? "").trim();
      if (!Number.isFinite(start) || !text) return null;
      return { startSeconds: start, words: new Set(normalizeWords(text)) };
    })
    .filter((s): s is { startSeconds: number; words: Set<string> } => Boolean(s))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const chapters = aiOutput.keyPoints.map((point, index) => {
    if (usableSegments.length === 0) return { title: point, seconds: index * 15 };

    const pointWords = normalizeWords(point);
    let bestMatchSeconds: number | null = null;
    let bestScore = 0;

    for (const segment of usableSegments) {
      const score = pointWords.reduce(
        (total, word) => total + (segment.words.has(word) ? 1 : 0),
        0,
      );
      if (score > bestScore) { bestScore = score; bestMatchSeconds = segment.startSeconds; }
    }

    if (bestMatchSeconds !== null && bestScore > 0) return { title: point, seconds: bestMatchSeconds };

    const fallbackIndex = Math.min(
      usableSegments.length - 1,
      Math.floor((index / Math.max(aiOutput.keyPoints.length - 1, 1)) * (usableSegments.length - 1)),
    );
    return { title: point, seconds: usableSegments[fallbackIndex]?.startSeconds ?? 0 };
  });

  const deduped = new Map<string, ChapterItem>();
  for (const chapter of chapters) {
    const key = `${Math.round(chapter.seconds)}-${chapter.title.toLowerCase()}`;
    if (!deduped.has(key)) deduped.set(key, chapter);
  }
  return Array.from(deduped.values()).sort((a, b) => a.seconds - b.seconds);
}

function buildIdempotencyKey(): string {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `watch-edits-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/* ── Notes panel (localStorage-persisted, per video) ─────────────────────── */
function NotesPanel({ videoId }: { videoId: string }) {
  const storageKey = `cap4:notes:${videoId}`;
  const [notes, setNotes]   = useState(() => {
    try { return localStorage.getItem(storageKey) ?? ""; } catch { return ""; }
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNotes(value);
    // Debounced auto-save
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try { localStorage.setItem(storageKey, value); } catch { /* quota */ }
      setSavedAt(Date.now());
    }, 600);
  };

  useEffect(() => () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); }, []);

  return (
    <div className="flex h-full flex-col px-3 py-3">
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Your private notes about this video…"
        className="notes-textarea flex-1 min-h-0"
        style={{ minHeight: "200px" }}
        spellCheck
      />
      {savedAt && (
        <p className="mt-1.5 text-[11px] text-muted select-none">
          Saved locally
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   VIDEO PAGE
   ══════════════════════════════════════════════════════════════════════════ */
export function VideoPage() {
  const params        = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const navigate      = useNavigate();
  const videoId       = params.videoId ?? "";

  const jobId = useMemo(() => {
    const raw = searchParams.get("jobId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  /* ── Core state ──────────────────────────────────────────────────────── */
  const [status,                 setStatus]                = useState<VideoStatusResponse | null>(null);
  const [jobStatus,              setJobStatus]             = useState<JobStatusResponse | null>(null);
  const [loading,                setLoading]               = useState(false);
  const [errorMessage,           setErrorMessage]          = useState<string | null>(null);
  const [consecutivePollFailures,setConsecutivePollFailures] = useState(0);
  const [lastUpdatedAt,          setLastUpdatedAt]         = useState<string | null>(null);
  const [playbackTimeSeconds,    setPlaybackTimeSeconds]   = useState(0);
  const [videoDurationSeconds,   setVideoDurationSeconds]  = useState(0);
  const [seekRequest,            setSeekRequest]           = useState<{ seconds: number; requestId: number } | null>(null);
  const [copyFeedback,           setCopyFeedback]          = useState<string | null>(null);

  /* ── Title editing ───────────────────────────────────────────────────── */
  const [isTitleEditing,  setIsTitleEditing]  = useState(false);
  const [titleDraft,      setTitleDraft]      = useState("");
  const [isSavingTitle,   setIsSavingTitle]   = useState(false);
  const [titleSaveMessage,setTitleSaveMessage]= useState<string | null>(null);

  /* ── Retry / delete ──────────────────────────────────────────────────── */
  const [isRetrying,        setIsRetrying]        = useState(false);
  const [retryMessage,      setRetryMessage]      = useState<string | null>(null);
  const [isDeleteDialogOpen,setIsDeleteDialogOpen]= useState(false);
  const [isDeleting,        setIsDeleting]        = useState(false);
  const [isDeleted,         setIsDeleted]         = useState(false);
  const [deleteError,       setDeleteError]       = useState<string | null>(null);

  /* ── Right-rail tab ──────────────────────────────────────────────────── */
  const [railTab, setRailTab] = useState<RailTab>("transcript");
  const [renderedRailTab, setRenderedRailTab] = useState<RailTab>("transcript");
  const [outgoingRailTab, setOutgoingRailTab] = useState<RailTab | null>(null);

  /* ── Derived values ──────────────────────────────────────────────────── */
  const shareableResultUrl = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const videoUrl           = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const isProcessing       = !hasReachedTerminalState(status);
  const transcriptSegments = status?.transcript?.segments ?? [];
  const chapters           = useMemo(
    () => deriveChapters(status?.aiOutput, transcriptSegments),
    [status?.aiOutput, transcriptSegments],
  );
  const displayTitle = status?.aiOutput?.title?.trim() || "Untitled recording";

  const showRetryButton = useMemo(() => {
    if (!status) return false;
    return status.transcriptionStatus === "failed" || status.aiStatus === "failed";
  }, [status]);

  useEffect(() => {
    if (railTab === renderedRailTab) return;
    setOutgoingRailTab(renderedRailTab);
    setRenderedRailTab(railTab);
    const timeout = window.setTimeout(() => setOutgoingRailTab(null), 180);
    return () => window.clearTimeout(timeout);
  }, [railTab, renderedRailTab]);

  /* ── Title sync ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isTitleEditing) setTitleDraft(displayTitle);
  }, [displayTitle, isTitleEditing]);

  /* ── Seek ────────────────────────────────────────────────────────────── */
  const requestSeek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(0, seconds);
    window.dispatchEvent(new CustomEvent("cap:seek", { detail: { seconds: clamped } }));
    setPlaybackTimeSeconds(clamped);
    setSeekRequest((cur) => ({ seconds: clamped, requestId: (cur?.requestId ?? 0) + 1 }));
  }, []);

  /* ── Polling ─────────────────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!videoId) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const nextStatus = await getVideoStatus(videoId);
      setStatus(nextStatus);
      setLastUpdatedAt(new Date().toISOString());
      setConsecutivePollFailures(0);
      setErrorMessage(null);

      if (jobId !== null) {
        try { setJobStatus(await getJobStatus(jobId)); } catch { setJobStatus(null); }
      }

      upsertRecentSession({
        videoId,
        jobId: jobId ?? undefined,
        createdAt: new Date().toISOString(),
        processingPhase: nextStatus.processingPhase,
        processingProgress: nextStatus.processingProgress,
        resultKey: nextStatus.resultKey,
        thumbnailKey: nextStatus.thumbnailKey,
        errorMessage: nextStatus.errorMessage,
      });
    } catch (error) {
      setConsecutivePollFailures((c) => c + 1);
      const message = error instanceof Error ? error.message : "Status temporarily unavailable.";
      setErrorMessage(`Status temporarily unavailable. We'll keep retrying automatically. (${message})`);
    } finally {
      setLoading(false);
    }
  }, [videoId, jobId]);

  useEffect(() => { if (videoId) void refresh(); }, [videoId, refresh]);

  useEffect(() => {
    if (!videoId || isDeleted || hasReachedTerminalState(status)) return;
    const delayMs = consecutivePollFailures === 0
      ? 2000
      : Math.min(15000, 2000 * 2 ** consecutivePollFailures);
    const timeout = window.setTimeout(() => void refresh(), delayMs);
    return () => window.clearTimeout(timeout);
  }, [videoId, status, refresh, consecutivePollFailures, isDeleted]);

  /* ── Retry ───────────────────────────────────────────────────────────── */
  const handleRetry = useCallback(async () => {
    if (!videoId || isRetrying) return;
    setIsRetrying(true); setRetryMessage(null);
    try {
      const result = await retryVideo(videoId);
      setRetryMessage(result.ok ? "Job queued for retry." : "Failed to queue retry.");
      if (result.ok) await refresh();
    } catch (err) {
      setRetryMessage(err instanceof Error ? err.message : "Retry request failed.");
    } finally {
      setIsRetrying(false);
      window.setTimeout(() => setRetryMessage(null), 3000);
    }
  }, [videoId, isRetrying, refresh]);

  /* ── Title save ──────────────────────────────────────────────────────── */
  const saveTitle = useCallback(async (): Promise<void> => {
    const normalizedTitle = titleDraft.trim();
    if (!normalizedTitle) { setTitleSaveMessage("Title cannot be empty."); return; }
    setIsSavingTitle(true); setTitleSaveMessage(null);
    try {
      await saveWatchEdits(videoId, { title: normalizedTitle }, buildIdempotencyKey());
      setIsTitleEditing(false);
      setTitleSaveMessage("Title saved.");
      await refresh();
    } catch {
      setTitleSaveMessage("Unable to save title.");
    } finally {
      setIsSavingTitle(false);
      window.setTimeout(() => setTitleSaveMessage(null), 1800);
    }
  }, [titleDraft, videoId, refresh]);

  const handleTitleDraftKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") { event.preventDefault(); if (!isSavingTitle) void saveTitle(); return; }
    if (event.key === "Escape") {
      event.preventDefault();
      if (isSavingTitle) return;
      setTitleDraft(displayTitle); setIsTitleEditing(false); setTitleSaveMessage(null);
    }
  };

  /* ── Transcript save ─────────────────────────────────────────────────── */
  const saveTranscript = useCallback(async (text: string): Promise<boolean> => {
    try { await saveWatchEdits(videoId, { transcriptText: text }, buildIdempotencyKey()); await refresh(); return true; }
    catch { return false; }
  }, [videoId, refresh]);

  const saveSpeakerLabels = useCallback(async (labels: Record<string, string>): Promise<boolean> => {
    try {
      await saveWatchEdits(videoId, { speakerLabels: labels }, buildIdempotencyKey());
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [videoId, refresh]);

  /* ── Delete ──────────────────────────────────────────────────────────── */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!videoId || isDeleting) return;
    setIsDeleting(true); setDeleteError(null);
    try {
      await deleteVideo(videoId);
      setIsDeleted(true);
      navigate("/", { replace: true });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete video.");
    } finally {
      setIsDeleting(false);
    }
  }, [videoId, isDeleting, navigate]);

  /* ── Copy ────────────────────────────────────────────────────────────── */
  const copyToClipboard = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyFeedback(`${label} copied`); }
    catch { setCopyFeedback(`Unable to copy ${label.toLowerCase()}.`); }
    window.setTimeout(() => setCopyFeedback(null), 1600);
  };

  const renderRailTabContent = (tab: RailTab) => {
    if (tab === "notes") {
      return <NotesPanel videoId={videoId} />;
    }
    if (tab === "summary") {
      return (
        <SummaryCard
          aiStatus={status?.aiStatus}
          aiOutput={status?.aiOutput}
          errorMessage={status?.aiErrorMessage}
          shareableResultUrl={shareableResultUrl}
          chapters={chapters}
          onJumpToSeconds={requestSeek}
          compact
        />
      );
    }
    return (
      <TranscriptCard
        transcriptionStatus={status?.transcriptionStatus}
        transcript={status?.transcript}
        errorMessage={status?.transcriptErrorMessage}
        playbackTimeSeconds={playbackTimeSeconds}
        onSeekToSeconds={requestSeek}
        onSaveTranscript={saveTranscript}
        onSaveSpeakerLabels={saveSpeakerLabels}
        compact
      />
    );
  };

  const getActiveVideoElement = useCallback((): HTMLVideoElement | null => {
    return document.querySelector("video");
  }, []);

  const togglePlayerPlayback = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    if (video.paused) {
      void video.play();
      return;
    }
    video.pause();
  }, [getActiveVideoElement]);

  const seekPlayerBy = useCallback((deltaSeconds: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
    const nextTime = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
    requestSeek(nextTime);
  }, [getActiveVideoElement, requestSeek]);

  const seekPlayerToPercent = useCallback((percent: number) => {
    const video = getActiveVideoElement();
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    requestSeek(video.duration * Math.max(0, Math.min(1, percent)));
  }, [getActiveVideoElement, requestSeek]);

  const adjustPlayerVolume = useCallback((delta: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const nextVolume = Math.max(0, Math.min(1, video.volume + delta));
    video.volume = nextVolume;
    video.muted = nextVolume === 0;
  }, [getActiveVideoElement]);

  const adjustPlayerRate = useCallback((delta: number) => {
    const video = getActiveVideoElement();
    if (!video) return;
    const nextRate = Math.max(0.25, Math.min(3, video.playbackRate + delta));
    video.playbackRate = Math.round(nextRate * 100) / 100;
  }, [getActiveVideoElement]);

  const togglePlayerMute = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    video.muted = !video.muted;
  }, [getActiveVideoElement]);

  const togglePlayerFullscreen = useCallback(() => {
    const video = getActiveVideoElement();
    if (!video) return;
    const host = (video.closest(".custom-video-shell") as HTMLElement | null) ?? video;
    if (document.fullscreenElement === host) {
      void document.exitFullscreen();
      return;
    }
    void host.requestFullscreen();
  }, [getActiveVideoElement]);

  useKeyboardShortcuts({
    player: {
      enabled: true,
      onPlayPause: togglePlayerPlayback,
      onSeekBy: seekPlayerBy,
      onSeekToPercent: seekPlayerToPercent,
      onVolumeBy: adjustPlayerVolume,
      onRateBy: adjustPlayerRate,
      onToggleMute: togglePlayerMute,
      onToggleFullscreen: togglePlayerFullscreen,
    },
  });

  useEffect(() => {
    const onRequestDelete = () => {
      setDeleteError(null);
      setIsDeleteDialogOpen(true);
    };
    const onEscape = () => {
      if (isDeleteDialogOpen && !isDeleting) {
        setIsDeleteDialogOpen(false);
        setDeleteError(null);
      }
      if (isTitleEditing && !isSavingTitle) {
        setTitleDraft(displayTitle);
        setIsTitleEditing(false);
        setTitleSaveMessage(null);
      }
    };

    window.addEventListener("cap:request-delete-active-video", onRequestDelete);
    window.addEventListener("cap:escape", onEscape);
    return () => {
      window.removeEventListener("cap:request-delete-active-video", onRequestDelete);
      window.removeEventListener("cap:escape", onEscape);
    };
  }, [displayTitle, isDeleteDialogOpen, isDeleting, isSavingTitle, isTitleEditing]);

  /* ── Guard ───────────────────────────────────────────────────────────── */
  if (!videoId) {
    return (
      <div className="workspace-card">
        <p className="panel-danger">Missing video ID.</p>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="animate-in fade-in duration-300">
      <ConfirmationDialog
        open={isDeleteDialogOpen}
        title="Delete video?"
        message={`Delete "${displayTitle}"? This removes it from the library and returns you to the home page.`}
        confirmLabel="Delete video"
        busy={isDeleting}
        errorMessage={deleteError}
        onCancel={() => { if (isDeleting) return; setIsDeleteDialogOpen(false); setDeleteError(null); }}
        onConfirm={() => void handleDelete()}
      />

      {/* ── Page Header ────────────────────────────────────────────────── */}
      <div className="mb-4">
        {/* Title + actions row */}
        <div className="flex flex-wrap items-start justify-between gap-2">

          {/* Title */}
          <div className="min-w-0 flex-1">
            {!isTitleEditing ? (
              <div className="flex flex-wrap items-baseline gap-2">
                <h1 className="text-xl font-bold tracking-tight truncate" style={{ color: "var(--text-primary)" }}>
                  {displayTitle}
                </h1>
                <button
                  type="button"
                  onClick={() => { setTitleDraft(displayTitle); setIsTitleEditing(true); setTitleSaveMessage(null); }}
                  className="text-[11px] transition-colors"
                  style={{ color: "var(--text-muted)" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={handleTitleDraftKeyDown}
                  autoFocus
                  aria-label="Edit title"
                  className="input-control text-base font-bold w-full max-w-md"
                />
                <button type="button" onClick={() => void saveTitle()} disabled={isSavingTitle} className="btn-primary px-2.5 py-1 text-xs">
                  {isSavingTitle ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setTitleDraft(displayTitle); setIsTitleEditing(false); }}
                  disabled={isSavingTitle}
                  className="btn-secondary px-2.5 py-1 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}
            {titleSaveMessage && (
              <p className={`mt-0.5 text-xs font-medium ${titleSaveMessage.includes("Unable") || titleSaveMessage.includes("cannot") ? "text-red-600" : "text-green-600"}`}>
                {titleSaveMessage}
              </p>
            )}

            {/* Status meta line */}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              {isProcessing && (
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "var(--accent-blue)" }} />
                  Processing
                </span>
              )}
              {!isProcessing && status?.processingPhase === "complete" && (
                <span className="inline-flex items-center gap-1 status-chip-success">
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Complete
                </span>
              )}
              {status?.processingPhase === "failed" && <span className="status-chip status-chip-danger">Failed</span>}
              {lastUpdatedAt && <span>Updated {new Date(lastUpdatedAt).toLocaleTimeString()}</span>}
            </div>
          </div>

          {/* Right header actions */}
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {shareableResultUrl && (
              <div className="flex items-center gap-1 rounded-md border px-2 py-1 max-w-[200px] overflow-hidden"
                   style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-subtle)" }}>
                <span className="truncate font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {shareableResultUrl.replace(/^https?:\/\//, "")}
                </span>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(shareableResultUrl, "URL")}
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
              <a href={videoUrl} target="_blank" rel="noreferrer"
                 className="btn-secondary px-2.5 py-1 text-xs flex items-center gap-1" title="Download video">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download
              </a>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="btn-secondary p-1.5"
              title="Refresh status"
            >
              <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => { setDeleteError(null); setIsDeleteDialogOpen(true); }}
              className="btn-secondary px-2.5 py-1 text-xs"
              style={{ color: "var(--danger-text)" }}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Processing progress bar */}
        {isProcessing && status && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border px-3 py-1.5"
               style={{ borderColor: "var(--accent-blue-border)", background: "var(--accent-blue-subtle)" }}>
            <div className="h-1 flex-1 rounded-full" style={{ background: "var(--bg-surface-muted)" }}>
              <div
                className="progress-active-bar h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(5, status.processingProgress ?? 0)}%` }}
              />
            </div>
            <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--accent-blue)" }}>
              {status.processingProgress != null ? `${status.processingProgress}%` : status.processingPhase}
            </span>
          </div>
        )}

        {errorMessage && <p className="panel-warning mt-2 text-xs">{errorMessage}</p>}
        {copyFeedback  && <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>{copyFeedback}</p>}

        {showRetryButton && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="btn-primary px-2.5 py-1 text-xs flex items-center gap-1"
            >
              <svg className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isRetrying ? "Retrying…" : "Retry processing"}
            </button>
            {retryMessage && (
              <span className={`text-xs font-medium ${retryMessage.includes("Failed") || retryMessage.includes("failed") ? "text-red-600" : "text-green-600"}`}>
                {retryMessage}
              </span>
            )}
          </div>
        )}
        {jobStatus ? <p className="sr-only">Queue status: {jobStatus.status}</p> : null}
      </div>

      {/* ── Two-column layout ──────────────────────────────────────────── */}
      {/* Video left (~62%), right rail (~38%) */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">

        {/* ── Left: Player ──────────────────────────────────────────────── */}
        <div className="min-w-0">
          {loading && !status ? (
            <div className="workspace-card overflow-hidden p-0">
              <div className="skeleton-block aspect-video w-full" />
            </div>
          ) : (
            <PlayerCard
              resultKey={status?.resultKey ?? null}
              thumbnailKey={status?.thumbnailKey ?? null}
              seekRequest={seekRequest}
              onPlaybackTimeChange={setPlaybackTimeSeconds}
              onDurationChange={setVideoDurationSeconds}
              chapters={chapters}
              onSeekToSeconds={requestSeek}
              transcriptSegments={status?.transcript?.segments ?? []}
            />
          )}
        </div>

        {/* ── Right: 3-tab rail ─────────────────────────────────────────── */}
        <div className="min-w-0">
          <div className="flex flex-col rounded-xl border shadow-card overflow-hidden"
               style={{ maxHeight: "520px", background: "var(--bg-surface)", borderColor: "var(--border-default)" }}>

            {/* Tab bar */}
            <div className="rail-tab-bar">
              {(["notes", "summary", "transcript"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setRailTab(tab)}
                  className={`rail-tab ${railTab === tab ? "rail-tab-active" : ""}`}
                >
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content — scrolls within the bounded container */}
            <div className="rail-tab-stack scroll-panel">
              {outgoingRailTab && (
                <div className="rail-tab-panel-exit">
                  {renderRailTabContent(outgoingRailTab)}
                </div>
              )}
              <div key={renderedRailTab} className="rail-tab-panel-enter">
                {renderRailTabContent(renderedRailTab)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Below-the-fold: Chapters ───────────────────────────────────── */}
      {chapters.length > 0 && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Chapters</h2>
          <ChapterList
            chapters={chapters}
            currentSeconds={playbackTimeSeconds}
            durationSeconds={videoDurationSeconds}
            onSeek={requestSeek}
            inline
          />
        </div>
      )}
    </div>
  );
}

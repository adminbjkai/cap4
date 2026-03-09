import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  deleteVideo,
  getJobStatus,
  getVideoStatus,
  saveWatchEdits,
  retryVideo,
  type JobStatusResponse,
  type VideoStatusResponse
} from "../lib/api";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { upsertRecentSession } from "../lib/sessions";
import { PlayerCard } from "../components/PlayerCard";
import { SummaryCard } from "../components/SummaryCard";
import { TranscriptCard } from "../components/TranscriptCard";
import { ChapterList } from "../components/ChapterList";
import { buildPublicObjectUrl } from "../lib/format";

const TERMINAL_PROCESSING_PHASES = new Set(["complete", "failed", "cancelled"]);
const TERMINAL_TRANSCRIPTION_STATUSES = new Set(["complete", "no_audio", "skipped", "failed"]);
const TERMINAL_AI_STATUSES = new Set(["complete", "skipped", "failed"]);

function hasReachedTerminalState(status: VideoStatusResponse | null): boolean {
  if (!status) return false;
  return (
    TERMINAL_PROCESSING_PHASES.has(status.processingPhase) &&
    TERMINAL_TRANSCRIPTION_STATUSES.has(status.transcriptionStatus) &&
    TERMINAL_AI_STATUSES.has(status.aiStatus)
  );
}

type ChapterItem = {
  title: string;
  seconds: number;
};

function normalizeWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
}

function deriveChapters(
  aiOutput: VideoStatusResponse["aiOutput"] | null | undefined,
  segments: NonNullable<VideoStatusResponse["transcript"]>["segments"]
): ChapterItem[] {
  if (!aiOutput || aiOutput.keyPoints.length === 0) return [];

  const usableSegments = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const start = Number(segment.startSeconds);
      const text = String(segment.text ?? "").trim();
      if (!Number.isFinite(start) || !text) return null;
      return { startSeconds: start, words: new Set(normalizeWords(text)) };
    })
    .filter((segment): segment is { startSeconds: number; words: Set<string> } => Boolean(segment))
    .sort((a, b) => a.startSeconds - b.startSeconds);

  const chapters = aiOutput.keyPoints.map((point, index) => {
    if (usableSegments.length === 0) {
      return { title: point, seconds: index * 15 };
    }

    const pointWords = normalizeWords(point);
    let bestMatchSeconds: number | null = null;
    let bestScore = 0;

    for (const segment of usableSegments) {
      const score = pointWords.reduce((total, word) => total + (segment.words.has(word) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatchSeconds = segment.startSeconds;
      }
    }

    if (bestMatchSeconds !== null && bestScore > 0) {
      return { title: point, seconds: bestMatchSeconds };
    }

    const fallbackIndex = Math.min(
      usableSegments.length - 1,
      Math.floor((index / Math.max(aiOutput.keyPoints.length - 1, 1)) * (usableSegments.length - 1))
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
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `watch-edits-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

export function VideoPage() {
  const params = useParams<{ videoId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const videoId = params.videoId ?? "";

  const jobId = useMemo(() => {
    const raw = searchParams.get("jobId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  const [status, setStatus] = useState<VideoStatusResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [consecutivePollFailures, setConsecutivePollFailures] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [playbackTimeSeconds, setPlaybackTimeSeconds] = useState(0);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
  const [railTab, setRailTab] = useState<"summary" | "transcript">("transcript");
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveMessage, setTitleSaveMessage] = useState<string | null>(null);
  const shareableResultUrl = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const videoUrl = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
  const isAutoRefreshActive = !hasReachedTerminalState(status);
  const transcriptSegments = status?.transcript?.segments ?? [];
  const chapters = useMemo(() => deriveChapters(status?.aiOutput, transcriptSegments), [status?.aiOutput, transcriptSegments]);
  const displayTitle = status?.aiOutput?.title?.trim() || "Untitled recording";

  const showRetryButton = useMemo(() => {
    if (!status) return false;
    return status.transcriptionStatus === "failed" || status.aiStatus === "failed";
  }, [status]);

  const [isRetrying, setIsRetrying] = useState(false);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTitleEditing) {
      setTitleDraft(displayTitle);
    }
  }, [displayTitle, isTitleEditing]);

  const requestSeek = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    const clamped = Math.max(0, seconds);
    window.dispatchEvent(new CustomEvent("cap:seek", { detail: { seconds: clamped } }));
    setPlaybackTimeSeconds(clamped);
    setSeekRequest((current) => ({
      seconds: clamped,
      requestId: (current?.requestId ?? 0) + 1
    }));
  }, []);

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
        try {
          const nextJobStatus = await getJobStatus(jobId);
          setJobStatus(nextJobStatus);
        } catch {
          setJobStatus(null);
        }
      }

      upsertRecentSession({
        videoId,
        jobId: jobId ?? undefined,
        createdAt: new Date().toISOString(),
        processingPhase: nextStatus.processingPhase,
        processingProgress: nextStatus.processingProgress,
        resultKey: nextStatus.resultKey,
        thumbnailKey: nextStatus.thumbnailKey,
        errorMessage: nextStatus.errorMessage
      });
    } catch (error) {
      setConsecutivePollFailures((current) => current + 1);
      const message = error instanceof Error ? error.message : "Status temporarily unavailable.";
      setErrorMessage(`Status temporarily unavailable. We'll keep retrying automatically. (${message})`);
    } finally {
      setLoading(false);
    }
  }, [videoId, jobId]);

  useEffect(() => {
    if (!videoId) return;
    void refresh();
  }, [videoId, refresh]);

  useEffect(() => {
    if (!videoId || isDeleted) return;
    if (hasReachedTerminalState(status)) return;
    const delayMs = consecutivePollFailures === 0 ? 2000 : Math.min(15000, 2000 * 2 ** consecutivePollFailures);
    const timeout = window.setTimeout(() => {
      void refresh();
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [videoId, status, refresh, consecutivePollFailures]);

  const handleRetry = useCallback(async () => {
    if (!videoId || isRetrying) return;
    setIsRetrying(true);
    setRetryMessage(null);
    try {
      const result = await retryVideo(videoId);
      if (result.ok) {
        setRetryMessage("Job queued for retry.");
        await refresh();
      } else {
        setRetryMessage("Failed to queue retry.");
      }
    } catch (err) {
      setRetryMessage(err instanceof Error ? err.message : "Retry request failed.");
    } finally {
      setIsRetrying(false);
      window.setTimeout(() => setRetryMessage(null), 3000);
    }
  }, [videoId, isRetrying, refresh]);

  const saveTitle = useCallback(async (): Promise<void> => {
    const normalizedTitle = titleDraft.trim();
    if (!normalizedTitle) {
      setTitleSaveMessage("Title cannot be empty.");
      return;
    }
    setIsSavingTitle(true);
    setTitleSaveMessage(null);
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
    if (event.key === "Enter") {
      event.preventDefault();
      if (!isSavingTitle) void saveTitle();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (isSavingTitle) return;
      setTitleDraft(displayTitle);
      setIsTitleEditing(false);
      setTitleSaveMessage(null);
    }
  };

  const saveTranscript = useCallback(async (text: string): Promise<boolean> => {
    try {
      await saveWatchEdits(videoId, { transcriptText: text }, buildIdempotencyKey());
      await refresh();
      return true;
    } catch {
      return false;
    }
  }, [videoId, refresh]);

  const handleDelete = useCallback(async (): Promise<void> => {
    if (!videoId || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
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

  const copyToClipboard = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFeedback(`${label} copied`);
    } catch {
      setCopyFeedback(`Unable to copy ${label.toLowerCase()}.`);
    }
    window.setTimeout(() => setCopyFeedback(null), 1600);
  };

  if (!videoId) {
    return (
      <div className="workspace-card">
        <p className="panel-danger">Missing video ID.</p>
      </div>
    );
  }

  const isProcessing = !hasReachedTerminalState(status);

  return (
    <div className="animate-in fade-in duration-500">
      <ConfirmationDialog
        open={isDeleteDialogOpen}
        title="Delete video?"
        message={`Delete "${displayTitle}"? This removes it from the library and returns you to the home page.`}
        confirmLabel="Delete video"
        busy={isDeleting}
        errorMessage={deleteError}
        onCancel={() => {
          if (isDeleting) return;
          setIsDeleteDialogOpen(false);
          setDeleteError(null);
        }}
        onConfirm={() => void handleDelete()}
      />

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="mb-5">
        {/* Title row */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {!isTitleEditing ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight truncate">{displayTitle}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(displayTitle);
                    setIsTitleEditing(true);
                    setTitleSaveMessage(null);
                  }}
                  className="text-xs text-muted hover:text-foreground transition-colors underline underline-offset-2"
                >
                  Edit
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={handleTitleDraftKeyDown}
                  autoFocus
                  aria-label="Edit title"
                  className="input-control text-xl font-bold w-full max-w-lg"
                />
                <button type="button" onClick={() => void saveTitle()} disabled={isSavingTitle} className="btn-primary px-3 py-1.5 text-xs">
                  {isSavingTitle ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => { setTitleDraft(displayTitle); setIsTitleEditing(false); }}
                  disabled={isSavingTitle}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
              </div>
            )}
            {titleSaveMessage && (
              <p className={`mt-1 text-xs font-medium ${titleSaveMessage.includes("Unable") || titleSaveMessage.includes("cannot") ? "text-red-600" : "text-green-600"}`}>
                {titleSaveMessage}
              </p>
            )}
            {/* Subtitle meta line */}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              {isProcessing && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                  Processing
                </span>
              )}
              {!isProcessing && status?.processingPhase === "complete" && (
                <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Complete
                </span>
              )}
              {status?.processingPhase === "failed" && (
                <span className="text-red-600">Failed</span>
              )}
              {lastUpdatedAt && (
                <span>Updated {new Date(lastUpdatedAt).toLocaleTimeString()}</span>
              )}
            </div>
          </div>

          {/* Right header actions */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {shareableResultUrl && (
              <div className="flex items-center gap-1.5 rounded-lg border bg-surface-muted px-3 py-1.5 text-sm max-w-[240px] overflow-hidden">
                <span className="truncate text-muted font-mono text-xs">{shareableResultUrl.replace(/^https?:\/\//, "")}</span>
                <button
                  type="button"
                  onClick={() => void copyToClipboard(shareableResultUrl, "URL")}
                  className="shrink-0 text-muted hover:text-foreground transition-colors"
                  title="Copy URL"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
                className="btn-secondary px-3 py-1.5 text-sm"
                title="Download video"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Download
              </a>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="btn-secondary px-3 py-1.5 text-sm"
              title="Refresh status"
            >
              <svg className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => { setDeleteError(null); setIsDeleteDialogOpen(true); }}
              className="btn-secondary px-3 py-1.5 text-sm text-red-600 hover:text-red-700"
              title="Delete recording"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Processing banner — only shown while active */}
        {isProcessing && status && (
          <div className="mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-900/50 dark:bg-amber-900/20">
            <div className="h-1.5 flex-1 rounded-full bg-amber-200 dark:bg-amber-900/50">
              <div
                className="h-full rounded-full bg-amber-500 transition-all duration-500"
                style={{ width: `${Math.max(5, status.processingProgress ?? 0)}%` }}
              />
            </div>
            <span className="text-amber-800 dark:text-amber-300 font-medium shrink-0">
              {status.processingProgress != null ? `${status.processingProgress}%` : status.processingPhase}
            </span>
          </div>
        )}

        {errorMessage && <p className="panel-warning mt-3">{errorMessage}</p>}
        {copyFeedback && <p className="mt-2 text-xs text-muted">{copyFeedback}</p>}

        {/* Retry button */}
        {showRetryButton && (
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="btn-primary px-3 py-1.5 text-xs flex items-center gap-1.5"
            >
              <svg className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isRetrying ? "Retrying..." : "Retry processing"}
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

      {/* ── Main two-column layout ───────────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">

        {/* Left col — Video player */}
        <div className="min-w-0">
          <PlayerCard
            resultKey={status?.resultKey ?? null}
            thumbnailKey={status?.thumbnailKey ?? null}
            seekRequest={seekRequest}
            onPlaybackTimeChange={setPlaybackTimeSeconds}
            onDurationChange={setVideoDurationSeconds}
            chapters={chapters}
            onSeekToSeconds={requestSeek}
          />
        </div>

        {/* Right col — Summary / Transcript tabs */}
        <div className="min-w-0">
          <div className="rounded-xl border bg-surface shadow-sm h-full flex flex-col" style={{ minHeight: "420px" }}>
            {/* Tab bar */}
            <div className="flex border-b px-4">
              <button
                type="button"
                onClick={() => setRailTab("transcript")}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  railTab === "transcript"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                Transcript
              </button>
              <button
                type="button"
                onClick={() => setRailTab("summary")}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  railTab === "summary"
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted hover:text-foreground"
                }`}
              >
                Summary
              </button>
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-hidden">
              {railTab === "transcript" ? (
                <TranscriptCard
                  transcriptionStatus={status?.transcriptionStatus}
                  transcript={status?.transcript}
                  errorMessage={status?.transcriptErrorMessage}
                  playbackTimeSeconds={playbackTimeSeconds}
                  onSeekToSeconds={requestSeek}
                  onSaveTranscript={saveTranscript}
                  compact
                />
              ) : (
                <SummaryCard
                  aiStatus={status?.aiStatus}
                  aiOutput={status?.aiOutput}
                  errorMessage={status?.aiErrorMessage}
                  shareableResultUrl={shareableResultUrl}
                  chapters={chapters}
                  onJumpToSeconds={requestSeek}
                  compact
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Below the fold: Summary text + Chapters list ─────────────── */}
      {status?.aiOutput && (
        <div className="mt-8 space-y-8">
          {/* Summary text */}
          {status.aiOutput.summary && (
            <section>
              <h2 className="text-lg font-semibold mb-1">Summary</h2>
              <p className="text-xs text-muted mb-3">Generated by Cap AI</p>
              <p className="text-sm leading-relaxed text-secondary">{status.aiOutput.summary}</p>
            </section>
          )}

          {/* Chapters list — Cap-style clean table */}
          {chapters.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">Chapters</h2>
              <ChapterList
                chapters={chapters}
                currentSeconds={playbackTimeSeconds}
                durationSeconds={videoDurationSeconds}
                onSeek={requestSeek}
                inline
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

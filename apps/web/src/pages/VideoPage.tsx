import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  deleteVideo,
  getJobStatus,
  getSystemProviderStatus,
  getVideoStatus,
  saveWatchEdits,
  retryVideo,
  type JobStatusResponse,
  type ProviderStatusResponse,
  type VideoStatusResponse
} from "../lib/api";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { upsertRecentSession } from "../lib/sessions";
import { PlayerCard } from "../components/PlayerCard";
import { SummaryCard } from "../components/SummaryCard";
import { StatusPanel } from "../components/StatusPanel";
import { TranscriptCard } from "../components/TranscriptCard";
import { ChapterList } from "../components/ChapterList";
import { TranscriptParagraph } from "../components/TranscriptParagraph";
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
  const [providerStatus, setProviderStatus] = useState<ProviderStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
  const [consecutivePollFailures, setConsecutivePollFailures] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [playbackTimeSeconds, setPlaybackTimeSeconds] = useState(0);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState(0);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; requestId: number } | null>(null);
  const [railTab, setRailTab] = useState<"transcript" | "comments">("transcript");
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [titleSaveMessage, setTitleSaveMessage] = useState<string | null>(null);
  const shareableResultUrl = status?.resultKey ? buildPublicObjectUrl(status.resultKey) : null;
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
      void getSystemProviderStatus()
        .then((nextProviderStatus) => {
          setProviderStatus(nextProviderStatus);
          setProviderStatusError(null);
        })
        .catch((providerError) => {
          setProviderStatusError(
            providerError instanceof Error
              ? `Provider status temporarily unavailable. (${providerError.message})`
              : "Provider status temporarily unavailable."
          );
        });

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
      if (!isSavingTitle) {
        void saveTitle();
      }
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

  if (!videoId) {
    return (
      <div className="workspace-card">
        <p className="panel-danger">Missing video ID.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
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
      <section className="workspace-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl space-y-1.5">
            <p className="workspace-label">Studio</p>
            {!isTitleEditing ? (
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="watch-title">{displayTitle}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(displayTitle);
                    setIsTitleEditing(true);
                    setTitleSaveMessage(null);
                  }}
                  className="btn-secondary px-2.5 py-1 text-xs"
                >
                  Edit title
                </button>
              </div>
            ) : (
              <div className="panel-subtle space-y-2 p-2.5">
                <input
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onKeyDown={handleTitleDraftKeyDown}
                  autoFocus
                  aria-label="Edit title"
                  className="input-control w-full max-w-xl text-lg font-semibold"
                />
                <div className="action-group items-center gap-1.5">
                  <button type="button" onClick={() => void saveTitle()} disabled={isSavingTitle} className="btn-primary px-3 py-1.5 text-xs">
                    {isSavingTitle ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(displayTitle);
                      setIsTitleEditing(false);
                    }}
                    disabled={isSavingTitle}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <span className="text-xs text-muted">Enter to save • Esc to cancel</span>
                </div>
              </div>
            )}
            {titleSaveMessage ? (
              <p className={`text-xs font-medium ${titleSaveMessage.includes("Unable") || titleSaveMessage.includes("cannot") ? "text-red-700" : "text-green-700"}`}>
                {titleSaveMessage}
              </p>
            ) : null}
          </div>
          <div className="action-group gap-2">
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                setIsDeleteDialogOpen(true);
              }}
              className="btn-secondary px-3 py-1.5 text-sm text-red-700"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              Refresh
            </button>
            <Link
              to="/record"
              className="btn-primary px-3 py-1.5 text-sm"
            >
              New recording
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="status-chip status-chip-compact">Process: {status?.processingPhase ?? "pending"}</span>
          <span className="status-chip status-chip-compact">Transcript: {status?.transcriptionStatus ?? "not_started"}</span>
          <span className="status-chip status-chip-compact">AI: {status?.aiStatus ?? "not_started"}</span>
          <span className="status-chip status-chip-compact">Updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "Waiting..."}</span>
          <span className={`status-chip status-chip-compact ${isAutoRefreshActive ? "" : "opacity-90"}`}>
            Live updates: {isAutoRefreshActive ? "Active" : "Stopped"}
          </span>
          {showRetryButton && (
            <button
              type="button"
              onClick={() => void handleRetry()}
              disabled={isRetrying}
              className="btn-primary px-3 py-1 flex items-center gap-1.5 text-xs animate-in fade-in slide-in-from-left-2 duration-300"
            >
              <svg className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isRetrying ? "Retrying..." : "Retry Processing"}
            </button>
          )}
          {retryMessage && (
            <span className={`text-xs font-medium animate-in fade-in duration-300 ${retryMessage.includes("Failed") || retryMessage.includes("failed") ? "text-red-600" : "text-green-600"}`}>
              {retryMessage}
            </span>
          )}
        </div>
        {jobStatus ? <p className="sr-only">Queue status: {jobStatus.status}</p> : null}

        {errorMessage ? <p className="panel-warning mt-4">{errorMessage}</p> : null}
      </section>

      {/* Main content area with chapters on left, video on right */}
      <div className="grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left sidebar - Chapters */}
        <aside className="space-y-4 animate-in fade-in slide-in-from-left-2 duration-500">
          <ChapterList
            chapters={chapters}
            currentSeconds={playbackTimeSeconds}
            durationSeconds={videoDurationSeconds}
            onSeek={requestSeek}
          />
        </aside>

        {/* Main content - Video and panels */}
        <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <PlayerCard
            resultKey={status?.resultKey ?? null}
            thumbnailKey={status?.thumbnailKey ?? null}
            seekRequest={seekRequest}
            onPlaybackTimeChange={setPlaybackTimeSeconds}
            onDurationChange={setVideoDurationSeconds}
            chapters={chapters}
            onSeekToSeconds={requestSeek}
          />
          <StatusPanel
            status={status}
            loading={loading}
            lastUpdatedAt={lastUpdatedAt}
            isAutoRefreshActive={isAutoRefreshActive}
            providerStatus={providerStatus}
            providerStatusError={providerStatusError}
          />

          {/* Right rail content moved below video */}
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="workspace-card p-2.5">
              <div className="mb-3 flex items-center justify-between gap-3 px-1">
                <div>
                  <p className="workspace-label">Right rail</p>
                  <h2 className="text-lg font-semibold tracking-tight">Transcript and AI</h2>
                </div>
                <span className="status-chip">Focused</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRailTab("transcript")}
                  className={`segment-btn ${railTab === "transcript" ? "segment-btn-active" : ""}`}
                >
                  Transcript
                </button>
                <button
                  type="button"
                  onClick={() => setRailTab("comments")}
                  className={`segment-btn ${railTab === "comments" ? "segment-btn-active" : ""}`}
                >
                  Notes
                </button>
              </div>
            </section>

            <SummaryCard
              aiStatus={status?.aiStatus}
              aiOutput={status?.aiOutput}
              errorMessage={status?.aiErrorMessage}
              shareableResultUrl={shareableResultUrl}
              chapters={chapters}
              onJumpToSeconds={requestSeek}
            />
          </div>

          {railTab === "transcript" ? (
            <TranscriptCard
              transcriptionStatus={status?.transcriptionStatus}
              transcript={status?.transcript}
              errorMessage={status?.transcriptErrorMessage}
              playbackTimeSeconds={playbackTimeSeconds}
              onSeekToSeconds={requestSeek}
              onSaveTranscript={saveTranscript}
            />
          ) : (
            <section className="workspace-card">
              <div className="mb-3">
                <p className="workspace-label">Workspace panel</p>
                <h2 className="workspace-title">Notes</h2>
                <p className="workspace-copy">Comments are intentionally deferred in this phase.</p>
              </div>
              <p className="panel-subtle rounded-md border-dashed px-3 py-3 text-sm">
                Keep transcript and AI analysis in the rail for now. Team comments can layer on this space later.
              </p>
            </section>
          )}

          {/* Full transcript paragraph view at bottom */}
          <TranscriptParagraph
            segments={transcriptSegments}
            transcriptionStatus={status?.transcriptionStatus}
            onSeekToSeconds={requestSeek}
          />
        </div>
      </div>
    </div>
  );
}

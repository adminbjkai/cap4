import { Link, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import {
  getJobStatus,
  getVideoStatus,
  saveWatchEdits,
  type JobStatusResponse,
  type VideoStatusResponse
} from "../lib/api";
import { upsertRecentSession } from "../lib/sessions";
import { PlayerCard } from "../components/PlayerCard";
import { SummaryCard } from "../components/SummaryCard";
import { StatusPanel } from "../components/StatusPanel";
import { TranscriptCard } from "../components/TranscriptCard";
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
      setErrorMessage(
        error instanceof Error
          ? `Status temporarily unavailable. We'll keep retrying automatically. (${error.message})`
          : "Status temporarily unavailable. We'll keep retrying automatically."
      );
    } finally {
      setLoading(false);
    }
  }, [videoId, jobId]);

  useEffect(() => {
    if (!videoId) return;
    void refresh();
  }, [videoId, refresh]);

  useEffect(() => {
    if (!videoId) return;
    if (hasReachedTerminalState(status)) return;
    const delayMs = consecutivePollFailures === 0 ? 2000 : Math.min(15000, 2000 * 2 ** consecutivePollFailures);
    const timeout = window.setTimeout(() => {
      void refresh();
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [videoId, status, refresh, consecutivePollFailures]);

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

  if (!videoId) {
    return (
      <div className="workspace-card">
        <p className="panel-danger">Missing video ID.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="workspace-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl space-y-1.5">
            <p className="workspace-label">Watch</p>
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
        </div>
        {jobStatus ? <p className="sr-only">Queue status: {jobStatus.status}</p> : null}

        {errorMessage ? <p className="panel-warning mt-4">{errorMessage}</p> : null}
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.48fr)_minmax(0,1.12fr)]">
        <PlayerCard
          resultKey={status?.resultKey ?? null}
          thumbnailKey={status?.thumbnailKey ?? null}
          seekRequest={seekRequest}
          onPlaybackTimeChange={setPlaybackTimeSeconds}
          chapters={chapters}
          onSeekToSeconds={requestSeek}
        />
        <div className="space-y-4">
          <section className="workspace-card p-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRailTab("transcript")}
                className={`segment-btn ${
                  railTab === "transcript" ? "segment-btn-active" : ""
                }`}
              >
                Transcript
              </button>
              <button
                type="button"
                onClick={() => setRailTab("comments")}
                className={`segment-btn ${
                  railTab === "comments" ? "segment-btn-active" : ""
                }`}
              >
                Comments
              </button>
            </div>
          </section>

          {railTab === "transcript" ? (
            <TranscriptCard
              transcriptionStatus={status?.transcriptionStatus}
              transcript={status?.transcript}
              errorMessage={status?.transcriptErrorMessage}
              playbackTimeSeconds={playbackTimeSeconds}
              onSeekToSeconds={requestSeek}
              onSaveTranscript={saveTranscript}
            />
          ) : null}

          {railTab === "comments" ? (
            <section className="workspace-card">
              <div className="mb-3">
                <p className="workspace-label">Workspace panel</p>
                <h2 className="workspace-title">Comments</h2>
                <p className="workspace-copy">Comment threads are not in scope for this build yet.</p>
              </div>
              <p className="panel-subtle rounded-md border-dashed px-3 py-3 text-sm">
                Placeholder tab only. Transcript, summary, and chapter navigation remain available in this watch experience.
              </p>
            </section>
          ) : null}
        </div>
      </div>

      <div className="space-y-5">
        <SummaryCard
          aiStatus={status?.aiStatus}
          aiOutput={status?.aiOutput}
          errorMessage={status?.aiErrorMessage}
          shareableResultUrl={shareableResultUrl}
          chapters={chapters}
          onJumpToSeconds={requestSeek}
        />
        <StatusPanel status={status} loading={loading} lastUpdatedAt={lastUpdatedAt} isAutoRefreshActive={isAutoRefreshActive} />
      </div>
    </div>
  );
}

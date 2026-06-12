import { useCallback, useEffect, useRef, useState } from "react";
import { getVideoDoc, generateVideoDoc, type DocResponse } from "../lib/api";
import { buildPublicObjectUrl, formatDuration } from "../lib/format";

type Props = {
  videoId: string | undefined;
  transcriptionStatus: string | undefined;
  videoTitle?: string | null;
  onSeekToSeconds: (seconds: number) => void;
  /** Poll cadence while a doc is generating (tests shrink this). */
  pollIntervalMs?: number;
};

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "video";
}

/**
 * Right-rail "Doc" tab: opt-in how-to document generated from the recording
 * (PIPELINE_V2). Generation is never automatic — it costs model credits and
 * only starts from the button here.
 */
export function DocCard({ videoId, transcriptionStatus, videoTitle, onSeekToSeconds, pollIntervalMs = 4000 }: Props) {
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const load = useCallback(async () => {
    if (!videoId) return;
    try {
      const next = await getVideoDoc(videoId);
      setDoc(next);
      if (next?.status !== "generating") stopPolling();
    } catch {
      // transient fetch failure — next poll/load retries
    } finally {
      setLoaded(true);
    }
  }, [videoId, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollTimer.current = window.setInterval(() => { void load(); }, pollIntervalMs);
  }, [stopPolling, load, pollIntervalMs]);

  useEffect(() => {
    void load();
    return stopPolling;
  }, [load, stopPolling]);

  useEffect(() => {
    if (doc?.status === "generating" && pollTimer.current === null) startPolling();
  }, [doc?.status, startPolling]);

  const handleGenerate = async () => {
    if (!videoId || requesting) return;
    setRequesting(true);
    setActionError(null);
    try {
      await generateVideoDoc(videoId);
      setDoc((cur) => (cur ? { ...cur, status: "generating", errorMessage: null } : cur));
      await load();
      startPolling();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not start doc generation.");
    } finally {
      setRequesting(false);
    }
  };

  const handleDownload = () => {
    if (!doc?.markdown) return;
    const blob = new Blob([doc.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(doc.title ?? videoTitle ?? "video")}_doc.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  if (!loaded) {
    return <div className="p-4 text-[13px] text-muted">Loading doc…</div>;
  }

  const transcriptReady = transcriptionStatus === "complete";

  if (!doc || (doc.status === "failed" && doc.sections.length === 0)) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-[13px] text-muted">
          Turn this recording into a step-by-step doc (runbook / tutorial / SOP) with screenshots.
          Generation is manual and uses Claude credits — nothing runs until you start it.
        </p>
        {doc?.status === "failed" && doc.errorMessage && (
          <div className="panel-danger text-[12px]">Last attempt failed: {doc.errorMessage}</div>
        )}
        {actionError && <div className="panel-danger text-[12px]">{actionError}</div>}
        {!transcriptReady && (
          <p className="text-[12px] text-muted">
            Available once transcription is complete (currently: {transcriptionStatus ?? "pending"}).
          </p>
        )}
        <button type="button" className="btn-primary" disabled={!transcriptReady || requesting} onClick={() => void handleGenerate()}>
          {requesting ? "Starting…" : doc?.status === "failed" ? "Retry doc generation" : "Generate doc"}
        </button>
      </div>
    );
  }

  if (doc.status === "generating") {
    return (
      <div className="space-y-3 p-4">
        <p className="text-[13px] text-muted">
          Generating doc… extracting frames and writing the document. This can take a few minutes;
          you can leave this tab and come back.
        </p>
        <div className="panel-subtle text-[12px] text-muted">Status: generating</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight">{doc.title}</h3>
          {doc.docType && (
            <span className="mt-1 inline-block rounded-md border border-default bg-surface-subtle px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              {doc.docType}
            </span>
          )}
        </div>
        <button type="button" className="btn-secondary shrink-0 text-[12px]" onClick={handleDownload}>
          Download .md
        </button>
      </div>

      {doc.sections.map((section) => (
        <section key={section.id}>
          <div className="mb-1 flex items-baseline gap-2">
            <h4 className="text-[13px] font-semibold">{section.heading}</h4>
            {section.startS !== null && (
              <button
                type="button"
                className="text-[11px] text-muted underline decoration-dotted hover:text-primary"
                onClick={() => onSeekToSeconds(section.startS!)}
                title="Jump to this part of the video"
              >
                {formatDuration(section.startS)}
                {section.endS !== null ? `–${formatDuration(section.endS)}` : ""}
              </button>
            )}
          </div>
          {section.bodyMd.trim() && (
            <p className="mb-2 whitespace-pre-wrap text-[13px] leading-relaxed">{section.bodyMd}</p>
          )}
          <ol className="space-y-3 pl-5 text-[13px]" style={{ listStyle: "decimal" }}>
            {section.steps.map((step) => (
              <li key={step.position}>
                <span>{step.text}</span>
                {step.frameKey && (
                  <img
                    src={buildPublicObjectUrl(step.frameKey)}
                    alt={step.alt ?? "step screenshot"}
                    className="mt-1.5 cursor-pointer rounded-lg border border-default"
                    onClick={() => step.frameTs !== null && onSeekToSeconds(step.frameTs)}
                    title={step.frameTs !== null ? `Jump to ${formatDuration(step.frameTs)}` : undefined}
                  />
                )}
                {step.callout && (
                  <blockquote className="mt-1.5 border-l-2 border-default pl-2 text-[12px] text-muted">
                    {step.callout}
                  </blockquote>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}

      {doc.confidenceNotes.length > 0 && (
        <div className="panel-subtle text-[12px] text-muted">
          <p className="mb-1 font-medium">Notes from generation</p>
          <ul className="list-disc pl-4">
            {doc.confidenceNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {doc.status === "failed" && doc.errorMessage && (
        <div className="panel-danger text-[12px]">Regeneration failed: {doc.errorMessage}</div>
      )}
      {actionError && <div className="panel-danger text-[12px]">{actionError}</div>}

      <div className="flex items-center justify-between border-t border-default pt-2 text-[11px] text-muted">
        <span>{doc.model ?? ""}</span>
        <button type="button" className="underline decoration-dotted hover:text-primary" disabled={requesting} onClick={() => void handleGenerate()}>
          Regenerate
        </button>
      </div>
    </div>
  );
}

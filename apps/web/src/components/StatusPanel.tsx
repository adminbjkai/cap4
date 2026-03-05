import type { VideoStatusResponse } from "../lib/api";

type StatusPanelProps = {
  status: VideoStatusResponse | null;
  loading: boolean;
  lastUpdatedAt: string | null;
  isAutoRefreshActive: boolean;
};

export function StatusPanel({ status, loading, lastUpdatedAt, isAutoRefreshActive }: StatusPanelProps) {
  if (!status && loading) {
    return (
      <section className="workspace-card">
        <h2 className="text-base font-semibold">Process status</h2>
        <p className="mt-2 text-sm legacy-muted">Loading latest status…</p>
      </section>
    );
  }

  const phase = status?.processingPhase ?? "pending";
  const progress = status?.processingProgress ?? 0;
  const phaseLabelMap: Record<string, string> = {
    pending: "Pending",
    queued: "Queued",
    downloading: "Downloading",
    probing: "Analyzing",
    processing: "Processing",
    uploading: "Uploading outputs",
    generating_thumbnail: "Generating thumbnail",
    complete: "Complete",
    failed: "Failed",
    cancelled: "Cancelled"
  };
  const phaseHelperMap: Record<string, string> = {
    pending: "Waiting for upload completion.",
    queued: "Job is queued and waiting for worker capacity.",
    downloading: "Worker is downloading the uploaded source file.",
    probing: "Worker is reading media metadata.",
    processing: "Worker is transcoding your recording.",
    uploading: "Worker is uploading processed artifacts.",
    generating_thumbnail: "Worker is generating the thumbnail.",
    complete: "Processing finished. Result and thumbnail are ready.",
    failed: "Processing failed. Review the error details and retry from the record flow.",
    cancelled: "Processing was cancelled."
  };
  const steps = [
    { key: "queued", label: "Queued", rank: 10 },
    { key: "processing", label: "Processing", rank: 40 },
    { key: "complete", label: "Complete", rank: 70 }
  ];
  const phaseRankMap: Record<string, number> = {
    pending: 0,
    queued: 10,
    downloading: 20,
    probing: 30,
    processing: 40,
    uploading: 50,
    generating_thumbnail: 60,
    complete: 70,
    failed: 80,
    cancelled: 90
  };
  const rank = phaseRankMap[phase] ?? 0;
  const phaseLabel = phaseLabelMap[phase] ?? phase;
  const helperText = phaseHelperMap[phase] ?? "Status update received.";
  const isFailureTerminal = phase === "failed" || phase === "cancelled";

  return (
    <section
      className={`workspace-card ${isFailureTerminal ? "border-red-200" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="workspace-label">System status</p>
          <h2 className="workspace-title">Processing lifecycle</h2>
          <p className="workspace-copy">Pipeline health across processing, transcript, and AI.</p>
        </div>
        <span
          className={`status-chip ${
            isFailureTerminal ? "border-red-200 bg-red-100 text-red-700" : ""
          }`}
        >
          {phaseLabel}
        </span>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <div className="panel-subtle px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted">Process</p>
          <p className="text-sm font-medium capitalize">{phase}</p>
        </div>
        <div className="panel-subtle px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted">Transcript</p>
          <p className="text-sm font-medium capitalize">{status?.transcriptionStatus ?? "not_started"}</p>
        </div>
        <div className="panel-subtle px-3 py-2.5">
          <p className="text-xs uppercase tracking-wide text-muted">AI</p>
          <p className="text-sm font-medium capitalize">{status?.aiStatus ?? "not_started"}</p>
        </div>
      </div>

      <ol className="mb-3 grid grid-cols-3 gap-2">
        {steps.map((step) => {
          const active = step.key === "complete" ? phase === "complete" : rank >= step.rank;
          return (
            <li
              key={step.key}
              className={`rounded-md border px-2 py-1 text-center text-xs font-medium ${
                active
                  ? "border-accent-300 bg-accent-50 text-accent-700"
                  : "panel-subtle border px-2 py-1 text-muted"
              }`}
            >
              {step.label}
            </li>
          );
        })}
      </ol>

      <div className="progress-track h-2 w-full overflow-hidden rounded-full">
        <div
          className={`h-full transition-all duration-300 ${isFailureTerminal ? "bg-red-500" : "bg-accent-600"}`}
          style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
        />
      </div>
      <p className="mt-2 text-sm legacy-muted">Progress: {progress}%</p>
      <p className="mt-1 text-xs text-muted">{helperText}</p>
      <p className="mt-2 text-xs text-muted">
        Last updated: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleString() : "Waiting for first status update..."}
      </p>
      <p className="mt-1 text-xs text-muted">
        Auto-refresh: {isAutoRefreshActive ? "Active until processing, transcript, and AI reach terminal states." : "Stopped (all statuses are terminal)."}
      </p>

      {loading ? <p className="mt-3 text-sm text-muted">Refreshing status…</p> : null}
      {status?.errorMessage ? <p className="panel-danger mt-3">{status.errorMessage}</p> : null}
    </section>
  );
}

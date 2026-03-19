import type { ProviderStatusResponse } from "../lib/api";

type ProviderStatusPanelProps = {
  data: ProviderStatusResponse | null;
  loading?: boolean;
  errorMessage?: string | null;
  compact?: boolean;
};

const STATE_LABELS: Record<ProviderStatusResponse["providers"][number]["state"], string> = {
  healthy: "Healthy",
  active: "Active",
  degraded: "Degraded",
  idle: "Idle",
  unavailable: "Unavailable"
};

const STATE_STYLES: Record<ProviderStatusResponse["providers"][number]["state"], string> = {
  healthy: "status-chip-success",
  active: "status-chip-info",
  degraded: "status-chip-warning",
  idle: "",
  unavailable: "status-chip-danger"
};

function formatTimestamp(value: string | null): string {
  if (!value) return "No successful runs yet";
  return new Date(value).toLocaleString();
}

export function ProviderStatusPanel({ data, loading = false, errorMessage = null, compact = false }: ProviderStatusPanelProps) {
  return (
    <section className="workspace-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="workspace-label">Providers</p>
          <h2 className="workspace-title">{compact ? "Provider health" : "System provider status"}</h2>
          <p className="workspace-copy">
            Operational state for Deepgram transcription and Groq summaries, derived from configuration and recent job outcomes.
          </p>
        </div>
        <span className="status-chip status-chip-compact">
          Checked: {data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString() : "Waiting..."}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(data?.providers ?? []).map((provider) => (
          <article key={provider.key} className="provider-status-card panel-subtle space-y-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{provider.label}</p>
                <p className="text-xs uppercase tracking-[0.16em] text-muted">{provider.purpose}</p>
              </div>
              <span className={`status-chip ${STATE_STYLES[provider.state]}`}>{STATE_LABELS[provider.state]}</span>
            </div>

            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Model</p>
                <p className="mt-1 break-words text-secondary">{provider.model ?? "Not set"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Configured</p>
                <p className="mt-1 text-secondary">{provider.configured ? "Yes" : "No"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs uppercase tracking-wide text-muted">Endpoint</p>
                <p className="mt-1 break-all text-secondary">{provider.baseUrl ?? "Not set"}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Last success</p>
                <p className="mt-1 text-secondary">{formatTimestamp(provider.lastSuccessAt)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Latest job</p>
                <p className="mt-1 text-secondary">
                  {provider.lastJob ? `${provider.lastJob.status} · #${provider.lastJob.id}` : "No jobs yet"}
                </p>
              </div>
            </div>

            {provider.lastJob?.lastError ? <p className="panel-warning">{provider.lastJob.lastError}</p> : null}
          </article>
        ))}
      </div>

      {loading ? <p className="mt-3 text-sm text-muted">Refreshing provider status…</p> : null}
      {errorMessage ? <p className="panel-warning mt-3">{errorMessage}</p> : null}
    </section>
  );
}

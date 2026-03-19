import type { ProviderStatusResponse, VideoStatusResponse } from '../lib/api';
import { ProviderStatusPanel } from './ProviderStatusPanel';

type StatusPanelProps = {
  status: VideoStatusResponse | null;
  loading: boolean;
  lastUpdatedAt: string | null;
  isAutoRefreshActive: boolean;
  providerStatus: ProviderStatusResponse | null;
  providerStatusError: string | null;
};

export function StatusPanel({
  status,
  loading,
  lastUpdatedAt,
  isAutoRefreshActive,
  providerStatus,
  providerStatusError,
}: StatusPanelProps) {
  if (!status && loading) {
    return (
      <div className="space-y-4">
        <section className="workspace-card">
          <h2 className="text-base font-semibold">Process status</h2>
          <p className="mt-2 text-sm text-hint">Loading latest status…</p>
        </section>
        <ProviderStatusPanel
          data={providerStatus}
          loading={loading}
          errorMessage={providerStatusError}
          compact
        />
      </div>
    );
  }

  const phase = status?.processingPhase ?? 'pending';
  const progress = status?.processingProgress ?? 0;
  const phaseLabelMap: Record<string, string> = {
    pending: 'Pending',
    queued: 'Queued',
    downloading: 'Downloading',
    probing: 'Analyzing',
    processing: 'Transcoding',
    uploading: 'Uploading',
    generating_thumbnail: 'Thumbnail',
    complete: 'Complete',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  const phaseHelperMap: Record<string, string> = {
    pending: 'Waiting for upload completion.',
    queued: 'Queued for processing. The worker has accepted the job and will start shortly.',
    downloading: 'Downloading the uploaded source into the media pipeline.',
    probing: 'Analyzing source media to verify duration, dimensions, frame rate, and audio.',
    processing: 'Transcoding the recording into the shareable output format.',
    uploading: 'Uploading processed video assets back to object storage.',
    generating_thumbnail: 'Capturing and publishing the preview thumbnail.',
    complete: 'Processing finished. Result and thumbnail are ready.',
    failed: 'Processing failed. Review the error details and retry from the record flow.',
    cancelled: 'Processing was cancelled.',
  };
  const currentStepLabelMap: Record<string, string> = {
    pending: 'Waiting',
    queued: 'Queued',
    downloading: 'Downloading source',
    probing: 'Analyzing source media',
    processing: 'Transcoding video',
    uploading: 'Uploading outputs',
    generating_thumbnail: 'Generating thumbnail',
    complete: 'Ready',
    failed: 'Processing failed',
    cancelled: 'Processing cancelled',
  };
  const steps = [
    { key: 'queued', label: 'Queued', rank: 10 },
    { key: 'downloading', label: 'Downloading', rank: 20 },
    { key: 'probing', label: 'Analyzing', rank: 30 },
    { key: 'processing', label: 'Transcoding', rank: 40 },
    { key: 'uploading', label: 'Uploading', rank: 50 },
    { key: 'generating_thumbnail', label: 'Thumbnail', rank: 60 },
    { key: 'complete', label: 'Complete', rank: 70 },
  ] as const;
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
    cancelled: 90,
  };
  const rank = phaseRankMap[phase] ?? 0;
  const phaseLabel = phaseLabelMap[phase] ?? phase;
  const helperText = phaseHelperMap[phase] ?? 'Status update received.';
  const currentStepLabel = currentStepLabelMap[phase] ?? 'Updating';
  const isFailureTerminal = phase === 'failed' || phase === 'cancelled';
  const progressWidth = Math.max(4, Math.min(100, progress));
  const phaseChipClass = isFailureTerminal
    ? 'status-chip-danger'
    : phase === 'complete'
      ? 'status-chip-success'
      : 'status-chip-processing';

  return (
    <div className="space-y-4">
      <section className="workspace-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="workspace-label">System status</p>
            <h2 className="workspace-title">Processing lifecycle</h2>
            <p className="workspace-copy">Pipeline health across processing, transcript, and AI.</p>
          </div>
          <span className={`status-chip ${phaseChipClass}`}>{phaseLabel}</span>
        </div>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="panel-subtle px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">Process</p>
            <p className="text-sm font-medium capitalize">{phase}</p>
          </div>
          <div className="panel-subtle px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">Current step</p>
            <p className="text-sm font-medium">{currentStepLabel}</p>
          </div>
          <div className="panel-subtle px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">Transcript</p>
            <p className="text-sm font-medium capitalize">
              {status?.transcriptionStatus ?? 'not_started'}
            </p>
          </div>
          <div className="panel-subtle px-3 py-2.5">
            <p className="text-xs uppercase tracking-wide text-muted">AI</p>
            <p className="text-sm font-medium capitalize">{status?.aiStatus ?? 'not_started'}</p>
          </div>
        </div>

        <ol className="mb-4 grid gap-2 sm:grid-cols-4 xl:grid-cols-7">
          {steps.map(step => {
            const isComplete =
              rank > step.rank || (step.key === 'complete' && phase === 'complete');
            const isActive = phase === step.key;
            const isUpcoming = !isComplete && !isActive;
            return (
              <li
                key={step.key}
                className={`status-step ${
                  isActive
                    ? 'status-step-active'
                    : isComplete
                      ? 'status-step-complete'
                      : 'status-step-pending'
                }`}
              >
                <div
                  className={`status-step-dot ${
                    isActive
                      ? 'status-step-dot-active'
                      : isComplete
                        ? 'status-step-dot-complete'
                        : 'status-step-dot-pending'
                  }`}
                >
                  {isComplete ? '✓' : step.rank / 10}
                </div>
                {step.label}
                {isActive ? (
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">Current</p>
                ) : null}
                {isUpcoming ? (
                  <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">Pending</p>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-sm font-medium">{currentStepLabel}</p>
          <p className="text-sm font-semibold">{progress}%</p>
        </div>
        <div className="progress-track h-3 w-full overflow-hidden rounded-full">
          <div
            className={`h-full transition-all duration-500 ${isFailureTerminal ? '' : 'progress-active-bar'}`}
            style={{
              width: `${progressWidth}%`,
              background: isFailureTerminal ? 'var(--status-danger-gradient)' : undefined,
            }}
          />
        </div>
        <p className="mt-2 text-xs text-muted">{helperText}</p>
        <p className="mt-2 text-xs text-muted">
          Last updated:{' '}
          {lastUpdatedAt
            ? new Date(lastUpdatedAt).toLocaleString()
            : 'Waiting for first status update...'}
        </p>
        <p className="mt-1 text-xs text-muted">
          Auto-refresh:{' '}
          {isAutoRefreshActive
            ? 'Active until processing, transcript, and AI reach terminal states.'
            : 'Stopped (all statuses are terminal).'}
        </p>

        {loading ? <p className="mt-3 text-sm text-muted">Refreshing status…</p> : null}
        {status?.errorMessage ? <p className="panel-danger mt-3">{status.errorMessage}</p> : null}
      </section>
      <ProviderStatusPanel
        data={providerStatus}
        loading={loading}
        errorMessage={providerStatusError}
        compact
      />
    </div>
  );
}

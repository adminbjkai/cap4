type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmationDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  errorMessage = null,
  onCancel,
  onConfirm
}: ConfirmationDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div className="dialog-surface workspace-card w-full max-w-md p-5 shadow-2xl">
        <p className="workspace-label">Confirm action</p>
        <h2 className="mt-1 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-secondary">{message}</p>
        {errorMessage ? <p className="panel-danger mt-4">{errorMessage}</p> : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary px-3 py-1.5 text-sm">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

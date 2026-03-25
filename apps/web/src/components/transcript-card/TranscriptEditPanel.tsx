import type { KeyboardEvent } from "react";

type TranscriptEditPanelProps = {
  compact: boolean;
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSave: () => void;
  onCancel: () => void;
};

export function TranscriptEditPanel({
  compact,
  draftText,
  isSaving,
  saveError,
  onDraftChange,
  onKeyDown,
  onSave,
  onCancel,
}: TranscriptEditPanelProps) {
  return (
    <div className={`panel-subtle space-y-2 rounded-lg p-3 ${compact ? "mx-2.5 mb-2.5" : ""}`}>
      <textarea
        value={draftText}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="input-control min-h-48 rounded-lg p-2.5 text-[13px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="btn-primary px-2.5 py-1 text-xs"
        >
          {isSaving ? "Saving…" : "Save transcript"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSaving}
          className="btn-secondary px-2.5 py-1 text-xs"
        >
          Cancel
        </button>
        <span className="text-[11px] text-muted">Cmd+Enter to save • Esc to cancel</span>
        {saveError && <span className="text-[11px] text-red-700">{saveError}</span>}
      </div>
    </div>
  );
}

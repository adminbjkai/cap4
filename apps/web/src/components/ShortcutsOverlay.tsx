type ShortcutGroup = {
  title: string;
  items: Array<{ keys: string; action: string }>;
};

type ShortcutsOverlayProps = {
  open: boolean;
  onClose: () => void;
};

const GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    items: [
      { keys: "Cmd/Ctrl + K", action: "Open command palette" },
      { keys: "G H", action: "Go home" },
      { keys: "G R", action: "Go record" },
      { keys: "?", action: "Show this shortcuts list" },
      { keys: "Esc", action: "Close modal or dialog" },
    ],
  },
  {
    title: "Video Player",
    items: [
      { keys: "Space / K", action: "Play or pause" },
      { keys: "J / L", action: "Seek -10s / +10s" },
      { keys: "Left / Right", action: "Seek -5s / +5s" },
      { keys: "Up / Down", action: "Volume +10% / -10%" },
      { keys: "M", action: "Toggle mute" },
      { keys: "F", action: "Toggle fullscreen" },
      { keys: "[ / ]", action: "Slower / faster" },
      { keys: "0 - 9", action: "Seek 0% to 90%" },
    ],
  },
];

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop fixed inset-0 z-[70] flex items-center justify-center px-4 py-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="dialog-surface w-full max-w-2xl rounded-xl border p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="workspace-label">Power User</p>
            <h2 className="text-xl font-semibold">Keyboard shortcuts</h2>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary px-2.5 py-1 text-xs">
            Close
          </button>
        </div>

        <div className="space-y-4">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item) => (
                  <li key={`${group.title}-${item.keys}`} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border-default)", background: "var(--bg-surface-subtle)" }}>
                    <span style={{ color: "var(--text-secondary)" }}>{item.action}</span>
                    <kbd className="rounded-md border px-2 py-0.5 font-mono text-xs" style={{ borderColor: "var(--border-strong)", color: "var(--text-primary)", background: "var(--bg-surface)" }}>
                      {item.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

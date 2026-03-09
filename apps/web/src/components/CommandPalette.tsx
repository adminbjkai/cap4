import { useEffect, useMemo, useRef, useState } from "react";

export type CommandPaletteAction = {
  id: string;
  title: string;
  subtitle?: string;
  keywords?: string[];
  onSelect: () => void;
};

type CommandPaletteProps = {
  open: boolean;
  actions: CommandPaletteAction[];
  onClose: () => void;
};

export function CommandPalette({ open, actions, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filteredActions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter((action) => {
      const haystack = [action.title, action.subtitle ?? "", ...(action.keywords ?? [])]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [actions, query]);

  useEffect(() => {
    if (activeIndex < filteredActions.length) return;
    setActiveIndex(0);
  }, [activeIndex, filteredActions.length]);

  const selectAction = (index: number) => {
    const next = filteredActions[index];
    if (!next) return;
    next.onSelect();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="dialog-backdrop fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="dialog-surface w-full max-w-2xl overflow-hidden rounded-xl border shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border-default)" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((prev) => Math.min(prev + 1, Math.max(filteredActions.length - 1, 0)));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((prev) => Math.max(prev - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                selectAction(activeIndex);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            className="input-control"
            placeholder="Search videos, pages, and actions"
            aria-label="Search commands"
          />
        </div>

        <ul className="max-h-[55vh] overflow-y-auto p-2">
          {filteredActions.length === 0 ? (
            <li className="rounded-lg px-3 py-6 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              No matching commands
            </li>
          ) : (
            filteredActions.map((action, index) => {
              const active = index === activeIndex;
              return (
                <li key={action.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectAction(index)}
                    className="w-full rounded-lg px-3 py-2.5 text-left transition-colors"
                    style={{
                      background: active ? "var(--accent-blue-subtle)" : "transparent",
                      color: "var(--text-primary)",
                    }}
                  >
                    <p className="text-sm font-medium">{action.title}</p>
                    {action.subtitle ? (
                      <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                        {action.subtitle}
                      </p>
                    ) : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

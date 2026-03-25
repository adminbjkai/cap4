import { useEffect, useRef, useState, type ChangeEvent } from "react";

export function NotesPanel({ videoId }: { videoId: string }) {
  const storageKey = `cap4:notes:${videoId}`;
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  });
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setNotes(value);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, value);
      } catch {
        // Ignore localStorage quota and availability issues.
      }
      setSavedAt(Date.now());
    }, 600);
  };

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  return (
    <div className="flex h-full flex-col px-3 py-3">
      <textarea
        value={notes}
        onChange={handleChange}
        placeholder="Your private notes about this video…"
        className="notes-textarea flex-1 min-h-0"
        style={{ minHeight: "200px" }}
        spellCheck
      />
      {savedAt && (
        <p className="mt-1.5 text-[11px] text-muted select-none">
          Saved locally
        </p>
      )}
    </div>
  );
}

import { useEffect, useRef } from "react";

type PlayerShortcutHandlers = {
  enabled?: boolean;
  onPlayPause?: () => void;
  onSeekBy?: (seconds: number) => void;
  onSeekToPercent?: (percent: number) => void;
  onVolumeBy?: (delta: number) => void;
  onRateBy?: (delta: number) => void;
  onToggleMute?: () => void;
  onToggleFullscreen?: () => void;
};

type UseKeyboardShortcutsOptions = {
  enabled?: boolean;
  onToggleCommandPalette?: () => void;
  onToggleShortcutsOverlay?: () => void;
  onEscape?: () => void;
  onGoHome?: () => void;
  onGoRecord?: () => void;
  player?: PlayerShortcutHandlers;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.closest("[contenteditable='true']")) return true;
  return false;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const optionsRef = useRef(options);
  const chordRef = useRef<{ key: "g" | null; expiresAt: number }>({ key: null, expiresAt: 0 });

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const opts = optionsRef.current;
      if (opts.enabled === false) return;

      const key = event.key;
      const lowerKey = key.toLowerCase();
      const typing = isEditableTarget(event.target);

      // Cmd/Ctrl + K opens command palette.
      if ((event.metaKey || event.ctrlKey) && lowerKey === "k") {
        event.preventDefault();
        opts.onToggleCommandPalette?.();
        return;
      }

      // Escape is always handled when a consumer is listening.
      if (key === "Escape") {
        opts.onEscape?.();
        return;
      }

      if (typing) return;

      // ? opens shortcuts overlay.
      if (key === "?") {
        event.preventDefault();
        opts.onToggleShortcutsOverlay?.();
        return;
      }

      // Chord navigation: g then h / r.
      const now = Date.now();
      if (chordRef.current.key === "g" && chordRef.current.expiresAt > now) {
        if (lowerKey === "h") {
          event.preventDefault();
          chordRef.current = { key: null, expiresAt: 0 };
          opts.onGoHome?.();
          return;
        }
        if (lowerKey === "r") {
          event.preventDefault();
          chordRef.current = { key: null, expiresAt: 0 };
          opts.onGoRecord?.();
          return;
        }
      }

      if (lowerKey === "g") {
        chordRef.current = { key: "g", expiresAt: now + 1200 };
      }

      const player = opts.player;
      if (!player?.enabled) return;

      if (key === " " || lowerKey === "k") {
        event.preventDefault();
        player.onPlayPause?.();
        return;
      }

      if (lowerKey === "j") {
        event.preventDefault();
        player.onSeekBy?.(-10);
        return;
      }

      if (lowerKey === "l") {
        event.preventDefault();
        player.onSeekBy?.(10);
        return;
      }

      if (key === "ArrowLeft") {
        event.preventDefault();
        player.onSeekBy?.(-5);
        return;
      }

      if (key === "ArrowRight") {
        event.preventDefault();
        player.onSeekBy?.(5);
        return;
      }

      if (key === "ArrowUp") {
        event.preventDefault();
        player.onVolumeBy?.(0.1);
        return;
      }

      if (key === "ArrowDown") {
        event.preventDefault();
        player.onVolumeBy?.(-0.1);
        return;
      }

      if (lowerKey === "m") {
        event.preventDefault();
        player.onToggleMute?.();
        return;
      }

      if (lowerKey === "f") {
        event.preventDefault();
        player.onToggleFullscreen?.();
        return;
      }

      if (key === "[") {
        event.preventDefault();
        player.onRateBy?.(-0.25);
        return;
      }

      if (key === "]") {
        event.preventDefault();
        player.onRateBy?.(0.25);
        return;
      }

      if (/^[0-9]$/.test(key)) {
        event.preventDefault();
        player.onSeekToPercent?.(Number(key) / 10);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

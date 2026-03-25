import { useEffect, useMemo, useState } from "react";

export function useVerifiedSegments(videoId: string | undefined) {
  const storageKey = useMemo(
    () => `cap4:verified-segments:${videoId ?? "unknown"}`,
    [videoId]
  );

  const [verifiedSegments, setVerifiedSegments] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? new Set(JSON.parse(stored) as number[]) : new Set();
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      setVerifiedSegments(stored ? new Set(JSON.parse(stored) as number[]) : new Set());
    } catch {
      setVerifiedSegments(new Set());
    }
  }, [storageKey]);

  useEffect(() => {
    if (verifiedSegments.size === 0) {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(Array.from(verifiedSegments)));
    } catch {
      /* quota exceeded */
    }
  }, [storageKey, verifiedSegments]);

  return { verifiedSegments, setVerifiedSegments };
}

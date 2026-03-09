export type RecentSession = {
  videoId: string;
  jobId?: number;
  createdAt: string;
  processingPhase?: string;
  processingProgress?: number;
  resultKey?: string | null;
  thumbnailKey?: string | null;
  errorMessage?: string | null;
};

const KEY = "cap4.recent_sessions";

export function loadRecentSessions(): RecentSession[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((row) => typeof row?.videoId === "string")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  } catch {
    return [];
  }
}

export function upsertRecentSession(session: RecentSession): void {
  const current = loadRecentSessions();
  const idx = current.findIndex((item) => item.videoId === session.videoId);
  const merged = idx >= 0 ? { ...current[idx], ...session } : session;

  if (idx >= 0) {
    current[idx] = merged;
  } else {
    current.unshift(merged);
  }

  const trimmed = current
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 50);

  window.localStorage.setItem(KEY, JSON.stringify(trimmed));
}

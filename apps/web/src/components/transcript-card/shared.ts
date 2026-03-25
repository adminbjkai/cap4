export type TranscriptLine = {
  index: number;
  startSeconds: number;
  endSeconds: number | null;
  text: string;
  originalText: string | null;
  confidence: number | null;
  speaker: number | null;
};

const SPEAKER_PALETTE = [
  "#7dd3fc",
  "#fdba74",
  "#86efac",
  "#d8b4fe",
  "#fda4af",
  "#99f6e4",
  "#fcd34d",
  "#a5b4fc",
];

export function defaultSpeakerLabel(speaker: number): string {
  return `Speaker ${speaker + 1}`;
}

export function speakerColor(speaker: number): string {
  return SPEAKER_PALETTE[Math.abs(speaker) % SPEAKER_PALETTE.length]!;
}

export function normalizeSpeakerLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const keyNum = Number(rawKey);
    if (!Number.isInteger(keyNum) || keyNum < 0) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    out[String(keyNum)] = value.slice(0, 80);
  }
  return out;
}

export function formatTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.floor(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

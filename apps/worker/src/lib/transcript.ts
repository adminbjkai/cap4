import type { TranscriptSegment } from "../providers/deepgram.js";

function formatVttTime(secondsInput: number): string {
  const totalMs = Math.max(0, Math.round(secondsInput * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(
    milliseconds
  ).padStart(3, "0")}`;
}

export function buildWebVtt(segments: TranscriptSegment[]): string {
  const cues = segments
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => {
      const start = formatVttTime(segment.startSeconds);
      const end = formatVttTime(Math.max(segment.endSeconds, segment.startSeconds));
      return `${index + 1}\n${start} --> ${end}\n${segment.text.trim()}`;
    });

  if (cues.length === 0) {
    return "WEBVTT\n";
  }

  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

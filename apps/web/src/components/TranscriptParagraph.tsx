import { useMemo } from "react";

interface TranscriptSegment {
  startSeconds?: number;
  endSeconds?: number;
  text?: string;
}

interface Paragraph {
  text: string;
  startSeconds: number;
}

interface TranscriptParagraphProps {
  segments: TranscriptSegment[];
  transcriptionStatus?: string;
  onSeekToSeconds?: (seconds: number) => void;
}

function formatTimestamp(secondsInput: number): string {
  const totalSeconds = Math.max(0, Math.floor(secondsInput));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function TranscriptParagraph({
  segments,
  transcriptionStatus,
  onSeekToSeconds
}: TranscriptParagraphProps) {
  const paragraphs = useMemo<Paragraph[]>(() => {
    if (!segments || segments.length === 0) return [];

    const result: Paragraph[] = [];
    let currentText = "";
    let currentStart = 0;
    let segmentCount = 0;
    let paragraphStarted = false;

    for (const segment of segments) {
      const text = String(segment.text ?? "").trim();
      if (!text) continue;

      // Capture start time of the first segment in this paragraph
      if (!paragraphStarted) {
        const raw = segment.startSeconds;
        currentStart = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
        paragraphStarted = true;
      }

      if (currentText) currentText += " ";
      currentText += text;
      segmentCount++;

      // Break on sentence-ending punctuation after 3+ segments, or every 6 segments
      const endsSentence = /[.!?]$/.test(text);
      if (segmentCount >= 6 || (endsSentence && segmentCount >= 3)) {
        result.push({ text: currentText, startSeconds: currentStart });
        currentText = "";
        segmentCount = 0;
        paragraphStarted = false;
      }
    }

    // Flush remaining text
    if (currentText) {
      result.push({ text: currentText, startSeconds: currentStart });
    }

    return result;
  }, [segments]);

  if (transcriptionStatus !== "complete" || paragraphs.length === 0) {
    return null;
  }

  const isSeekable = typeof onSeekToSeconds === "function";

  return (
    <section className="workspace-card">
      <div className="mb-4">
        <p className="workspace-label">Document View</p>
        <h3 className="workspace-title">Full Transcript</h3>
        <p className="workspace-copy">
          {isSeekable
            ? "Click any paragraph to jump to that point in the video."
            : "Complete transcript in paragraph format for easy reading."}
        </p>
      </div>

      <div className="space-y-3">
        {paragraphs.map((paragraph, index) =>
          isSeekable ? (
            <button
              key={index}
              type="button"
              onClick={() => onSeekToSeconds(paragraph.startSeconds)}
              className="group w-full text-left rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <span className="mr-2.5 inline-block font-mono text-xs text-muted group-hover:text-primary transition-colors">
                {formatTimestamp(paragraph.startSeconds)}
              </span>
              <span className="text-sm leading-relaxed text-foreground">{paragraph.text}</span>
            </button>
          ) : (
            <p key={index} className="px-3 text-sm leading-relaxed text-foreground">
              <span className="mr-2.5 inline-block font-mono text-xs text-muted">
                {formatTimestamp(paragraph.startSeconds)}
              </span>
              {paragraph.text}
            </p>
          )
        )}
      </div>
    </section>
  );
}

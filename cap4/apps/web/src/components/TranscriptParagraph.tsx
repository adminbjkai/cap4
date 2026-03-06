import { useMemo } from "react";

interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
}

interface TranscriptParagraphProps {
  segments: TranscriptSegment[];
  transcriptionStatus?: string;
}

export function TranscriptParagraph({
  segments,
  transcriptionStatus
}: TranscriptParagraphProps) {
  const paragraphs = useMemo(() => {
    if (!segments || segments.length === 0) return [];

    // Group segments into paragraphs (roughly every 5-8 segments or by pauses)
    const result: string[] = [];
    let currentParagraph = "";
    let segmentCount = 0;

    for (const segment of segments) {
      const text = segment.text.trim();
      if (!text) continue;

      // Add space if continuing paragraph
      if (currentParagraph) {
        currentParagraph += " ";
      }
      currentParagraph += text;
      segmentCount++;

      // Start new paragraph after ~6 segments or if text ends with sentence-ending punctuation
      const endsSentence = /[.!?]$/.test(text);
      if (segmentCount >= 6 || (endsSentence && segmentCount >= 3)) {
        if (currentParagraph) {
          result.push(currentParagraph);
          currentParagraph = "";
          segmentCount = 0;
        }
      }
    }

    // Add remaining text
    if (currentParagraph) {
      result.push(currentParagraph);
    }

    return result;
  }, [segments]);

  if (transcriptionStatus !== "complete" || paragraphs.length === 0) {
    return null;
  }

  return (
    <section className="workspace-card mt-8">
      <div className="mb-4">
        <p className="workspace-label">Document View</p>
        <h3 className="workspace-title">Full Transcript</h3>
        <p className="workspace-copy">
          Complete transcript in paragraph format for easy reading.
        </p>
      </div>

      <div className="prose prose-sm prose-gray max-w-none">
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="mb-4 leading-relaxed text-foreground">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}

import { useState, type ReactNode } from "react";
import {
  formatTimestamp,
  speakerColor,
  type TranscriptLine,
} from "./shared";

type TranscriptLinesProps = {
  compact: boolean;
  transcriptLines: TranscriptLine[];
  isReviewMode: boolean;
  hiddenSpeakers: Set<number>;
  activeLineIndex: number;
  textViewMode: "current" | "original";
  transcriptText: string;
  originalTranscriptText: string;
  transcriptVttKey: string | null | undefined;
  renderLineText: (text: string, lineIndex: number) => ReactNode;
  verifiedSegments: Set<number>;
  onToggleVerified: (segmentIndex: number) => void;
  onSeekToSeconds: (seconds: number) => void;
  getSpeakerLabel: (speaker: number | null) => string | null;
  editingSpeaker: number | null;
  editingSpeakerLineIndex: number | null;
  speakerDraft: string;
  onSpeakerDraftChange: (value: string) => void;
  isSavingSpeaker: boolean;
  onStartSpeakerEdit: (speaker: number, lineIndex: number) => void;
  onCancelSpeakerEdit: () => void;
  onSaveSpeakerLabel: (speaker: number) => void;
};

export function TranscriptLines({
  compact,
  transcriptLines,
  isReviewMode,
  hiddenSpeakers,
  activeLineIndex,
  textViewMode,
  transcriptText,
  originalTranscriptText,
  transcriptVttKey,
  renderLineText,
  verifiedSegments,
  onToggleVerified,
  onSeekToSeconds,
  getSpeakerLabel,
  editingSpeaker,
  editingSpeakerLineIndex,
  speakerDraft,
  onSpeakerDraftChange,
  isSavingSpeaker,
  onStartSpeakerEdit,
  onCancelSpeakerEdit,
  onSaveSpeakerLabel,
}: TranscriptLinesProps) {
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);

  if (transcriptLines.length === 0) {
    return (
      <>
        <pre
          className={`overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed ${
            compact ? "px-3 py-2" : "scroll-panel max-h-[28rem] rounded-lg p-4"
          }`}
        >
          {textViewMode === "original" ? originalTranscriptText : transcriptText}
        </pre>
        {transcriptVttKey && (
          <span className={`block text-[11px] text-muted ${compact ? "px-3 pb-2" : ""}`}>
            VTT: <span className="font-mono">{transcriptVttKey}</span>
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={`relative space-y-0 ${
          compact ? "" : "scroll-panel max-h-[32rem] overflow-auto rounded-lg p-1"
        }`}
      >
        {transcriptLines.map((line, index) => {
          if (isReviewMode && (line.confidence === null || line.confidence >= 0.8)) return null;
          if (line.speaker !== null && hiddenSpeakers.has(line.speaker)) return null;

          const isActive = index === activeLineIndex && textViewMode === "current";
          const lineText =
            textViewMode === "original" && line.originalText ? line.originalText : line.text;
          const highlightedContent = renderLineText(lineText, index);
          const isVerified = verifiedSegments.has(line.index);
          const speakerName = getSpeakerLabel(line.speaker);
          const isEditingThisSpeaker =
            line.speaker !== null &&
            editingSpeaker === line.speaker &&
            editingSpeakerLineIndex === index;

          let confidenceClass = "";
          if (line.confidence !== null && line.confidence < 0.8) {
            confidenceClass = line.confidence < 0.6 ? "confidence-very-low" : "confidence-low";
          }

          return (
            <div
              key={`${line.index}-${line.startSeconds}`}
              data-transcript-line-index={index}
              onClick={() => onSeekToSeconds(line.startSeconds)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSeekToSeconds(line.startSeconds);
                }
              }}
              onMouseEnter={(event) => {
                setHoveredLineIndex(index);
                if (line.confidence !== null && line.confidence < 1.0) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top - 8 });
                }
              }}
              onMouseLeave={() => {
                setHoveredLineIndex(null);
                setTooltipPosition(null);
              }}
              className={`line-item w-full rounded-none px-3 py-2 text-left transition focus-visible:outline-none ${
                isActive ? "line-item-active" : ""
              }`}
              role="button"
              tabIndex={0}
            >
              <span className="mr-2 inline-block min-w-[44px] font-mono text-[11px] leading-[1.4] text-muted">
                {formatTimestamp(line.startSeconds)}
              </span>
              {line.speaker !== null && (
                <span
                  className="speaker-badge"
                  style={{ ["--speaker-color" as string]: speakerColor(line.speaker) }}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (isSavingSpeaker || isEditingThisSpeaker) return;
                    onStartSpeakerEdit(line.speaker as number, index);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (line.speaker === null || isSavingSpeaker) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!isEditingThisSpeaker) onStartSpeakerEdit(line.speaker, index);
                    }
                  }}
                >
                  {isEditingThisSpeaker ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        autoFocus
                        value={speakerDraft}
                        onChange={(event) => onSpeakerDraftChange(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            if (line.speaker !== null && !isSavingSpeaker) {
                              onSaveSpeakerLabel(line.speaker);
                            }
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            onCancelSpeakerEdit();
                          }
                        }}
                        className="speaker-badge-input"
                      />
                      <button
                        type="button"
                        className="speaker-badge-action"
                        disabled={isSavingSpeaker}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (line.speaker !== null && !isSavingSpeaker) {
                            onSaveSpeakerLabel(line.speaker);
                          }
                        }}
                      >
                        {isSavingSpeaker ? "..." : "Save"}
                      </button>
                      <button
                        type="button"
                        className="speaker-badge-action"
                        disabled={isSavingSpeaker}
                        onClick={(event) => {
                          event.stopPropagation();
                          onCancelSpeakerEdit();
                        }}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    speakerName
                  )}
                </span>
              )}
              <span className={`text-[13px] leading-[1.4] ${confidenceClass}`}>
                {highlightedContent}
              </span>
              {isVerified && (
                <span className="verified-marker ml-2 inline-flex" title="Verified">
                  <svg className="h-2 w-2" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
              )}
              {isReviewMode && !isVerified && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleVerified(line.index);
                  }}
                  className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700 hover:bg-green-200"
                  title="Mark as verified"
                >
                  ✓ Verify
                </button>
              )}
            </div>
          );
        })}

        {hoveredLineIndex !== null &&
          tooltipPosition &&
          transcriptLines[hoveredLineIndex]?.confidence !== null && (
            <div
              className="confidence-tooltip"
              style={{
                position: "fixed",
                left: `${tooltipPosition.x}px`,
                top: `${tooltipPosition.y}px`,
                transform: "translate(-50%, -100%)",
              }}
            >
              Confidence: {Math.round(transcriptLines[hoveredLineIndex]!.confidence! * 100)}%
            </div>
          )}
      </div>

      {transcriptVttKey && (
        <span className={`block text-[11px] text-muted ${compact ? "px-3 pb-2" : ""}`}>
          VTT: <span className="font-mono">{transcriptVttKey}</span>
        </span>
      )}
    </>
  );
}

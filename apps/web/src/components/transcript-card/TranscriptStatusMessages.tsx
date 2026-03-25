type TranscriptStatusMessagesProps = {
  compact: boolean;
  transcriptionStatus: string | undefined;
  transcriptTextLength: number;
  errorMessage: string | null | undefined;
};

export function TranscriptStatusMessages({
  compact,
  transcriptionStatus,
  transcriptTextLength,
  errorMessage,
}: TranscriptStatusMessagesProps) {
  return (
    <>
      {(transcriptionStatus === "queued" || transcriptionStatus === "processing") && (
        <p className={`legacy-muted ${compact ? "px-3 py-3 text-[13px]" : "text-sm"}`}>
          Transcription is running. Updates automatically.
        </p>
      )}
      {transcriptionStatus === "not_started" && (
        <p className={`legacy-muted ${compact ? "px-3 py-3 text-[13px]" : "text-sm"}`}>
          Transcription will start after processing completes.
        </p>
      )}
      {transcriptionStatus === "no_audio" && (
        <p className={`panel-subtle ${compact ? "m-3 text-[13px]" : ""}`}>
          No audio track was detected for this recording.
        </p>
      )}
      {transcriptionStatus === "failed" && (
        <p className={`panel-danger ${compact ? "m-3 text-[13px]" : ""}`}>
          {errorMessage
            ? `Transcription failed: ${errorMessage}`
            : "Transcription failed after retries."}
        </p>
      )}
      {transcriptionStatus === "complete" && transcriptTextLength === 0 && (
        <p className={`panel-subtle ${compact ? "m-3 text-[13px]" : ""}`}>
          Transcript completed, but no text was returned.
        </p>
      )}
    </>
  );
}

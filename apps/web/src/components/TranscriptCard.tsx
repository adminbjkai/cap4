import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { VideoStatusResponse } from '../lib/api';
import { TranscriptControls } from './transcript-card/TranscriptControls';
import { TranscriptEditPanel } from './transcript-card/TranscriptEditPanel';
import { TranscriptLines } from './transcript-card/TranscriptLines';
import { TranscriptStatusMessages } from './transcript-card/TranscriptStatusMessages';
import { useVerifiedSegments } from './transcript-card/useVerifiedSegments';
import {
  defaultSpeakerLabel,
  normalizeSpeakerLabels,
  speakerColor,
  type TranscriptLine,
} from './transcript-card/shared';

type TranscriptCardProps = {
  videoId: string | undefined;
  transcriptionStatus: VideoStatusResponse['transcriptionStatus'] | undefined;
  transcript: VideoStatusResponse['transcript'] | null | undefined;
  errorMessage: string | null | undefined;
  playbackTimeSeconds: number;
  onSeekToSeconds: (seconds: number) => void;
  onSaveTranscript: (text: string) => Promise<boolean>;
  onSaveSpeakerLabels: (labels: Record<string, string>) => Promise<boolean>;
  /** When true, omits the outer card wrapper — for embedding in the right rail */
  compact?: boolean;
};

export function TranscriptCard({
  videoId,
  transcriptionStatus,
  transcript,
  errorMessage,
  playbackTimeSeconds,
  onSeekToSeconds,
  onSaveTranscript,
  onSaveSpeakerLabels,
  compact = false,
}: TranscriptCardProps) {
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [textViewMode, setTextViewMode] = useState<'current' | 'original'>('current');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  // Confidence review mode
  const [isReviewMode, setIsReviewMode] = useState(false);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [speakerLabels, setSpeakerLabels] = useState<Record<string, string>>(() =>
    normalizeSpeakerLabels(transcript?.speakerLabels ?? {})
  );
  const [hiddenSpeakers, setHiddenSpeakers] = useState<Set<number>>(new Set());
  const [editingSpeaker, setEditingSpeaker] = useState<number | null>(null);
  const [editingSpeakerLineIndex, setEditingSpeakerLineIndex] = useState<number | null>(null);
  const [speakerDraft, setSpeakerDraft] = useState('');
  const [speakerSaveError, setSpeakerSaveError] = useState<string | null>(null);
  const [isSavingSpeaker, setIsSavingSpeaker] = useState(false);

  const { verifiedSegments, setVerifiedSegments } = useVerifiedSegments(videoId);

  const transcriptLines = useMemo<TranscriptLine[]>(() => {
    const segments = Array.isArray(transcript?.segments) ? transcript.segments : [];
    return segments
      .map((segment, index) => {
        const text = String(segment.text ?? '').trim();
        const start = Number(segment.startSeconds);
        const end = Number(segment.endSeconds);
        const confidence = typeof segment.confidence === 'number' ? segment.confidence : null;
        if (!text || !Number.isFinite(start)) return null;
        return {
          index,
          startSeconds: start,
          endSeconds: Number.isFinite(end) ? Math.max(start, end) : null,
          text,
          originalText:
            typeof segment.originalText === 'string' && segment.originalText.trim().length > 0
              ? segment.originalText
              : null,
          confidence,
          speaker:
            Number.isInteger(Number(segment.speaker)) && Number(segment.speaker) >= 0
              ? Number(segment.speaker)
              : null,
        };
      })
      .filter((line): line is TranscriptLine => Boolean(line))
      .sort((a, b) => a.startSeconds - b.startSeconds);
  }, [transcript?.segments]);

  useEffect(() => {
    setSpeakerLabels(normalizeSpeakerLabels(transcript?.speakerLabels ?? {}));
  }, [transcript?.speakerLabels]);

  const transcriptText = useMemo(() => {
    if (transcriptLines.length > 0) {
      return transcriptLines
        .map(line => line.text)
        .join('\n')
        .trim();
    }
    return transcript?.text?.trim() ?? '';
  }, [transcript?.text, transcriptLines]);

  const speakerIds = useMemo(() => {
    const unique = new Set<number>();
    for (const line of transcriptLines) {
      if (line.speaker !== null) unique.add(line.speaker);
    }
    return Array.from(unique.values()).sort((a, b) => a - b);
  }, [transcriptLines]);

  useEffect(() => {
    setHiddenSpeakers(prev => {
      if (speakerIds.length === 0) return new Set();
      const allowed = new Set(speakerIds);
      const next = new Set<number>();
      for (const speaker of prev) {
        if (allowed.has(speaker)) next.add(speaker);
      }
      return next;
    });
  }, [speakerIds]);

  // Find all matches for the search query
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const matches: Array<{
      lineIndex: number;
      matchText: string;
      startPos: number;
      endPos: number;
    }> = [];

    for (let i = 0; i < transcriptLines.length; i++) {
      const line = transcriptLines[i]!;
      const lineText =
        textViewMode === 'original' && line.originalText ? line.originalText : line.text;
      const lowerText = lineText.toLowerCase();
      let searchPos = 0;

      while (true) {
        const matchPos = lowerText.indexOf(query, searchPos);
        if (matchPos === -1) break;
        matches.push({
          lineIndex: i,
          matchText: lineText.substring(matchPos, matchPos + query.length),
          startPos: matchPos,
          endPos: matchPos + query.length,
        });
        searchPos = matchPos + 1;
      }
    }

    return matches;
  }, [searchQuery, transcriptLines, textViewMode]);

  // Confidence stats
  const confidenceStats = useMemo(() => {
    const withConfidence = transcriptLines.filter(line => line.confidence !== null);
    if (withConfidence.length === 0) return null;
    const highConfidenceCount = withConfidence.filter(line => line.confidence! >= 0.8).length;
    const percentage = Math.round((highConfidenceCount / withConfidence.length) * 100);
    return { percentage, total: withConfidence.length, highCount: highConfidenceCount };
  }, [transcriptLines]);

  // Uncertain segments (confidence < 80%)
  const uncertainSegments = useMemo(() => {
    return transcriptLines
      .map((line, idx) => ({ line, lineIndex: idx }))
      .filter(({ line }) => line.confidence !== null && line.confidence < 0.8);
  }, [transcriptLines]);

  const originalTranscriptText = useMemo(() => {
    const withOriginal = transcriptLines.filter(
      line => line.originalText && line.originalText.trim().length > 0
    );
    if (withOriginal.length > 0) {
      return withOriginal
        .map(line => line.originalText as string)
        .join('\n')
        .trim();
    }
    return transcriptText;
  }, [transcriptLines, transcriptText]);

  useEffect(() => {
    if (!isEditing) {
      setDraftText(transcriptText);
      setSaveError(null);
    }
  }, [isEditing, transcriptText]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timeout = window.setTimeout(() => setSaveFeedback(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [saveFeedback]);

  // Reset active match when search query changes (debounced)
  useEffect(() => {
    setActiveMatchIndex(searchQuery.trim() ? 0 : -1);
    if (searchDebounceRef.current) {
      window.clearTimeout(searchDebounceRef.current);
    }
  }, [searchQuery]);

  const activeLineIndex = useMemo(() => {
    if (transcriptLines.length === 0) return -1;
    const current = Number.isFinite(playbackTimeSeconds) ? Math.max(0, playbackTimeSeconds) : 0;
    const epsilon = 0.1;
    let nearestIndex = 0;
    for (let index = 0; index < transcriptLines.length; index += 1) {
      const line = transcriptLines[index]!;
      if (line.startSeconds <= current + epsilon) {
        nearestIndex = index;
        continue;
      }
      break;
    }
    return nearestIndex;
  }, [playbackTimeSeconds, transcriptLines]);

  useEffect(() => {
    if (activeLineIndex < 0 || isEditing) return;
    const container = transcriptScrollRef.current;
    if (!container) return;
    const activeNode = container.querySelector<HTMLElement>(
      `[data-transcript-line-index="${activeLineIndex}"]`
    );
    if (!activeNode) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = activeNode.getBoundingClientRect();
    const notFullyVisible =
      nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8;
    if (notFullyVisible) {
      activeNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeLineIndex, isEditing]);

  // Auto-scroll to active match
  useEffect(() => {
    if (activeMatchIndex < 0 || !searchQuery.trim() || isEditing) return;
    const match = searchMatches[activeMatchIndex];
    if (!match) return;

    const container = transcriptScrollRef.current;
    if (!container) return;

    const matchNode = container.querySelector<HTMLElement>(
      `[data-transcript-line-index="${match.lineIndex}"]`
    );
    if (!matchNode) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = matchNode.getBoundingClientRect();
    const notFullyVisible =
      nodeRect.top < containerRect.top + 8 || nodeRect.bottom > containerRect.bottom - 8;
    if (notFullyVisible) {
      matchNode.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeMatchIndex, searchMatches, searchQuery, isEditing]);

  // Handle search keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: Event) => {
      const kbd = event as unknown as globalThis.KeyboardEvent;
      // Cmd/Ctrl+F to focus search
      if ((kbd.metaKey || kbd.ctrlKey) && kbd.key === 'f') {
        kbd.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // Only handle navigation keys if search is active
      if (
        !searchQuery.trim() ||
        !searchInputRef.current ||
        document.activeElement !== searchInputRef.current
      ) {
        return;
      }

      if (kbd.key === 'ArrowDown' || (kbd.shiftKey === false && kbd.key === 'Enter')) {
        kbd.preventDefault();
        setActiveMatchIndex(current => {
          const nextIndex = (current + 1) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) {
            onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          }
          return nextIndex;
        });
      } else if (kbd.key === 'ArrowUp' || (kbd.shiftKey && kbd.key === 'Enter')) {
        kbd.preventDefault();
        setActiveMatchIndex(current => {
          const nextIndex =
            (current - 1 + searchMatches.length) % Math.max(1, searchMatches.length);
          if (searchMatches[nextIndex]) {
            onSeekToSeconds(transcriptLines[searchMatches[nextIndex]!.lineIndex]!.startSeconds);
          }
          return nextIndex;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, searchMatches, transcriptLines, onSeekToSeconds]);

  // Review mode helpers
  const toggleReviewMode = () => {
    setIsReviewMode(prev => !prev);
    setReviewIndex(0);
    if (!isReviewMode && uncertainSegments.length > 0) {
      onSeekToSeconds(uncertainSegments[0]!.line.startSeconds);
    }
  };

  const navigateReview = (direction: 'prev' | 'next') => {
    if (uncertainSegments.length === 0) return;
    const newIndex =
      direction === 'next'
        ? (reviewIndex + 1) % uncertainSegments.length
        : (reviewIndex - 1 + uncertainSegments.length) % uncertainSegments.length;
    setReviewIndex(newIndex);
    onSeekToSeconds(uncertainSegments[newIndex]!.line.startSeconds);
  };

  const toggleVerified = (segmentIndex: number) => {
    setVerifiedSegments(prev => {
      const next = new Set(prev);
      if (next.has(segmentIndex)) {
        next.delete(segmentIndex);
      } else {
        next.add(segmentIndex);
      }
      return next;
    });
  };

  const getSpeakerLabel = (speaker: number | null): string | null => {
    if (speaker === null) return null;
    const custom = speakerLabels[String(speaker)]?.trim();
    return custom && custom.length > 0 ? custom : defaultSpeakerLabel(speaker);
  };

  const toggleSpeakerVisibility = (speaker: number) => {
    setHiddenSpeakers(prev => {
      const next = new Set(prev);
      if (next.has(speaker)) next.delete(speaker);
      else next.add(speaker);
      return next;
    });
  };

  const startSpeakerEdit = (speaker: number, lineIndex: number) => {
    setEditingSpeaker(speaker);
    setEditingSpeakerLineIndex(lineIndex);
    setSpeakerDraft(getSpeakerLabel(speaker) ?? defaultSpeakerLabel(speaker));
    setSpeakerSaveError(null);
  };

  const cancelSpeakerEdit = () => {
    setEditingSpeaker(null);
    setEditingSpeakerLineIndex(null);
    setSpeakerDraft('');
    setSpeakerSaveError(null);
    setIsSavingSpeaker(false);
  };

  const saveSpeakerLabel = async (speaker: number) => {
    const normalized = speakerDraft.trim();
    if (!normalized) {
      setSpeakerSaveError('Label cannot be empty.');
      return;
    }
    const nextLabels = { ...speakerLabels, [String(speaker)]: normalized };
    setIsSavingSpeaker(true);
    setSpeakerSaveError(null);
    const ok = await onSaveSpeakerLabels(nextLabels);
    setIsSavingSpeaker(false);
    if (!ok) {
      setSpeakerSaveError('Unable to save speaker label.');
      cancelSpeakerEdit();
      return;
    }
    setSpeakerLabels(nextLabels);
    setSaveFeedback('Speaker labels saved.');
    cancelSpeakerEdit();
  };

  const copyTranscript = async () => {
    if (!transcriptText) return;
    try {
      await navigator.clipboard.writeText(transcriptText);
      setCopyFeedback('Transcript copied');
    } catch {
      setCopyFeedback('Unable to copy transcript.');
    }
    window.setTimeout(() => setCopyFeedback(null), 1800);
  };

  const submitEdit = async () => {
    const normalized = draftText.trim();
    if (!normalized) {
      setSaveError('Transcript cannot be empty.');
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    const ok = await onSaveTranscript(normalized);
    setIsSaving(false);
    if (ok) {
      setIsEditing(false);
      setSaveFeedback('Transcript saved.');
      return;
    }
    setSaveError('Unable to save transcript edits.');
  };

  const highlightText = (text: string, lineIndex: number): React.ReactNode => {
    if (!searchQuery.trim()) return text;

    const matches = searchMatches
      .filter(m => m.lineIndex === lineIndex)
      .sort((a, b) => a.startPos - b.startPos);
    if (matches.length === 0) return text;

    const parts: React.ReactNode[] = [];
    let lastPos = 0;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i]!;
      if (match.startPos > lastPos) {
        parts.push(text.substring(lastPos, match.startPos));
      }

      const isActive = searchMatches.indexOf(match) === activeMatchIndex;
      parts.push(
        <span
          key={`match-${i}`}
          className={`transition-colors ${isActive ? 'bg-yellow-400 dark:bg-yellow-600' : 'bg-yellow-200 dark:bg-yellow-800'}`}
        >
          {text.substring(match.startPos, match.endPos)}
        </span>
      );
      lastPos = match.endPos;
    }

    if (lastPos < text.length) {
      parts.push(text.substring(lastPos));
    }

    return parts;
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isSaving) return;
      setDraftText(transcriptText);
      setIsEditing(false);
      setSaveError(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!isSaving) {
        void submitEdit();
      }
    }
  };

  const Inner = (
    <div>
      {/* Header — hidden in compact mode (VideoPage rail header handles it) */}
      {!compact && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <p className="workspace-label">Workspace panel</p>
            <h2 className="workspace-title">Transcript</h2>
          </div>
          <span className="status-chip">{transcriptionStatus ?? 'not_started'}</span>
        </div>
      )}

      <TranscriptStatusMessages
        compact={compact}
        transcriptionStatus={transcriptionStatus}
        transcriptTextLength={transcriptText.length}
        errorMessage={errorMessage}
      />

      {transcriptionStatus === 'complete' && transcriptText.length > 0 && (
        <div className={compact ? '' : 'space-y-3'}>
          {/* Search bar */}
          <TranscriptControls
            compact={compact}
            isEditing={isEditing}
            searchInputRef={searchInputRef}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            onClearSearch={() => {
              setSearchQuery('');
              setActiveMatchIndex(-1);
            }}
            searchMatchesCount={searchMatches.length}
            activeMatchIndex={activeMatchIndex}
            textViewMode={textViewMode}
            onSetTextViewMode={setTextViewMode}
            onCopy={() => void copyTranscript()}
            onEdit={() => setIsEditing(true)}
            confidenceStats={confidenceStats}
            uncertainSegmentsCount={uncertainSegments.length}
            isReviewMode={isReviewMode}
            reviewIndex={reviewIndex}
            onToggleReviewMode={toggleReviewMode}
            onNavigateReview={navigateReview}
            speakerIds={speakerIds}
            hiddenSpeakers={hiddenSpeakers}
            getSpeakerLabel={(speaker) => getSpeakerLabel(speaker) ?? ''}
            onToggleSpeakerVisibility={toggleSpeakerVisibility}
            speakerColor={speakerColor}
            speakerSaveError={speakerSaveError}
          />

          {/* Edit mode */}
          {isEditing ? (
            <TranscriptEditPanel
              compact={compact}
              draftText={draftText}
              isSaving={isSaving}
              saveError={saveError}
              onDraftChange={setDraftText}
              onKeyDown={onEditKeyDown}
              onSave={() => void submitEdit()}
              onCancel={() => {
                setDraftText(transcriptText);
                setIsEditing(false);
                setSaveError(null);
              }}
            />
          ) : transcriptLines.length > 0 ? (
            <div ref={transcriptScrollRef}>
              <TranscriptLines
                compact={compact}
                transcriptLines={transcriptLines}
                isReviewMode={isReviewMode}
                hiddenSpeakers={hiddenSpeakers}
                activeLineIndex={activeLineIndex}
                textViewMode={textViewMode}
                transcriptText={transcriptText}
                originalTranscriptText={originalTranscriptText}
                transcriptVttKey={transcript?.vttKey}
                renderLineText={(lineText, lineIndex) => highlightText(lineText, lineIndex)}
                verifiedSegments={verifiedSegments}
                onToggleVerified={toggleVerified}
                onSeekToSeconds={onSeekToSeconds}
                getSpeakerLabel={getSpeakerLabel}
                editingSpeaker={editingSpeaker}
                editingSpeakerLineIndex={editingSpeakerLineIndex}
                speakerDraft={speakerDraft}
                onSpeakerDraftChange={setSpeakerDraft}
                isSavingSpeaker={isSavingSpeaker}
                onStartSpeakerEdit={startSpeakerEdit}
                onCancelSpeakerEdit={cancelSpeakerEdit}
                onSaveSpeakerLabel={(speaker) => {
                  void saveSpeakerLabel(speaker);
                }}
              />
            </div>
          ) : (
            <pre
              className={`overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed ${compact ? 'px-3 py-2' : 'scroll-panel max-h-[28rem] rounded-lg p-4'}`}
            >
              {textViewMode === 'original' ? originalTranscriptText : transcriptText}
            </pre>
          )}

          {transcript?.vttKey && (
            <span className={`text-[11px] text-muted block ${compact ? 'px-3 pb-2' : ''}`}>
              VTT: <span className="font-mono">{transcript.vttKey}</span>
            </span>
          )}
        </div>
      )}

      {copyFeedback && (
        <p className={`text-[11px] font-medium text-muted ${compact ? 'px-3 pb-2' : 'mt-3'}`}>
          {copyFeedback}
        </p>
      )}
      {saveFeedback && (
        <p className={`text-[11px] font-medium text-accent-700 ${compact ? 'px-3 pb-2' : 'mt-2'}`}>
          {saveFeedback}
        </p>
      )}
    </div>
  );

  if (compact) return Inner;
  return <section className="workspace-card">{Inner}</section>;
}

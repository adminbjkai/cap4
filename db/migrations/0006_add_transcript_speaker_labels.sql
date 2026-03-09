-- Migration 0006: Add speaker labels storage to transcripts

BEGIN;

ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS speaker_labels_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE transcripts
  ADD CONSTRAINT chk_transcripts_speaker_labels_object
    CHECK (jsonb_typeof(speaker_labels_json) = 'object');

COMMENT ON COLUMN transcripts.speaker_labels_json IS 'Map of speaker index to custom display label, e.g. {"0":"John"}';

COMMIT;

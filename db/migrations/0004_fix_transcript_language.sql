-- Fix transcript.language: backfill NULLs then add NOT NULL + DEFAULT constraint
BEGIN;

-- First backfill any existing NULL rows to 'en'
UPDATE transcripts SET language = 'en' WHERE language IS NULL;

-- Now safe to add NOT NULL and DEFAULT
ALTER TABLE transcripts
  ALTER COLUMN language SET DEFAULT 'en',
  ALTER COLUMN language SET NOT NULL;

COMMIT;

BEGIN;

-- Original creation/modification time of an uploaded source file, taken from the
-- browser's File.lastModified at upload time. This is distinct from videos.created_at
-- (when the video was uploaded into cap4). NULL for in-app screen recordings and for
-- videos uploaded before this column existed (no reliable backfill source).
ALTER TABLE videos ADD COLUMN IF NOT EXISTS original_file_created_at TIMESTAMPTZ;

COMMIT;

ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_videos_active_created_at
  ON videos (created_at DESC)
  WHERE deleted_at IS NULL;

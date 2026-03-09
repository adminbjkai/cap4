BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE source_type AS ENUM ('web_mp4', 'processed_mp4', 'hls');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE upload_mode AS ENUM ('singlepart', 'multipart');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE upload_phase AS ENUM ('pending', 'uploading', 'completing', 'uploaded', 'aborted', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE processing_phase AS ENUM (
    'not_required',
    'queued',
    'downloading',
    'probing',
    'processing',
    'uploading',
    'generating_thumbnail',
    'complete',
    'failed',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE transcription_status AS ENUM (
    'not_started',
    'queued',
    'processing',
    'complete',
    'no_audio',
    'skipped',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ai_status AS ENUM (
    'not_started',
    'queued',
    'processing',
    'complete',
    'skipped',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_type AS ENUM ('process_video', 'transcribe_video', 'generate_ai', 'cleanup_artifacts');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('queued', 'leased', 'running', 'succeeded', 'cancelled', 'dead');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE ai_provider AS ENUM ('groq', 'openai');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Untitled Video',
  source_type source_type NOT NULL DEFAULT 'web_mp4',

  processing_phase processing_phase NOT NULL DEFAULT 'not_required',
  processing_phase_rank SMALLINT NOT NULL DEFAULT 0 CHECK (processing_phase_rank >= 0),
  processing_progress INT NOT NULL DEFAULT 0 CHECK (processing_progress BETWEEN 0 AND 100),

  transcription_status transcription_status NOT NULL DEFAULT 'not_started',
  ai_status ai_status NOT NULL DEFAULT 'not_started',

  duration_seconds NUMERIC(10,3),
  width INT,
  height INT,
  fps NUMERIC(7,3),

  result_key TEXT,
  thumbnail_key TEXT,

  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT chk_videos_phase_rank_consistency CHECK (
    (processing_phase = 'not_required' AND processing_phase_rank = 0) OR
    (processing_phase = 'queued' AND processing_phase_rank = 10) OR
    (processing_phase = 'downloading' AND processing_phase_rank = 20) OR
    (processing_phase = 'probing' AND processing_phase_rank = 30) OR
    (processing_phase = 'processing' AND processing_phase_rank = 40) OR
    (processing_phase = 'uploading' AND processing_phase_rank = 50) OR
    (processing_phase = 'generating_thumbnail' AND processing_phase_rank = 60) OR
    (processing_phase = 'complete' AND processing_phase_rank = 70) OR
    (processing_phase = 'failed' AND processing_phase_rank = 80) OR
    (processing_phase = 'cancelled' AND processing_phase_rank = 90)
  )
);

CREATE INDEX IF NOT EXISTS idx_videos_created_at ON videos (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_processing_phase ON videos (processing_phase, updated_at);
CREATE INDEX IF NOT EXISTS idx_videos_transcription_status ON videos (transcription_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_videos_ai_status ON videos (ai_status, updated_at);

CREATE TABLE IF NOT EXISTS uploads (
  video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  mode upload_mode NOT NULL,
  phase upload_phase NOT NULL DEFAULT 'uploading',

  multipart_upload_id TEXT,
  raw_key TEXT NOT NULL,

  uploaded_bytes BIGINT NOT NULL DEFAULT 0 CHECK (uploaded_bytes >= 0),
  total_bytes BIGINT NOT NULL DEFAULT 0 CHECK (total_bytes >= 0),
  etag_manifest JSONB,

  last_client_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_uploads_bytes_bounds CHECK (total_bytes = 0 OR uploaded_bytes <= total_bytes)
);

CREATE INDEX IF NOT EXISTS idx_uploads_phase_updated ON uploads (phase, updated_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id BIGSERIAL PRIMARY KEY,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  job_type job_type NOT NULL,
  status job_status NOT NULL DEFAULT 'queued',
  priority SMALLINT NOT NULL DEFAULT 100,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INT NOT NULL DEFAULT 6 CHECK (max_attempts > 0),

  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),

  locked_by TEXT,
  locked_until TIMESTAMPTZ,
  lease_token UUID,

  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,

  CONSTRAINT chk_job_queue_lease_consistency CHECK (
    (status IN ('queued', 'succeeded', 'cancelled', 'dead') AND locked_by IS NULL AND locked_until IS NULL AND lease_token IS NULL) OR
    (status IN ('leased', 'running') AND locked_by IS NOT NULL AND locked_until IS NOT NULL AND lease_token IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_job_queue_claim ON job_queue (status, priority DESC, run_after, id);
CREATE INDEX IF NOT EXISTS idx_job_queue_locked_until ON job_queue (locked_until) WHERE status IN ('leased', 'running');
CREATE INDEX IF NOT EXISTS idx_job_queue_video_type ON job_queue (video_id, job_type);

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_queue_one_active_per_video_type
ON job_queue (video_id, job_type)
WHERE status IN ('queued', 'leased', 'running');

CREATE TABLE IF NOT EXISTS transcripts (
  video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'deepgram',
  language TEXT NOT NULL DEFAULT 'en',
  vtt_key TEXT NOT NULL,
  segments_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_outputs (
  video_id UUID PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  provider ai_provider NOT NULL,
  model TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  chapters_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_ai_outputs_chapters_array CHECK (jsonb_typeof(chapters_json) = 'array')
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code INT,
  response_headers JSONB,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (endpoint, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_expires_at ON idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'media-server',
  delivery_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  phase processing_phase NOT NULL,
  phase_rank SMALLINT NOT NULL CHECK (phase_rank >= 0),
  progress INT NOT NULL CHECK (progress BETWEEN 0 AND 100),
  progress_bucket SMALLINT GENERATED ALWAYS AS ((progress / 5)) STORED,
  payload JSONB NOT NULL,
  signature TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  accepted BOOLEAN NOT NULL DEFAULT false,
  reject_reason TEXT,
  CONSTRAINT chk_webhook_phase_rank_consistency CHECK (
    (phase = 'not_required' AND phase_rank = 0) OR
    (phase = 'queued' AND phase_rank = 10) OR
    (phase = 'downloading' AND phase_rank = 20) OR
    (phase = 'probing' AND phase_rank = 30) OR
    (phase = 'processing' AND phase_rank = 40) OR
    (phase = 'uploading' AND phase_rank = 50) OR
    (phase = 'generating_thumbnail' AND phase_rank = 60) OR
    (phase = 'complete' AND phase_rank = 70) OR
    (phase = 'failed' AND phase_rank = 80) OR
    (phase = 'cancelled' AND phase_rank = 90)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_source_delivery ON webhook_events (source, delivery_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_source_job_phase_bucket
ON webhook_events (source, job_id, phase, progress_bucket);
CREATE INDEX IF NOT EXISTS idx_webhook_video_received ON webhook_events (video_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_job_received ON webhook_events (job_id, received_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_videos_set_updated_at ON videos;
CREATE TRIGGER trg_videos_set_updated_at
BEFORE UPDATE ON videos
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_uploads_set_updated_at ON uploads;
CREATE TRIGGER trg_uploads_set_updated_at
BEFORE UPDATE ON uploads
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_job_queue_set_updated_at ON job_queue;
CREATE TRIGGER trg_job_queue_set_updated_at
BEFORE UPDATE ON job_queue
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_transcripts_set_updated_at ON transcripts;
CREATE TRIGGER trg_transcripts_set_updated_at
BEFORE UPDATE ON transcripts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_ai_outputs_set_updated_at ON ai_outputs;
CREATE TRIGGER trg_ai_outputs_set_updated_at
BEFORE UPDATE ON ai_outputs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

COMMIT;

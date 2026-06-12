BEGIN;

DO $$ BEGIN
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'generate_doc';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Candidate frames extracted by Stage A of the doc pipeline (scene-change
-- screenshots, ~768px JPEGs in MinIO). frame_no is the stable label the model
-- sees as f_NNNN.
CREATE TABLE IF NOT EXISTS frames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  frame_no INT NOT NULL CHECK (frame_no >= 1),
  ts_seconds NUMERIC(10,3) NOT NULL,
  s3_key TEXT NOT NULL,
  caption TEXT,
  classification TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (video_id, frame_no)
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL UNIQUE REFERENCES videos(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'generating' CHECK (status IN ('generating', 'complete', 'failed')),
  title TEXT,
  doc_type TEXT,
  markdown TEXT,
  confidence_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
  unused_frames JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt_version TEXT,
  model TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doc_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INT NOT NULL,
  heading TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  start_s NUMERIC(10,3),
  end_s NUMERIC(10,3),
  UNIQUE (document_id, position)
);

CREATE TABLE IF NOT EXISTS doc_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES doc_sections(id) ON DELETE CASCADE,
  position INT NOT NULL,
  text TEXT NOT NULL,
  frame_id UUID REFERENCES frames(id) ON DELETE SET NULL,
  crop JSONB,
  alt TEXT,
  callout TEXT,
  UNIQUE (section_id, position)
);

-- Model-call result cache: the claude-cli backend draws from a limited
-- subscription credit pool, so identical (transcript, manifest, prompt
-- version, model) calls must be free on retry/re-render.
CREATE TABLE IF NOT EXISTS doc_model_cache (
  cache_key TEXT PRIMARY KEY,
  response_json JSONB NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only log of real (cache-miss) model calls; backs the per-day guard.
CREATE TABLE IF NOT EXISTS doc_model_calls (
  id BIGSERIAL PRIMARY KEY,
  video_id UUID,
  purpose TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_model_calls_created_at ON doc_model_calls (created_at);
CREATE INDEX IF NOT EXISTS idx_frames_video_id ON frames (video_id);

COMMIT;

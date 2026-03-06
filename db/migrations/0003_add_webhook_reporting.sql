BEGIN;

ALTER TABLE videos ADD COLUMN IF NOT EXISTS webhook_url TEXT;

DO $$ BEGIN
  ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'deliver_webhook';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

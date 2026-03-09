-- Migration 0005: Add enrichment fields to ai_outputs table
-- Adds entities, action items, and quotes to AI-generated outputs

BEGIN;

-- Add new JSONB columns for enhanced AI metadata
ALTER TABLE ai_outputs
  ADD COLUMN IF NOT EXISTS entities_json JSONB,
  ADD COLUMN IF NOT EXISTS action_items_json JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS quotes_json JSONB DEFAULT '[]'::jsonb;

-- Add constraints to ensure arrays
ALTER TABLE ai_outputs
  ADD CONSTRAINT chk_ai_outputs_action_items_array
    CHECK (action_items_json IS NULL OR jsonb_typeof(action_items_json) = 'array');

ALTER TABLE ai_outputs
  ADD CONSTRAINT chk_ai_outputs_quotes_array
    CHECK (quotes_json IS NULL OR jsonb_typeof(quotes_json) = 'array');

-- Add comment for documentation
COMMENT ON COLUMN ai_outputs.entities_json IS 'Named entities: people, organizations, locations, dates';
COMMENT ON COLUMN ai_outputs.action_items_json IS 'Action items with task, assignee, deadline';
COMMENT ON COLUMN ai_outputs.quotes_json IS 'Notable quotes with text and timestamp';

COMMIT;

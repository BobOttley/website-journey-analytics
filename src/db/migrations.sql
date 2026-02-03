-- Migration: Add visitor_id support for return visitor tracking
-- Run this to update existing tables

-- Add visitor_id to journey_events if it doesn't exist
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS visitor_id TEXT;
CREATE INDEX IF NOT EXISTS idx_journey_events_visitor_id ON journey_events(visitor_id);

-- Add visitor_id and visit_number to journeys if they don't exist
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS visitor_id TEXT;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS visit_number INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_journeys_visitor_id ON journeys(visitor_id);

-- Add metadata column for granular event data (scroll %, element info, UTM params, etc.)
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS metadata JSONB;
CREATE INDEX IF NOT EXISTS idx_journey_events_metadata ON journey_events USING GIN (metadata);

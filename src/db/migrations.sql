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

-- Add metadata column to journeys for storing outcome_detail, friction, confidence, engagement_metrics
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add confidence column for quick filtering
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 0;

-- ============================================
-- BOT DETECTION COLUMNS
-- ============================================

-- Add bot detection columns to journey_events
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS bot_score REAL DEFAULT 0;
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS bot_signals TEXT[];
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS ip_address TEXT;

-- Add bot detection columns to journeys
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS is_bot BOOLEAN DEFAULT false;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS bot_score REAL DEFAULT 0;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS bot_type TEXT; -- crawler, scraper, automation, unknown

-- Create indexes for fast bot filtering
CREATE INDEX IF NOT EXISTS idx_journey_events_is_bot ON journey_events(is_bot);
CREATE INDEX IF NOT EXISTS idx_journey_events_bot_score ON journey_events(bot_score);
CREATE INDEX IF NOT EXISTS idx_journeys_is_bot ON journeys(is_bot);
CREATE INDEX IF NOT EXISTS idx_journeys_bot_score ON journeys(bot_score);
CREATE INDEX IF NOT EXISTS idx_journeys_bot_type ON journeys(bot_type);

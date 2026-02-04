-- Migration: Add visitor_id support for return visitor tracking
-- Run this to update existing tables

-- ============================================
-- MULTI-TENANCY TABLES
-- ============================================

-- Sites table - each customer site being tracked
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  tracking_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table - admin and customer users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- User-Site mapping - which sites can each user access
CREATE TABLE IF NOT EXISTS user_sites (
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, site_id)
);

-- Session store table for connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default" PRIMARY KEY,
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ============================================
-- ADD site_id TO EXISTING TABLES
-- ============================================

-- Add site_id to journey_events
ALTER TABLE journey_events ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
CREATE INDEX IF NOT EXISTS idx_journey_events_site_id ON journey_events(site_id);

-- Add site_id to journeys
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
CREATE INDEX IF NOT EXISTS idx_journeys_site_id ON journeys(site_id);

-- Add site_id to insights
ALTER TABLE insights ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
CREATE INDEX IF NOT EXISTS idx_insights_site_id ON insights(site_id);

-- ============================================
-- EXISTING MIGRATIONS
-- ============================================

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

-- ============================================
-- FAMILY PROFILES (IP-BASED GROUPING)
-- ============================================

-- Add primary_ip_address to journeys for family grouping
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS primary_ip_address TEXT;
CREATE INDEX IF NOT EXISTS idx_journeys_primary_ip_address ON journeys(primary_ip_address);

-- Add AI analysis columns to journeys
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
ALTER TABLE journeys ADD COLUMN IF NOT EXISTS ai_analysed_at TIMESTAMP;

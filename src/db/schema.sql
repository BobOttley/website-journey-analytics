-- Events table (raw data from GTM)
CREATE TABLE IF NOT EXISTS journey_events (
  id SERIAL PRIMARY KEY,
  journey_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  page_url TEXT,
  referrer TEXT,
  intent_type TEXT,
  cta_label TEXT,
  device_type TEXT,
  occurred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast journey lookups
CREATE INDEX IF NOT EXISTS idx_journey_events_journey_id ON journey_events(journey_id);
CREATE INDEX IF NOT EXISTS idx_journey_events_occurred_at ON journey_events(occurred_at);

-- Journeys table (reconstructed from events)
CREATE TABLE IF NOT EXISTS journeys (
  journey_id TEXT PRIMARY KEY,
  first_seen TIMESTAMP,
  last_seen TIMESTAMP,
  entry_page TEXT,
  entry_referrer TEXT,
  initial_intent TEXT,
  page_sequence TEXT, -- JSON array
  event_count INTEGER,
  outcome TEXT,
  time_to_action INTEGER, -- seconds
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insights table (AI analysis results)
CREATE TABLE IF NOT EXISTS insights (
  id SERIAL PRIMARY KEY,
  period_start DATE,
  period_end DATE,
  total_journeys INTEGER,
  conversion_rate REAL,
  analysis_result TEXT, -- JSON containing patterns, friction points, recommendations
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_insights_created_at ON insights(created_at);

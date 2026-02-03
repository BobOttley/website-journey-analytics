const { getDb } = require('./database');

// Event queries
async function insertEvent(event) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO journey_events (journey_id, visitor_id, event_type, page_url, referrer, intent_type, cta_label, device_type, metadata, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      event.journey_id,
      event.visitor_id || null,
      event.event_type,
      event.page_url || null,
      event.referrer || null,
      event.intent_type || null,
      event.cta_label || null,
      event.device_type || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.occurred_at || new Date().toISOString()
    ]
  );
  return { lastInsertRowid: result.rows[0].id };
}

async function getEventsByJourneyId(journeyId) {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM journey_events WHERE journey_id = $1 ORDER BY occurred_at ASC`,
    [journeyId]
  );
  return result.rows;
}

async function getUniqueJourneyIds(since = null) {
  const db = getDb();
  let result;
  if (since) {
    result = await db.query(
      'SELECT DISTINCT journey_id FROM journey_events WHERE occurred_at >= $1',
      [since]
    );
  } else {
    result = await db.query('SELECT DISTINCT journey_id FROM journey_events');
  }
  return result.rows.map(r => r.journey_id);
}

async function getEventsInDateRange(startDate, endDate) {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM journey_events
     WHERE occurred_at >= $1 AND occurred_at <= $2
     ORDER BY journey_id, occurred_at ASC`,
    [startDate, endDate]
  );
  return result.rows;
}

// Journey queries
async function upsertJourney(journey) {
  const db = getDb();

  // Build metadata object with new analytics fields
  const metadata = {
    outcome_detail: journey.outcome_detail || null,
    friction: journey.friction || null,
    engagement_metrics: journey.engagement_metrics || null,
    loops: journey.loops || []
  };

  const result = await db.query(
    `INSERT INTO journeys (journey_id, visitor_id, visit_number, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, confidence, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)
     ON CONFLICT(journey_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       page_sequence = EXCLUDED.page_sequence,
       event_count = EXCLUDED.event_count,
       outcome = EXCLUDED.outcome,
       time_to_action = EXCLUDED.time_to_action,
       confidence = EXCLUDED.confidence,
       metadata = EXCLUDED.metadata,
       updated_at = CURRENT_TIMESTAMP
     RETURNING journey_id`,
    [
      journey.journey_id,
      journey.visitor_id || null,
      journey.visit_number || 1,
      journey.first_seen,
      journey.last_seen,
      journey.entry_page,
      journey.entry_referrer,
      journey.initial_intent,
      JSON.stringify(journey.page_sequence),
      journey.event_count,
      journey.outcome,
      journey.time_to_action,
      journey.confidence || 0,
      JSON.stringify(metadata)
    ]
  );
  return result;
}

async function getAllJourneys(limit = 100, offset = 0) {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM journeys ORDER BY last_seen DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

async function getJourneyById(journeyId) {
  const db = getDb();
  const result = await db.query(
    'SELECT * FROM journeys WHERE journey_id = $1',
    [journeyId]
  );
  return result.rows[0];
}

async function getJourneyCount() {
  const db = getDb();
  const result = await db.query('SELECT COUNT(*) as count FROM journeys');
  return parseInt(result.rows[0].count);
}

async function getJourneysInDateRange(startDate, endDate) {
  const db = getDb();
  // Add time component to ensure full day coverage
  const startDateTime = startDate.includes('T') ? startDate : startDate + 'T00:00:00.000Z';
  const endDateTime = endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z';
  const result = await db.query(
    `SELECT * FROM journeys
     WHERE first_seen >= $1 AND first_seen <= $2
     ORDER BY first_seen DESC`,
    [startDateTime, endDateTime]
  );
  return result.rows;
}

async function getJourneyStats() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      COUNT(*) as total_journeys,
      COUNT(CASE WHEN outcome = 'enquiry_submitted' THEN 1 END) as enquiries,
      COUNT(CASE WHEN outcome = 'visit_booked' THEN 1 END) as visits_booked,
      COUNT(CASE WHEN outcome = 'no_action' THEN 1 END) as no_action,
      AVG(event_count) as avg_events,
      AVG(time_to_action) as avg_time_to_action
    FROM journeys
  `);
  return result.rows[0];
}

// ============================================
// NEW CHART DATA QUERIES
// ============================================

/**
 * Get top pages by view count
 */
async function getTopPages(limit = 10) {
  const db = getDb();
  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as views,
      COUNT(DISTINCT journey_id) as unique_visitors
    FROM journey_events
    WHERE event_type = 'page_view' AND page_url IS NOT NULL
    GROUP BY page_url
    ORDER BY views DESC
    LIMIT $1
  `, [limit]);
  return result.rows;
}

/**
 * Get device type breakdown
 */
async function getDeviceBreakdown() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      COALESCE(device_type, 'unknown') as device_type,
      COUNT(DISTINCT journey_id) as count
    FROM journey_events
    WHERE event_type = 'page_view'
    GROUP BY device_type
    ORDER BY count DESC
  `);
  return result.rows;
}

/**
 * Get traffic sources breakdown from referrers
 */
async function getTrafficSources() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      CASE
        WHEN entry_referrer IS NULL OR entry_referrer = '' THEN 'Direct'
        WHEN entry_referrer LIKE '%google%' THEN 'Google'
        WHEN entry_referrer LIKE '%bing%' THEN 'Bing'
        WHEN entry_referrer LIKE '%facebook%' OR entry_referrer LIKE '%fb.%' THEN 'Facebook'
        WHEN entry_referrer LIKE '%instagram%' THEN 'Instagram'
        WHEN entry_referrer LIKE '%twitter%' OR entry_referrer LIKE '%x.com%' THEN 'Twitter/X'
        WHEN entry_referrer LIKE '%linkedin%' THEN 'LinkedIn'
        WHEN entry_referrer LIKE '%youtube%' THEN 'YouTube'
        ELSE 'Other'
      END as source,
      COUNT(*) as count
    FROM journeys
    GROUP BY source
    ORDER BY count DESC
  `);
  return result.rows;
}

/**
 * Get daily journey and conversion trend
 */
async function getDailyJourneyTrend(days = 30) {
  const db = getDb();
  const result = await db.query(`
    SELECT
      DATE(first_seen) as date,
      COUNT(*) as journeys,
      COUNT(CASE WHEN outcome IN ('enquiry_submitted', 'visit_booked') THEN 1 END) as conversions
    FROM journeys
    WHERE first_seen >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(first_seen)
    ORDER BY date ASC
  `);
  return result.rows;
}

/**
 * Get scroll depth distribution
 */
async function getScrollDepthDistribution() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      CASE
        WHEN CAST(cta_label AS INTEGER) <= 25 THEN '0-25%'
        WHEN CAST(cta_label AS INTEGER) <= 50 THEN '26-50%'
        WHEN CAST(cta_label AS INTEGER) <= 75 THEN '51-75%'
        ELSE '76-100%'
      END as depth_range,
      COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'scroll_depth'
      AND cta_label ~ '^[0-9]+$'
    GROUP BY depth_range
    ORDER BY depth_range
  `);
  return result.rows;
}

/**
 * Get visitor locations from recent events
 */
async function getVisitorLocations(withinSeconds = 300) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  const result = await db.query(`
    SELECT DISTINCT ON (je.journey_id)
      je.journey_id,
      je.metadata
    FROM journey_events je
    WHERE je.occurred_at >= $1
      AND je.event_type = 'page_view'
      AND je.metadata IS NOT NULL
    ORDER BY je.journey_id, je.occurred_at DESC
  `, [cutoffTime]);

  // Parse metadata and extract location
  const locations = result.rows
    .map(row => {
      try {
        const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        if (metadata?.location) {
          return {
            journey_id: row.journey_id,
            ...metadata.location
          };
        }
      } catch (e) {}
      return null;
    })
    .filter(Boolean);

  return locations;
}

/**
 * Get outcome distribution for funnel chart
 */
async function getOutcomeDistribution() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      COALESCE(outcome, 'no_action') as outcome,
      COUNT(*) as count
    FROM journeys
    GROUP BY outcome
    ORDER BY
      CASE outcome
        WHEN 'enquiry_submitted' THEN 1
        WHEN 'visit_booked' THEN 2
        WHEN 'engaged' THEN 3
        WHEN 'form_abandoned' THEN 4
        ELSE 5
      END
  `);
  return result.rows;
}

/**
 * Get conversion funnel stages
 */
async function getConversionFunnel() {
  const db = getDb();

  // Get total journeys
  const totalResult = await db.query('SELECT COUNT(DISTINCT journey_id) as count FROM journeys');
  const total = parseInt(totalResult.rows[0].count);

  // Get journeys with multiple page views (engaged)
  const engagedResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journeys
    WHERE event_count > 1
  `);
  const engaged = parseInt(engagedResult.rows[0].count);

  // Get journeys with CTA clicks
  const ctaResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journey_events
    WHERE event_type = 'cta_click'
  `);
  const ctaClicks = parseInt(ctaResult.rows[0].count);

  // Get journeys with form starts
  const formStartResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journey_events
    WHERE event_type = 'form_start'
  `);
  const formStarts = parseInt(formStartResult.rows[0].count);

  // Get conversions
  const conversionResult = await db.query(`
    SELECT COUNT(*) as count
    FROM journeys
    WHERE outcome IN ('enquiry_submitted', 'visit_booked')
  `);
  const conversions = parseInt(conversionResult.rows[0].count);

  return [
    { stage: 'Visitors', count: total },
    { stage: 'Engaged', count: engaged },
    { stage: 'CTA Clicked', count: ctaClicks },
    { stage: 'Form Started', count: formStarts },
    { stage: 'Converted', count: conversions }
  ];
}

/**
 * Get return visitor stats
 */
async function getReturnVisitorStats() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      COUNT(CASE WHEN visit_number = 1 THEN 1 END) as new_visitors,
      COUNT(CASE WHEN visit_number > 1 THEN 1 END) as return_visitors
    FROM journeys
  `);
  return result.rows[0];
}

/**
 * Get hourly activity pattern
 */
async function getHourlyActivity() {
  const db = getDb();
  const result = await db.query(`
    SELECT
      EXTRACT(HOUR FROM occurred_at) as hour,
      COUNT(*) as events
    FROM journey_events
    WHERE occurred_at >= NOW() - INTERVAL '7 days'
    GROUP BY hour
    ORDER BY hour
  `);
  return result.rows;
}

// Insight queries
async function insertInsight(insight) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO insights (period_start, period_end, total_journeys, conversion_rate, analysis_result)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      insight.period_start,
      insight.period_end,
      insight.total_journeys,
      insight.conversion_rate,
      JSON.stringify(insight.analysis_result)
    ]
  );
  return result;
}

async function getLatestInsight() {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM insights ORDER BY created_at DESC LIMIT 1`
  );
  return result.rows[0];
}

async function getAllInsights(limit = 10) {
  const db = getDb();
  const result = await db.query(
    `SELECT * FROM insights ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// Real-time queries
async function getActiveVisitors(withinSeconds = 300) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  // Get unique journey_ids that have had activity in the last N seconds
  // Use heartbeat or page_view events to determine activity
  const result = await db.query(
    `SELECT DISTINCT ON (je.journey_id)
       je.journey_id,
       je.page_url,
       je.device_type,
       je.occurred_at as last_activity,
       je.metadata,
       (SELECT MIN(je2.occurred_at) FROM journey_events je2 WHERE je2.journey_id = je.journey_id) as first_seen,
       (SELECT je3.referrer FROM journey_events je3 WHERE je3.journey_id = je.journey_id AND je3.referrer IS NOT NULL ORDER BY je3.occurred_at ASC LIMIT 1) as referrer,
       (SELECT j.visitor_id FROM journeys j WHERE j.journey_id = je.journey_id) as visitor_id,
       (SELECT j.visit_number FROM journeys j WHERE j.journey_id = je.journey_id) as visit_number
     FROM journey_events je
     WHERE je.occurred_at >= $1
       AND je.event_type IN ('heartbeat', 'page_view', 'cta_click', 'form_start', 'form_submit')
     ORDER BY je.journey_id, je.occurred_at DESC`,
    [cutoffTime]
  );
  return result.rows;
}

async function getRecentNewJourneys(sinceSeconds = 300) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (sinceSeconds * 1000)).toISOString();

  // Find journeys where first page_view happened within the window
  // This indicates a new visitor/session
  const result = await db.query(
    `SELECT
       je.journey_id,
       MIN(je.occurred_at) as first_seen,
       (SELECT je2.page_url FROM journey_events je2 WHERE je2.journey_id = je.journey_id ORDER BY je2.occurred_at ASC LIMIT 1) as entry_page,
       (SELECT je3.referrer FROM journey_events je3 WHERE je3.journey_id = je.journey_id AND je3.referrer IS NOT NULL ORDER BY je3.occurred_at ASC LIMIT 1) as referrer,
       (SELECT je4.device_type FROM journey_events je4 WHERE je4.journey_id = je.journey_id ORDER BY je4.occurred_at ASC LIMIT 1) as device_type
     FROM journey_events je
     WHERE je.event_type = 'page_view'
     GROUP BY je.journey_id
     HAVING MIN(je.occurred_at) >= $1
     ORDER BY MIN(je.occurred_at) DESC`,
    [cutoffTime]
  );
  return result.rows;
}

async function getActiveVisitorCount(withinSeconds = 300) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  const result = await db.query(
    `SELECT COUNT(DISTINCT journey_id) as count
     FROM journey_events
     WHERE occurred_at >= $1
       AND event_type IN ('heartbeat', 'page_view', 'cta_click', 'form_start', 'form_submit')`,
    [cutoffTime]
  );
  return parseInt(result.rows[0].count);
}

/**
 * Get latest sessions that are no longer active
 * Always returns the most recent N sessions (not currently active)
 */
async function getRecentInactiveSessions(inactiveAfterSeconds = 300, limit = 10) {
  const db = getDb();
  const activeCutoff = new Date(Date.now() - (inactiveAfterSeconds * 1000)).toISOString();

  const result = await db.query(
    `SELECT
       j.journey_id,
       j.first_seen,
       j.last_seen,
       j.entry_page,
       j.entry_referrer,
       j.event_count,
       j.outcome,
       j.visitor_id,
       j.visit_number,
       (SELECT je.device_type FROM journey_events je WHERE je.journey_id = j.journey_id LIMIT 1) as device_type,
       (SELECT je.metadata FROM journey_events je WHERE je.journey_id = j.journey_id AND je.event_type = 'page_view' AND je.metadata IS NOT NULL ORDER BY je.occurred_at DESC LIMIT 1) as metadata
     FROM journeys j
     WHERE j.last_seen < $1
     ORDER BY j.last_seen DESC
     LIMIT $2`,
    [activeCutoff, limit]
  );
  return result.rows;
}

module.exports = {
  // Events
  insertEvent,
  getEventsByJourneyId,
  getUniqueJourneyIds,
  getEventsInDateRange,
  // Journeys
  upsertJourney,
  getAllJourneys,
  getJourneyById,
  getJourneyCount,
  getJourneysInDateRange,
  getJourneyStats,
  // Chart Data
  getTopPages,
  getDeviceBreakdown,
  getTrafficSources,
  getDailyJourneyTrend,
  getScrollDepthDistribution,
  getVisitorLocations,
  getOutcomeDistribution,
  getConversionFunnel,
  getReturnVisitorStats,
  getHourlyActivity,
  // Insights
  insertInsight,
  getLatestInsight,
  getAllInsights,
  // Real-time
  getActiveVisitors,
  getRecentNewJourneys,
  getActiveVisitorCount,
  getRecentInactiveSessions
};

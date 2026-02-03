const { getDb } = require('./database');

// Event queries
async function insertEvent(event) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO journey_events (journey_id, visitor_id, event_type, page_url, referrer, intent_type, cta_label, device_type, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
  const result = await db.query(
    `INSERT INTO journeys (journey_id, visitor_id, visit_number, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
     ON CONFLICT(journey_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       page_sequence = EXCLUDED.page_sequence,
       event_count = EXCLUDED.event_count,
       outcome = EXCLUDED.outcome,
       time_to_action = EXCLUDED.time_to_action,
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
      journey.time_to_action
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
async function getActiveVisitors(withinSeconds = 60) {
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
       (SELECT MIN(je2.occurred_at) FROM journey_events je2 WHERE je2.journey_id = je.journey_id) as first_seen,
       (SELECT je3.referrer FROM journey_events je3 WHERE je3.journey_id = je.journey_id AND je3.referrer IS NOT NULL ORDER BY je3.occurred_at ASC LIMIT 1) as referrer
     FROM journey_events je
     WHERE je.occurred_at >= $1
       AND je.event_type IN ('heartbeat', 'page_view', 'cta_click', 'form_start', 'form_submit')
     ORDER BY je.journey_id, je.occurred_at DESC`,
    [cutoffTime]
  );
  return result.rows;
}

async function getRecentNewJourneys(sinceSeconds = 60) {
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

async function getActiveVisitorCount(withinSeconds = 60) {
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
  // Insights
  insertInsight,
  getLatestInsight,
  getAllInsights,
  // Real-time
  getActiveVisitors,
  getRecentNewJourneys,
  getActiveVisitorCount
};

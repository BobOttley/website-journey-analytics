const { getDb } = require('./database');

// Event queries
async function insertEvent(event) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO journey_events (journey_id, event_type, page_url, referrer, intent_type, cta_label, device_type, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      event.journey_id,
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
    `INSERT INTO journeys (journey_id, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
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
  getAllInsights
};

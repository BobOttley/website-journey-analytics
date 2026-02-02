const { getDb } = require('./database');

// Event queries
function insertEvent(event) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO journey_events (journey_id, event_type, page_url, referrer, intent_type, cta_label, device_type, occurred_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    event.journey_id,
    event.event_type,
    event.page_url || null,
    event.referrer || null,
    event.intent_type || null,
    event.cta_label || null,
    event.device_type || null,
    event.occurred_at || new Date().toISOString()
  );
}

function getEventsByJourneyId(journeyId) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM journey_events
    WHERE journey_id = ?
    ORDER BY occurred_at ASC
  `);
  return stmt.all(journeyId);
}

function getUniqueJourneyIds(since = null) {
  const db = getDb();
  let query = 'SELECT DISTINCT journey_id FROM journey_events';
  if (since) {
    query += ' WHERE occurred_at >= ?';
    return db.prepare(query).all(since).map(r => r.journey_id);
  }
  return db.prepare(query).all().map(r => r.journey_id);
}

function getEventsInDateRange(startDate, endDate) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM journey_events
    WHERE occurred_at >= ? AND occurred_at <= ?
    ORDER BY journey_id, occurred_at ASC
  `);
  return stmt.all(startDate, endDate);
}

// Journey queries
function upsertJourney(journey) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO journeys (journey_id, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(journey_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      page_sequence = excluded.page_sequence,
      event_count = excluded.event_count,
      outcome = excluded.outcome,
      time_to_action = excluded.time_to_action,
      updated_at = CURRENT_TIMESTAMP
  `);

  return stmt.run(
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
  );
}

function getAllJourneys(limit = 100, offset = 0) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM journeys
    ORDER BY last_seen DESC
    LIMIT ? OFFSET ?
  `);
  return stmt.all(limit, offset);
}

function getJourneyById(journeyId) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM journeys WHERE journey_id = ?');
  return stmt.get(journeyId);
}

function getJourneyCount() {
  const db = getDb();
  const result = db.prepare('SELECT COUNT(*) as count FROM journeys').get();
  return result.count;
}

function getJourneysInDateRange(startDate, endDate) {
  const db = getDb();
  // Add time component to ensure full day coverage
  const startDateTime = startDate.includes('T') ? startDate : startDate + 'T00:00:00.000Z';
  const endDateTime = endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z';
  const stmt = db.prepare(`
    SELECT * FROM journeys
    WHERE first_seen >= ? AND first_seen <= ?
    ORDER BY first_seen DESC
  `);
  return stmt.all(startDateTime, endDateTime);
}

function getJourneyStats() {
  const db = getDb();
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_journeys,
      COUNT(CASE WHEN outcome = 'enquiry_submitted' THEN 1 END) as enquiries,
      COUNT(CASE WHEN outcome = 'visit_booked' THEN 1 END) as visits_booked,
      COUNT(CASE WHEN outcome = 'no_action' THEN 1 END) as no_action,
      AVG(event_count) as avg_events,
      AVG(time_to_action) as avg_time_to_action
    FROM journeys
  `).get();
  return stats;
}

// Insight queries
function insertInsight(insight) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO insights (period_start, period_end, total_journeys, conversion_rate, analysis_result)
    VALUES (?, ?, ?, ?, ?)
  `);

  return stmt.run(
    insight.period_start,
    insight.period_end,
    insight.total_journeys,
    insight.conversion_rate,
    JSON.stringify(insight.analysis_result)
  );
}

function getLatestInsight() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM insights
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return stmt.get();
}

function getAllInsights(limit = 10) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM insights
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
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

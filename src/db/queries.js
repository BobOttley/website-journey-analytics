const { getDb } = require('./database');

// Event queries
async function insertEvent(event) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO journey_events (journey_id, visitor_id, event_type, page_url, referrer, intent_type, cta_label, device_type, metadata, occurred_at, user_agent, ip_address, is_bot, bot_score, bot_signals, site_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
      event.occurred_at || new Date().toISOString(),
      event.user_agent || null,
      event.ip_address || null,
      event.is_bot || false,
      event.bot_score || 0,
      event.bot_signals || null,
      event.site_id || null
    ]
  );
  return { lastInsertRowid: result.rows[0].id };
}

async function getEventsByJourneyId(journeyId, siteId = null) {
  const db = getDb();
  let query = `SELECT * FROM journey_events WHERE journey_id = $1`;
  const params = [journeyId];

  if (siteId) {
    query += ` AND site_id = $2`;
    params.push(siteId);
  }

  query += ` ORDER BY occurred_at ASC`;
  const result = await db.query(query, params);
  return result.rows;
}

async function getUniqueJourneyIds(since = null, siteId = null) {
  const db = getDb();
  let query = 'SELECT DISTINCT journey_id FROM journey_events WHERE 1=1';
  const params = [];
  let paramIndex = 1;

  if (since) {
    query += ` AND occurred_at >= $${paramIndex}`;
    params.push(since);
    paramIndex++;
  }

  if (siteId) {
    query += ` AND site_id = $${paramIndex}`;
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return result.rows.map(r => r.journey_id);
}

async function getEventsInDateRange(startDate, endDate, siteId = null) {
  const db = getDb();
  let query = `SELECT * FROM journey_events WHERE occurred_at >= $1 AND occurred_at <= $2`;
  const params = [startDate, endDate];

  if (siteId) {
    query += ` AND site_id = $3`;
    params.push(siteId);
  }

  query += ` ORDER BY journey_id, occurred_at ASC`;
  const result = await db.query(query, params);
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
    loops: journey.loops || [],
    bot_signals: journey.bot_signals || []
  };

  const result = await db.query(
    `INSERT INTO journeys (journey_id, visitor_id, visit_number, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, confidence, metadata, is_bot, bot_score, bot_type, site_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, CURRENT_TIMESTAMP)
     ON CONFLICT(journey_id) DO UPDATE SET
       last_seen = EXCLUDED.last_seen,
       page_sequence = EXCLUDED.page_sequence,
       event_count = EXCLUDED.event_count,
       outcome = EXCLUDED.outcome,
       time_to_action = EXCLUDED.time_to_action,
       confidence = EXCLUDED.confidence,
       metadata = EXCLUDED.metadata,
       is_bot = EXCLUDED.is_bot,
       bot_score = EXCLUDED.bot_score,
       bot_type = EXCLUDED.bot_type,
       site_id = COALESCE(journeys.site_id, EXCLUDED.site_id),
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
      JSON.stringify(metadata),
      journey.is_bot || false,
      journey.bot_score || 0,
      journey.bot_type || null,
      journey.site_id || null
    ]
  );
  return result;
}

async function getAllJourneys(limit = 100, offset = 0, options = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  // Filter by site_id
  if (options.siteId) {
    conditions.push(`site_id = $${paramIndex}`);
    params.push(options.siteId);
    paramIndex++;
  }

  // Filter by bot status
  if (options.excludeBots === true) {
    conditions.push('(is_bot = false OR is_bot IS NULL)');
  } else if (options.botsOnly === true) {
    conditions.push('is_bot = true');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  params.push(limit);
  params.push(offset);

  const result = await db.query(
    `SELECT * FROM journeys ${whereClause} ORDER BY last_seen DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );
  return result.rows;
}

async function getJourneyById(journeyId, siteId = null) {
  const db = getDb();
  let query = 'SELECT * FROM journeys WHERE journey_id = $1';
  const params = [journeyId];

  if (siteId) {
    query += ' AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return result.rows[0];
}

async function getJourneyCount(options = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (options.siteId) {
    conditions.push(`site_id = $${paramIndex}`);
    params.push(options.siteId);
    paramIndex++;
  }

  if (options.excludeBots === true) {
    conditions.push('(is_bot = false OR is_bot IS NULL)');
  } else if (options.botsOnly === true) {
    conditions.push('is_bot = true');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query(`SELECT COUNT(*) as count FROM journeys ${whereClause}`, params);
  return parseInt(result.rows[0].count);
}

async function getJourneysInDateRange(startDate, endDate, siteId = null) {
  const db = getDb();
  // Add time component to ensure full day coverage
  const startDateTime = startDate.includes('T') ? startDate : startDate + 'T00:00:00.000Z';
  const endDateTime = endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z';

  let query = `SELECT * FROM journeys WHERE first_seen >= $1 AND first_seen <= $2`;
  const params = [startDateTime, endDateTime];

  if (siteId) {
    query += ` AND site_id = $3`;
    params.push(siteId);
  }

  query += ` ORDER BY first_seen DESC`;
  const result = await db.query(query, params);
  return result.rows;
}

async function getJourneyStats(siteId = null) {
  const db = getDb();
  let whereClause = '';
  const params = [];

  if (siteId) {
    whereClause = 'WHERE site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COUNT(*) as total_journeys,
      COUNT(CASE WHEN outcome = 'enquiry_submitted' THEN 1 END) as enquiries,
      COUNT(CASE WHEN outcome = 'visit_booked' THEN 1 END) as visits_booked,
      COUNT(CASE WHEN outcome = 'no_action' THEN 1 END) as no_action,
      AVG(event_count) as avg_events,
      AVG(time_to_action) as avg_time_to_action
    FROM journeys ${whereClause}
  `, params);
  return result.rows[0];
}

// ============================================
// NEW CHART DATA QUERIES
// ============================================

/**
 * Get top pages by view count
 */
async function getTopPages(limit = 10, siteId = null) {
  const db = getDb();
  let whereClause = "WHERE event_type = 'page_view' AND page_url IS NOT NULL";
  const params = [limit];

  if (siteId) {
    whereClause += ' AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as views,
      COUNT(DISTINCT journey_id) as unique_visitors
    FROM journey_events
    ${whereClause}
    GROUP BY page_url
    ORDER BY views DESC
    LIMIT $1
  `, params);
  return result.rows;
}

/**
 * Get device type breakdown
 */
async function getDeviceBreakdown(siteId = null) {
  const db = getDb();
  let whereClause = "WHERE event_type = 'page_view'";
  const params = [];

  if (siteId) {
    whereClause += ' AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(device_type, 'unknown') as device_type,
      COUNT(DISTINCT journey_id) as count
    FROM journey_events
    ${whereClause}
    GROUP BY device_type
    ORDER BY count DESC
  `, params);
  return result.rows;
}

/**
 * Get traffic sources breakdown from referrers
 */
async function getTrafficSources(siteId = null) {
  const db = getDb();
  let whereClause = '';
  const params = [];

  if (siteId) {
    whereClause = 'WHERE site_id = $1';
    params.push(siteId);
  }

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
    ${whereClause}
    GROUP BY source
    ORDER BY count DESC
  `, params);
  return result.rows;
}

/**
 * Get daily journey and conversion trend
 */
async function getDailyJourneyTrend(days = 30, siteId = null) {
  const db = getDb();
  let whereClause = `WHERE first_seen >= NOW() - INTERVAL '${days} days'`;

  if (siteId) {
    whereClause += ' AND site_id = $1';
  }

  const result = await db.query(`
    SELECT
      DATE(first_seen) as date,
      COUNT(*) as journeys,
      COUNT(CASE WHEN outcome IN ('enquiry_submitted', 'visit_booked') THEN 1 END) as conversions
    FROM journeys
    ${whereClause}
    GROUP BY DATE(first_seen)
    ORDER BY date ASC
  `, siteId ? [siteId] : []);
  return result.rows;
}

/**
 * Get scroll depth distribution
 */
async function getScrollDepthDistribution(siteId = null) {
  const db = getDb();
  let whereClause = "WHERE event_type = 'scroll_depth' AND cta_label ~ '^[0-9]+$'";
  const params = [];

  if (siteId) {
    whereClause += ' AND site_id = $1';
    params.push(siteId);
  }

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
    ${whereClause}
    GROUP BY depth_range
    ORDER BY depth_range
  `, params);
  return result.rows;
}

/**
 * Get visitor locations from recent events
 */
async function getVisitorLocations(withinSeconds = 300, siteId = null) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  let whereClause = `WHERE je.occurred_at >= $1 AND je.event_type = 'page_view' AND je.metadata IS NOT NULL`;
  const params = [cutoffTime];

  if (siteId) {
    whereClause += ' AND je.site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT DISTINCT ON (je.journey_id)
      je.journey_id,
      je.metadata
    FROM journey_events je
    ${whereClause}
    ORDER BY je.journey_id, je.occurred_at DESC
  `, params);

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
async function getOutcomeDistribution(siteId = null) {
  const db = getDb();
  let whereClause = '';
  const params = [];

  if (siteId) {
    whereClause = 'WHERE site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(outcome, 'no_action') as outcome,
      COUNT(*) as count
    FROM journeys
    ${whereClause}
    GROUP BY outcome
    ORDER BY
      CASE outcome
        WHEN 'enquiry_submitted' THEN 1
        WHEN 'visit_booked' THEN 2
        WHEN 'engaged' THEN 3
        WHEN 'form_abandoned' THEN 4
        ELSE 5
      END
  `, params);
  return result.rows;
}

/**
 * Get conversion funnel stages
 */
async function getConversionFunnel(siteId = null) {
  const db = getDb();
  const siteFilter = siteId ? 'WHERE site_id = $1' : '';
  const eventSiteFilter = siteId ? 'WHERE site_id = $1' : '';
  const params = siteId ? [siteId] : [];

  // Get total journeys
  const totalResult = await db.query(`SELECT COUNT(DISTINCT journey_id) as count FROM journeys ${siteFilter}`, params);
  const total = parseInt(totalResult.rows[0].count);

  // Get journeys with multiple page views (engaged)
  const engagedFilter = siteId ? 'WHERE event_count > 1 AND site_id = $1' : 'WHERE event_count > 1';
  const engagedResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journeys
    ${engagedFilter}
  `, params);
  const engaged = parseInt(engagedResult.rows[0].count);

  // Get journeys with CTA clicks
  const ctaFilter = siteId ? "WHERE event_type = 'cta_click' AND site_id = $1" : "WHERE event_type = 'cta_click'";
  const ctaResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journey_events
    ${ctaFilter}
  `, params);
  const ctaClicks = parseInt(ctaResult.rows[0].count);

  // Get journeys with form starts
  const formFilter = siteId ? "WHERE event_type = 'form_start' AND site_id = $1" : "WHERE event_type = 'form_start'";
  const formStartResult = await db.query(`
    SELECT COUNT(DISTINCT journey_id) as count
    FROM journey_events
    ${formFilter}
  `, params);
  const formStarts = parseInt(formStartResult.rows[0].count);

  // Get conversions
  const convFilter = siteId ? "WHERE outcome IN ('enquiry_submitted', 'visit_booked') AND site_id = $1" : "WHERE outcome IN ('enquiry_submitted', 'visit_booked')";
  const conversionResult = await db.query(`
    SELECT COUNT(*) as count
    FROM journeys
    ${convFilter}
  `, params);
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
async function getReturnVisitorStats(siteId = null) {
  const db = getDb();
  let whereClause = '';
  const params = [];

  if (siteId) {
    whereClause = 'WHERE site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COUNT(CASE WHEN visit_number = 1 THEN 1 END) as new_visitors,
      COUNT(CASE WHEN visit_number > 1 THEN 1 END) as return_visitors
    FROM journeys
    ${whereClause}
  `, params);
  return result.rows[0];
}

/**
 * Get hourly activity pattern
 */
async function getHourlyActivity(siteId = null) {
  const db = getDb();
  let whereClause = "WHERE occurred_at >= NOW() - INTERVAL '7 days'";

  if (siteId) {
    whereClause += ' AND site_id = $1';
  }

  const result = await db.query(`
    SELECT
      EXTRACT(HOUR FROM occurred_at) as hour,
      COUNT(*) as events
    FROM journey_events
    ${whereClause}
    GROUP BY hour
    ORDER BY hour
  `, siteId ? [siteId] : []);
  return result.rows;
}

// Insight queries
async function insertInsight(insight) {
  const db = getDb();
  const result = await db.query(
    `INSERT INTO insights (period_start, period_end, total_journeys, conversion_rate, analysis_result, site_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      insight.period_start,
      insight.period_end,
      insight.total_journeys,
      insight.conversion_rate,
      JSON.stringify(insight.analysis_result),
      insight.site_id || null
    ]
  );
  return result;
}

async function getLatestInsight(siteId = null) {
  const db = getDb();
  let query = 'SELECT * FROM insights';
  const params = [];

  if (siteId) {
    query += ' WHERE site_id = $1';
    params.push(siteId);
  }

  query += ' ORDER BY created_at DESC LIMIT 1';
  const result = await db.query(query, params);
  return result.rows[0];
}

async function getAllInsights(limit = 10, siteId = null) {
  const db = getDb();
  let query = 'SELECT * FROM insights';
  const params = [];
  let paramIndex = 1;

  if (siteId) {
    query += ` WHERE site_id = $${paramIndex}`;
    params.push(siteId);
    paramIndex++;
  }

  query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
  params.push(limit);

  const result = await db.query(query, params);
  return result.rows;
}

// Real-time queries
async function getActiveVisitors(withinSeconds = 300, siteId = null) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  let whereClause = `WHERE je.occurred_at >= $1
       AND je.event_type IN ('heartbeat', 'page_view', 'cta_click', 'form_start', 'form_submit')`;
  const params = [cutoffTime];

  if (siteId) {
    whereClause += ' AND je.site_id = $2';
    params.push(siteId);
  }

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
     ${whereClause}
     ORDER BY je.journey_id, je.occurred_at DESC`,
    params
  );
  return result.rows;
}

async function getRecentNewJourneys(sinceSeconds = 300, siteId = null) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (sinceSeconds * 1000)).toISOString();

  let whereClause = "WHERE je.event_type = 'page_view'";
  const params = [cutoffTime];

  if (siteId) {
    whereClause += ' AND je.site_id = $2';
    params.push(siteId);
  }

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
     ${whereClause}
     GROUP BY je.journey_id
     HAVING MIN(je.occurred_at) >= $1
     ORDER BY MIN(je.occurred_at) DESC`,
    params
  );
  return result.rows;
}

async function getActiveVisitorCount(withinSeconds = 300, siteId = null) {
  const db = getDb();
  const cutoffTime = new Date(Date.now() - (withinSeconds * 1000)).toISOString();

  let whereClause = `WHERE occurred_at >= $1
       AND event_type IN ('heartbeat', 'page_view', 'cta_click', 'form_start', 'form_submit')`;
  const params = [cutoffTime];

  if (siteId) {
    whereClause += ' AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(
    `SELECT COUNT(DISTINCT journey_id) as count
     FROM journey_events
     ${whereClause}`,
    params
  );
  return parseInt(result.rows[0].count);
}

/**
 * Get latest sessions that are no longer active
 * Always returns the most recent N sessions (not currently active)
 */
async function getRecentInactiveSessions(inactiveAfterSeconds = 300, limit = 10, siteId = null) {
  const db = getDb();
  const activeCutoff = new Date(Date.now() - (inactiveAfterSeconds * 1000)).toISOString();

  let whereClause = 'WHERE j.last_seen < $1';
  const params = [activeCutoff];
  let paramIndex = 2;

  if (siteId) {
    whereClause += ` AND j.site_id = $${paramIndex}`;
    params.push(siteId);
    paramIndex++;
  }

  params.push(limit);

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
     ${whereClause}
     ORDER BY j.last_seen DESC
     LIMIT $${paramIndex}`,
    params
  );
  return result.rows;
}

// ============================================
// SITE LOOKUP FUNCTIONS
// ============================================

/**
 * Look up site by tracking key (used by event API)
 */
async function getSiteByTrackingKey(trackingKey) {
  const db = getDb();
  const result = await db.query(
    'SELECT * FROM sites WHERE tracking_key = $1',
    [trackingKey]
  );
  return result.rows[0] || null;
}

/**
 * Get all sites
 */
async function getAllSites() {
  const db = getDb();
  const result = await db.query('SELECT * FROM sites ORDER BY name');
  return result.rows;
}

/**
 * Get site by ID
 */
async function getSiteById(siteId) {
  const db = getDb();
  const result = await db.query('SELECT * FROM sites WHERE id = $1', [siteId]);
  return result.rows[0] || null;
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
  getRecentInactiveSessions,
  // Sites
  getSiteByTrackingKey,
  getAllSites,
  getSiteById
};

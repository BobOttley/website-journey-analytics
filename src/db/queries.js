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
    `INSERT INTO journeys (journey_id, visitor_id, visit_number, first_seen, last_seen, entry_page, entry_referrer, initial_intent, page_sequence, event_count, outcome, time_to_action, confidence, metadata, is_bot, bot_score, bot_type, site_id, primary_ip_address, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, CURRENT_TIMESTAMP)
     ON CONFLICT(journey_id) DO UPDATE SET
       visitor_id = EXCLUDED.visitor_id,
       visit_number = EXCLUDED.visit_number,
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
       primary_ip_address = COALESCE(EXCLUDED.primary_ip_address, journeys.primary_ip_address),
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
      journey.site_id || null,
      journey.primary_ip_address || null
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

  // Exclude internal analytics app traffic (test clicks from dashboard)
  conditions.push("(entry_referrer IS NULL OR entry_referrer NOT LIKE '%website-journey-analytics.onrender.com%')");

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
  let query = `SELECT *,
    COALESCE(entry_page, (
      SELECT je.page_url FROM journey_events je
      WHERE je.journey_id = journeys.journey_id
      AND je.event_type = 'page_view'
      AND je.page_url IS NOT NULL
      AND je.page_url NOT LIKE '%gtm-msr.appspot.com%'
      ORDER BY je.occurred_at ASC LIMIT 1
    )) as entry_page
    FROM journeys WHERE journey_id = $1`;
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

  // Exclude internal analytics app traffic (test clicks from dashboard)
  conditions.push("(entry_referrer IS NULL OR entry_referrer NOT LIKE '%website-journey-analytics.onrender.com%')");

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db.query(`SELECT COUNT(*) as count FROM journeys ${whereClause}`, params);
  return parseInt(result.rows[0].count);
}

async function getJourneysInDateRange(startDate, endDate, siteId = null) {
  const db = getDb();
  // Add time component to ensure full day coverage
  const startDateTime = startDate.includes('T') ? startDate : startDate + 'T00:00:00.000Z';
  const endDateTime = endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z';

  let query = `SELECT * FROM journeys WHERE first_seen >= $1 AND first_seen <= $2 AND (entry_page IS NULL OR entry_page NOT LIKE '%gtm-msr.appspot.com%')`;
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
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // Query journey_events directly for accurate counts
  // Counts UNIQUE VISITORS (people), not sessions/journeys
  const result = await db.query(`
    WITH journey_data AS (
      SELECT DISTINCT journey_id, visitor_id, is_bot
      FROM journey_events
      WHERE ${dateFilter} ${siteFilter} ${excludeExistingParents}
    ),
    human_visitors AS (
      SELECT DISTINCT visitor_id, journey_id
      FROM journey_data
      WHERE ${botFilter} AND visitor_id IS NOT NULL
    ),
    visitor_stats AS (
      SELECT
        visitor_id,
        COUNT(DISTINCT journey_id) as journey_count
      FROM human_visitors
      GROUP BY visitor_id
    ),
    conversion_data AS (
      SELECT
        journey_id,
        -- Only count Render app form submissions
        MAX(CASE WHEN event_type = 'form_submit' AND
          page_url ~* 'prospectus.*onrender' THEN 1 ELSE 0 END) as is_enquiry,
        MAX(CASE WHEN event_type = 'form_submit' AND
          page_url ~* 'booking.*onrender' THEN 1 ELSE 0 END) as is_booking,
        COUNT(*) as event_count
      FROM journey_events
      WHERE ${dateFilter} AND ${botFilter} ${siteFilter} ${excludeExistingParents}
      GROUP BY journey_id
    )
    SELECT
      (SELECT COUNT(DISTINCT visitor_id) FROM human_visitors) as human_visitors,
      (SELECT COUNT(DISTINCT journey_id) FROM journey_data WHERE is_bot = true) as bot_count,
      (SELECT COUNT(*) FROM visitor_stats WHERE journey_count > 1) as return_visitors,
      (SELECT COALESCE(SUM(is_enquiry), 0) FROM conversion_data) as enquiries,
      (SELECT COALESCE(SUM(is_booking), 0) FROM conversion_data) as visits_booked,
      (SELECT COUNT(*) FROM conversion_data WHERE is_enquiry = 0 AND is_booking = 0) as no_action,
      (SELECT ROUND(AVG(event_count), 1) FROM conversion_data) as avg_events,
      (SELECT COUNT(DISTINCT journey_id) FROM journey_data) as total_journeys,
      (SELECT ROUND(AVG(journey_count), 1) FROM visitor_stats) as avg_visits_per_visitor
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
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  // Normalize URLs: extract path, handle searches, remove trailing slashes
  // Search queries (?s=xxx) get labeled as "Search: xxx"
  const result = await db.query(`
    WITH normalized AS (
      SELECT
        journey_id,
        CASE
          -- Search queries
          WHEN page_url ~ '\\?s=' THEN 'Search: ' || COALESCE(
            regexp_replace(page_url, '.*\\?s=([^&]+).*', '\\1'),
            'unknown'
          )
          -- Home page: URL is just domain with optional trailing slash and/or query string (not search)
          WHEN page_url ~ '^https?://[^/]+/?($|\\?)' AND page_url NOT LIKE '%?s=%'
          THEN '/'
          -- Other pages: extract path, remove query string and trailing slash
          ELSE LOWER(regexp_replace(
            regexp_replace(
              regexp_replace(page_url, '^https?://[^/]+', ''),
              '\\?.*$', ''
            ),
            '/+$', ''
          ))
        END as normalized_url
      FROM journey_events
      WHERE event_type IN ('page_view', 'pixel_view')
        AND page_url IS NOT NULL
        AND page_url NOT LIKE '%gtm-msr.appspot.com%'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
        ${excludeExistingParents}
    )
    SELECT
      normalized_url as page_url,
      COUNT(*) as views,
      COUNT(DISTINCT journey_id) as unique_visitors
    FROM normalized
    GROUP BY normalized_url
    ORDER BY views DESC
    LIMIT $1
  `, params);
  return result.rows;
}

/**
 * Get device type breakdown
 * Uses journey_events with proper filters
 */
async function getDeviceBreakdown(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(device_type, 'unknown') as device_type,
      COUNT(DISTINCT journey_id) as count
    FROM journey_events
    WHERE event_type IN ('page_view', 'pixel_view')
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
      ${excludeExistingParents}
    GROUP BY device_type
    ORDER BY count DESC
  `, params);
  return result.rows;
}

/**
 * Get traffic sources breakdown from referrers
 * Uses journey_events for accurate data
 */
async function getTrafficSources(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // Get first referrer for each journey
  const result = await db.query(`
    WITH first_referrers AS (
      SELECT DISTINCT ON (journey_id)
        journey_id,
        referrer
      FROM journey_events
      WHERE ${dateFilter} AND ${botFilter} ${siteFilter} ${excludeExistingParents}
      ORDER BY journey_id, occurred_at ASC
    )
    SELECT
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
        WHEN referrer LIKE '%google%' THEN 'Google'
        WHEN referrer LIKE '%bing%' THEN 'Bing'
        WHEN referrer LIKE '%facebook%' OR referrer LIKE '%fb.%' THEN 'Facebook'
        WHEN referrer LIKE '%instagram%' THEN 'Instagram'
        WHEN referrer LIKE '%twitter%' OR referrer LIKE '%x.com%' THEN 'Twitter/X'
        WHEN referrer LIKE '%linkedin%' THEN 'LinkedIn'
        WHEN referrer LIKE '%youtube%' THEN 'YouTube'
        ELSE 'Other'
      END as source,
      COUNT(*) as count
    FROM first_referrers
    GROUP BY source
    ORDER BY count DESC
  `, params);
  return result.rows;
}

/**
 * Get daily journey and conversion trend
 * Uses journey_events for accurate data
 */
async function getDailyJourneyTrend(days = 30, siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH daily_journeys AS (
      SELECT
        DATE(MIN(occurred_at)) as date,
        journey_id,
        -- Only count form submissions from Render apps (enquiry form or booking form)
        MAX(CASE WHEN event_type = 'form_submit' AND page_url ~* 'onrender\\.com' THEN 1 ELSE 0 END) as converted
      FROM journey_events
      WHERE occurred_at >= NOW() - INTERVAL '${days} days'
        AND ${botFilter}
        ${siteFilter}
        ${excludeExistingParents}
      GROUP BY journey_id
    )
    SELECT
      date,
      COUNT(*) as journeys,
      SUM(converted) as conversions
    FROM daily_journeys
    GROUP BY date
    ORDER BY date ASC
  `, params);
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
 * Uses journey_events for accurate data
 */
async function getConversionFunnel(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = siteId ? [siteId] : [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
  }

  // Get all funnel stages in one query for consistency
  const result = await db.query(`
    WITH filtered_journeys AS (
      SELECT DISTINCT journey_id
      FROM journey_events
      WHERE ${dateFilter} AND ${botFilter} ${siteFilter} ${excludeExistingParents}
    ),
    journey_stats AS (
      SELECT
        je.journey_id,
        COUNT(*) as event_count,
        -- Only count Render app activity (enquiry/booking forms), not main website
        COUNT(*) FILTER (WHERE je.event_type = 'cta_click' AND je.page_url ~* 'onrender\\.com') as cta_clicks,
        COUNT(*) FILTER (WHERE je.event_type = 'form_start' AND je.page_url ~* 'onrender\\.com') as form_starts,
        COUNT(*) FILTER (WHERE je.event_type = 'form_submit' AND je.page_url ~* 'onrender\\.com') as form_submits
      FROM journey_events je
      INNER JOIN filtered_journeys fj ON je.journey_id = fj.journey_id
      WHERE ${dateFilter} ${siteFilter}
      GROUP BY je.journey_id
    )
    SELECT
      COUNT(*) as total_visitors,
      COUNT(*) FILTER (WHERE event_count > 1) as engaged,
      COUNT(*) FILTER (WHERE cta_clicks > 0) as cta_clicked,
      COUNT(*) FILTER (WHERE form_starts > 0) as form_started,
      COUNT(*) FILTER (WHERE form_submits > 0) as converted
    FROM journey_stats
  `, params);

  const data = result.rows[0];

  return [
    { stage: 'Visitors', count: parseInt(data.total_visitors || 0) },
    { stage: 'Engaged', count: parseInt(data.engaged || 0) },
    { stage: 'CTA Clicked', count: parseInt(data.cta_clicked || 0) },
    { stage: 'Form Started', count: parseInt(data.form_started || 0) },
    { stage: 'Converted', count: parseInt(data.converted || 0) }
  ];
}

/**
 * Get return visitor stats
 * Counts UNIQUE VISITORS (people, not sessions)
 * - new_visitors: people who only visited once
 * - return_visitors: people who came back (2+ visits)
 * - total_return_visits: total number of return visits made
 * - avg_visits: average visits per returning visitor
 */
async function getReturnVisitorStats(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH visitor_journeys AS (
      SELECT DISTINCT visitor_id, journey_id
      FROM journey_events
      WHERE visitor_id IS NOT NULL
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
        ${excludeExistingParents}
    ),
    visitor_stats AS (
      SELECT visitor_id, COUNT(DISTINCT journey_id) as journey_count
      FROM visitor_journeys
      GROUP BY visitor_id
    )
    SELECT
      COUNT(*) FILTER (WHERE journey_count = 1) as new_visitors,
      COUNT(*) FILTER (WHERE journey_count > 1) as return_visitors,
      SUM(journey_count - 1) FILTER (WHERE journey_count > 1) as total_return_visits,
      ROUND(AVG(journey_count) FILTER (WHERE journey_count > 1), 1) as avg_visits_per_returner
    FROM visitor_stats
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
       (SELECT je4.metadata FROM journey_events je4 WHERE je4.journey_id = je.journey_id AND je4.event_type = 'page_view' AND je4.metadata IS NOT NULL ORDER BY je4.occurred_at ASC LIMIT 1) as metadata,
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

  let whereClause = "WHERE je.event_type = 'page_view' AND je.page_url NOT LIKE '%gtm-msr.appspot.com%'";
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
       (SELECT je2.page_url FROM journey_events je2 WHERE je2.journey_id = je.journey_id AND je2.page_url NOT LIKE '%gtm-msr.appspot.com%' ORDER BY je2.occurred_at ASC LIMIT 1) as entry_page,
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

  let whereClause = `WHERE j.last_seen < $1
    AND (j.entry_page IS NULL OR j.entry_page NOT LIKE '%gtm-msr.appspot.com%')
    AND EXISTS (
      SELECT 1 FROM journey_events je3
      WHERE je3.journey_id = j.journey_id
      AND (je3.page_url IS NULL OR je3.page_url NOT LIKE '%gtm-msr.appspot.com%')
    )`;
  const params = [activeCutoff];
  let paramIndex = 2;

  // Filter by site_id using journey_events table (more reliable than journeys.site_id)
  if (siteId) {
    whereClause += ` AND EXISTS (SELECT 1 FROM journey_events je2 WHERE je2.journey_id = j.journey_id AND je2.site_id = $${paramIndex})`;
    params.push(siteId);
    paramIndex++;
  }

  params.push(limit);

  const result = await db.query(
    `SELECT
       j.journey_id,
       j.first_seen,
       j.last_seen,
       COALESCE(j.entry_page, (SELECT je.page_url FROM journey_events je WHERE je.journey_id = j.journey_id AND je.event_type = 'page_view' AND je.page_url IS NOT NULL ORDER BY je.occurred_at ASC LIMIT 1)) as entry_page,
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
// UX ANALYTICS QUERIES
// ============================================

/**
 * Get UX overview stats for KPI cards
 */
async function getUXOverview(siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];
  let paramIndex = 1;

  if (siteId) {
    siteFilter = `AND site_id = $${paramIndex}`;
    params.push(siteId);
    paramIndex++;
  }

  // Dead clicks count (7 days)
  const deadClicksResult = await db.query(`
    SELECT COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'dead_click'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
      ${excludeExistingParents}
  `, params);

  // CTA hesitations - hovers without clicks
  const hesitationsResult = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE event_type = 'cta_hover') as hovers,
      COUNT(*) FILTER (WHERE event_type = 'cta_click') as clicks
    FROM journey_events
    WHERE event_type IN ('cta_hover', 'cta_click')
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
  `, params);

  // Quick backs (back within 5 seconds)
  const quickBacksResult = await db.query(`
    SELECT COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'quick_back'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
  `, params);

  // Scroll behaviour breakdown
  const scrollResult = await db.query(`
    SELECT
      metadata->>'scroll_behaviour' as behaviour,
      COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'scroll_depth'
      AND metadata->>'scroll_behaviour' IS NOT NULL
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY metadata->>'scroll_behaviour'
  `, params);

  // Search queries count
  const searchResult = await db.query(`
    SELECT COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'site_search'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
  `, params);

  // Calculate metrics
  const deadClicks = parseInt(deadClicksResult.rows[0]?.count || 0);
  const hovers = parseInt(hesitationsResult.rows[0]?.hovers || 0);
  const clicks = parseInt(hesitationsResult.rows[0]?.clicks || 0);
  // Hesitation rate: % of hovers that didn't result in a click (clamped 0-100)
  const rawHesitationRate = hovers > 0 ? Math.round(((hovers - clicks) / hovers) * 100) : 0;
  const hesitationRate = Math.max(0, Math.min(100, rawHesitationRate));
  const quickBacks = parseInt(quickBacksResult.rows[0]?.count || 0);
  const searches = parseInt(searchResult.rows[0]?.count || 0);

  // Determine dominant scroll behaviour
  let dominantScrollBehaviour = 'unknown';
  let maxCount = 0;
  const scrollBehaviours = {};
  for (const row of scrollResult.rows) {
    const count = parseInt(row.count);
    scrollBehaviours[row.behaviour] = count;
    if (count > maxCount) {
      maxCount = count;
      dominantScrollBehaviour = row.behaviour;
    }
  }

  // Calculate friction score (0-100, lower is better)
  // Weight: dead clicks heavily, hesitations medium, quick backs medium
  const frictionScore = Math.max(0, Math.min(100, Math.round(
    (deadClicks * 2) +
    (hesitationRate * 0.5) +
    (quickBacks * 1.5)
  )));

  return {
    frictionScore,
    deadClicks,
    hesitationRate,
    quickBacks,
    scrollBehaviour: dominantScrollBehaviour,
    scrollBehaviours,
    searches
  };
}

/**
 * Get dead click hotspots
 */
async function getDeadClicks(siteId = null, limit = 20) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'element', 'unknown') as element,
      COALESCE(metadata->>'text', '') as text_clicked,
      page_url,
      COUNT(*) as click_count,
      COUNT(DISTINCT journey_id) as unique_visitors
    FROM journey_events
    WHERE event_type = 'dead_click'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY metadata->>'element', metadata->>'text', page_url
    ORDER BY click_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get CTA hesitation data
 */
async function getCTAHesitations(siteId = null, limit = 20) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  // Get hover events with their durations
  // Note: GTM sends 'text' in metadata, trackingScript.js sends 'cta_label' - support both
  const result = await db.query(`
    WITH hover_data AS (
      SELECT
        COALESCE(cta_label, metadata->>'text') as cta_label,
        journey_id,
        COALESCE((metadata->>'hover_duration')::numeric, 0) as hover_duration,
        metadata->>'href' as href
      FROM journey_events
      WHERE event_type = 'cta_hover'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
    ),
    click_data AS (
      SELECT DISTINCT COALESCE(cta_label, metadata->>'text') as cta_label, journey_id
      FROM journey_events
      WHERE event_type = 'cta_click'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
    )
    SELECT
      h.cta_label,
      h.href,
      COUNT(*) as hesitation_count,
      ROUND(AVG(h.hover_duration)::numeric, 1) as avg_hover_time,
      COUNT(DISTINCT h.journey_id) as unique_hovers,
      COUNT(DISTINCT c.journey_id) as unique_clicks
    FROM hover_data h
    LEFT JOIN click_data c ON h.cta_label = c.cta_label AND h.journey_id = c.journey_id
    WHERE h.cta_label IS NOT NULL AND h.cta_label != ''
    GROUP BY h.cta_label, h.href
    HAVING COUNT(*) >= 2
    ORDER BY hesitation_count DESC
    LIMIT $1
  `, params);

  // Calculate click rate for each CTA
  return result.rows.map(row => ({
    ...row,
    click_rate: row.unique_hovers > 0
      ? Math.round((row.unique_clicks / row.unique_hovers) * 100)
      : 0
  }));
}

/**
 * Get scroll behaviour distribution
 * Note: GTM sends 'depth' percentage, trackingScript.js sends 'scroll_behaviour' - support both
 */
async function getScrollBehaviour(siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // First try to get scroll_behaviour if available
  const behaviourResult = await db.query(`
    SELECT
      COALESCE(metadata->>'scroll_behaviour', 'unknown') as behaviour,
      COUNT(*) as count
    FROM journey_events
    WHERE event_type = 'scroll_depth'
      AND metadata->>'scroll_behaviour' IS NOT NULL
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY metadata->>'scroll_behaviour'
    ORDER BY count DESC
  `, params);

  if (behaviourResult.rows.length > 0) {
    return behaviourResult.rows;
  }

  // Fallback: Calculate behaviour from scroll depth patterns per journey
  // Readers: reach 75%+ depth, Scanners: 50-74%, Bouncers: <50%
  const depthResult = await db.query(`
    WITH journey_max_depth AS (
      SELECT
        journey_id,
        MAX(COALESCE((metadata->>'depth')::int, (metadata->>'depth_percent')::int, 0)) as max_depth
      FROM journey_events
      WHERE event_type = 'scroll_depth'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
      GROUP BY journey_id
    )
    SELECT
      CASE
        WHEN max_depth >= 75 THEN 'Deep Reader'
        WHEN max_depth >= 50 THEN 'Scanner'
        ELSE 'Quick Glancer'
      END as behaviour,
      COUNT(*) as count
    FROM journey_max_depth
    GROUP BY CASE
      WHEN max_depth >= 75 THEN 'Deep Reader'
      WHEN max_depth >= 50 THEN 'Scanner'
      ELSE 'Quick Glancer'
    END
    ORDER BY count DESC
  `, params);

  return depthResult.rows;
}

/**
 * Get scroll behaviour by page
 * Note: GTM sends 'depth' percentage, trackingScript.js sends 'scroll_behaviour' - support both
 */
async function getScrollBehaviourByPage(siteId = null, limit = 10) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  // Get scroll depth stats per page (works with both GTM and trackingScript.js)
  const result = await db.query(`
    WITH page_scroll AS (
      SELECT
        page_url,
        journey_id,
        MAX(COALESCE((metadata->>'depth')::int, (metadata->>'depth_percent')::int, 0)) as max_depth
      FROM journey_events
      WHERE event_type = 'scroll_depth'
        AND page_url IS NOT NULL
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
      GROUP BY page_url, journey_id
    )
    SELECT
      page_url,
      ROUND(AVG(max_depth)) as avg_depth,
      COUNT(*) as visitors,
      COUNT(*) FILTER (WHERE max_depth >= 75) as deep_readers,
      COUNT(*) FILTER (WHERE max_depth >= 50 AND max_depth < 75) as scanners,
      COUNT(*) FILTER (WHERE max_depth < 50) as bouncers
    FROM page_scroll
    GROUP BY page_url
    ORDER BY visitors DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get scroll depth percentages by page
 */
async function getScrollDepthByPage(siteId = null, limit = 10) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      page_url,
      ROUND(AVG((metadata->>'max_scroll')::numeric)) as avg_scroll_depth,
      MAX((metadata->>'max_scroll')::numeric) as max_scroll_depth,
      COUNT(*) as visitors
    FROM journey_events
    WHERE event_type = 'scroll_depth'
      AND metadata->>'max_scroll' IS NOT NULL
      AND page_url IS NOT NULL
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY page_url
    ORDER BY visitors DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get section visibility times
 */
async function getSectionVisibility(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'section', cta_label) as section,
      page_url,
      COUNT(*) as view_count
    FROM journey_events
    WHERE event_type = 'section_visibility'
      AND (metadata->>'section' IS NOT NULL OR cta_label IS NOT NULL)
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'section', cta_label), page_url
    HAVING COUNT(*) >= 1
    ORDER BY view_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get quick back analysis
 */
async function getQuickBacks(siteId = null, limit = 20) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as quick_back_count,
      ROUND(AVG((metadata->>'time_on_page')::numeric), 1) as avg_time_before_back,
      COUNT(DISTINCT journey_id) as unique_visitors
    FROM journey_events
    WHERE event_type = 'quick_back'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY page_url
    ORDER BY quick_back_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get site search queries
 */
async function getSearchQueries(siteId = null, limit = 30) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'query', cta_label) as search_query,
      COUNT(*) as search_count,
      COUNT(DISTINCT journey_id) as unique_searchers
    FROM journey_events
    WHERE event_type = 'site_search'
      AND (metadata->>'query' IS NOT NULL OR cta_label IS NOT NULL)
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'query', cta_label)
    ORDER BY search_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get text selection data
 */
async function getTextSelections(siteId = null, limit = 20) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'text', cta_label) as selected_text,
      page_url,
      COUNT(*) as selection_count,
      COUNT(DISTINCT journey_id) as unique_selectors
    FROM journey_events
    WHERE event_type = 'text_selection'
      AND (metadata->>'text' IS NOT NULL OR cta_label IS NOT NULL)
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'text', cta_label), page_url
    ORDER BY selection_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get 30-day UX metrics trend
 */
async function getUXTrend(siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      DATE(occurred_at) as date,
      COUNT(*) FILTER (WHERE event_type = 'dead_click') as dead_clicks,
      COUNT(*) FILTER (WHERE event_type = 'quick_back') as quick_backs,
      COUNT(*) FILTER (WHERE event_type = 'cta_hover') as hesitations
    FROM journey_events
    WHERE occurred_at >= NOW() - INTERVAL '30 days'
      AND event_type IN ('dead_click', 'quick_back', 'cta_hover')
      AND ${botFilter}
      ${siteFilter}
    GROUP BY DATE(occurred_at)
    ORDER BY date ASC
  `, params);

  return result.rows;
}

/**
 * Get exit pages - pages where visitors leave without clicking a CTA
 */
async function getExitPages(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  // Find the last page for each journey, and whether they clicked any CTA
  const result = await db.query(`
    WITH journey_exits AS (
      -- Get the last page_view for each journey
      SELECT DISTINCT ON (journey_id)
        journey_id,
        page_url as exit_page
      FROM journey_events
      WHERE event_type = 'page_view'
        AND page_url NOT LIKE '%gtm-msr.appspot.com%'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
      ORDER BY journey_id, occurred_at DESC
    ),
    journey_ctas AS (
      -- Check which journeys had at least one CTA click
      SELECT DISTINCT journey_id
      FROM journey_events
      WHERE event_type = 'cta_click'
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
    )
    SELECT
      je.exit_page as page_url,
      COUNT(*) as total_exits,
      COUNT(*) FILTER (WHERE jc.journey_id IS NULL) as exits_without_cta,
      ROUND(
        (COUNT(*) FILTER (WHERE jc.journey_id IS NULL)::numeric / COUNT(*)::numeric) * 100
      ) as exit_rate
    FROM journey_exits je
    LEFT JOIN journey_ctas jc ON je.journey_id = jc.journey_id
    WHERE je.exit_page IS NOT NULL
    GROUP BY je.exit_page
    HAVING COUNT(*) >= 1
    ORDER BY exits_without_cta DESC, total_exits DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get form field analytics - which fields cause abandonment
 */
async function getFormAnalytics(siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH form_events AS (
      SELECT
        journey_id,
        COALESCE(metadata->>'form_id', metadata->>'form_name', 'unknown') as form_id,
        COALESCE(metadata->>'field_name', cta_label) as field_name,
        event_type,
        COALESCE((metadata->>'time_spent')::numeric, 0) as time_spent
      FROM journey_events
      WHERE event_type IN ('form_start', 'form_field_blur', 'form_abandon', 'form_submit')
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
    )
    SELECT
      form_id,
      COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_start') as starts,
      COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_submit') as completions,
      COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_abandon') as abandons,
      ROUND(
        CASE WHEN COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_start') > 0
        THEN (COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_submit')::numeric /
              COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_start')::numeric) * 100
        ELSE 0 END
      ) as completion_rate
    FROM form_events
    GROUP BY form_id
    HAVING COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'form_start') > 0
    ORDER BY starts DESC
  `, params);

  return result.rows;
}

/**
 * Get form field abandonment - which fields cause people to leave
 */
async function getFormFieldAbandonment(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'field_name', cta_label) as field_name,
      COALESCE(metadata->>'form_id', 'unknown') as form_id,
      COUNT(*) as abandon_count,
      ROUND(AVG(COALESCE((metadata->>'time_spent')::numeric, 0)), 1) as avg_time_on_field
    FROM journey_events
    WHERE event_type = 'form_abandon'
      AND (metadata->>'field_name' IS NOT NULL OR cta_label IS NOT NULL)
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'field_name', cta_label), COALESCE(metadata->>'form_id', 'unknown')
    ORDER BY abandon_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get PDF download analytics
 */
async function getPDFDownloads(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'filename', cta_label) as filename,
      page_url,
      COUNT(*) as download_count,
      COUNT(DISTINCT journey_id) as unique_downloaders
    FROM journey_events
    WHERE event_type = 'pdf_download'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'filename', cta_label), page_url
    ORDER BY download_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get video engagement analytics
 */
async function getVideoEngagement(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH video_events AS (
      SELECT
        journey_id,
        COALESCE(metadata->>'video_id', metadata->>'video_title', cta_label) as video_id,
        event_type,
        page_url
      FROM journey_events
      WHERE event_type IN ('video_play', 'video_pause', 'video_complete')
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
    )
    SELECT
      video_id,
      COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_play') as plays,
      COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_complete') as completions,
      ROUND(
        CASE WHEN COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_play') > 0
        THEN (COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_complete')::numeric /
              COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_play')::numeric) * 100
        ELSE 0 END
      ) as completion_rate
    FROM video_events
    GROUP BY video_id
    HAVING COUNT(DISTINCT journey_id) FILTER (WHERE event_type = 'video_play') > 0
    ORDER BY plays DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get rage click analytics - frustrated users clicking repeatedly
 */
async function getRageClicks(siteId = null, limit = 15) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;

  let siteFilter = '';
  const params = [limit];

  if (siteId) {
    siteFilter = 'AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      COALESCE(metadata->>'element', 'unknown') as element,
      COALESCE(metadata->>'text', cta_label, '') as element_text,
      page_url,
      COUNT(*) as rage_count,
      COUNT(DISTINCT journey_id) as unique_visitors,
      ROUND(AVG(COALESCE((metadata->>'click_count')::numeric, 3)), 0) as avg_clicks
    FROM journey_events
    WHERE event_type = 'rage_click'
      AND ${dateFilter}
      AND ${botFilter}
      ${siteFilter}
    GROUP BY COALESCE(metadata->>'element', 'unknown'), COALESCE(metadata->>'text', cta_label, ''), page_url
    ORDER BY rage_count DESC
    LIMIT $1
  `, params);

  return result.rows;
}

/**
 * Get return visitor stats
 */
async function getReturnVisitorAnalytics(siteId = null) {
  const db = getDb();
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;

  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH visitor_journeys AS (
      SELECT DISTINCT
        visitor_id,
        journey_id
      FROM journey_events
      WHERE visitor_id IS NOT NULL
        AND ${dateFilter}
        AND ${botFilter}
        ${siteFilter}
        ${excludeExistingParents}
    ),
    visitor_stats AS (
      SELECT
        visitor_id,
        COUNT(DISTINCT journey_id) as journey_count
      FROM visitor_journeys
      GROUP BY visitor_id
    )
    SELECT
      COUNT(*) FILTER (WHERE journey_count = 1) as new_visitors,
      COUNT(*) FILTER (WHERE journey_count > 1) as returning_visitors,
      ROUND(AVG(journey_count), 1) as avg_visits_per_visitor,
      MAX(journey_count) as max_visits
    FROM visitor_stats
  `, params);

  return result.rows[0] || { new_visitors: 0, returning_visitors: 0, avg_visits_per_visitor: 0, max_visits: 0 };
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

/**
 * Save AI analysis for a journey
 */
async function saveJourneyAnalysis(journeyId, analysis) {
  const db = getDb();
  const result = await db.query(
    `UPDATE journeys
     SET ai_analysis = $2, ai_analysed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE journey_id = $1
     RETURNING journey_id, ai_analysed_at`,
    [journeyId, JSON.stringify(analysis)]
  );
  return result.rows[0] || null;
}

/**
 * Get AI analysis for a journey
 */
async function getJourneyAnalysis(journeyId) {
  const db = getDb();
  const result = await db.query(
    `SELECT ai_analysis, ai_analysed_at FROM journeys WHERE journey_id = $1`,
    [journeyId]
  );
  if (result.rows[0] && result.rows[0].ai_analysis) {
    return {
      analysis: typeof result.rows[0].ai_analysis === 'string'
        ? JSON.parse(result.rows[0].ai_analysis)
        : result.rows[0].ai_analysis,
      analysed_at: result.rows[0].ai_analysed_at
    };
  }
  return null;
}

// ============================================
// VISITOR JOURNEY COUNT
// ============================================

/**
 * Count how many journeys a visitor has (for return visitor detection)
 * Returns the visit number for a specific journey based on first event time
 * Uses IP address OR visitor_id to link visits (IP is more reliable than localStorage)
 */
async function getVisitorJourneyNumber(visitorId, ipAddress, journeyFirstSeen, siteId = null) {
  const db = getDb();

  // Count distinct journey_ids that match either visitor_id OR ip_address
  // This catches return visitors even if localStorage was cleared
  let query = `
    SELECT COUNT(DISTINCT journey_id) as visit_number
    FROM journey_events
    WHERE occurred_at <= $1
      AND (
        (visitor_id = $2 AND visitor_id IS NOT NULL)
        OR (ip_address = $3 AND ip_address IS NOT NULL)
      )
  `;
  const params = [journeyFirstSeen, visitorId, ipAddress];

  if (siteId) {
    query += ` AND site_id = $4`;
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return parseInt(result.rows[0]?.visit_number || 1);
}

/**
 * Get total journey count for a visitor (by visitor_id or IP)
 */
async function getVisitorTotalJourneys(visitorId, ipAddress, siteId = null) {
  const db = getDb();
  let query = `
    SELECT COUNT(DISTINCT journey_id) as total
    FROM journey_events
    WHERE (
      (visitor_id = $1 AND visitor_id IS NOT NULL)
      OR (ip_address = $2 AND ip_address IS NOT NULL)
    )
  `;
  const params = [visitorId, ipAddress];

  if (siteId) {
    query += ` AND site_id = $3`;
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return parseInt(result.rows[0]?.total || 1);
}

/**
 * Get unique IP addresses from events (for IP-based consolidation)
 * For each journey_id, finds the IP (even if only some events have it)
 * Then groups by IP to consolidate
 */
async function getUniqueIPsWithJourneys(siteId = null) {
  const db = getDb();

  // First, get the IP for each journey_id (prefer non-null IP)
  // Then group journeys by their resolved IP
  let query = `
    WITH journey_ips AS (
      -- For each journey, get the IP address (preferring non-null)
      SELECT DISTINCT ON (journey_id)
        journey_id,
        ip_address,
        site_id
      FROM journey_events
      WHERE ip_address IS NOT NULL AND ip_address != ''
      ${siteId ? 'AND site_id = $1' : ''}
      ORDER BY journey_id, occurred_at ASC
    )
    SELECT
      ji.ip_address,
      MIN(ji.journey_id) as primary_journey_id,
      COUNT(DISTINCT ji.journey_id) as journey_count,
      array_agg(DISTINCT ji.journey_id) as all_journey_ids
    FROM journey_ips ji
    GROUP BY ji.ip_address
    ORDER BY MIN(ji.journey_id)
  `;
  const params = siteId ? [siteId] : [];
  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Get all events for a given IP address (for consolidation)
 * Includes events from ANY journey_id that has this IP
 */
async function getEventsByIPAddress(ipAddress, siteId = null) {
  const db = getDb();

  // Get ALL events from journey_ids that have at least one event with this IP
  let query = `
    SELECT * FROM journey_events
    WHERE journey_id IN (
      SELECT DISTINCT journey_id FROM journey_events WHERE ip_address = $1
    )
  `;
  const params = [ipAddress];

  if (siteId) {
    query += ` AND site_id = $2`;
    params.push(siteId);
  }

  query += ` ORDER BY occurred_at ASC`;
  const result = await db.query(query, params);
  return result.rows;
}

/**
 * Delete journeys by journey_id (for consolidation cleanup)
 */
async function deleteJourneysByIds(journeyIds) {
  if (!journeyIds || journeyIds.length === 0) return 0;
  const db = getDb();
  const placeholders = journeyIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = await db.query(
    `DELETE FROM journeys WHERE journey_id IN (${placeholders})`,
    journeyIds
  );
  return result.rowCount;
}

/**
 * Delete ALL journeys for a site (for complete rebuild)
 */
async function deleteAllJourneys(siteId = null) {
  const db = getDb();
  let query = 'DELETE FROM journeys';
  const params = [];

  if (siteId) {
    query += ' WHERE site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return result.rowCount;
}

/**
 * Get ALL unique IPs that have events (simple version)
 * Excludes GTM preview URLs (gtm-msr.appspot.com)
 */
async function getAllUniqueIPs(siteId = null) {
  const db = getDb();
  let query = `
    SELECT DISTINCT ip_address
    FROM journey_events
    WHERE ip_address IS NOT NULL AND ip_address != ''
      AND (page_url IS NULL OR page_url NOT LIKE '%gtm-msr.appspot.com%')
  `;
  const params = [];

  if (siteId) {
    query += ` AND site_id = $1`;
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return result.rows.map(r => r.ip_address);
}

/**
 * Get journeys with NULL IP (these can't be consolidated)
 */
async function getJourneysWithNullIP(siteId = null) {
  const db = getDb();
  let query = `
    SELECT DISTINCT journey_id
    FROM journey_events
    WHERE ip_address IS NULL OR ip_address = ''
  `;
  const params = [];

  if (siteId) {
    query += ` AND site_id = $1`;
    params.push(siteId);
  }

  const result = await db.query(query, params);
  return result.rows.map(r => r.journey_id);
}

// ============================================
// PIXEL TRACKING ANALYTICS
// ============================================

/**
 * Get pixel tracking statistics
 * Compares pixel_view events vs page_view events (JS tracked)
 */
async function getPixelStats(siteId = null, days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let siteFilter = '';
  const params = [cutoff];

  if (siteId) {
    siteFilter = ' AND site_id = $2';
    params.push(siteId);
  }

  // Get counts for both tracking methods
  const result = await db.query(`
    SELECT
      COUNT(DISTINCT CASE WHEN event_type = 'pixel_view' THEN journey_id END) as pixel_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN journey_id END) as js_visitors,
      COUNT(DISTINCT CASE WHEN event_type = 'pixel_view' AND is_bot = true THEN journey_id END) as pixel_bots,
      COUNT(DISTINCT CASE WHEN event_type = 'pixel_view' AND is_bot = false THEN journey_id END) as pixel_humans,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_bot = true THEN journey_id END) as js_bots,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' AND is_bot = false THEN journey_id END) as js_humans
    FROM journey_events
    WHERE occurred_at >= $1 ${siteFilter}
  `, params);

  const stats = result.rows[0];

  // Calculate engagement rate (JS tracked / Pixel tracked)
  const pixelTotal = parseInt(stats.pixel_visitors || 0);
  const jsTotal = parseInt(stats.js_visitors || 0);
  const engagementRate = pixelTotal > 0 ? Math.round((jsTotal / pixelTotal) * 100) : 0;

  return {
    pixel: {
      total: pixelTotal,
      bots: parseInt(stats.pixel_bots || 0),
      humans: parseInt(stats.pixel_humans || 0)
    },
    javascript: {
      total: jsTotal,
      bots: parseInt(stats.js_bots || 0),
      humans: parseInt(stats.js_humans || 0)
    },
    engagementRate: engagementRate,
    untracked: Math.max(0, pixelTotal - jsTotal) // Visitors pixel caught that JS missed
  };
}

/**
 * Get daily pixel vs JS tracking comparison
 */
async function getPixelVsJsTrend(siteId = null, days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let siteFilter = '';
  const params = [cutoff];

  if (siteId) {
    siteFilter = ' AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      DATE(occurred_at) as date,
      COUNT(DISTINCT CASE WHEN event_type = 'pixel_view' THEN journey_id END) as pixel_count,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN journey_id END) as js_count
    FROM journey_events
    WHERE occurred_at >= $1 ${siteFilter}
    GROUP BY DATE(occurred_at)
    ORDER BY date ASC
  `, params);

  return result.rows.map(row => ({
    date: row.date,
    pixel: parseInt(row.pixel_count || 0),
    javascript: parseInt(row.js_count || 0)
  }));
}

/**
 * Get pixel tracking by page URL
 */
async function getPixelPageStats(siteId = null, days = 30, limit = 20) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let siteFilter = '';
  const params = [cutoff, limit];

  if (siteId) {
    siteFilter = ' AND site_id = $3';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as pixel_views,
      COUNT(DISTINCT journey_id) as unique_visitors,
      SUM(CASE WHEN is_bot = true THEN 1 ELSE 0 END) as bot_views,
      SUM(CASE WHEN is_bot = false THEN 1 ELSE 0 END) as human_views
    FROM journey_events
    WHERE event_type = 'pixel_view'
      AND occurred_at >= $1 ${siteFilter}
    GROUP BY page_url
    ORDER BY pixel_views DESC
    LIMIT $2
  `, params);

  return result.rows;
}

/**
 * Get pixel tracking by hour of day
 */
async function getPixelHourlyDistribution(siteId = null, days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let siteFilter = '';
  const params = [cutoff];

  if (siteId) {
    siteFilter = ' AND site_id = $2';
    params.push(siteId);
  }

  const result = await db.query(`
    SELECT
      EXTRACT(HOUR FROM occurred_at) as hour,
      COUNT(DISTINCT CASE WHEN event_type = 'pixel_view' THEN journey_id END) as pixel_count,
      COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN journey_id END) as js_count
    FROM journey_events
    WHERE occurred_at >= $1 ${siteFilter}
    GROUP BY EXTRACT(HOUR FROM occurred_at)
    ORDER BY hour ASC
  `, params);

  return result.rows.map(row => ({
    hour: parseInt(row.hour),
    pixel: parseInt(row.pixel_count || 0),
    javascript: parseInt(row.js_count || 0)
  }));
}

/**
 * Get combined visitor stats (pixel + JS deduped)
 */
async function getCombinedVisitorStats(siteId = null, days = 30) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let siteFilter = '';
  const params = [cutoff];

  if (siteId) {
    siteFilter = ' AND site_id = $2';
    params.push(siteId);
  }

  // Get unique visitors from either tracking method
  const result = await db.query(`
    SELECT
      COUNT(DISTINCT journey_id) as total_visitors,
      COUNT(DISTINCT CASE WHEN is_bot = false THEN journey_id END) as human_visitors,
      COUNT(DISTINCT CASE WHEN is_bot = true THEN journey_id END) as bot_visitors
    FROM journey_events
    WHERE (event_type = 'pixel_view' OR event_type = 'page_view')
      AND occurred_at >= $1 ${siteFilter}
  `, params);

  return {
    total: parseInt(result.rows[0].total_visitors || 0),
    humans: parseInt(result.rows[0].human_visitors || 0),
    bots: parseInt(result.rows[0].bot_visitors || 0)
  };
}

// ============================================
// FAMILY PROFILES (IP-BASED GROUPING)
// ============================================

/**
 * Get all families (grouped by IP address) with aggregated stats
 */
async function getAllFamilies(limit = 50, offset = 0, options = {}) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const conditions = ['ip_address IS NOT NULL'];
  // Exclude journeys where entry page indicates existing parent (matches Dashboard filter)
  const excludeExistingParents = `journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;
  conditions.push(excludeExistingParents);
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

  const whereClause = `WHERE ${dateFilter} AND ${conditions.join(' AND ')}`;

  // Build HAVING conditions for engagement and visits filters
  const havingConditions = [];

  // Engagement filter (based on total events)
  if (options.engagement === 'high') {
    havingConditions.push('(total_events > 50 OR visit_count > 2)');
  } else if (options.engagement === 'medium') {
    havingConditions.push('((total_events > 20 OR visit_count > 1) AND NOT (total_events > 50 OR visit_count > 2))');
  } else if (options.engagement === 'low') {
    havingConditions.push('(total_events <= 20 AND visit_count <= 1)');
  }

  // Visits filter
  if (options.visits === '1') {
    havingConditions.push('visit_count = 1');
  } else if (options.visits === '2-3') {
    havingConditions.push('visit_count >= 2 AND visit_count <= 3');
  } else if (options.visits === '4+') {
    havingConditions.push('visit_count >= 4');
  }

  const havingClause = havingConditions.length > 0 ? `WHERE ${havingConditions.join(' AND ')}` : '';

  params.push(limit);
  params.push(offset);

  // Use journey_events for accurate family data
  const result = await db.query(`
    WITH family_journeys AS (
      SELECT
        ip_address,
        journey_id,
        MIN(occurred_at) as journey_start,
        MAX(occurred_at) as journey_end,
        COUNT(*) as event_count,
        BOOL_OR(is_bot) as is_bot
      FROM journey_events
      ${whereClause}
      GROUP BY ip_address, journey_id
    ),
    family_data AS (
      SELECT
        ip_address as primary_ip_address,
        COUNT(DISTINCT journey_id) as visit_count,
        SUM(event_count) as total_events,
        MIN(journey_start) as first_visit,
        MAX(journey_end) as last_visit,
        array_agg(DISTINCT journey_id) as journey_ids,
        NULL as best_outcome,
        0 as has_converted,
        NULL as max_scroll,
        BOOL_OR(is_bot) as has_bot_activity
      FROM family_journeys
      GROUP BY ip_address
    )
    SELECT * FROM family_data
    ${havingClause}
    ORDER BY last_visit DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
  `, params);

  return result.rows;
}

/**
 * Get total count of unique families (IPs)
 * Uses journey_events for accuracy
 */
async function getFamilyCount(options = {}) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const conditions = ['ip_address IS NOT NULL'];
  // Exclude journeys where entry page indicates existing parent (matches Dashboard filter)
  const excludeExistingParents = `journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;
  conditions.push(excludeExistingParents);
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

  const whereClause = `WHERE ${dateFilter} AND ${conditions.join(' AND ')}`;

  // Build HAVING conditions for engagement and visits filters
  const havingConditions = [];

  if (options.engagement === 'high') {
    havingConditions.push('(total_events > 50 OR visit_count > 2)');
  } else if (options.engagement === 'medium') {
    havingConditions.push('((total_events > 20 OR visit_count > 1) AND NOT (total_events > 50 OR visit_count > 2))');
  } else if (options.engagement === 'low') {
    havingConditions.push('(total_events <= 20 AND visit_count <= 1)');
  }

  if (options.visits === '1') {
    havingConditions.push('visit_count = 1');
  } else if (options.visits === '2-3') {
    havingConditions.push('visit_count >= 2 AND visit_count <= 3');
  } else if (options.visits === '4+') {
    havingConditions.push('visit_count >= 4');
  }

  const havingClause = havingConditions.length > 0 ? `WHERE ${havingConditions.join(' AND ')}` : '';

  const result = await db.query(`
    WITH family_data AS (
      SELECT
        ip_address,
        COUNT(DISTINCT journey_id) as visit_count,
        COUNT(*) as total_events
      FROM journey_events
      ${whereClause}
      GROUP BY ip_address
    )
    SELECT COUNT(*) as count FROM family_data ${havingClause}
  `, params);

  return parseInt(result.rows[0].count);
}

/**
 * Get a single family profile by IP address with all their journeys
 */
async function getFamilyByIP(ipAddress, siteId = null) {
  const db = getDb();

  let siteFilter = '';
  const params = [ipAddress];

  if (siteId) {
    siteFilter = ' AND site_id = $2';
    params.push(siteId);
  }

  // Get all journeys for this IP
  const journeysResult = await db.query(`
    SELECT *
    FROM journeys
    WHERE primary_ip_address = $1 ${siteFilter}
    ORDER BY first_seen ASC
  `, params);

  if (journeysResult.rows.length === 0) {
    return null;
  }

  const journeys = journeysResult.rows;

  // Get location from first event with metadata containing location
  const locationResult = await db.query(`
    SELECT metadata
    FROM journey_events
    WHERE ip_address = $1
      AND metadata IS NOT NULL
      AND metadata->>'location' IS NOT NULL
    LIMIT 1
  `, [ipAddress]);

  let location = null;
  if (locationResult.rows.length > 0) {
    try {
      const metadata = typeof locationResult.rows[0].metadata === 'string'
        ? JSON.parse(locationResult.rows[0].metadata)
        : locationResult.rows[0].metadata;
      location = metadata?.location || null;
    } catch (e) {}
  }

  // Aggregate stats
  const totalEvents = journeys.reduce((sum, j) => sum + (j.event_count || 0), 0);
  const bestOutcome = journeys.find(j =>
    j.outcome === 'enquiry_submitted' || j.outcome === 'visit_booked'
  )?.outcome || journeys[journeys.length - 1]?.outcome || 'no_action';

  // Get unique pages across all journeys
  const allPages = new Set();
  journeys.forEach(j => {
    const seq = typeof j.page_sequence === 'string' ? JSON.parse(j.page_sequence) : j.page_sequence;
    if (Array.isArray(seq)) {
      seq.forEach(p => allPages.add(p.url));
    }
  });

  // Get devices used
  const devicesResult = await db.query(`
    SELECT DISTINCT device_type
    FROM journey_events
    WHERE ip_address = $1
      AND device_type IS NOT NULL
  `, [ipAddress]);
  const devices = devicesResult.rows.map(r => r.device_type);

  return {
    ip_address: ipAddress,
    visit_count: journeys.length,
    total_events: totalEvents,
    first_visit: journeys[0].first_seen,
    last_visit: journeys[journeys.length - 1].last_seen,
    best_outcome: bestOutcome,
    location: location,
    unique_pages: Array.from(allPages),
    devices: devices,
    journeys: journeys.map(j => ({
      journey_id: j.journey_id,
      first_seen: j.first_seen,
      last_seen: j.last_seen,
      event_count: j.event_count,
      outcome: j.outcome,
      entry_page: j.entry_page,
      page_sequence: typeof j.page_sequence === 'string' ? JSON.parse(j.page_sequence) : j.page_sequence
    }))
  };
}

/**
 * Get family stats for dashboard
 */
async function getFamilyStats(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  const botFilter = '(is_bot = false OR is_bot IS NULL)';
  // Exclude journeys where entry page indicates existing parent (not prospective family)
  // Patterns: news, calendar, term-dates, image galleries (/160/), parents association (/90/),
  // news articles (/115/), fees page, parent portal, uniform info
  const excludeExistingParents = `AND journey_id NOT IN (
    SELECT je_entry.journey_id FROM (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ) je_entry
    WHERE je_entry.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)'
  )`;
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // Use journey_events for accurate family stats
  const result = await db.query(`
    WITH family_data AS (
      SELECT
        ip_address,
        journey_id,
        is_bot,
        COUNT(*) as events
      FROM journey_events
      WHERE ip_address IS NOT NULL
        AND ${dateFilter}
        ${siteFilter}
        ${excludeExistingParents}
      GROUP BY ip_address, journey_id, is_bot
    ),
    family_stats AS (
      SELECT
        ip_address,
        COUNT(DISTINCT journey_id) as visit_count,
        SUM(events) as total_events,
        BOOL_OR(is_bot) as has_bot_visits
      FROM family_data
      GROUP BY ip_address
    )
    SELECT
      COUNT(*) as total_families,
      COUNT(*) FILTER (WHERE has_bot_visits = false OR has_bot_visits IS NULL) as human_families,
      0 as converted_families,
      COUNT(*) FILTER (WHERE visit_count > 1) as returning_families,
      ROUND(AVG(total_events / visit_count), 1) as avg_events_per_visit
    FROM family_stats
  `, params);

  return result.rows[0];
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
  // Family Profiles
  getAllFamilies,
  getFamilyCount,
  getFamilyByIP,
  getFamilyStats,
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
  // UX Analytics
  getUXOverview,
  getDeadClicks,
  getCTAHesitations,
  getScrollBehaviour,
  getScrollBehaviourByPage,
  getScrollDepthByPage,
  getSectionVisibility,
  getQuickBacks,
  getSearchQueries,
  getTextSelections,
  getUXTrend,
  getExitPages,
  getFormAnalytics,
  getFormFieldAbandonment,
  getPDFDownloads,
  getVideoEngagement,
  getRageClicks,
  getReturnVisitorAnalytics,
  // Sites
  getSiteByTrackingKey,
  getAllSites,
  getSiteById,
  // AI Analysis
  saveJourneyAnalysis,
  getJourneyAnalysis,
  // Pixel Tracking
  getPixelStats,
  getPixelVsJsTrend,
  getPixelPageStats,
  getPixelHourlyDistribution,
  getCombinedVisitorStats,
  // Visitor Journey Count
  getVisitorJourneyNumber,
  getVisitorTotalJourneys,
  // IP Consolidation
  getUniqueIPsWithJourneys,
  getEventsByIPAddress,
  deleteJourneysByIds,
  getJourneysWithNullIP,
  deleteAllJourneys,
  getAllUniqueIPs
};

const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getBotTypeLabel, markPixelOnlyBotsInDB } = require('../services/botDetection');
const { getSiteId } = require('../middleware/auth');

// ============================================
// BOT ANALYTICS DASHBOARD
// ============================================

/**
 * GET /bots
 * Render bot analytics dashboard
 */
router.get('/', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const stats = await getBotOverviewStats(siteId);
    const typeBreakdown = await getBotTypeBreakdown(siteId);
    const topUserAgents = await getTopBotUserAgents(20, siteId);
    const dailyTrend = await getDailyBotTrend(30, siteId);
    const hourlyActivity = await getHourlyBotActivity(siteId);
    const locationStats = await getBotLocationStats(siteId);

    res.render('bots', {
      title: 'Bot Analytics - SMART Journey',
      currentPage: 'bots',
      stats,
      typeBreakdown,
      topUserAgents,
      dailyTrend,
      hourlyActivity,
      locationStats
    });
  } catch (error) {
    console.error('Bot dashboard error:', error);
    res.status(500).render('error', { error: 'Failed to load bot analytics' });
  }
});

// ============================================
// API ENDPOINTS
// ============================================

/**
 * GET /bots/api/overview
 * Get bot traffic overview statistics
 */
router.get('/api/overview', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const stats = await getBotOverviewStats(siteId);
    res.json(stats);
  } catch (error) {
    console.error('Bot overview error:', error);
    res.status(500).json({ error: 'Failed to get bot overview' });
  }
});

/**
 * GET /bots/api/types
 * Get bot type breakdown
 */
router.get('/api/types', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const types = await getBotTypeBreakdown(siteId);
    res.json(types);
  } catch (error) {
    console.error('Bot types error:', error);
    res.status(500).json({ error: 'Failed to get bot types' });
  }
});

/**
 * GET /bots/api/user-agents
 * Get top bot user agents
 */
router.get('/api/user-agents', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const siteId = getSiteId(req);
    const userAgents = await getTopBotUserAgents(limit, siteId);
    res.json(userAgents);
  } catch (error) {
    console.error('Bot user-agents error:', error);
    res.status(500).json({ error: 'Failed to get bot user agents' });
  }
});

/**
 * GET /bots/api/trend
 * Get daily bot activity trend
 */
router.get('/api/trend', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const siteId = getSiteId(req);
    const trend = await getDailyBotTrend(days, siteId);
    res.json(trend);
  } catch (error) {
    console.error('Bot trend error:', error);
    res.status(500).json({ error: 'Failed to get bot trend' });
  }
});

/**
 * GET /bots/api/hourly
 * Get hourly bot activity pattern
 */
router.get('/api/hourly', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const hourly = await getHourlyBotActivity(siteId);
    res.json(hourly);
  } catch (error) {
    console.error('Bot hourly error:', error);
    res.status(500).json({ error: 'Failed to get hourly activity' });
  }
});

/**
 * GET /bots/api/pages
 * Get most crawled pages by bots
 */
router.get('/api/pages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const siteId = getSiteId(req);
    const pages = await getMostCrawledPages(limit, siteId);
    res.json(pages);
  } catch (error) {
    console.error('Bot pages error:', error);
    res.status(500).json({ error: 'Failed to get crawled pages' });
  }
});

/**
 * GET /bots/api/comparison
 * Get bot vs human comparison stats
 */
router.get('/api/comparison', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const comparison = await getBotVsHumanComparison(siteId);
    res.json(comparison);
  } catch (error) {
    console.error('Bot comparison error:', error);
    res.status(500).json({ error: 'Failed to get comparison' });
  }
});

/**
 * POST /bots/api/mark-pixel-only
 * Mark pixel-only journeys as bots (no JavaScript = likely bot)
 */
router.post('/api/mark-pixel-only', async (req, res) => {
  try {
    const db = getDb();
    const siteId = getSiteId(req);
    const result = await markPixelOnlyBotsInDB(db, siteId);
    console.log(`Marked ${result.marked} pixel-only journeys as bots`);
    res.json({
      success: true,
      marked: result.marked,
      message: `Marked ${result.marked} pixel-only journeys as bots (no JavaScript execution)`
    });
  } catch (error) {
    console.error('Mark pixel-only bots error:', error);
    res.status(500).json({ error: 'Failed to mark pixel-only bots' });
  }
});

/**
 * Run pixel-only bot detection (can be called on startup)
 */
async function runPixelOnlyBotDetection() {
  try {
    const db = getDb();
    const result = await markPixelOnlyBotsInDB(db);
    if (result.marked > 0) {
      console.log(`[Bot Detection] Marked ${result.marked} pixel-only journeys as bots`);
    }
    return result;
  } catch (error) {
    console.error('[Bot Detection] Error marking pixel-only bots:', error.message);
    return { marked: 0, error: error.message };
  }
}

// Export for use in app.js startup
router.runPixelOnlyBotDetection = runPixelOnlyBotDetection;

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get overview statistics with three-way breakdown:
 * - Bots (crawlers, scrapers, automation)
 * - Existing Parents (humans checking news/calendar - NOT bots)
 * - Prospective Families (humans researching the school)
 * Uses journey_events for accuracy (journeys table may be incomplete)
 */
async function getBotOverviewStats(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // Get all stats with three-way classification
  // For humans, count UNIQUE VISITORS (visitor_id) to match Dashboard
  // For bots, count journeys since bots don't have consistent visitor_ids
  const result = await db.query(`
    WITH entry_pages AS (
      SELECT DISTINCT ON (journey_id) journey_id, page_url
      FROM journey_events
      WHERE event_type = 'page_view' AND page_url IS NOT NULL
      ORDER BY journey_id, occurred_at ASC
    ),
    journey_classification AS (
      SELECT
        jd.journey_id,
        jd.visitor_id,
        jd.is_bot,
        jd.bot_score,
        CASE
          WHEN jd.is_bot = true THEN 'bot'
          WHEN ep.page_url ~* '/(news|calendar|term-dates|news-and-calendar|115/|160/|90/|parents|uniform|admissions/fees)' THEN 'existing_parent'
          ELSE 'prospective'
        END as visitor_type
      FROM (
        SELECT DISTINCT journey_id, visitor_id, is_bot, bot_score
        FROM journey_events
        WHERE ${dateFilter} ${siteFilter}
      ) jd
      LEFT JOIN entry_pages ep ON jd.journey_id = ep.journey_id
    ),
    today_data AS (
      SELECT DISTINCT journey_id, is_bot
      FROM journey_events
      WHERE occurred_at >= CURRENT_DATE ${siteFilter}
    ),
    yesterday_data AS (
      SELECT DISTINCT journey_id, is_bot
      FROM journey_events
      WHERE occurred_at >= CURRENT_DATE - INTERVAL '1 day'
        AND occurred_at < CURRENT_DATE
        ${siteFilter}
    )
    SELECT
      (SELECT COUNT(*) FROM journey_classification) as total_journeys,
      (SELECT COUNT(*) FROM journey_classification WHERE visitor_type = 'bot') as bot_journeys,
      -- Count unique visitors for humans to match Dashboard
      (SELECT COUNT(DISTINCT visitor_id) FROM journey_classification WHERE visitor_type = 'existing_parent' AND visitor_id IS NOT NULL) as existing_parent_visitors,
      (SELECT COUNT(DISTINCT visitor_id) FROM journey_classification WHERE visitor_type = 'prospective' AND visitor_id IS NOT NULL) as prospective_visitors,
      (SELECT COUNT(*) FROM today_data WHERE is_bot = true) as today_bots,
      (SELECT COUNT(*) FROM yesterday_data WHERE is_bot = true) as yesterday_bots,
      (SELECT COUNT(*) FROM journey_classification WHERE bot_score >= 31 AND bot_score <= 60) as suspicious_journeys,
      (SELECT ROUND(AVG(bot_score)) FROM journey_classification WHERE visitor_type = 'bot') as avg_bot_score
  `, params);

  const data = result.rows[0];
  const totalJourneys = parseInt(data.total_journeys) || 0;
  const botJourneys = parseInt(data.bot_journeys) || 0;
  const existingParentVisitors = parseInt(data.existing_parent_visitors) || 0;
  const prospectiveVisitors = parseInt(data.prospective_visitors) || 0;
  const humanVisitors = existingParentVisitors + prospectiveVisitors; // Total unique humans
  const todayBots = parseInt(data.today_bots) || 0;
  const yesterdayBots = parseInt(data.yesterday_bots) || 0;
  const suspiciousJourneys = parseInt(data.suspicious_journeys) || 0;
  const avgBotScore = parseInt(data.avg_bot_score) || 0;

  const botPercentage = totalJourneys > 0 ? ((botJourneys / totalJourneys) * 100).toFixed(1) : 0;

  let trend = 0;
  if (yesterdayBots > 0) {
    trend = ((todayBots - yesterdayBots) / yesterdayBots * 100).toFixed(0);
  }

  return {
    totalJourneys,
    botJourneys,
    humanVisitors,
    existingParentVisitors,
    prospectiveVisitors,
    botPercentage,
    todayBots,
    trend,
    suspiciousJourneys,
    avgBotScore
  };
}

/**
 * Get bot type breakdown
 * Uses journey_events for accuracy
 */
async function getBotTypeBreakdown(siteId = null) {
  const db = getDb();
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  // Simplified query - classify based on user_agent directly
  const result = await db.query(`
    SELECT
      CASE
        WHEN user_agent ILIKE '%bot%' OR user_agent ILIKE '%crawler%' OR user_agent ILIKE '%spider%' THEN 'crawler'
        WHEN user_agent ILIKE '%scraper%' OR user_agent ILIKE '%wget%' OR user_agent ILIKE '%curl%' OR user_agent ILIKE '%python%' THEN 'scraper'
        WHEN user_agent ILIKE '%headless%' OR user_agent ILIKE '%phantom%' OR user_agent ILIKE '%puppeteer%' THEN 'automation'
        WHEN 'pixel_only_no_js' = ANY(bot_signals) THEN 'no_javascript'
        ELSE 'unknown'
      END as bot_type,
      COUNT(DISTINCT journey_id) as count
    FROM journey_events
    WHERE is_bot = true
      AND occurred_at >= NOW() - INTERVAL '7 days'
      ${siteFilter}
    GROUP BY bot_type
    ORDER BY count DESC
  `, params);

  return result.rows.map(row => ({
    type: row.bot_type,
    label: getBotTypeLabel(row.bot_type),
    count: parseInt(row.count)
  }));
}

/**
 * Get top bot user agents
 */
async function getTopBotUserAgents(limit = 20, siteId = null) {
  const db = getDb();
  const whereClause = siteId
    ? 'WHERE is_bot = true AND user_agent IS NOT NULL AND site_id = $2'
    : 'WHERE is_bot = true AND user_agent IS NOT NULL';
  const params = siteId ? [limit, siteId] : [limit];

  const result = await db.query(`
    SELECT
      user_agent,
      COUNT(*) as count,
      AVG(bot_score) as avg_score
    FROM journey_events
    ${whereClause}
    GROUP BY user_agent
    ORDER BY count DESC
    LIMIT $1
  `, params);

  return result.rows.map(row => ({
    userAgent: row.user_agent,
    count: parseInt(row.count),
    avgScore: parseFloat(row.avg_score || 0).toFixed(0)
  }));
}

/**
 * Get daily bot trend
 * Uses journey_events for accuracy
 */
async function getDailyBotTrend(days = 30, siteId = null) {
  const db = getDb();
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH daily_journeys AS (
      SELECT DISTINCT
        DATE(occurred_at) as date,
        journey_id,
        is_bot
      FROM journey_events
      WHERE occurred_at >= NOW() - INTERVAL '${days} days' ${siteFilter}
    )
    SELECT
      date,
      COUNT(*) FILTER (WHERE is_bot = true) as bots,
      COUNT(*) FILTER (WHERE is_bot = false OR is_bot IS NULL) as humans,
      COUNT(*) as total
    FROM daily_journeys
    GROUP BY date
    ORDER BY date ASC
  `, params);

  return result.rows.map(row => ({
    date: row.date,
    bots: parseInt(row.bots),
    humans: parseInt(row.humans),
    total: parseInt(row.total),
    botPercentage: row.total > 0 ?
      ((row.bots / row.total) * 100).toFixed(1) : 0
  }));
}

/**
 * Get hourly bot activity
 * Uses journey_events for accuracy
 */
async function getHourlyBotActivity(siteId = null) {
  const db = getDb();
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH hourly_journeys AS (
      SELECT DISTINCT
        EXTRACT(HOUR FROM occurred_at) as hour,
        journey_id,
        is_bot
      FROM journey_events
      WHERE occurred_at >= NOW() - INTERVAL '7 days' ${siteFilter}
    )
    SELECT
      hour,
      COUNT(*) FILTER (WHERE is_bot = true) as bots,
      COUNT(*) FILTER (WHERE is_bot = false OR is_bot IS NULL) as humans
    FROM hourly_journeys
    GROUP BY hour
    ORDER BY hour
  `, params);

  // Fill in missing hours with 0
  const hourlyData = Array(24).fill(null).map((_, i) => ({
    hour: i,
    bots: 0,
    humans: 0
  }));

  result.rows.forEach(row => {
    const hour = parseInt(row.hour);
    hourlyData[hour] = {
      hour,
      bots: parseInt(row.bots),
      humans: parseInt(row.humans)
    };
  });

  return hourlyData;
}

/**
 * Get most crawled pages by bots
 */
async function getMostCrawledPages(limit = 20, siteId = null) {
  const db = getDb();
  const whereClause = siteId
    ? "WHERE is_bot = true AND event_type = 'page_view' AND page_url IS NOT NULL AND site_id = $2"
    : "WHERE is_bot = true AND event_type = 'page_view' AND page_url IS NOT NULL";
  const params = siteId ? [limit, siteId] : [limit];

  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as bot_visits,
      COUNT(DISTINCT journey_id) as unique_bots
    FROM journey_events
    ${whereClause}
    GROUP BY page_url
    ORDER BY bot_visits DESC
    LIMIT $1
  `, params);

  return result.rows.map(row => ({
    url: row.page_url,
    visits: parseInt(row.bot_visits),
    uniqueBots: parseInt(row.unique_bots)
  }));
}

/**
 * Get bot vs human comparison
 * Uses journey_events for accuracy
 */
async function getBotVsHumanComparison(siteId = null) {
  const db = getDb();
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH journey_stats AS (
      SELECT
        journey_id,
        is_bot,
        COUNT(*) as event_count,
        EXTRACT(EPOCH FROM (MAX(occurred_at) - MIN(occurred_at))) as duration,
        MAX(CASE WHEN event_type = 'form_submit' THEN 1 ELSE 0 END) as has_conversion
      FROM journey_events
      WHERE ${dateFilter} ${siteFilter}
      GROUP BY journey_id, is_bot
    )
    SELECT
      CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END as type,
      ROUND(AVG(event_count), 1) as avg_events,
      ROUND(AVG(duration)) as avg_duration,
      COUNT(*) as total,
      SUM(has_conversion) as conversions
    FROM journey_stats
    GROUP BY CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END
  `, params);

  const comparison = {
    bot: { avgEvents: 0, avgDuration: 0, conversionRate: 0, total: 0 },
    human: { avgEvents: 0, avgDuration: 0, conversionRate: 0, total: 0 }
  };

  result.rows.forEach(row => {
    const type = row.type;
    comparison[type].avgEvents = parseFloat(row.avg_events || 0).toFixed(1);
    comparison[type].avgDuration = parseInt(row.avg_duration || 0);
    comparison[type].total = parseInt(row.total);
    comparison[type].conversionRate = row.total > 0 ?
      ((row.conversions / row.total) * 100).toFixed(1) : 0;
  });

  return comparison;
}

/**
 * Get bot location statistics
 */
async function getBotLocationStats(siteId = null) {
  const db = getDb();
  const siteFilter = siteId ? "AND je.site_id = $1" : "";
  const params = siteId ? [siteId] : [];

  const result = await db.query(`
    SELECT
      je.metadata->'location'->>'country' as country,
      COUNT(DISTINCT je.journey_id) as count
    FROM journey_events je
    WHERE je.is_bot = true
      AND je.event_type = 'page_view'
      AND je.metadata IS NOT NULL
      AND je.metadata->'location'->>'country' IS NOT NULL
      ${siteFilter}
    GROUP BY je.metadata->'location'->>'country'
    ORDER BY count DESC
    LIMIT 10
  `, params);

  return result.rows.map(row => ({
    country: row.country || 'Unknown',
    count: parseInt(row.count)
  }));
}

module.exports = router;

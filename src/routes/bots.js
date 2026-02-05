const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getBotTypeLabel } = require('../services/botDetection');
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

// ============================================
// QUERY FUNCTIONS
// ============================================

/**
 * Get overview statistics
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

  // Get all stats from journey_events in one query
  const result = await db.query(`
    WITH journey_data AS (
      SELECT DISTINCT journey_id, is_bot, bot_score
      FROM journey_events
      WHERE ${dateFilter} ${siteFilter}
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
      (SELECT COUNT(*) FROM journey_data) as total_journeys,
      (SELECT COUNT(*) FROM journey_data WHERE is_bot = true) as bot_journeys,
      (SELECT COUNT(*) FROM journey_data WHERE is_bot = false OR is_bot IS NULL) as human_journeys,
      (SELECT COUNT(*) FROM today_data WHERE is_bot = true) as today_bots,
      (SELECT COUNT(*) FROM yesterday_data WHERE is_bot = true) as yesterday_bots,
      (SELECT COUNT(*) FROM journey_data WHERE bot_score >= 31 AND bot_score <= 60) as suspicious_journeys,
      (SELECT ROUND(AVG(bot_score)) FROM journey_data WHERE is_bot = true) as avg_bot_score
  `, params);

  const data = result.rows[0];
  const totalJourneys = parseInt(data.total_journeys) || 0;
  const botJourneys = parseInt(data.bot_journeys) || 0;
  const humanJourneys = parseInt(data.human_journeys) || 0;
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
    humanJourneys,
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
  const dateFilter = `occurred_at >= NOW() - INTERVAL '7 days'`;
  let siteFilter = '';
  const params = [];

  if (siteId) {
    siteFilter = 'AND site_id = $1';
    params.push(siteId);
  }

  const result = await db.query(`
    WITH bot_journeys AS (
      SELECT DISTINCT journey_id,
        FIRST_VALUE(COALESCE(
          CASE
            WHEN bot_signals->>'userAgent' LIKE '%bot%' OR bot_signals->>'userAgent' LIKE '%crawler%' OR bot_signals->>'userAgent' LIKE '%spider%' THEN 'crawler'
            WHEN bot_signals->>'userAgent' LIKE '%scraper%' OR bot_signals->>'userAgent' LIKE '%wget%' OR bot_signals->>'userAgent' LIKE '%curl%' THEN 'scraper'
            WHEN bot_signals->>'headless' = 'true' OR bot_signals->>'webdriver' = 'true' THEN 'automation'
            ELSE 'unknown'
          END,
          'unknown'
        )) OVER (PARTITION BY journey_id ORDER BY occurred_at) as bot_type
      FROM journey_events
      WHERE is_bot = true AND ${dateFilter} ${siteFilter}
    )
    SELECT bot_type, COUNT(*) as count
    FROM bot_journeys
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

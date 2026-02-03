const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getBotTypeLabel } = require('../services/botDetection');

// ============================================
// BOT ANALYTICS DASHBOARD
// ============================================

/**
 * GET /bots
 * Render bot analytics dashboard
 */
router.get('/', async (req, res) => {
  try {
    const stats = await getBotOverviewStats();
    const typeBreakdown = await getBotTypeBreakdown();
    const topUserAgents = await getTopBotUserAgents();
    const dailyTrend = await getDailyBotTrend(30);
    const hourlyActivity = await getHourlyBotActivity();
    const locationStats = await getBotLocationStats();

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
    const stats = await getBotOverviewStats();
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
    const types = await getBotTypeBreakdown();
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
    const userAgents = await getTopBotUserAgents(limit);
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
    const trend = await getDailyBotTrend(days);
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
    const hourly = await getHourlyBotActivity();
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
    const pages = await getMostCrawledPages(limit);
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
    const comparison = await getBotVsHumanComparison();
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
 */
async function getBotOverviewStats() {
  const db = getDb();

  // Total journeys
  const totalResult = await db.query('SELECT COUNT(*) as count FROM journeys');
  const totalJourneys = parseInt(totalResult.rows[0].count);

  // Bot journeys
  const botResult = await db.query('SELECT COUNT(*) as count FROM journeys WHERE is_bot = true');
  const botJourneys = parseInt(botResult.rows[0].count);

  // Human journeys
  const humanJourneys = totalJourneys - botJourneys;

  // Bot percentage
  const botPercentage = totalJourneys > 0 ? ((botJourneys / totalJourneys) * 100).toFixed(1) : 0;

  // Today's bots
  const todayResult = await db.query(`
    SELECT COUNT(*) as count FROM journeys
    WHERE is_bot = true AND first_seen >= CURRENT_DATE
  `);
  const todayBots = parseInt(todayResult.rows[0].count);

  // Yesterday's bots (for trend)
  const yesterdayResult = await db.query(`
    SELECT COUNT(*) as count FROM journeys
    WHERE is_bot = true
    AND first_seen >= CURRENT_DATE - INTERVAL '1 day'
    AND first_seen < CURRENT_DATE
  `);
  const yesterdayBots = parseInt(yesterdayResult.rows[0].count);

  // Trend calculation
  let trend = 0;
  if (yesterdayBots > 0) {
    trend = ((todayBots - yesterdayBots) / yesterdayBots * 100).toFixed(0);
  }

  // Suspicious journeys (score 31-60)
  const suspiciousResult = await db.query(`
    SELECT COUNT(*) as count FROM journeys
    WHERE bot_score >= 31 AND bot_score <= 60
  `);
  const suspiciousJourneys = parseInt(suspiciousResult.rows[0].count);

  // Average bot score
  const avgScoreResult = await db.query(`
    SELECT AVG(bot_score) as avg FROM journeys WHERE is_bot = true
  `);
  const avgBotScore = avgScoreResult.rows[0].avg ?
    parseFloat(avgScoreResult.rows[0].avg).toFixed(0) : 0;

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
 */
async function getBotTypeBreakdown() {
  const db = getDb();

  const result = await db.query(`
    SELECT
      COALESCE(bot_type, 'unknown') as bot_type,
      COUNT(*) as count
    FROM journeys
    WHERE is_bot = true
    GROUP BY bot_type
    ORDER BY count DESC
  `);

  return result.rows.map(row => ({
    type: row.bot_type,
    label: getBotTypeLabel(row.bot_type),
    count: parseInt(row.count)
  }));
}

/**
 * Get top bot user agents
 */
async function getTopBotUserAgents(limit = 20) {
  const db = getDb();

  const result = await db.query(`
    SELECT
      user_agent,
      COUNT(*) as count,
      AVG(bot_score) as avg_score
    FROM journey_events
    WHERE is_bot = true AND user_agent IS NOT NULL
    GROUP BY user_agent
    ORDER BY count DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    userAgent: row.user_agent,
    count: parseInt(row.count),
    avgScore: parseFloat(row.avg_score || 0).toFixed(0)
  }));
}

/**
 * Get daily bot trend
 */
async function getDailyBotTrend(days = 30) {
  const db = getDb();

  const result = await db.query(`
    SELECT
      DATE(first_seen) as date,
      COUNT(*) FILTER (WHERE is_bot = true) as bots,
      COUNT(*) FILTER (WHERE is_bot = false OR is_bot IS NULL) as humans,
      COUNT(*) as total
    FROM journeys
    WHERE first_seen >= NOW() - INTERVAL '${days} days'
    GROUP BY DATE(first_seen)
    ORDER BY date ASC
  `);

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
 */
async function getHourlyBotActivity() {
  const db = getDb();

  const result = await db.query(`
    SELECT
      EXTRACT(HOUR FROM first_seen) as hour,
      COUNT(*) FILTER (WHERE is_bot = true) as bots,
      COUNT(*) FILTER (WHERE is_bot = false OR is_bot IS NULL) as humans
    FROM journeys
    WHERE first_seen >= NOW() - INTERVAL '7 days'
    GROUP BY hour
    ORDER BY hour
  `);

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
async function getMostCrawledPages(limit = 20) {
  const db = getDb();

  const result = await db.query(`
    SELECT
      page_url,
      COUNT(*) as bot_visits,
      COUNT(DISTINCT journey_id) as unique_bots
    FROM journey_events
    WHERE is_bot = true AND event_type = 'page_view' AND page_url IS NOT NULL
    GROUP BY page_url
    ORDER BY bot_visits DESC
    LIMIT $1
  `, [limit]);

  return result.rows.map(row => ({
    url: row.page_url,
    visits: parseInt(row.bot_visits),
    uniqueBots: parseInt(row.unique_bots)
  }));
}

/**
 * Get bot vs human comparison
 */
async function getBotVsHumanComparison() {
  const db = getDb();

  // Average events per journey
  const eventsResult = await db.query(`
    SELECT
      CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END as type,
      AVG(event_count) as avg_events,
      AVG(EXTRACT(EPOCH FROM (last_seen - first_seen))) as avg_duration
    FROM journeys
    GROUP BY CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END
  `);

  // Conversion rates
  const conversionResult = await db.query(`
    SELECT
      CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END as type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE outcome IN ('enquiry_submitted', 'visit_booked')) as conversions
    FROM journeys
    GROUP BY CASE WHEN is_bot = true THEN 'bot' ELSE 'human' END
  `);

  const comparison = {
    bot: { avgEvents: 0, avgDuration: 0, conversionRate: 0, total: 0 },
    human: { avgEvents: 0, avgDuration: 0, conversionRate: 0, total: 0 }
  };

  eventsResult.rows.forEach(row => {
    comparison[row.type].avgEvents = parseFloat(row.avg_events || 0).toFixed(1);
    comparison[row.type].avgDuration = parseFloat(row.avg_duration || 0).toFixed(0);
  });

  conversionResult.rows.forEach(row => {
    comparison[row.type].total = parseInt(row.total);
    comparison[row.type].conversionRate = row.total > 0 ?
      ((row.conversions / row.total) * 100).toFixed(1) : 0;
  });

  return comparison;
}

/**
 * Get bot location statistics
 */
async function getBotLocationStats() {
  const db = getDb();

  const result = await db.query(`
    SELECT
      je.metadata->>'location'->>'country' as country,
      COUNT(DISTINCT je.journey_id) as count
    FROM journey_events je
    WHERE je.is_bot = true
      AND je.event_type = 'page_view'
      AND je.metadata IS NOT NULL
      AND je.metadata->'location'->>'country' IS NOT NULL
    GROUP BY je.metadata->'location'->>'country'
    ORDER BY count DESC
    LIMIT 10
  `);

  return result.rows.map(row => ({
    country: row.country || 'Unknown',
    count: parseInt(row.count)
  }));
}

module.exports = router;

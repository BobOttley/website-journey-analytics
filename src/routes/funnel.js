const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getSiteId } = require('../middleware/auth');

/**
 * GET /funnel - Conversion funnel visualisation
 */
router.get('/', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const days = parseInt(req.query.days || '30', 10);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getDb();
    const params = [startDate];
    let siteFilter = '';
    let eventSiteFilter = '';

    if (siteId) {
      siteFilter = 'AND site_id = $2';
      eventSiteFilter = 'AND je.site_id = $2';
      params.push(siteId);
    }

    // Total unique journeys (excluding bots)
    const totalResult = await db.query(`
      SELECT COUNT(DISTINCT journey_id) as count
      FROM journeys
      WHERE first_seen >= $1 ${siteFilter}
        AND (is_bot = false OR is_bot IS NULL)
    `, params);

    // Scrolled (had meaningful scroll depth)
    const scrolledResult = await db.query(`
      SELECT COUNT(DISTINCT je.journey_id) as count
      FROM journey_events je
      JOIN journeys j ON j.journey_id = je.journey_id
      WHERE je.occurred_at >= $1 ${eventSiteFilter}
        AND (j.is_bot = false OR j.is_bot IS NULL)
        AND je.event_type = 'scroll_depth'
    `, params);

    // Engaged (had CTA clicks or meaningful interaction)
    const engagedResult = await db.query(`
      SELECT COUNT(DISTINCT je.journey_id) as count
      FROM journey_events je
      JOIN journeys j ON j.journey_id = je.journey_id
      WHERE je.occurred_at >= $1 ${eventSiteFilter}
        AND (j.is_bot = false OR j.is_bot IS NULL)
        AND je.event_type IN ('cta_click', 'download_click', 'external_link', 'form_start', 'form_submit')
    `, params);

    // Form started
    const formStartResult = await db.query(`
      SELECT COUNT(DISTINCT je.journey_id) as count
      FROM journey_events je
      JOIN journeys j ON j.journey_id = je.journey_id
      WHERE je.occurred_at >= $1 ${eventSiteFilter}
        AND (j.is_bot = false OR j.is_bot IS NULL)
        AND je.event_type = 'form_start'
    `, params);

    // Form submitted (conversions)
    const formSubmitResult = await db.query(`
      SELECT COUNT(DISTINCT je.journey_id) as count
      FROM journey_events je
      JOIN journeys j ON j.journey_id = je.journey_id
      WHERE je.occurred_at >= $1 ${eventSiteFilter}
        AND (j.is_bot = false OR j.is_bot IS NULL)
        AND je.event_type = 'form_submit'
    `, params);

    // Page drop-off data
    const pageDropoff = await db.query(`
      SELECT
        entry_page,
        COUNT(*) as total_journeys,
        COUNT(CASE WHEN outcome IN ('enquiry_submitted', 'visit_booked', 'form_submitted') THEN 1 END) as conversions,
        COUNT(CASE WHEN outcome = 'no_action' OR outcome IS NULL THEN 1 END) as bounces,
        ROUND(AVG(event_count)) as avg_events,
        ROUND(AVG(CASE WHEN confidence > 0 THEN confidence END)) as avg_confidence
      FROM journeys
      WHERE first_seen >= $1 ${siteFilter}
        AND (is_bot = false OR is_bot IS NULL)
        AND entry_page IS NOT NULL
      GROUP BY entry_page
      ORDER BY total_journeys DESC
      LIMIT 15
    `, params);

    // Comparison with previous period
    const prevStart = new Date(Date.now() - days * 2 * 24 * 60 * 60 * 1000).toISOString();
    const prevEnd = startDate;
    const prevParams = [prevStart, prevEnd];
    if (siteId) prevParams.push(siteId);

    const prevTotalResult = await db.query(`
      SELECT COUNT(DISTINCT journey_id) as count
      FROM journeys
      WHERE first_seen >= $1 AND first_seen < $2
        ${siteId ? 'AND site_id = $3' : ''}
        AND (is_bot = false OR is_bot IS NULL)
    `, prevParams);

    const prevConversionsResult = await db.query(`
      SELECT COUNT(DISTINCT je.journey_id) as count
      FROM journey_events je
      JOIN journeys j ON j.journey_id = je.journey_id
      WHERE je.occurred_at >= $1 AND je.occurred_at < $2
        ${siteId ? 'AND je.site_id = $3' : ''}
        AND (j.is_bot = false OR j.is_bot IS NULL)
        AND je.event_type = 'form_submit'
    `, prevParams);

    // Daily trend data for chart
    const dailyTrend = await db.query(`
      SELECT
        DATE(first_seen) as date,
        COUNT(*) as visitors,
        COUNT(CASE WHEN outcome IN ('enquiry_submitted', 'visit_booked', 'form_submitted') THEN 1 END) as conversions
      FROM journeys
      WHERE first_seen >= $1 ${siteFilter}
        AND (is_bot = false OR is_bot IS NULL)
      GROUP BY DATE(first_seen)
      ORDER BY date
    `, params);

    const funnelData = {
      days,
      steps: [
        { name: 'Visitors', count: parseInt(totalResult.rows[0]?.count || 0) },
        { name: 'Scrolled', count: parseInt(scrolledResult.rows[0]?.count || 0) },
        { name: 'Engaged', count: parseInt(engagedResult.rows[0]?.count || 0) },
        { name: 'Form Started', count: parseInt(formStartResult.rows[0]?.count || 0) },
        { name: 'Converted', count: parseInt(formSubmitResult.rows[0]?.count || 0) }
      ],
      pageDropoff: pageDropoff.rows,
      comparison: {
        prevTotal: parseInt(prevTotalResult.rows[0]?.count || 0),
        prevConversions: parseInt(prevConversionsResult.rows[0]?.count || 0),
        currentTotal: parseInt(totalResult.rows[0]?.count || 0),
        currentConversions: parseInt(formSubmitResult.rows[0]?.count || 0)
      },
      dailyTrend: dailyTrend.rows
    };

    res.render('funnel', {
      funnel: funnelData,
      currentPage: 'funnel',
      title: 'Conversion Funnel - SMART Journey',
      siteId
    });
  } catch (error) {
    console.error('Funnel error:', error);
    res.status(500).render('error', { error: 'Failed to load funnel data' });
  }
});

module.exports = router;

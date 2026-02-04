const express = require('express');
const router = express.Router();
const {
  getAllJourneys,
  getJourneyById,
  getJourneyCount,
  getJourneyStats,
  getTopPages,
  getDeviceBreakdown,
  getTrafficSources,
  getDailyJourneyTrend,
  getScrollDepthDistribution,
  getConversionFunnel,
  getReturnVisitorStats,
  getHourlyActivity,
  saveJourneyAnalysis,
  getJourneyAnalysis,
  getPixelStats,
  getPixelVsJsTrend
} = require('../db/queries');
const { reconstructAllJourneys, getJourneyWithEvents } = require('../services/journeyBuilder');
const { getSiteId } = require('../middleware/auth');
const { analyseSingleJourney } = require('../services/aiAnalysis');

// GET /journeys - Journey list view
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all'; // 'all', 'humans', 'bots'
    const siteId = getSiteId(req);

    // Build filter options
    const filterOptions = {
      excludeBots: filter === 'humans',
      botsOnly: filter === 'bots',
      siteId: siteId
    };

    const [journeys, totalCount, rawStats, pixelStats] = await Promise.all([
      getAllJourneys(limit, offset, filterOptions),
      getJourneyCount(filterOptions),
      getJourneyStats(siteId),
      getPixelStats(siteId, 30) // Last 30 days
    ]);
    const totalPages = Math.ceil(totalCount / limit);

    // Convert PostgreSQL string values to numbers
    const stats = {
      total_journeys: parseInt(rawStats.total_journeys) || 0,
      enquiries: parseInt(rawStats.enquiries) || 0,
      visits_booked: parseInt(rawStats.visits_booked) || 0,
      no_action: parseInt(rawStats.no_action) || 0,
      avg_events: parseFloat(rawStats.avg_events) || 0,
      avg_time_to_action: parseFloat(rawStats.avg_time_to_action) || 0
    };

    // Parse page_sequence JSON for each journey
    const parsedJourneys = journeys.map(j => ({
      ...j,
      page_sequence: j.page_sequence ? JSON.parse(j.page_sequence) : []
    }));

    res.render('journeyList', {
      journeys: parsedJourneys,
      stats,
      pixelStats,
      filter,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      currentPage: 'journeys',
      title: 'Journeys - SMART Journey'
    });
  } catch (error) {
    console.error('Error fetching journeys:', error);
    res.status(500).render('error', { error: 'Failed to load journeys' });
  }
});

// POST /journeys/rebuild - Rebuild all journeys from events
router.post('/rebuild', async (req, res) => {
  try {
    const results = await reconstructAllJourneys();
    res.redirect('/journeys?rebuilt=' + results.updated);
  } catch (error) {
    console.error('Error rebuilding journeys:', error);
    res.status(500).render('error', { error: 'Failed to rebuild journeys' });
  }
});

// GET /journeys/api/charts - Chart data for dashboard
router.get('/api/charts', async (req, res) => {
  try {
    const siteId = getSiteId(req);

    const [
      topPages,
      deviceBreakdown,
      trafficSources,
      dailyTrend,
      scrollDepth,
      conversionFunnel,
      returnVisitors,
      hourlyActivity,
      pixelVsJs
    ] = await Promise.all([
      getTopPages(10, siteId),
      getDeviceBreakdown(siteId),
      getTrafficSources(siteId),
      getDailyJourneyTrend(30, siteId),
      getScrollDepthDistribution(siteId),
      getConversionFunnel(siteId),
      getReturnVisitorStats(siteId),
      getHourlyActivity(siteId),
      getPixelVsJsTrend(siteId, 30)
    ]);

    res.json({
      success: true,
      data: {
        topPages,
        deviceBreakdown,
        trafficSources,
        dailyTrend,
        scrollDepth,
        conversionFunnel,
        returnVisitors: {
          new: parseInt(returnVisitors.new_visitors) || 0,
          returning: parseInt(returnVisitors.return_visitors) || 0
        },
        hourlyActivity,
        pixelVsJs
      }
    });
  } catch (error) {
    console.error('Error fetching chart data:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch chart data' });
  }
});

// GET /journeys/:id - Journey detail view
router.get('/:id', async (req, res) => {
  try {
    const journeyId = req.params.id;
    const siteId = getSiteId(req);
    const journey = await getJourneyWithEvents(journeyId, siteId);

    if (!journey) {
      return res.status(404).render('error', { error: 'Journey not found' });
    }

    // Get existing AI analysis if any
    const existingAnalysis = await getJourneyAnalysis(journeyId);

    res.render('journeyDetail', {
      journey,
      existingAnalysis,
      currentPage: 'journeys',
      title: `Journey ${journeyId.substring(0, 8)} - SMART Journey`
    });
  } catch (error) {
    console.error('Error fetching journey:', error);
    res.status(500).render('error', { error: 'Failed to load journey details' });
  }
});

// API endpoint for journey data
router.get('/api/stats', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const stats = await getJourneyStats(siteId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /journeys/:id/analyse - AI analysis of a single journey
router.post('/:id/analyse', async (req, res) => {
  try {
    const journeyId = req.params.id;
    const siteId = getSiteId(req);

    // Get the journey with all its events
    const journey = await getJourneyWithEvents(journeyId, siteId);

    if (!journey) {
      return res.status(404).json({ success: false, error: 'Journey not found' });
    }

    if (!journey.events || journey.events.length === 0) {
      return res.status(400).json({ success: false, error: 'Journey has no events to analyse' });
    }

    // Run AI analysis
    const result = await analyseSingleJourney(journey);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    // Save the analysis to the database
    await saveJourneyAnalysis(journeyId, result.analysis);

    res.json({
      success: true,
      journey_id: journeyId,
      analysis: result.analysis,
      analysed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error analysing journey:', error);
    res.status(500).json({ success: false, error: 'Failed to analyse journey' });
  }
});

module.exports = router;

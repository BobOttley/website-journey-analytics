const express = require('express');
const router = express.Router();
const { getAllJourneys, getJourneyById, getJourneyCount, getJourneyStats } = require('../db/queries');
const { reconstructAllJourneys, getJourneyWithEvents } = require('../services/journeyBuilder');

// GET /journeys - Journey list view
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const journeys = await getAllJourneys(limit, offset);
    const totalCount = await getJourneyCount();
    const rawStats = await getJourneyStats();
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
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
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

// GET /journeys/:id - Journey detail view
router.get('/:id', async (req, res) => {
  try {
    const journeyId = req.params.id;
    const journey = await getJourneyWithEvents(journeyId);

    if (!journey) {
      return res.status(404).render('error', { error: 'Journey not found' });
    }

    res.render('journeyDetail', { journey });
  } catch (error) {
    console.error('Error fetching journey:', error);
    res.status(500).render('error', { error: 'Failed to load journey details' });
  }
});

// API endpoint for journey data
router.get('/api/stats', async (req, res) => {
  try {
    const stats = await getJourneyStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { getAllJourneys, getJourneyById, getJourneyCount, getJourneyStats } = require('../db/queries');
const { reconstructAllJourneys, getJourneyWithEvents } = require('../services/journeyBuilder');

// GET /journeys - Journey list view
router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const journeys = getAllJourneys(limit, offset);
    const totalCount = getJourneyCount();
    const stats = getJourneyStats();
    const totalPages = Math.ceil(totalCount / limit);

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
router.post('/rebuild', (req, res) => {
  try {
    const results = reconstructAllJourneys();
    res.redirect('/journeys?rebuilt=' + results.updated);
  } catch (error) {
    console.error('Error rebuilding journeys:', error);
    res.status(500).render('error', { error: 'Failed to rebuild journeys' });
  }
});

// GET /journeys/:id - Journey detail view
router.get('/:id', (req, res) => {
  try {
    const journeyId = req.params.id;
    const journey = getJourneyWithEvents(journeyId);

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
router.get('/api/stats', (req, res) => {
  try {
    const stats = getJourneyStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const {
  getAllFamilies,
  getFamilyCount,
  getFamilyByIP,
  getFamilyByVisitorId,
  getFamilyStats,
  getTopLocations,
  getEventsByIPAddress
} = require('../db/queries');
const { getSiteId } = require('../middleware/auth');

// GET /families - Family list view
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'humans'; // 'humans' (default), 'all', 'bots'
    const engagement = req.query.engagement || 'all'; // 'all', 'high', 'medium', 'low'
    const visits = req.query.visits || 'all'; // 'all', '1', '2-3', '4+'
    const siteId = getSiteId(req);

    // Build filter options
    const filterOptions = {
      excludeBots: filter === 'humans',
      botsOnly: filter === 'bots',
      siteId: siteId,
      engagement: engagement !== 'all' ? engagement : null,
      visits: visits !== 'all' ? visits : null
    };

    const [families, totalCount, stats, topLocations] = await Promise.all([
      getAllFamilies(limit, offset, filterOptions),
      getFamilyCount(filterOptions),
      getFamilyStats(siteId),
      getTopLocations(siteId, 10)
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    // Parse stats
    const parsedStats = {
      total_families: parseInt(stats.total_families) || 0,
      human_families: parseInt(stats.human_families) || 0,
      converted_families: parseInt(stats.converted_families) || 0,
      returning_families: parseInt(stats.returning_families) || 0,
      avg_events: parseFloat(stats.avg_events_per_visit) || 0
    };

    res.render('familyList', {
      families,
      stats: parsedStats,
      topLocations,
      filter,
      engagement,
      visits,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      currentPage: 'families',
      title: 'Families - SMART Journey'
    });
  } catch (error) {
    console.error('Error fetching families:', error);
    res.status(500).render('error', { error: 'Failed to load families' });
  }
});

// GET /families/:visitorId - Family detail view (by visitor_id)
router.get('/:visitorId', async (req, res) => {
  try {
    const visitorId = req.params.visitorId;
    const siteId = getSiteId(req);

    const family = await getFamilyByVisitorId(visitorId, siteId);

    if (!family) {
      return res.status(404).render('error', { error: 'Family not found' });
    }

    res.render('familyDetail', {
      family,
      currentPage: 'families',
      title: `Family ${visitorId.substring(0, 8)}... - SMART Journey`
    });
  } catch (error) {
    console.error('Error fetching family:', error);
    res.status(500).render('error', { error: 'Failed to load family details' });
  }
});

// API endpoint for family stats
router.get('/api/stats', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const stats = await getFamilyStats(siteId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching family stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;

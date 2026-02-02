const express = require('express');
const router = express.Router();
const { getActiveVisitors, getRecentNewJourneys, getActiveVisitorCount } = require('../db/queries');
const emailService = require('../services/emailService');

// Track which journeys we've already notified about (in-memory, resets on restart)
const notifiedJourneys = new Set();

// GET /realtime - Dashboard view
router.get('/', async (req, res) => {
  try {
    const visitors = await getActiveVisitors(60); // Active in last 60 seconds
    const visitorCount = visitors.length;

    res.render('realtime', {
      title: 'Real-time Visitors',
      currentPage: 'realtime',
      visitors,
      visitorCount,
      emailConfigured: emailService.isConfigured()
    });
  } catch (error) {
    console.error('Error loading realtime page:', error);
    res.status(500).render('error', { error: 'Failed to load real-time data' });
  }
});

// GET /realtime/api/visitors - JSON endpoint for polling
router.get('/api/visitors', async (req, res) => {
  try {
    const withinSeconds = parseInt(req.query.seconds) || 60;
    const visitors = await getActiveVisitors(withinSeconds);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: visitors.length,
      visitors: visitors.map(v => ({
        journey_id: v.journey_id,
        page_url: v.page_url,
        device_type: v.device_type,
        last_activity: v.last_activity,
        first_seen: v.first_seen,
        referrer: v.referrer
      }))
    });
  } catch (error) {
    console.error('Error fetching active visitors:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch visitors' });
  }
});

// GET /realtime/api/new-journeys - Check for new journeys and send notifications
router.get('/api/new-journeys', async (req, res) => {
  try {
    const sinceSeconds = parseInt(req.query.seconds) || 60;
    const newJourneys = await getRecentNewJourneys(sinceSeconds);

    // Find journeys we haven't notified about yet
    const unnotified = newJourneys.filter(j => !notifiedJourneys.has(j.journey_id));

    // Send email notifications for new journeys
    const notificationResults = [];
    for (const journey of unnotified) {
      // Mark as notified immediately to prevent duplicates
      notifiedJourneys.add(journey.journey_id);

      // Clean up old entries (keep last 1000)
      if (notifiedJourneys.size > 1000) {
        const entries = Array.from(notifiedJourneys);
        entries.slice(0, 500).forEach(id => notifiedJourneys.delete(id));
      }

      // Send notification
      const result = await emailService.sendNewVisitorNotification(journey);
      notificationResults.push({
        journey_id: journey.journey_id,
        ...result
      });
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total_new: newJourneys.length,
      notified: unnotified.length,
      notifications: notificationResults
    });
  } catch (error) {
    console.error('Error checking new journeys:', error);
    res.status(500).json({ success: false, error: 'Failed to check new journeys' });
  }
});

// GET /realtime/api/count - Just the count for quick polling
router.get('/api/count', async (req, res) => {
  try {
    const withinSeconds = parseInt(req.query.seconds) || 60;
    const count = await getActiveVisitorCount(withinSeconds);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count
    });
  } catch (error) {
    console.error('Error fetching visitor count:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch count' });
  }
});

module.exports = router;

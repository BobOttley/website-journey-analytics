const express = require('express');
const router = express.Router();
const { getActiveVisitors, getRecentNewJourneys, getActiveVisitorCount, getVisitorLocations, getRecentInactiveSessions } = require('../db/queries');
const emailService = require('../services/emailService');

// Track which journeys we've already notified about (in-memory, resets on restart)
const notifiedJourneys = new Set();

// GET /realtime - Dashboard view
router.get('/', async (req, res) => {
  try {
    const visitors = await getActiveVisitors(300); // Active in last 5 minutes
    const visitorCount = visitors.length;

    // Parse location from metadata for each visitor
    const visitorsWithLocation = visitors.map(v => {
      let location = null;
      try {
        if (v.metadata) {
          const metadata = typeof v.metadata === 'string' ? JSON.parse(v.metadata) : v.metadata;
          location = metadata.location || null;
        }
      } catch (e) {}
      return { ...v, location };
    });

    res.render('realtime', {
      title: 'Real-time - SMART Journey',
      currentPage: 'realtime',
      visitors: visitorsWithLocation,
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
    const withinSeconds = parseInt(req.query.seconds) || 300;
    const visitors = await getActiveVisitors(withinSeconds);

    // Parse location from metadata for each visitor
    const visitorsWithLocation = visitors.map(v => {
      let location = null;
      try {
        if (v.metadata) {
          const metadata = typeof v.metadata === 'string' ? JSON.parse(v.metadata) : v.metadata;
          location = metadata.location || null;
        }
      } catch (e) {}
      return {
        journey_id: v.journey_id,
        page_url: v.page_url,
        device_type: v.device_type,
        last_activity: v.last_activity,
        first_seen: v.first_seen,
        referrer: v.referrer,
        visitor_id: v.visitor_id,
        visit_number: v.visit_number,
        location
      };
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: visitors.length,
      visitors: visitorsWithLocation
    });
  } catch (error) {
    console.error('Error fetching active visitors:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch visitors' });
  }
});

// GET /realtime/api/locations - Get visitor locations
router.get('/api/locations', async (req, res) => {
  try {
    const withinSeconds = parseInt(req.query.seconds) || 300;
    const locations = await getVisitorLocations(withinSeconds);

    // Aggregate by country
    const byCountry = {};
    locations.forEach(loc => {
      const country = loc.countryCode || 'Unknown';
      if (!byCountry[country]) {
        byCountry[country] = {
          country: loc.country,
          countryCode: loc.countryCode,
          flag: loc.flag,
          count: 0,
          cities: new Set()
        };
      }
      byCountry[country].count++;
      if (loc.city) byCountry[country].cities.add(loc.city);
    });

    // Convert to array
    const aggregated = Object.values(byCountry).map(c => ({
      ...c,
      cities: Array.from(c.cities)
    })).sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      total: locations.length,
      locations: aggregated
    });
  } catch (error) {
    console.error('Error fetching visitor locations:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch locations' });
  }
});

// GET /realtime/api/new-journeys - Check for new journeys and send notifications
router.get('/api/new-journeys', async (req, res) => {
  try {
    const sinceSeconds = parseInt(req.query.seconds) || 300;
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
    const withinSeconds = parseInt(req.query.seconds) || 300;
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

// GET /realtime/api/recent-sessions - Get latest sessions that are not currently active
router.get('/api/recent-sessions', async (req, res) => {
  try {
    const inactiveAfter = parseInt(req.query.inactive_after) || 300;
    const limit = parseInt(req.query.limit) || 10;
    const sessions = await getRecentInactiveSessions(inactiveAfter, limit);

    // Parse location from metadata
    const sessionsWithLocation = sessions.map(s => {
      let location = null;
      try {
        if (s.metadata) {
          const metadata = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata;
          location = metadata.location || null;
        }
      } catch (e) {}
      return { ...s, location };
    });

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      count: sessions.length,
      sessions: sessionsWithLocation
    });
  } catch (error) {
    console.error('Error fetching recent sessions:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch recent sessions' });
  }
});

module.exports = router;

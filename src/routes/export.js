const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getSiteId } = require('../middleware/auth');

/**
 * GET /export/journeys - Export journeys as CSV
 */
router.get('/journeys', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const days = parseInt(req.query.days || '30', 10);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getDb();
    let query = `
      SELECT journey_id, visitor_id, visit_number, first_seen, last_seen,
             entry_page, entry_referrer, initial_intent, event_count,
             outcome, time_to_action, confidence, is_bot, bot_score, bot_type
      FROM journeys
      WHERE first_seen >= $1
    `;
    const params = [startDate];

    if (siteId) {
      query += ` AND site_id = $2`;
      params.push(siteId);
    }

    query += ` ORDER BY first_seen DESC`;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No journeys found in the specified period' });
    }

    // Build CSV
    const headers = Object.keys(result.rows[0]);
    const csvLines = [headers.join(',')];

    for (const row of result.rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csvLines.push(values.join(','));
    }

    const csv = csvLines.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="journeys-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * GET /export/events - Export events as CSV
 */
router.get('/events', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const days = parseInt(req.query.days || '7', 10);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const db = getDb();
    let query = `
      SELECT journey_id, visitor_id, event_type, page_url, referrer,
             intent_type, cta_label, device_type, occurred_at,
             is_bot, bot_score
      FROM journey_events
      WHERE occurred_at >= $1
    `;
    const params = [startDate];

    if (siteId) {
      query += ` AND site_id = $2`;
      params.push(siteId);
    }

    query += ` ORDER BY occurred_at DESC LIMIT 50000`;

    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No events found in the specified period' });
    }

    const headers = Object.keys(result.rows[0]);
    const csvLines = [headers.join(',')];

    for (const row of result.rows) {
      const values = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
      });
      csvLines.push(values.join(','));
    }

    const csv = csvLines.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="events-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

/**
 * GET /export/insights - Export AI insights as JSON
 */
router.get('/insights', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const db = getDb();

    let query = 'SELECT * FROM insights';
    const params = [];

    if (siteId) {
      query += ' WHERE site_id = $1';
      params.push(siteId);
    }

    query += ' ORDER BY created_at DESC LIMIT 20';

    const result = await db.query(query, params);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="insights-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(result.rows);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;

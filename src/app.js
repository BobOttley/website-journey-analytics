require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initializeSchema, getDb } = require('./db/database');

// Import routes
const eventsRouter = require('./routes/events');
const journeysRouter = require('./routes/journeys');
const insightsRouter = require('./routes/insights');
const realtimeRouter = require('./routes/realtime');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// Handle text/plain as JSON (sendBeacon sends text/plain)
app.use(express.text({ type: 'text/plain' }));
app.use((req, res, next) => {
  if (req.headers['content-type']?.startsWith('text/plain') && typeof req.body === 'string') {
    try {
      req.body = JSON.parse(req.body);
    } catch (e) {
      // Leave as string if not valid JSON
    }
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// EJS setup with express-ejs-layouts style
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../public/views'));

// Simple layout middleware
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = function(view, options = {}) {
    // Parse query params for alerts
    options.rebuilt = req.query.rebuilt;
    options.analyzed = req.query.analyzed;
    options.error = req.query.error;
    options.currentPage = options.currentPage || view;

    // Render the view first, then inject into layout
    app.render(view, { ...options, layout: false }, (err, body) => {
      if (err) {
        return next(err);
      }
      originalRender('layout', { ...options, body });
    });
  };
  next();
});

// Serve tracking script with correct endpoint
app.get('/tracking.js', (req, res) => {
  const fs = require('fs');
  const scriptPath = path.join(__dirname, '../gtm/trackingScript.js');
  let script = fs.readFileSync(scriptPath, 'utf8');

  // Replace endpoint with actual server URL
  const serverUrl = process.env.SERVER_URL || `https://website-journey-analytics.onrender.com`;
  script = script.replace(
    /const ANALYTICS_ENDPOINT = ['"][^'"]+['"]/,
    `const ANALYTICS_ENDPOINT = '${serverUrl}/api/event'`
  );

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  res.send(script);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Debug endpoint to check event count
app.get('/debug', async (req, res) => {
  try {
    const db = getDb();
    const eventCount = await db.query('SELECT COUNT(*) as count FROM journey_events');
    const journeyCount = await db.query('SELECT COUNT(*) as count FROM journeys');
    const recentEvents = await db.query('SELECT * FROM journey_events ORDER BY occurred_at DESC LIMIT 5');
    res.json({
      events: parseInt(eventCount.rows[0].count),
      journeys: parseInt(journeyCount.rows[0].count),
      recentEvents: recentEvents.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Routes
app.use('/api/event', eventsRouter);
app.use('/api/events', eventsRouter);

// Web Routes
app.use('/journeys', journeysRouter);
app.use('/realtime', realtimeRouter);
app.use('/insights', insightsRouter);

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/journeys');
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', { error: 'Page not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).render('error', { error: 'Internal server error' });
});

// Initialize database and start server
async function start() {
  try {
    await initializeSchema();

    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║              SMART Journey Analytics                  ║
║              Website Visitor Tracking                 ║
╠═══════════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}/journeys            ║
║  Real-time:  http://localhost:${PORT}/realtime            ║
║  Insights:   http://localhost:${PORT}/insights            ║
║  API:        http://localhost:${PORT}/api/event           ║
║  Health:     http://localhost:${PORT}/health              ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = app;

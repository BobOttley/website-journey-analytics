require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { initializeSchema, getDb } = require('./db/database');

// Import routes
const eventsRouter = require('./routes/events');
const journeysRouter = require('./routes/journeys');
const insightsRouter = require('./routes/insights');
const realtimeRouter = require('./routes/realtime');
const botsRouter = require('./routes/bots');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');

// Import middleware
const { requireAuth, attachUserContext } = require('./middleware/auth');

// Import journey builder for background sync
const { reconstructJourney } = require('./services/journeyBuilder');
const { upsertJourney, getUniqueJourneyIds } = require('./db/queries');

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

// Trust proxy - required for secure cookies behind Render/Heroku/etc
app.set('trust proxy', 1);

// Session configuration - must be before routes
app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'smart-journey-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Attach user context to all requests
app.use(attachUserContext);

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

    // If layout: false, render directly without wrapping in layout
    if (options.layout === false) {
      return originalRender(view, options);
    }

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

// Serve tracking script with correct endpoint and tracking key
app.get('/tracking.js', (req, res) => {
  const fs = require('fs');
  const scriptPath = path.join(__dirname, '../gtm/trackingScript.js');
  let script = fs.readFileSync(scriptPath, 'utf8');

  // Get tracking key from query param
  const trackingKey = req.query.key || '';

  // Replace endpoint with actual server URL
  const serverUrl = process.env.SERVER_URL || `https://website-journey-analytics.onrender.com`;
  script = script.replace(
    /endpoint: ['"][^'"]+['"]/,
    `endpoint: '${serverUrl}/api/event'`
  );

  // Inject tracking key
  script = script.replace(
    /trackingKey: ['"][^'"]*['"]/,
    `trackingKey: '${trackingKey}'`
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

// Auth Routes (public - no auth required)
app.use('/', authRouter);

// API Routes (public - tracking events don't require auth)
app.use('/api/event', eventsRouter);
app.use('/api/events', eventsRouter);

// Web Routes (protected - require authentication)
app.use('/journeys', requireAuth, journeysRouter);
app.use('/realtime', requireAuth, realtimeRouter);
app.use('/insights', requireAuth, insightsRouter);
app.use('/bots', requireAuth, botsRouter);
app.use('/admin', requireAuth, adminRouter);

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    res.redirect('/journeys');
  } else {
    res.redirect('/login');
  }
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

// Background job to rebuild recent journeys (keeps journeys table fresh for Recent Sessions)
async function rebuildRecentJourneys() {
  try {
    const db = getDb();
    // Get journey_ids with activity in the last 5 minutes
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const result = await db.query(
      `SELECT DISTINCT journey_id FROM journey_events WHERE occurred_at > $1`,
      [cutoff]
    );

    for (const row of result.rows) {
      try {
        const journey = await reconstructJourney(row.journey_id);
        if (journey) await upsertJourney(journey);
      } catch (err) {
        // Silently continue - don't let one failure stop others
      }
    }
  } catch (err) {
    console.error('Background journey rebuild failed:', err.message);
  }
}

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

      // Start background journey sync (every 30 seconds)
      setInterval(rebuildRecentJourneys, 30000);
      rebuildRecentJourneys(); // Run immediately on startup
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = app;

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
const uxRouter = require('./routes/ux');

// Import middleware
const { requireAuth, attachUserContext } = require('./middleware/auth');

// Import journey builder for background sync
const { reconstructJourney } = require('./services/journeyBuilder');
const { upsertJourney, getUniqueJourneyIds, insertEvent, getSiteByTrackingKey } = require('./db/queries');
const { getClientIP, lookupIP, isPrivateIP } = require('./services/geoService');
const { detectBotForEvent } = require('./services/botDetection');

// 1x1 transparent GIF (smallest valid GIF - 43 bytes)
const PIXEL_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Cache for tracking key lookups (pixel endpoint)
const pixelTrackingKeyCache = new Map();
const PIXEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function resolvePixelSiteId(trackingKey) {
  if (!trackingKey) return null;

  const cached = pixelTrackingKeyCache.get(trackingKey);
  if (cached && Date.now() - cached.timestamp < PIXEL_CACHE_TTL) {
    return cached.siteId;
  }

  const site = await getSiteByTrackingKey(trackingKey);
  const siteId = site ? site.id : null;

  pixelTrackingKeyCache.set(trackingKey, { siteId, timestamp: Date.now() });

  if (pixelTrackingKeyCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of pixelTrackingKeyCache) {
      if (now - value.timestamp > PIXEL_CACHE_TTL) {
        pixelTrackingKeyCache.delete(key);
      }
    }
  }

  return siteId;
}

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

  // Replace pixel endpoint
  script = script.replace(
    /pixelEndpoint: ['"][^'"]+['"]/,
    `pixelEndpoint: '${serverUrl}/p.gif'`
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

/**
 * Pixel Tracking Endpoint
 *
 * Usage: <img src="https://website-journey-analytics.onrender.com/p.gif?k=TRACKING_KEY&p=PAGE_URL" />
 *
 * Query params:
 *   k  = tracking key (required for multi-tenant)
 *   p  = page URL (defaults to referrer)
 *   r  = referrer URL
 *   t  = title (optional page title)
 *   v  = visitor ID (optional, for linking to JS tracking)
 *   j  = journey ID (optional, for linking to JS tracking)
 *
 * This captures visitors who:
 * - Have JavaScript disabled
 * - Use ad blockers that block tracking scripts
 * - Leave before JavaScript loads
 * - Are bots that don't execute JavaScript
 */
app.get('/p.gif', async (req, res) => {
  // Always return the pixel immediately (non-blocking)
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(PIXEL_GIF);

  // Process the tracking asynchronously (don't delay the image response)
  setImmediate(async () => {
    try {
      const trackingKey = req.query.k || req.query.key || null;
      const pageUrl = req.query.p || req.query.page || req.get('Referer') || 'unknown';
      const referrer = req.query.r || req.query.ref || null;
      const pageTitle = req.query.t || req.query.title || null;
      const visitorId = req.query.v || req.query.visitor || `pxl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const journeyId = req.query.j || req.query.journey || `pxl_jrn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Get client info
      const userAgent = req.get('User-Agent') || 'Unknown';
      const clientIP = getClientIP(req);

      // Detect device type from user agent
      let deviceType = 'desktop';
      if (/mobile|android|iphone|ipad|ipod/i.test(userAgent)) {
        deviceType = /ipad|tablet/i.test(userAgent) ? 'tablet' : 'mobile';
      }

      // Run bot detection
      const botDetection = detectBotForEvent({
        userAgent,
        ipAddress: clientIP,
        metadata: {}
      });

      // Resolve site ID
      const siteId = await resolvePixelSiteId(trackingKey);

      // Get geolocation for the IP
      let location = null;
      if (clientIP && !isPrivateIP(clientIP)) {
        try {
          location = await lookupIP(clientIP);
        } catch (err) {
          // Silently ignore geo lookup failures
        }
      }

      // Build metadata
      const metadata = {
        tracking_method: 'pixel',
        page_title: pageTitle,
        location: location,
        ip_address: clientIP
      };

      // Insert the pixel view event
      await insertEvent({
        journey_id: journeyId,
        visitor_id: visitorId,
        event_type: 'pixel_view',
        page_url: pageUrl,
        referrer: referrer,
        intent_type: null,
        cta_label: null,
        device_type: deviceType,
        metadata: metadata,
        occurred_at: new Date().toISOString(),
        user_agent: userAgent,
        ip_address: clientIP,
        is_bot: botDetection.isBot,
        bot_score: botDetection.botScore,
        bot_signals: botDetection.signals,
        site_id: siteId
      });

      console.log(`[PIXEL] Tracked: ${pageUrl} (${botDetection.isBot ? 'bot' : 'human'}, score: ${botDetection.botScore})`);
    } catch (err) {
      console.error('[PIXEL] Tracking error:', err.message);
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Email debug endpoint
const emailService = require('./services/emailService');
app.get('/debug-email', async (req, res) => {
  const configured = emailService.isConfigured();
  const envCheck = {
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    SENDER_EMAIL: !!process.env.SENDER_EMAIL,
    EMAIL_NOTIFY: !!process.env.EMAIL_NOTIFY
  };

  // If ?send=1 is passed, try to send a test email
  if (req.query.send === '1' && configured) {
    try {
      const result = await emailService.sendNewVisitorNotification({
        journey_id: 'debug_test_' + Date.now(),
        entry_page: 'https://debug-test.com/test-page',
        referrer: 'Debug test',
        device_type: 'debug',
        first_seen: new Date().toISOString(),
        location: { city: 'Debug City', country: 'Test Land', flag: '🔧' },
        isReturn: false
      });
      return res.json({ configured, envCheck, testEmail: result });
    } catch (err) {
      return res.json({ configured, envCheck, testEmail: { error: err.message } });
    }
  }

  res.json({ configured, envCheck, hint: 'Add ?send=1 to send a test email' });
});

// Debug endpoint to check event count
app.get('/debug', async (req, res) => {
  try {
    const db = getDb();
    const eventCount = await db.query('SELECT COUNT(*) as count FROM journey_events');
    const journeyCount = await db.query('SELECT COUNT(*) as count FROM journeys');
    const recentEvents = await db.query('SELECT * FROM journey_events ORDER BY occurred_at DESC LIMIT 5');

    // Check IP addresses with multiple journeys
    const ipJourneys = await db.query(`
      SELECT ip_address, COUNT(DISTINCT journey_id) as journey_count
      FROM journey_events
      WHERE ip_address IS NOT NULL
      GROUP BY ip_address
      HAVING COUNT(DISTINCT journey_id) > 1
      ORDER BY journey_count DESC
      LIMIT 10
    `);

    // Check current visit_number values in journeys table
    const visitNumbers = await db.query(`
      SELECT journey_id, visitor_id, visit_number, first_seen, site_id
      FROM journeys
      ORDER BY first_seen DESC
      LIMIT 15
    `);

    // Check journeys specifically for site_id=1 (BSMART)
    const bsmartJourneys = await db.query(`
      SELECT journey_id, visitor_id, visit_number, ip_address, first_seen
      FROM journeys j
      LEFT JOIN (
        SELECT DISTINCT journey_id, ip_address
        FROM journey_events
        WHERE ip_address IS NOT NULL
      ) e ON j.journey_id = e.journey_id
      WHERE j.site_id = 1
      ORDER BY first_seen DESC
      LIMIT 10
    `);

    res.json({
      events: parseInt(eventCount.rows[0].count),
      journeys: parseInt(journeyCount.rows[0].count),
      recentEvents: recentEvents.rows,
      ipsWithMultipleJourneys: ipJourneys.rows,
      recentJourneysWithVisitNumber: visitNumbers.rows,
      bsmartJourneys: bsmartJourneys.rows
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
app.use('/ux', requireAuth, uxRouter);
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
║  UX:         http://localhost:${PORT}/ux                  ║
║  Insights:   http://localhost:${PORT}/insights            ║
║  API:        http://localhost:${PORT}/api/event           ║
║  Pixel:      http://localhost:${PORT}/p.gif               ║
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

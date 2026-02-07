require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const compression = require('compression');
const helmet = require('helmet');
const cron = require('node-cron');
const { initializeSchema, getDb, closeDb } = require('./db/database');

// Import routes
const eventsRouter = require('./routes/events');
const journeysRouter = require('./routes/journeys');
const familiesRouter = require('./routes/families');
const insightsRouter = require('./routes/insights');
const realtimeRouter = require('./routes/realtime');
const botsRouter = require('./routes/bots');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const uxRouter = require('./routes/ux');
const screenshotsRouter = require('./routes/screenshots');
const exportRouter = require('./routes/export');
const funnelRouter = require('./routes/funnel');

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

// ============================================
// SECURITY MIDDLEWARE
// ============================================

// Security headers (CSP disabled for EJS inline scripts)
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// Compression
app.use(compression());

// CORS - restrict to tracked domains + dashboard
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (server-to-server, pixel tracking, etc.)
    if (!origin) return callback(null, true);
    // If no origins configured, allow all (backwards compatible)
    if (allowedOrigins.length === 0) return callback(null, true);
    // Allow configured origins
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(null, false);
  },
  credentials: true
}));

// Request logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('short'));
}

// Rate limiting
const eventLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { success: false, error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false
});

const analysisLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Analysis rate limit reached, please wait' },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================
// BODY PARSING
// ============================================

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

// Session configuration - secure secret handling
const sessionSecret = process.env.SESSION_SECRET || (() => {
  console.warn('WARNING: No SESSION_SECRET set. Using random secret - sessions will not persist across restarts!');
  return require('crypto').randomBytes(32).toString('hex');
})();

app.use(session({
  store: new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: sessionSecret,
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

// ============================================
// TRACKING SCRIPT (cached in memory)
// ============================================

let cachedTrackingScript = null;
let trackingScriptMtime = 0;

app.get('/tracking.js', (req, res) => {
  const scriptPath = path.join(__dirname, '../gtm/trackingScript.js');

  try {
    const stat = fs.statSync(scriptPath);
    if (!cachedTrackingScript || stat.mtimeMs > trackingScriptMtime) {
      cachedTrackingScript = fs.readFileSync(scriptPath, 'utf8');
      trackingScriptMtime = stat.mtimeMs;
    }
  } catch (err) {
    return res.status(500).send('// Tracking script not found');
  }

  let script = cachedTrackingScript;
  const trackingKey = req.query.key || '';
  const serverUrl = process.env.SERVER_URL || 'https://website-journey-analytics.onrender.com';

  script = script.replace(
    /endpoint: ['"][^'"]+['"]/,
    `endpoint: '${serverUrl}/api/event'`
  );
  script = script.replace(
    /pixelEndpoint: ['"][^'"]+['"]/,
    `pixelEndpoint: '${serverUrl}/p.gif'`
  );
  script = script.replace(
    /trackingKey: ['"][^'"]*['"]/,
    `trackingKey: '${trackingKey}'`
  );

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(script);
});

// ============================================
// PIXEL TRACKING ENDPOINT
// ============================================

app.get('/p.gif', async (req, res) => {
  res.setHeader('Content-Type', 'image/gif');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(PIXEL_GIF);

  setImmediate(async () => {
    try {
      const trackingKey = req.query.k || req.query.key || null;
      const pageUrl = req.query.p || req.query.page || req.get('Referer') || 'unknown';
      const referrer = req.query.r || req.query.ref || null;
      const pageTitle = req.query.t || req.query.title || null;
      const visitorId = req.query.v || req.query.visitor || `pxl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const journeyId = req.query.j || req.query.journey || `pxl_jrn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const userAgent = req.get('User-Agent') || 'Unknown';
      const clientIP = getClientIP(req);

      let deviceType = 'desktop';
      if (/mobile|android|iphone|ipad|ipod/i.test(userAgent)) {
        deviceType = /ipad|tablet/i.test(userAgent) ? 'tablet' : 'mobile';
      }

      const botDetection = detectBotForEvent({
        userAgent,
        ipAddress: clientIP,
        metadata: {}
      });

      const siteId = await resolvePixelSiteId(trackingKey);

      let location = null;
      if (clientIP && !isPrivateIP(clientIP)) {
        try {
          location = await lookupIP(clientIP);
        } catch (err) {
          // Silently ignore geo lookup failures
        }
      }

      const metadata = {
        tracking_method: 'pixel',
        page_title: pageTitle,
        location: location,
        ip_address: clientIP
      };

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

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// ============================================
// DEBUG/ADMIN ENDPOINTS (PROTECTED)
// ============================================

app.get('/cleanup-pixel-tests', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const events = await db.query("DELETE FROM journey_events WHERE journey_id LIKE 'pxl_jrn_%' RETURNING journey_id");
    const journeys = await db.query("DELETE FROM journeys WHERE journey_id LIKE 'pxl_jrn_%' RETURNING journey_id");

    res.json({
      success: true,
      deleted: {
        events: events.rowCount,
        journeys: journeys.rowCount
      }
    });
  } catch (err) {
    console.error('[CLEANUP] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

const emailService = require('./services/emailService');
app.get('/debug-email', requireAuth, async (req, res) => {
  const configured = emailService.isConfigured();
  const envCheck = {
    MS_CLIENT_ID: !!process.env.MS_CLIENT_ID,
    MS_CLIENT_SECRET: !!process.env.MS_CLIENT_SECRET,
    MS_TENANT_ID: !!process.env.MS_TENANT_ID,
    SENDER_EMAIL: !!process.env.SENDER_EMAIL,
    EMAIL_NOTIFY: !!process.env.EMAIL_NOTIFY
  };

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

app.get('/debug', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const eventCount = await db.query('SELECT COUNT(*) as count FROM journey_events');
    const journeyCount = await db.query('SELECT COUNT(*) as count FROM journeys');
    const recentEvents = await db.query('SELECT * FROM journey_events ORDER BY occurred_at DESC LIMIT 5');

    const ipJourneys = await db.query(`
      SELECT ip_address, COUNT(DISTINCT journey_id) as journey_count
      FROM journey_events
      WHERE ip_address IS NOT NULL
      GROUP BY ip_address
      HAVING COUNT(DISTINCT journey_id) > 1
      ORDER BY journey_count DESC
      LIMIT 10
    `);

    const visitNumbers = await db.query(`
      SELECT journey_id, visitor_id, visit_number, first_seen, site_id
      FROM journeys
      ORDER BY first_seen DESC
      LIMIT 15
    `);

    res.json({
      events: parseInt(eventCount.rows[0].count),
      journeys: parseInt(journeyCount.rows[0].count),
      recentEvents: recentEvents.rows,
      ipsWithMultipleJourneys: ipJourneys.rows,
      recentJourneysWithVisitNumber: visitNumbers.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ROUTES
// ============================================

// Auth Routes (public - with rate limiting)
app.use('/', authLimiter, authRouter);

// API Routes (public - tracking events with rate limiting)
app.use('/api/event', eventLimiter, eventsRouter);
app.use('/api/events', eventLimiter, eventsRouter);

// Web Routes (protected - require authentication)
app.use('/journeys', requireAuth, journeysRouter);
app.use('/families', requireAuth, familiesRouter);
app.use('/realtime', requireAuth, realtimeRouter);
app.use('/insights', requireAuth, insightsRouter);
app.use('/funnel', requireAuth, funnelRouter);
app.use('/bots', requireAuth, botsRouter);
app.use('/ux', requireAuth, uxRouter);
app.use('/admin', requireAuth, adminRouter);
app.use('/screenshots', requireAuth, screenshotsRouter);
app.use('/export', requireAuth, exportRouter);

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

// ============================================
// BACKGROUND JOBS
// ============================================

async function rebuildRecentJourneys() {
  try {
    const db = getDb();
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
        // Silently continue
      }
    }
  } catch (err) {
    console.error('Background journey rebuild failed:', err.message);
  }
}

// ============================================
// SERVER STARTUP
// ============================================

let server;

async function start() {
  try {
    await initializeSchema();

    server = app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║              SMART Journey Analytics v2.0             ║
║              Website Visitor Tracking                 ║
╠═══════════════════════════════════════════════════════╣
║  Dashboard:  http://localhost:${PORT}/journeys            ║
║  Funnel:     http://localhost:${PORT}/funnel              ║
║  Families:   http://localhost:${PORT}/families            ║
║  Real-time:  http://localhost:${PORT}/realtime            ║
║  UX:         http://localhost:${PORT}/ux                  ║
║  Insights:   http://localhost:${PORT}/insights            ║
║  Export:     http://localhost:${PORT}/export              ║
║  API:        http://localhost:${PORT}/api/event           ║
║  Pixel:      http://localhost:${PORT}/p.gif               ║
║  Health:     http://localhost:${PORT}/health              ║
╚═══════════════════════════════════════════════════════╝
      `);

      // Start background journey sync (every 30 seconds)
      setInterval(rebuildRecentJourneys, 30000);
      rebuildRecentJourneys();

      // Run pixel-only bot detection on startup and every 5 minutes
      if (botsRouter.runPixelOnlyBotDetection) {
        botsRouter.runPixelOnlyBotDetection();
        setInterval(() => botsRouter.runPixelOnlyBotDetection(), 5 * 60 * 1000);
      }

      // Scheduled AI analysis - runs daily at 6am
      if (process.env.ENABLE_SCHEDULED_ANALYSIS === 'true') {
        cron.schedule('0 6 * * *', async () => {
          console.log('[CRON] Running scheduled AI analysis...');
          try {
            const { runAnalysis } = require('./services/aiAnalysis');
            const db = getDb();
            const sitesResult = await db.query('SELECT id, name FROM sites');
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

            for (const site of sitesResult.rows) {
              try {
                await runAnalysis(startDate, endDate, site.id);
                console.log(`[CRON] Analysis complete for site: ${site.name}`);
              } catch (err) {
                console.error(`[CRON] Analysis failed for site ${site.name}:`, err.message);
              }
            }
          } catch (err) {
            console.error('[CRON] Scheduled analysis failed:', err.message);
          }
        });
        console.log('[CRON] Scheduled analysis enabled (daily at 6am)');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);

  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      closeDb().then(() => {
        console.log('Database connections closed');
        process.exit(0);
      }).catch(() => process.exit(1));
    });

    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

start();

module.exports = app;

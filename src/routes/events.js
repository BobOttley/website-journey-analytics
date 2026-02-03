const express = require('express');
const router = express.Router();

const { insertEvent, getEventsByJourneyId, getSiteByTrackingKey } = require('../db/queries');
const { getClientIP, lookupIP, isPrivateIP } = require('../services/geoService');
const emailService = require('../services/emailService');
const { detectBotForEvent } = require('../services/botDetection');

// Cache for tracking key -> site_id lookups (avoids DB hit on every event)
const trackingKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function resolveSiteId(trackingKey) {
  if (!trackingKey) return null;

  // Check cache
  const cached = trackingKeyCache.get(trackingKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.siteId;
  }

  // Look up in database
  const site = await getSiteByTrackingKey(trackingKey);
  const siteId = site ? site.id : null;

  // Cache the result
  trackingKeyCache.set(trackingKey, { siteId, timestamp: Date.now() });

  // Clean old cache entries periodically
  if (trackingKeyCache.size > 100) {
    const now = Date.now();
    for (const [key, value] of trackingKeyCache) {
      if (now - value.timestamp > CACHE_TTL) {
        trackingKeyCache.delete(key);
      }
    }
  }

  return siteId;
}

/**
 * Track which journeys we’ve already emailed about
 * (in-memory; resets on restart by design)
 */
const notifiedJourneys = new Set();

/**
 * VALID EVENT TYPES
 * Must match what the tracker ACTUALLY sends
 */
const VALID_EVENT_TYPES = [
  // Core
  'page_view',
  'page_exit',
  'heartbeat',

  // Engagement
  'scroll_depth',
  'section_view',
  'element_hover',
  'rage_click',
  'exit_intent',

  // Interactions
  'cta_click',
  'download_click',
  'external_link',
  'accordion_open',
  'tab_switch',
  'copy_text',

  // Forms
  'form_start',
  'form_field_focus',
  'form_field_blur',
  'form_abandon',
  'form_submit',

  // Media / technical
  'video_play',
  'video_pause',
  'video_complete',
  'page_load',
  'error'
];

/**
 * VALID INTENT TYPES
 * MUST include what the tracker emits
 */
const VALID_INTENT_TYPES = [
  'enquire',
  'prospectus',
  'book_visit',
  'apply',
  'contact',
  'demo',
  'calculate',
  'explore',
  'general',

  // Required for tracker compatibility
  'download',
  'external'
];

/**
 * Basic validation — permissive by design
 * We never reject useful data
 */
function validateEvent(body) {
  const errors = [];

  if (!body.journey_id || typeof body.journey_id !== 'string') {
    errors.push('journey_id is required');
  }

  if (!body.event_type || !VALID_EVENT_TYPES.includes(body.event_type)) {
    errors.push(`invalid event_type: ${body.event_type}`);
  }

  if (body.intent_type && !VALID_INTENT_TYPES.includes(body.intent_type)) {
    errors.push(`invalid intent_type: ${body.intent_type}`);
  }

  if (body.page_url && typeof body.page_url !== 'string') {
    errors.push('page_url must be a string');
  }

  return errors;
}

/**
 * Add geolocation data to metadata (page_view only)
 */
async function enrichWithLocation(req, metadata) {
  const ip = getClientIP(req);

  if (!ip || isPrivateIP(ip)) {
    return metadata;
  }

  try {
    const location = await lookupIP(ip);
    if (location) {
      return {
        ...metadata,
        location,
        ip_address: ip
      };
    }
  } catch (err) {
    console.error('Geo lookup failed:', err.message);
  }

  return metadata;
}

/**
 * POST /api/event
 * Capture a single event
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const errors = validateEvent(body);

    if (errors.length > 0) {
      console.warn('Event validation failed:', errors, body);
      return res.status(400).json({ success: false, errors });
    }

    let metadata = body.metadata || {};

    // Enrich location only for first page_view
    if (body.event_type === 'page_view') {
      metadata = await enrichWithLocation(req, metadata);
    }

    // Extract User-Agent from request headers or body
    const userAgent = body.user_agent || req.get('User-Agent') || null;

    // Extract client IP
    const clientIP = getClientIP(req);

    // Run bot detection
    const botDetection = detectBotForEvent({
      userAgent,
      ipAddress: clientIP,
      metadata
    });

    // Resolve site_id from tracking_key (if provided)
    const siteId = await resolveSiteId(body.tracking_key);

    const event = {
      journey_id: body.journey_id,
      visitor_id: body.visitor_id || null,
      event_type: body.event_type,
      page_url: body.page_url || null,
      referrer: body.referrer || null,
      intent_type: body.intent_type || null,
      cta_label: body.cta_label || null,
      device_type: body.device_type || null,
      metadata,
      occurred_at: body.occurred_at || new Date().toISOString(),
      // Bot detection fields
      user_agent: userAgent,
      ip_address: clientIP,
      is_bot: botDetection.isBot,
      bot_score: botDetection.botScore,
      bot_signals: botDetection.signals,
      // Multi-tenant field
      site_id: siteId
    };

    const result = await insertEvent(event);

    /**
     * Visitor email logic
     * Fire once per journey per server session (covers new AND returning visitors)
     */
    if (event.event_type === 'page_view' && !notifiedJourneys.has(event.journey_id)) {
      notifiedJourneys.add(event.journey_id);

      // Keep memory bounded
      if (notifiedJourneys.size > 5000) {
        Array.from(notifiedJourneys).slice(0, 2500)
          .forEach(id => notifiedJourneys.delete(id));
      }

      const location = metadata.location || null;
      const existing = await getEventsByJourneyId(event.journey_id);
      const isReturn = existing.length > 1;

      console.log(`[EMAIL] Sending for journey ${event.journey_id.substring(0,8)} (${isReturn ? 'returning' : 'new'})`);

      emailService.sendNewVisitorNotification({
        journey_id: event.journey_id,
        entry_page: event.page_url,
        referrer: event.referrer,
        device_type: event.device_type,
        first_seen: event.occurred_at,
        location,
        isReturn
      }).then(result => {
        console.log(`[EMAIL] Result:`, result);
      }).catch(err => {
        console.error('[EMAIL] Failed:', err.message);
      });
    }

    res.status(201).json({
      success: true,
      event_id: result?.lastInsertRowid || null
    });
  } catch (err) {
    console.error('Event insert failed:', err);
    res.status(500).json({
      success: false,
      error: 'Failed to store event'
    });
  }
});

/**
 * POST /api/events/batch
 * Capture multiple events safely
 */
router.post('/batch', async (req, res) => {
  try {
    if (!Array.isArray(req.body?.events)) {
      return res.status(400).json({
        success: false,
        error: 'events must be an array'
      });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < req.body.events.length; i++) {
      const e = req.body.events[i];
      const validationErrors = validateEvent(e);

      if (validationErrors.length > 0) {
        errors.push({ index: i, errors: validationErrors });
        continue;
      }

      let metadata = e.metadata || {};
      if (e.event_type === 'page_view') {
        metadata = await enrichWithLocation(req, metadata);
      }

      // Extract User-Agent and IP for batch events
      const userAgent = e.user_agent || req.get('User-Agent') || null;
      const clientIP = getClientIP(req);

      // Run bot detection
      const botDetection = detectBotForEvent({
        userAgent,
        ipAddress: clientIP,
        metadata
      });

      // Resolve site_id from tracking_key
      const siteId = await resolveSiteId(e.tracking_key);

      try {
        await insertEvent({
          journey_id: e.journey_id,
          visitor_id: e.visitor_id || null,
          event_type: e.event_type,
          page_url: e.page_url || null,
          referrer: e.referrer || null,
          intent_type: e.intent_type || null,
          cta_label: e.cta_label || null,
          device_type: e.device_type || null,
          metadata,
          occurred_at: e.occurred_at || new Date().toISOString(),
          user_agent: userAgent,
          ip_address: clientIP,
          is_bot: botDetection.isBot,
          bot_score: botDetection.botScore,
          bot_signals: botDetection.signals,
          site_id: siteId
        });

        results.push({ index: i, success: true });
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }

    res.json({
      success: errors.length === 0,
      inserted: results.length,
      errors
    });
  } catch (err) {
    console.error('Batch insert failed:', err);
    res.status(500).json({
      success: false,
      error: 'Batch insert failed'
    });
  }
});

module.exports = router;

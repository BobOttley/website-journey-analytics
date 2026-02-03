const express = require('express');
const router = express.Router();
const { insertEvent } = require('../db/queries');
const { getClientIP, lookupIP, isPrivateIP } = require('../services/geoService');

const VALID_EVENT_TYPES = [
  // Core events
  'page_view',
  'page_exit',
  'heartbeat',

  // Engagement
  'scroll_depth',
  'time_on_page',
  'section_view',
  'element_hover',
  'rage_click',
  'exit_intent',

  // Interactions
  'cta_click',
  'link_click',
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

  // Media
  'video_play',
  'video_pause',
  'video_complete',
  'image_view',

  // Technical
  'page_load',
  'error'
];

const VALID_INTENT_TYPES = [
  'enquire',
  'prospectus',
  'book_visit',
  'apply',
  'contact',
  'general',
  'demo',
  'calculate',
  'explore'
];

function validateEvent(body) {
  const errors = [];

  if (!body.journey_id || typeof body.journey_id !== 'string') {
    errors.push('journey_id is required and must be a string');
  }

  if (!body.event_type || !VALID_EVENT_TYPES.includes(body.event_type)) {
    errors.push(`event_type must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
  }

  if (body.intent_type && !VALID_INTENT_TYPES.includes(body.intent_type)) {
    errors.push(`intent_type must be one of: ${VALID_INTENT_TYPES.join(', ')}`);
  }

  if (body.page_url && typeof body.page_url !== 'string') {
    errors.push('page_url must be a string');
  }

  return errors;
}

/**
 * Add geolocation data to event metadata
 */
async function enrichWithLocation(req, metadata) {
  const ip = getClientIP(req);

  // Skip private IPs
  if (!ip || isPrivateIP(ip)) {
    return metadata;
  }

  try {
    const location = await lookupIP(ip);
    if (location) {
      return {
        ...metadata,
        location: {
          country: location.country,
          countryCode: location.countryCode,
          city: location.city,
          region: location.region,
          flag: location.flag
        },
        ip_address: ip
      };
    }
  } catch (error) {
    console.error('Failed to enrich with location:', error.message);
  }

  return metadata;
}

// POST /api/event - Capture a single event
router.post('/', async (req, res) => {
  console.log('EVENT RECEIVED:', JSON.stringify(req.body));
  console.log('Content-Type:', req.headers['content-type']);

  try {
    const errors = validateEvent(req.body);

    if (errors.length > 0) {
      console.log('VALIDATION ERRORS:', errors);
      return res.status(400).json({
        success: false,
        errors
      });
    }

    // Enrich metadata with location for page_view events
    let metadata = req.body.metadata || {};
    if (req.body.event_type === 'page_view') {
      metadata = await enrichWithLocation(req, metadata);
    }

    const event = {
      journey_id: req.body.journey_id,
      visitor_id: req.body.visitor_id,
      event_type: req.body.event_type,
      page_url: req.body.page_url,
      referrer: req.body.referrer,
      intent_type: req.body.intent_type,
      cta_label: req.body.cta_label,
      device_type: req.body.device_type,
      metadata: metadata,
      occurred_at: req.body.occurred_at || new Date().toISOString()
    };

    const result = await insertEvent(event);

    res.status(201).json({
      success: true,
      event_id: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Error inserting event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to store event'
    });
  }
});

// POST /api/events/batch - Capture multiple events
router.post('/batch', async (req, res) => {
  try {
    if (!Array.isArray(req.body.events)) {
      return res.status(400).json({
        success: false,
        error: 'events must be an array'
      });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < req.body.events.length; i++) {
      const eventData = req.body.events[i];
      const validationErrors = validateEvent(eventData);

      if (validationErrors.length > 0) {
        errors.push({ index: i, errors: validationErrors });
        continue;
      }

      try {
        // Enrich metadata with location for page_view events
        let metadata = eventData.metadata || {};
        if (eventData.event_type === 'page_view') {
          metadata = await enrichWithLocation(req, metadata);
        }

        const event = {
          journey_id: eventData.journey_id,
          visitor_id: eventData.visitor_id,
          event_type: eventData.event_type,
          page_url: eventData.page_url,
          referrer: eventData.referrer,
          intent_type: eventData.intent_type,
          cta_label: eventData.cta_label,
          device_type: eventData.device_type,
          metadata: metadata,
          occurred_at: eventData.occurred_at || new Date().toISOString()
        };

        const result = await insertEvent(event);
        results.push({ index: i, event_id: result.lastInsertRowid });
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }

    res.status(errors.length > 0 ? 207 : 201).json({
      success: errors.length === 0,
      inserted: results.length,
      results,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error in batch insert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process batch'
    });
  }
});

module.exports = router;

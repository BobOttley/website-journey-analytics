const { getEventsByJourneyId, getUniqueJourneyIds, upsertJourney } = require('../db/queries');

/**
 * Sort events chronologically - never trust upstream ordering
 */
function sortEventsByTime(events) {
  return [...events].sort((a, b) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
}

/**
 * Calculate engagement metrics for strength scoring
 */
function calculateEngagementMetrics(events) {
  const scrollEvents = events.filter(e => e.event_type === 'scroll_depth');
  const sectionViews = events.filter(e => e.event_type === 'section_view');
  const pageViews = events.filter(e => e.event_type === 'page_view');
  const heartbeats = events.filter(e => e.event_type === 'heartbeat');

  // Calculate max scroll depth
  const maxScroll = scrollEvents.reduce((max, e) => {
    const depth = e.event_data?.depth || 0;
    return depth > max ? depth : max;
  }, 0);

  // Calculate dwell time from heartbeats (each heartbeat ~30s)
  const dwellSeconds = heartbeats.length * 30;

  // Count unique pages viewed
  const uniquePages = new Set(pageViews.map(e => e.page_url)).size;

  return {
    maxScroll,
    dwellSeconds,
    uniquePages,
    sectionCount: sectionViews.length,
    totalEvents: events.length
  };
}

/**
 * Determine intent strength based on engagement quality
 */
function calculateIntentStrength(events, timeToAction) {
  const metrics = calculateEngagementMetrics(events);

  let score = 0;

  // Time engagement (rushed vs considered)
  if (timeToAction !== null) {
    if (timeToAction < 10) score -= 2;      // Too fast - likely accidental
    else if (timeToAction < 30) score += 0; // Quick but possible
    else if (timeToAction < 120) score += 2; // Good consideration
    else if (timeToAction < 300) score += 3; // Strong consideration
    else score += 1;                         // Very long - might be distracted
  }

  // Scroll depth
  if (metrics.maxScroll >= 75) score += 2;
  else if (metrics.maxScroll >= 50) score += 1;

  // Content consumption
  if (metrics.sectionCount >= 3) score += 2;
  else if (metrics.sectionCount >= 1) score += 1;

  // Dwell time
  if (metrics.dwellSeconds >= 180) score += 2;
  else if (metrics.dwellSeconds >= 60) score += 1;

  // Multiple pages viewed
  if (metrics.uniquePages >= 4) score += 2;
  else if (metrics.uniquePages >= 2) score += 1;

  // Multiple meaningful events
  if (metrics.totalEvents >= 15) score += 1;

  // Convert score to strength
  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/**
 * Determine form abandonment type based on field interaction
 */
function classifyFormAbandonment(events) {
  const formStarts = events.filter(e => e.event_type === 'form_start');
  const fieldInteractions = events.filter(e =>
    e.event_type === 'form_field_focus' ||
    e.event_type === 'form_field_complete' ||
    e.event_type === 'form_field_change'
  );

  if (formStarts.length === 0) return null;

  const fieldCount = fieldInteractions.length;
  const uniqueFields = new Set(fieldInteractions.map(e => e.event_data?.field_name)).size;

  // Check for near-complete (many fields filled)
  if (uniqueFields >= 5 || fieldCount >= 8) {
    return 'form_near_complete_abandon';
  }

  // Mid abandon (some engagement)
  if (uniqueFields >= 2 || fieldCount >= 3) {
    return 'form_mid_abandon';
  }

  // Early abandon (clicked into form but didn't engage)
  return 'form_early_abandon';
}

/**
 * Detect friction signals in a journey
 */
function detectFriction(events, loops) {
  const signals = [];

  // Rage clicks
  const rageClicks = events.filter(e => e.event_type === 'rage_click');
  if (rageClicks.length > 0) {
    signals.push({ type: 'rage_clicks', count: rageClicks.length });
  }

  // Exit intent
  const exitIntents = events.filter(e => e.event_type === 'exit_intent');
  if (exitIntents.length > 0) {
    signals.push({ type: 'exit_intent', count: exitIntents.length });
  }

  // Confusion loops (A→B→A pattern)
  const confusionLoops = detectConfusionPatterns(events);
  if (confusionLoops.length > 0) {
    signals.push({ type: 'confusion_loops', patterns: confusionLoops });
  }

  // Simple page revisits
  if (loops.length > 0) {
    signals.push({ type: 'page_revisits', count: loops.length });
  }

  // Rapid page changes (bouncing around)
  const rapidChanges = detectRapidPageChanges(events);
  if (rapidChanges > 2) {
    signals.push({ type: 'rapid_navigation', count: rapidChanges });
  }

  return {
    detected: signals.length >= 2 || rageClicks.length > 0,
    signals,
    severity: signals.length >= 3 ? 'high' : signals.length >= 2 ? 'medium' : 'low'
  };
}

/**
 * Detect A→B→A confusion patterns
 */
function detectConfusionPatterns(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
  const patterns = [];

  for (let i = 0; i < pageViews.length - 2; i++) {
    const pageA = pageViews[i].page_url;
    const pageB = pageViews[i + 1].page_url;
    const pageC = pageViews[i + 2].page_url;

    // A→B→A pattern
    if (pageA === pageC && pageA !== pageB) {
      patterns.push({
        type: 'back_and_forth',
        pages: [pageA, pageB]
      });
    }
  }

  // Deduplicate patterns
  const unique = [];
  const seen = new Set();
  for (const p of patterns) {
    const key = p.pages.sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique;
}

/**
 * Detect rapid page changes (< 5 seconds between pages)
 */
function detectRapidPageChanges(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
  let rapidCount = 0;

  for (let i = 1; i < pageViews.length; i++) {
    const prev = new Date(pageViews[i - 1].occurred_at).getTime();
    const curr = new Date(pageViews[i].occurred_at).getTime();
    const diffSeconds = (curr - prev) / 1000;

    if (diffSeconds < 5) {
      rapidCount++;
    }
  }

  return rapidCount;
}

/**
 * Determine outcome with strength - evaluates LATEST meaningful action
 */
function determineOutcome(events) {
  // Sort to ensure chronological order
  const sorted = sortEventsByTime(events);

  // Check for form submissions first (highest value) - use LAST submission
  const formSubmits = sorted.filter(e => e.event_type === 'form_submit');

  if (formSubmits.length > 0) {
    const lastSubmit = formSubmits[formSubmits.length - 1];
    if (lastSubmit.intent_type === 'book_visit') {
      return { outcome: 'visit_booked', raw_outcome: 'visit_booked' };
    }
    if (lastSubmit.intent_type === 'enquire' || lastSubmit.intent_type === 'apply') {
      return { outcome: 'enquiry_submitted', raw_outcome: 'enquiry_submitted' };
    }
    // Generic form submit
    return { outcome: 'enquiry_submitted', raw_outcome: 'form_submitted' };
  }

  // Check for form abandonment (started but didn't complete)
  const formStarts = sorted.filter(e => e.event_type === 'form_start');
  if (formStarts.length > 0) {
    const abandonType = classifyFormAbandonment(sorted);
    return { outcome: abandonType, raw_outcome: 'form_abandoned' };
  }

  // Check for CTA clicks - use LAST meaningful click
  const ctaClicks = sorted.filter(e => e.event_type === 'cta_click');
  const meaningfulClicks = ctaClicks.filter(c =>
    c.intent_type === 'book_visit' ||
    c.intent_type === 'enquire' ||
    c.intent_type === 'apply' ||
    c.intent_type === 'download_prospectus'
  );

  if (meaningfulClicks.length > 0) {
    const lastClick = meaningfulClicks[meaningfulClicks.length - 1];
    return {
      outcome: 'engaged',
      raw_outcome: 'cta_clicked',
      intent_type: lastClick.intent_type
    };
  }

  // Check for any CTA clicks at all
  if (ctaClicks.length > 0) {
    return { outcome: 'engaged', raw_outcome: 'cta_clicked_low_intent' };
  }

  return { outcome: 'no_action', raw_outcome: 'no_action' };
}

function buildPageSequence(events) {
  const sorted = sortEventsByTime(events);
  const pageViews = sorted.filter(e => e.event_type === 'page_view');
  return pageViews.map(e => ({
    url: e.page_url,
    timestamp: e.occurred_at
  }));
}

function detectLoops(pageSequence) {
  const urlCounts = {};
  const loops = [];

  for (const page of pageSequence) {
    const url = page.url;
    urlCounts[url] = (urlCounts[url] || 0) + 1;

    if (urlCounts[url] === 2) { // Only add once when it becomes a loop
      loops.push({
        url,
        visits: urlCounts[url]
      });
    } else if (urlCounts[url] > 2) {
      // Update existing loop count
      const existing = loops.find(l => l.url === url);
      if (existing) existing.visits = urlCounts[url];
    }
  }

  return loops;
}

function calculateTimeToAction(events) {
  const sorted = sortEventsByTime(events);
  if (sorted.length < 2) return null;

  const firstEvent = sorted[0];
  const actionEvents = sorted.filter(e =>
    e.event_type === 'cta_click' ||
    e.event_type === 'form_start' ||
    e.event_type === 'form_submit'
  );

  if (actionEvents.length === 0) return null;

  const firstAction = actionEvents[0];
  const firstTime = new Date(firstEvent.occurred_at).getTime();
  const actionTime = new Date(firstAction.occurred_at).getTime();

  return Math.round((actionTime - firstTime) / 1000); // seconds
}

/**
 * Calculate journey confidence score (0-100)
 * Higher = more data, more reliable classification
 */
function calculateConfidence(events, metrics) {
  let score = 0;

  // Event count (more events = more data)
  if (events.length >= 20) score += 25;
  else if (events.length >= 10) score += 20;
  else if (events.length >= 5) score += 15;
  else score += 5;

  // Dwell time
  if (metrics.dwellSeconds >= 180) score += 25;
  else if (metrics.dwellSeconds >= 60) score += 15;
  else if (metrics.dwellSeconds >= 30) score += 10;
  else score += 5;

  // Scroll depth reached
  if (metrics.maxScroll >= 75) score += 20;
  else if (metrics.maxScroll >= 50) score += 15;
  else if (metrics.maxScroll >= 25) score += 10;
  else score += 5;

  // Multiple pages viewed
  if (metrics.uniquePages >= 4) score += 15;
  else if (metrics.uniquePages >= 2) score += 10;
  else score += 5;

  // Meaningful interactions
  if (metrics.sectionCount >= 2) score += 15;
  else if (metrics.sectionCount >= 1) score += 10;
  else score += 5;

  return Math.min(100, score);
}

function determineInitialIntent(events) {
  const sorted = sortEventsByTime(events);
  const firstPageView = sorted.find(e => e.event_type === 'page_view');
  if (!firstPageView) return null;

  const url = firstPageView.page_url?.toLowerCase() || '';

  // URL-based intent (use as weak signal)
  let urlIntent = null;
  if (url.includes('admissions') || url.includes('apply')) urlIntent = 'admissions';
  else if (url.includes('visit') || url.includes('open-day')) urlIntent = 'visit';
  else if (url.includes('prospectus')) urlIntent = 'prospectus';
  else if (url.includes('contact') || url.includes('enquire')) urlIntent = 'enquire';

  // Check early CTA clicks (stronger signal)
  const earlyEvents = sorted.slice(0, Math.min(5, sorted.length));
  const earlyCtaClick = earlyEvents.find(e => e.event_type === 'cta_click');
  if (earlyCtaClick?.intent_type) {
    return earlyCtaClick.intent_type;
  }

  return urlIntent || 'browsing';
}

async function reconstructJourney(journeyId) {
  const rawEvents = await getEventsByJourneyId(journeyId);

  if (rawEvents.length === 0) {
    return null;
  }

  // ALWAYS sort events - never trust upstream ordering
  const events = sortEventsByTime(rawEvents);

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const pageSequence = buildPageSequence(events);
  const loops = detectLoops(pageSequence);
  const timeToAction = calculateTimeToAction(events);
  const metrics = calculateEngagementMetrics(events);

  // Get outcome with detailed classification
  const outcomeResult = determineOutcome(events);

  // Calculate strength based on engagement quality
  const strength = calculateIntentStrength(events, timeToAction);

  // Detect friction
  const friction = detectFriction(events, loops);

  // Calculate confidence score
  const confidence = calculateConfidence(events, metrics);

  const journey = {
    journey_id: journeyId,
    first_seen: firstEvent.occurred_at,
    last_seen: lastEvent.occurred_at,
    entry_page: pageSequence[0]?.url || null,
    entry_referrer: firstEvent.referrer,
    initial_intent: determineInitialIntent(events),
    page_sequence: pageSequence,
    event_count: events.length,
    outcome: outcomeResult.outcome,
    outcome_detail: {
      raw: outcomeResult.raw_outcome,
      intent_type: outcomeResult.intent_type || null,
      strength: strength
    },
    time_to_action: timeToAction,
    loops: loops,
    friction: friction,
    confidence: confidence,
    engagement_metrics: metrics
  };

  return journey;
}

async function reconstructAllJourneys() {
  const journeyIds = await getUniqueJourneyIds();
  const results = {
    processed: 0,
    updated: 0,
    errors: []
  };

  for (const journeyId of journeyIds) {
    try {
      const journey = await reconstructJourney(journeyId);
      if (journey) {
        await upsertJourney(journey);
        results.updated++;
      }
      results.processed++;
    } catch (error) {
      results.errors.push({ journeyId, error: error.message });
    }
  }

  return results;
}

async function getJourneyWithEvents(journeyId) {
  const rawEvents = await getEventsByJourneyId(journeyId);
  const events = sortEventsByTime(rawEvents);
  const journey = await reconstructJourney(journeyId);

  if (!journey) return null;

  return {
    ...journey,
    events
  };
}

module.exports = {
  reconstructJourney,
  reconstructAllJourneys,
  getJourneyWithEvents,
  determineOutcome,
  buildPageSequence,
  detectLoops,
  calculateTimeToAction,
  calculateIntentStrength,
  detectFriction,
  calculateConfidence,
  calculateEngagementMetrics
};

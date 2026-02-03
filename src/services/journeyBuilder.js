const { getEventsByJourneyId, getUniqueJourneyIds, upsertJourney } = require('../db/queries');

/**
 * Sort events chronologically - never trust upstream ordering.
 */
function sortEventsByTime(events) {
  return [...events].sort((a, b) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );
}

/**
 * Build ordered page sequence.
 */
function buildPageSequence(events) {
  const sorted = sortEventsByTime(events);
  const pageViews = sorted.filter(e => e.event_type === 'page_view');
  return pageViews.map(e => ({
    url: e.page_url,
    timestamp: e.occurred_at
  }));
}

/**
 * Simple revisit loops (same URL visited multiple times).
 */
function detectLoops(pageSequence) {
  const urlCounts = {};
  const loops = [];

  for (const page of pageSequence) {
    const url = page.url;
    urlCounts[url] = (urlCounts[url] || 0) + 1;

    if (urlCounts[url] === 2) {
      loops.push({ url, visits: 2 });
    } else if (urlCounts[url] > 2) {
      const existing = loops.find(l => l.url === url);
      if (existing) existing.visits = urlCounts[url];
    }
  }

  return loops;
}

/**
 * Time to first meaningful action from first event.
 */
function calculateTimeToAction(events) {
  const sorted = sortEventsByTime(events);
  if (sorted.length < 2) return null;

  const firstEvent = sorted[0];
  const actionEvents = sorted.filter(e =>
    e.event_type === 'cta_click' ||
    e.event_type === 'download_click' ||
    e.event_type === 'external_link' ||
    e.event_type === 'form_start' ||
    e.event_type === 'form_submit'
  );

  if (actionEvents.length === 0) return null;

  const firstAction = actionEvents[0];
  const firstTime = new Date(firstEvent.occurred_at).getTime();
  const actionTime = new Date(firstAction.occurred_at).getTime();

  return Math.round((actionTime - firstTime) / 1000);
}

/**
 * Extract a numeric scroll depth from scroll_depth events.
 * Tracker sends this in metadata.depth (percentage).
 */
function getMaxScrollDepth(events) {
  const scrollEvents = events.filter(e => e.event_type === 'scroll_depth');
  return scrollEvents.reduce((max, e) => {
    const depth = Number(e.metadata?.depth ?? 0);
    return depth > max ? depth : max;
  }, 0);
}

/**
 * Estimate dwell time.
 * Tracker sends heartbeat periodically; treat each as ~30s.
 */
function getDwellSeconds(events) {
  const heartbeats = events.filter(e => e.event_type === 'heartbeat');
  return heartbeats.length * 30;
}

/**
 * Count unique pages viewed.
 */
function getUniquePages(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
  return new Set(pageViews.map(e => e.page_url).filter(Boolean)).size;
}

/**
 * Engagement metrics used for strength/confidence scoring.
 */
function calculateEngagementMetrics(events) {
  const sorted = sortEventsByTime(events);

  const sectionViews = sorted.filter(e => e.event_type === 'section_view');
  const maxScroll = getMaxScrollDepth(sorted);
  const dwellSeconds = getDwellSeconds(sorted);
  const uniquePages = getUniquePages(sorted);

  return {
    maxScroll,
    dwellSeconds,
    uniquePages,
    sectionCount: sectionViews.length,
    totalEvents: sorted.length
  };
}

/**
 * Intent strength scoring.
 * Returns: 'low' | 'medium' | 'high'
 */
function calculateIntentStrength(events, timeToAction) {
  const metrics = calculateEngagementMetrics(events);

  let score = 0;

  // Time to action: penalise "too fast"
  if (timeToAction !== null) {
    if (timeToAction < 10) score -= 2;
    else if (timeToAction < 30) score += 0;
    else if (timeToAction < 120) score += 2;
    else if (timeToAction < 300) score += 3;
    else score += 1;
  }

  // Scroll depth
  if (metrics.maxScroll >= 75) score += 2;
  else if (metrics.maxScroll >= 50) score += 1;

  // Section views
  if (metrics.sectionCount >= 3) score += 2;
  else if (metrics.sectionCount >= 1) score += 1;

  // Dwell time
  if (metrics.dwellSeconds >= 180) score += 2;
  else if (metrics.dwellSeconds >= 60) score += 1;

  // Pages
  if (metrics.uniquePages >= 4) score += 2;
  else if (metrics.uniquePages >= 2) score += 1;

  // Volume
  if (metrics.totalEvents >= 15) score += 1;

  if (score >= 7) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

/**
 * Determine form abandonment type using REAL tracker events:
 * - form_field_blur metadata: { field_name, completed }
 * - form_abandon metadata: { fields_completed, last_field }
 * - form_submit metadata: { fields_completed, total_fields }
 */
function classifyFormAbandonment(events) {
  const sorted = sortEventsByTime(events);

  const starts = sorted.filter(e => e.event_type === 'form_start');
  if (starts.length === 0) return null;

  // If we have a submit, it's not abandonment.
  if (sorted.some(e => e.event_type === 'form_submit')) return null;

  // Prefer explicit form_abandon event if present
  const abandonEvents = sorted.filter(e => e.event_type === 'form_abandon');
  if (abandonEvents.length > 0) {
    const last = abandonEvents[abandonEvents.length - 1];
    const completed = Number(last.metadata?.fields_completed ?? 0);

    if (completed >= 5) return 'form_near_complete_abandon';
    if (completed >= 2) return 'form_mid_abandon';
    return 'form_early_abandon';
  }

  // Otherwise infer from blur events
  const blurs = sorted.filter(e => e.event_type === 'form_field_blur');

  const completedFields = new Set();
  const touchedFields = new Set();

  for (const e of blurs) {
    const field = e.metadata?.field_name;
    if (!field) continue;
    touchedFields.add(field);
    if (e.metadata?.completed === true) completedFields.add(field);
  }

  const completedCount = completedFields.size;
  const touchedCount = touchedFields.size;

  // Near complete: many unique fields interacted with or completed
  if (completedCount >= 5 || touchedCount >= 8) return 'form_near_complete_abandon';
  if (completedCount >= 2 || touchedCount >= 3) return 'form_mid_abandon';
  return 'form_early_abandon';
}

/**
 * Detect A→B→A confusion patterns from page views.
 */
function detectConfusionPatterns(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
  const patterns = [];

  for (let i = 0; i < pageViews.length - 2; i++) {
    const a = pageViews[i].page_url;
    const b = pageViews[i + 1].page_url;
    const c = pageViews[i + 2].page_url;

    if (a && b && c && a === c && a !== b) {
      patterns.push({ type: 'back_and_forth', pages: [a, b] });
    }
  }

  // Deduplicate
  const seen = new Set();
  const unique = [];
  for (const p of patterns) {
    const key = [...p.pages].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  return unique;
}

/**
 * Detect rapid navigation (<5 seconds between page views).
 */
function detectRapidPageChanges(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
  let rapidCount = 0;

  for (let i = 1; i < pageViews.length; i++) {
    const prev = new Date(pageViews[i - 1].occurred_at).getTime();
    const curr = new Date(pageViews[i].occurred_at).getTime();
    const diff = (curr - prev) / 1000;
    if (diff < 5) rapidCount++;
  }

  return rapidCount;
}

/**
 * Friction model.
 */
function detectFriction(events, loops) {
  const sorted = sortEventsByTime(events);
  const signals = [];

  const rageClicks = sorted.filter(e => e.event_type === 'rage_click');
  if (rageClicks.length > 0) signals.push({ type: 'rage_clicks', count: rageClicks.length });

  const exitIntents = sorted.filter(e => e.event_type === 'exit_intent');
  if (exitIntents.length > 0) signals.push({ type: 'exit_intent', count: exitIntents.length });

  const confusion = detectConfusionPatterns(sorted);
  if (confusion.length > 0) signals.push({ type: 'confusion_loops', patterns: confusion });

  if (loops.length > 0) signals.push({ type: 'page_revisits', count: loops.length });

  const rapid = detectRapidPageChanges(sorted);
  if (rapid > 2) signals.push({ type: 'rapid_navigation', count: rapid });

  return {
    detected: signals.length >= 2 || rageClicks.length > 0,
    signals,
    severity: signals.length >= 3 ? 'high' : signals.length >= 2 ? 'medium' : 'low'
  };
}

/**
 * Confidence score (0-100): how reliable the classification is.
 */
function calculateConfidence(events, metrics) {
  let score = 0;

  // Event count
  if (events.length >= 20) score += 25;
  else if (events.length >= 10) score += 20;
  else if (events.length >= 5) score += 15;
  else score += 5;

  // Dwell time
  if (metrics.dwellSeconds >= 180) score += 25;
  else if (metrics.dwellSeconds >= 60) score += 15;
  else if (metrics.dwellSeconds >= 30) score += 10;
  else score += 5;

  // Scroll depth
  if (metrics.maxScroll >= 75) score += 20;
  else if (metrics.maxScroll >= 50) score += 15;
  else if (metrics.maxScroll >= 25) score += 10;
  else score += 5;

  // Multiple pages
  if (metrics.uniquePages >= 4) score += 15;
  else if (metrics.uniquePages >= 2) score += 10;
  else score += 5;

  // Section views
  if (metrics.sectionCount >= 2) score += 15;
  else if (metrics.sectionCount >= 1) score += 10;
  else score += 5;

  return Math.min(100, score);
}

/**
 * Determine initial intent.
 * Uses early CTA as strong signal, URL as weak fallback.
 */
function determineInitialIntent(events) {
  const sorted = sortEventsByTime(events);
  const firstPageView = sorted.find(e => e.event_type === 'page_view');
  if (!firstPageView) return null;

  const url = (firstPageView.page_url || '').toLowerCase();

  // Weak URL signal
  let urlIntent = null;
  if (url.includes('admissions') || url.includes('apply')) urlIntent = 'admissions';
  else if (url.includes('visit') || url.includes('open-day')) urlIntent = 'visit';
  else if (url.includes('prospectus')) urlIntent = 'prospectus';
  else if (url.includes('contact') || url.includes('enquire')) urlIntent = 'enquire';

  // Stronger early CTA signal
  const early = sorted.slice(0, Math.min(5, sorted.length));
  const earlyClick = early.find(e =>
    e.event_type === 'cta_click' ||
    e.event_type === 'download_click' ||
    e.event_type === 'external_link'
  );

  if (earlyClick?.intent_type) return earlyClick.intent_type;

  return urlIntent || 'browsing';
}

/**
 * Determine outcome using the LATEST meaningful action.
 * Returns object with outcome + details for dashboards/AI.
 */
function determineOutcome(events) {
  const sorted = sortEventsByTime(events);

  // 1) Form submit (highest value)
  const submits = sorted.filter(e => e.event_type === 'form_submit');
  if (submits.length > 0) {
    const last = submits[submits.length - 1];
    if (last.intent_type === 'book_visit') {
      return { outcome: 'visit_booked', raw_outcome: 'visit_booked', intent_type: last.intent_type };
    }
    if (last.intent_type === 'enquire' || last.intent_type === 'apply') {
      return { outcome: 'enquiry_submitted', raw_outcome: 'enquiry_submitted', intent_type: last.intent_type };
    }
    return { outcome: 'enquiry_submitted', raw_outcome: 'form_submitted', intent_type: last.intent_type || null };
  }

  // 2) Form started but not submitted => abandonment classification
  const starts = sorted.filter(e => e.event_type === 'form_start');
  if (starts.length > 0) {
    const abandonType = classifyFormAbandonment(sorted) || 'form_early_abandon';
    return { outcome: abandonType, raw_outcome: 'form_abandoned', intent_type: null };
  }

  // 3) Meaningful clicks (CTA / download / external)
  const clickEvents = sorted.filter(e =>
    e.event_type === 'cta_click' ||
    e.event_type === 'download_click' ||
    e.event_type === 'external_link'
  );

  const meaningful = clickEvents.filter(e => {
    const it = e.intent_type;
    return it === 'book_visit' || it === 'enquire' || it === 'apply' || it === 'prospectus' || it === 'demo' || it === 'contact' || it === 'calculate' || it === 'download' || it === 'external';
  });

  if (meaningful.length > 0) {
    const last = meaningful[meaningful.length - 1];
    return { outcome: 'engaged', raw_outcome: 'click_high_intent', intent_type: last.intent_type || null };
  }

  if (clickEvents.length > 0) {
    const last = clickEvents[clickEvents.length - 1];
    return { outcome: 'engaged', raw_outcome: 'click_low_intent', intent_type: last.intent_type || null };
  }

  return { outcome: 'no_action', raw_outcome: 'no_action', intent_type: null };
}

async function reconstructJourney(journeyId) {
  const rawEvents = await getEventsByJourneyId(journeyId);
  if (!rawEvents || rawEvents.length === 0) return null;

  const events = sortEventsByTime(rawEvents);

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  const pageSequence = buildPageSequence(events);
  const loops = detectLoops(pageSequence);
  const timeToAction = calculateTimeToAction(events);
  const metrics = calculateEngagementMetrics(events);

  const outcomeResult = determineOutcome(events);
  const strength = calculateIntentStrength(events, timeToAction);
  const friction = detectFriction(events, loops);
  const confidence = calculateConfidence(events, metrics);

  return {
    journey_id: journeyId,
    visitor_id: firstEvent.visitor_id || null,
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
      strength
    },
    time_to_action: timeToAction,
    loops,
    friction,
    confidence,
    engagement_metrics: metrics
  };
}

async function reconstructAllJourneys() {
  const journeyIds = await getUniqueJourneyIds();
  const results = { processed: 0, updated: 0, errors: [] };

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
  const events = sortEventsByTime(rawEvents || []);
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

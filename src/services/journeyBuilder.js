const { getEventsByJourneyId, getUniqueJourneyIds, upsertJourney } = require('../db/queries');

function determineOutcome(events) {
  // Check for form submissions first (highest value)
  const formSubmits = events.filter(e => e.event_type === 'form_submit');

  for (const submit of formSubmits) {
    if (submit.intent_type === 'book_visit') {
      return 'visit_booked';
    }
    if (submit.intent_type === 'enquire' || submit.intent_type === 'apply') {
      return 'enquiry_submitted';
    }
  }

  // Check for any high-intent CTA clicks
  const ctaClicks = events.filter(e => e.event_type === 'cta_click');
  for (const click of ctaClicks) {
    if (click.intent_type === 'book_visit' || click.intent_type === 'enquire') {
      return 'engaged';
    }
  }

  // Check for form starts without completion
  const formStarts = events.filter(e => e.event_type === 'form_start');
  if (formStarts.length > 0) {
    return 'form_abandoned';
  }

  return 'no_action';
}

function buildPageSequence(events) {
  const pageViews = events.filter(e => e.event_type === 'page_view');
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

    if (urlCounts[url] > 1) {
      loops.push({
        url,
        visits: urlCounts[url]
      });
    }
  }

  return loops;
}

function calculateTimeToAction(events) {
  if (events.length < 2) return null;

  const firstEvent = events[0];
  const actionEvents = events.filter(e =>
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

function determineInitialIntent(events) {
  // Look at entry page and early CTA clicks
  const firstPageView = events.find(e => e.event_type === 'page_view');
  if (!firstPageView) return null;

  const url = firstPageView.page_url?.toLowerCase() || '';

  if (url.includes('admissions') || url.includes('apply')) return 'admissions';
  if (url.includes('visit') || url.includes('open-day')) return 'visit';
  if (url.includes('prospectus')) return 'prospectus';
  if (url.includes('contact') || url.includes('enquire')) return 'enquire';

  // Check early CTA clicks
  const earlyCtaClick = events.find(e => e.event_type === 'cta_click');
  if (earlyCtaClick?.intent_type) return earlyCtaClick.intent_type;

  return 'browsing';
}

async function reconstructJourney(journeyId) {
  const events = await getEventsByJourneyId(journeyId);

  if (events.length === 0) {
    return null;
  }

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const pageSequence = buildPageSequence(events);

  const journey = {
    journey_id: journeyId,
    first_seen: firstEvent.occurred_at,
    last_seen: lastEvent.occurred_at,
    entry_page: pageSequence[0]?.url || null,
    entry_referrer: firstEvent.referrer,
    initial_intent: determineInitialIntent(events),
    page_sequence: pageSequence,
    event_count: events.length,
    outcome: determineOutcome(events),
    time_to_action: calculateTimeToAction(events),
    loops: detectLoops(pageSequence)
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
  const events = await getEventsByJourneyId(journeyId);
  const journey = await reconstructJourney(journeyId);

  if (!journey) return null;

  return {
    ...journey,
    events,
    loops: detectLoops(journey.page_sequence)
  };
}

module.exports = {
  reconstructJourney,
  reconstructAllJourneys,
  getJourneyWithEvents,
  determineOutcome,
  buildPageSequence,
  detectLoops,
  calculateTimeToAction
};

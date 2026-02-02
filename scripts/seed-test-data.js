/**
 * Seed test data for development/testing
 * Run with: node scripts/seed-test-data.js
 */

require('dotenv').config();
const { initializeSchema, getDb } = require('../src/db/database');
const { insertEvent } = require('../src/db/queries');
const { reconstructAllJourneys } = require('../src/services/journeyBuilder');

// Initialize database
initializeSchema();

// Generate UUIDs
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Sample pages
const pages = [
  'https://www.morehouseschool.co.uk/',
  'https://www.morehouseschool.co.uk/about',
  'https://www.morehouseschool.co.uk/admissions',
  'https://www.morehouseschool.co.uk/admissions/fees',
  'https://www.morehouseschool.co.uk/academics',
  'https://www.morehouseschool.co.uk/sixth-form',
  'https://www.morehouseschool.co.uk/visit-us',
  'https://www.morehouseschool.co.uk/prospectus',
  'https://www.morehouseschool.co.uk/contact',
  'https://www.morehouseschool.co.uk/boarding'
];

const referrers = [
  'https://www.google.com',
  'https://www.google.co.uk',
  'https://www.bing.com',
  'https://www.facebook.com',
  '',
  null
];

const deviceTypes = ['desktop', 'mobile', 'tablet'];

// Generate test journeys
const testJourneys = [
  // Journey 1: Successful enquiry
  {
    outcome: 'enquiry',
    events: [
      { event_type: 'page_view', page: 0, referrer: 0 },
      { event_type: 'page_view', page: 2 },
      { event_type: 'page_view', page: 3 },
      { event_type: 'cta_click', page: 8, intent: 'enquire', cta: 'Enquire Now' },
      { event_type: 'form_start', page: 8, intent: 'enquire' },
      { event_type: 'form_submit', page: 8, intent: 'enquire' }
    ]
  },
  // Journey 2: Visit booked
  {
    outcome: 'visit',
    events: [
      { event_type: 'page_view', page: 0, referrer: 1 },
      { event_type: 'page_view', page: 1 },
      { event_type: 'page_view', page: 6 },
      { event_type: 'cta_click', page: 6, intent: 'book_visit', cta: 'Book a Visit' },
      { event_type: 'form_start', page: 6, intent: 'book_visit' },
      { event_type: 'form_submit', page: 6, intent: 'book_visit' }
    ]
  },
  // Journey 3: Form abandoned
  {
    outcome: 'abandoned',
    events: [
      { event_type: 'page_view', page: 0, referrer: 3 },
      { event_type: 'page_view', page: 2 },
      { event_type: 'cta_click', page: 8, intent: 'enquire', cta: 'Enquire Now' },
      { event_type: 'form_start', page: 8, intent: 'enquire' }
      // No form_submit - abandoned
    ]
  },
  // Journey 4: Just browsing
  {
    outcome: 'browse',
    events: [
      { event_type: 'page_view', page: 0, referrer: 2 },
      { event_type: 'page_view', page: 4 },
      { event_type: 'page_view', page: 5 }
    ]
  },
  // Journey 5: Prospectus download
  {
    outcome: 'prospectus',
    events: [
      { event_type: 'page_view', page: 0, referrer: 4 },
      { event_type: 'page_view', page: 2 },
      { event_type: 'cta_click', page: 7, intent: 'prospectus', cta: 'Download Prospectus' }
    ]
  },
  // Journey 6: Loop behavior (confusion)
  {
    outcome: 'loop',
    events: [
      { event_type: 'page_view', page: 0, referrer: 0 },
      { event_type: 'page_view', page: 2 },
      { event_type: 'page_view', page: 3 },
      { event_type: 'page_view', page: 2 }, // Back to admissions
      { event_type: 'page_view', page: 4 },
      { event_type: 'page_view', page: 2 }, // Back again
      { event_type: 'page_view', page: 8 }
    ]
  },
  // Journey 7: Mobile quick enquiry
  {
    outcome: 'enquiry_mobile',
    device: 'mobile',
    events: [
      { event_type: 'page_view', page: 0, referrer: 3 },
      { event_type: 'cta_click', page: 8, intent: 'enquire', cta: 'Enquire' },
      { event_type: 'form_start', page: 8, intent: 'enquire' },
      { event_type: 'form_submit', page: 8, intent: 'enquire' }
    ]
  },
  // Journey 8: Deep research
  {
    outcome: 'research',
    events: [
      { event_type: 'page_view', page: 0, referrer: 0 },
      { event_type: 'page_view', page: 1 },
      { event_type: 'page_view', page: 4 },
      { event_type: 'page_view', page: 5 },
      { event_type: 'page_view', page: 9 },
      { event_type: 'page_view', page: 2 },
      { event_type: 'page_view', page: 3 },
      { event_type: 'page_view', page: 6 }
    ]
  }
];

// Seed the database
console.log('Seeding test data...\n');

let eventCount = 0;

for (let i = 0; i < 50; i++) {
  // Pick a random journey template
  const template = testJourneys[Math.floor(Math.random() * testJourneys.length)];
  const journeyId = uuid();
  const device = template.device || deviceTypes[Math.floor(Math.random() * deviceTypes.length)];

  // Start time: random time in the last 30 days
  let timestamp = new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000);

  template.events.forEach(event => {
    const eventData = {
      journey_id: journeyId,
      event_type: event.event_type,
      page_url: pages[event.page],
      referrer: event.referrer !== undefined ? referrers[event.referrer] : null,
      intent_type: event.intent || null,
      cta_label: event.cta || null,
      device_type: device,
      occurred_at: timestamp.toISOString()
    };

    insertEvent(eventData);
    eventCount++;

    // Advance time by 5-120 seconds
    timestamp = new Date(timestamp.getTime() + (5 + Math.random() * 115) * 1000);
  });
}

console.log(`Inserted ${eventCount} events across 50 journeys`);

// Reconstruct journeys
console.log('\nReconstructing journeys...');
const results = reconstructAllJourneys();
console.log(`Processed: ${results.processed}, Updated: ${results.updated}`);

if (results.errors.length > 0) {
  console.log('Errors:', results.errors);
}

console.log('\nTest data seeded successfully!');
console.log('Run `npm start` to view the dashboard at http://localhost:3000/journeys');

# More House School - Journey Analytics Integration Plan

## Overview

This document outlines how the Website Journey Analytics system will integrate with the More House School website and existing apps to provide deep visitor insights and automated lead scoring.

---

## The Vision

When a prospective parent visits morehouse.org.uk and eventually submits an enquiry, the admissions team will see:

```
┌─────────────────────────────────────────────────────────────────┐
│  INQUIRY CARD: Emma Smith (Year 7, 2026)                        │
├─────────────────────────────────────────────────────────────────┤
│  Journey Score: 87/100 (High Intent)                            │
│                                                                 │
│  PRE-ENQUIRY BEHAVIOUR:                                         │
│  • Visited 14 pages across 2 sessions (3 days apart)            │
│  • Spent 8 minutes on Fees page                                 │
│  • Viewed Scholarships page twice                               │
│  • Watched welcome video to 90%                                 │
│  • Hovered over "Book a Visit" 3 times before clicking          │
│                                                                 │
│  AI INSIGHT:                                                    │
│  "Price-sensitive but serious buyer. Spent significant time     │
│   researching financial options. Return visit indicates         │
│   genuine consideration. Recommend mentioning bursary           │
│   options early in conversation."                               │
│                                                                 │
│  RECOMMENDED APPROACH: High-touch, address affordability        │
└─────────────────────────────────────────────────────────────────┘
```

---

## System Architecture

```
                    ┌─────────────────────────────────────┐
                    │     morehouse.org.uk (School)       │
                    │                                     │
                    │  GTM Container with Tracking Script │
                    └──────────────┬──────────────────────┘
                                   │
                                   │ Events (page views, clicks,
                                   │ scroll, hovers, etc.)
                                   ▼
                    ┌─────────────────────────────────────┐
                    │   Website Journey Analytics         │
                    │   (website-journey-analytics.       │
                    │    onrender.com)                    │
                    │                                     │
                    │   - journey_events table            │
                    │   - journeys table                  │
                    │   - Real-time dashboard             │
                    └──────────────┬──────────────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
         ▼                         ▼                         ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Prospectus App  │    │  Booking App    │    │  Emily Chatbot  │
│ (Enquiry Form)  │    │ (Visit Booking) │    │                 │
│                 │    │                 │    │                 │
│ ?journey_id=xxx │    │ ?journey_id=xxx │    │ journey_id      │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         └──────────────────────┼──────────────────────┘
                                │
                                ▼
                    ┌─────────────────────────────────────┐
                    │         CRM Dashboard               │
                    │   (smart-crm-more-house.onrender)   │
                    │                                     │
                    │   - Inquiry cards with journey data │
                    │   - AI-generated insights           │
                    │   - Lead scoring                    │
                    └─────────────────────────────────────┘
```

---

## Data Flow

### Step 1: Visitor Arrives on morehouse.org.uk

The GTM tracking script captures:

| Event Type | What's Tracked |
|------------|----------------|
| `page_view` | Every page visited, timestamp, referrer |
| `scroll_depth` | How far they scroll (25%, 50%, 75%, 100%) |
| `section_visibility` | Which sections they actually read |
| `heartbeat` | Time spent on page (every 15 seconds) |
| `cta_click` | Buttons clicked (Book a Visit, Request Prospectus, etc.) |
| `cta_hover` | Buttons hovered over but NOT clicked (hesitation) |
| `dead_click` | Clicks on non-interactive elements (frustration) |
| `quick_back` | Left page within 5 seconds (wrong content) |
| `video_play/pause/complete` | Video engagement |
| `form_start/field/submit/abandon` | Form interactions |

Each visitor gets:
- `visitor_id` (persistent across sessions via localStorage)
- `journey_id` (unique per session)
- `visit_number` (tracks return visitors)

### Step 2: Visitor Clicks a Conversion Link

When they click "Request Prospectus", "Enquire Now", or "Book a Visit":

**Current URL:**
```
https://more-house-personalised-prospectus.onrender.com/?intent=prospectus
```

**New URL (with journey tracking):**
```
https://more-house-personalised-prospectus.onrender.com/?intent=prospectus&journey_id=wja_1770134723786_6b5bu2qpo&visitor_id=v_abc123
```

The tracking script automatically appends these parameters to all Render app links.

### Step 3: Inquiry Created with Journey Link

When the prospectus app creates an inquiry record, it stores:

```sql
INSERT INTO inquiries (
  id,
  parent_email,
  first_name,
  ...
  journey_id,        -- NEW: Links to journey_events
  visitor_id,        -- NEW: Links across sessions
  pre_enquiry_score  -- NEW: Calculated from journey
)
```

### Step 4: Journey Analysis Runs

When inquiry is created (or on-demand from CRM), the system:

1. Fetches all events for that `journey_id` from Journey Analytics
2. Also fetches any previous sessions for that `visitor_id`
3. Runs AI analysis on the complete behaviour pattern
4. Generates insights and recommendations
5. Calculates a lead score

### Step 5: CRM Shows Enriched Data

The inquiry card displays:
- Full journey timeline
- Key behaviour insights
- AI-generated recommendations
- Lead score with explanation

---

## Database Changes

### Journey Analytics Database (Neon)

Already exists with:
- `journey_events` - Raw event stream
- `journeys` - Reconstructed journey summaries
- `sites` - Multi-tenant site config (More House already configured)

### More House Database (Render PostgreSQL)

**New columns on `inquiries` table:**

```sql
ALTER TABLE inquiries ADD COLUMN journey_id VARCHAR(100);
ALTER TABLE inquiries ADD COLUMN visitor_id VARCHAR(100);
ALTER TABLE inquiries ADD COLUMN pre_enquiry_pages_viewed INTEGER;
ALTER TABLE inquiries ADD COLUMN pre_enquiry_time_on_site INTEGER; -- seconds
ALTER TABLE inquiries ADD COLUMN pre_enquiry_score INTEGER; -- 0-100
ALTER TABLE inquiries ADD COLUMN journey_analysis JSONB;
ALTER TABLE inquiries ADD COLUMN journey_analysed_at TIMESTAMP;

CREATE INDEX idx_inquiries_journey_id ON inquiries(journey_id);
CREATE INDEX idx_inquiries_visitor_id ON inquiries(visitor_id);
```

**New table for detailed journey data:**

```sql
CREATE TABLE inquiry_journey_events (
  id SERIAL PRIMARY KEY,
  inquiry_id VARCHAR(255) REFERENCES inquiries(id),
  event_type VARCHAR(50),
  page_url TEXT,
  event_data JSONB,
  occurred_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ije_inquiry_id ON inquiry_journey_events(inquiry_id);
```

---

## Implementation Steps

### Phase 1: GTM Tracking Script (When School Enables GTM)

**File:** `gtm/trackingScript.js`

**Changes:**
1. Configure for morehouse.org.uk domain
2. Add automatic journey_id appending to Render links:

```javascript
// Intercept clicks on Render app links
document.addEventListener('click', function(e) {
  const link = e.target.closest('a[href*="onrender.com"]');
  if (link) {
    const url = new URL(link.href);
    url.searchParams.set('journey_id', window.JOURNEY_ID);
    url.searchParams.set('visitor_id', window.VISITOR_ID);
    link.href = url.toString();
  }
});
```

3. Track specific More House CTAs:
   - "Request Prospectus" → intent: prospectus
   - "Enquire Now" → intent: enquiry
   - "Book a Visit" / "Book Now" → intent: book_visit
   - "Book Open Day" → intent: open_day

### Phase 2: Prospectus App Changes

**File:** `morehouse-prospectus-app/server.js`

**Changes to inquiry creation (POST /webhook):**

```javascript
// Extract journey data from query params
const journey_id = req.query.journey_id || req.body.journey_id;
const visitor_id = req.query.visitor_id || req.body.visitor_id;

// Store with inquiry
const record = {
  ...existingFields,
  journey_id,
  visitor_id
};

// After inquiry created, trigger journey analysis
if (journey_id) {
  fetchAndAnalyseJourney(record.id, journey_id, visitor_id);
}
```

### Phase 3: Journey Fetch API

**New endpoint in Journey Analytics app:**

```
GET /api/journey/:journey_id/export
```

Returns complete journey data for external systems:

```json
{
  "journey_id": "wja_xxx",
  "visitor_id": "v_xxx",
  "visit_number": 2,
  "first_seen": "2026-02-01T10:00:00Z",
  "last_seen": "2026-02-03T14:30:00Z",
  "entry_page": "/admissions/",
  "outcome": "engaged",
  "metrics": {
    "total_events": 47,
    "pages_viewed": 14,
    "unique_pages": 9,
    "time_on_site_seconds": 847,
    "max_scroll_depth": 100,
    "cta_clicks": 3,
    "cta_hovers": 5,
    "dead_clicks": 1,
    "form_interactions": 0
  },
  "page_sequence": [
    {"url": "/", "time_spent": 45},
    {"url": "/admissions/", "time_spent": 120},
    {"url": "/fees/", "time_spent": 480},
    ...
  ],
  "key_events": [
    {"type": "cta_hover", "label": "Book a Visit", "count": 3},
    {"type": "video_complete", "page": "/virtual-tour/"}
  ],
  "friction_signals": {
    "hesitations": ["Book a Visit button"],
    "dead_clicks": ["Fees table row"],
    "quick_backs": []
  }
}
```

### Phase 4: AI Analysis Integration

**New function in CRM app:**

```javascript
async function analyseInquiryJourney(inquiryId) {
  // 1. Get inquiry with journey_id
  const inquiry = await getInquiryById(inquiryId);

  // 2. Fetch journey data from Journey Analytics
  const journeyData = await fetch(
    `https://website-journey-analytics.onrender.com/api/journey/${inquiry.journey_id}/export`,
    { headers: { 'X-API-Key': process.env.JOURNEY_API_KEY } }
  ).then(r => r.json());

  // 3. Run AI analysis
  const analysis = await analyseWithClaude(journeyData, inquiry);

  // 4. Update inquiry with results
  await updateInquiry(inquiryId, {
    pre_enquiry_pages_viewed: journeyData.metrics.pages_viewed,
    pre_enquiry_time_on_site: journeyData.metrics.time_on_site_seconds,
    pre_enquiry_score: calculateScore(journeyData),
    journey_analysis: analysis,
    journey_analysed_at: new Date()
  });

  return analysis;
}
```

### Phase 5: CRM Display Updates

**File:** `morehouse-crm-app/public/smart-analytics.html` (inquiry card)

Add new section showing:
- Journey score with visual indicator
- Pages visited before enquiry
- Time spent on site
- Key behaviour highlights
- AI recommendations
- "View Full Journey" button linking to Journey Analytics

---

## Lead Scoring Algorithm

```javascript
function calculatePreEnquiryScore(journey) {
  let score = 0;

  // Time on site (max 25 points)
  // 5+ minutes = 25 pts, 2-5 min = 15 pts, <2 min = 5 pts
  const minutes = journey.metrics.time_on_site_seconds / 60;
  if (minutes >= 5) score += 25;
  else if (minutes >= 2) score += 15;
  else score += 5;

  // Pages viewed (max 20 points)
  // 10+ pages = 20 pts, 5-9 = 15 pts, 3-4 = 10 pts, <3 = 5 pts
  const pages = journey.metrics.unique_pages;
  if (pages >= 10) score += 20;
  else if (pages >= 5) score += 15;
  else if (pages >= 3) score += 10;
  else score += 5;

  // Return visitor bonus (15 points)
  if (journey.visit_number > 1) score += 15;

  // Key page visits (max 20 points)
  const keyPages = ['/fees/', '/admissions/', '/sixth-form/', '/scholarships/'];
  const visitedKeyPages = journey.page_sequence.filter(p =>
    keyPages.some(kp => p.url.includes(kp))
  );
  score += Math.min(visitedKeyPages.length * 5, 20);

  // Engagement signals (max 10 points)
  if (journey.metrics.max_scroll_depth >= 75) score += 5;
  if (journey.metrics.cta_clicks > 0) score += 5;

  // Friction penalties (max -10 points)
  if (journey.friction_signals.dead_clicks.length > 2) score -= 5;
  if (journey.friction_signals.quick_backs.length > 2) score -= 5;

  return Math.max(0, Math.min(100, score));
}
```

---

## AI Analysis Prompt

```
You are analysing a prospective parent's behaviour on a school website before they submitted an enquiry.

SCHOOL CONTEXT:
More House School is an independent Catholic girls' school in London for ages 11-18.

VISITOR JOURNEY DATA:
{journeyData}

INQUIRY DATA:
- Child: {firstName}, Age Group: {ageGroup}, Entry Year: {entryYear}
- Interests: {interests}
- Priorities: {priorities}

Analyse this visitor's pre-enquiry behaviour and provide:

1. **Intent Assessment** (1-2 sentences)
   How serious is this enquiry? What were they most interested in?

2. **Key Observations** (3-5 bullet points)
   Notable behaviour patterns from their website visit

3. **Concerns to Address** (if any)
   Things they may be worried about based on their browsing

4. **Recommended Approach** (2-3 sentences)
   How should the admissions team approach this family?

5. **Conversation Starters** (2-3 suggestions)
   Specific topics to raise based on their interests

Respond in JSON format.
```

---

## Security Considerations

1. **API Authentication**
   - Journey Analytics export endpoint requires API key
   - Key stored in CRM app environment variables

2. **Data Privacy**
   - Journey data is anonymous until linked to inquiry
   - Only shared internally between Bob's apps
   - No PII in journey_events (just behaviour)

3. **GDPR Compliance**
   - Tracking disclosed in school privacy policy
   - Data used only for improving admissions experience
   - Retained per existing data retention policy

---

## Testing Plan

1. **Manual Testing**
   - Visit morehouse.org.uk with GTM enabled
   - Browse multiple pages, hover over CTAs
   - Click "Request Prospectus"
   - Verify journey_id appears in URL
   - Submit enquiry form
   - Check CRM shows journey data

2. **Score Validation**
   - Create test journeys with known behaviour
   - Verify scores match expected ranges
   - Test edge cases (very short visits, bots, etc.)

3. **AI Analysis Review**
   - Review AI outputs for accuracy
   - Ensure recommendations are actionable
   - Check for any hallucinations

---

## Timeline

| Phase | Task | Status |
|-------|------|--------|
| 0 | School enables GTM on morehouse.org.uk | ⏳ Waiting |
| 1 | Configure tracking script for More House | Not started |
| 2 | Add journey_id to Render link clicks | Not started |
| 3 | Update prospectus app to capture journey_id | Not started |
| 4 | Add database columns for journey data | Not started |
| 5 | Create journey export API endpoint | Not started |
| 6 | Build journey fetch + analysis in CRM | Not started |
| 7 | Update CRM inquiry card display | Not started |
| 8 | Testing and refinement | Not started |

---

## Questions to Resolve

1. Should journey analysis run automatically on inquiry creation, or on-demand?
2. How long should we retain journey data linked to inquiries?
3. Should we show journey data to all CRM users or just admins?
4. Do we want to track behaviour AFTER inquiry (on prospectus page) separately?

---

## Appendix: Existing More House App Structure

### Apps and Ports

| App | Port | URL |
|-----|------|-----|
| Prospectus | 3000 | more-house-personalised-prospectus.onrender.com |
| CRM | 3001 | smart-crm-more-house.onrender.com |
| Booking | 3002 | smart-bookings-more-house.onrender.com |
| Email Worker | 3005 | (internal) |

### Current Inquiry Fields (relevant)

Already tracking:
- `prospectus_opened` - Did they view the prospectus?
- Engagement score (based on prospectus interaction)
- `tracking_events` table for prospectus engagement
- `chat_interactions` for Emily conversations

New fields to add:
- `journey_id` - Links to pre-enquiry behaviour
- `visitor_id` - Links across sessions
- `pre_enquiry_score` - Lead score from website behaviour
- `journey_analysis` - AI insights JSON

---

*Document created: 3 February 2026*
*Last updated: 3 February 2026*

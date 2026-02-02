# Website Journey Analytics

A standalone Node.js application that captures parent behavior from school websites via GTM, reconstructs journeys, displays them in a dashboard, and uses AI to recommend improvements.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add your Claude API key
cp .env.example .env
# Edit .env with your CLAUDE_API_KEY

# Initialize database
npm run init-db

# Seed test data (optional)
node scripts/seed-test-data.js

# Start the server
npm start
```

Visit http://localhost:3000/journeys to view the dashboard.

## Features

- **Event Capture API**: POST endpoint for receiving tracking events
- **GTM Tracking Script**: Ready-to-use script for Google Tag Manager
- **Journey Reconstruction**: Automatic grouping and analysis of events into user journeys
- **Dashboard**: Server-rendered views showing all journeys with filtering
- **AI Analysis**: Claude-powered insights identifying patterns, friction points, and recommendations

## Architecture

```
website-journey-analytics/
├── src/
│   ├── app.js                 # Express server entry point
│   ├── db/
│   │   ├── database.js        # SQLite connection
│   │   ├── queries.js         # Database queries
│   │   └── schema.sql         # Table definitions
│   ├── routes/
│   │   ├── events.js          # Event capture API
│   │   ├── journeys.js        # Journey dashboard routes
│   │   └── insights.js        # AI insights routes
│   ├── services/
│   │   ├── journeyBuilder.js  # Journey reconstruction logic
│   │   └── aiAnalysis.js      # Claude API integration
│   └── config/
│       └── siteStructure.json # Site page definitions
├── public/
│   └── views/                 # EJS templates
├── gtm/
│   └── trackingScript.js      # GTM custom HTML tag
└── data/
    └── analytics.db           # SQLite database (auto-created)
```

## API Endpoints

### Event Capture

**POST /api/event** - Capture a single event

```json
{
  "journey_id": "uuid-string",
  "event_type": "page_view",
  "page_url": "https://example.com/page",
  "referrer": "https://google.com",
  "intent_type": "enquire",
  "cta_label": "Enquire Now",
  "device_type": "desktop",
  "occurred_at": "2024-01-15T10:30:00Z"
}
```

**POST /api/events/batch** - Capture multiple events

```json
{
  "events": [
    { "journey_id": "...", "event_type": "..." },
    { "journey_id": "...", "event_type": "..." }
  ]
}
```

### Event Types

- `page_view` - User viewed a page
- `cta_click` - User clicked a call-to-action
- `form_start` - User started filling a form
- `form_submit` - User submitted a form
- `scroll_depth` - Scroll tracking
- `time_on_page` - Time spent on page

### Intent Types

- `enquire` - General enquiry
- `prospectus` - Prospectus request
- `book_visit` - School visit booking
- `apply` - Application
- `contact` - Contact form

## GTM Installation

1. In Google Tag Manager, create a new **Custom HTML** tag
2. Copy the contents of `gtm/trackingScript.js`
3. Update the `ANALYTICS_ENDPOINT` constant to your server URL
4. Set the trigger to "All Pages"
5. Customize the CTA and form selectors for your site
6. Publish the container

## Dashboard Pages

- **/journeys** - List of all journeys with stats
- **/journeys/:id** - Detailed timeline view of a single journey
- **/insights** - AI-generated analysis and recommendations

## AI Analysis

The AI analysis module:

1. Aggregates journey data for the selected period
2. Formats data including conversion rates, common sequences, and drop-off points
3. Calls Claude API with site context
4. Returns structured recommendations including:
   - Patterns identified
   - Friction points
   - Prioritized recommendations
   - Quick wins

Click "Run Analysis" on the Insights page to generate new recommendations.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| PORT | Server port | 3000 |
| CLAUDE_API_KEY | Anthropic API key | Required for AI |
| DATABASE_PATH | SQLite database path | ./data/analytics.db |

## Verification

### Test Event Capture

```bash
curl -X POST http://localhost:3000/api/event \
  -H "Content-Type: application/json" \
  -d '{
    "journey_id": "test-123",
    "event_type": "page_view",
    "page_url": "https://example.com",
    "device_type": "desktop"
  }'
```

### Test GTM Script

Open browser console on your site and run:

```javascript
wjaTrackEvent({
  event_type: 'cta_click',
  page_url: window.location.href,
  intent_type: 'enquire',
  cta_label: 'Test Click'
});
```

## Development

```bash
# Run with auto-reload
npm run dev

# Seed test data
node scripts/seed-test-data.js
```

## License

MIT

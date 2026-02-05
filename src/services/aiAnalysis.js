const Anthropic = require('@anthropic-ai/sdk');
const { getJourneysInDateRange, insertInsight } = require('../db/queries');
const siteStructureConfig = require('../config/siteStructure.json');
const { getScreenshotsForAnalysis, listScreenshots } = require('./screenshotService');

/**
 * Get site-specific configuration
 */
function getSiteConfig(siteId) {
  const id = String(siteId || siteStructureConfig.default);
  return siteStructureConfig.sites[id] || siteStructureConfig.sites[siteStructureConfig.default];
}

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

/**
 * Build message content array with text and optional screenshots
 * Claude's vision API format: { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } }
 */
function buildMessageWithScreenshots(textContent, screenshots = []) {
  if (!screenshots || screenshots.length === 0) {
    // No screenshots - return simple text format
    return textContent;
  }

  // Build content array with images first, then text
  const content = [];

  // Add each screenshot as an image
  for (const screenshot of screenshots) {
    if (screenshot.base64) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: screenshot.mediaType || 'image/png',
          data: screenshot.base64
        }
      });
    }
  }

  // Add the text prompt
  content.push({
    type: 'text',
    text: textContent
  });

  return content;
}

/**
 * Safe JSON parse helper
 */
function safeJsonParse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/**
 * Confidence bucket rules (match how you should reason about reliability)
 */
function getConfidenceBucket(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 'unknown';
  if (c < 40) return 'low';
  if (c < 70) return 'medium';
  return 'high';
}

/**
 * Pull out the key “truth signals” from a journey.
 * Works whether fields are stored as JSON strings or objects.
 */
function normaliseJourney(j) {
  const outcomeDetail = safeJsonParse(j.outcome_detail, null);
  const friction = safeJsonParse(j.friction, null);
  const engagement = safeJsonParse(j.engagement_metrics, null);
  const pageSequence = safeJsonParse(j.page_sequence, []);

  const strength = outcomeDetail?.strength || outcomeDetail?.intent_strength || null;
  const frictionDetected = Boolean(friction?.detected);
  const frictionSeverity = friction?.severity || null;

  // Determine a useful “intent” label for aggregation (not the same as outcome)
  // Prefer: outcome_detail.intent_type, fall back to journey.initial_intent.
  const intentType =
    outcomeDetail?.intent_type ||
    j.initial_intent ||
    'unknown';

  const confidence = Number(j.confidence);
  const confidenceBucket = getConfidenceBucket(confidence);

  // Compact sequence (avoid huge prompts)
  const compactSequence = Array.isArray(pageSequence)
    ? pageSequence.slice(0, 8).map(p => p?.url).filter(Boolean)
    : [];

  // Extract loops length if present (string or array)
  const loops = safeJsonParse(j.loops, Array.isArray(j.loops) ? j.loops : []);
  const loopCount = Array.isArray(loops) ? loops.length : 0;

  return {
    journey_id: j.journey_id,
    entry_page: j.entry_page || null,
    entry_referrer: j.entry_referrer || j.referrer || null,
    initial_intent: j.initial_intent || null,
    intent_type: intentType,

    outcome: j.outcome || 'unknown',
    strength: strength || 'unknown',

    confidence: Number.isFinite(confidence) ? confidence : null,
    confidence_bucket: confidenceBucket,

    friction_detected: frictionDetected,
    friction_severity: frictionSeverity || 'unknown',
    friction_signals: Array.isArray(friction?.signals) ? friction.signals : [],

    event_count: Number(j.event_count) || 0,
    time_to_action: Number.isFinite(Number(j.time_to_action)) ? Number(j.time_to_action) : null,

    engagement_metrics: {
      maxScroll: engagement?.maxScroll ?? null,
      dwellSeconds: engagement?.dwellSeconds ?? null,
      uniquePages: engagement?.uniquePages ?? null,
      sectionCount: engagement?.sectionCount ?? null,
      totalEvents: engagement?.totalEvents ?? null
    },

    loop_count: loopCount,
    sequence: compactSequence
  };
}

/**
 * Aggregate: counts + distributions + representative examples.
 * IMPORTANT: Only high-confidence journeys drive “insights”.
 */
function aggregateJourneyData(journeysRaw) {
  const journeys = journeysRaw.map(normaliseJourney);

  const data = {
    totals: {
      journeys: journeys.length,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      unknownConfidence: 0
    },

    outcomes: {},                // overall outcome distribution
    outcomesHigh: {},            // high-confidence outcome distribution

    strength: { low: 0, medium: 0, high: 0, unknown: 0 },
    strengthHigh: { low: 0, medium: 0, high: 0, unknown: 0 },

    friction: {
      overall: { detected: 0, notDetected: 0 },
      highConfidence: { detected: 0, notDetected: 0 },
      bySeverityHigh: { low: 0, medium: 0, high: 0, unknown: 0 }
    },

    abandonment: {
      early: 0,
      mid: 0,
      nearComplete: 0
    },
    abandonmentHigh: {
      early: 0,
      mid: 0,
      nearComplete: 0
    },

    intentDistributionHigh: {},

    entryPagesHigh: {},
    pageVisitsHigh: {},
    commonSequencesHigh: [],

    metricsHigh: {
      avgEvents: 0,
      avgTimeToActionSeconds: 0,
      avgMaxScroll: 0,
      avgDwellSeconds: 0,
      avgUniquePages: 0,
      avgSectionCount: 0
    },

    examplesHigh: [] // compact representative journeys
  };

  const high = [];
  const sequences = [];

  // Totals + distributions
  for (const j of journeys) {
    // Confidence totals
    if (j.confidence_bucket === 'high') data.totals.highConfidence++;
    else if (j.confidence_bucket === 'medium') data.totals.mediumConfidence++;
    else if (j.confidence_bucket === 'low') data.totals.lowConfidence++;
    else data.totals.unknownConfidence++;

    // Outcome totals
    data.outcomes[j.outcome] = (data.outcomes[j.outcome] || 0) + 1;

    // Strength totals
    if (j.strength === 'low') data.strength.low++;
    else if (j.strength === 'medium') data.strength.medium++;
    else if (j.strength === 'high') data.strength.high++;
    else data.strength.unknown++;

    // Friction totals
    if (j.friction_detected) data.friction.overall.detected++;
    else data.friction.overall.notDetected++;

    // Abandonment totals
    if (j.outcome === 'form_early_abandon') data.abandonment.early++;
    if (j.outcome === 'form_mid_abandon') data.abandonment.mid++;
    if (j.outcome === 'form_near_complete_abandon') data.abandonment.nearComplete++;

    // High-confidence sets
    if (j.confidence_bucket === 'high') {
      high.push(j);

      data.outcomesHigh[j.outcome] = (data.outcomesHigh[j.outcome] || 0) + 1;

      if (j.strength === 'low') data.strengthHigh.low++;
      else if (j.strength === 'medium') data.strengthHigh.medium++;
      else if (j.strength === 'high') data.strengthHigh.high++;
      else data.strengthHigh.unknown++;

      if (j.friction_detected) data.friction.highConfidence.detected++;
      else data.friction.highConfidence.notDetected++;

      const sev = (j.friction_severity || 'unknown').toLowerCase();
      if (sev === 'low') data.friction.bySeverityHigh.low++;
      else if (sev === 'medium') data.friction.bySeverityHigh.medium++;
      else if (sev === 'high') data.friction.bySeverityHigh.high++;
      else data.friction.bySeverityHigh.unknown++;

      if (j.outcome === 'form_early_abandon') data.abandonmentHigh.early++;
      if (j.outcome === 'form_mid_abandon') data.abandonmentHigh.mid++;
      if (j.outcome === 'form_near_complete_abandon') data.abandonmentHigh.nearComplete++;

      // Intent distribution (high confidence only)
      const intent = j.intent_type || 'unknown';
      data.intentDistributionHigh[intent] = (data.intentDistributionHigh[intent] || 0) + 1;

      // Entry pages (high confidence)
      const entry = j.entry_page || 'unknown';
      data.entryPagesHigh[entry] = (data.entryPagesHigh[entry] || 0) + 1;

      // Page visits (high confidence)
      for (const url of j.sequence) {
        data.pageVisitsHigh[url] = (data.pageVisitsHigh[url] || 0) + 1;
      }

      // Common sequences (high confidence)
      if (j.sequence.length > 0) {
        const seqKey = j.sequence.slice(0, 6).join(' -> ');
        sequences.push(seqKey);
      }
    }
  }

  // High-confidence averages
  if (high.length > 0) {
    const sum = (arr, fn) => arr.reduce((a, x) => a + (Number(fn(x)) || 0), 0);

    data.metricsHigh.avgEvents = sum(high, x => x.event_count) / high.length;
    const ttaList = high.map(x => x.time_to_action).filter(v => Number.isFinite(v));
    data.metricsHigh.avgTimeToActionSeconds = ttaList.length ? (ttaList.reduce((a, b) => a + b, 0) / ttaList.length) : 0;

    const maxScrollList = high.map(x => x.engagement_metrics.maxScroll).filter(v => Number.isFinite(v));
    data.metricsHigh.avgMaxScroll = maxScrollList.length ? (maxScrollList.reduce((a, b) => a + b, 0) / maxScrollList.length) : 0;

    const dwellList = high.map(x => x.engagement_metrics.dwellSeconds).filter(v => Number.isFinite(v));
    data.metricsHigh.avgDwellSeconds = dwellList.length ? (dwellList.reduce((a, b) => a + b, 0) / dwellList.length) : 0;

    const pagesList = high.map(x => x.engagement_metrics.uniquePages).filter(v => Number.isFinite(v));
    data.metricsHigh.avgUniquePages = pagesList.length ? (pagesList.reduce((a, b) => a + b, 0) / pagesList.length) : 0;

    const sectionList = high.map(x => x.engagement_metrics.sectionCount).filter(v => Number.isFinite(v));
    data.metricsHigh.avgSectionCount = sectionList.length ? (sectionList.reduce((a, b) => a + b, 0) / sectionList.length) : 0;
  }

  // Common sequences (top 10) from high confidence
  const seqCounts = {};
  for (const s of sequences) seqCounts[s] = (seqCounts[s] || 0) + 1;
  data.commonSequencesHigh = Object.entries(seqCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sequence, count]) => ({ sequence, count }));

  // Representative examples (keep prompt size sane)
  // Prefer: high strength + friction, high strength + no friction, abandonment, enquiry/visit, plain engaged.
  const pick = (filterFn, n) => high.filter(filterFn).slice(0, n);

  const examples = [
    ...pick(j => (j.outcome === 'visit_booked' || j.outcome === 'enquiry_submitted'), 4),
    ...pick(j => j.outcome.startsWith('form_') && j.strength === 'high', 4),
    ...pick(j => j.outcome === 'engaged' && j.strength === 'high' && j.friction_detected, 4),
    ...pick(j => j.outcome === 'engaged' && j.strength === 'high' && !j.friction_detected, 4),
    ...pick(j => j.outcome === 'engaged' && j.strength === 'medium', 4)
  ];

  // Deduplicate by journey id
  const seen = new Set();
  data.examplesHigh = examples
    .filter(j => {
      if (seen.has(j.journey_id)) return false;
      seen.add(j.journey_id);
      return true;
    })
    .slice(0, 18)
    .map(j => ({
      journey_id: j.journey_id,
      entry_page: j.entry_page,
      outcome: j.outcome,
      strength: j.strength,
      confidence: j.confidence,
      friction: j.friction_detected ? { severity: j.friction_severity, signals: j.friction_signals } : { detected: false },
      time_to_action: j.time_to_action,
      engagement_metrics: j.engagement_metrics,
      sequence: j.sequence
    }));

  // Conversion rate based on outcomes (overall + high-confidence)
  const overallConversions =
    (data.outcomes['enquiry_submitted'] || 0) + (data.outcomes['visit_booked'] || 0);
  data.conversionRate = journeys.length ? (overallConversions / journeys.length) * 100 : 0;

  const highConversions =
    (data.outcomesHigh['enquiry_submitted'] || 0) + (data.outcomesHigh['visit_booked'] || 0);
  data.conversionRateHigh = data.totals.highConfidence ? (highConversions / data.totals.highConfidence) * 100 : 0;

  return data;
}

function formatDataForAI(aggregatedData) {
  // Keep the prompt compact but truth-rich.
  const fmtPct = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : '0.0');

  const hc = aggregatedData.totals.highConfidence;

  const outcomesHighLines = Object.entries(aggregatedData.outcomesHigh)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- ${k}: ${v} (${fmtPct(v, hc)}%)`)
    .join('\n');

  const intentHighLines = Object.entries(aggregatedData.intentDistributionHigh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const entryHighLines = Object.entries(aggregatedData.entryPagesHigh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const pagesHighLines = Object.entries(aggregatedData.pageVisitsHigh)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  const sequencesHighLines = aggregatedData.commonSequencesHigh
    .map(s => `- ${s.sequence} (${s.count})`)
    .join('\n');

  const examplesLines = aggregatedData.examplesHigh
    .map((e, idx) => {
      const frictionText = e.friction?.detected === false
        ? 'no'
        : `yes (${e.friction.severity || 'unknown'})`;
      return [
        `Example ${idx + 1}:`,
        `- entry: ${e.entry_page || 'unknown'}`,
        `- outcome: ${e.outcome}`,
        `- strength: ${e.strength}`,
        `- confidence: ${e.confidence}`,
        `- friction: ${frictionText}`,
        `- time_to_action: ${e.time_to_action ?? 'null'}s`,
        `- engagement: scroll=${e.engagement_metrics.maxScroll ?? 'null'} | dwell=${e.engagement_metrics.dwellSeconds ?? 'null'}s | pages=${e.engagement_metrics.uniquePages ?? 'null'} | sections=${e.engagement_metrics.sectionCount ?? 'null'}`,
        `- sequence: ${(e.sequence || []).join(' -> ') || 'none'}`
      ].join('\n');
    })
    .join('\n\n');

  return `
## Journey Analytics (Truth-Preserving Summary)

### Reliability (confidence buckets)
- Total journeys: ${aggregatedData.totals.journeys}
- High confidence (>=70): ${aggregatedData.totals.highConfidence}
- Medium confidence (40-69): ${aggregatedData.totals.mediumConfidence}
- Low confidence (<40): ${aggregatedData.totals.lowConfidence}
- Unknown: ${aggregatedData.totals.unknownConfidence}

CRITICAL: Only HIGH confidence journeys are suitable for reliable patterns and recommendations.

### Conversion Rate
- Overall conversion (enquiry_submitted + visit_booked): ${aggregatedData.conversionRate.toFixed(2)}%
- High-confidence conversion: ${aggregatedData.conversionRateHigh.toFixed(2)}%

### Outcomes (HIGH confidence only)
${outcomesHighLines || '- (no high-confidence journeys)'}

### Strength Distribution (HIGH confidence only)
- high: ${aggregatedData.strengthHigh.high}
- medium: ${aggregatedData.strengthHigh.medium}
- low: ${aggregatedData.strengthHigh.low}
- unknown: ${aggregatedData.strengthHigh.unknown}

### Friction (HIGH confidence only)
- friction detected: ${aggregatedData.friction.highConfidence.detected}
- friction not detected: ${aggregatedData.friction.highConfidence.notDetected}
- severity breakdown: low=${aggregatedData.friction.bySeverityHigh.low}, medium=${aggregatedData.friction.bySeverityHigh.medium}, high=${aggregatedData.friction.bySeverityHigh.high}, unknown=${aggregatedData.friction.bySeverityHigh.unknown}

### Abandonment Depth
- overall: early=${aggregatedData.abandonment.early}, mid=${aggregatedData.abandonment.mid}, near_complete=${aggregatedData.abandonment.nearComplete}
- high-confidence: early=${aggregatedData.abandonmentHigh.early}, mid=${aggregatedData.abandonmentHigh.mid}, near_complete=${aggregatedData.abandonmentHigh.nearComplete}

### High-confidence engagement averages
- avg events: ${aggregatedData.metricsHigh.avgEvents.toFixed(1)}
- avg time_to_action: ${Math.round(aggregatedData.metricsHigh.avgTimeToActionSeconds)}s
- avg max scroll: ${Math.round(aggregatedData.metricsHigh.avgMaxScroll)}%
- avg dwell: ${Math.round(aggregatedData.metricsHigh.avgDwellSeconds)}s
- avg unique pages: ${aggregatedData.metricsHigh.avgUniquePages.toFixed(1)}
- avg sections viewed: ${aggregatedData.metricsHigh.avgSectionCount.toFixed(1)}

### Initial intent distribution (HIGH confidence only)
${intentHighLines || '- (no high-confidence journeys)'}

### Top entry pages (HIGH confidence only)
${entryHighLines || '- (no high-confidence journeys)'}

### Most visited pages (HIGH confidence only)
${pagesHighLines || '- (no high-confidence journeys)'}

### Common sequences (HIGH confidence only)
${sequencesHighLines || '- (no high-confidence journeys)'}

### Representative high-confidence examples (compact)
${examplesLines || '(none)'}
`;
}

/**
 * Build prompt focused on website performance and actionable improvements.
 */
function buildPrompt(formattedData, siteId, screenshots = []) {
  const siteStructure = getSiteConfig(siteId);

  // Add visual context section if screenshots are included
  const visualContextSection = screenshots.length > 0
    ? `
VISUAL CONTEXT:
I've included ${screenshots.length} screenshot(s) of key website pages. Please reference these when making recommendations about:
- CTA visibility and positioning
- Content layout and hierarchy
- Visual elements that may be causing confusion
- Mobile vs desktop layout issues

Screenshots included:
${screenshots.map(s => `- ${s.pagePath} (${s.type})`).join('\n')}

When you see issues in the data (e.g., high dead clicks on a page, CTA hesitation), look at the screenshot to identify what element users might be trying to click or what might be causing confusion.
`
    : '';

  return `You are a website performance analyst. Your job is to tell me how this website is performing and what we can do to improve conversions.

WEBSITE: ${siteStructure.siteName} (${siteStructure.siteUrl})
${siteStructure.siteDescription}
${visualContextSection}

KEY PAGES:
${Object.entries(siteStructure.pages || {})
  .map(([path, info]) => `- ${path}: ${info.name}`)
  .join('\n')}

CONVERSION GOALS (what we want visitors to do):
${Array.isArray(siteStructure.conversionGoals)
  ? siteStructure.conversionGoals.map(g => `- ${g.name}`).join('\n')
  : '- Submit an enquiry\n- Book a visit'}

VISITOR JOURNEY DATA:
${formattedData}

Based on this data, answer these questions in plain English:

1. HOW IS THE WEBSITE PERFORMING?
   - What % of visitors convert (submit enquiry, book visit)?
   - Are visitors engaging with the content or bouncing quickly?

2. WHAT'S THE TYPICAL VISITOR JOURNEY?
   - Where do most visitors land (entry pages)?
   - What pages do they visit next?
   - Where do they leave the site (exit pages)?

3. WHERE ARE WE LOSING PEOPLE?
   - Which pages have high drop-off rates?
   - At what point in the journey do people leave?
   - Are there specific pages that seem to cause confusion?

4. WHAT'S WORKING WELL?
   - Which entry pages lead to conversions?
   - Which page sequences result in enquiries?
   - What do converting visitors have in common?

5. WHAT SHOULD WE FIX?
   - Specific, actionable recommendations
   - Prioritised by impact (fix the big problems first)

Respond with ONLY this JSON:

{
  "summary": "2-3 sentences: How is the website performing overall? Give the headline.",

  "performance": {
    "conversionRate": "X% of visitors convert",
    "totalVisitors": number,
    "totalConversions": number,
    "averageSessionDuration": "X minutes",
    "bounceRate": "X% leave after one page",
    "verdict": "Good/Needs work/Poor - one sentence why"
  },

  "visitorJourney": {
    "topEntryPages": ["List the top 3-5 pages where visitors land"],
    "commonPaths": ["List 2-3 common page sequences visitors take"],
    "topExitPages": ["List the top 3-5 pages where visitors leave"],
    "journeyInsight": "One paragraph describing the typical visitor journey story"
  },

  "problemAreas": [
    {
      "page": "Page URL or name",
      "problem": "What's wrong (high bounce, confusion, drop-off)",
      "evidence": "What in the data shows this",
      "impact": "high/medium/low"
    }
  ],

  "whatsWorking": [
    {
      "finding": "What's working well",
      "evidence": "What in the data shows this"
    }
  ],

  "recommendations": [
    {
      "priority": 1,
      "action": "What to do (be specific)",
      "why": "Why this will help",
      "expectedResult": "What should improve"
    }
  ],

  "quickWins": [
    "Simple changes that could help immediately"
  ]
}`;
}

async function runAnalysis(startDate, endDate, siteId = null, includeScreenshots = true) {
  const journeysRaw = await getJourneysInDateRange(startDate, endDate, siteId);

  if (!journeysRaw || journeysRaw.length === 0) {
    return { success: false, error: 'No journeys found in the specified date range' };
  }

  const aggregatedData = aggregateJourneyData(journeysRaw);
  const formattedData = formatDataForAI(aggregatedData);

  // Get screenshots if available and requested
  let screenshots = [];
  if (includeScreenshots && siteId) {
    try {
      // Get key pages from the aggregated data (top entry pages, most visited)
      const topEntryPages = Object.keys(aggregatedData.entryPagesHigh).slice(0, 3);
      const topVisitedPages = Object.keys(aggregatedData.pageVisitsHigh).slice(0, 5);
      const keyPages = [...new Set([...topEntryPages, ...topVisitedPages])];

      // Also check for available screenshots
      const availableScreenshots = listScreenshots(siteId);
      if (availableScreenshots.length > 0) {
        screenshots = getScreenshotsForAnalysis(siteId, keyPages, 5);
        console.log(`[AI Analysis] Including ${screenshots.length} screenshots in analysis`);
      }
    } catch (screenshotError) {
      console.warn('[AI Analysis] Could not load screenshots:', screenshotError.message);
      // Continue without screenshots
    }
  }

  const prompt = buildPrompt(formattedData, siteId, screenshots);
  const messageContent = buildMessageWithScreenshots(prompt, screenshots);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: messageContent }]
    });

    const content = response?.content?.[0]?.text || '';
    let analysisResult;

    try {
      analysisResult = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysisResult = JSON.parse(jsonMatch[0]);
      else throw new Error('Failed to parse AI response as JSON');
    }

    // Store the insight (keep backwards-compatible fields + add reliability)
    const insight = {
      period_start: startDate,
      period_end: endDate,
      total_journeys: aggregatedData.totals.journeys,
      conversion_rate: aggregatedData.conversionRate,
      analysis_result: analysisResult,
      site_id: siteId
    };

    await insertInsight(insight);

    return {
      success: true,
      insight: {
        ...insight,
        analysis_result: analysisResult
      }
    };
  } catch (error) {
    console.error('AI Analysis error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Analyse a single journey in detail
 */
async function analyseSingleJourney(journey, siteId = null, includeScreenshots = true) {
  if (!journey || !journey.events || journey.events.length === 0) {
    return { success: false, error: 'Journey has no events to analyse' };
  }

  // Use journey's site_id if available, otherwise use passed siteId
  const effectiveSiteId = journey.site_id || siteId;

  // Get screenshots of pages visited in this journey
  let screenshots = [];
  if (includeScreenshots && effectiveSiteId) {
    try {
      // Extract unique page URLs from events
      const pageViews = (journey.events || []).filter(e => e.event_type === 'page_view');
      const uniquePageUrls = [...new Set(pageViews.map(e => e.page_url).filter(Boolean))];

      const availableScreenshots = listScreenshots(effectiveSiteId);
      if (availableScreenshots.length > 0 && uniquePageUrls.length > 0) {
        screenshots = getScreenshotsForAnalysis(effectiveSiteId, uniquePageUrls, 4);
        console.log(`[AI Analysis] Including ${screenshots.length} screenshots for journey analysis`);
      }
    } catch (screenshotError) {
      console.warn('[AI Analysis] Could not load screenshots for journey:', screenshotError.message);
    }
  }

  // Format the journey data for AI analysis
  const formattedJourney = formatSingleJourneyForAI(journey);
  const prompt = buildSingleJourneyPrompt(formattedJourney, effectiveSiteId, screenshots);
  const messageContent = buildMessageWithScreenshots(prompt, screenshots);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: messageContent }]
    });

    const content = response?.content?.[0]?.text || '';
    let analysisResult;

    try {
      analysisResult = JSON.parse(content);
    } catch (parseError) {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) analysisResult = JSON.parse(jsonMatch[0]);
      else throw new Error('Failed to parse AI response as JSON');
    }

    return {
      success: true,
      analysis: analysisResult
    };
  } catch (error) {
    console.error('Single journey AI analysis error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Format a single journey's events for AI analysis
 */
function formatSingleJourneyForAI(journey) {
  const events = journey.events || [];

  // Group events by type
  const eventCounts = {};
  events.forEach(e => {
    eventCounts[e.event_type] = (eventCounts[e.event_type] || 0) + 1;
  });

  // Calculate engagement metrics
  const pageViews = events.filter(e => e.event_type === 'page_view');
  const ctaClicks = events.filter(e => e.event_type === 'cta_click');
  const deadClicks = events.filter(e => e.event_type === 'dead_click');
  const ctaHovers = events.filter(e => e.event_type === 'cta_hover');
  const formEvents = events.filter(e => e.event_type.startsWith('form_'));
  const scrollEvents = events.filter(e => e.event_type === 'scroll_depth');
  const heartbeats = events.filter(e => e.event_type === 'heartbeat');
  const quickBacks = events.filter(e => e.event_type === 'quick_back');
  const sectionViews = events.filter(e => e.event_type === 'section_visibility');

  // Calculate session duration from first to last event
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const sessionDurationSeconds = firstEvent && lastEvent
    ? Math.round((new Date(lastEvent.occurred_at) - new Date(firstEvent.occurred_at)) / 1000)
    : 0;

  // Estimate dwell time from heartbeats (each heartbeat = ~15 seconds)
  const estimatedDwellSeconds = heartbeats.length * 15;

  // Get unique pages visited
  const uniquePages = [...new Set(pageViews.map(e => e.page_url))];

  // Build event timeline (simplified)
  const timeline = events
    .filter(e => e.event_type !== 'heartbeat') // Skip heartbeats for readability
    .map(e => {
      const time = new Date(e.occurred_at).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      let detail = e.event_type;
      if (e.page_url) {
        const path = e.page_url.replace(/https?:\/\/[^\/]+/, '');
        detail += ` on ${path}`;
      }
      if (e.cta_label) detail += ` - "${e.cta_label}"`;
      if (e.intent_type) detail += ` (intent: ${e.intent_type})`;
      return `${time}: ${detail}`;
    });

  // Get CTA click details
  const ctaDetails = ctaClicks.map(e => ({
    label: e.cta_label,
    page: e.page_url?.replace(/https?:\/\/[^\/]+/, '') || 'unknown',
    intent: e.intent_type
  }));

  // Get dead click details (frustration signals)
  const deadClickDetails = deadClicks.map(e => {
    const metadata = typeof e.metadata === 'string' ? JSON.parse(e.metadata) : (e.metadata || {});
    return {
      element: metadata.element || 'unknown',
      page: e.page_url?.replace(/https?:\/\/[^\/]+/, '') || 'unknown'
    };
  });

  // Get CTA hesitation details
  const hesitationDetails = ctaHovers.map(e => ({
    label: e.cta_label,
    page: e.page_url?.replace(/https?:\/\/[^\/]+/, '') || 'unknown'
  }));

  return `
## Single Journey Analysis

### Journey Overview
- Journey ID: ${journey.journey_id}
- Visitor: ${journey.visit_number > 1 ? `Returning visitor (visit #${journey.visit_number})` : 'New visitor'}
- Entry Page: ${journey.entry_page || 'Unknown'}
- Referrer: ${journey.entry_referrer || 'Direct'}
- Outcome: ${journey.outcome || 'Unknown'}
- Session Duration: ${Math.floor(sessionDurationSeconds / 60)}m ${sessionDurationSeconds % 60}s
- Estimated Dwell Time: ${Math.floor(estimatedDwellSeconds / 60)}m ${estimatedDwellSeconds % 60}s

### Engagement Summary
- Total Events: ${events.length}
- Pages Viewed: ${pageViews.length} (${uniquePages.length} unique)
- CTA Clicks: ${ctaClicks.length}
- Dead Clicks (frustration): ${deadClicks.length}
- CTA Hovers (hesitation): ${ctaHovers.length}
- Quick Backs: ${quickBacks.length}
- Form Interactions: ${formEvents.length}
- Sections Viewed: ${sectionViews.length}
- Heartbeats: ${heartbeats.length}

### Pages Visited (in order)
${uniquePages.map((url, i) => `${i + 1}. ${url.replace(/https?:\/\/[^\/]+/, '')}`).join('\n') || '- None recorded'}

### CTA Interactions
${ctaDetails.length > 0
  ? ctaDetails.map(c => `- Clicked "${c.label}" on ${c.page}${c.intent ? ` (intent: ${c.intent})` : ''}`).join('\n')
  : '- No CTA clicks recorded'}

### Frustration Signals
${deadClickDetails.length > 0
  ? `Dead clicks (clicking non-interactive elements):\n${deadClickDetails.map(d => `- Clicked <${d.element}> on ${d.page}`).join('\n')}`
  : '- No dead clicks detected'}
${hesitationDetails.length > 0
  ? `\nCTA Hesitations (hovered but didn't click):\n${hesitationDetails.map(h => `- Hovered over "${h.label}" on ${h.page}`).join('\n')}`
  : ''}
${quickBacks.length > 0 ? `\nQuick backs: ${quickBacks.length} (left page within 5 seconds)` : ''}

### Event Timeline (key events only)
${timeline.slice(0, 50).join('\n')}${timeline.length > 50 ? `\n... and ${timeline.length - 50} more events` : ''}
`;
}

/**
 * Build prompt for single journey analysis
 */
function buildSingleJourneyPrompt(formattedData, siteId, screenshots = []) {
  const siteStructure = getSiteConfig(siteId);

  // Add visual context section if screenshots are included
  const visualContextSection = screenshots.length > 0
    ? `
VISUAL CONTEXT:
I've included ${screenshots.length} screenshot(s) of pages this visitor viewed. Please reference these when analysing their behaviour:
- Look at where CTAs are positioned on pages they visited
- Consider what content they would have seen
- Identify any potential UX issues visible in the screenshots

Screenshots included:
${screenshots.map(s => `- ${s.pagePath} (${s.type})`).join('\n')}
`
    : '';

  return `You are an expert in website user behaviour analysis. Analyse this single visitor journey and provide insights.

CONTEXT: This is a visitor to ${siteStructure.siteName} (${siteStructure.siteUrl}) - ${siteStructure.siteDescription}.
${visualContextSection}

Site pages and their roles:
${Object.entries(siteStructure.pages || {})
  .map(([path, info]) => `- ${path}: ${info.name} (${info.stage} stage)`)
  .join('\n')}

JOURNEY DATA:
${formattedData}

Analyse this visitor's behaviour and respond with ONLY this JSON:

{
  "summary": "2-3 sentences describing what this visitor did and their likely intent",
  "visitorProfile": {
    "likelyIntent": "What they were probably looking for",
    "engagementLevel": "high|medium|low",
    "buyerStage": "awareness|consideration|decision"
  },
  "positiveSignals": [
    "Things that indicate interest or intent (be specific, reference actual events)"
  ],
  "concernSignals": [
    "Things that indicate confusion, frustration, or hesitation (be specific)"
  ],
  "keyMoments": [
    {
      "event": "What happened",
      "significance": "Why it matters"
    }
  ],
  "recommendations": [
    {
      "action": "What the sales/marketing team should do",
      "reason": "Why this would help",
      "priority": "high|medium|low"
    }
  ],
  "followUpSuggestion": "If this visitor could be contacted, what approach would work best"
}`;
}

module.exports = {
  runAnalysis,
  aggregateJourneyData,
  formatDataForAI,
  analyseSingleJourney
};

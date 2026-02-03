const Anthropic = require('@anthropic-ai/sdk');
const { getJourneysInDateRange, insertInsight } = require('../db/queries');
const siteStructure = require('../config/siteStructure.json');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

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
 * Build a strict prompt that forces honesty.
 */
function buildPrompt(formattedData) {
  return `You are an expert in website journey analytics and conversion optimisation.

You are analysing reconstructed journeys that include reliability signals:
- confidence (0–100) and confidence buckets
- strength (low/medium/high)
- friction (detected + severity + signals)
- engagement metrics (scroll, dwell, pages, sections)
- outcomes including abandonment depth

NON-NEGOTIABLE RULES:
1) Only use HIGH confidence journeys (>=70) to claim patterns or make recommendations.
2) Medium confidence data may be used only for tentative hypotheses and must be labelled as such.
3) Low confidence data (<40) must NOT be used for conclusions.
4) Friction signals mean confusion/resistance, NOT disinterest. Never claim disinterest when friction exists.
5) Never invent causes. Every claim must reference evidence from the provided summary/examples.
6) Never suggest adding CTAs that already exist. Use the CTAs list in site structure as a hard constraint.
7) If there is insufficient high-confidence data, explicitly say so in dataGaps and keep recommendations minimal.

SITE CONTEXT (do not contradict):
This is ${siteStructure.siteName} (${siteStructure.siteUrl}) - a B2B SaaS company selling admissions software to schools.

Pages:
${Object.entries(siteStructure.pages || {})
  .map(([path, info]) => `- ${path}: ${info.name} (${info.stage} stage, ${info.role} role)`)
  .join('\n')}

CTAs that already exist (do NOT suggest adding these):
${siteStructure.ctas
  ? Object.values(siteStructure.ctas).map(cta => `- "${cta.label}" (${cta.description})`).join('\n')
  : '- Not specified'}

Conversion goals:
${Array.isArray(siteStructure.conversionGoals)
  ? siteStructure.conversionGoals.map(g => `- ${g.name}: ${g.event} intent=${g.intent} value=${g.value}`).join('\n')
  : '- Not specified'}

DATA (summary + examples):
${formattedData}

Respond with ONLY the JSON object matching this schema:

{
  "summary": "2–3 sentences. Must be factual and based on HIGH confidence data only.",
  "reliability": {
    "highConfidenceJourneys": number,
    "mediumConfidenceJourneys": number,
    "lowConfidenceJourneys": number,
    "note": "One sentence explaining how reliability affected conclusions."
  },
  "reliablePatterns": [
    {
      "title": "Pattern name",
      "description": "What happens. HIGH confidence only.",
      "evidence": "Reference metrics/examples from the data",
      "impact": "high|medium|low"
    }
  ],
  "frictionPoints": [
    {
      "location": "Page/sequence area if identifiable",
      "issue": "What friction looks like",
      "evidence": "Specific friction signals and examples",
      "severity": "high|medium|low"
    }
  ],
  "abandonmentInsights": [
    {
      "type": "early|mid|near_complete",
      "hypothesis": "Likely reason (only if supported)",
      "evidence": "What in the data supports this",
      "confidence": "high|medium|low"
    }
  ],
  "safeRecommendations": [
    {
      "title": "Recommendation",
      "description": "What to do and why",
      "priority": "high|medium|low",
      "expectedImpact": "What should improve",
      "implementation": "Concrete steps (no new CTAs)",
      "risk": "What could go wrong if misinterpreted"
    }
  ],
  "quickWins": [
    "Short, safe changes backed by HIGH confidence data only"
  ],
  "dataGaps": [
    "What cannot be concluded due to insufficient HIGH confidence evidence"
  ]
}`;
}

async function runAnalysis(startDate, endDate) {
  const journeysRaw = await getJourneysInDateRange(startDate, endDate);

  if (!journeysRaw || journeysRaw.length === 0) {
    return { success: false, error: 'No journeys found in the specified date range' };
  }

  const aggregatedData = aggregateJourneyData(journeysRaw);
  const formattedData = formatDataForAI(aggregatedData);
  const prompt = buildPrompt(formattedData);

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
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
      analysis_result: analysisResult
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

module.exports = {
  runAnalysis,
  aggregateJourneyData,
  formatDataForAI
};

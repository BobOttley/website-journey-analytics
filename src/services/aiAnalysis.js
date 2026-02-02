const Anthropic = require('@anthropic-ai/sdk');
const { getJourneysInDateRange, getJourneyStats, insertInsight } = require('../db/queries');
const siteStructure = require('../config/siteStructure.json');

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY
});

function aggregateJourneyData(journeys) {
  const data = {
    totalJourneys: journeys.length,
    outcomes: {},
    entryPages: {},
    pageVisits: {},
    avgEventsPerJourney: 0,
    avgTimeToAction: 0,
    commonSequences: [],
    loopsDetected: [],
    deviceTypes: {},
    intentDistribution: {}
  };

  let totalEvents = 0;
  let totalTimeToAction = 0;
  let timeToActionCount = 0;
  const sequences = [];

  journeys.forEach(journey => {
    // Outcomes
    const outcome = journey.outcome || 'unknown';
    data.outcomes[outcome] = (data.outcomes[outcome] || 0) + 1;

    // Entry pages
    const entryPage = journey.entry_page || 'unknown';
    data.entryPages[entryPage] = (data.entryPages[entryPage] || 0) + 1;

    // Page sequences
    let pageSequence = [];
    if (journey.page_sequence) {
      try {
        pageSequence = typeof journey.page_sequence === 'string'
          ? JSON.parse(journey.page_sequence)
          : journey.page_sequence;
      } catch (e) {
        pageSequence = [];
      }
    }

    // Count page visits
    pageSequence.forEach(page => {
      const url = page.url || 'unknown';
      data.pageVisits[url] = (data.pageVisits[url] || 0) + 1;
    });

    // Track sequences (first 5 pages)
    if (pageSequence.length > 0) {
      const seq = pageSequence.slice(0, 5).map(p => p.url).join(' -> ');
      sequences.push(seq);
    }

    // Event count
    totalEvents += journey.event_count || 0;

    // Time to action
    if (journey.time_to_action) {
      totalTimeToAction += journey.time_to_action;
      timeToActionCount++;
    }

    // Initial intent
    const intent = journey.initial_intent || 'unknown';
    data.intentDistribution[intent] = (data.intentDistribution[intent] || 0) + 1;
  });

  // Calculate averages
  data.avgEventsPerJourney = journeys.length > 0 ? totalEvents / journeys.length : 0;
  data.avgTimeToAction = timeToActionCount > 0 ? totalTimeToAction / timeToActionCount : 0;

  // Find common sequences
  const sequenceCounts = {};
  sequences.forEach(seq => {
    sequenceCounts[seq] = (sequenceCounts[seq] || 0) + 1;
  });

  data.commonSequences = Object.entries(sequenceCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sequence, count]) => ({ sequence, count }));

  // Calculate conversion rate
  const conversions = (data.outcomes['enquiry_submitted'] || 0) + (data.outcomes['visit_booked'] || 0);
  data.conversionRate = journeys.length > 0 ? (conversions / journeys.length) * 100 : 0;

  return data;
}

function formatDataForAI(aggregatedData) {
  return `
## Journey Analytics Data

### Overview
- Total Journeys Analyzed: ${aggregatedData.totalJourneys}
- Conversion Rate: ${aggregatedData.conversionRate.toFixed(2)}%
- Average Events per Journey: ${aggregatedData.avgEventsPerJourney.toFixed(1)}
- Average Time to Action: ${aggregatedData.avgTimeToAction.toFixed(0)} seconds

### Outcomes Distribution
${Object.entries(aggregatedData.outcomes)
  .map(([outcome, count]) => `- ${outcome}: ${count} (${((count / aggregatedData.totalJourneys) * 100).toFixed(1)}%)`)
  .join('\n')}

### Top Entry Pages
${Object.entries(aggregatedData.entryPages)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([page, count]) => `- ${page}: ${count} entries`)
  .join('\n')}

### Most Visited Pages
${Object.entries(aggregatedData.pageVisits)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 15)
  .map(([page, count]) => `- ${page}: ${count} visits`)
  .join('\n')}

### Common Journey Sequences
${aggregatedData.commonSequences
  .map(({ sequence, count }) => `- ${sequence} (${count} journeys)`)
  .join('\n')}

### Initial Intent Distribution
${Object.entries(aggregatedData.intentDistribution)
  .map(([intent, count]) => `- ${intent}: ${count}`)
  .join('\n')}

### Site Structure Context
This is a school website (${siteStructure.siteName}) with the following key pages:
${Object.entries(siteStructure.pages)
  .slice(0, 10)
  .map(([path, info]) => `- ${path}: ${info.name} (${info.stage} stage, ${info.role} role)`)
  .join('\n')}

### Conversion Goals
${siteStructure.conversionGoals
  .map(goal => `- ${goal.name}: ${goal.event} with ${goal.intent} intent (${goal.value} value)`)
  .join('\n')}
`;
}

async function runAnalysis(startDate, endDate) {
  // Get journeys in date range
  const journeys = await getJourneysInDateRange(startDate, endDate);

  if (journeys.length === 0) {
    return {
      success: false,
      error: 'No journeys found in the specified date range'
    };
  }

  // Aggregate data
  const aggregatedData = aggregateJourneyData(journeys);
  const formattedData = formatDataForAI(aggregatedData);

  // Create the prompt
  const prompt = `You are an expert in website analytics and user experience optimization, specifically for school websites trying to convert prospective parents into enquiries and visits.

Analyze the following journey data and provide actionable insights:

${formattedData}

Please provide your analysis in the following JSON structure:
{
  "summary": "Brief 2-3 sentence overview of the findings",
  "patterns": [
    {
      "title": "Pattern name",
      "description": "Description of the pattern",
      "frequency": "How common this is",
      "impact": "high/medium/low"
    }
  ],
  "frictionPoints": [
    {
      "location": "Where on the site",
      "issue": "What the problem is",
      "evidence": "Data supporting this",
      "severity": "high/medium/low"
    }
  ],
  "recommendations": [
    {
      "title": "Recommendation title",
      "description": "Detailed recommendation",
      "priority": "high/medium/low",
      "expectedImpact": "What improvement to expect",
      "implementation": "How to implement this"
    }
  ],
  "quickWins": [
    "Simple change 1",
    "Simple change 2"
  ],
  "keyMetrics": {
    "conversionRate": ${aggregatedData.conversionRate.toFixed(2)},
    "avgJourneyLength": ${aggregatedData.avgEventsPerJourney.toFixed(1)},
    "avgTimeToAction": ${aggregatedData.avgTimeToAction.toFixed(0)},
    "topDropOffPoint": "identified page",
    "bestPerformingEntry": "identified page"
  }
}

Focus on:
1. Why parents might not be completing enquiry forms
2. Where in the journey parents are dropping off
3. What pages lead to conversions vs. abandonment
4. How to improve the path from homepage to enquiry/visit booking
5. Mobile vs desktop differences if apparent

Respond with ONLY the JSON object, no additional text.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    // Parse the response
    const content = response.content[0].text;
    let analysisResult;

    try {
      analysisResult = JSON.parse(content);
    } catch (parseError) {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response as JSON');
      }
    }

    // Store the insight
    const insight = {
      period_start: startDate,
      period_end: endDate,
      total_journeys: aggregatedData.totalJourneys,
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
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  runAnalysis,
  aggregateJourneyData,
  formatDataForAI
};

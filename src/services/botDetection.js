/**
 * Bot Detection Service
 *
 * Detects and classifies bot traffic using multiple signals:
 * 1. User-Agent Analysis - Known bot patterns
 * 2. Behavioural Analysis - Timing anomalies, no engagement
 * 3. Technical Signals - Automation indicators, datacenter IPs
 *
 * Bot Score: 0-100
 * - 0-30: Likely human
 * - 31-60: Suspicious
 * - 61-100: Likely bot
 */

// ============================================
// KNOWN BOT PATTERNS
// ============================================

const KNOWN_BOTS = {
  // Search Engine Crawlers
  search_crawler: [
    /googlebot/i,
    /bingbot/i,
    /slurp/i,                    // Yahoo
    /duckduckbot/i,
    /baiduspider/i,
    /yandexbot/i,
    /sogou/i,
    /exabot/i,
    /facebot/i,                   // Facebook
    /ia_archiver/i,               // Alexa
  ],

  // SEO Tools
  seo_tool: [
    /semrushbot/i,
    /ahrefs/i,
    /mj12bot/i,                   // Majestic
    /dotbot/i,                    // Moz
    /rogerbot/i,
    /screaming frog/i,
    /seokicks/i,
    /blexbot/i,
    /sistrix/i,
    /spyfu/i,
  ],

  // Social Media Crawlers
  social_crawler: [
    /facebookexternalhit/i,
    /twitterbot/i,
    /linkedinbot/i,
    /pinterest/i,
    /slackbot/i,
    /whatsapp/i,
    /telegrambot/i,
    /discordbot/i,
  ],

  // Monitoring & Uptime
  monitoring: [
    /pingdom/i,
    /uptimerobot/i,
    /statuscake/i,
    /site24x7/i,
    /newrelicpinger/i,
    /checkly/i,
    /datadog/i,
    /applebot/i,
  ],

  // Generic Scrapers & Bots
  scraper: [
    /python-requests/i,
    /python-urllib/i,
    /curl/i,
    /wget/i,
    /httpclient/i,
    /java\//i,
    /libwww/i,
    /scrapy/i,
    /go-http-client/i,
    /axios/i,
    /node-fetch/i,
    /httpie/i,
  ],

  // Automation / Headless Browsers
  automation: [
    /phantomjs/i,
    /headlesschrome/i,
    /puppeteer/i,
    /playwright/i,
    /selenium/i,
    /webdriver/i,
    /chromedriver/i,
    /geckodriver/i,
    /nightmare/i,
    /cypress/i,
  ],
};

// All bot patterns flattened for quick checking
const ALL_BOT_PATTERNS = Object.values(KNOWN_BOTS).flat();

// ============================================
// AUTOMATION INDICATORS
// ============================================

const AUTOMATION_INDICATORS = [
  'webdriver',
  'phantom',
  'nightmare',
  'selenium',
  'puppeteer',
  'playwright',
  'headless',
  '__webdriver_unwrapped',
  '__driver_unwrapped',
  '__webdriver_script_fn',
  '__selenium_unwrapped',
  '_Selenium_IDE_Recorder',
  'callSelenium',
  'calledSelenium',
  '_WEBDRIVER_ELEM_CACHE',
  'ChromeDriverw',
  'driver-evaluate',
  'webdriver-evaluate',
  'webdriver-evaluate-response',
  'cdc_',
  '$cdc_',
];

// ============================================
// DATACENTER IP RANGES (simplified)
// These are common datacenter/cloud provider ranges
// ============================================

const DATACENTER_PATTERNS = [
  /^35\./, /^34\./, // Google Cloud
  /^52\./, /^54\./, /^3\./, // AWS
  /^13\./, /^104\./, // Azure
  /^159\./, /^185\./, // Various datacenters
  /^192\.30\./, // GitHub
  /^140\.82\./, // GitHub
];

// ============================================
// DETECTION FUNCTIONS
// ============================================

/**
 * Analyse User-Agent string for known bot patterns
 * @param {string} userAgent
 * @returns {{ isBot: boolean, botType: string|null, confidence: number }}
 */
function analyseUserAgent(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return { isBot: false, botType: null, confidence: 0, signals: ['no_user_agent'] };
  }

  const ua = userAgent.toLowerCase();
  const signals = [];

  // Check against known bot patterns
  for (const [botType, patterns] of Object.entries(KNOWN_BOTS)) {
    for (const pattern of patterns) {
      if (pattern.test(ua)) {
        signals.push(`known_bot:${botType}`);
        return {
          isBot: true,
          botType,
          confidence: 95,
          signals
        };
      }
    }
  }

  // Check for suspicious User-Agent characteristics

  // Empty or very short User-Agent
  if (ua.length < 20) {
    signals.push('short_user_agent');
  }

  // No browser identification
  if (!/(chrome|firefox|safari|edge|opera|msie|trident)/i.test(ua)) {
    signals.push('no_browser_id');
  }

  // No platform/OS information
  if (!/(windows|mac|linux|android|ios|iphone|ipad)/i.test(ua)) {
    signals.push('no_platform');
  }

  // Contains automation-related keywords
  for (const indicator of AUTOMATION_INDICATORS) {
    if (ua.includes(indicator.toLowerCase())) {
      signals.push(`automation:${indicator}`);
      return {
        isBot: true,
        botType: 'automation',
        confidence: 90,
        signals
      };
    }
  }

  // Calculate suspicion level
  let suspicionScore = 0;
  if (signals.includes('short_user_agent')) suspicionScore += 20;
  if (signals.includes('no_browser_id')) suspicionScore += 30;
  if (signals.includes('no_platform')) suspicionScore += 20;

  return {
    isBot: suspicionScore >= 50,
    botType: suspicionScore >= 50 ? 'unknown' : null,
    confidence: suspicionScore,
    signals
  };
}

/**
 * Check if IP is from a known datacenter
 * @param {string} ipAddress
 * @returns {{ isDatacenter: boolean, signals: string[] }}
 */
function analyseIP(ipAddress) {
  if (!ipAddress) {
    return { isDatacenter: false, signals: [] };
  }

  const signals = [];

  for (const pattern of DATACENTER_PATTERNS) {
    if (pattern.test(ipAddress)) {
      signals.push('datacenter_ip');
      return { isDatacenter: true, signals };
    }
  }

  return { isDatacenter: false, signals };
}

/**
 * Analyse client-side bot indicators from metadata
 * @param {object} metadata - Event metadata containing bot indicators
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseClientIndicators(metadata) {
  if (!metadata?.botIndicators) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const indicators = metadata.botIndicators;
  const signals = [];
  let score = 0;

  // Check for webdriver property
  if (indicators.webdriver === true) {
    signals.push('webdriver_detected');
    score += 40;
  }

  // Check for automation properties
  if (indicators.automationControlled === true) {
    signals.push('automation_controlled');
    score += 40;
  }

  // Check for missing browser features
  if (indicators.plugins === 0) {
    signals.push('no_plugins');
    score += 10;
  }

  if (indicators.languages === false || indicators.languages === 0) {
    signals.push('no_languages');
    score += 15;
  }

  // Check for notification permission oddities
  if (indicators.notificationPermission === 'denied' && indicators.permissionTimestamp === 0) {
    signals.push('suspicious_permissions');
    score += 10;
  }

  // Touch support inconsistency (claims touch but is desktop)
  if (indicators.touchSupport === true && indicators.deviceType === 'desktop') {
    // This could be a false positive on some laptops, so low weight
    signals.push('touch_inconsistency');
    score += 5;
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals
  };
}

/**
 * Analyse journey behaviour for bot patterns
 * @param {object[]} events - Array of journey events
 * @returns {{ isBot: boolean, confidence: number, signals: string[], botType: string|null }}
 */
function analyseJourneyBehaviour(events) {
  if (!events || events.length === 0) {
    return { isBot: false, confidence: 0, signals: [], botType: null };
  }

  const signals = [];
  let score = 0;

  // Sort events by time
  const sorted = [...events].sort((a, b) =>
    new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
  );

  // 1. Check for impossibly fast navigation
  const pageViews = sorted.filter(e => e.event_type === 'page_view');
  if (pageViews.length >= 2) {
    let superFastCount = 0;
    for (let i = 1; i < pageViews.length; i++) {
      const timeDiff = new Date(pageViews[i].occurred_at).getTime() -
                       new Date(pageViews[i-1].occurred_at).getTime();
      // Less than 500ms between page views is suspicious
      if (timeDiff < 500) superFastCount++;
      // Less than 100ms is definitely automated
      if (timeDiff < 100) score += 15;
    }
    if (superFastCount >= 2) {
      signals.push('impossibly_fast_navigation');
      score += 25;
    }
  }

  // 2. Check for sequential URL crawling pattern
  const urls = pageViews.map(e => e.page_url).filter(Boolean);
  if (urls.length >= 5) {
    // Check if URLs follow a pattern (alphabetical, numerical, sitemap order)
    const isSequential = checkSequentialPattern(urls);
    if (isSequential) {
      signals.push('sequential_crawling');
      score += 20;
    }
  }

  // 3. Check for no engagement events
  const engagementEvents = sorted.filter(e =>
    ['scroll_depth', 'section_view', 'element_hover', 'cta_click'].includes(e.event_type)
  );

  if (pageViews.length >= 3 && engagementEvents.length === 0) {
    signals.push('no_engagement');
    score += 15;
  }

  // 4. Check for no heartbeats despite long session
  const heartbeats = sorted.filter(e => e.event_type === 'heartbeat');
  const sessionDuration = sorted.length >= 2 ?
    (new Date(sorted[sorted.length - 1].occurred_at).getTime() -
     new Date(sorted[0].occurred_at).getTime()) / 1000 : 0;

  // If session is > 2 minutes but no heartbeats, suspicious
  if (sessionDuration > 120 && heartbeats.length === 0) {
    signals.push('no_heartbeats_long_session');
    score += 20;
  }

  // 5. Check for uniform timing between events
  if (sorted.length >= 5) {
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(
        new Date(sorted[i].occurred_at).getTime() -
        new Date(sorted[i-1].occurred_at).getTime()
      );
    }

    // Calculate variance
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Very low variance suggests automation (humans are variable)
    if (stdDev < 100 && avg < 2000) {
      signals.push('uniform_timing');
      score += 25;
    }
  }

  // 6. Check for high page count with low time
  const pagesPerMinute = pageViews.length / (sessionDuration / 60 || 1);
  if (pagesPerMinute > 10) {
    signals.push('high_crawl_rate');
    score += 20;
  }

  // Determine bot type based on signals
  let botType = null;
  if (score >= 40) {
    if (signals.includes('sequential_crawling') || signals.includes('high_crawl_rate')) {
      botType = 'scraper';
    } else if (signals.includes('uniform_timing') || signals.includes('impossibly_fast_navigation')) {
      botType = 'automation';
    } else {
      botType = 'unknown';
    }
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals,
    botType
  };
}

/**
 * Check if URLs follow a sequential pattern
 */
function checkSequentialPattern(urls) {
  if (urls.length < 5) return false;

  // Extract path portions
  const paths = urls.map(u => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  });

  // Check for alphabetical ordering
  const sortedPaths = [...paths].sort();
  let matchCount = 0;
  for (let i = 0; i < paths.length; i++) {
    if (paths[i] === sortedPaths[i]) matchCount++;
  }

  // If 80%+ match sorted order, likely a crawler
  return matchCount / paths.length >= 0.8;
}

/**
 * Calculate overall bot score for an event
 * @param {object} params - Detection parameters
 * @returns {{ isBot: boolean, botScore: number, botType: string|null, signals: string[] }}
 */
function detectBotForEvent(params) {
  const { userAgent, ipAddress, metadata } = params;

  const allSignals = [];
  let totalScore = 0;
  let detectedType = null;

  // 1. User-Agent analysis (weight: 40%)
  const uaResult = analyseUserAgent(userAgent);
  allSignals.push(...uaResult.signals);
  totalScore += uaResult.confidence * 0.4;
  if (uaResult.botType && !detectedType) {
    detectedType = uaResult.botType;
  }

  // 2. IP analysis (weight: 20%)
  const ipResult = analyseIP(ipAddress);
  allSignals.push(...ipResult.signals);
  if (ipResult.isDatacenter) {
    totalScore += 20;
  }

  // 3. Client-side indicators (weight: 40%)
  const clientResult = analyseClientIndicators(metadata);
  allSignals.push(...clientResult.signals);
  totalScore += clientResult.confidence * 0.4;
  if (clientResult.isBot && !detectedType) {
    detectedType = 'automation';
  }

  const finalScore = Math.min(Math.round(totalScore), 100);

  return {
    isBot: finalScore >= 50 || (uaResult.isBot && uaResult.confidence >= 90),
    botScore: finalScore,
    botType: detectedType,
    signals: [...new Set(allSignals)] // Deduplicate
  };
}

/**
 * Calculate bot score for a complete journey
 * @param {object[]} events - All events in the journey
 * @returns {{ isBot: boolean, botScore: number, botType: string|null, signals: string[] }}
 */
function calculateJourneyBotScore(events) {
  if (!events || events.length === 0) {
    return { isBot: false, botScore: 0, botType: null, signals: [] };
  }

  const allSignals = [];
  let totalScore = 0;
  let detectedType = null;

  // 1. Check first event for User-Agent and IP
  const firstPageView = events.find(e => e.event_type === 'page_view');
  if (firstPageView) {
    const uaResult = analyseUserAgent(firstPageView.user_agent);
    allSignals.push(...uaResult.signals);
    totalScore += uaResult.confidence * 0.3;
    if (uaResult.botType) detectedType = uaResult.botType;

    const ipResult = analyseIP(firstPageView.ip_address);
    allSignals.push(...ipResult.signals);
    if (ipResult.isDatacenter) totalScore += 15;
  }

  // 2. Analyse behaviour patterns (weight: 50%)
  const behaviourResult = analyseJourneyBehaviour(events);
  allSignals.push(...behaviourResult.signals);
  totalScore += behaviourResult.confidence * 0.5;
  if (behaviourResult.botType && !detectedType) {
    detectedType = behaviourResult.botType;
  }

  // 3. Check client indicators from metadata (weight: 20%)
  for (const event of events) {
    if (event.metadata?.botIndicators) {
      const clientResult = analyseClientIndicators(event.metadata);
      allSignals.push(...clientResult.signals);
      totalScore += clientResult.confidence * 0.2;
      if (clientResult.isBot && !detectedType) {
        detectedType = 'automation';
      }
      break; // Only check first event with indicators
    }
  }

  const finalScore = Math.min(Math.round(totalScore), 100);

  // If we detected known bot from User-Agent, ensure high score
  if (detectedType && ['search_crawler', 'seo_tool', 'social_crawler', 'monitoring'].includes(detectedType)) {
    return {
      isBot: true,
      botScore: Math.max(finalScore, 90),
      botType: detectedType,
      signals: [...new Set(allSignals)]
    };
  }

  return {
    isBot: finalScore >= 50,
    botScore: finalScore,
    botType: finalScore >= 50 ? (detectedType || 'unknown') : null,
    signals: [...new Set(allSignals)]
  };
}

/**
 * Quick check if User-Agent is a known good bot (search engines, etc)
 * These bots we want to identify but may not want to filter out
 */
function isKnownGoodBot(userAgent) {
  if (!userAgent) return false;

  const goodBotPatterns = [
    /googlebot/i,
    /bingbot/i,
    /slurp/i,
    /duckduckbot/i,
    /facebookexternalhit/i,
    /twitterbot/i,
    /linkedinbot/i,
    /applebot/i,
  ];

  return goodBotPatterns.some(pattern => pattern.test(userAgent));
}

/**
 * Get human-readable bot classification
 */
function getBotTypeLabel(botType) {
  const labels = {
    search_crawler: 'Search Engine Crawler',
    seo_tool: 'SEO Tool',
    social_crawler: 'Social Media Crawler',
    monitoring: 'Monitoring Service',
    scraper: 'Web Scraper',
    automation: 'Automation/Headless Browser',
    unknown: 'Unknown Bot',
  };
  return labels[botType] || 'Unknown';
}

module.exports = {
  analyseUserAgent,
  analyseIP,
  analyseClientIndicators,
  analyseJourneyBehaviour,
  detectBotForEvent,
  calculateJourneyBotScore,
  isKnownGoodBot,
  getBotTypeLabel,
  KNOWN_BOTS,
  AUTOMATION_INDICATORS,
};

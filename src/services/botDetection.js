/**
 * Bot Detection Service
 *
 * Detects and classifies bot traffic using multiple signals:
 * 1. User-Agent Analysis - Known bot patterns
 * 2. Behavioural Analysis - Timing anomalies, no engagement
 * 3. Technical Signals - Automation indicators, datacenter IPs
 * 4. Fingerprint Analysis - Canvas/WebGL anomalies (ADVANCED)
 * 5. Mouse Movement Analysis - Straight lines vs natural curves (ADVANCED)
 * 6. Scroll Behaviour Analysis - Uniform vs burst patterns (ADVANCED)
 * 7. Honeypot Detection - Invisible link/field interactions (ADVANCED)
 * 8. JavaScript Challenge - Browser capability verification (ADVANCED)
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
  // Google/Googlebot IP ranges
  /^66\.249\./, // Googlebot primary range
  /^72\.14\./, // Google
  /^74\.125\./, // Google
  /^172\.217\./, // Google
  /^172\.253\./, // Google
  /^209\.85\./, // Google
  /^216\.239\./, // Google
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

// ============================================
// ADVANCED DETECTION: FINGERPRINT ANALYSIS
// ============================================

/**
 * Analyse browser fingerprint for bot indicators
 * @param {object} metadata - Event metadata containing fingerprint data
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseFingerprint(metadata) {
  const fingerprint = metadata?.botIndicators?.fingerprint || metadata?.fingerprint;
  if (!fingerprint) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  // Canvas fingerprint issues
  if (fingerprint.canvasSuspicious) {
    signals.push('canvas_suspicious');
    score += 25;
  }
  if (fingerprint.canvasError) {
    signals.push('canvas_error');
    score += 15;
  }

  // WebGL issues - headless browsers have distinctive signatures
  if (fingerprint.webglSuspicious) {
    signals.push('webgl_suspicious');
    score += 30;
  }
  if (fingerprint.webglMissing) {
    signals.push('webgl_missing');
    score += 20;
  }
  if (fingerprint.webglError) {
    signals.push('webgl_error');
    score += 15;
  }

  // SwiftShader is a software renderer used by headless Chrome
  if (fingerprint.webglRenderer?.includes('SwiftShader') ||
      fingerprint.webglRenderer?.includes('llvmpipe')) {
    signals.push('software_renderer');
    score += 35;
  }

  // No WebGL vendor/renderer at all
  if (fingerprint.webgl && !fingerprint.webglVendor && !fingerprint.webglRenderer) {
    signals.push('missing_webgl_info');
    score += 15;
  }

  // Screen resolution anomalies (common bot resolutions)
  const suspiciousResolutions = ['800x600', '1024x768', '0x0', '1x1'];
  if (suspiciousResolutions.includes(fingerprint.screenRes)) {
    signals.push('suspicious_resolution');
    score += 20;
  }

  // Missing platform info
  if (!fingerprint.platform || fingerprint.platform === '') {
    signals.push('missing_platform');
    score += 15;
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals
  };
}

// ============================================
// ADVANCED DETECTION: MOUSE MOVEMENT ANALYSIS
// ============================================

/**
 * Analyse mouse movement patterns for bot behaviour
 * @param {object} metadata - Event metadata containing mouse analysis
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseMousePatterns(metadata) {
  const mouseData = metadata?.botIndicators?.mousePatterns || metadata?.mouseAnalysis;
  if (!mouseData) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  // No mouse movement at all (strong bot indicator)
  if (mouseData.noMovement || mouseData.totalMovements === 0) {
    signals.push('no_mouse_movement');
    score += 30;
  }

  // Movements too straight (bots move in straight lines)
  if (mouseData.tooStraight || parseFloat(mouseData.straightLineRatio) > 0.9) {
    signals.push('mouse_too_straight');
    score += 25;
  }

  // Uniform timing between movements (humans are variable)
  if (mouseData.uniformTiming || parseFloat(mouseData.timingVariance) < 10) {
    // Only flag if there were enough movements to analyse
    if (mouseData.totalMovements > 5) {
      signals.push('mouse_uniform_timing');
      score += 20;
    }
  }

  // Impossibly fast mouse speed
  if (parseFloat(mouseData.maxSpeed) > 50) {
    signals.push('mouse_too_fast');
    score += 15;
  }

  // Zero distance moved but clicks happened (teleporting cursor)
  if (mouseData.totalDistance === 0 && mouseData.totalClicks > 0) {
    signals.push('mouse_teleport');
    score += 35;
  }

  // Very low movement count with many clicks
  if (mouseData.totalMovements < 3 && mouseData.totalClicks > 5) {
    signals.push('clicks_without_movement');
    score += 25;
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals
  };
}

// ============================================
// ADVANCED DETECTION: SCROLL BEHAVIOUR ANALYSIS
// ============================================

/**
 * Analyse scroll patterns for bot behaviour
 * @param {object} metadata - Event metadata containing scroll analysis
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseScrollPatterns(metadata) {
  const scrollData = metadata?.botIndicators?.scrollPatterns || metadata?.scrollAnalysis;
  if (!scrollData) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  // No scrolling at all
  if (scrollData.noScroll || scrollData.totalScrolls === 0) {
    signals.push('no_scroll');
    score += 20;
  }

  // Too uniform scrolling (bots scroll at constant rate)
  if (scrollData.tooUniform || parseFloat(scrollData.timingVariance) < 5) {
    if (scrollData.totalScrolls > 5) {
      signals.push('scroll_too_uniform');
      score += 25;
    }
  }

  // No direction changes (only scrolling down = scraping)
  if (scrollData.noDirectionChange || scrollData.directionChanges === 0) {
    if (scrollData.totalScrolls > 5) {
      signals.push('scroll_one_direction');
      score += 15;
    }
  }

  // Very high scroll speed (programmatic scrolling)
  if (parseFloat(scrollData.maxSpeed) > 100) {
    signals.push('scroll_too_fast');
    score += 20;
  }

  // High uniform scroll count (automated scrolling)
  if (scrollData.uniformCount > 10) {
    signals.push('scroll_programmatic');
    score += 30;
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals
  };
}

// ============================================
// ADVANCED DETECTION: HONEYPOT ANALYSIS
// ============================================

/**
 * Check if honeypot was triggered (definite bot)
 * @param {object} metadata - Event metadata
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseHoneypot(metadata) {
  const indicators = metadata?.botIndicators;
  if (!indicators) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  // Honeypot clicked = definite bot (invisible to humans)
  if (indicators.honeypotClicked === true) {
    signals.push('honeypot_triggered');
    score = 100; // Instant bot detection
  }

  return {
    isBot: score >= 50,
    confidence: score,
    signals
  };
}

// ============================================
// ADVANCED DETECTION: JS CHALLENGE ANALYSIS
// ============================================

/**
 * Analyse JavaScript challenge results
 * @param {object} metadata - Event metadata
 * @returns {{ isBot: boolean, confidence: number, signals: string[] }}
 */
function analyseJsChallenge(metadata) {
  const indicators = metadata?.botIndicators;
  if (!indicators) {
    return { isBot: false, confidence: 0, signals: [] };
  }

  const signals = [];
  let score = 0;

  // JS challenge failed
  if (indicators.jsChallengePassed === false) {
    signals.push('js_challenge_failed');
    score += 30;

    // Add specific failures
    const failures = indicators.jsChallengeFailures || indicators.jsChallenge?.failures || [];
    failures.forEach(failure => {
      signals.push(`js_fail:${failure}`);
    });

    // More failures = more suspicious
    score += Math.min(failures.length * 10, 40);
  }

  // Timing anomaly (loop executed too fast/slow)
  if (indicators.timingAnomaly === true) {
    signals.push('timing_anomaly');
    score += 25;
  }

  return {
    isBot: score >= 40,
    confidence: Math.min(score, 100),
    signals
  };
}

/**
 * Analyse journey behaviour for bot patterns
 * Uses session duration and engagement signals similar to Google Analytics bot filtering
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

  // Calculate session duration in seconds
  const sessionDuration = sorted.length >= 2 ?
    (new Date(sorted[sorted.length - 1].occurred_at).getTime() -
     new Date(sorted[0].occurred_at).getTime()) / 1000 : 0;

  // Get event counts by type
  const pageViews = sorted.filter(e => e.event_type === 'page_view' || e.event_type === 'pixel_view');
  const scrollEvents = sorted.filter(e => e.event_type === 'scroll_depth');
  const clickEvents = sorted.filter(e => e.event_type.includes('click'));
  const heartbeats = sorted.filter(e => e.event_type === 'heartbeat');
  const engagementEvents = sorted.filter(e =>
    ['scroll_depth', 'section_view', 'element_hover', 'cta_click', 'form_field_focus'].includes(e.event_type)
  );

  // ============================================
  // SESSION DURATION CHECKS (Google-style filtering)
  // ============================================

  // 1. Single event bounce - very likely bot or instant bounce
  if (sorted.length === 1) {
    signals.push('single_event_bounce');
    score += 40;  // High score - single events are suspicious
  }

  // 2. Very short session (under 10 seconds) with no engagement
  if (sessionDuration < 10 && sessionDuration > 0 && engagementEvents.length === 0) {
    signals.push('very_short_session_no_engagement');
    score += 35;
  }

  // 3. Short session (under 30 seconds) with no scroll
  if (sessionDuration < 30 && sessionDuration > 0 && scrollEvents.length === 0) {
    signals.push('short_session_no_scroll');
    score += 25;
  }

  // 4. Medium session (under 60 seconds) with absolutely no engagement
  if (sessionDuration >= 10 && sessionDuration < 60 && engagementEvents.length === 0) {
    signals.push('medium_session_no_engagement');
    score += 20;
  }

  // 5. Google-style threshold: session under 105 seconds with no meaningful engagement
  if (sessionDuration < 105 && scrollEvents.length === 0 && clickEvents.length === 0) {
    signals.push('below_quality_threshold');
    score += 15;
  }

  // ============================================
  // ENGAGEMENT CHECKS
  // ============================================

  // 6. No scroll events at all (humans almost always scroll)
  if (sorted.length > 2 && scrollEvents.length === 0) {
    signals.push('no_scroll_activity');
    score += 20;
  }

  // 7. No clicks on a page with CTAs
  if (pageViews.length >= 1 && clickEvents.length === 0 && sessionDuration > 30) {
    signals.push('no_click_activity');
    score += 10;
  }

  // 8. Page views but zero engagement events
  if (pageViews.length >= 2 && engagementEvents.length === 0) {
    signals.push('page_views_no_engagement');
    score += 25;
  }

  // ============================================
  // NAVIGATION PATTERN CHECKS
  // ============================================

  // 9. Check for impossibly fast navigation
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

  // 10. Check for sequential URL crawling pattern
  const urls = pageViews.map(e => e.page_url).filter(Boolean);
  if (urls.length >= 5) {
    const isSequential = checkSequentialPattern(urls);
    if (isSequential) {
      signals.push('sequential_crawling');
      score += 20;
    }
  }

  // 11. Check for no heartbeats despite long session
  if (sessionDuration > 120 && heartbeats.length === 0) {
    signals.push('no_heartbeats_long_session');
    score += 20;
  }

  // 12. Check for uniform timing between events (automation signature)
  if (sorted.length >= 5) {
    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(
        new Date(sorted[i].occurred_at).getTime() -
        new Date(sorted[i-1].occurred_at).getTime()
      );
    }

    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);

    // Very low variance suggests automation (humans are variable)
    if (stdDev < 100 && avg < 2000) {
      signals.push('uniform_timing');
      score += 25;
    }
  }

  // 13. Check for high page count with low time
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
    } else if (signals.includes('single_event_bounce') || signals.includes('very_short_session_no_engagement')) {
      botType = 'bounce_bot';
    } else if (signals.includes('no_scroll_activity') || signals.includes('no_engagement')) {
      botType = 'low_engagement';
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

  // ============================================
  // INSTANT BOT DETECTION (honeypot = 100% bot)
  // ============================================
  const honeypotResult = analyseHoneypot(metadata);
  if (honeypotResult.isBot) {
    return {
      isBot: true,
      botScore: 100,
      botType: 'scraper',
      signals: honeypotResult.signals
    };
  }

  // ============================================
  // STANDARD DETECTION
  // ============================================

  // 1. User-Agent analysis (weight: 25%)
  const uaResult = analyseUserAgent(userAgent);
  allSignals.push(...uaResult.signals);
  totalScore += uaResult.confidence * 0.25;
  if (uaResult.botType && !detectedType) {
    detectedType = uaResult.botType;
  }

  // 2. IP analysis (weight: 10%)
  const ipResult = analyseIP(ipAddress);
  allSignals.push(...ipResult.signals);
  if (ipResult.isDatacenter) {
    totalScore += 10;
  }

  // 3. Client-side indicators (weight: 15%)
  const clientResult = analyseClientIndicators(metadata);
  allSignals.push(...clientResult.signals);
  totalScore += clientResult.confidence * 0.15;
  if (clientResult.isBot && !detectedType) {
    detectedType = 'automation';
  }

  // ============================================
  // ADVANCED DETECTION (weight: 50% total)
  // ============================================

  // 4. Fingerprint analysis (weight: 15%)
  const fpResult = analyseFingerprint(metadata);
  allSignals.push(...fpResult.signals);
  totalScore += fpResult.confidence * 0.15;
  if (fpResult.isBot && !detectedType) {
    detectedType = 'automation';
  }

  // 5. Mouse movement analysis (weight: 15%)
  const mouseResult = analyseMousePatterns(metadata);
  allSignals.push(...mouseResult.signals);
  totalScore += mouseResult.confidence * 0.15;
  if (mouseResult.isBot && !detectedType) {
    detectedType = 'automation';
  }

  // 6. Scroll behaviour analysis (weight: 10%)
  const scrollResult = analyseScrollPatterns(metadata);
  allSignals.push(...scrollResult.signals);
  totalScore += scrollResult.confidence * 0.10;

  // 7. JavaScript challenge (weight: 10%)
  const jsResult = analyseJsChallenge(metadata);
  allSignals.push(...jsResult.signals);
  totalScore += jsResult.confidence * 0.10;
  if (jsResult.isBot && !detectedType) {
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
    crawler: 'Web Crawler',
    no_javascript: 'No JavaScript (Pixel Only)',
    unknown: 'Unknown Bot',
  };
  return labels[botType] || 'Unknown';
}

/**
 * Mark pixel-only journeys as bots
 * If a journey has pixel_view but no page_view events, JavaScript didn't run
 * This is a strong indicator of bot traffic (real browsers execute JS)
 * @param {object} db - Database connection
 * @param {number} siteId - Optional site ID filter
 * @returns {Promise<{marked: number, journeyIds: string[]}>}
 */
async function markPixelOnlyBotsInDB(db, siteId = null) {
  const siteFilter = siteId ? 'AND site_id = $1' : '';
  const params = siteId ? [siteId] : [];

  // Find journeys that have pixel_view but NO page_view events
  const pixelOnlyQuery = `
    SELECT DISTINCT journey_id
    FROM journey_events
    WHERE event_type = 'pixel_view'
      ${siteFilter}
      AND journey_id NOT IN (
        SELECT DISTINCT journey_id
        FROM journey_events
        WHERE event_type = 'page_view'
        ${siteFilter}
      )
      AND (is_bot = false OR is_bot IS NULL)
  `;

  const result = await db.query(pixelOnlyQuery, params);
  const journeyIds = result.rows.map(r => r.journey_id);

  if (journeyIds.length === 0) {
    return { marked: 0, journeyIds: [] };
  }

  // Mark these journeys as bots
  const placeholders = journeyIds.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(`
    UPDATE journey_events
    SET is_bot = true,
        bot_score = GREATEST(COALESCE(bot_score, 0), 85),
        bot_signals = array_append(COALESCE(bot_signals, ARRAY[]::text[]), 'pixel_only_no_js')
    WHERE journey_id IN (${placeholders})
  `, journeyIds);

  // Also update journeys table if it exists
  await db.query(`
    UPDATE journeys
    SET is_bot = true,
        bot_score = GREATEST(COALESCE(bot_score, 0), 85),
        bot_type = COALESCE(bot_type, 'no_javascript')
    WHERE journey_id IN (${placeholders})
  `, journeyIds).catch(() => {}); // Ignore if journeys table doesn't have the record

  return { marked: journeyIds.length, journeyIds };
}

module.exports = {
  // Standard detection
  analyseUserAgent,
  analyseIP,
  analyseClientIndicators,
  analyseJourneyBehaviour,
  detectBotForEvent,
  calculateJourneyBotScore,
  isKnownGoodBot,
  getBotTypeLabel,
  // Advanced detection
  analyseFingerprint,
  analyseMousePatterns,
  analyseScrollPatterns,
  analyseHoneypot,
  analyseJsChallenge,
  // Pixel-only bot detection
  markPixelOnlyBotsInDB,
  // Constants
  KNOWN_BOTS,
  AUTOMATION_INDICATORS,
};

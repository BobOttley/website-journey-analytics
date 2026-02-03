/**
 * Website Journey Analytics - Advanced Bot Detection Script
 * Version: 2.0
 *
 * ADVANCED BOT DETECTION FEATURES:
 * 1. Canvas & WebGL Fingerprinting - Detect headless browsers
 * 2. Mouse Movement Analysis - Bots move in straight lines or not at all
 * 3. Scroll Behaviour Analysis - Humans scroll in bursts, bots uniformly
 * 4. Honeypot Traps - Invisible links only bots click
 * 5. JavaScript Challenges - Require real JS execution
 *
 * Deploy via Google Tag Manager on All Pages
 */

(function() {
  "use strict";

  var ANALYTICS_ENDPOINT = "https://website-journey-analytics.onrender.com/api/event";
  var HEARTBEAT_INTERVAL = 30000;

  // ============================================
  // SESSION & JOURNEY MANAGEMENT
  // ============================================

  var journeyId = sessionStorage.getItem("wja_journey_id");
  if (!journeyId) {
    journeyId = "wja_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem("wja_journey_id", journeyId);
  }

  var deviceType = window.innerWidth < 768 ? "mobile" : (window.innerWidth < 1024 ? "tablet" : "desktop");

  // ============================================
  // BOT DETECTION DATA COLLECTORS
  // ============================================

  var botIndicators = {
    // Basic automation detection
    webdriver: navigator.webdriver === true,
    automationControlled: !!window.navigator.webdriver,
    plugins: navigator.plugins ? navigator.plugins.length : 0,
    languages: navigator.languages ? navigator.languages.length : 0,

    // Will be populated by collectors below
    fingerprint: null,
    mousePatterns: null,
    scrollPatterns: null,
    honeypotClicked: false,
    jsChallengePassed: false,
    timingAnomaly: false
  };

  // ============================================
  // 1. CANVAS & WEBGL FINGERPRINTING
  // ============================================

  function generateFingerprint() {
    var fp = {
      canvas: null,
      webgl: null,
      webglVendor: null,
      webglRenderer: null,
      screenRes: window.screen.width + "x" + window.screen.height,
      colorDepth: window.screen.colorDepth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
      cookiesEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack
    };

    // Canvas fingerprint
    try {
      var canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 50;
      var ctx = canvas.getContext("2d");

      // Draw some text and shapes
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Bot Detection Test", 2, 15);
      ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
      ctx.fillText("Bot Detection Test", 4, 17);

      // Get data URL hash
      var dataUrl = canvas.toDataURL();
      fp.canvas = hashString(dataUrl);

      // Headless browsers often return empty or identical canvas
      if (dataUrl === "data:," || dataUrl.length < 1000) {
        fp.canvasSuspicious = true;
      }
    } catch (e) {
      fp.canvasError = true;
    }

    // WebGL fingerprint
    try {
      var glCanvas = document.createElement("canvas");
      var gl = glCanvas.getContext("webgl") || glCanvas.getContext("experimental-webgl");

      if (gl) {
        var debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          fp.webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          fp.webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

          // Suspicious WebGL values
          if (!fp.webglRenderer ||
              fp.webglRenderer.includes("SwiftShader") ||
              fp.webglRenderer.includes("llvmpipe") ||
              fp.webglRenderer === "Google SwiftShader") {
            fp.webglSuspicious = true;
          }
        }

        // Get WebGL parameters hash
        var params = [
          gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
          gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS),
          gl.getParameter(gl.MAX_VARYING_VECTORS),
          gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS),
          gl.getParameter(gl.MAX_TEXTURE_SIZE)
        ];
        fp.webgl = hashString(params.join(","));
      } else {
        fp.webglMissing = true;
      }
    } catch (e) {
      fp.webglError = true;
    }

    return fp;
  }

  // Simple hash function
  function hashString(str) {
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  // ============================================
  // 2. MOUSE MOVEMENT ANALYSIS
  // ============================================

  var mouseData = {
    movements: [],
    clicks: [],
    lastX: 0,
    lastY: 0,
    totalDistance: 0,
    straightLineCount: 0,
    curveCount: 0,
    maxSpeed: 0,
    avgSpeed: 0,
    idleTime: 0,
    lastMoveTime: Date.now()
  };

  function trackMouseMovement(e) {
    var now = Date.now();
    var x = e.clientX;
    var y = e.clientY;

    if (mouseData.lastX !== 0) {
      var dx = x - mouseData.lastX;
      var dy = y - mouseData.lastY;
      var distance = Math.sqrt(dx * dx + dy * dy);
      var timeDelta = now - mouseData.lastMoveTime;
      var speed = timeDelta > 0 ? distance / timeDelta : 0;

      mouseData.totalDistance += distance;
      mouseData.maxSpeed = Math.max(mouseData.maxSpeed, speed);

      // Track movement patterns (only keep last 50)
      if (mouseData.movements.length < 50) {
        mouseData.movements.push({
          dx: dx,
          dy: dy,
          speed: speed,
          time: timeDelta
        });
      }

      // Detect straight lines vs curves
      // A curve has both dx and dy changing, straight line has one near zero
      if (Math.abs(dx) < 3 || Math.abs(dy) < 3) {
        mouseData.straightLineCount++;
      } else {
        mouseData.curveCount++;
      }
    }

    mouseData.lastX = x;
    mouseData.lastY = y;
    mouseData.lastMoveTime = now;
  }

  function trackMouseClick(e) {
    mouseData.clicks.push({
      x: e.clientX,
      y: e.clientY,
      time: Date.now()
    });
  }

  function getMouseAnalysis() {
    var total = mouseData.straightLineCount + mouseData.curveCount;
    var straightRatio = total > 0 ? mouseData.straightLineCount / total : 0;

    // Calculate average speed
    var speeds = mouseData.movements.map(function(m) { return m.speed; });
    var avgSpeed = speeds.length > 0 ? speeds.reduce(function(a, b) { return a + b; }, 0) / speeds.length : 0;

    // Calculate timing variance
    var times = mouseData.movements.map(function(m) { return m.time; });
    var avgTime = times.length > 0 ? times.reduce(function(a, b) { return a + b; }, 0) / times.length : 0;
    var timeVariance = 0;
    if (times.length > 1) {
      for (var i = 0; i < times.length; i++) {
        timeVariance += Math.pow(times[i] - avgTime, 2);
      }
      timeVariance = Math.sqrt(timeVariance / times.length);
    }

    return {
      totalMovements: mouseData.movements.length,
      totalClicks: mouseData.clicks.length,
      totalDistance: Math.round(mouseData.totalDistance),
      straightLineRatio: straightRatio.toFixed(2),
      avgSpeed: avgSpeed.toFixed(2),
      maxSpeed: mouseData.maxSpeed.toFixed(2),
      timingVariance: timeVariance.toFixed(2),
      // Bot indicators
      noMovement: mouseData.movements.length === 0,
      tooStraight: straightRatio > 0.9,
      uniformTiming: timeVariance < 10 && mouseData.movements.length > 5
    };
  }

  // ============================================
  // 3. SCROLL BEHAVIOUR ANALYSIS
  // ============================================

  var scrollData = {
    events: [],
    lastScrollY: 0,
    lastScrollTime: Date.now(),
    scrollBursts: 0,
    uniformScrolls: 0,
    maxScrollSpeed: 0,
    directions: []
  };

  function trackScroll() {
    var now = Date.now();
    var scrollY = window.scrollY || window.pageYOffset;
    var delta = scrollY - scrollData.lastScrollY;
    var timeDelta = now - scrollData.lastScrollTime;
    var speed = timeDelta > 0 ? Math.abs(delta) / timeDelta : 0;

    scrollData.maxScrollSpeed = Math.max(scrollData.maxScrollSpeed, speed);
    scrollData.directions.push(delta > 0 ? 1 : -1);

    // Track scroll events (last 30)
    if (scrollData.events.length < 30) {
      scrollData.events.push({
        delta: delta,
        speed: speed,
        time: timeDelta,
        position: scrollY
      });
    }

    // Detect burst vs uniform scrolling
    // Burst = quick succession of scrolls
    // Uniform = exact same intervals (bot-like)
    if (timeDelta < 100) {
      scrollData.scrollBursts++;
    }
    if (scrollData.events.length > 2) {
      var lastTwo = scrollData.events.slice(-2);
      if (Math.abs(lastTwo[0].time - lastTwo[1].time) < 5) {
        scrollData.uniformScrolls++;
      }
    }

    scrollData.lastScrollY = scrollY;
    scrollData.lastScrollTime = now;
  }

  function getScrollAnalysis() {
    var total = scrollData.events.length;

    // Calculate timing variance
    var times = scrollData.events.map(function(e) { return e.time; });
    var avgTime = times.length > 0 ? times.reduce(function(a, b) { return a + b; }, 0) / times.length : 0;
    var timeVariance = 0;
    if (times.length > 1) {
      for (var i = 0; i < times.length; i++) {
        timeVariance += Math.pow(times[i] - avgTime, 2);
      }
      timeVariance = Math.sqrt(timeVariance / times.length);
    }

    // Direction changes (humans change direction frequently)
    var directionChanges = 0;
    for (var j = 1; j < scrollData.directions.length; j++) {
      if (scrollData.directions[j] !== scrollData.directions[j-1]) {
        directionChanges++;
      }
    }

    return {
      totalScrolls: total,
      burstCount: scrollData.scrollBursts,
      uniformCount: scrollData.uniformScrolls,
      maxSpeed: scrollData.maxScrollSpeed.toFixed(2),
      timingVariance: timeVariance.toFixed(2),
      directionChanges: directionChanges,
      // Bot indicators
      noScroll: total === 0,
      tooUniform: timeVariance < 5 && total > 5,
      noDirectionChange: directionChanges === 0 && total > 5
    };
  }

  // ============================================
  // 4. HONEYPOT TRAPS
  // ============================================

  function injectHoneypots() {
    // Create invisible link that only bots would follow
    var honeypot = document.createElement("a");
    honeypot.href = "/wp-admin/secret-page-do-not-click";
    honeypot.id = "wja-hp-link";
    honeypot.setAttribute("aria-hidden", "true");
    honeypot.setAttribute("tabindex", "-1");
    honeypot.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:auto;";
    honeypot.textContent = "Admin";

    // Create invisible form field
    var honeypotInput = document.createElement("input");
    honeypotInput.type = "text";
    honeypotInput.name = "website_url";
    honeypotInput.id = "wja-hp-input";
    honeypotInput.setAttribute("autocomplete", "off");
    honeypotInput.setAttribute("tabindex", "-1");
    honeypotInput.style.cssText = "position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;";

    // Create hidden div that looks like content
    var honeypotDiv = document.createElement("div");
    honeypotDiv.id = "wja-hp-div";
    honeypotDiv.style.cssText = "position:absolute;left:-9999px;top:-9999px;font-size:0;line-height:0;";
    honeypotDiv.innerHTML = "<a href='/admin-login'>Login</a><a href='/sitemap-hidden.xml'>Sitemap</a>";

    document.body.appendChild(honeypot);
    document.body.appendChild(honeypotInput);
    document.body.appendChild(honeypotDiv);

    // Track honeypot interactions
    honeypot.addEventListener("click", function(e) {
      e.preventDefault();
      botIndicators.honeypotClicked = true;
      sendBotSignal("honeypot_click", "link");
    });

    honeypotInput.addEventListener("input", function() {
      botIndicators.honeypotClicked = true;
      sendBotSignal("honeypot_input", "form_field");
    });

    // Track clicks on hidden div links
    honeypotDiv.querySelectorAll("a").forEach(function(link) {
      link.addEventListener("click", function(e) {
        e.preventDefault();
        botIndicators.honeypotClicked = true;
        sendBotSignal("honeypot_click", "hidden_link");
      });
    });
  }

  function sendBotSignal(signalType, detail) {
    wjaTrackEvent({
      event_type: "error",
      page_url: window.location.href,
      metadata: {
        botSignal: signalType,
        detail: detail,
        botIndicators: botIndicators
      }
    });
  }

  // ============================================
  // 5. JAVASCRIPT CHALLENGES
  // ============================================

  function runJsChallenge() {
    var passed = true;
    var failures = [];

    // Challenge 1: Check if basic DOM APIs work correctly
    try {
      var testEl = document.createElement("div");
      testEl.innerHTML = "<span>test</span>";
      if (testEl.firstChild.tagName !== "SPAN") {
        passed = false;
        failures.push("dom_manipulation");
      }
    } catch (e) {
      passed = false;
      failures.push("dom_error");
    }

    // Challenge 2: Check timing APIs
    try {
      var perf = window.performance;
      if (!perf || !perf.now || typeof perf.now() !== "number") {
        passed = false;
        failures.push("performance_api");
      }
    } catch (e) {
      passed = false;
      failures.push("performance_error");
    }

    // Challenge 3: Check for proper event handling
    try {
      var eventSupport = "onload" in window && "onclick" in document.body;
      if (!eventSupport) {
        passed = false;
        failures.push("event_handling");
      }
    } catch (e) {
      passed = false;
      failures.push("event_error");
    }

    // Challenge 4: Check localStorage/sessionStorage
    try {
      var testKey = "wja_test_" + Date.now();
      sessionStorage.setItem(testKey, "1");
      var retrieved = sessionStorage.getItem(testKey);
      sessionStorage.removeItem(testKey);
      if (retrieved !== "1") {
        passed = false;
        failures.push("storage");
      }
    } catch (e) {
      // Storage blocked is OK (privacy mode)
    }

    // Challenge 5: Check requestAnimationFrame
    try {
      if (typeof window.requestAnimationFrame !== "function") {
        passed = false;
        failures.push("raf");
      }
    } catch (e) {
      passed = false;
      failures.push("raf_error");
    }

    // Challenge 6: Timing anomaly detection
    var startTime = performance.now();
    var iterations = 10000;
    var sum = 0;
    for (var i = 0; i < iterations; i++) {
      sum += Math.sqrt(i);
    }
    var duration = performance.now() - startTime;

    // If loop runs too fast (<1ms) or too slow (>100ms), suspicious
    if (duration < 1 || duration > 100) {
      botIndicators.timingAnomaly = true;
      failures.push("timing_anomaly");
    }

    botIndicators.jsChallengePassed = passed;
    botIndicators.jsChallengeFailures = failures;

    return {
      passed: passed,
      failures: failures,
      loopDuration: duration.toFixed(2)
    };
  }

  // ============================================
  // EVENT SENDING
  // ============================================

  window.wjaTrackEvent = function(data) {
    var payload = {
      journey_id: journeyId,
      device_type: deviceType,
      occurred_at: new Date().toISOString()
    };

    // Merge data
    for (var key in data) {
      if (data.hasOwnProperty(key)) {
        payload[key] = data[key];
      }
    }

    // Add bot indicators to metadata
    if (!payload.metadata) {
      payload.metadata = {};
    }
    payload.metadata.botIndicators = botIndicators;

    try {
      navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify(payload));
    } catch (e) {
      // Fallback to fetch
      fetch(ANALYTICS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        keepalive: true
      }).catch(function() {});
    }
  };

  // ============================================
  // INITIALISATION
  // ============================================

  // Generate fingerprint
  botIndicators.fingerprint = generateFingerprint();

  // Run JS challenge
  botIndicators.jsChallenge = runJsChallenge();

  // Inject honeypots after DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectHoneypots);
  } else {
    injectHoneypots();
  }

  // Set up mouse tracking
  document.addEventListener("mousemove", trackMouseMovement, { passive: true });
  document.addEventListener("click", trackMouseClick, { passive: true });

  // Set up scroll tracking
  window.addEventListener("scroll", trackScroll, { passive: true });

  // ============================================
  // SEND INITIAL PAGE VIEW
  // ============================================

  wjaTrackEvent({
    event_type: "page_view",
    page_url: window.location.href,
    referrer: document.referrer,
    metadata: {
      botIndicators: botIndicators,
      fingerprint: botIndicators.fingerprint
    }
  });

  // ============================================
  // HEARTBEAT WITH BEHAVIOUR DATA
  // ============================================

  var heartbeatTimer = setInterval(function() {
    if (document.visibilityState === "visible") {
      // Update behaviour analysis before sending
      botIndicators.mousePatterns = getMouseAnalysis();
      botIndicators.scrollPatterns = getScrollAnalysis();

      wjaTrackEvent({
        event_type: "heartbeat",
        page_url: window.location.href,
        metadata: {
          botIndicators: botIndicators,
          mouseAnalysis: botIndicators.mousePatterns,
          scrollAnalysis: botIndicators.scrollPatterns
        }
      });
    }
  }, HEARTBEAT_INTERVAL);

  // Visibility handling
  document.addEventListener("visibilitychange", function() {
    if (document.visibilityState === "hidden") {
      clearInterval(heartbeatTimer);

      // Send final behaviour data on page hide
      botIndicators.mousePatterns = getMouseAnalysis();
      botIndicators.scrollPatterns = getScrollAnalysis();

      wjaTrackEvent({
        event_type: "page_exit",
        page_url: window.location.href,
        metadata: {
          botIndicators: botIndicators,
          mouseAnalysis: botIndicators.mousePatterns,
          scrollAnalysis: botIndicators.scrollPatterns,
          timeOnPage: Date.now() - parseInt(journeyId.split("_")[1])
        }
      });
    } else {
      heartbeatTimer = setInterval(function() {
        if (document.visibilityState === "visible") {
          botIndicators.mousePatterns = getMouseAnalysis();
          botIndicators.scrollPatterns = getScrollAnalysis();

          wjaTrackEvent({
            event_type: "heartbeat",
            page_url: window.location.href,
            metadata: {
              botIndicators: botIndicators,
              mouseAnalysis: botIndicators.mousePatterns,
              scrollAnalysis: botIndicators.scrollPatterns
            }
          });
        }
      }, HEARTBEAT_INTERVAL);
    }
  });

  // ============================================
  // CTA CLICK TRACKING
  // ============================================

  document.addEventListener("click", function(e) {
    var btn = e.target.closest("button, a.btn, .btn, [class*='btn'], a[href*='contact'], a[href*='book'], a[href*='enquir']");
    if (btn && btn.id !== "wja-hp-link") {
      var label = btn.textContent.trim();
      var href = btn.href || "";
      var combined = (label + " " + href).toLowerCase();

      var intent = "explore";
      if (/demo|trial|free/i.test(combined)) {
        intent = "demo";
      } else if (/book|visit|tour|open\s*day/i.test(combined)) {
        intent = "book_visit";
      } else if (/enquir|contact|get\s*in\s*touch/i.test(combined)) {
        intent = "enquire";
      } else if (/prospectus|brochure|download/i.test(combined)) {
        intent = "prospectus";
      } else if (/apply|application|register/i.test(combined)) {
        intent = "apply";
      } else if (/calculat|quote|price/i.test(combined)) {
        intent = "calculate";
      }

      wjaTrackEvent({
        event_type: "cta_click",
        page_url: window.location.href,
        cta_label: label.substring(0, 100),
        intent_type: intent,
        metadata: {
          botIndicators: botIndicators,
          mouseAnalysis: getMouseAnalysis(),
          clickPosition: { x: e.clientX, y: e.clientY }
        }
      });
    }
  });

})();

/**
 * Website Journey Analytics - Comprehensive Tracking Script
 * Version: 2.0
 *
 * Tracks: page views, scroll depth, time on page, clicks, forms, videos,
 * rage clicks, exit intent, copy/paste, hover time, UTM params, and more.
 */

(function() {
  'use strict';

  // ============ CONFIGURATION ============
  const CONFIG = {
    endpoint: 'https://website-journey-analytics.onrender.com/api/event',
    heartbeatInterval: 30000,        // 30 seconds
    scrollThresholds: [25, 50, 75, 90, 100],
    hoverThreshold: 2000,            // 2 seconds to count as meaningful hover
    rageClickThreshold: 3,           // 3 clicks within rageClickWindow
    rageClickWindow: 500,            // 500ms window for rage click detection
    sectionViewThreshold: 1000,      // 1 second in viewport to count as viewed
    idleTimeout: 60000,              // 60 seconds of no activity = idle
  };

  // ============ STATE ============
  const state = {
    visitorId: null,
    journeyId: null,
    visitNumber: 1,
    deviceInfo: {},
    utmParams: {},
    pageLoadTime: Date.now(),
    lastActivity: Date.now(),
    scrollDepthReached: new Set(),
    sectionsViewed: new Set(),
    clickTimes: [],
    heartbeatTimer: null,
    isIdle: false,
    formFields: new Map(),
    activeHovers: new Map(),
  };

  // ============ UTILITIES ============
  function generateId(prefix) {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function getVisitorId() {
    if (!state.visitorId) {
      state.visitorId = localStorage.getItem('wja_visitor_id');
      if (!state.visitorId) {
        state.visitorId = generateId('vis');
        localStorage.setItem('wja_visitor_id', state.visitorId);
      }
    }
    return state.visitorId;
  }

  function getJourneyId() {
    if (!state.journeyId) {
      state.journeyId = sessionStorage.getItem('wja_journey_id');
      if (!state.journeyId) {
        state.journeyId = generateId('jrn');
        sessionStorage.setItem('wja_journey_id', state.journeyId);
        // Increment visit count
        let visits = parseInt(localStorage.getItem('wja_visit_count') || '0', 10) + 1;
        localStorage.setItem('wja_visit_count', visits.toString());
        state.visitNumber = visits;
      } else {
        state.visitNumber = parseInt(localStorage.getItem('wja_visit_count') || '1', 10);
      }
    }
    return state.journeyId;
  }

  function getDeviceInfo() {
    if (!state.deviceInfo.type) {
      const width = window.innerWidth;
      const ua = navigator.userAgent;

      state.deviceInfo = {
        type: width < 768 ? 'mobile' : (width < 1024 ? 'tablet' : 'desktop'),
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        pixelRatio: window.devicePixelRatio || 1,
        language: navigator.language,
        platform: navigator.platform,
        cookiesEnabled: navigator.cookieEnabled,
        online: navigator.onLine,
        connection: getConnectionInfo(),
        browser: detectBrowser(ua),
        os: detectOS(ua),
      };
    }
    return state.deviceInfo;
  }

  function getConnectionInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      return {
        effectiveType: conn.effectiveType,
        downlink: conn.downlink,
        rtt: conn.rtt,
        saveData: conn.saveData
      };
    }
    return null;
  }

  function detectBrowser(ua) {
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg')) return 'Edge';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Opera') || ua.includes('OPR')) return 'Opera';
    return 'Unknown';
  }

  function detectOS(ua) {
    if (ua.includes('Windows')) return 'Windows';
    if (ua.includes('Mac')) return 'macOS';
    if (ua.includes('Linux')) return 'Linux';
    if (ua.includes('Android')) return 'Android';
    if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    return 'Unknown';
  }

  function getUtmParams() {
    if (Object.keys(state.utmParams).length === 0) {
      const params = new URLSearchParams(window.location.search);
      const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
      utmKeys.forEach(key => {
        const value = params.get(key);
        if (value) state.utmParams[key] = value;
      });

      // Store UTM params for the session
      if (Object.keys(state.utmParams).length > 0) {
        sessionStorage.setItem('wja_utm', JSON.stringify(state.utmParams));
      } else {
        // Try to retrieve from session if already stored
        const stored = sessionStorage.getItem('wja_utm');
        if (stored) state.utmParams = JSON.parse(stored);
      }
    }
    return state.utmParams;
  }

  function getScrollPercent() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    return scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
  }

  function getElementSelector(el) {
    if (!el) return null;
    if (el.id) return '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      return el.tagName.toLowerCase() + '.' + el.className.split(' ').filter(c => c).join('.');
    }
    return el.tagName.toLowerCase();
  }

  function getElementText(el) {
    if (!el) return null;
    const text = (el.textContent || el.innerText || '').trim();
    return text.substring(0, 100);
  }

  // ============ SEND EVENT ============
  function sendEvent(eventType, data = {}) {
    const deviceInfo = getDeviceInfo();
    const utmParams = getUtmParams();

    const payload = {
      visitor_id: getVisitorId(),
      journey_id: getJourneyId(),
      event_type: eventType,
      page_url: window.location.href,
      referrer: document.referrer || null,
      device_type: deviceInfo.type,
      occurred_at: new Date().toISOString(),
      metadata: {
        visit_number: state.visitNumber,
        ...data,
        device: deviceInfo,
        utm: Object.keys(utmParams).length > 0 ? utmParams : undefined,
      }
    };

    // Copy top-level fields if provided
    if (data.intent_type) payload.intent_type = data.intent_type;
    if (data.cta_label) payload.cta_label = data.cta_label;

    const jsonData = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([jsonData], { type: 'application/json' });
      navigator.sendBeacon(CONFIG.endpoint, blob);
    } else {
      fetch(CONFIG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonData,
        keepalive: true
      }).catch(() => {});
    }
  }

  // ============ PAGE VIEW & LOAD ============
  function trackPageView() {
    sendEvent('page_view', {
      title: document.title,
    });
  }

  function trackPageLoad() {
    // Wait for page to fully load
    if (document.readyState === 'complete') {
      sendLoadMetrics();
    } else {
      window.addEventListener('load', sendLoadMetrics);
    }
  }

  function sendLoadMetrics() {
    const perf = performance.getEntriesByType('navigation')[0] || performance.timing;
    if (perf) {
      const metrics = {};
      if (perf.domContentLoadedEventEnd) {
        metrics.domContentLoaded = Math.round(perf.domContentLoadedEventEnd - (perf.startTime || perf.navigationStart));
      }
      if (perf.loadEventEnd) {
        metrics.pageLoad = Math.round(perf.loadEventEnd - (perf.startTime || perf.navigationStart));
      }
      if (perf.domInteractive) {
        metrics.domInteractive = Math.round(perf.domInteractive - (perf.startTime || perf.navigationStart));
      }
      if (perf.responseEnd && perf.requestStart) {
        metrics.serverResponse = Math.round(perf.responseEnd - perf.requestStart);
      }

      if (Object.keys(metrics).length > 0) {
        sendEvent('page_load', { performance: metrics });
      }
    }
  }

  // ============ SCROLL TRACKING ============
  function trackScroll() {
    let scrollTimeout;

    window.addEventListener('scroll', function() {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(function() {
        const percent = getScrollPercent();

        CONFIG.scrollThresholds.forEach(threshold => {
          if (percent >= threshold && !state.scrollDepthReached.has(threshold)) {
            state.scrollDepthReached.add(threshold);
            sendEvent('scroll_depth', {
              depth_percent: threshold,
              actual_percent: percent,
            });
          }
        });
      }, 100);
    }, { passive: true });
  }

  // ============ SECTION VISIBILITY ============
  function trackSectionViews() {
    if (!('IntersectionObserver' in window)) return;

    const sections = document.querySelectorAll('section, [data-track-section], .track-section, article, main > div');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const el = entry.target;
        const id = el.id || el.dataset.section || getElementSelector(el);

        if (entry.isIntersecting && !state.sectionsViewed.has(id)) {
          // Wait for threshold time before marking as viewed
          el._viewTimer = setTimeout(() => {
            state.sectionsViewed.add(id);
            sendEvent('section_view', {
              section_id: id,
              section_text: getElementText(el.querySelector('h1, h2, h3, h4')),
            });
          }, CONFIG.sectionViewThreshold);
        } else if (!entry.isIntersecting && el._viewTimer) {
          clearTimeout(el._viewTimer);
        }
      });
    }, { threshold: 0.5 });

    sections.forEach(section => observer.observe(section));
  }

  // ============ CLICK TRACKING ============
  function trackClicks() {
    document.addEventListener('click', function(e) {
      const now = Date.now();
      state.lastActivity = now;

      // Rage click detection
      state.clickTimes.push(now);
      state.clickTimes = state.clickTimes.filter(t => now - t < CONFIG.rageClickWindow);

      if (state.clickTimes.length >= CONFIG.rageClickThreshold) {
        sendEvent('rage_click', {
          click_count: state.clickTimes.length,
          element: getElementSelector(e.target),
          position: { x: e.clientX, y: e.clientY },
        });
        state.clickTimes = [];
      }

      // Button/CTA clicks
      const btn = e.target.closest('button, a, [role="button"], .btn, input[type="submit"]');
      if (btn) {
        const href = btn.href || btn.getAttribute('href');
        const text = getElementText(btn);
        const isExternal = href && !href.includes(window.location.hostname) && href.startsWith('http');
        const isDownload = btn.hasAttribute('download') || /\.(pdf|doc|docx|xls|xlsx|zip|rar)$/i.test(href || '');

        let eventType = 'cta_click';
        let intentType = detectIntent(text, href);

        if (isDownload) {
          eventType = 'download_click';
          intentType = 'download';
        } else if (isExternal) {
          eventType = 'external_link';
          intentType = 'external';
        }

        sendEvent(eventType, {
          cta_label: text,
          intent_type: intentType,
          element: getElementSelector(btn),
          href: href,
          position: { x: e.clientX, y: e.clientY },
        });
      }

      // Accordion/Tab clicks
      const accordion = e.target.closest('[data-toggle], [data-accordion], .accordion-button, [role="tab"]');
      if (accordion) {
        sendEvent('accordion_open', {
          element: getElementSelector(accordion),
          text: getElementText(accordion),
        });
      }
    }, true);
  }

  function detectIntent(text, href) {
    const t = (text || '').toLowerCase();
    const h = (href || '').toLowerCase();

    if (/demo|trial|free/i.test(t + h)) return 'demo';
    if (/contact|enquir|get.in.touch/i.test(t + h)) return 'contact';
    if (/book|visit|tour|schedule/i.test(t + h)) return 'book_visit';
    if (/apply|register|sign.?up/i.test(t + h)) return 'apply';
    if (/prospectus|brochure/i.test(t + h)) return 'prospectus';
    if (/calculator|roi|estimate|quote/i.test(t + h)) return 'calculate';
    if (/pricing|plans|cost/i.test(t + h)) return 'enquire';
    return 'explore';
  }

  // ============ FORM TRACKING ============
  function trackForms() {
    document.addEventListener('focusin', function(e) {
      const field = e.target.closest('input, textarea, select');
      if (!field) return;

      const form = field.closest('form');
      if (!form) return;

      const formId = form.id || form.name || getElementSelector(form);
      const fieldName = field.name || field.id || field.type;

      // Track form start (first field focus)
      if (!state.formFields.has(formId)) {
        state.formFields.set(formId, new Map());
        sendEvent('form_start', {
          form_id: formId,
          form_action: form.action,
          intent_type: detectIntent(getElementText(form), form.action),
        });
      }

      // Track field focus
      const formFieldState = state.formFields.get(formId);
      if (!formFieldState.has(fieldName)) {
        formFieldState.set(fieldName, { focusTime: Date.now(), completed: false });

        sendEvent('form_field_focus', {
          form_id: formId,
          field_name: fieldName,
          field_type: field.type,
          field_index: Array.from(form.elements).indexOf(field),
        });
      }
    });

    document.addEventListener('focusout', function(e) {
      const field = e.target.closest('input, textarea, select');
      if (!field) return;

      const form = field.closest('form');
      if (!form) return;

      const formId = form.id || form.name || getElementSelector(form);
      const fieldName = field.name || field.id || field.type;
      const formFieldState = state.formFields.get(formId);

      if (formFieldState && formFieldState.has(fieldName)) {
        const fieldData = formFieldState.get(fieldName);
        const timeSpent = Date.now() - fieldData.focusTime;
        const hasValue = field.value && field.value.trim().length > 0;

        fieldData.completed = hasValue;
        fieldData.timeSpent = timeSpent;

        sendEvent('form_field_blur', {
          form_id: formId,
          field_name: fieldName,
          field_type: field.type,
          time_spent_ms: timeSpent,
          completed: hasValue,
        });
      }
    });

    document.addEventListener('submit', function(e) {
      const form = e.target.closest('form');
      if (!form) return;

      const formId = form.id || form.name || getElementSelector(form);
      const formFieldState = state.formFields.get(formId);

      let fieldsCompleted = 0;
      let totalFields = 0;
      let totalTime = 0;

      if (formFieldState) {
        formFieldState.forEach((data, field) => {
          totalFields++;
          if (data.completed) fieldsCompleted++;
          if (data.timeSpent) totalTime += data.timeSpent;
        });
      }

      sendEvent('form_submit', {
        form_id: formId,
        form_action: form.action,
        intent_type: detectIntent(getElementText(form), form.action),
        fields_completed: fieldsCompleted,
        total_fields: totalFields,
        total_time_ms: totalTime,
      });
    });
  }

  function trackFormAbandonment() {
    window.addEventListener('beforeunload', function() {
      state.formFields.forEach((fields, formId) => {
        let hasIncomplete = false;
        let completedCount = 0;
        let lastField = null;

        fields.forEach((data, fieldName) => {
          if (data.completed) {
            completedCount++;
          } else if (data.focusTime) {
            hasIncomplete = true;
            lastField = fieldName;
          }
        });

        if (hasIncomplete && completedCount > 0) {
          sendEvent('form_abandon', {
            form_id: formId,
            fields_completed: completedCount,
            last_field: lastField,
          });
        }
      });
    });
  }

  // ============ HOVER TRACKING ============
  function trackHovers() {
    document.addEventListener('mouseenter', function(e) {
      const el = e.target.closest('[data-track-hover], .track-hover, button, a, .card, .feature, .pricing');
      if (!el || el._hoverTracked) return;

      const id = el.id || getElementSelector(el);
      state.activeHovers.set(id, {
        element: el,
        startTime: Date.now(),
        sent: false,
      });
    }, true);

    document.addEventListener('mouseleave', function(e) {
      const el = e.target.closest('[data-track-hover], .track-hover, button, a, .card, .feature, .pricing');
      if (!el) return;

      const id = el.id || getElementSelector(el);
      const hoverData = state.activeHovers.get(id);

      if (hoverData && !hoverData.sent) {
        const duration = Date.now() - hoverData.startTime;
        if (duration >= CONFIG.hoverThreshold) {
          sendEvent('element_hover', {
            element: id,
            text: getElementText(el),
            duration_ms: duration,
          });
          hoverData.sent = true;
        }
      }

      state.activeHovers.delete(id);
    }, true);
  }

  // ============ EXIT INTENT ============
  function trackExitIntent() {
    let exitIntentFired = false;

    document.addEventListener('mouseout', function(e) {
      if (exitIntentFired) return;

      // Check if mouse left toward the top of the page (likely heading to close/back)
      if (e.clientY < 10 && e.relatedTarget === null) {
        exitIntentFired = true;
        sendEvent('exit_intent', {
          time_on_page_ms: Date.now() - state.pageLoadTime,
          scroll_depth: getScrollPercent(),
        });
      }
    });
  }

  // ============ COPY/PASTE TRACKING ============
  function trackCopyPaste() {
    document.addEventListener('copy', function(e) {
      const selection = window.getSelection().toString().trim();
      if (selection.length > 0) {
        sendEvent('copy_text', {
          text_length: selection.length,
          text_preview: selection.substring(0, 50),
        });
      }
    });
  }

  // ============ VIDEO TRACKING ============
  function trackVideos() {
    // Track HTML5 videos
    document.querySelectorAll('video').forEach(setupVideoTracking);

    // Track dynamically added videos
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeName === 'VIDEO') {
            setupVideoTracking(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('video').forEach(setupVideoTracking);
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Track YouTube embeds
    document.querySelectorAll('iframe[src*="youtube"]').forEach(iframe => {
      sendEvent('video_view', {
        video_type: 'youtube',
        video_src: iframe.src,
      });
    });
  }

  function setupVideoTracking(video) {
    if (video._wjaTracked) return;
    video._wjaTracked = true;

    const videoId = video.id || video.src || 'video_' + Math.random().toString(36).substr(2, 9);

    video.addEventListener('play', function() {
      sendEvent('video_play', {
        video_id: videoId,
        video_src: video.src,
        current_time: Math.round(video.currentTime),
        duration: Math.round(video.duration || 0),
      });
    });

    video.addEventListener('pause', function() {
      sendEvent('video_pause', {
        video_id: videoId,
        current_time: Math.round(video.currentTime),
        duration: Math.round(video.duration || 0),
        percent_watched: Math.round((video.currentTime / video.duration) * 100),
      });
    });

    video.addEventListener('ended', function() {
      sendEvent('video_complete', {
        video_id: videoId,
        duration: Math.round(video.duration || 0),
      });
    });
  }

  // ============ IMAGE VISIBILITY ============
  function trackImageViews() {
    if (!('IntersectionObserver' in window)) return;

    const images = document.querySelectorAll('img[data-track], .hero img, .banner img, [data-track-image]');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (!img._wjaViewed) {
            img._wjaViewed = true;
            sendEvent('image_view', {
              image_src: img.src,
              image_alt: img.alt,
              element: getElementSelector(img),
            });
          }
        }
      });
    }, { threshold: 0.5 });

    images.forEach(img => observer.observe(img));
  }

  // ============ HEARTBEAT ============
  function startHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);

    state.heartbeatTimer = setInterval(function() {
      if (document.visibilityState === 'visible') {
        const isIdle = (Date.now() - state.lastActivity) > CONFIG.idleTimeout;

        if (isIdle !== state.isIdle) {
          state.isIdle = isIdle;
          // Could track idle state changes if needed
        }

        sendEvent('heartbeat', {
          scroll_depth: getScrollPercent(),
          time_on_page_ms: Date.now() - state.pageLoadTime,
          is_idle: isIdle,
        });
      }
    }, CONFIG.heartbeatInterval);

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        clearInterval(state.heartbeatTimer);
        state.heartbeatTimer = null;

        // Send time on page when leaving
        sendEvent('time_on_page', {
          duration_ms: Date.now() - state.pageLoadTime,
          scroll_depth: getScrollPercent(),
          sections_viewed: Array.from(state.sectionsViewed),
        });
      } else if (!state.heartbeatTimer) {
        startHeartbeat();
      }
    });
  }

  // ============ ACTIVITY TRACKING ============
  function trackActivity() {
    ['mousemove', 'keydown', 'scroll', 'touchstart'].forEach(event => {
      document.addEventListener(event, function() {
        state.lastActivity = Date.now();
        state.isIdle = false;
      }, { passive: true });
    });
  }

  // ============ ERROR TRACKING ============
  function trackErrors() {
    window.addEventListener('error', function(e) {
      sendEvent('error', {
        error_message: e.message,
        error_source: e.filename,
        error_line: e.lineno,
        error_col: e.colno,
      });
    });
  }

  // ============ TAB VISIBILITY ============
  function trackTabSwitches() {
    let hiddenTime = null;

    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        hiddenTime = Date.now();
      } else if (hiddenTime) {
        const awayTime = Date.now() - hiddenTime;
        if (awayTime > 1000) {
          sendEvent('tab_switch', {
            away_duration_ms: awayTime,
          });
        }
        hiddenTime = null;
      }
    });
  }

  // ============ INITIALIZATION ============
  function init() {
    // Core tracking
    trackPageView();
    trackPageLoad();
    startHeartbeat();
    trackActivity();

    // Engagement tracking
    trackScroll();
    trackSectionViews();
    trackHovers();
    trackExitIntent();

    // Interaction tracking
    trackClicks();
    trackCopyPaste();
    trackForms();
    trackFormAbandonment();

    // Media tracking
    trackVideos();
    trackImageViews();

    // Technical tracking
    trackErrors();
    trackTabSwitches();
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API for manual tracking
  window.wjaTrackEvent = sendEvent;
  window.wjaGetVisitorId = getVisitorId;
  window.wjaGetJourneyId = getJourneyId;
  window.wjaGetVisitNumber = function() { return state.visitNumber; };

})();

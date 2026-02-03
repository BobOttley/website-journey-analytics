/**
 * Website Journey Analytics - GTM Tracking Script
 *
 * Install: Add this script to Google Tag Manager as a Custom HTML tag
 * Or include directly: <script src="https://website-journey-analytics.onrender.com/tracking.js"></script>
 *
 * Tracking:
 * - visitor_id: Stored in localStorage, persists forever (identifies the person)
 * - journey_id: Stored in sessionStorage, new each visit (identifies this session)
 * - visit_number: Incremented each new session for the same visitor
 */

(function() {
  'use strict';

  // Configuration
  const ANALYTICS_ENDPOINT = 'https://website-journey-analytics.onrender.com/api/event';
  const VISITOR_ID_KEY = 'wja_visitor_id';
  const JOURNEY_ID_KEY = 'wja_journey_id';
  const VISIT_COUNT_KEY = 'wja_visit_count';
  const HEARTBEAT_INTERVAL = 30 * 1000; // 30 seconds

  // CTA selectors to track (customize for your site)
  const CTA_SELECTORS = {
    enquire: '[data-cta="enquire"], a[href*="enquire"], .enquire-btn, .btn-enquire',
    prospectus: '[data-cta="prospectus"], a[href*="prospectus"], .prospectus-btn',
    book_visit: '[data-cta="book-visit"], a[href*="book-visit"], a[href*="open-day"], .visit-btn',
    apply: '[data-cta="apply"], a[href*="apply"], .apply-btn',
    contact: '[data-cta="contact"], a[href*="contact"], .contact-btn',
    demo: '[data-cta="demo"], a[href*="demo"], .demo-btn',
    calculate: '[data-cta="calculate"], a[href*="calculator"], a[href*="roi"], .calculator-btn'
  };

  // Form selectors to track
  const FORM_SELECTORS = {
    enquire: 'form[data-form="enquire"], #enquiry-form, .enquiry-form',
    book_visit: 'form[data-form="book-visit"], #visit-form, .visit-form',
    apply: 'form[data-form="apply"], #application-form, .application-form',
    contact: 'form[data-form="contact"], #contact-form, .contact-form',
    demo: 'form[data-form="demo"], #demo-form, .demo-form'
  };

  // Heartbeat timer reference
  let heartbeatTimer = null;

  // Utility functions
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // Get or create visitor ID (persists across sessions in localStorage)
  function getVisitorId() {
    let visitorId = localStorage.getItem(VISITOR_ID_KEY);
    if (!visitorId) {
      visitorId = 'vis_' + Date.now() + '_' + generateUUID().substring(0, 8);
      localStorage.setItem(VISITOR_ID_KEY, visitorId);
    }
    return visitorId;
  }

  // Get or create journey ID (new each session in sessionStorage)
  function getJourneyId() {
    let journeyId = sessionStorage.getItem(JOURNEY_ID_KEY);
    if (!journeyId) {
      // New session - create new journey and increment visit count
      journeyId = 'jrn_' + Date.now() + '_' + generateUUID().substring(0, 8);
      sessionStorage.setItem(JOURNEY_ID_KEY, journeyId);

      // Increment visit count for this visitor
      let visitCount = parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '0', 10);
      visitCount++;
      localStorage.setItem(VISIT_COUNT_KEY, visitCount.toString());
    }
    return journeyId;
  }

  // Get visit number for this visitor
  function getVisitNumber() {
    return parseInt(localStorage.getItem(VISIT_COUNT_KEY) || '1', 10);
  }

  function getDeviceType() {
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  function sendEvent(eventData) {
    const payload = {
      visitor_id: getVisitorId(),
      journey_id: getJourneyId(),
      visit_number: getVisitNumber(),
      device_type: getDeviceType(),
      occurred_at: new Date().toISOString(),
      ...eventData
    };

    // Use sendBeacon for reliability, fallback to fetch
    const data = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([data], { type: 'application/json' });
      navigator.sendBeacon(ANALYTICS_ENDPOINT, blob);
    } else {
      fetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: data,
        keepalive: true
      }).catch(function(err) {
        console.warn('Analytics event failed:', err);
      });
    }
  }

  // Track page view
  function trackPageView() {
    sendEvent({
      event_type: 'page_view',
      page_url: window.location.href,
      referrer: document.referrer || null
    });
  }

  // Heartbeat - sends every 30 seconds to track active visitors
  function startHeartbeat() {
    // Clear any existing heartbeat
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }

    // Send heartbeat every HEARTBEAT_INTERVAL
    heartbeatTimer = setInterval(function() {
      // Only send heartbeat if page is visible
      if (document.visibilityState === 'visible') {
        sendEvent({
          event_type: 'heartbeat',
          page_url: window.location.href
        });
      }
    }, HEARTBEAT_INTERVAL);

    // Stop heartbeat when page is hidden, resume when visible
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      } else {
        // Page became visible again, restart heartbeat
        if (!heartbeatTimer) {
          startHeartbeat();
        }
      }
    });
  }

  // Track CTA clicks
  function setupCtaTracking() {
    Object.entries(CTA_SELECTORS).forEach(function([intentType, selector]) {
      document.querySelectorAll(selector).forEach(function(element) {
        if (element.dataset.wjaTracked) return;
        element.dataset.wjaTracked = 'true';

        element.addEventListener('click', function(e) {
          sendEvent({
            event_type: 'cta_click',
            page_url: window.location.href,
            intent_type: intentType,
            cta_label: element.textContent.trim().substring(0, 100)
          });
        });
      });
    });
  }

  // Track form interactions
  function setupFormTracking() {
    Object.entries(FORM_SELECTORS).forEach(function([intentType, selector]) {
      document.querySelectorAll(selector).forEach(function(form) {
        if (form.dataset.wjaTracked) return;
        form.dataset.wjaTracked = 'true';

        // Track form start (first interaction)
        let formStarted = false;
        form.addEventListener('focusin', function() {
          if (!formStarted) {
            formStarted = true;
            sendEvent({
              event_type: 'form_start',
              page_url: window.location.href,
              intent_type: intentType
            });
          }
        });

        // Track form submit
        form.addEventListener('submit', function() {
          sendEvent({
            event_type: 'form_submit',
            page_url: window.location.href,
            intent_type: intentType
          });
        });
      });
    });
  }

  // Generic click tracking for buttons
  function setupGenericClickTracking() {
    document.addEventListener('click', function(e) {
      const btn = e.target.closest('button, a.btn, .btn, [role="button"]');
      if (btn && !btn.dataset.wjaTracked) {
        const label = btn.textContent.trim();
        let intent = 'explore';
        if (/demo/i.test(label)) intent = 'demo';
        else if (/contact/i.test(label)) intent = 'contact';
        else if (/calculator|roi/i.test(label)) intent = 'calculate';
        else if (/enquir/i.test(label)) intent = 'enquire';
        else if (/book|visit|tour/i.test(label)) intent = 'book_visit';
        else if (/apply/i.test(label)) intent = 'apply';
        else if (/prospectus/i.test(label)) intent = 'prospectus';

        sendEvent({
          event_type: 'cta_click',
          page_url: window.location.href,
          cta_label: label.substring(0, 100),
          intent_type: intent
        });
      }
    });
  }

  // Initialize tracking
  function init() {
    // Track initial page view
    trackPageView();

    // Start heartbeat for real-time tracking
    startHeartbeat();

    // Setup click and form tracking
    setupCtaTracking();
    setupFormTracking();
    setupGenericClickTracking();

    // Re-run setup after dynamic content loads
    if (window.MutationObserver) {
      const observer = new MutationObserver(function(mutations) {
        let shouldResetup = false;
        mutations.forEach(function(mutation) {
          if (mutation.addedNodes.length > 0) {
            shouldResetup = true;
          }
        });
        if (shouldResetup) {
          setupCtaTracking();
          setupFormTracking();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    // Track page visibility for time-on-page
    let pageLoadTime = Date.now();
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState === 'hidden') {
        const timeOnPage = Math.round((Date.now() - pageLoadTime) / 1000);
        sendEvent({
          event_type: 'time_on_page',
          page_url: window.location.href,
          cta_label: timeOnPage.toString() // Store duration in cta_label field
        });
      }
    });
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual event tracking
  window.wjaTrackEvent = sendEvent;
  window.wjaGetVisitorId = getVisitorId;
  window.wjaGetJourneyId = getJourneyId;
  window.wjaGetVisitNumber = getVisitNumber;

})();

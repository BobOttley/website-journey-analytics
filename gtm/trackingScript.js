/**
 * Website Journey Analytics - GTM Tracking Script
 *
 * Install: Add this script to Google Tag Manager as a Custom HTML tag
 * Configure: Set ANALYTICS_ENDPOINT to your server URL
 */

(function() {
  'use strict';

  // Configuration
  const ANALYTICS_ENDPOINT = 'http://localhost:3000/api/event';
  const JOURNEY_ID_KEY = 'wja_journey_id';
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  // CTA selectors to track (customize for your site)
  const CTA_SELECTORS = {
    enquire: '[data-cta="enquire"], a[href*="enquire"], .enquire-btn, .btn-enquire',
    prospectus: '[data-cta="prospectus"], a[href*="prospectus"], .prospectus-btn',
    book_visit: '[data-cta="book-visit"], a[href*="book-visit"], a[href*="open-day"], .visit-btn',
    apply: '[data-cta="apply"], a[href*="apply"], .apply-btn',
    contact: '[data-cta="contact"], a[href*="contact"], .contact-btn'
  };

  // Form selectors to track
  const FORM_SELECTORS = {
    enquire: 'form[data-form="enquire"], #enquiry-form, .enquiry-form',
    book_visit: 'form[data-form="book-visit"], #visit-form, .visit-form',
    apply: 'form[data-form="apply"], #application-form, .application-form',
    contact: 'form[data-form="contact"], #contact-form, .contact-form'
  };

  // Utility functions
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getJourneyId() {
    let journeyId = sessionStorage.getItem(JOURNEY_ID_KEY);
    const lastActivity = sessionStorage.getItem(JOURNEY_ID_KEY + '_time');

    // Check for session timeout
    if (journeyId && lastActivity) {
      const elapsed = Date.now() - parseInt(lastActivity, 10);
      if (elapsed > SESSION_TIMEOUT) {
        journeyId = null;
      }
    }

    if (!journeyId) {
      journeyId = generateUUID();
      sessionStorage.setItem(JOURNEY_ID_KEY, journeyId);
    }

    sessionStorage.setItem(JOURNEY_ID_KEY + '_time', Date.now().toString());
    return journeyId;
  }

  function getDeviceType() {
    const width = window.innerWidth;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  function sendEvent(eventData) {
    const payload = {
      journey_id: getJourneyId(),
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

  // Initialize tracking
  function init() {
    // Track initial page view
    trackPageView();

    // Setup click and form tracking
    setupCtaTracking();
    setupFormTracking();

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

})();

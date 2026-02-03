/**
 * Website Journey Analytics - More House School GTM Script
 * Version: 1.0
 *
 * Lightweight tracking script optimised for More House School website
 * Designed for Google Tag Manager deployment
 *
 * Tracks: page views, heartbeats, CTA clicks with school-specific intent detection
 *
 * CTAs detected:
 * - "Book Now", "Book Your Place", "Visit Us" → book_visit
 * - "Enquire Now", "Get in Touch" → enquire
 * - "Request Prospectus" → prospectus
 * - "Apply Now" → apply
 * - "Contact Us" → contact
 */

(function() {
  var ANALYTICS_ENDPOINT = 'https://website-journey-analytics.onrender.com/api/event';
  var HEARTBEAT_INTERVAL = 30000; // 30 seconds

  // Generate or retrieve journey ID
  var journeyId = sessionStorage.getItem('wja_journey_id');
  if (!journeyId) {
    journeyId = 'wja_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    sessionStorage.setItem('wja_journey_id', journeyId);
  }

  // Device type
  var deviceType = window.innerWidth < 768 ? 'mobile' : (window.innerWidth < 1024 ? 'tablet' : 'desktop');

  // Send event function
  window.wjaTrackEvent = function(data) {
    var payload = Object.assign({
      journey_id: journeyId,
      device_type: deviceType,
      occurred_at: new Date().toISOString()
    }, data);

    navigator.sendBeacon(ANALYTICS_ENDPOINT, JSON.stringify(payload));
  };

  // Track page view
  wjaTrackEvent({
    event_type: 'page_view',
    page_url: window.location.href,
    referrer: document.referrer
  });

  // Heartbeat - sends every 30 seconds for real-time tracking
  var heartbeatTimer = setInterval(function() {
    if (document.visibilityState === 'visible') {
      wjaTrackEvent({
        event_type: 'heartbeat',
        page_url: window.location.href
      });
    }
  }, HEARTBEAT_INTERVAL);

  // Stop heartbeat when page hidden, restart when visible
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      clearInterval(heartbeatTimer);
    } else {
      heartbeatTimer = setInterval(function() {
        if (document.visibilityState === 'visible') {
          wjaTrackEvent({
            event_type: 'heartbeat',
            page_url: window.location.href
          });
        }
      }, HEARTBEAT_INTERVAL);
    }
  });

  // Track CTA clicks - MORE HOUSE SPECIFIC
  document.addEventListener('click', function(e) {
    // Wide selector to catch all potential CTAs including links to booking/prospectus apps
    var btn = e.target.closest('button, a.btn, .btn, [class*="btn"], a[href*="enquir"], a[href*="prospectus"], a[href*="apply"], a[href*="book"], a[href*="visit"]');
    if (btn) {
      var label = btn.textContent.trim();
      var href = btn.href || '';
      var combined = (label + ' ' + href).toLowerCase();

      // More House specific intent detection
      var intent = 'explore';

      // Prospectus - "Request Prospectus", links to prospectus app
      if (/prospectus|brochure/i.test(combined)) {
        intent = 'prospectus';
      }
      // Booking - "Book Now", "Book Your Place", "Visit Us", links to smart-bookings
      else if (/book\s*(now|your|a|place)|visit\s*us|open\s*(day|morning|evening)|taster|smart-bookings/i.test(combined)) {
        intent = 'book_visit';
      }
      // Enquiry - "Enquire Now", links with intent=enquiry
      else if (/enquir|get\s*in\s*touch|find\s*out\s*more|intent=enquiry/i.test(combined)) {
        intent = 'enquire';
      }
      // Apply
      else if (/apply|application|register/i.test(combined)) {
        intent = 'apply';
      }
      // Contact
      else if (/contact|call\s*us|email\s*us/i.test(combined)) {
        intent = 'contact';
      }

      wjaTrackEvent({
        event_type: 'cta_click',
        page_url: window.location.href,
        cta_label: label.substring(0, 100),
        intent_type: intent
      });
    }
  });
})();

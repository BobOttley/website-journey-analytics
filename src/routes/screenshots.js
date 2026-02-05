/**
 * Screenshot Routes
 * API endpoints for capturing and viewing website screenshots
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const {
  captureAllSitePages,
  listScreenshots,
  getScreenshotPath,
  clearScreenshots,
  screenshotExists
} = require('../services/screenshotService');
const { getSiteId } = require('../middleware/auth');

/**
 * POST /screenshots/capture/:siteId
 * Trigger screenshot capture for all configured pages of a site
 */
router.post('/capture/:siteId', async (req, res) => {
  try {
    const siteId = req.params.siteId;

    // Check if user has access to this site
    const userSiteId = getSiteId(req);
    if (userSiteId && String(userSiteId) !== String(siteId)) {
      return res.status(403).json({ success: false, error: 'Access denied to this site' });
    }

    console.log(`[Screenshots] Starting capture for site ${siteId}`);

    const results = await captureAllSitePages(siteId);

    res.json({
      success: results.success,
      siteId,
      siteName: results.siteName,
      captured: results.captured?.length || 0,
      failed: results.failed?.length || 0,
      details: results
    });
  } catch (error) {
    console.error('[Screenshots] Capture error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /screenshots/:siteId
 * List all available screenshots for a site
 */
router.get('/:siteId', async (req, res) => {
  try {
    const siteId = req.params.siteId;

    // Check access
    const userSiteId = getSiteId(req);
    if (userSiteId && String(userSiteId) !== String(siteId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const screenshots = listScreenshots(siteId);

    res.json({
      success: true,
      siteId,
      count: screenshots.length,
      screenshots
    });
  } catch (error) {
    console.error('[Screenshots] List error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /screenshots/:siteId/view/:pageName
 * View a specific screenshot
 * pageName format: "homepage-desktop" or "admissions-fees-mobile"
 */
router.get('/:siteId/view/:pageName', async (req, res) => {
  try {
    const { siteId, pageName } = req.params;

    // Check access
    const userSiteId = getSiteId(req);
    if (userSiteId && String(userSiteId) !== String(siteId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Parse page name to determine path and type
    const isMobile = pageName.endsWith('-mobile');
    const pathPart = pageName.replace('-desktop', '').replace('-mobile', '');

    // Convert back to path format
    let pagePath = '/';
    if (pathPart !== 'homepage') {
      pagePath = '/' + pathPart.replace(/-/g, '/') + '/';
    }

    const screenshotPath = getScreenshotPath(siteId, pagePath, isMobile);

    if (!screenshotExists(siteId, pagePath, isMobile)) {
      return res.status(404).json({ success: false, error: 'Screenshot not found' });
    }

    res.sendFile(screenshotPath);
  } catch (error) {
    console.error('[Screenshots] View error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /screenshots/:siteId
 * Clear all screenshots for a site
 */
router.delete('/:siteId', async (req, res) => {
  try {
    const siteId = req.params.siteId;

    // Check access
    const userSiteId = getSiteId(req);
    if (userSiteId && String(userSiteId) !== String(siteId)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const result = clearScreenshots(siteId);

    res.json({
      success: result.success,
      siteId,
      message: result.message || 'Screenshots cleared'
    });
  } catch (error) {
    console.error('[Screenshots] Delete error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /screenshots/:siteId/status
 * Check screenshot capture status for a site
 */
router.get('/:siteId/status', async (req, res) => {
  try {
    const siteId = req.params.siteId;

    const screenshots = listScreenshots(siteId);
    const desktopCount = screenshots.filter(s => !s.isMobile).length;
    const mobileCount = screenshots.filter(s => s.isMobile).length;

    res.json({
      success: true,
      siteId,
      hasScreenshots: screenshots.length > 0,
      totalCount: screenshots.length,
      desktopCount,
      mobileCount,
      screenshots: screenshots.map(s => s.pageName)
    });
  } catch (error) {
    console.error('[Screenshots] Status error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;

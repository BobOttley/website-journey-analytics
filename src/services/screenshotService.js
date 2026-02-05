/**
 * Screenshot Service
 * Uses Puppeteer to capture screenshots of website pages for AI analysis
 */

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const fs = require('fs');
const path = require('path');
const siteStructureConfig = require('../config/siteStructure.json');

// Screenshot storage directory
const SCREENSHOTS_DIR = path.join(__dirname, '../../public/screenshots');

// Default viewport sizes
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_VIEWPORT = { width: 390, height: 844 };

/**
 * Get site configuration
 */
function getSiteConfig(siteId) {
  const id = String(siteId || siteStructureConfig.default);
  return siteStructureConfig.sites[id] || siteStructureConfig.sites[siteStructureConfig.default];
}

/**
 * Ensure screenshot directory exists
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Encode page path for use as filename
 * e.g. "/admissions/fees/" -> "admissions-fees"
 */
function encodePathForFilename(pagePath) {
  if (!pagePath || pagePath === '/') return 'homepage';
  return pagePath
    .replace(/^\//, '')      // Remove leading slash
    .replace(/\/$/, '')      // Remove trailing slash
    .replace(/\//g, '-')     // Replace slashes with dashes
    .replace(/[^a-z0-9-]/gi, '') // Remove special chars
    .toLowerCase();
}

/**
 * Get screenshot file path for a page
 */
function getScreenshotPath(siteId, pagePath, isMobile = false) {
  const filename = encodePathForFilename(pagePath);
  const suffix = isMobile ? '-mobile' : '-desktop';
  return path.join(SCREENSHOTS_DIR, String(siteId), `${filename}${suffix}.png`);
}

/**
 * Capture a single page screenshot
 */
async function captureScreenshot(url, outputPath, options = {}) {
  const viewport = options.viewport || DESKTOP_VIEWPORT;
  const fullPage = options.fullPage !== false; // Default to full page
  const waitFor = options.waitFor || 2000;

  let browser = null;

  try {
    // Use @sparticuz/chromium for cloud deployments (Render, Lambda, etc.)
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();

    // Set viewport
    await page.setViewport(viewport);

    // Set user agent (appear as real browser)
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Navigate to page - use 'domcontentloaded' for faster capture
    // 60 second timeout for slow sites on limited cloud resources
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for images and lazy content to load
    await page.evaluate((ms) => new Promise(r => setTimeout(r, ms)), waitFor + 3000);

    // Dismiss any cookie banners (common pattern)
    try {
      await page.evaluate(() => {
        const banners = document.querySelectorAll(
          '[class*="cookie"], [id*="cookie"], [class*="consent"], [id*="consent"], ' +
          '[class*="gdpr"], [id*="gdpr"], .cc-window, #onetrust-banner-sdk'
        );
        banners.forEach(el => {
          if (el.style) el.style.display = 'none';
        });
      });
    } catch (e) {
      // Ignore cookie banner dismissal errors
    }

    // Ensure output directory exists
    ensureDirectoryExists(path.dirname(outputPath));

    // Capture screenshot
    await page.screenshot({
      path: outputPath,
      fullPage: fullPage,
      type: 'png'
    });

    console.log(`[Screenshot] Captured: ${outputPath}`);
    return { success: true, path: outputPath };

  } catch (error) {
    console.error(`[Screenshot] Error capturing ${url}:`, error.message);
    return { success: false, error: error.message };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Capture all configured pages for a site
 */
async function captureAllSitePages(siteId) {
  const config = getSiteConfig(siteId);

  if (!config) {
    return { success: false, error: 'Site not found' };
  }

  const screenshotConfig = config.screenshotConfig || {};
  const baseUrl = config.siteUrl;
  const pages = config.pages || {};

  const results = {
    siteId,
    siteName: config.siteName,
    captured: [],
    failed: [],
    skipped: []
  };

  // Get pages to capture
  const pagesToCapture = Object.entries(pages)
    .filter(([path, info]) => info.captureScreenshot !== false)
    .map(([path, info]) => ({ path, name: info.name }));

  if (pagesToCapture.length === 0) {
    return { success: false, error: 'No pages configured for screenshot capture' };
  }

  console.log(`[Screenshot] Capturing ${pagesToCapture.length} pages for ${config.siteName}`);

  // Capture each page
  for (const page of pagesToCapture) {
    const url = baseUrl + page.path;

    // Desktop screenshot
    const desktopPath = getScreenshotPath(siteId, page.path, false);
    const desktopResult = await captureScreenshot(url, desktopPath, {
      viewport: screenshotConfig.viewport || DESKTOP_VIEWPORT,
      fullPage: true
    });

    if (desktopResult.success) {
      results.captured.push({ page: page.path, name: page.name, type: 'desktop', path: desktopPath });
    } else {
      results.failed.push({ page: page.path, name: page.name, type: 'desktop', error: desktopResult.error });
    }

    // Mobile screenshot (if enabled)
    if (screenshotConfig.captureMobile !== false) {
      const mobilePath = getScreenshotPath(siteId, page.path, true);
      const mobileResult = await captureScreenshot(url, mobilePath, {
        viewport: screenshotConfig.mobileViewport || MOBILE_VIEWPORT,
        fullPage: true
      });

      if (mobileResult.success) {
        results.captured.push({ page: page.path, name: page.name, type: 'mobile', path: mobilePath });
      } else {
        results.failed.push({ page: page.path, name: page.name, type: 'mobile', error: mobileResult.error });
      }
    }

    // Small delay between pages to be polite
    await new Promise(r => setTimeout(r, 500));
  }

  results.success = results.failed.length === 0;
  console.log(`[Screenshot] Completed: ${results.captured.length} captured, ${results.failed.length} failed`);

  return results;
}

/**
 * Get screenshot as base64 for Claude API
 */
function getScreenshotAsBase64(siteId, pagePath, isMobile = false) {
  const screenshotPath = getScreenshotPath(siteId, pagePath, isMobile);

  if (!fs.existsSync(screenshotPath)) {
    return null;
  }

  try {
    const imageBuffer = fs.readFileSync(screenshotPath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error(`[Screenshot] Error reading ${screenshotPath}:`, error.message);
    return null;
  }
}

/**
 * Check if screenshot exists for a page
 */
function screenshotExists(siteId, pagePath, isMobile = false) {
  const screenshotPath = getScreenshotPath(siteId, pagePath, isMobile);
  return fs.existsSync(screenshotPath);
}

/**
 * List all available screenshots for a site
 */
function listScreenshots(siteId) {
  const siteDir = path.join(SCREENSHOTS_DIR, String(siteId));

  if (!fs.existsSync(siteDir)) {
    return [];
  }

  try {
    const files = fs.readdirSync(siteDir);
    return files
      .filter(f => f.endsWith('.png'))
      .map(f => ({
        filename: f,
        path: path.join(siteDir, f),
        isMobile: f.includes('-mobile'),
        pageName: f.replace('-desktop.png', '').replace('-mobile.png', '')
      }));
  } catch (error) {
    console.error(`[Screenshot] Error listing screenshots:`, error.message);
    return [];
  }
}

/**
 * Get screenshots for AI analysis
 * Returns array of { pagePath, pageUrl, base64, type } objects
 */
function getScreenshotsForAnalysis(siteId, pageUrls = [], maxScreenshots = 5) {
  const config = getSiteConfig(siteId);
  if (!config) return [];

  const screenshots = [];
  const baseUrl = config.siteUrl || '';

  // Normalise page URLs to paths
  const pagePaths = pageUrls.map(url => {
    if (!url) return '/';
    try {
      const urlObj = new URL(url);
      return urlObj.pathname || '/';
    } catch {
      return url.startsWith('/') ? url : '/' + url;
    }
  });

  // Get unique paths
  const uniquePaths = [...new Set(pagePaths)];

  // Try to get screenshots for each path
  for (const pagePath of uniquePaths) {
    if (screenshots.length >= maxScreenshots) break;

    // Try desktop first
    const base64 = getScreenshotAsBase64(siteId, pagePath, false);
    if (base64) {
      screenshots.push({
        pagePath,
        pageUrl: baseUrl + pagePath,
        base64,
        type: 'desktop',
        mediaType: 'image/png'
      });
    }
  }

  return screenshots;
}

/**
 * Delete all screenshots for a site
 */
function clearScreenshots(siteId) {
  const siteDir = path.join(SCREENSHOTS_DIR, String(siteId));

  if (fs.existsSync(siteDir)) {
    try {
      fs.rmSync(siteDir, { recursive: true });
      console.log(`[Screenshot] Cleared screenshots for site ${siteId}`);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  return { success: true, message: 'No screenshots to clear' };
}

module.exports = {
  captureScreenshot,
  captureAllSitePages,
  getScreenshotPath,
  getScreenshotAsBase64,
  screenshotExists,
  listScreenshots,
  getScreenshotsForAnalysis,
  clearScreenshots,
  encodePathForFilename,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT
};

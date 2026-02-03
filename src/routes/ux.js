const express = require('express');
const router = express.Router();
const {
  getUXOverview,
  getDeadClicks,
  getCTAHesitations,
  getScrollBehaviour,
  getScrollBehaviourByPage,
  getScrollDepthByPage,
  getSectionVisibility,
  getQuickBacks,
  getSearchQueries,
  getTextSelections,
  getUXTrend,
  getExitPages,
  getFormAnalytics,
  getFormFieldAbandonment,
  getPDFDownloads,
  getVideoEngagement,
  getRageClicks,
  getReturnVisitorAnalytics
} = require('../db/queries');
const { getSiteId } = require('../middleware/auth');

// GET /ux - UX Analytics dashboard
router.get('/', async (req, res) => {
  try {
    const siteId = getSiteId(req);

    // Load all data for initial page render
    const [
      overview, deadClicks, hesitations, scrollBehaviour, scrollByPage, scrollDepth,
      sectionVisibility, quickBacks, searches, selections, trend, exitPages,
      formAnalytics, formAbandonment, pdfDownloads, videoEngagement, rageClicks, returnVisitors
    ] = await Promise.all([
      getUXOverview(siteId),
      getDeadClicks(siteId),
      getCTAHesitations(siteId),
      getScrollBehaviour(siteId),
      getScrollBehaviourByPage(siteId),
      getScrollDepthByPage(siteId),
      getSectionVisibility(siteId),
      getQuickBacks(siteId),
      getSearchQueries(siteId),
      getTextSelections(siteId),
      getUXTrend(siteId),
      getExitPages(siteId),
      getFormAnalytics(siteId),
      getFormFieldAbandonment(siteId),
      getPDFDownloads(siteId),
      getVideoEngagement(siteId),
      getRageClicks(siteId),
      getReturnVisitorAnalytics(siteId)
    ]);

    res.render('ux', {
      overview,
      deadClicks,
      hesitations,
      scrollBehaviour,
      scrollByPage,
      scrollDepth,
      sectionVisibility,
      quickBacks,
      searches,
      selections,
      trend,
      exitPages,
      formAnalytics,
      formAbandonment,
      pdfDownloads,
      videoEngagement,
      rageClicks,
      returnVisitors,
      currentPage: 'ux',
      title: 'UX Analytics - SMART Journey'
    });
  } catch (error) {
    console.error('Error loading UX dashboard:', error);
    res.status(500).render('error', { error: 'Failed to load UX analytics' });
  }
});

// API: Overview stats
router.get('/api/overview', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getUXOverview(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching UX overview:', error);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// API: Dead clicks
router.get('/api/dead-clicks', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getDeadClicks(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching dead clicks:', error);
    res.status(500).json({ error: 'Failed to fetch dead clicks' });
  }
});

// API: CTA hesitations
router.get('/api/hesitations', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getCTAHesitations(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching hesitations:', error);
    res.status(500).json({ error: 'Failed to fetch hesitations' });
  }
});

// API: Scroll behaviour
router.get('/api/scroll', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getScrollBehaviour(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching scroll behaviour:', error);
    res.status(500).json({ error: 'Failed to fetch scroll behaviour' });
  }
});

// API: Section visibility
router.get('/api/visibility', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getSectionVisibility(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching section visibility:', error);
    res.status(500).json({ error: 'Failed to fetch section visibility' });
  }
});

// API: Quick backs
router.get('/api/quick-backs', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getQuickBacks(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching quick backs:', error);
    res.status(500).json({ error: 'Failed to fetch quick backs' });
  }
});

// API: Search queries
router.get('/api/searches', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getSearchQueries(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching searches:', error);
    res.status(500).json({ error: 'Failed to fetch searches' });
  }
});

// API: Text selections
router.get('/api/selections', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getTextSelections(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching text selections:', error);
    res.status(500).json({ error: 'Failed to fetch text selections' });
  }
});

// API: 30-day trend
router.get('/api/trend', async (req, res) => {
  try {
    const siteId = getSiteId(req);
    const data = await getUXTrend(siteId);
    res.json(data);
  } catch (error) {
    console.error('Error fetching UX trend:', error);
    res.status(500).json({ error: 'Failed to fetch trend' });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { getLatestInsight, getAllInsights } = require('../db/queries');
const { runAnalysis } = require('../services/aiAnalysis');

// GET /insights - Insights dashboard
router.get('/', async (req, res) => {
  try {
    const latestInsight = await getLatestInsight();
    const allInsights = await getAllInsights(5);

    // Parse analysis_result JSON if present
    const parsedInsight = latestInsight ? {
      ...latestInsight,
      analysis_result: latestInsight.analysis_result
        ? JSON.parse(latestInsight.analysis_result)
        : null
    } : null;

    const parsedHistory = allInsights.map(insight => ({
      ...insight,
      analysis_result: insight.analysis_result
        ? JSON.parse(insight.analysis_result)
        : null
    }));

    res.render('insights', {
      insight: parsedInsight,
      history: parsedHistory,
      currentPage: 'insights',
      title: 'AI Insights - SMART Journey'
    });
  } catch (error) {
    console.error('Error loading insights:', error);
    res.status(500).render('error', { error: 'Failed to load insights' });
  }
});

// POST /insights/analyze - Run new analysis
router.post('/analyze', async (req, res) => {
  try {
    // Default to last 30 days
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await runAnalysis(startDate, endDate);

    if (result.success) {
      res.redirect('/insights?analyzed=true');
    } else {
      res.redirect('/insights?error=' + encodeURIComponent(result.error));
    }
  } catch (error) {
    console.error('Error running analysis:', error);
    res.redirect('/insights?error=' + encodeURIComponent(error.message));
  }
});

// API endpoint for running analysis
router.post('/api/analyze', async (req, res) => {
  try {
    const { start_date, end_date } = req.body;

    const endDate = end_date || new Date().toISOString().split('T')[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const result = await runAnalysis(startDate, endDate);

    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Error running analysis:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API endpoint to get latest insight
router.get('/api/latest', async (req, res) => {
  try {
    const latestInsight = await getLatestInsight();

    if (!latestInsight) {
      return res.status(404).json({ error: 'No insights found' });
    }

    res.json({
      ...latestInsight,
      analysis_result: latestInsight.analysis_result
        ? JSON.parse(latestInsight.analysis_result)
        : null
    });
  } catch (error) {
    console.error('Error fetching latest insight:', error);
    res.status(500).json({ error: 'Failed to fetch insight' });
  }
});

module.exports = router;

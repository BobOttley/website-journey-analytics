/**
 * Authentication Routes
 * Handles login, logout, and password management
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { verifyCredentials, requireAuth } = require('../middleware/auth');
const { getDb } = require('../db/database');

// GET /login - Show login form
router.get('/login', (req, res) => {
  // If already logged in, redirect to dashboard
  if (req.session && req.session.userId) {
    return res.redirect('/journeys');
  }

  res.render('login', {
    title: 'Login - SMART Journey',
    error: req.query.error || null,
    layout: false // Login page doesn't use the main layout
  });
});

// POST /login - Process login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect('/login?error=Please+enter+email+and+password');
  }

  try {
    const user = await verifyCredentials(email, password);

    if (!user) {
      return res.redirect('/login?error=Invalid+email+or+password');
    }

    // Set session data
    req.session.userId = user.id;
    req.session.userEmail = user.email;
    req.session.userName = user.name;
    req.session.userRole = user.role;

    // Redirect to original URL or dashboard
    const returnTo = req.session.returnTo || '/journeys';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (error) {
    console.error('Login error:', error);
    return res.redirect('/login?error=An+error+occurred');
  }
});

// GET /logout - Log out
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error destroying session:', err);
    }
    res.redirect('/login');
  });
});

// POST /switch-site - Change current site
router.post('/switch-site', requireAuth, async (req, res) => {
  const { site_id } = req.body;
  const db = getDb();

  try {
    // Verify user has access to this site
    const isAdmin = req.session.userRole === 'admin';

    if (isAdmin) {
      // Admin can access any site
      const siteExists = await db.query('SELECT id FROM sites WHERE id = $1', [site_id]);
      if (siteExists.rows.length > 0) {
        req.session.currentSiteId = parseInt(site_id);
      }
    } else {
      // Customer can only access assigned sites
      const hasAccess = await db.query(
        'SELECT 1 FROM user_sites WHERE user_id = $1 AND site_id = $2',
        [req.session.userId, site_id]
      );
      if (hasAccess.rows.length > 0) {
        req.session.currentSiteId = parseInt(site_id);
      }
    }

    // Redirect back to previous page or dashboard
    const referer = req.get('Referer') || '/journeys';
    res.redirect(referer);
  } catch (error) {
    console.error('Error switching site:', error);
    res.redirect('/journeys');
  }
});

// GET /change-password - Show change password form
router.get('/change-password', requireAuth, (req, res) => {
  res.render('changePassword', {
    title: 'Change Password - SMART Journey',
    currentPage: 'settings',
    success: req.query.success || null,
    error: req.query.error || null
  });
});

// POST /change-password - Process password change
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  const db = getDb();

  // Validation
  if (!current_password || !new_password || !confirm_password) {
    return res.redirect('/change-password?error=All+fields+are+required');
  }

  if (new_password !== confirm_password) {
    return res.redirect('/change-password?error=New+passwords+do+not+match');
  }

  if (new_password.length < 8) {
    return res.redirect('/change-password?error=Password+must+be+at+least+8+characters');
  }

  try {
    // Verify current password
    const userResult = await db.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [req.session.userId]
    );

    if (userResult.rows.length === 0) {
      return res.redirect('/change-password?error=User+not+found');
    }

    const isValid = await bcrypt.compare(current_password, userResult.rows[0].password_hash);
    if (!isValid) {
      return res.redirect('/change-password?error=Current+password+is+incorrect');
    }

    // Hash and save new password
    const newHash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.session.userId]);

    res.redirect('/change-password?success=Password+changed+successfully');
  } catch (error) {
    console.error('Error changing password:', error);
    res.redirect('/change-password?error=An+error+occurred');
  }
});

module.exports = router;

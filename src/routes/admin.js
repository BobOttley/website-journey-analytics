/**
 * Admin Routes
 * Site and user management for administrators
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

// Apply admin check to all routes
router.use(requireAdmin);

// ============================================
// SITE MANAGEMENT
// ============================================

// GET /admin/sites - List all sites
router.get('/sites', async (req, res) => {
  try {
    const db = getDb();
    const sites = await db.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM journeys j WHERE j.site_id = s.id) as journey_count,
        (SELECT COUNT(*) FROM user_sites us WHERE us.site_id = s.id) as user_count
      FROM sites s
      ORDER BY s.name
    `);

    res.render('admin/sites', {
      title: 'Site Management - SMART Journey',
      currentPage: 'admin',
      sites: sites.rows,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading sites:', error);
    res.status(500).render('error', { error: 'Failed to load sites' });
  }
});

// GET /admin/sites/new - New site form
router.get('/sites/new', (req, res) => {
  res.render('admin/siteForm', {
    title: 'Add Site - SMART Journey',
    currentPage: 'admin',
    site: null,
    error: req.query.error || null
  });
});

// POST /admin/sites - Create new site
router.post('/sites', async (req, res) => {
  try {
    const { name, domain } = req.body;
    const db = getDb();

    // Generate unique tracking key
    const trackingKey = `tk_${domain.replace(/\./g, '_').substring(0, 15)}_${crypto.randomBytes(6).toString('hex')}`;

    await db.query(
      'INSERT INTO sites (name, domain, tracking_key) VALUES ($1, $2, $3)',
      [name, domain.toLowerCase(), trackingKey]
    );

    res.redirect('/admin/sites?success=Site+created+successfully');
  } catch (error) {
    console.error('Error creating site:', error);
    if (error.code === '23505') {
      res.redirect('/admin/sites/new?error=A+site+with+this+domain+already+exists');
    } else {
      res.redirect('/admin/sites/new?error=Failed+to+create+site');
    }
  }
});

// GET /admin/sites/:id - Edit site form
router.get('/sites/:id', async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query('SELECT * FROM sites WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.redirect('/admin/sites?error=Site+not+found');
    }

    res.render('admin/siteForm', {
      title: 'Edit Site - SMART Journey',
      currentPage: 'admin',
      site: result.rows[0],
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading site:', error);
    res.redirect('/admin/sites?error=Failed+to+load+site');
  }
});

// POST /admin/sites/:id - Update site
router.post('/sites/:id', async (req, res) => {
  try {
    const { name, domain } = req.body;
    const db = getDb();

    await db.query(
      'UPDATE sites SET name = $1, domain = $2 WHERE id = $3',
      [name, domain.toLowerCase(), req.params.id]
    );

    res.redirect('/admin/sites?success=Site+updated+successfully');
  } catch (error) {
    console.error('Error updating site:', error);
    res.redirect(`/admin/sites/${req.params.id}?error=Failed+to+update+site`);
  }
});

// POST /admin/sites/:id/regenerate-key - Regenerate tracking key
router.post('/sites/:id/regenerate-key', async (req, res) => {
  try {
    const db = getDb();

    // Get current domain
    const siteResult = await db.query('SELECT domain FROM sites WHERE id = $1', [req.params.id]);
    if (siteResult.rows.length === 0) {
      return res.redirect('/admin/sites?error=Site+not+found');
    }

    const domain = siteResult.rows[0].domain;
    const newKey = `tk_${domain.replace(/\./g, '_').substring(0, 15)}_${crypto.randomBytes(6).toString('hex')}`;

    await db.query('UPDATE sites SET tracking_key = $1 WHERE id = $2', [newKey, req.params.id]);

    res.redirect('/admin/sites?success=Tracking+key+regenerated');
  } catch (error) {
    console.error('Error regenerating key:', error);
    res.redirect('/admin/sites?error=Failed+to+regenerate+key');
  }
});

// POST /admin/sites/:id/delete - Delete site
router.post('/sites/:id/delete', async (req, res) => {
  try {
    const db = getDb();

    // Check if site has data
    const journeyCount = await db.query('SELECT COUNT(*) as count FROM journeys WHERE site_id = $1', [req.params.id]);
    if (parseInt(journeyCount.rows[0].count) > 0) {
      return res.redirect('/admin/sites?error=Cannot+delete+site+with+existing+data');
    }

    await db.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
    res.redirect('/admin/sites?success=Site+deleted+successfully');
  } catch (error) {
    console.error('Error deleting site:', error);
    res.redirect('/admin/sites?error=Failed+to+delete+site');
  }
});

// ============================================
// USER MANAGEMENT
// ============================================

// GET /admin/users - List all users
router.get('/users', async (req, res) => {
  try {
    const db = getDb();
    const users = await db.query(`
      SELECT u.*,
        (SELECT array_agg(s.name) FROM sites s JOIN user_sites us ON s.id = us.site_id WHERE us.user_id = u.id) as site_names
      FROM users u
      ORDER BY u.role DESC, u.name
    `);

    const sites = await db.query('SELECT * FROM sites ORDER BY name');

    res.render('admin/users', {
      title: 'User Management - SMART Journey',
      currentPage: 'admin',
      users: users.rows,
      sites: sites.rows,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading users:', error);
    res.status(500).render('error', { error: 'Failed to load users' });
  }
});

// GET /admin/users/new - New user form
router.get('/users/new', async (req, res) => {
  try {
    const db = getDb();
    const sites = await db.query('SELECT * FROM sites ORDER BY name');

    res.render('admin/userForm', {
      title: 'Add User - SMART Journey',
      currentPage: 'admin',
      user: null,
      sites: sites.rows,
      userSiteIds: [],
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading form:', error);
    res.redirect('/admin/users?error=Failed+to+load+form');
  }
});

// POST /admin/users - Create new user
router.post('/users', async (req, res) => {
  try {
    const { email, name, role, password, site_ids } = req.body;
    const db = getDb();

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await db.query(
      'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [email.toLowerCase(), passwordHash, name, role]
    );

    const userId = result.rows[0].id;

    // Assign sites (if customer)
    if (role === 'customer' && site_ids) {
      const siteIdArray = Array.isArray(site_ids) ? site_ids : [site_ids];
      for (const siteId of siteIdArray) {
        await db.query(
          'INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, siteId]
        );
      }
    }

    res.redirect('/admin/users?success=User+created+successfully');
  } catch (error) {
    console.error('Error creating user:', error);
    if (error.code === '23505') {
      res.redirect('/admin/users/new?error=A+user+with+this+email+already+exists');
    } else {
      res.redirect('/admin/users/new?error=Failed+to+create+user');
    }
  }
});

// GET /admin/users/:id - Edit user form
router.get('/users/:id', async (req, res) => {
  try {
    const db = getDb();
    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);

    if (userResult.rows.length === 0) {
      return res.redirect('/admin/users?error=User+not+found');
    }

    const sites = await db.query('SELECT * FROM sites ORDER BY name');
    const userSites = await db.query('SELECT site_id FROM user_sites WHERE user_id = $1', [req.params.id]);
    const userSiteIds = userSites.rows.map(r => r.site_id);

    res.render('admin/userForm', {
      title: 'Edit User - SMART Journey',
      currentPage: 'admin',
      user: userResult.rows[0],
      sites: sites.rows,
      userSiteIds,
      error: req.query.error || null
    });
  } catch (error) {
    console.error('Error loading user:', error);
    res.redirect('/admin/users?error=Failed+to+load+user');
  }
});

// POST /admin/users/:id - Update user
router.post('/users/:id', async (req, res) => {
  try {
    const { email, name, role, password, site_ids } = req.body;
    const db = getDb();

    // Update user details
    if (password && password.length >= 8) {
      const passwordHash = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET email = $1, name = $2, role = $3, password_hash = $4 WHERE id = $5',
        [email.toLowerCase(), name, role, passwordHash, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE users SET email = $1, name = $2, role = $3 WHERE id = $4',
        [email.toLowerCase(), name, role, req.params.id]
      );
    }

    // Update site assignments (for customers)
    await db.query('DELETE FROM user_sites WHERE user_id = $1', [req.params.id]);
    if (role === 'customer' && site_ids) {
      const siteIdArray = Array.isArray(site_ids) ? site_ids : [site_ids];
      for (const siteId of siteIdArray) {
        await db.query(
          'INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [req.params.id, siteId]
        );
      }
    }

    res.redirect('/admin/users?success=User+updated+successfully');
  } catch (error) {
    console.error('Error updating user:', error);
    res.redirect(`/admin/users/${req.params.id}?error=Failed+to+update+user`);
  }
});

// POST /admin/users/:id/delete - Delete user
router.post('/users/:id/delete', async (req, res) => {
  try {
    const db = getDb();

    // Prevent deleting yourself
    if (parseInt(req.params.id) === req.session.userId) {
      return res.redirect('/admin/users?error=Cannot+delete+your+own+account');
    }

    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.redirect('/admin/users?success=User+deleted+successfully');
  } catch (error) {
    console.error('Error deleting user:', error);
    res.redirect('/admin/users?error=Failed+to+delete+user');
  }
});

module.exports = router;

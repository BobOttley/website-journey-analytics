/**
 * Authentication Middleware
 * Handles user sessions, authentication checks, and site access control
 */

const bcrypt = require('bcrypt');
const { getDb } = require('../db/database');

/**
 * Require user to be logged in
 * Redirects to /login if not authenticated
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  // Store the requested URL to redirect after login
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

/**
 * Require user to be an admin
 * Returns 403 if not admin
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.userId && req.session.userRole === 'admin') {
    return next();
  }
  res.status(403).render('error', { error: 'Access denied. Admin privileges required.' });
}

/**
 * Attach user and site context to request
 * This runs on all requests to add helpful properties
 */
async function attachUserContext(req, res, next) {
  // Default values
  res.locals.user = null;
  res.locals.currentSite = null;
  res.locals.userSites = [];
  res.locals.isAdmin = false;

  if (req.session && req.session.userId) {
    try {
      const db = getDb();

      // Get user info
      const userResult = await db.query(
        'SELECT id, email, name, role FROM users WHERE id = $1',
        [req.session.userId]
      );

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        res.locals.user = user;
        res.locals.isAdmin = user.role === 'admin';

        // Get sites user can access
        let sitesQuery;
        if (user.role === 'admin') {
          // Admin can see all sites
          sitesQuery = await db.query('SELECT * FROM sites ORDER BY name');
        } else {
          // Customer can only see assigned sites
          sitesQuery = await db.query(`
            SELECT s.* FROM sites s
            JOIN user_sites us ON s.id = us.site_id
            WHERE us.user_id = $1
            ORDER BY s.name
          `, [user.id]);
        }

        res.locals.userSites = sitesQuery.rows;

        // Set current site from session or default to first available
        if (req.session.currentSiteId) {
          const currentSite = sitesQuery.rows.find(s => s.id === req.session.currentSiteId);
          if (currentSite) {
            res.locals.currentSite = currentSite;
          } else if (sitesQuery.rows.length > 0) {
            // User no longer has access to selected site, reset to first
            req.session.currentSiteId = sitesQuery.rows[0].id;
            res.locals.currentSite = sitesQuery.rows[0];
          }
        } else if (sitesQuery.rows.length > 0) {
          // No site selected, default to first
          req.session.currentSiteId = sitesQuery.rows[0].id;
          res.locals.currentSite = sitesQuery.rows[0];
        }
      }
    } catch (error) {
      console.error('Error attaching user context:', error);
    }
  }

  next();
}

/**
 * Verify user credentials
 * @returns {Object|null} User object if valid, null otherwise
 */
async function verifyCredentials(email, password) {
  const db = getDb();

  try {
    const result = await db.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return null;
    }

    // Update last login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    };
  } catch (error) {
    console.error('Error verifying credentials:', error);
    return null;
  }
}

/**
 * Get the current site_id from session
 * Use this in route handlers to filter data
 */
function getSiteId(req) {
  return req.session?.currentSiteId || null;
}

/**
 * Check if user has access to a specific site
 */
async function userHasSiteAccess(userId, siteId) {
  const db = getDb();

  // Check if admin (admins have access to all sites)
  const userResult = await db.query('SELECT role FROM users WHERE id = $1', [userId]);
  if (userResult.rows.length > 0 && userResult.rows[0].role === 'admin') {
    return true;
  }

  // Check user_sites mapping
  const result = await db.query(
    'SELECT 1 FROM user_sites WHERE user_id = $1 AND site_id = $2',
    [userId, siteId]
  );

  return result.rows.length > 0;
}

module.exports = {
  requireAuth,
  requireAdmin,
  attachUserContext,
  verifyCredentials,
  getSiteId,
  userHasSiteAccess
};

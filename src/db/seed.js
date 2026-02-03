/**
 * Seed initial data for multi-tenant system
 * Run with: node src/db/seed.js
 */

require('dotenv').config();
const bcrypt = require('bcrypt');
const { getDb, initializeSchema } = require('./database');
const crypto = require('crypto');

function generateTrackingKey(prefix) {
  const random = crypto.randomBytes(8).toString('hex');
  return `tk_${prefix}_${random}`;
}

async function seed() {
  console.log('Starting database seed...');

  // Initialize schema first (runs migrations)
  await initializeSchema();

  const db = getDb();

  try {
    // Check if sites already exist
    const existingSites = await db.query('SELECT COUNT(*) as count FROM sites');
    if (parseInt(existingSites.rows[0].count) > 0) {
      console.log('Sites already exist, skipping site creation');
    } else {
      // Create initial sites
      console.log('Creating initial sites...');

      const sites = [
        { name: 'BSMART AI', domain: 'bsmart-ai.com', tracking_key: generateTrackingKey('bsmart') },
        { name: 'More House School', domain: 'morehouse.org.uk', tracking_key: generateTrackingKey('morehouse') }
      ];

      for (const site of sites) {
        await db.query(
          'INSERT INTO sites (name, domain, tracking_key) VALUES ($1, $2, $3)',
          [site.name, site.domain, site.tracking_key]
        );
        console.log(`  Created site: ${site.name} (${site.tracking_key})`);
      }
    }

    // Check if admin user exists
    const existingUsers = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
    if (parseInt(existingUsers.rows[0].count) > 0) {
      console.log('Admin user already exists, skipping user creation');
    } else {
      // Create admin user (Bob)
      console.log('Creating admin user...');

      // Generate a temporary password - Bob should change this
      const tempPassword = 'SmartJourney2024!';
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      const result = await db.query(
        'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4) RETURNING id',
        ['bob.ottley@bsmart-ai.com', passwordHash, 'Bob Ottley', 'admin']
      );

      const adminId = result.rows[0].id;
      console.log(`  Created admin user: bob.ottley@bsmart-ai.com (ID: ${adminId})`);
      console.log(`  Temporary password: ${tempPassword}`);
      console.log('  IMPORTANT: Change this password after first login!');

      // Grant admin access to all sites
      const allSites = await db.query('SELECT id FROM sites');
      for (const site of allSites.rows) {
        await db.query(
          'INSERT INTO user_sites (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [adminId, site.id]
        );
      }
      console.log('  Granted admin access to all sites');
    }

    // Migrate existing data to site_id = 1 (BSMART AI)
    console.log('Migrating existing data to site_id = 1...');

    const bsmartSite = await db.query("SELECT id FROM sites WHERE domain = 'bsmart-ai.com'");
    if (bsmartSite.rows.length > 0) {
      const siteId = bsmartSite.rows[0].id;

      // Update journeys without site_id
      const journeyResult = await db.query(
        'UPDATE journeys SET site_id = $1 WHERE site_id IS NULL',
        [siteId]
      );
      console.log(`  Updated ${journeyResult.rowCount} journeys`);

      // Update journey_events without site_id
      const eventResult = await db.query(
        'UPDATE journey_events SET site_id = $1 WHERE site_id IS NULL',
        [siteId]
      );
      console.log(`  Updated ${eventResult.rowCount} journey_events`);

      // Update insights without site_id
      const insightResult = await db.query(
        'UPDATE insights SET site_id = $1 WHERE site_id IS NULL',
        [siteId]
      );
      console.log(`  Updated ${insightResult.rowCount} insights`);
    }

    // Display summary
    console.log('\n=== SEED COMPLETE ===');
    const sites = await db.query('SELECT id, name, domain, tracking_key FROM sites ORDER BY id');
    console.log('\nSites:');
    sites.rows.forEach(s => {
      console.log(`  ${s.id}. ${s.name} (${s.domain}) - ${s.tracking_key}`);
    });

    const users = await db.query('SELECT id, email, name, role FROM users ORDER BY id');
    console.log('\nUsers:');
    users.rows.forEach(u => {
      console.log(`  ${u.id}. ${u.email} (${u.role})`);
    });

  } catch (error) {
    console.error('Seed failed:', error);
    throw error;
  }

  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function getDb() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  // Log pool errors
  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
  });

  return pool;
}

async function initializeSchema() {
  const database = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const migrationsPath = path.join(__dirname, 'migrations.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  try {
    await database.query(schema);
    console.log('Database schema initialized');
  } catch (error) {
    // Tables likely already exist
    if (!error.message.includes('already exists')) {
      console.error('Schema initialization error:', error.message);
    } else {
      console.log('Database schema already exists');
    }
  }

  // Run migrations to add new columns
  try {
    if (fs.existsSync(migrationsPath)) {
      const migrations = fs.readFileSync(migrationsPath, 'utf-8');
      await database.query(migrations);
      console.log('Database migrations applied');
    }
  } catch (error) {
    // Columns likely already exist
    if (!error.message.includes('already exists')) {
      console.error('Migration error:', error.message);
    }
  }
}

async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getDb,
  initializeSchema,
  closeDb
};

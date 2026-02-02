const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function getDb() {
  if (pool) return pool;

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
  });

  return pool;
}

async function initializeSchema() {
  const database = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
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

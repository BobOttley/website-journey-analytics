const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let db = null;

function getDb() {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || './data/analytics.db';
  const dbDir = path.dirname(dbPath);

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  return db;
}

function initializeSchema() {
  const database = getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  database.exec(schema);
  console.log('Database schema initialized');
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  initializeSchema,
  closeDb
};

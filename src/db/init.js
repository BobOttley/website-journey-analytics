require('dotenv').config();
const { initializeSchema, closeDb } = require('./database');

console.log('Initializing database...');
initializeSchema();
closeDb();
console.log('Database initialization complete');

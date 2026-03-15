// ============================================================
//  FINTRACK — Database Client (db.js)
// ============================================================

const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max:              5,      // free tier has limited connections; keep pool small
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // increased: free DB can be slow to accept on cold start
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

// Log unexpected pool errors (prevent unhandled rejections)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Warm the pool on startup — but do NOT crash the server if the DB
// is still waking up. The Pool will retry automatically on first request.
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL');
    client.release();
  })
  .catch(err => {
    console.warn('⚠️  Initial DB connect failed (may still be waking up):', err.message);
    // Do NOT call process.exit() — let the server stay alive.
    // The pool will establish a connection on the first incoming request.
  });

/**
 * Run a parameterised query.
 * @param {string} text   - SQL string with $1, $2 placeholders
 * @param {any[]}  params - parameter values
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    if (process.env.NODE_ENV === 'development') {
      console.log(`[DB] ${(Date.now() - start)}ms — ${text.slice(0, 80)}`);
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', text);
    throw err;
  }
}

module.exports = { query };
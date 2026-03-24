// ============================================================
//  FINTRACK — Database Client (db.js)
// ============================================================
require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  // ✅ FIX 4: SSL always on for Render — no longer depends on DB_SSL env var
  // Render's free PostgreSQL requires SSL; without this connections silently fail
  ssl: { rejectUnauthorized: false },
});

// Log unexpected pool errors (prevent unhandled rejections)
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Warm the pool on startup — do NOT crash if DB is still waking up
pool.connect()
  .then(client => {
    console.log('✅ Connected to PostgreSQL');
    client.release();
  })
  .catch(err => {
    console.warn('⚠️  Initial DB connect failed (may still be waking up):', err.message);
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
      console.log(`[DB] ${Date.now() - start}ms — ${text.slice(0, 80)}`);
    }
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', text);
    throw err;
  }
}

/**
 * Get a raw client from the pool — needed for multi-statement transactions
 * (BEGIN / COMMIT / ROLLBACK). Always call client.release() in a finally block.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient };
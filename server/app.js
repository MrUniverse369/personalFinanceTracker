// ============================================================
//  FINTRACK — Express Server (app.js)
// ============================================================
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const db         = require('./db');
const plaidClient = require('./plaidClient'); // ✅ FIX 1: use shared client, removed inline duplicate

const PORT = process.env.PORT || 5000;

// ------------------- EXPRESS SETUP -------------------
const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

app.use(express.json());

// ------------------- SERVE FRONTEND -------------------
app.use(express.static(path.join(__dirname, '../client'), {
  maxAge: '7d',
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ------------------- HELPERS -------------------
function isoDate(daysAgo = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function handleError(res, err, context = '') {
  const msg = err.response?.data?.error_message ?? err.message ?? 'Unknown error';
  console.error(`[${context}]`, err.response?.data ?? err.message);
  res.status(500).json({ error: msg });
}

// ------------------- CATEGORY NORMALISER -------------------
function plaidCategoryToId(plaidCategories = []) {
  const top = (plaidCategories[0] ?? '').toLowerCase();
  const sub = (plaidCategories[1] ?? '').toLowerCase();

  if (top.includes('food') || top.includes('restaurant') || sub.includes('restaurant') || sub.includes('coffee'))
    return 1; // Food
  if (top.includes('travel') || top.includes('transport') || sub.includes('taxi') || sub.includes('ride') || sub.includes('airlines') || sub.includes('car service'))
    return 2; // Transport
  if (top.includes('service') || top.includes('utilities') || top.includes('payment') || top.includes('bank') || top.includes('transfer') || sub.includes('utilities') || sub.includes('subscription'))
    return 3; // Utilities
  if (top.includes('recreation') || top.includes('entertainment') || sub.includes('gym') || sub.includes('sport') || sub.includes('arts') || sub.includes('music'))
    return 4; // Entertainment
  return 5; // Other
}

// ------------------- PLAID TRANSACTION FETCH -------------------
async function fetchTransactionsFromPlaid(accessToken, startDate, endDate) {
  console.log('[Plaid] Firing sandboxItemFireWebhook (INITIAL_UPDATE)...');
  try {
    await plaidClient.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'INITIAL_UPDATE',
    });
    console.log('[Plaid] Webhook fired successfully.');
  } catch (webhookErr) {
    console.warn(
      '[Plaid] Webhook fire failed (non-fatal, continuing):',
      webhookErr.response?.data?.error_code ?? webhookErr.message
    );
  }

  console.log('[Plaid] Sleeping 10s for sandbox data preparation...');
  await sleep(10000);

  const retries = 10;
  const delayMs = 10000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Plaid] transactionsGet attempt ${attempt}/${retries}...`);
      const { data } = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date: startDate,
        end_date: endDate,
        options: { count: 100, offset: 0 },
      });
      console.log(`[Plaid] SUCCESS on attempt ${attempt} — ${data.transactions.length} transactions`);
      return data;
    } catch (err) {
      const errorCode = err.response?.data?.error_code;
      console.log(`[Plaid] Attempt ${attempt} error_code: ${errorCode}`);
      if (errorCode === 'PRODUCT_NOT_READY' && attempt < retries) {
        console.log(`[Plaid] Still not ready. Waiting ${delayMs}ms...`);
        await sleep(delayMs);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Plaid transactions never became ready after maximum retries.');
}

// ------------------- ROUTES -------------------

// Health check
app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

// Legacy health check
app.get('/api', (req, res) => {
  res.json({ status: 'ok', message: 'Fintrack API is running' });
});

// ---------- USERS ----------
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;

  if (!name?.trim())  return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email))
    return res.status(400).json({ error: 'Invalid email address.' });

  try {
    const result = await db.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING user_id, name, email',
      [name.trim(), email.trim().toLowerCase()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'A user with this email already exists.' });
    handleError(res, err, 'POST /api/users');
  }
});

// ---------- TRANSACTIONS ----------
app.post('/api/transactions', async (req, res) => {
  const user_id = parseInt(req.body.user_id, 10);

  if (!user_id || isNaN(user_id))
    return res.status(400).json({ error: 'A valid user_id is required.' });

  try {
    // ✅ FIX 2: userCheck moved inside try/catch so DB errors return clean 500
    const userCheck = await db.query(
      'SELECT user_id FROM users WHERE user_id = $1',
      [user_id]
    );
    if (!userCheck.rows.length)
      return res.status(404).json({ error: `User ${user_id} not found.` });

    console.log('[Plaid] Creating sandbox public token...');
    const { data: ptData } = await plaidClient.sandboxPublicTokenCreate({
      institution_id: 'ins_109508',
      initial_products: ['transactions'],
    });

    console.log('[Plaid] Exchanging public token...');
    const { data: tokenData } = await plaidClient.itemPublicTokenExchange({
      public_token: ptData.public_token,
    });

    const startDate = isoDate(90);
    const endDate   = isoDate(0);

    const txData = await fetchTransactionsFromPlaid(
      tokenData.access_token, startDate, endDate
    );

    const transactions = txData.transactions;

    await db.query('DELETE FROM transactions WHERE user_id = $1', [user_id]);

    // ✅ FIX 3: bulk insert inside a transaction instead of 100 sequential awaits
    if (transactions.length > 0) {
      const pgClient = await db.getClient();
      try {
        await pgClient.query('BEGIN');

        // Build a single INSERT with N rows:
        // INSERT INTO transactions (user_id, date, description, amount, category_id)
        // VALUES ($1,$2,$3,$4,$5), ($1,$6,$7,$8,$9), ...
        const valuePlaceholders = [];
        const params = [user_id]; // $1 is always user_id
        let   paramIndex = 2;

        for (const t of transactions) {
          const category_id = plaidCategoryToId(t.category ?? []);
          console.log(
            `[Category] "${t.name}" | Plaid: [${(t.category ?? []).join(', ')}] → category_id: ${category_id}`
          );
          valuePlaceholders.push(
            `($1, $${paramIndex}, $${paramIndex+1}, $${paramIndex+2}, $${paramIndex+3})`
          );
          params.push(t.date, t.name, t.amount, category_id);
          paramIndex += 4;
        }

        await pgClient.query(
          `INSERT INTO transactions (user_id, date, description, amount, category_id)
           VALUES ${valuePlaceholders.join(', ')}
           ON CONFLICT DO NOTHING`,
          params
        );

        await pgClient.query('COMMIT');
      } catch (bulkErr) {
        await pgClient.query('ROLLBACK');
        throw bulkErr;
      } finally {
        pgClient.release();
      }
    }

    res.json({
      message: `${transactions.length} transactions synced for user ${user_id}.`,
      count: transactions.length,
      date_range: { start: startDate, end: endDate },
    });
  } catch (err) {
    handleError(res, err, 'POST /api/transactions');
  }
});

// Get transactions
app.get('/api/transactions/:user_id', async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10);
  if (!user_id || isNaN(user_id))
    return res.status(400).json({ error: 'Valid user_id required' });

  try {
    const result = await db.query(
      `SELECT t.transaction_id, t.date, t.description, t.amount, c.name AS category
       FROM transactions t
       JOIN categories c ON t.category_id = c.category_id
       WHERE t.user_id = $1
       ORDER BY t.date DESC`,
      [user_id]
    );
    res.json(result.rows);
  } catch (err) {
    handleError(res, err, 'GET /api/transactions/:user_id');
  }
});

// Delete transactions
app.delete('/api/transactions/:user_id', async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10);
  if (!user_id || isNaN(user_id))
    return res.status(400).json({ error: 'Valid user_id required' });

  try {
    const result = await db.query(
      'DELETE FROM transactions WHERE user_id = $1 RETURNING transaction_id',
      [user_id]
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    handleError(res, err, 'DELETE /api/transactions/:user_id');
  }
});

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// Start server
app.listen(PORT, () => {
  console.log(`Fintrack running on port ${PORT}`);
});
// ============================================================
//  FINTRACK — Express Server (app.js)
// ============================================================
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const db       = require('./db');
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');
const PORT = process.env.PORT || 5000;

// ------------------- PLAID CLIENT -------------------
const plaidConfig = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET':    process.env.PLAID_SECRET,
      'Plaid-Version':   '2020-09-14',
    },
  },
});
const plaidClient = new PlaidApi(plaidConfig);

// ------------------- EXPRESS SETUP -------------------
const app = express();

app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE'],
}));

app.use(express.json());

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

// ------------------- PLAID TRANSACTION FETCH -------------------
// Plaid sandbox doesn't prepare transaction data immediately after token
// exchange. The correct fix is to fire a sandbox webhook (INITIAL_UPDATE)
// which forces Plaid to generate the data, then poll until ready.
async function fetchTransactionsFromPlaid(accessToken, startDate, endDate) {

  // Step 1: Fire sandbox webhook to force Plaid to prepare transaction data
  console.log('[Plaid] Firing sandboxItemFireWebhook (INITIAL_UPDATE)...');
  try {
    await plaidClient.sandboxItemFireWebhook({
      access_token: accessToken,
      webhook_type: 'TRANSACTIONS',
      webhook_code: 'INITIAL_UPDATE',
    });
    console.log('[Plaid] Webhook fired successfully.');
  } catch (webhookErr) {
    console.warn('[Plaid] Webhook fire failed (non-fatal, continuing):', webhookErr.response?.data?.error_code ?? webhookErr.message);
  }

  // Step 2: Wait 10 seconds for Plaid sandbox to prepare the data
  console.log('[Plaid] Sleeping 10s for sandbox data preparation...');
  await sleep(10000);

  // Step 3: Poll with 10s delay per attempt
  const retries = 10;
  const delayMs = 10000;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[Plaid] transactionsGet attempt ${attempt}/${retries}...`);
      const { data } = await plaidClient.transactionsGet({
        access_token: accessToken,
        start_date:   startDate,
        end_date:     endDate,
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
app.get('/api', (req, res) => {
  res.json({ status: 'ok', message: 'Fintrack API is running' });
});

// ---------- USERS ----------
app.post('/api/users', async (req, res) => {
  const { name, email } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: 'Name is required.' });
  if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  try {
    const result = await db.query(
      'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING user_id, name, email',
      [name.trim(), email.trim().toLowerCase()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }
    handleError(res, err, 'POST /api/users');
  }
});

// ---------- TRANSACTIONS ----------
app.post('/api/transactions', async (req, res) => {
  const user_id = parseInt(req.body.user_id, 10);
  if (!user_id || isNaN(user_id)) {
    return res.status(400).json({ error: 'A valid user_id is required.' });
  }

  // Verify user exists
  const userCheck = await db.query('SELECT user_id FROM users WHERE user_id = $1', [user_id]);
  if (!userCheck.rows.length) {
    return res.status(404).json({ error: `User ${user_id} not found.` });
  }

  try {
    // 1. Create sandbox public token
    console.log('[Plaid] Creating sandbox public token...');
    const { data: ptData } = await plaidClient.sandboxPublicTokenCreate({
      institution_id:   'ins_109508',
      initial_products: ['transactions'],
    });
    console.log('[Plaid] Public token created.');

    // 2. Exchange public token for access token
    console.log('[Plaid] Exchanging public token...');
    const { data: tokenData } = await plaidClient.itemPublicTokenExchange({
      public_token: ptData.public_token,
    });
    console.log('[Plaid] Access token obtained.');

    // 3. Fetch transactions (fires webhook first, then polls until ready)
    const startDate = isoDate(90);
    const endDate   = isoDate(0);
    const txData    = await fetchTransactionsFromPlaid(tokenData.access_token, startDate, endDate);
    const transactions = txData.transactions;

    // 4. Clear existing transactions for this user
    await db.query('DELETE FROM transactions WHERE user_id = $1', [user_id]);

    // 5. Map Plaid categories to DB category IDs
    const catMap = {
      'Food and Drink': 1,
      'Travel':         2,
      'Service':        3,
      'Recreation':     4,
    };

    for (const t of transactions) {
      const plaidCat    = t.category?.[0] ?? 'Other';
      const category_id = catMap[plaidCat] ?? 5;
      await db.query(
        `INSERT INTO transactions (user_id, date, description, amount, category_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [user_id, t.date, t.name, t.amount, category_id]
      );
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

// Get transactions for a user
app.get('/api/transactions/:user_id', async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10);
  if (!user_id || isNaN(user_id)) return res.status(400).json({ error: 'Valid user_id required' });

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

// Delete all transactions for a user
app.delete('/api/transactions/:user_id', async (req, res) => {
  const user_id = parseInt(req.params.user_id, 10);
  if (!user_id || isNaN(user_id)) return res.status(400).json({ error: 'Valid user_id required' });

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
  console.log(`Fintrack API running -> http://localhost:${PORT}/api`);
});
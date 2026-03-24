// ============================================================
//  FINTRACK — Plaid Client (plaidClient.js)
// ============================================================
require('dotenv').config();
const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');

const { PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV = 'sandbox' } = process.env;

if (!PLAID_CLIENT_ID) throw new Error('PLAID_CLIENT_ID is not set in environment.');
if (!PLAID_SECRET)    throw new Error('PLAID_SECRET is not set in environment.');

const envMap = {
  sandbox:     PlaidEnvironments.sandbox,
  development: PlaidEnvironments.development,
  production:  PlaidEnvironments.production,
};

const basePath = envMap[PLAID_ENV] ?? PlaidEnvironments.sandbox;

const configuration = new Configuration({
  basePath,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET':    PLAID_SECRET,
      'Plaid-Version':   '2020-09-14',
    },
  },
});

// ✅ Single shared instance — imported by app.js, no duplicate inline client
const client = new PlaidApi(configuration);

module.exports = client;
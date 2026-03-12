// ============================================================
// FINTRACK — script.js
// ============================================================

// Backend API base URL
//const baseUrl = 'http://localhost:52419/api';(un comment for local development)
const baseUrl = 'https://personalFinanceTracker-api.onrender.com/api';
// ------------------- DOM ELEMENTS -------------------
const apiStatusDot = document.getElementById('apiStatusDot');
const apiStatusText = document.getElementById('apiStatusText');

const sections = {
  dashboard: document.getElementById('section-dashboard'),
  transactions: document.getElementById('section-transactions'),
  users: document.getElementById('section-users'),
};

const navItems = document.querySelectorAll('.nav-item');

const createUserBtn    = document.getElementById('createUser');
const createUserResult = document.getElementById('createUserResult');

const userIdInput = document.getElementById('userId');
const fetchTxBtn  = document.getElementById('fetchTransactions');

const txBody = document.getElementById('txBody');
const tableLoader = document.getElementById('tableLoader');
const tableFooter = document.getElementById('tableFooter');

const currentDateBadge = document.getElementById('currentDate');

// ------------------- INIT -------------------
document.addEventListener('DOMContentLoaded', () => {
  setCurrentDate();
  checkApiStatus();
  setupNavigation();
});

// ------------------- NAVIGATION -------------------
function setupNavigation() {
  navItems.forEach((nav) => {
    nav.addEventListener('click', (e) => {
      e.preventDefault();
      const target = nav.dataset.section;

      // Show only the selected section
      Object.keys(sections).forEach(key => {
        sections[key].classList.toggle('hidden', key !== target);
      });

      // Toggle active class
      navItems.forEach(n => n.classList.remove('active'));
      nav.classList.add('active');
    });
  });
}

// ------------------- API STATUS -------------------
async function checkApiStatus() {
  try {
    const res = await fetch(`${baseUrl}`);
    if (!res.ok) throw new Error('API unreachable');
    const data = await res.json();
    apiStatusDot.style.backgroundColor = 'green';
    apiStatusText.textContent = 'Online';
  } catch (err) {
    apiStatusDot.style.backgroundColor = 'red';
    apiStatusText.textContent = 'Offline';
  }
}

// ------------------- DATE -------------------
function setCurrentDate() {
  const now = new Date();
  currentDateBadge.textContent = now.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

// ------------------- CREATE USER -------------------
createUserBtn.addEventListener('click', async () => {
  const name  = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();

  if (!name || !email) {
    showResult(createUserResult, 'Name & email required', 'error');
    return;
  }

  toggleButtonLoader(createUserBtn, true);

  try {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Failed to create user');

    showResult(createUserResult, `User created: ${data.name} (ID ${data.user_id})`, 'success');

  } catch (err) {
    showResult(createUserResult, err.message, 'error');
  } finally {
    toggleButtonLoader(createUserBtn, false);
  }
});

function showResult(el, message, type = 'info') {
  el.textContent = message;
  el.className = `result-badge ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function toggleButtonLoader(btn, show) {
  btn.querySelector('.btn-text').classList.toggle('hidden', show);
  btn.querySelector('.btn-loader').classList.toggle('hidden', !show);
}

// ------------------- FETCH TRANSACTIONS -------------------
fetchTxBtn.addEventListener('click', async () => {
  const userId = parseInt(userIdInput.value, 10);
  if (!userId || isNaN(userId)) {
    alert('Enter a valid User ID');
    return;
  }

  txBody.innerHTML = '';
  tableLoader.classList.remove('hidden');

  try {
    const res = await fetch(`${baseUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });

    const data = await res.json();
    tableLoader.classList.add('hidden');

    if (!res.ok) throw new Error(data.error || 'Failed to sync transactions');

    // Fetch saved transactions
    const txRes = await fetch(`${baseUrl}/transactions/${userId}`);
    const txData = await txRes.json();

    populateTransactionTable(txData);

  } catch (err) {
    tableLoader.classList.add('hidden');
    txBody.innerHTML = `<tr><td colspan="4" class="empty-cell">Error: ${err.message}</td></tr>`;
    console.error(err);
  }
});

function populateTransactionTable(transactions) {
  if (!transactions.length) {
    txBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No transactions found.</td></tr>`;
    return;
  }

  txBody.innerHTML = '';
  let totalIncome = 0, totalExpense = 0;

  transactions.forEach(tx => {
    const amount = parseFloat(tx.amount);
    const isCredit = amount > 0;
    if (isCredit) totalIncome += amount; else totalExpense += Math.abs(amount);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${tx.date}</td>
      <td>${tx.description}</td>
      <td>${tx.category}</td>
      <td class="text-right">${amount.toFixed(2)}</td>
    `;
    txBody.appendChild(row);
  });

  // Update dashboard cards
  document.getElementById('totalIncome').textContent = `$${totalIncome.toFixed(2)}`;
  document.getElementById('totalExpense').textContent = `$${totalExpense.toFixed(2)}`;
  document.getElementById('netBalance').textContent = `$${(totalIncome - totalExpense).toFixed(2)}`;
  document.getElementById('txCount').textContent = transactions.length;
}
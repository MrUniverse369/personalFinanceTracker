// ============================================================
// FINTRACK — script.js
// ============================================================

const baseUrl = 'https://personalFinanceTracker-api.onrender.com/api';

// ------------------- DOM ELEMENTS -------------------
const apiStatusDot  = document.getElementById('apiStatusDot');
const apiStatusText = document.getElementById('apiStatusText');

const sections = {
  dashboard:    document.getElementById('section-dashboard'),
  transactions: document.getElementById('section-transactions'),
  users:        document.getElementById('section-users'),
};

const navItems = document.querySelectorAll('.nav-item');

const createUserBtn    = document.getElementById('createUser');
const createUserResult = document.getElementById('createUserResult');

const userIdInput = document.getElementById('userId');
const fetchTxBtn  = document.getElementById('fetchTransactions');

const txBody      = document.getElementById('txBody');
const tableLoader = document.getElementById('tableLoader');
const tableFooter = document.getElementById('tableFooter');

const currentDateBadge = document.getElementById('currentDate');

// Mobile sidebar elements
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const hamburger      = document.getElementById('hamburger');
const sidebarClose   = document.getElementById('sidebarClose');

// Page meta
const pageTitle    = document.getElementById('pageTitle');
const pageSubtitle = document.getElementById('pageSubtitle');

const pageMeta = {
  dashboard:    { title: 'Dashboard',     subtitle: 'Overview of your financial activity' },
  transactions: { title: 'Transactions',  subtitle: 'Sync and browse your transaction history' },
  users:        { title: 'Users',         subtitle: 'Manage your Fintrack accounts' },
};

// ------------------- COLD-START OVERLAY -------------------
const coldOverlay = document.getElementById('coldOverlay');
const coldTitle   = document.getElementById('coldTitle');
const coldMsg     = document.getElementById('coldMsg');
const coldBar     = document.getElementById('coldBar');
const coldHint    = document.getElementById('coldHint');

// Messages shown at increasing delays while waiting for the server
const coldMessages = [
  [0,  'Starting up…',                                     8 ],
  [4,  'Waking up the server…',                            25],
  [10, 'Connecting to the database…',                      45],
  [20, 'Still warming up — almost there…',                 65],
  [35, 'This can take up to a minute\non Render\'s free tier…', 82],
  [55, 'Hang tight, nearly done…',                         94],
];

let coldTimers = [];

function startColdUI() {
  coldBar.style.width = '4%';
  coldMessages.forEach(([delay, text, pct]) => {
    const t = setTimeout(() => {
      coldMsg.textContent = text;
      coldBar.style.width = pct + '%';
      // Show the "free tier" hint after 20 seconds
      if (delay >= 20) {
        coldHint.textContent = 'Free hosting spins down after 15 min of inactivity.';
      }
    }, delay * 1000);
    coldTimers.push(t);
  });
}

function stopColdUI() {
  coldTimers.forEach(clearTimeout);
  coldBar.style.transition = 'width 0.3s ease';
  coldBar.style.width      = '100%';
  coldMsg.textContent      = 'Ready!';
  coldHint.textContent     = '';
  setTimeout(() => coldOverlay.classList.add('hidden'), 400);
}

function failColdUI(message = 'Could not connect. Please refresh and try again.') {
  coldTimers.forEach(clearTimeout);
  coldBar.style.background = 'var(--expense)';
  coldBar.style.width      = '100%';
  coldMsg.textContent      = message;
  coldHint.textContent     = 'Check your connection or try refreshing.';
}

// ------------------- INIT -------------------
document.addEventListener('DOMContentLoaded', () => {
  setCurrentDate();
  setupNavigation();
  setupMobileSidebar();
  startColdUI();
  checkApiStatus(); // drives overlay — waits for server to wake
});

// ------------------- MOBILE SIDEBAR -------------------
function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

function setupMobileSidebar() {
  hamburger.addEventListener('click', openSidebar);
  sidebarClose.addEventListener('click', closeSidebar);
  sidebarOverlay.addEventListener('click', closeSidebar);

  let touchStartX = 0;
  sidebar.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
  }, { passive: true });
  sidebar.addEventListener('touchmove', (e) => {
    if (e.touches[0].clientX - touchStartX < -50) closeSidebar();
  }, { passive: true });
}

// ------------------- NAVIGATION -------------------
function setupNavigation() {
  navItems.forEach((nav) => {
    nav.addEventListener('click', (e) => {
      e.preventDefault();
      const target = nav.dataset.section;
      Object.keys(sections).forEach(key => {
        sections[key].classList.toggle('hidden', key !== target);
      });
      navItems.forEach(n => n.classList.remove('active'));
      nav.classList.add('active');
      if (pageMeta[target]) {
        pageTitle.textContent    = pageMeta[target].title;
        pageSubtitle.textContent = pageMeta[target].subtitle;
      }
      closeSidebar();
    });
  });
}

// ------------------- API STATUS (drives cold-start overlay) -------------------
async function checkApiStatus() {
  const TIMEOUT_MS = 90000; // 90 s — Render cold starts can take ~60–75 s

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${baseUrl}`, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) throw new Error('API unreachable');

    // Server is up — update status dot and dismiss overlay
    apiStatusDot.style.backgroundColor = '#4fffb0';
    apiStatusDot.style.boxShadow       = '0 0 6px #4fffb0';
    apiStatusText.textContent          = 'Online';
    stopColdUI();

  } catch (err) {
    if (err.name === 'AbortError') {
      failColdUI('Server took too long to respond.');
    } else {
      failColdUI('Could not reach the server.');
    }
    apiStatusDot.style.backgroundColor = '#ff6b6b';
    apiStatusText.textContent          = 'Offline';
  }
}

// ------------------- DATE -------------------
function setCurrentDate() {
  const now = new Date();
  currentDateBadge.textContent = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email }),
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
  btn.disabled = show;
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
  toggleButtonLoader(fetchTxBtn, true);

  try {
    const res = await fetch(`${baseUrl}/transactions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ user_id: userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sync transactions');

    const txRes  = await fetch(`${baseUrl}/transactions/${userId}`);
    const txData = await txRes.json();

    tableLoader.classList.add('hidden');
    populateTransactionTable(txData);
  } catch (err) {
    tableLoader.classList.add('hidden');
    txBody.innerHTML = `<tr><td colspan="4" class="empty-cell">Error: ${err.message}</td></tr>`;
    console.error(err);
  } finally {
    toggleButtonLoader(fetchTxBtn, false);
  }
});

// ------------------- FILTERS -------------------
const searchInput    = document.getElementById('searchTx');
const filterCategory = document.getElementById('filterCategory');
const sortOrder      = document.getElementById('sortOrder');

let allTransactions = [];

searchInput.addEventListener('input', renderFilteredTable);
filterCategory.addEventListener('change', renderFilteredTable);
sortOrder.addEventListener('change', renderFilteredTable);

function renderFilteredTable() {
  const query    = searchInput.value.toLowerCase();
  const category = filterCategory.value;
  const order    = sortOrder.value;

  let filtered = allTransactions.filter(tx => {
    const matchSearch   = tx.description.toLowerCase().includes(query);
    const matchCategory = !category || tx.category === category;
    return matchSearch && matchCategory;
  });

  filtered.sort((a, b) => {
    const da = new Date(a.date), db = new Date(b.date);
    return order === 'desc' ? db - da : da - db;
  });

  renderRows(filtered);
  tableFooter.textContent = `Showing ${filtered.length} of ${allTransactions.length} transactions`;
}

// ------------------- TABLE RENDER -------------------
function populateTransactionTable(transactions) {
  allTransactions = transactions;

  if (!transactions.length) {
    txBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No transactions found.</td></tr>`;
    updateDashboard([], 0, 0);
    return;
  }

  let totalIncome = 0, totalExpense = 0;
  transactions.forEach(tx => {
    const amount = parseFloat(tx.amount);
    if (amount > 0) totalIncome += amount;
    else totalExpense += Math.abs(amount);
  });

  updateDashboard(transactions, totalIncome, totalExpense);
  renderFilteredTable();
}

function renderRows(transactions) {
  if (!transactions.length) {
    txBody.innerHTML = `<tr><td colspan="4" class="empty-cell">No matching transactions.</td></tr>`;
    return;
  }

  txBody.innerHTML = '';
  transactions.forEach(tx => {
    const amount   = parseFloat(tx.amount);
    const isCredit = amount > 0;
    const amtClass = isCredit ? 'amount-positive' : 'amount-negative';
    const sign     = isCredit ? '+' : '';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="date-cell">${tx.date}</td>
      <td class="desc-cell">${tx.description}</td>
      <td><span class="category-badge badge--${tx.category}">${tx.category}</span></td>
      <td class="text-right"><span class="${amtClass}">${sign}${amount.toFixed(2)}</span></td>
    `;
    txBody.appendChild(row);
  });
}

function updateDashboard(transactions, totalIncome, totalExpense) {
  document.getElementById('totalIncome').textContent  = `$${totalIncome.toFixed(2)}`;
  document.getElementById('totalExpense').textContent = `$${totalExpense.toFixed(2)}`;
  document.getElementById('netBalance').textContent   = `$${(totalIncome - totalExpense).toFixed(2)}`;
  document.getElementById('txCount').textContent      = transactions.length;

  const breakdown = document.getElementById('categoryBreakdown');
  if (!transactions.length) {
    breakdown.innerHTML = '<p class="empty-state">Fetch transactions to see category breakdown.</p>';
    return;
  }

  const catTotals = {};
  transactions.forEach(tx => {
    const amount = parseFloat(tx.amount);
    if (amount < 0) {
      catTotals[tx.category] = (catTotals[tx.category] || 0) + Math.abs(amount);
    }
  });

  const maxVal = Math.max(...Object.values(catTotals), 1);

  const catColors = {
    Food:          '#4fffb0',
    Transport:     '#74b9ff',
    Utilities:     '#ffd166',
    Entertainment: '#fd79a8',
    Other:         '#50566a',
  };

  breakdown.innerHTML = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, total]) => `
      <div class="cat-row">
        <div class="cat-name">${cat}</div>
        <div class="cat-bar-wrap">
          <div class="cat-bar" style="width:${(total / maxVal * 100).toFixed(1)}%; background:${catColors[cat] || '#50566a'}"></div>
        </div>
        <div class="cat-amount">$${total.toFixed(0)}</div>
      </div>
    `)
    .join('');
}
// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyC8m98e0ChNkJv__LixdJH4zxYQmaYCea4",
  authDomain: "pos-app-823a6.firebaseapp.com",
  projectId: "pos-app-823a6",
  storageBucket: "pos-app-823a6.firebasestorage.app",
  messagingSenderId: "995356929705",
  appId: "1:995356929705:web:507f9a16dcc312b94243b8",
  measurementId: "G-Z6JE78JYVM"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// ==========================================
// GLOBAL STATE
// ==========================================
let products = [];
let cart = [];
let currentUser = null;
let currentOrgId = null;
let currentOrg = null;
let saleInProgress = false;

let TAX_RATE = 0.16;
let CURRENCY = 'K';

function money(amount) {
  return `${CURRENCY} ${Number(amount).toLocaleString('en-ZM', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

function moneyValue(amount) {
  return Number(amount).toLocaleString('en-ZM', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  });
}

// ==========================================
// SCREEN NAVIGATION
// ==========================================
function toggleScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showLogin() { toggleScreen('login-screen'); }
function showSignup() { toggleScreen('signup-screen'); }
function showForgotPassword() {
  toggleScreen('forgot-screen');
  const loginEmail = document.getElementById('email').value;
  if (loginEmail) document.getElementById('forgot-email').value = loginEmail;
}

async function showPOS() {
  toggleScreen('pos-screen');
  await loadUserData();
  await loadProducts();
  loadDarkModePreference();
  
  if (currentOrg?.themeColor) {
    setThemeColor(currentOrg.themeColor);
  }
  if (currentOrg?.taxRate !== undefined) {
    TAX_RATE = currentOrg.taxRate;
  }
  if (currentOrg?.currency) {
    CURRENCY = currentOrg.currency;
  }
}

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(tab + '-tab').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  
  const titles = { 
    pos: 'Point of Sale', 
    products: 'Products', 
    orders: 'Orders', 
    dashboard: 'Dashboard',
    settings: 'Settings'
  };
  updateMobileTitle(titles[tab]);
  
  if (tab === 'products') renderProductsTable();
  if (tab === 'orders') loadOrders();
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'settings') loadSettings();
  
  autoCloseSidebar();
}

// ==========================================
// SIDEBAR CONTROLS
// ==========================================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar.classList.contains('open')) closeSidebar();
  else openSidebar();
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
  document.body.classList.add('sidebar-open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
  document.body.classList.remove('sidebar-open');
}

function autoCloseSidebar() {
  if (window.innerWidth <= 968) setTimeout(closeSidebar, 200);
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeSidebar();
});

let touchStartX = 0;
document.addEventListener('touchstart', function(e) {
  touchStartX = e.touches[0].clientX;
});
document.addEventListener('touchend', function(e) {
  const touchEndX = e.changedTouches[0].clientX;
  const sidebar = document.getElementById('sidebar');
  if (sidebar && sidebar.classList.contains('open') && touchStartX - touchEndX > 50) {
    closeSidebar();
  }
});

// ==========================================
// PASSWORD FEATURES
// ==========================================
function togglePassword(inputId, iconEl) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    iconEl.classList.remove('bx-hide');
    iconEl.classList.add('bx-show');
  } else {
    input.type = 'password';
    iconEl.classList.remove('bx-show');
    iconEl.classList.add('bx-hide');
  }
}

function checkPasswordStrength() {
  const password = document.getElementById('signup-password').value;
  const strengthBar = document.getElementById('password-strength');
  if (!strengthBar) return;
  strengthBar.className = 'password-strength';
  if (password.length === 0) return;
  
  let strength = 0;
  if (password.length >= 6) strength++;
  if (password.length >= 10) strength++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^A-Za-z0-9]/.test(password)) strength++;
  
  if (strength <= 2) strengthBar.classList.add('weak');
  else if (strength <= 3) strengthBar.classList.add('medium');
  else strengthBar.classList.add('strong');
}

async function sendPasswordReset() {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  msg.className = 'msg';
  
  if (!email) { msg.textContent = 'Please enter your email address'; return; }
  if (!email.includes('@') || !email.includes('.')) {
    msg.textContent = 'Please enter a valid email address'; return;
  }
  
  msg.textContent = 'Sending reset link...';
  
  try {
    await auth.sendPasswordResetEmail(email);
    msg.className = 'msg success';
    msg.innerHTML = '✓ Reset link sent! Check your email inbox and spam folder.';
    showToast('Email Sent', 'Check your inbox for the reset link', 'success');
    setTimeout(() => { showLogin(); msg.textContent = ''; }, 4000);
  } catch (err) {
    if (err.code === 'auth/user-not-found') msg.textContent = 'No account found with this email';
    else if (err.code === 'auth/invalid-email') msg.textContent = 'Invalid email format';
    else if (err.code === 'auth/too-many-requests') msg.textContent = 'Too many attempts. Try again later.';
    else msg.textContent = err.message;
  }
}

// ==========================================
// AUTH
// ==========================================
async function signup() {
  const orgName = document.getElementById('org-name').value.trim();
  const fullName = document.getElementById('full-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const msg = document.getElementById('signup-msg');
  msg.className = 'msg';

  if (!orgName || !fullName || !email || !password) {
    msg.textContent = 'Please fill all fields'; return;
  }
  if (password.length < 6) {
    msg.textContent = 'Password must be at least 6 characters'; return;
  }
  msg.textContent = 'Creating account...';

  try {
    const userCred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = userCred.user.uid;

    const orgRef = await db.collection('organizations').add({
      name: orgName, email: email, ownerId: uid,
      taxRate: TAX_RATE, currency: CURRENCY, country: 'Zambia',
      themeColor: '#6366f1',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('users').doc(uid).set({
      fullName: fullName, email: email,
      organizationId: orgRef.id, role: 'admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    msg.className = 'msg success';
    msg.textContent = '✓ Account created! Loading...';
  } catch (err) { msg.textContent = err.message; }
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');
  msg.className = 'msg';
  msg.textContent = 'Logging in...';
  try {
    await auth.signInWithEmailAndPassword(email, password);
    msg.textContent = '';
  } catch (err) { msg.textContent = err.message; }
}

async function logout() {
  await auth.signOut();
  cart = []; products = [];
  currentUser = null; currentOrgId = null; currentOrg = null;
  showLogin();
}

async function loadUserData() {
  if (!currentUser) return;
  const userDoc = await db.collection('users').doc(currentUser.uid).get();
  if (!userDoc.exists) { 
    showToast('Error', 'User profile not found', 'error'); 
    logout(); return; 
  }
  const userData = userDoc.data();
  currentOrgId = userData.organizationId;

  const orgDoc = await db.collection('organizations').doc(currentOrgId).get();
  currentOrg = orgDoc.data();

  document.getElementById('business-name').textContent = currentOrg?.name || 'POS';
  document.getElementById('user-name').textContent = userData.fullName;
  document.getElementById('user-role').textContent = userData.role;
  document.getElementById('user-avatar').textContent = userData.fullName.charAt(0).toUpperCase();
}

// ==========================================
// PRODUCTS
// ==========================================
async function loadProducts() {
  if (!currentOrgId) return;
  const snap = await db.collection('organizations').doc(currentOrgId)
    .collection('products').orderBy('name').get();
  products = [];
  snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
  renderProducts();
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = `${cart.reduce((s,i)=>s+i.qty,0)} items`;
  
  if (products.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;color:var(--gray-400);"><i class="bx bx-package" style="font-size:64px;display:block;margin-bottom:12px;"></i><p>No products yet. Go to Products tab to add some.</p></div>';
    return;
  }
  grid.innerHTML = products.map(p => {
    const stockClass = p.qtyOnHand === 0 ? 'out' : (p.qtyOnHand < 10 ? 'low' : '');
    return `
      <div class="product-card" onclick="addToCart('${p.id}')">
        <div class="product-icon"><i class='bx bx-cube'></i></div>
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="price">${money(p.price)}</div>
        <div class="stock ${stockClass}">${p.qtyOnHand} in stock</div>
      </div>
    `;
  }).join('');
}

async function addProduct() {
  const sku = document.getElementById('new-sku').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const price = parseFloat(document.getElementById('new-price').value);
  const qty = parseInt(document.getElementById('new-qty').value) || 0;
  if (!sku || !name || isNaN(price)) { 
    showToast('Missing Info', 'Please fill SKU, Name, and Price', 'warning'); 
    return; 
  }
  try {
    await db.collection('organizations').doc(currentOrgId)
      .collection('products').add({
        sku, name, price, qtyOnHand: qty, active: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    document.getElementById('new-sku').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-price').value = '';
    document.getElementById('new-qty').value = '';
    await loadProducts();
    renderProductsTable();
    showToast('Success', `${name} added successfully`, 'success');
  } catch (err) { showToast('Error', err.message, 'error'); }
}

function renderProductsTable() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = products.map(p => `
    <tr>
      <td>${escapeHtml(p.sku)}</td>
      <td>${escapeHtml(p.name)}</td>
      <td>${money(p.price)}</td>
      <td>${p.qtyOnHand}</td>
      <td><button onclick="deleteProduct('${p.id}')" class="btn btn-danger" style="padding:6px 12px;font-size:12px"><i class='bx bx-trash'></i> Delete</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No products yet</td></tr>';
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  await db.collection('organizations').doc(currentOrgId)
    .collection('products').doc(id).delete();
  await loadProducts();
  renderProductsTable();
  showToast('Deleted', 'Product removed', 'success');
}

// ==========================================
// CART
// ==========================================
function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ ...product, qty: 1 });
  renderCart();
}

function updateQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  renderCart();
}

function removeItem(id) {
  cart = cart.filter(i => i.id !== id);
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = `${cart.reduce((s,i)=>s+i.qty,0)} items`;
  
  container.innerHTML = cart.map(i => `
    <div class="cart-row">
      <span class="name">${escapeHtml(i.name)}</span>
      <div class="qty-controls">
        <button onclick="updateQty('${i.id}', -1)">−</button>
        <span>${i.qty}</span>
        <button onclick="updateQty('${i.id}', 1)">+</button>
      </div>
      <span class="item-total">${money(i.price * i.qty)}</span>
      <button class="remove" onclick="removeItem('${i.id}')"><i class='bx bx-x'></i></button>
    </div>
  `).join('') || '<div class="cart-empty"><i class="bx bx-cart"></i><p>Cart is empty</p><small>Click a product to add it</small></div>';

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;

  document.getElementById('subtotal').textContent = moneyValue(subtotal);
  document.getElementById('tax').textContent = moneyValue(tax);
  document.getElementById('total').textContent = moneyValue(total);
  document.getElementById('change').textContent = moneyValue(Math.max(0, paid - total));
}

function clearCart() {
  cart = [];
  document.getElementById('amount-paid').value = '';
  renderCart();
}

function handleSkuEnter(e) {
  if (e.key !== 'Enter') return;
  const sku = e.target.value.trim();
  if (!sku) return;
  const product = products.find(p => p.sku === sku);
  if (product) { addToCart(product.id); e.target.value = ''; }
  else showToast('Not Found', 'Product not found: ' + sku, 'warning');
}

// ==========================================
// COMPLETE SALE
// ==========================================
async function completeSale() {
  if (saleInProgress) return;
  if (cart.length === 0) { showToast('Empty Cart', 'Add items to cart first', 'warning'); return; }
  
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;
  if (paid < total) { 
    showToast('Insufficient Payment', `Need at least ${money(total)}`, 'warning'); 
    return; 
  }

  saleInProgress = true;
  const payBtn = document.querySelector('.btn-success');
  const originalText = payBtn.innerHTML;
  payBtn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Processing...';
  payBtn.disabled = true;
  payBtn.style.opacity = '0.6';
  payBtn.style.cursor = 'not-allowed';

  try {
    const orderData = {
      items: cart.map(i => ({
        productId: i.id, sku: i.sku, name: i.name,
        qty: i.qty, price: i.price, lineTotal: i.price * i.qty
      })),
      subtotal, tax, total,
      amountPaid: paid,
      changeGiven: paid - total,
      cashierId: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('organizations').doc(currentOrgId)
      .collection('orders').add(orderData);

    const batch = db.batch();
    for (const item of cart) {
      const ref = db.collection('organizations').doc(currentOrgId)
        .collection('products').doc(item.id);
      batch.update(ref, { qtyOnHand: item.qtyOnHand - item.qty });
    }
    await batch.commit();

    showToast('Sale Complete! ✓', `Total: ${money(total)} | Change: ${money(paid - total)}`, 'success');
    clearCart();
    await loadProducts();
  } catch (err) {
    showToast('Error', err.message, 'error');
  } finally {
    saleInProgress = false;
    payBtn.innerHTML = originalText;
    payBtn.disabled = false;
    payBtn.style.opacity = '1';
    payBtn.style.cursor = 'pointer';
  }
}

// ==========================================
// ORDERS
// ==========================================
async function loadOrders() {
  const snap = await db.collection('organizations').doc(currentOrgId)
    .collection('orders').orderBy('createdAt', 'desc').limit(50).get();
  const tbody = document.getElementById('orders-tbody');
  const rows = [];
  snap.forEach(doc => {
    const o = doc.data();
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-ZM') : '-';
    const itemCount = (o.items || []).reduce((s, i) => s + i.qty, 0);
    rows.push(`
      <tr>
        <td>${date}</td>
        <td>${itemCount}</td>
        <td>${money(o.total)}</td>
        <td>${money(o.amountPaid)}</td>
        <td>${money(o.changeGiven)}</td>
      </tr>
    `);
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No orders yet</td></tr>';
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
  if (!currentOrgId) return;
  document.getElementById('stat-total-products').textContent = products.length;
  const lowStock = products.filter(p => p.qtyOnHand < 10).length;
  document.getElementById('stat-low-stock').textContent = lowStock;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = firebase.firestore.Timestamp.fromDate(today);
  
  const snap = await db.collection('organizations').doc(currentOrgId)
    .collection('orders').where('createdAt', '>=', todayTimestamp).get();
  
  let todaySales = 0, todayOrders = 0;
  snap.forEach(doc => {
    todaySales += doc.data().total || 0;
    todayOrders++;
  });
  
  document.getElementById('stat-today-sales').textContent = moneyValue(todaySales);
  document.getElementById('stat-today-orders').textContent = todayOrders;
  
  const recentSnap = await db.collection('organizations').doc(currentOrgId)
    .collection('orders').orderBy('createdAt', 'desc').limit(5).get();
  
  const activityDiv = document.getElementById('recent-activity');
  const items = [];
  recentSnap.forEach(doc => {
    const o = doc.data();
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-ZM') : '-';
    const itemCount = (o.items || []).reduce((s, i) => s + i.qty, 0);
    items.push(`
      <div style="padding:14px 0;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;color:var(--gray-900);font-size:14px;">Sale of ${itemCount} items</div>
          <small style="color:var(--gray-500);">${date}</small>
        </div>
        <div style="font-weight:700;color:var(--success);font-size:16px;">${money(o.total)}</div>
      </div>
    `);
  });
  activityDiv.innerHTML = items.join('') || '<p style="color:var(--gray-500);text-align:center;padding:20px;">No activity yet</p>';
}

// ==========================================
// DARK MODE
// ==========================================
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'on' : 'off');
  const icon = document.querySelector('#theme-btn i');
  if (isDark) {
    icon.classList.remove('bx-moon');
    icon.classList.add('bx-sun');
    showToast('Dark Mode', 'Enabled', 'info');
  } else {
    icon.classList.remove('bx-sun');
    icon.classList.add('bx-moon');
    showToast('Light Mode', 'Enabled', 'info');
  }
}

function loadDarkModePreference() {
  if (localStorage.getItem('darkMode') === 'on') {
    document.body.classList.add('dark-mode');
    const icon = document.querySelector('#theme-btn i');
    if (icon) {
      icon.classList.remove('bx-moon');
      icon.classList.add('bx-sun');
    }
  }
}

// ==========================================
// THEME COLOR
// ==========================================
function setThemeColor(color) {
  document.documentElement.style.setProperty('--primary', color);
  const darker = shadeColor(color, -15);
  document.documentElement.style.setProperty('--primary-dark', darker);
  const lighter = shadeColor(color, 40);
  document.documentElement.style.setProperty('--primary-light', lighter);
  
  localStorage.setItem('themeColor', color);
  
  if (currentOrgId) {
    db.collection('organizations').doc(currentOrgId)
      .update({ themeColor: color })
      .catch(() => {});
  }
  
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
}

function shadeColor(color, percent) {
  let R = parseInt(color.substring(1,3), 16);
  let G = parseInt(color.substring(3,5), 16);
  let B = parseInt(color.substring(5,7), 16);
  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);
  R = Math.min(255, Math.max(0, R));
  G = Math.min(255, Math.max(0, G));
  B = Math.min(255, Math.max(0, B));
  const RR = R.toString(16).padStart(2, '0');
  const GG = G.toString(16).padStart(2, '0');
  const BB = B.toString(16).padStart(2, '0');
  return '#' + RR + GG + BB;
}

// ==========================================
// SETTINGS
// ==========================================
function loadSettings() {
  if (!currentOrg) return;
  
  document.getElementById('setting-biz-name').value = currentOrg.name || '';
  document.getElementById('setting-phone').value = currentOrg.phone || '';
  document.getElementById('setting-address').value = currentOrg.address || '';
  document.getElementById('setting-email').value = currentOrg.email || '';
  document.getElementById('setting-tax').value = ((currentOrg.taxRate || TAX_RATE) * 100).toFixed(2);
  document.getElementById('setting-currency').value = currentOrg.currency || CURRENCY;
  
  const color = currentOrg.themeColor || '#6366f1';
  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.color === color);
  });
}

async function saveBusinessInfo() {
  const name = document.getElementById('setting-biz-name').value.trim();
  const phone = document.getElementById('setting-phone').value.trim();
  const address = document.getElementById('setting-address').value.trim();
  const email = document.getElementById('setting-email').value.trim();
  
  if (!name) { showToast('Error', 'Business name is required', 'error'); return; }
  
  try {
    await db.collection('organizations').doc(currentOrgId).update({
      name, phone, address, email
    });
    currentOrg.name = name;
    currentOrg.phone = phone;
    currentOrg.address = address;
    currentOrg.email = email;
    document.getElementById('business-name').textContent = name;
    showToast('Success', 'Business info updated', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function saveTaxSettings() {
  const taxPercent = parseFloat(document.getElementById('setting-tax').value);
  const currency = document.getElementById('setting-currency').value.trim() || 'K';
  
  if (isNaN(taxPercent) || taxPercent < 0 || taxPercent > 100) {
    showToast('Error', 'Enter valid tax rate (0-100)', 'error');
    return;
  }
  
  try {
    await db.collection('organizations').doc(currentOrgId).update({
      taxRate: taxPercent / 100,
      currency: currency
    });
    currentOrg.taxRate = taxPercent / 100;
    currentOrg.currency = currency;
    TAX_RATE = taxPercent / 100;
    CURRENCY = currency;
    renderCart();
    renderProducts();
    showToast('Success', 'Tax settings updated', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// ==========================================
// UI HELPERS
// ==========================================
function showToast(title, message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: 'bx-check-circle', error: 'bx-x-circle', warning: 'bx-error', info: 'bx-info-circle' };
  toast.innerHTML = `
    <i class='bx ${icons[type]}'></i>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s reverse';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updateMobileTitle(title) {
  const el = document.getElementById('mobile-title');
  if (el) el.textContent = title;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

// ==========================================
// AUTO LOGIN CHECK
// ==========================================
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUser = user;
    await showPOS();
  } else {
    currentUser = null;
    showLogin();
  }
});
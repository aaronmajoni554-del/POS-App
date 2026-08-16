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

// Zambian settings
const TAX_RATE = 0.16;  // 16% VAT
const CURRENCY = 'K';

// Format money in Kwacha
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
async function showPOS() {
  toggleScreen('pos-screen');
  await loadUserData();
  await loadProducts();
}

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(tab + '-tab').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  
  const titles = { pos: 'Point of Sale', products: 'Products', orders: 'Orders', dashboard: 'Dashboard' };
  updateMobileTitle(titles[tab]);
  
  if (tab === 'products') renderProductsTable();
  if (tab === 'orders') loadOrders();
  if (tab === 'dashboard') loadDashboard();
  
  document.querySelector('.sidebar')?.classList.remove('open');
}

// ==========================================
// AUTH - SIGNUP
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
      name: orgName,
      email: email,
      ownerId: uid,
      taxRate: TAX_RATE,
      currency: CURRENCY,
      country: 'Zambia',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('users').doc(uid).set({
      fullName: fullName,
      email: email,
      organizationId: orgRef.id,
      role: 'admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    msg.className = 'msg success';
    msg.textContent = '✓ Account created! Loading...';
  } catch (err) {
    msg.textContent = err.message;
  }
}

// ==========================================
// AUTH - LOGIN
// ==========================================
async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');
  msg.className = 'msg';
  msg.textContent = 'Logging in...';
  try {
    await auth.signInWithEmailAndPassword(email, password);
    msg.textContent = '';
  } catch (err) {
    msg.textContent = err.message;
  }
}

// ==========================================
// AUTH - LOGOUT
// ==========================================
async function logout() {
  await auth.signOut();
  cart = [];
  products = [];
  currentUser = null;
  currentOrgId = null;
  currentOrg = null;
  showLogin();
}

// ==========================================
// LOAD USER DATA
// ==========================================
async function loadUserData() {
  if (!currentUser) return;
  const userDoc = await db.collection('users').doc(currentUser.uid).get();
  if (!userDoc.exists) { 
    showToast('Error', 'User profile not found', 'error'); 
    logout(); 
    return; 
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
// PRODUCTS - LOAD
// ==========================================
async function loadProducts() {
  if (!currentOrgId) return;
  const snap = await db.collection('organizations').doc(currentOrgId)
    .collection('products').orderBy('name').get();
  products = [];
  snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
  renderProducts();
}

// ==========================================
// PRODUCTS - RENDER GRID (POS)
// ==========================================
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

// ==========================================
// PRODUCTS - ADD NEW
// ==========================================
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
  } catch (err) { 
    showToast('Error', err.message, 'error'); 
  }
}

// ==========================================
// PRODUCTS - RENDER TABLE
// ==========================================
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

// ==========================================
// PRODUCTS - DELETE
// ==========================================
async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  await db.collection('organizations').doc(currentOrgId)
    .collection('products').doc(id).delete();
  await loadProducts();
  renderProductsTable();
  showToast('Deleted', 'Product removed', 'success');
}

// ==========================================
// CART FUNCTIONS
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
// COMPLETE SALE (with double-click protection)
// ==========================================
async function completeSale() {
  if (saleInProgress) return;

  if (cart.length === 0) { 
    showToast('Empty Cart', 'Add items to cart first', 'warning'); 
    return; 
  }
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
// ORDERS - LOAD
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
// UI ENHANCEMENTS
// ==========================================
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
}

function showToast(title, message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'bx-check-circle',
    error: 'bx-x-circle',
    warning: 'bx-error',
    info: 'bx-info-circle'
  };
  
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
    .collection('orders')
    .where('createdAt', '>=', todayTimestamp)
    .get();
  
  let todaySales = 0;
  let todayOrders = 0;
  snap.forEach(doc => {
    todaySales += doc.data().total || 0;
    todayOrders++;
  });
  
  document.getElementById('stat-today-sales').textContent = moneyValue(todaySales);
  document.getElementById('stat-today-orders').textContent = todayOrders;
  
  const recentSnap = await db.collection('organizations').doc(currentOrgId)
    .collection('orders')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  
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
// UTILS
// ==========================================
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
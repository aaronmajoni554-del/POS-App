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
const TAX_RATE = 0.0825;

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
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tab + '-tab').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab === 'products') renderProductsTable();
  if (tab === 'orders') loadOrders();
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
    // 1. Create Firebase auth user
    const userCred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = userCred.user.uid;

    // 2. Create organization document
    const orgRef = await db.collection('organizations').add({
      name: orgName,
      email: email,
      ownerId: uid,
      taxRate: TAX_RATE,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 3. Create user profile linked to organization
    await db.collection('users').doc(uid).set({
      fullName: fullName,
      email: email,
      organizationId: orgRef.id,
      role: 'admin',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    msg.className = 'msg success';
    msg.textContent = '✓ Account created! Loading...';
    // onAuthStateChanged will automatically load POS
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
    // onAuthStateChanged will load POS
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
  if (!userDoc.exists) { alert('User profile not found'); logout(); return; }
  const userData = userDoc.data();
  currentOrgId = userData.organizationId;

  const orgDoc = await db.collection('organizations').doc(currentOrgId).get();
  currentOrg = orgDoc.data();

  document.getElementById('business-name').textContent = currentOrg?.name || 'POS';
  document.getElementById('user-info').textContent = `👤 ${userData.fullName} (${userData.role})`;
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
// PRODUCTS - RENDER GRID
// ==========================================
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if (products.length === 0) {
    grid.innerHTML = '<p style="color:#6b7280">No products yet. Go to Products tab to add some.</p>';
    return;
  }
  grid.innerHTML = products.map(p => `
    <div class="product-card" onclick="addToCart('${p.id}')">
      ${escapeHtml(p.name)}
      <span class="price">$${Number(p.price).toFixed(2)}</span>
      <span class="stock">Stock: ${p.qtyOnHand}</span>
    </div>
  `).join('');
}

// ==========================================
// PRODUCTS - ADD NEW
// ==========================================
async function addProduct() {
  const sku = document.getElementById('new-sku').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const price = parseFloat(document.getElementById('new-price').value);
  const qty = parseInt(document.getElementById('new-qty').value) || 0;
  if (!sku || !name || isNaN(price)) { alert('Fill SKU, Name, and Price'); return; }

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
  } catch (err) { alert(err.message); }
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
      <td>$${Number(p.price).toFixed(2)}</td>
      <td>${p.qtyOnHand}</td>
      <td><button onclick="deleteProduct('${p.id}')" class="btn-danger" style="width:auto;padding:4px 10px;font-size:12px">Delete</button></td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:#6b7280">No products yet</td></tr>';
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
}

// ==========================================
// CART - ADD ITEM
// ==========================================
function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  const existing = cart.find(i => i.id === id);
  if (existing) existing.qty++;
  else cart.push({ ...product, qty: 1 });
  renderCart();
}

// ==========================================
// CART - UPDATE QUANTITY
// ==========================================
function updateQty(id, delta) {
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
  renderCart();
}

// ==========================================
// CART - REMOVE ITEM
// ==========================================
function removeItem(id) {
  cart = cart.filter(i => i.id !== id);
  renderCart();
}

// ==========================================
// CART - RENDER
// ==========================================
function renderCart() {
  const container = document.getElementById('cart-items');
  container.innerHTML = cart.map(i => `
    <div class="cart-row">
      <span class="name">${escapeHtml(i.name)}</span>
      <div class="qty-controls">
        <button onclick="updateQty('${i.id}', -1)">−</button>
        <span>${i.qty}</span>
        <button onclick="updateQty('${i.id}', 1)">+</button>
      </div>
      <span>$${(i.price * i.qty).toFixed(2)}</span>
      <button class="remove" onclick="removeItem('${i.id}')">✕</button>
    </div>
  `).join('') || '<p style="color:#6b7280;text-align:center;padding:20px">Cart is empty</p>';

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;

  document.getElementById('subtotal').textContent = subtotal.toFixed(2);
  document.getElementById('tax').textContent = tax.toFixed(2);
  document.getElementById('total').textContent = total.toFixed(2);
  document.getElementById('change').textContent = Math.max(0, paid - total).toFixed(2);
}

// ==========================================
// CART - CLEAR
// ==========================================
function clearCart() {
  cart = [];
  document.getElementById('amount-paid').value = '';
  renderCart();
}

// ==========================================
// SKU SCAN / MANUAL ENTRY
// ==========================================
function handleSkuEnter(e) {
  if (e.key !== 'Enter') return;
  const sku = e.target.value.trim();
  if (!sku) return;
  const product = products.find(p => p.sku === sku);
  if (product) { addToCart(product.id); e.target.value = ''; }
  else alert('Product not found: ' + sku);
}

// ==========================================
// COMPLETE SALE (with double-click protection)
// ==========================================
async function completeSale() {
  // Prevent double-click
  if (saleInProgress) return;

  if (cart.length === 0) { alert('Cart is empty'); return; }
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;
  if (paid < total) { alert('Insufficient payment'); return; }

  // Lock the button
  saleInProgress = true;
  const payBtn = document.querySelector('.btn-success');
  const originalText = payBtn.textContent;
  payBtn.textContent = 'Processing...';
  payBtn.disabled = true;
  payBtn.style.opacity = '0.5';
  payBtn.style.cursor = 'not-allowed';

  try {
    // Save order with items embedded
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

    // Reduce stock for each item
    const batch = db.batch();
    for (const item of cart) {
      const ref = db.collection('organizations').doc(currentOrgId)
        .collection('products').doc(item.id);
      batch.update(ref, { qtyOnHand: item.qtyOnHand - item.qty });
    }
    await batch.commit();

    alert(`✓ Sale Complete!\nTotal: $${total.toFixed(2)}\nChange: $${(paid - total).toFixed(2)}`);
    clearCart();
    await loadProducts();
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    // Always unlock the button, even if error
    saleInProgress = false;
    payBtn.textContent = originalText;
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
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString() : '-';
    const itemCount = (o.items || []).reduce((s, i) => s + i.qty, 0);
    rows.push(`
      <tr>
        <td>${date}</td>
        <td>${itemCount}</td>
        <td>$${Number(o.total).toFixed(2)}</td>
        <td>$${Number(o.amountPaid).toFixed(2)}</td>
        <td>$${Number(o.changeGiven).toFixed(2)}</td>
      </tr>
    `);
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:#6b7280">No orders yet</td></tr>';
}

// ==========================================
// UTILS - Escape HTML for safety
// ==========================================
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

// ==========================================
// AUTO LOGIN CHECK - Firebase watches auth state
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
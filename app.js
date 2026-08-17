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
let currentUserData = null;
let currentOrgId = null;
let currentOrg = null;
let saleInProgress = false;
let codeReader = null;
let currentReceipt = null;
let currentStream = null;
let flashlightOn = false;
let searchTimeout = null;
let currentSuggestions = [];
let highlightedIndex = -1;
let currentInviteCode = null;

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
function showJoinTeam() { toggleScreen('join-screen'); }
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
  
  if (currentOrg?.themeColor) setThemeColor(currentOrg.themeColor);
  if (currentOrg?.taxRate !== undefined) TAX_RATE = currentOrg.taxRate;
  if (currentOrg?.currency) CURRENCY = currentOrg.currency;
  
  applyRolePermissions();
}

function applyRolePermissions() {
  document.body.classList.remove('is-admin', 'is-manager', 'is-cashier');
  
  if (currentUserData?.role === 'admin') {
    document.body.classList.add('is-admin');
  } else if (currentUserData?.role === 'manager') {
    document.body.classList.add('is-manager');
  } else {
    document.body.classList.add('is-cashier');
  }
}

function showTab(tab) {
  // Check permissions
  if ((tab === 'staff' || tab === 'settings') && currentUserData?.role !== 'admin') {
    showToast('Access Denied', 'Only admins can access this', 'warning');
    return;
  }
  if ((tab === 'products' || tab === 'dashboard') && currentUserData?.role === 'cashier') {
    showToast('Access Denied', 'Contact your admin for access', 'warning');
    return;
  }
  
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(tab + '-tab').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  
  const titles = { 
    pos: 'Point of Sale', products: 'Products', 
    orders: 'Orders', dashboard: 'Dashboard', 
    staff: 'Staff', settings: 'Settings'
  };
  updateMobileTitle(titles[tab]);
  
  if (tab === 'products') renderProductsTable();
  if (tab === 'orders') loadOrders();
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'staff') loadStaffData();
  if (tab === 'settings') loadSettings();
  
  autoCloseSidebar();
}

// ==========================================
// SIDEBAR
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
  if (e.key === 'Escape') { closeSidebar(); closeScanner(); closeReceiptModal(); closeInviteModal(); hideSuggestions(); }
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
// AUTH - SIGNUP (Business Owner)
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

// ==========================================
// AUTH - JOIN TEAM (Staff with Invite)
// ==========================================
async function joinWithCode() {
  const code = document.getElementById('invite-code').value.trim().toUpperCase();
  const password = document.getElementById('join-password').value;
  const msg = document.getElementById('join-msg');
  msg.className = 'msg';

  if (!code || !password) {
    msg.textContent = 'Please enter code and password'; return;
  }
  if (password.length < 6) {
    msg.textContent = 'Password must be at least 6 characters'; return;
  }

  msg.textContent = 'Verifying invite code...';

  try {
    // Find invitation
    const inviteSnap = await db.collection('invitations')
      .where('code', '==', code)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (inviteSnap.empty) {
      msg.textContent = 'Invalid or expired invite code';
      return;
    }

    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data();

    msg.textContent = 'Creating your account...';

    // Create auth user
    const userCred = await auth.createUserWithEmailAndPassword(invite.email, password);
    const uid = userCred.user.uid;

    // Create profile
    await db.collection('users').doc(uid).set({
      fullName: invite.fullName,
      email: invite.email,
      organizationId: invite.organizationId,
      role: invite.role,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Mark invitation as used
    await db.collection('invitations').doc(inviteDoc.id).update({
      status: 'accepted',
      acceptedAt: firebase.firestore.FieldValue.serverTimestamp(),
      acceptedBy: uid
    });

    msg.className = 'msg success';
    msg.textContent = `✓ Welcome to ${invite.orgName}! Loading...`;
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      msg.textContent = 'This email is already registered. Please sign in.';
    } else {
      msg.textContent = err.message;
    }
  }
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
  currentUser = null; currentUserData = null;
  currentOrgId = null; currentOrg = null;
  showLogin();
}

async function loadUserData() {
  if (!currentUser) return;
  const userDoc = await db.collection('users').doc(currentUser.uid).get();
  if (!userDoc.exists) { 
    showToast('Error', 'User profile not found', 'error'); 
    logout(); return; 
  }
  currentUserData = userDoc.data();
  currentOrgId = currentUserData.organizationId;
  const orgDoc = await db.collection('organizations').doc(currentOrgId).get();
  currentOrg = orgDoc.data();
  document.getElementById('business-name').textContent = currentOrg?.name || 'POS';
  document.getElementById('user-name').textContent = currentUserData.fullName;
  document.getElementById('user-role').textContent = currentUserData.role;
  document.getElementById('user-avatar').textContent = currentUserData.fullName.charAt(0).toUpperCase();
}

// ==========================================
// STAFF MANAGEMENT
// ==========================================
function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function createInvitation() {
  if (currentUserData?.role !== 'admin') {
    showToast('Access Denied', 'Only admins can invite staff', 'error');
    return;
  }

  const fullName = document.getElementById('staff-name').value.trim();
  const email = document.getElementById('staff-email').value.trim();
  const role = document.getElementById('staff-role').value;

  if (!fullName || !email) {
    showToast('Missing Info', 'Please fill name and email', 'warning');
    return;
  }
  if (!email.includes('@')) {
    showToast('Invalid Email', 'Please enter a valid email', 'warning');
    return;
  }

  const code = generateInviteCode();

  try {
    await db.collection('invitations').add({
      code: code,
      email: email,
      fullName: fullName,
      role: role,
      organizationId: currentOrgId,
      orgName: currentOrg.name,
      invitedBy: currentUser.uid,
      status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    currentInviteCode = code;
    document.getElementById('invite-name').textContent = fullName;
    document.getElementById('invite-code-display').textContent = code;
    document.getElementById('invite-code-modal').classList.add('active');

    // Clear form
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-role').value = 'cashier';

    await loadStaffData();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

function closeInviteModal() {
  document.getElementById('invite-code-modal').classList.remove('active');
  currentInviteCode = null;
}

function copyInviteCode() {
  if (!currentInviteCode) return;
  
  const btn = event.target.closest('button');
  const originalText = btn.innerHTML;
  
  navigator.clipboard.writeText(currentInviteCode).then(() => {
    btn.innerHTML = '<i class="bx bx-check"></i> Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = originalText;
      btn.classList.remove('copied');
    }, 2000);
    showToast('Copied!', 'Invite code copied to clipboard', 'success');
  }).catch(() => {
    // Fallback
    const input = document.createElement('input');
    input.value = currentInviteCode;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied!', 'Invite code copied', 'success');
  });
}

async function shareInviteLink() {
  if (!currentInviteCode) return;
  
  const orgName = currentOrg?.name || 'our business';
  const text = `You've been invited to join *${orgName}* on ModernPOS!\n\n` +
    `Your invitation code is: *${currentInviteCode}*\n\n` +
    `Go to: ${window.location.origin}${window.location.pathname}\n\n` +
    `Click "Join with invite code" and enter the code above to create your account.`;

  if (navigator.share) {
    try {
      await navigator.share({ title: `Invitation to ${orgName}`, text: text });
    } catch (err) {
      if (err.name !== 'AbortError') {
        const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
        window.open(url, '_blank');
      }
    }
  } else {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }
}

async function loadStaffData() {
  await loadInvitations();
  await loadStaffMembers();
}

async function loadInvitations() {
  const tbody = document.getElementById('invitations-tbody');
  if (!tbody) return;
  
  try {
    const snap = await db.collection('invitations')
      .where('organizationId', '==', currentOrgId)
      .where('status', '==', 'pending')
      .get();
    
    const rows = [];
    snap.forEach(doc => {
      const inv = doc.data();
      const roleBadge = `<span class="role-badge ${inv.role}">${inv.role}</span>`;
      rows.push(`
        <tr>
          <td>${escapeHtml(inv.fullName)}</td>
          <td>${escapeHtml(inv.email)}</td>
          <td>${roleBadge}</td>
          <td><code style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-weight:700;">${inv.code}</code></td>
          <td>
            <button onclick="reshowInvite('${inv.code}', '${escapeHtml(inv.fullName)}')" class="btn btn-primary" style="padding:6px 10px;font-size:12px;margin-right:4px;">
              <i class='bx bx-show'></i>
            </button>
            <button onclick="deleteInvitation('${doc.id}')" class="btn btn-danger" style="padding:6px 10px;font-size:12px;">
              <i class='bx bx-trash'></i>
            </button>
          </td>
        </tr>
      `);
    });
    
    tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No pending invitations</td></tr>';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:40px;">Error loading invitations</td></tr>';
  }
}

function reshowInvite(code, name) {
  currentInviteCode = code;
  document.getElementById('invite-name').textContent = name;
  document.getElementById('invite-code-display').textContent = code;
  document.getElementById('invite-code-modal').classList.add('active');
}

async function deleteInvitation(id) {
  if (!confirm('Delete this invitation?')) return;
  try {
    await db.collection('invitations').doc(id).delete();
    await loadInvitations();
    showToast('Deleted', 'Invitation removed', 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function loadStaffMembers() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;
  
  try {
    // Get all users in this organization
    const snap = await db.collection('users')
      .where('organizationId', '==', currentOrgId)
      .get();
    
    const users = [];
    snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
    
    // Get sales counts for each user
    const ordersSnap = await db.collection('organizations').doc(currentOrgId)
      .collection('orders').get();
    
    const salesByUser = {};
    ordersSnap.forEach(doc => {
      const order = doc.data();
      if (order.cashierId) {
        if (!salesByUser[order.cashierId]) {
          salesByUser[order.cashierId] = { count: 0, total: 0 };
        }
        salesByUser[order.cashierId].count++;
        salesByUser[order.cashierId].total += order.total || 0;
      }
    });
    
    const rows = [];
    users.forEach(user => {
      const roleBadge = `<span class="role-badge ${user.role}">${user.role}</span>`;
      const sales = salesByUser[user.id] || { count: 0, total: 0 };
      const isSelf = user.id === currentUser.uid;
      
      rows.push(`
        <tr>
          <td>
            <strong>${escapeHtml(user.fullName)}</strong>
            ${isSelf ? ' <small style="color:var(--primary);">(You)</small>' : ''}
          </td>
          <td>${escapeHtml(user.email)}</td>
          <td>${roleBadge}</td>
          <td>
            <div style="font-weight:600;">${sales.count} sales</div>
            <small style="color:var(--gray-500);">${money(sales.total)}</small>
          </td>
          <td>
            ${!isSelf ? `
              <button onclick="changeUserRole('${user.id}', '${user.role}', '${escapeHtml(user.fullName)}')" class="btn btn-primary" style="padding:6px 10px;font-size:12px;margin-right:4px;">
                <i class='bx bx-edit'></i>
              </button>
              <button onclick="removeStaff('${user.id}', '${escapeHtml(user.fullName)}')" class="btn btn-danger" style="padding:6px 10px;font-size:12px;">
                <i class='bx bx-trash'></i>
              </button>
            ` : '<span style="color:var(--gray-400);font-size:12px;">Cannot modify self</span>'}
          </td>
        </tr>
      `);
    });
    
    tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No team members yet</td></tr>';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:40px;">Error loading staff</td></tr>';
  }
}

async function changeUserRole(userId, currentRole, userName) {
  const newRole = prompt(`Change ${userName}'s role\n\nCurrent: ${currentRole}\n\nEnter new role (admin/manager/cashier):`, currentRole);
  
  if (!newRole || newRole === currentRole) return;
  
  const validRoles = ['admin', 'manager', 'cashier'];
  if (!validRoles.includes(newRole.toLowerCase())) {
    showToast('Invalid Role', 'Must be admin, manager, or cashier', 'error');
    return;
  }
  
  try {
    await db.collection('users').doc(userId).update({ role: newRole.toLowerCase() });
    await loadStaffMembers();
    showToast('Updated!', `${userName} is now a ${newRole}`, 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

async function removeStaff(userId, userName) {
  if (!confirm(`Remove ${userName} from your team?\n\nThis will delete their access to your POS but not their sales history.`)) return;
  
  try {
    await db.collection('users').doc(userId).delete();
    await loadStaffMembers();
    showToast('Removed', `${userName} removed from team`, 'success');
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
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
  const searchInfo = document.getElementById('search-info');
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = `${cart.reduce((s,i)=>s+i.qty,0)} items`;
  
  if (searchInfo) searchInfo.style.display = 'none';
  
  if (products.length === 0) {
    grid.innerHTML = `
      <div class="empty-scan-state" style="grid-column:1/-1;">
        <div class="empty-icon"><i class='bx bx-package'></i></div>
        <h3>No Products Yet</h3>
        <p>Add products to your inventory first!</p>
        ${currentUserData?.role !== 'cashier' ? `
        <div class="hint-actions">
          <div class="hint-action" onclick="showTab('products')" style="cursor:pointer;">
            <div class="hint-icon"><i class='bx bx-plus'></i></div>
            <div class="hint-text">
              <strong>Add Products</strong>
              <small>Go to Products tab</small>
            </div>
          </div>
        </div>
        ` : `<p><small>Ask your admin to add products</small></p>`}
      </div>
    `;
    return;
  }
  
  grid.innerHTML = `
    <div class="empty-scan-state" style="grid-column:1/-1;">
      <div class="empty-icon"><i class='bx bx-search-alt'></i></div>
      <h3>Ready to Sell!</h3>
      <p>Search products, type SKU, or scan a barcode above</p>
      <div class="hint-actions">
        <div class="hint-action" onclick="document.getElementById('sku-input').focus()" style="cursor:pointer;">
          <div class="hint-icon"><i class='bx bx-search'></i></div>
          <div class="hint-text">
            <strong>Type to Search</strong>
            <small>Suggestions will appear</small>
          </div>
        </div>
        <div class="hint-action" onclick="openScanner()" style="cursor:pointer;">
          <div class="hint-icon"><i class='bx bx-barcode-reader'></i></div>
          <div class="hint-text">
            <strong>Scan Barcode</strong>
            <small>Use camera to scan product</small>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function addProduct() {
  const sku = document.getElementById('new-sku').value.trim();
  const name = document.getElementById('new-name').value.trim();
  const price = parseFloat(document.getElementById('new-price').value);
  const qty = parseInt(document.getElementById('new-qty').value) || 0;
  if (!sku || !name || isNaN(price)) { 
    showToast('Missing Info', 'Please fill SKU, Name, and Price', 'warning'); return; 
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
  await db.collection('organizations').doc(currentOrgId).collection('products').doc(id).delete();
  await loadProducts();
  renderProductsTable();
  showToast('Deleted', 'Product removed', 'success');
}

// ==========================================
// SMART SEARCH WITH SUGGESTIONS
// ==========================================
function handleSearchInput(value) {
  const query = value.trim();
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';
  
  clearTimeout(searchTimeout);
  
  if (!query) { hideSuggestions(); renderProducts(); return; }
  
  searchTimeout = setTimeout(() => { showSuggestions(query); }, 150);
}

function showSuggestions(query) {
  const lowerQuery = query.toLowerCase();
  const filtered = products.filter(p => 
    p.name.toLowerCase().includes(lowerQuery) ||
    p.sku.toLowerCase().includes(lowerQuery) ||
    (p.barcode && p.barcode.toLowerCase().includes(lowerQuery))
  ).slice(0, 8);
  
  currentSuggestions = filtered;
  highlightedIndex = -1;
  
  const dropdown = document.getElementById('suggestions-dropdown');
  
  if (filtered.length === 0) {
    dropdown.innerHTML = `
      <div class="suggestion-empty">
        <i class='bx bx-search-alt-2'></i>
        <p>No products found for "${escapeHtml(query)}"</p>
      </div>
    `;
    dropdown.classList.add('active');
    return;
  }
  
  dropdown.innerHTML = `
    <div class="suggestion-header">
      <span>${filtered.length} SUGGESTION${filtered.length !== 1 ? 'S' : ''}</span>
      <span>↑↓ to navigate • Enter to add</span>
    </div>
    ${filtered.map((p, index) => {
      const stockClass = p.qtyOnHand === 0 ? 'out-stock' : (p.qtyOnHand < 10 ? 'low-stock' : 'in-stock');
      const stockText = p.qtyOnHand === 0 ? 'Out' : p.qtyOnHand < 10 ? `${p.qtyOnHand} left` : `${p.qtyOnHand}`;
      const highlightedName = highlightMatch(p.name, query);
      return `
        <div class="suggestion-item" data-index="${index}" onclick="selectSuggestion('${p.id}')">
          <div class="suggestion-icon"><i class='bx bx-cube'></i></div>
          <div class="suggestion-details">
            <div class="suggestion-name">${highlightedName}</div>
            <div class="suggestion-meta">
              <span class="sku">📋 ${escapeHtml(p.sku)}</span>
              <span class="stock-badge ${stockClass}">${stockText}</span>
            </div>
          </div>
          <div class="suggestion-price">${money(p.price)}</div>
        </div>
      `;
    }).join('')}
  `;
  dropdown.classList.add('active');
}

function hideSuggestions() {
  const dropdown = document.getElementById('suggestions-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  currentSuggestions = [];
  highlightedIndex = -1;
}

function selectSuggestion(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  if (product.qtyOnHand === 0) {
    showToast('Out of Stock', product.name + ' is out of stock', 'warning');
    return;
  }
  addToCart(productId);
  showToast('Added!', product.name, 'success');
  document.getElementById('sku-input').value = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  hideSuggestions();
  renderProducts();
}

function handleSuggestionKeys(e) {
  const dropdown = document.getElementById('suggestions-dropdown');
  if (!dropdown.classList.contains('active') || currentSuggestions.length === 0) return;
  
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightedIndex = Math.min(highlightedIndex + 1, currentSuggestions.length - 1);
    updateHighlight();
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightedIndex = Math.max(highlightedIndex - 1, -1);
    updateHighlight();
  }
  else if (e.key === 'Escape') hideSuggestions();
}

function updateHighlight() {
  const items = document.querySelectorAll('.suggestion-item');
  items.forEach((item, index) => {
    if (index === highlightedIndex) {
      item.classList.add('highlighted');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('highlighted');
    }
  });
}

function highlightMatch(text, query) {
  const escaped = escapeHtml(text);
  const escapedQuery = escapeHtml(query);
  const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function showSuggestionsIfAvailable() {
  const value = document.getElementById('sku-input').value.trim();
  if (value) showSuggestions(value);
}

function clearSearch() {
  const input = document.getElementById('sku-input');
  input.value = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.style.display = 'none';
  hideSuggestions();
  renderProducts();
  input.focus();
}

document.addEventListener('click', function(e) {
  const wrapper = document.querySelector('.search-box-wrapper');
  if (wrapper && !wrapper.contains(e.target)) hideSuggestions();
});

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
  if (highlightedIndex >= 0 && currentSuggestions[highlightedIndex]) {
    selectSuggestion(currentSuggestions[highlightedIndex].id);
    return;
  }
  const query = e.target.value.trim();
  if (!query) return;
  let product = products.find(p => p.sku === query);
  if (!product) product = products.find(p => p.barcode === query);
  if (product) selectSuggestion(product.id);
  else showToast('Not Found', 'No product matches: ' + query, 'warning');
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
    showToast('Insufficient Payment', `Need at least ${money(total)}`, 'warning'); return; 
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
      cashierName: currentUserData.fullName,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('organizations').doc(currentOrgId).collection('orders').add(orderData);
    const batch = db.batch();
    for (const item of cart) {
      const ref = db.collection('organizations').doc(currentOrgId).collection('products').doc(item.id);
      batch.update(ref, { qtyOnHand: item.qtyOnHand - item.qty });
    }
    await batch.commit();
    showToast('Sale Complete! ✓', `Total: ${money(total)} | Change: ${money(paid - total)}`, 'success');
    showReceiptModal(orderData);
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
    const cashierName = o.cashierName || 'Unknown';
    rows.push(`
      <tr>
        <td>${date}</td>
        <td>${escapeHtml(cashierName)}</td>
        <td>${itemCount}</td>
        <td>${money(o.total)}</td>
        <td>${money(o.amountPaid)}</td>
        <td><button onclick="reprintReceipt('${doc.id}')" class="btn btn-primary" style="padding:6px 12px;font-size:12px"><i class='bx bx-receipt'></i> Receipt</button></td>
      </tr>
    `);
  });
  tbody.innerHTML = rows.join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:40px;">No orders yet</td></tr>';
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
  const salesByStaff = {};
  
  snap.forEach(doc => {
    const o = doc.data();
    todaySales += o.total || 0;
    todayOrders++;
    
    const staffId = o.cashierId || 'unknown';
    const staffName = o.cashierName || 'Unknown';
    if (!salesByStaff[staffId]) {
      salesByStaff[staffId] = { name: staffName, count: 0, total: 0 };
    }
    salesByStaff[staffId].count++;
    salesByStaff[staffId].total += o.total || 0;
  });
  
  document.getElementById('stat-today-sales').textContent = moneyValue(todaySales);
  document.getElementById('stat-today-orders').textContent = todayOrders;
  
  // Staff Performance
  const staffPerfDiv = document.getElementById('staff-performance');
  const sortedStaff = Object.values(salesByStaff).sort((a, b) => b.total - a.total);
  
  if (sortedStaff.length === 0) {
    staffPerfDiv.innerHTML = '<p style="color:var(--gray-500);text-align:center;padding:20px;">No sales today yet</p>';
  } else {
    staffPerfDiv.innerHTML = sortedStaff.map((staff, i) => {
      const rankClass = i < 3 ? `rank-${i + 1}` : '';
      const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
      return `
        <div class="staff-performance-item">
          <div class="staff-rank ${rankClass}">${rankIcon}</div>
          <div class="staff-avatar-small">${staff.name.charAt(0).toUpperCase()}</div>
          <div class="staff-performance-details">
            <div class="staff-performance-name">${escapeHtml(staff.name)}</div>
            <div class="staff-performance-meta">${staff.count} sale${staff.count !== 1 ? 's' : ''} today</div>
          </div>
          <div class="staff-performance-total">${money(staff.total)}</div>
        </div>
      `;
    }).join('');
  }
  
  // Recent Activity
  const recentSnap = await db.collection('organizations').doc(currentOrgId)
    .collection('orders').orderBy('createdAt', 'desc').limit(5).get();
  const activityDiv = document.getElementById('recent-activity');
  const items = [];
  recentSnap.forEach(doc => {
    const o = doc.data();
    const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-ZM') : '-';
    const itemCount = (o.items || []).reduce((s, i) => s + i.qty, 0);
    const cashierName = o.cashierName || 'Unknown';
    items.push(`
      <div style="padding:14px 0;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600;font-size:14px;">Sale of ${itemCount} items by ${escapeHtml(cashierName)}</div>
          <small>${date}</small>
        </div>
        <div style="font-weight:700;color:var(--success);font-size:16px;">${money(o.total)}</div>
      </div>
    `);
  });
  activityDiv.innerHTML = items.join('') || '<p style="text-align:center;padding:20px;">No activity yet</p>';
}

// ==========================================
// DARK MODE
// ==========================================
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'on' : 'off');
  const icons = document.querySelectorAll('#theme-btn i, #theme-btn-mobile i');
  icons.forEach(icon => {
    if (isDark) {
      icon.classList.remove('bx-moon');
      icon.classList.add('bx-sun');
    } else {
      icon.classList.remove('bx-sun');
      icon.classList.add('bx-moon');
    }
  });
  showToast(isDark ? 'Dark Mode' : 'Light Mode', 'Enabled', 'info');
}

function loadDarkModePreference() {
  if (localStorage.getItem('darkMode') === 'on') {
    document.body.classList.add('dark-mode');
    const icons = document.querySelectorAll('#theme-btn i, #theme-btn-mobile i');
    icons.forEach(icon => {
      icon.classList.remove('bx-moon');
      icon.classList.add('bx-sun');
    });
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
    db.collection('organizations').doc(currentOrgId).update({ themeColor: color }).catch(() => {});
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
    await db.collection('organizations').doc(currentOrgId).update({ name, phone, address, email });
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
      taxRate: taxPercent / 100, currency: currency
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
// BARCODE SCANNER
// ==========================================
async function openScanner() {
  const modal = document.getElementById('scanner-modal');
  modal.classList.add('active');
  const status = document.getElementById('scanner-status');
  const flashBtn = document.getElementById('flashlight-btn');
  if (flashBtn) flashBtn.style.display = 'none';
  status.textContent = 'Requesting camera access...';
  
  try {
    codeReader = new ZXing.BrowserMultiFormatReader();
    const videoInputDevices = await codeReader.listVideoInputDevices();
    if (videoInputDevices.length === 0) {
      status.textContent = '❌ No camera found';
      showToast('Error', 'No camera detected on this device', 'error');
      return;
    }
    let deviceId = videoInputDevices[0].deviceId;
    const backCamera = videoInputDevices.find(d => 
      d.label.toLowerCase().includes('back') || 
      d.label.toLowerCase().includes('rear') ||
      d.label.toLowerCase().includes('environment')
    );
    if (backCamera) deviceId = backCamera.deviceId;
    status.textContent = '📷 Scanning... Point at barcode';
    codeReader.decodeFromVideoDevice(deviceId, 'scanner-video', (result, err) => {
      if (result) handleScannedBarcode(result.getText());
    });
    setTimeout(checkFlashlightSupport, 500);
    setTimeout(checkFlashlightSupport, 1500);
    setTimeout(checkFlashlightSupport, 3000);
  } catch (err) {
    console.error(err);
    status.textContent = '❌ Camera error: ' + err.message;
    showToast('Camera Error', err.message, 'error');
  }
}

async function checkFlashlightSupport() {
  const video = document.getElementById('scanner-video');
  const flashBtn = document.getElementById('flashlight-btn');
  if (!video || !video.srcObject) return;
  currentStream = video.srcObject;
  const track = currentStream.getVideoTracks()[0];
  if (!track) return;
  try {
    const capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.torch) {
      flashBtn.style.display = 'flex';
      if (!flashlightOn) flashBtn.classList.remove('active');
    } else {
      try {
        await track.applyConstraints({ advanced: [{ torch: false }] });
        flashBtn.style.display = 'flex';
      } catch (e) {
        flashBtn.style.display = 'none';
      }
    }
  } catch (err) { console.log('Flashlight check error:', err); }
}

async function toggleFlashlight() {
  if (!currentStream) return;
  const track = currentStream.getVideoTracks()[0];
  if (!track) return;
  const flashBtn = document.getElementById('flashlight-btn');
  try {
    flashlightOn = !flashlightOn;
    await track.applyConstraints({ advanced: [{ torch: flashlightOn }] });
    if (flashlightOn) {
      flashBtn.classList.add('active');
      showToast('Flashlight', 'Turned on', 'info');
    } else {
      flashBtn.classList.remove('active');
      showToast('Flashlight', 'Turned off', 'info');
    }
  } catch (err) {
    showToast('Error', 'Could not toggle flashlight', 'error');
    flashlightOn = !flashlightOn;
  }
}

function handleScannedBarcode(code) {
  if (navigator.vibrate) navigator.vibrate(100);
  const product = products.find(p => p.sku === code || p.barcode === code);
  if (product) {
    if (product.qtyOnHand === 0) {
      document.getElementById('scanner-status').textContent = `⚠️ Out of stock: ${product.name}`;
      showToast('Out of Stock', product.name, 'warning');
      return;
    }
    addToCart(product.id);
    document.getElementById('scanner-status').textContent = `✓ Added: ${product.name}`;
    showToast('Scanned!', `Added: ${product.name}`, 'success');
    setTimeout(closeScanner, 800);
  } else {
    document.getElementById('scanner-status').textContent = `❌ Not found: ${code}`;
    showToast('Not Found', `Barcode: ${code}`, 'warning');
    if (currentUserData?.role !== 'cashier') {
      setTimeout(() => {
        if (confirm(`Product with barcode "${code}" not found.\n\nAdd as new product?`)) {
          closeScanner();
          showTab('products');
          document.getElementById('new-sku').value = code;
          document.getElementById('new-name').focus();
        }
      }, 1000);
    }
  }
}

function closeScanner() {
  const modal = document.getElementById('scanner-modal');
  modal.classList.remove('active');
  if (flashlightOn && currentStream) {
    const track = currentStream.getVideoTracks()[0];
    if (track) {
      try { track.applyConstraints({ advanced: [{ torch: false }] }); } catch (err) {}
    }
  }
  flashlightOn = false;
  currentStream = null;
  const flashBtn = document.getElementById('flashlight-btn');
  if (flashBtn) { flashBtn.classList.remove('active'); flashBtn.style.display = 'none'; }
  if (codeReader) { codeReader.reset(); codeReader = null; }
}

// ==========================================
// RECEIPT GENERATION
// ==========================================
function generateReceiptHTML(orderData) {
  const date = new Date();
  const dateStr = date.toLocaleString('en-ZM', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
  const orderNum = 'R' + Date.now().toString().slice(-8);
  
  let html = `
    <div class="receipt-header-print">
      <h4>${escapeHtml(currentOrg?.name || 'BUSINESS')}</h4>
      ${currentOrg?.address ? `<p>${escapeHtml(currentOrg.address)}</p>` : ''}
      ${currentOrg?.phone ? `<p>Tel: ${escapeHtml(currentOrg.phone)}</p>` : ''}
      ${currentOrg?.email ? `<p>${escapeHtml(currentOrg.email)}</p>` : ''}
    </div>
    <div style="text-align:center;padding:8px 0;font-size:11px;">
      <p><strong>RECEIPT</strong></p>
      <p>Receipt #: ${orderNum}</p>
      <p>${dateStr}</p>
      <p>Cashier: ${escapeHtml(orderData.cashierName || currentUserData?.fullName || 'Unknown')}</p>
    </div>
    <div style="border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;margin:8px 0;">
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:11px;">
        <span>ITEM</span><span>TOTAL</span>
      </div>
    </div>
  `;
  
  orderData.items.forEach(item => {
    html += `
      <div class="receipt-item">
        <div class="receipt-item-name">${escapeHtml(item.name)}</div>
        <div class="receipt-item-details">
          <span>${item.qty} x ${money(item.price)}</span>
          <span><strong>${money(item.lineTotal)}</strong></span>
        </div>
      </div>
    `;
  });
  
  html += `
    <div class="receipt-totals">
      <div class="receipt-total-row"><span>Subtotal:</span><span>${money(orderData.subtotal)}</span></div>
      <div class="receipt-total-row"><span>VAT (${(TAX_RATE * 100).toFixed(0)}%):</span><span>${money(orderData.tax)}</span></div>
      <div class="receipt-total-row grand"><span>TOTAL:</span><span>${money(orderData.total)}</span></div>
      <div class="receipt-total-row"><span>Paid:</span><span>${money(orderData.amountPaid)}</span></div>
      <div class="receipt-total-row"><span>Change:</span><span>${money(orderData.changeGiven)}</span></div>
    </div>
    <div class="receipt-footer-print">
      <p><strong>Thank you for your business!</strong></p>
      <p>Please come again 🙏</p>
    </div>
  `;
  return { html, orderNum, dateStr };
}

function showReceiptModal(orderData) {
  currentReceipt = orderData;
  const { html } = generateReceiptHTML(orderData);
  document.getElementById('receipt-preview').innerHTML = html;
  document.getElementById('receipt-modal').classList.add('active');
}

function closeReceiptModal() {
  document.getElementById('receipt-modal').classList.remove('active');
  currentReceipt = null;
}

function printReceipt() {
  const receiptHTML = document.getElementById('receipt-preview').innerHTML;
  const printWindow = window.open('', '', 'width=400,height=600');
  printWindow.document.write(`
    <!DOCTYPE html><html><head><title>Receipt</title>
    <style>
      body { font-family: 'Courier New', monospace; font-size: 12px; padding: 20px; max-width: 300px; margin: 0 auto; }
      .receipt-header-print { text-align: center; padding-bottom: 12px; border-bottom: 2px dashed #000; margin-bottom: 12px; }
      .receipt-header-print h4 { font-size: 16px; margin-bottom: 4px; }
      .receipt-header-print p { font-size: 11px; margin: 2px 0; }
      .receipt-item { padding: 6px 0; border-bottom: 1px dotted #999; }
      .receipt-item-name { font-weight: bold; }
      .receipt-item-details { display: flex; justify-content: space-between; font-size: 11px; }
      .receipt-totals { padding-top: 12px; margin-top: 12px; border-top: 2px dashed #000; }
      .receipt-total-row { display: flex; justify-content: space-between; padding: 3px 0; }
      .receipt-total-row.grand { font-size: 14px; font-weight: bold; padding: 8px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; margin: 6px 0; }
      .receipt-footer-print { text-align: center; margin-top: 16px; padding-top: 12px; border-top: 2px dashed #000; font-size: 11px; }
    </style></head><body>${receiptHTML}</body></html>
  `);
  printWindow.document.close();
  setTimeout(() => { printWindow.print(); printWindow.close(); }, 250);
}

function downloadReceiptPDF() {
  if (!currentReceipt) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: [80, 297] });
  let y = 10;
  const centerX = 40;
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text(currentOrg?.name || 'BUSINESS', centerX, y, { align: 'center' });
  y += 6;
  doc.setFontSize(8);
  doc.setFont(undefined, 'normal');
  if (currentOrg?.address) { doc.text(currentOrg.address, centerX, y, { align: 'center' }); y += 4; }
  if (currentOrg?.phone) { doc.text('Tel: ' + currentOrg.phone, centerX, y, { align: 'center' }); y += 4; }
  if (currentOrg?.email) { doc.text(currentOrg.email, centerX, y, { align: 'center' }); y += 4; }
  y += 2;
  doc.line(5, y, 75, y); y += 5;
  const orderNum = 'R' + Date.now().toString().slice(-8);
  doc.setFont(undefined, 'bold');
  doc.text('RECEIPT', centerX, y, { align: 'center' }); y += 5;
  doc.setFont(undefined, 'normal');
  doc.text('Receipt #: ' + orderNum, 5, y); y += 4;
  doc.text('Date: ' + new Date().toLocaleString('en-ZM'), 5, y); y += 4;
  doc.text('Cashier: ' + (currentReceipt.cashierName || currentUserData?.fullName || 'Unknown'), 5, y); y += 5;
  doc.line(5, y, 75, y); y += 5;
  doc.setFont(undefined, 'bold');
  doc.text('ITEM', 5, y); doc.text('TOTAL', 75, y, { align: 'right' }); y += 4;
  doc.setFont(undefined, 'normal');
  currentReceipt.items.forEach(item => {
    doc.setFont(undefined, 'bold');
    const itemName = item.name.length > 30 ? item.name.substring(0, 30) + '...' : item.name;
    doc.text(itemName, 5, y); y += 4;
    doc.setFont(undefined, 'normal');
    doc.text(`${item.qty} x ${money(item.price)}`, 5, y);
    doc.text(money(item.lineTotal), 75, y, { align: 'right' }); y += 5;
  });
  y += 2;
  doc.line(5, y, 75, y); y += 5;
  doc.text('Subtotal:', 5, y); doc.text(money(currentReceipt.subtotal), 75, y, { align: 'right' }); y += 4;
  doc.text(`VAT (${(TAX_RATE * 100).toFixed(0)}%):`, 5, y); doc.text(money(currentReceipt.tax), 75, y, { align: 'right' }); y += 5;
  doc.setFont(undefined, 'bold'); doc.setFontSize(11);
  doc.text('TOTAL:', 5, y); doc.text(money(currentReceipt.total), 75, y, { align: 'right' }); y += 6;
  doc.setFont(undefined, 'normal'); doc.setFontSize(8);
  doc.text('Paid:', 5, y); doc.text(money(currentReceipt.amountPaid), 75, y, { align: 'right' }); y += 4;
  doc.text('Change:', 5, y); doc.text(money(currentReceipt.changeGiven), 75, y, { align: 'right' }); y += 6;
  doc.line(5, y, 75, y); y += 5;
  doc.setFont(undefined, 'bold');
  doc.text('Thank you for your business!', centerX, y, { align: 'center' }); y += 4;
  doc.setFont(undefined, 'normal');
  doc.text('Please come again', centerX, y, { align: 'center' });
  doc.save(`Receipt_${orderNum}.pdf`);
  showToast('Downloaded!', 'Receipt saved as PDF', 'success');
}

async function shareReceipt() {
  if (!currentReceipt) return;
  const orderNum = 'R' + Date.now().toString().slice(-8);
  const businessName = currentOrg?.name || 'Business';
  let text = `🧾 *${businessName}* - Receipt #${orderNum}\n\n`;
  currentReceipt.items.forEach(item => {
    text += `${item.name}\n  ${item.qty} x ${money(item.price)} = ${money(item.lineTotal)}\n`;
  });
  text += `\nSubtotal: ${money(currentReceipt.subtotal)}`;
  text += `\nVAT: ${money(currentReceipt.tax)}`;
  text += `\n*TOTAL: ${money(currentReceipt.total)}*`;
  text += `\nPaid: ${money(currentReceipt.amountPaid)}`;
  text += `\nChange: ${money(currentReceipt.changeGiven)}`;
  text += `\n\n_Thank you for your business!_`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `Receipt from ${businessName}`, text: text });
    } catch (err) {
      if (err.name !== 'AbortError') showToast('Error', 'Could not share', 'error');
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied!', 'Receipt copied. Paste in WhatsApp!', 'success');
    } catch (err) {
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
    }
  }
}

function reprintReceipt(orderId) {
  db.collection('organizations').doc(currentOrgId)
    .collection('orders').doc(orderId).get()
    .then(doc => { if (doc.exists) showReceiptModal(doc.data()); });
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
    currentUserData = null;
    showLogin();
  }
});
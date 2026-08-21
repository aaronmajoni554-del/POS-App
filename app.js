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

auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
  .then(() => console.log('✓ Auth persistence enabled'))
  .catch(err => console.log('Auth persistence error:', err));

db.enablePersistence({ synchronizeTabs: true })
  .then(() => console.log('✓ Offline persistence enabled'))
  .catch(err => {
    if (err.code === 'failed-precondition') console.log('⚠️ Multiple tabs open');
    else if (err.code === 'unimplemented') console.log('⚠️ Browser does not support offline');
  });

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
let isRegistering = false; // NEW: Prevents auth observer race conditions
let codeReader = null;
let currentReceipt = null;
let currentStream = null;
let flashlightOn = false;
let searchTimeout = null;
let currentSuggestions = [];
let highlightedIndex = -1;
let currentInviteCode = null;
let lastScannedCode = null;
let lastScanTime = 0;
let scannerProcessing = false;
let salesChart = null;
let isOnline = navigator.onLine;

let TAX_RATE = 0.16;
let CURRENCY = 'K';

function money(amount) {
  return `${CURRENCY} ${Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyValue(amount) {
  return Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ==========================================
// OFFLINE MODE DETECTION
// ==========================================
function updateOnlineStatus() {
  isOnline = navigator.onLine;
  const indicator = document.getElementById('offline-indicator');
  if (!isOnline) {
    if (indicator) indicator.style.display = 'flex';
    document.body.classList.add('offline');
    showToast('Offline Mode', 'Working offline - changes sync when online', 'warning');
  } else {
    if (indicator) indicator.style.display = 'none';
    document.body.classList.remove('offline');
    if (currentUser) showToast('Back Online!', 'Syncing...', 'success');
  }
}

window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
setTimeout(updateOnlineStatus, 500);

// ==========================================
// UNIVERSAL BUTTON LOCK
// ==========================================
function lockButton(btn, duration = 3000) {
  if (!btn) return false;
  if (btn.getAttribute('data-locked') === 'true') return false;
  btn.setAttribute('data-locked', 'true');
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.pointerEvents = 'none';
  btn.style.cursor = 'not-allowed';
  const originalHTML = btn.innerHTML;
  btn.setAttribute('data-original', originalHTML);
  setTimeout(() => {
    btn.removeAttribute('data-locked');
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    btn.style.cursor = 'pointer';
    if (btn.getAttribute('data-original')) {
      btn.innerHTML = btn.getAttribute('data-original');
      btn.removeAttribute('data-original');
    }
  }, duration);
  return true;
}

function isButtonLocked(btn) {
  return btn && btn.getAttribute('data-locked') === 'true';
}

// ==========================================
// SCREEN NAVIGATION
// ==========================================
function toggleScreen(id) {
  const target = document.getElementById(id);
  if (!target) { console.error('Screen not found:', id); return; }
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  target.classList.add('active');
}

function showLogin() { toggleScreen('login-screen'); }
function showSignup() { toggleScreen('signup-screen'); }
function showJoinTeam() { 
  toggleScreen('join-screen');
  setTimeout(() => { const input = document.getElementById('invite-code'); if (input) input.focus(); }, 100);
}
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
  updateLowStockBadge();
}

function applyRolePermissions() {
  document.body.classList.remove('is-admin', 'is-manager', 'is-cashier');
  if (currentUserData?.role === 'admin') document.body.classList.add('is-admin');
  else if (currentUserData?.role === 'manager') document.body.classList.add('is-manager');
  else document.body.classList.add('is-cashier');
}

function showTab(tab) {
  if ((tab === 'staff' || tab === 'settings') && currentUserData?.role !== 'admin') {
    showToast('Access Denied', 'Only admins can access this', 'warning'); return;
  }
  if ((tab === 'products' || tab === 'dashboard' || tab === 'reports') && currentUserData?.role === 'cashier') {
    showToast('Access Denied', 'Contact your admin for access', 'warning'); return;
  }
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.getElementById(tab + '-tab').classList.add('active');
  document.getElementById('tab-' + tab).classList.add('active');
  const titles = { pos:'Point of Sale', products:'Products', orders:'Orders', reports:'Reports', dashboard:'Dashboard', staff:'Staff', settings:'Settings' };
  updateMobileTitle(titles[tab]);
  if (tab === 'products') { renderProductsTable(); renderLowStockAlert(); }
  if (tab === 'orders') loadOrders();
  if (tab === 'reports') loadReports('today');
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'staff') loadStaffData();
  if (tab === 'settings') loadSettings();
  autoCloseSidebar();
}

// ==========================================
// LOW STOCK
// ==========================================
function getLowStockItems() { return products.filter(p => { const t = p.lowStockThreshold || 10; return p.qtyOnHand > 0 && p.qtyOnHand <= t; }); }
function getOutOfStockItems() { return products.filter(p => p.qtyOnHand === 0); }

function updateLowStockBadge() {
  const badge = document.getElementById('low-stock-badge');
  if (!badge) return;
  const total = getLowStockItems().length + getOutOfStockItems().length;
  if (total > 0) { badge.textContent = total; badge.style.display = 'inline-block'; }
  else badge.style.display = 'none';
}

function renderLowStockAlert() {
  const alertBox = document.getElementById('low-stock-alert');
  const list = document.getElementById('low-stock-list');
  const countEl = document.getElementById('low-stock-count');
  if (!alertBox || !list) return;
  const allItems = [...getOutOfStockItems(), ...getLowStockItems()];
  if (allItems.length === 0) { alertBox.style.display = 'none'; return; }
  alertBox.style.display = 'block';
  if (countEl) countEl.textContent = allItems.length;
  list.innerHTML = allItems.map(p => {
    const isCritical = p.qtyOnHand === 0;
    const threshold = p.lowStockThreshold || 10;
    return `<div class="low-stock-item ${isCritical ? 'critical' : ''}">
      <div class="stock-num">${p.qtyOnHand}</div>
      <div class="stock-info"><div class="stock-name">${escapeHtml(p.name)}</div><div class="stock-threshold">Alert at: ${threshold}</div></div>
    </div>`;
  }).join('');
}

// ==========================================
// SIDEBAR
// ==========================================
function toggleSidebar() { const s = document.getElementById('sidebar'); if (s.classList.contains('open')) closeSidebar(); else openSidebar(); }
function openSidebar() { document.getElementById('sidebar').classList.add('open'); document.getElementById('sidebar-overlay').classList.add('active'); document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.getElementById('sidebar').classList.remove('open'); document.getElementById('sidebar-overlay').classList.remove('active'); document.body.classList.remove('sidebar-open'); }
function autoCloseSidebar() { if (window.innerWidth <= 968) setTimeout(closeSidebar, 200); }

document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeSidebar(); closeScanner(); closeReceiptModal(); closeInviteModal(); hideSuggestions(); } });
let touchStartX = 0;
document.addEventListener('touchstart', function(e) { touchStartX = e.touches[0].clientX; });
document.addEventListener('touchend', function(e) { const touchEndX = e.changedTouches[0].clientX; const sidebar = document.getElementById('sidebar'); if (sidebar && sidebar.classList.contains('open') && touchStartX - touchEndX > 50) closeSidebar(); });

// ==========================================
// PASSWORD
// ==========================================
function togglePassword(inputId, iconEl) { const input = document.getElementById(inputId); if (input.type === 'password') { input.type = 'text'; iconEl.classList.remove('bx-hide'); iconEl.classList.add('bx-show'); } else { input.type = 'password'; iconEl.classList.remove('bx-show'); iconEl.classList.add('bx-hide'); } }
function checkPasswordStrength() { const password = document.getElementById('signup-password').value; const bar = document.getElementById('password-strength'); if (!bar) return; bar.className = 'password-strength'; if (!password.length) return; let s = 0; if (password.length >= 6) s++; if (password.length >= 10) s++; if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++; if (/[0-9]/.test(password)) s++; if (/[^A-Za-z0-9]/.test(password)) s++; if (s <= 2) bar.classList.add('weak'); else if (s <= 3) bar.classList.add('medium'); else bar.classList.add('strong'); }

async function sendPasswordReset() {
  const email = document.getElementById('forgot-email').value.trim();
  const msg = document.getElementById('forgot-msg');
  msg.className = 'msg';
  if (!isOnline) { msg.textContent = '⚠️ Password reset requires internet'; return; }
  if (!email) { msg.textContent = 'Please enter your email'; return; }
  msg.textContent = 'Sending reset link...';
  try {
    await auth.sendPasswordResetEmail(email);
    msg.className = 'msg success';
    msg.innerHTML = '✓ Reset link sent!';
    showToast('Email Sent', 'Check your inbox', 'success');
    setTimeout(() => { showLogin(); msg.textContent = ''; }, 4000);
  } catch (err) { msg.textContent = err.message; }
}

// ==========================================
// AUTH - FIXED SIGNUP
// ==========================================
async function signup(event) {
  const btn = event ? event.target.closest('button') : document.querySelector('#signup-screen button.btn-primary');
  if (isButtonLocked(btn)) return;
  if (!isOnline) { document.getElementById('signup-msg').textContent = '⚠️ Sign up requires internet'; return; }
  
  lockButton(btn, 5000);
  btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Creating...';
  
  const orgName = document.getElementById('org-name').value.trim();
  const fullName = document.getElementById('full-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;
  const msg = document.getElementById('signup-msg');
  msg.className = 'msg';
  
  if (!orgName || !fullName || !email || !password) { 
    msg.textContent = 'Please fill all fields'; 
    return; 
  }
  if (password.length < 6) { 
    msg.textContent = 'Password must be at least 6 characters'; 
    return; 
  }
  
  msg.textContent = 'Creating account...';
  isRegistering = true; // Block auth state observer temporarily
  
  let userCred = null;
  try {
    // 1. Create the Auth account
    userCred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = userCred.user.uid;
    
    try {
      // 2. Create the organization document
      const orgRef = await db.collection('organizations').add({ 
        name: orgName, 
        email, 
        ownerId: uid, 
        taxRate: TAX_RATE, 
        currency: CURRENCY, 
        country: 'Zambia', 
        themeColor: '#6366f1', 
        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
      });
      
      // 3. Create the user profile document
      await db.collection('users').doc(uid).set({ 
        fullName, 
        email, 
        organizationId: orgRef.id, 
        role: 'admin', 
        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
      });
      
      msg.className = 'msg success';
      msg.textContent = '✓ Account created! Loading...';
      
      // 4. Safely initialize and direct them to the app
      currentUser = userCred.user;
      isRegistering = false;
      await showPOS();
      
    } catch (dbErr) {
      // CRITICAL: Clean up! If Firestore fails, delete the Auth account 
      // to prevent "bricked" users that can never log in.
      console.error('Database write failed, cleaning up auth account:', dbErr);
      if (userCred && userCred.user) {
        try { 
          await userCred.user.delete(); 
        } catch (delErr) { 
          console.error('Failed to delete auth account:', delErr); 
        }
      }
      isRegistering = false;
      throw new Error("Database initialization failed. Please try again.");
    }
  } catch (err) { 
    isRegistering = false;
    msg.textContent = err.code === 'auth/network-request-failed' ? 'No internet connection.' : err.message; 
  }
}

// ==========================================
// AUTH - FIXED JOIN WITH CODE
// ==========================================
async function joinWithCode(event) {
  const btn = event ? event.target.closest('button') : document.querySelector('#join-screen button.btn-primary');
  if (isButtonLocked(btn)) return;
  if (!isOnline) { document.getElementById('join-msg').textContent = '⚠️ Join requires internet'; return; }
  
  lockButton(btn, 5000);
  btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Joining...';
  
  const code = document.getElementById('invite-code').value.trim().toUpperCase();
  const password = document.getElementById('join-password').value;
  const msg = document.getElementById('join-msg');
  msg.className = 'msg';
  
  if (!code || !password) { msg.textContent = 'Please enter code and password'; return; }
  if (password.length < 6) { msg.textContent = 'Password must be at least 6 characters'; return; }
  
  msg.textContent = 'Verifying...';
  isRegistering = true; // Block auth state observer
  
  let userCred = null;
  try {
    const inviteSnap = await db.collection('invitations').where('code', '==', code).where('status', '==', 'pending').limit(1).get();
    if (inviteSnap.empty) { 
      isRegistering = false; 
      msg.textContent = 'Invalid or expired invite code'; 
      return; 
    }
    
    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data();
    
    msg.textContent = 'Creating account...';
    userCred = await auth.createUserWithEmailAndPassword(invite.email, password);
    const uid = userCred.user.uid;
    
    try {
      await db.collection('users').doc(uid).set({ 
        fullName: invite.fullName, 
        email: invite.email, 
        organizationId: invite.organizationId, 
        role: invite.role, 
        createdAt: firebase.firestore.FieldValue.serverTimestamp() 
      });
      
      await db.collection('invitations').doc(inviteDoc.id).update({ 
        status: 'accepted', 
        acceptedAt: firebase.firestore.FieldValue.serverTimestamp(), 
        acceptedBy: uid 
      });
      
      msg.className = 'msg success';
      msg.textContent = `✓ Welcome to ${invite.orgName}!`;
      
      currentUser = userCred.user;
      isRegistering = false;
      await showPOS();
      
    } catch (dbErr) {
      console.error('Database write failed, cleaning up auth account:', dbErr);
      if (userCred && userCred.user) {
        try { 
          await userCred.user.delete(); 
        } catch (delErr) { 
          console.error('Failed to delete auth account:', delErr); 
        }
      }
      isRegistering = false;
      throw new Error("Could not join workspace. Please try again.");
    }
  } catch (err) { 
    isRegistering = false;
    msg.textContent = err.code === 'auth/email-already-in-use' ? 'Email already registered. Please sign in.' : err.message; 
  }
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const msg = document.getElementById('login-msg');
  msg.className = 'msg';
  if (!isOnline) { msg.textContent = '⚠️ Login requires internet. Please connect and try again.'; return; }
  msg.textContent = 'Logging in...';
  try { await auth.signInWithEmailAndPassword(email, password); msg.textContent = ''; }
  catch (err) { msg.textContent = err.code === 'auth/network-request-failed' ? 'No internet connection.' : err.message; }
}

async function logout() { await auth.signOut(); cart = []; products = []; currentUser = null; currentUserData = null; currentOrgId = null; currentOrg = null; showLogin(); }

async function loadUserData() {
  if (!currentUser) return;
  try {
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    if (!userDoc.exists) { 
      showToast('Error', 'User profile not found', 'error'); 
      logout(); 
      return; 
    }
    currentUserData = userDoc.data();
    currentOrgId = currentUserData.organizationId;
    const orgDoc = await db.collection('organizations').doc(currentOrgId).get();
    currentOrg = orgDoc.data();
    document.getElementById('business-name').textContent = currentOrg?.name || 'POS';
    document.getElementById('user-name').textContent = currentUserData.fullName;
    document.getElementById('user-role').textContent = currentUserData.role;
    document.getElementById('user-avatar').textContent = currentUserData.fullName.charAt(0).toUpperCase();
  } catch (err) { console.error('Load user error:', err); }
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

async function createInvitation(event) {
  const btn = event ? event.target.closest('button') : document.getElementById('generate-invite-btn');
  if (isButtonLocked(btn)) return;
  if (!isOnline) { showToast('Offline', 'Cannot create invites offline', 'warning'); return; }
  lockButton(btn, 4000);
  btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Creating...';
  try {
    if (currentUserData?.role !== 'admin') { showToast('Access Denied', 'Only admins', 'error'); return; }
    const fullName = document.getElementById('staff-name').value.trim();
    const email = document.getElementById('staff-email').value.trim().toLowerCase();
    const role = document.getElementById('staff-role').value;
    if (!fullName || !email) { showToast('Missing Info', 'Fill name and email', 'warning'); return; }
    if (!email.includes('@')) { showToast('Invalid Email', 'Enter valid email', 'warning'); return; }
    const existing = await db.collection('invitations').where('organizationId', '==', currentOrgId).where('email', '==', email).where('status', '==', 'pending').get();
    if (!existing.empty) { showToast('Already Invited', `${email} already has a pending invitation`, 'warning'); return; }
    const code = generateInviteCode();
    await db.collection('invitations').add({ code, email, fullName, role, organizationId: currentOrgId, orgName: currentOrg.name, invitedBy: currentUser.uid, status: 'pending', createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    currentInviteCode = code;
    document.getElementById('invite-name').textContent = fullName;
    document.getElementById('invite-code-display').textContent = code;
    document.getElementById('invite-code-modal').classList.add('active');
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-email').value = '';
    document.getElementById('staff-role').value = 'cashier';
    await loadStaffData();
    showToast('Success!', `Invite created for ${fullName}`, 'success');
  } catch (err) { showToast('Error', err.message, 'error'); }
}

function closeInviteModal() { document.getElementById('invite-code-modal').classList.remove('active'); currentInviteCode = null; }

function copyInviteCode() {
  if (!currentInviteCode) return;
  const btn = event.target.closest('button');
  const orig = btn.innerHTML;
  navigator.clipboard.writeText(currentInviteCode).then(() => {
    btn.innerHTML = '<i class="bx bx-check"></i> Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copied'); }, 2000);
    showToast('Copied!', 'Code copied', 'success');
  }).catch(() => {
    const input = document.createElement('input');
    input.value = currentInviteCode;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied!', 'Code copied', 'success');
  });
}

async function shareInviteLink() {
  if (!currentInviteCode) return;
  const orgName = currentOrg?.name || 'our business';
  const text = `You've been invited to join *${orgName}* on ModernPOS!\n\nYour invitation code is: *${currentInviteCode}*\n\nGo to: ${window.location.origin}${window.location.pathname}\n\nClick "Join with invite code" and enter the code above.`;
  if (navigator.share) {
    try { await navigator.share({ title: `Invitation to ${orgName}`, text }); }
    catch (err) { if (err.name !== 'AbortError') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); }
  } else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

async function loadStaffData() { await loadInvitations(); await loadStaffMembers(); }

async function loadInvitations() {
  const tbody = document.getElementById('invitations-tbody');
  if (!tbody) return;
  try {
    const snap = await db.collection('invitations').where('organizationId', '==', currentOrgId).where('status', '==', 'pending').get();
    const rows = [];
    snap.forEach(doc => {
      const inv = doc.data();
      rows.push(`<tr><td>${escapeHtml(inv.fullName)}</td><td>${escapeHtml(inv.email)}</td><td><span class="role-badge ${inv.role}">${inv.role}</span></td><td><code style="background:var(--gray-100);padding:2px 8px;border-radius:4px;font-weight:700;">${inv.code}</code></td><td><button onclick="reshowInvite('${inv.code}', '${escapeHtml(inv.fullName).replace(/'/g, "\\'")}')" class="btn btn-primary" style="padding:6px 10px;font-size:12px;margin-right:4px;"><i class='bx bx-show'></i></button><button onclick="deleteInvitation('${doc.id}')" class="btn btn-danger" style="padding:6px 10px;font-size:12px;"><i class='bx bx-trash'></i></button></td></tr>`);
    });
    tbody.innerHTML = rows.join('') || '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No pending invitations</td></tr>';
  } catch (err) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:40px;">Error loading</td></tr>'; }
}

function reshowInvite(code, name) { currentInviteCode = code; document.getElementById('invite-name').textContent = name; document.getElementById('invite-code-display').textContent = code; document.getElementById('invite-code-modal').classList.add('active'); }

async function deleteInvitation(id) {
  if (!confirm('Delete this invitation?')) return;
  try { await db.collection('invitations').doc(id).delete(); await loadInvitations(); showToast('Deleted', 'Invitation removed', 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

async function loadStaffMembers() {
  const tbody = document.getElementById('staff-tbody');
  if (!tbody) return;
  try {
    const snap = await db.collection('users').where('organizationId', '==', currentOrgId).get();
    const users = [];
    snap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));
    users.sort((a, b) => { const o = { admin: 1, manager: 2, cashier: 3 }; return (o[a.role] || 4) - (o[b.role] || 4); });
    let salesByUser = {};
    try {
      const ordersSnap = await db.collection('organizations').doc(currentOrgId).collection('orders').get();
      ordersSnap.forEach(doc => { const order = doc.data(); if (order.cashierId) { if (!salesByUser[order.cashierId]) salesByUser[order.cashierId] = { count: 0, total: 0 }; salesByUser[order.cashierId].count++; salesByUser[order.cashierId].total += order.total || 0; } });
    } catch (err) {}
    if (users.length === 0) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--gray-400);padding:40px;">No team members yet</td></tr>'; return; }
    tbody.innerHTML = users.map(user => {
      const sales = salesByUser[user.id] || { count: 0, total: 0 };
      const isSelf = user.id === currentUser.uid;
      return `<tr><td><strong>${escapeHtml(user.fullName)}</strong>${isSelf ? ' <small style="color:var(--primary);">(You)</small>' : ''}</td><td>${escapeHtml(user.email)}</td><td><span class="role-badge ${user.role}">${user.role}</span></td><td><div style="font-weight:600;">${sales.count} sales</div><small style="color:var(--gray-500);">${money(sales.total)}</small></td><td>${!isSelf ? `<button onclick="changeUserRole('${user.id}', '${user.role}', '${escapeHtml(user.fullName).replace(/'/g, "\\'")}')" class="btn btn-primary" style="padding:6px 10px;font-size:12px;margin-right:4px;"><i class='bx bx-edit'></i></button><button onclick="removeStaff('${user.id}', '${escapeHtml(user.fullName).replace(/'/g, "\\'")}')" class="btn btn-danger" style="padding:6px 10px;font-size:12px;"><i class='bx bx-trash'></i></button>` : '<span style="color:var(--gray-400);font-size:12px;">Cannot modify self</span>'}</td></tr>`;
    }).join('');
  } catch (err) { tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:40px;">${err.message}</td></tr>`; }
}

async function changeUserRole(userId, currentRole, userName) {
  const newRole = prompt(`Change ${userName}'s role\n\nCurrent: ${currentRole}\n\nEnter new role (admin/manager/cashier):`, currentRole);
  if (!newRole || newRole === currentRole) return;
  if (!['admin', 'manager', 'cashier'].includes(newRole.toLowerCase())) { showToast('Invalid', 'Must be admin, manager, or cashier', 'error'); return; }
  try { await db.collection('users').doc(userId).update({ role: newRole.toLowerCase() }); await loadStaffMembers(); showToast('Updated!', `${userName} is now ${newRole}`, 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

async function removeStaff(userId, userName) {
  if (!confirm(`Remove ${userName}?\n\nAlso delete from Firebase Auth if needed.`)) return;
  try { await db.collection('users').doc(userId).delete(); await loadStaffMembers(); showToast('Removed', `${userName} removed`, 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

// ==========================================
// PRODUCTS
// ==========================================
async function loadProducts() {
  if (!currentOrgId) return;
  try {
    const snap = await db.collection('organizations').doc(currentOrgId).collection('products').orderBy('name').get();
    products = [];
    snap.forEach(doc => products.push({ id: doc.id, ...doc.data() }));
    renderProducts();
    updateLowStockBadge();
  } catch (err) { console.error('Load products error:', err); }
}

function renderProducts() {
  const grid = document.getElementById('products-grid');
  const searchInfo = document.getElementById('search-info');
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = `${cart.reduce((s,i)=>s+i.qty,0)} items`;
  if (searchInfo) searchInfo.style.display = 'none';
  if (products.length === 0) { grid.innerHTML = `<div class="empty-scan-state" style="grid-column:1/-1;"><div class="empty-icon"><i class='bx bx-package'></i></div><h3>No Products Yet</h3><p>Add products first!</p></div>`; return; }
  grid.innerHTML = `<div class="empty-scan-state" style="grid-column:1/-1;"><div class="empty-icon"><i class='bx bx-search-alt'></i></div><h3>Ready to Sell!</h3><p>Search products, type SKU, or scan barcode</p><div class="hint-actions"><div class="hint-action" onclick="document.getElementById('sku-input').focus()" style="cursor:pointer;"><div class="hint-icon"><i class='bx bx-search'></i></div><div class="hint-text"><strong>Type to Search</strong><small>Suggestions will appear</small></div></div><div class="hint-action" onclick="openScanner()" style="cursor:pointer;"><div class="hint-icon"><i class='bx bx-barcode-reader'></i></div><div class="hint-text"><strong>Scan Barcode</strong><small>Use camera</small></div></div></div></div>`;
}

async function addProduct(event) {
  const btn = event ? event.target.closest('button') : document.querySelector('button[onclick*="addProduct"]');
  if (isButtonLocked(btn)) return;
  lockButton(btn, 3000);
  btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Adding...';
  try {
    const sku = document.getElementById('new-sku').value.trim();
    const name = document.getElementById('new-name').value.trim();
    const price = parseFloat(document.getElementById('new-price').value);
    const qty = parseInt(document.getElementById('new-qty').value) || 0;
    const threshold = parseInt(document.getElementById('new-threshold').value) || 10;
    if (!sku || !name || isNaN(price)) { showToast('Missing Info', 'Fill SKU, Name, Price', 'warning'); return; }
    const existing = await db.collection('organizations').doc(currentOrgId).collection('products').where('sku', '==', sku).limit(1).get();
    if (!existing.empty) { showToast('Duplicate SKU', `SKU "${sku}" exists`, 'warning'); return; }
    await db.collection('organizations').doc(currentOrgId).collection('products').add({ sku, name, price, qtyOnHand: qty, lowStockThreshold: threshold, active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    document.getElementById('new-sku').value = '';
    document.getElementById('new-name').value = '';
    document.getElementById('new-price').value = '';
    document.getElementById('new-qty').value = '';
    document.getElementById('new-threshold').value = '10';
    await loadProducts();
    renderProductsTable();
    renderLowStockAlert();
    showToast('Success', `${name} added`, 'success');
  } catch (err) { showToast('Error', err.message, 'error'); }
}

function renderProductsTable() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = products.map(p => {
    const t = p.lowStockThreshold || 10;
    const isLow = p.qtyOnHand > 0 && p.qtyOnHand <= t;
    const isOut = p.qtyOnHand === 0;
    let stockDisplay = p.qtyOnHand;
    if (isOut) stockDisplay = `<span style="color:var(--danger);font-weight:700;">OUT</span>`;
    else if (isLow) stockDisplay = `<span style="color:var(--warning);font-weight:700;">LOW (${p.qtyOnHand})</span>`;
    return `<tr><td>${escapeHtml(p.sku)}</td><td>${escapeHtml(p.name)}</td><td>${money(p.price)}</td><td>${stockDisplay}</td><td><input type="number" value="${t}" min="1" style="width:60px;padding:4px 8px;border:1px solid var(--gray-200);border-radius:6px;font-size:13px;" onchange="updateThreshold('${p.id}', this.value)" /></td><td><button onclick="updateStock('${p.id}', ${p.qtyOnHand}, '${escapeHtml(p.name).replace(/'/g, "\\'")}')" class="btn btn-primary" style="padding:6px 10px;font-size:12px;margin-right:4px;"><i class='bx bx-refresh'></i></button><button onclick="deleteProduct('${p.id}')" class="btn btn-danger" style="padding:6px 10px;font-size:12px"><i class='bx bx-trash'></i></button></td></tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:40px;">No products yet</td></tr>';
}

async function updateThreshold(id, value) {
  const t = parseInt(value) || 10;
  try { await db.collection('organizations').doc(currentOrgId).collection('products').doc(id).update({ lowStockThreshold: t }); const p = products.find(pr => pr.id === id); if (p) p.lowStockThreshold = t; updateLowStockBadge(); renderLowStockAlert(); showToast('Updated', 'Threshold updated', 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

async function updateStock(id, currentStock, name) {
  const newStock = prompt(`Update stock for ${name}\n\nCurrent: ${currentStock}\n\nEnter new quantity:`, currentStock);
  if (newStock === null) return;
  const qty = parseInt(newStock);
  if (isNaN(qty) || qty < 0) { showToast('Invalid', 'Enter valid number', 'warning'); return; }
  try { await db.collection('organizations').doc(currentOrgId).collection('products').doc(id).update({ qtyOnHand: qty }); await loadProducts(); renderProductsTable(); renderLowStockAlert(); showToast('Updated', 'Stock updated', 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

async function deleteProduct(id) {
  if (!confirm('Delete this product?')) return;
  await db.collection('organizations').doc(currentOrgId).collection('products').doc(id).delete();
  await loadProducts(); renderProductsTable(); renderLowStockAlert();
  showToast('Deleted', 'Product removed', 'success');
}

// ==========================================
// SMART SEARCH
// ==========================================
function handleSearchInput(value) { const q = value.trim(); const cb = document.getElementById('clear-search-btn'); if (cb) cb.style.display = q ? 'flex' : 'none'; clearTimeout(searchTimeout); if (!q) { hideSuggestions(); renderProducts(); return; } searchTimeout = setTimeout(() => showSuggestions(q), 150); }

function showSuggestions(query) {
  const lq = query.toLowerCase();
  const filtered = products.filter(p => p.name.toLowerCase().includes(lq) || p.sku.toLowerCase().includes(lq) || (p.barcode && p.barcode.toLowerCase().includes(lq))).slice(0, 8);
  currentSuggestions = filtered;
  highlightedIndex = -1;
  const dd = document.getElementById('suggestions-dropdown');
  if (filtered.length === 0) { dd.innerHTML = `<div class="suggestion-empty"><i class='bx bx-search-alt-2'></i><p>No products found for "${escapeHtml(query)}"</p></div>`; dd.classList.add('active'); return; }
  dd.innerHTML = `<div class="suggestion-header"><span>${filtered.length} SUGGESTION${filtered.length !== 1 ? 'S' : ''}</span><span>↑↓ Enter to add</span></div>${filtered.map((p, i) => { const t = p.lowStockThreshold || 10; const sc = p.qtyOnHand === 0 ? 'out-stock' : (p.qtyOnHand <= t ? 'low-stock' : 'in-stock'); const st = p.qtyOnHand === 0 ? 'Out' : p.qtyOnHand <= t ? `${p.qtyOnHand} left` : `${p.qtyOnHand}`; return `<div class="suggestion-item" data-index="${i}" onclick="selectSuggestion('${p.id}')"><div class="suggestion-icon"><i class='bx bx-cube'></i></div><div class="suggestion-details"><div class="suggestion-name">${highlightMatch(p.name, query)}</div><div class="suggestion-meta"><span class="sku">📋 ${escapeHtml(p.sku)}</span><span class="stock-badge ${sc}">${st}</span></div></div><div class="suggestion-price">${money(p.price)}</div></div>`; }).join('')}`;
  dd.classList.add('active');
}

function hideSuggestions() { const dd = document.getElementById('suggestions-dropdown'); if (dd) dd.classList.remove('active'); currentSuggestions = []; highlightedIndex = -1; }
function selectSuggestion(productId) { const p = products.find(pr => pr.id === productId); if (!p) return; if (p.qtyOnHand === 0) { showToast('Out of Stock', p.name, 'warning'); return; } addToCart(productId); showToast('Added!', p.name, 'success'); document.getElementById('sku-input').value = ''; const cb = document.getElementById('clear-search-btn'); if (cb) cb.style.display = 'none'; hideSuggestions(); renderProducts(); }
function handleSuggestionKeys(e) { const dd = document.getElementById('suggestions-dropdown'); if (!dd.classList.contains('active') || !currentSuggestions.length) return; if (e.key === 'ArrowDown') { e.preventDefault(); highlightedIndex = Math.min(highlightedIndex + 1, currentSuggestions.length - 1); updateHighlight(); } else if (e.key === 'ArrowUp') { e.preventDefault(); highlightedIndex = Math.max(highlightedIndex - 1, -1); updateHighlight(); } else if (e.key === 'Escape') hideSuggestions(); }
function updateHighlight() { document.querySelectorAll('.suggestion-item').forEach((item, i) => { if (i === highlightedIndex) { item.classList.add('highlighted'); item.scrollIntoView({ block: 'nearest' }); } else item.classList.remove('highlighted'); }); }
function highlightMatch(text, query) { const e = escapeHtml(text); const eq = escapeHtml(query); return e.replace(new RegExp(`(${eq.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>'); }
function showSuggestionsIfAvailable() { const v = document.getElementById('sku-input').value.trim(); if (v) showSuggestions(v); }
function clearSearch() { const input = document.getElementById('sku-input'); input.value = ''; const cb = document.getElementById('clear-search-btn'); if (cb) cb.style.display = 'none'; hideSuggestions(); renderProducts(); input.focus(); }
document.addEventListener('click', function(e) { const w = document.querySelector('.search-box-wrapper'); if (w && !w.contains(e.target)) hideSuggestions(); });

// ==========================================
// CART
// ==========================================
function addToCart(id) { const p = products.find(pr => pr.id === id); if (!p) return; const ex = cart.find(i => i.id === id); if (ex) ex.qty++; else cart.push({ ...p, qty: 1 }); renderCart(); }
function updateQty(id, delta) { const item = cart.find(i => i.id === id); if (!item) return; item.qty += delta; if (item.qty <= 0) cart = cart.filter(i => i.id !== id); renderCart(); }
function removeItem(id) { cart = cart.filter(i => i.id !== id); renderCart(); }

function renderCart() {
  const container = document.getElementById('cart-items');
  const cartCountEl = document.getElementById('cart-count');
  if (cartCountEl) cartCountEl.textContent = `${cart.reduce((s,i)=>s+i.qty,0)} items`;
  container.innerHTML = cart.map(i => `<div class="cart-row"><span class="name">${escapeHtml(i.name)}</span><div class="qty-controls"><button onclick="updateQty('${i.id}', -1)">−</button><span>${i.qty}</span><button onclick="updateQty('${i.id}', 1)">+</button></div><span class="item-total">${money(i.price * i.qty)}</span><button class="remove" onclick="removeItem('${i.id}')"><i class='bx bx-x'></i></button></div>`).join('') || '<div class="cart-empty"><i class="bx bx-cart"></i><p>Cart is empty</p><small>Click a product to add it</small></div>';
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;
  document.getElementById('subtotal').textContent = moneyValue(subtotal);
  document.getElementById('tax').textContent = moneyValue(tax);
  document.getElementById('total').textContent = moneyValue(total);
  document.getElementById('change').textContent = moneyValue(Math.max(0, paid - total));
}

function clearCart() { cart = []; document.getElementById('amount-paid').value = ''; renderCart(); }

function handleSkuEnter(e) {
  if (e.key !== 'Enter') return;
  if (highlightedIndex >= 0 && currentSuggestions[highlightedIndex]) { selectSuggestion(currentSuggestions[highlightedIndex].id); return; }
  const q = e.target.value.trim();
  if (!q) return;
  let p = products.find(pr => pr.sku === q);
  if (!p) p = products.find(pr => pr.barcode === q);
  if (p) selectSuggestion(p.id);
  else showToast('Not Found', 'No product matches: ' + q, 'warning');
}

// ==========================================
// COMPLETE SALE - OFFLINE FRIENDLY
// ==========================================
async function completeSale(event) {
  const btn = event ? event.target.closest('button') : document.querySelector('.btn-success');
  if (isButtonLocked(btn)) return;
  if (cart.length === 0) { showToast('Empty Cart', 'Add items first', 'warning'); return; }
  
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tax = subtotal * TAX_RATE;
  const total = subtotal + tax;
  const paid = parseFloat(document.getElementById('amount-paid').value) || 0;
  if (paid < total) { showToast('Insufficient Payment', `Need at least ${money(total)}`, 'warning'); return; }
  
  lockButton(btn, 4000);
  btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Processing...';

  const orderData = {
    items: cart.map(i => ({ productId: i.id, sku: i.sku, name: i.name, qty: i.qty, price: i.price, lineTotal: i.price * i.qty })),
    subtotal, tax, total,
    amountPaid: paid,
    changeGiven: paid - total,
    cashierId: currentUser.uid,
    cashierName: currentUserData.fullName,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  const savedCart = [...cart];

  // OFFLINE MODE
  if (!isOnline) {
    try {
      db.collection('organizations').doc(currentOrgId).collection('orders').add(orderData);
      const batch = db.batch();
      for (const item of savedCart) {
        const ref = db.collection('organizations').doc(currentOrgId).collection('products').doc(item.id);
        batch.update(ref, { qtyOnHand: item.qtyOnHand - item.qty });
      }
      batch.commit();
      savedCart.forEach(item => {
        const p = products.find(pr => pr.id === item.id);
        if (p) p.qtyOnHand = p.qtyOnHand - item.qty;
      });
    } catch (err) { console.log('Offline write queued:', err); }
    
    showToast('Sale Complete! ✓ (Offline)', `Total: ${money(total)} | Change: ${money(paid - total)}`, 'success');
    showReceiptModal(orderData);
    
    cart = [];
    document.getElementById('amount-paid').value = '';
    setTimeout(() => {
      renderCart();
      renderProducts();
      updateLowStockBadge();
    }, 100);
    return;
  }
  
  // ONLINE MODE
  try {
    await db.collection('organizations').doc(currentOrgId).collection('orders').add(orderData);
    const batch = db.batch();
    for (const item of savedCart) {
      const ref = db.collection('organizations').doc(currentOrgId).collection('products').doc(item.id);
      batch.update(ref, { qtyOnHand: item.qtyOnHand - item.qty });
    }
    await batch.commit();
    
    showToast('Sale Complete! ✓', `Total: ${money(total)} | Change: ${money(paid - total)}`, 'success');
    showReceiptModal(orderData);
    
    cart = [];
    document.getElementById('amount-paid').value = '';
    renderCart();
    await loadProducts();
    updateLowStockBadge();
  } catch (err) {
    console.error('Sale error:', err);
    if (!isOnline || err.message.includes('offline') || err.message.includes('network') || err.code === 'unavailable') {
      savedCart.forEach(item => {
        const p = products.find(pr => pr.id === item.id);
        if (p) p.qtyOnHand = p.qtyOnHand - item.qty;
      });
      showToast('Sale Complete! ✓ (Offline)', `Will sync when online`, 'success');
      showReceiptModal(orderData);
      cart = [];
      document.getElementById('amount-paid').value = '';
      setTimeout(() => {
        renderCart();
        renderProducts();
        updateLowStockBadge();
      }, 100);
    } else {
      showToast('Error', err.message, 'error');
    }
  }
}

// ==========================================
// ORDERS
// ==========================================
async function loadOrders() {
  try {
    const snap = await db.collection('organizations').doc(currentOrgId).collection('orders').orderBy('createdAt', 'desc').limit(50).get();
    const tbody = document.getElementById('orders-tbody');
    const rows = [];
    snap.forEach(doc => { const o = doc.data(); const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-ZM') : 'Pending sync'; const itemCount = (o.items || []).reduce((s, i) => s + i.qty, 0); rows.push(`<tr><td>${date}</td><td>${escapeHtml(o.cashierName || 'Unknown')}</td><td>${itemCount}</td><td>${money(o.total)}</td><td>${money(o.amountPaid)}</td><td><button onclick="reprintReceipt('${doc.id}')" class="btn btn-primary" style="padding:6px 12px;font-size:12px"><i class='bx bx-receipt'></i> Receipt</button></td></tr>`); });
    tbody.innerHTML = rows.join('') || '<tr><td colspan="6" style="text-align:center;color:var(--gray-400);padding:40px;">No orders yet</td></tr>';
  } catch (err) { console.error('Load orders:', err); }
}

// ==========================================
// REPORTS
// ==========================================
async function loadReports(period) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = document.getElementById('filter-' + period);
  if (activeBtn) activeBtn.classList.add('active');
  const now = new Date();
  let startDate, endDate;
  if (period === 'today') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); endDate = new Date(); }
  else if (period === 'yesterday') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1); endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
  else if (period === 'week') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7); endDate = new Date(); }
  else if (period === 'month') { startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30); endDate = new Date(); }
  try {
    const snap = await db.collection('organizations').doc(currentOrgId).collection('orders').where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(startDate)).where('createdAt', '<=', firebase.firestore.Timestamp.fromDate(endDate)).get();
    let totalRevenue = 0, totalOrders = 0, totalItems = 0;
    const salesByDay = {}, productSales = {}, staffSales = {};
    snap.forEach(doc => { const o = doc.data(); totalRevenue += o.total || 0; totalOrders++; totalItems += (o.items || []).reduce((s, i) => s + i.qty, 0); const dk = o.createdAt?.toDate ? o.createdAt.toDate().toISOString().split('T')[0] : 'unknown'; if (!salesByDay[dk]) salesByDay[dk] = 0; salesByDay[dk] += o.total || 0; (o.items || []).forEach(item => { if (!productSales[item.productId]) productSales[item.productId] = { name: item.name, qty: 0, revenue: 0 }; productSales[item.productId].qty += item.qty; productSales[item.productId].revenue += item.lineTotal; }); if (o.cashierId) { if (!staffSales[o.cashierId]) staffSales[o.cashierId] = { name: o.cashierName || 'Unknown', count: 0, total: 0 }; staffSales[o.cashierId].count++; staffSales[o.cashierId].total += o.total || 0; } });
    document.getElementById('report-revenue').textContent = moneyValue(totalRevenue);
    document.getElementById('report-orders').textContent = totalOrders;
    document.getElementById('report-items').textContent = totalItems;
    document.getElementById('report-avg').textContent = moneyValue(totalOrders > 0 ? totalRevenue / totalOrders : 0);
    renderSalesChart(salesByDay, period);
    const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
    document.getElementById('top-products').innerHTML = topProducts.length === 0 ? '<p style="text-align:center;padding:20px;color:var(--gray-500);">No sales</p>' : topProducts.map((p, i) => `<div class="top-product-item"><div class="top-product-rank">${i + 1}</div><div class="top-product-info"><div class="top-product-name">${escapeHtml(p.name)}</div><div class="top-product-meta">${p.qty} sold</div></div><div class="top-product-revenue">${money(p.revenue)}</div></div>`).join('');
    const sortedStaff = Object.values(staffSales).sort((a, b) => b.total - a.total);
    document.getElementById('staff-report').innerHTML = sortedStaff.length === 0 ? '<p style="text-align:center;padding:20px;color:var(--gray-500);">No sales</p>' : sortedStaff.map((s, i) => { const ri = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1; const rc = i < 3 ? `rank-${i + 1}` : ''; return `<div class="staff-performance-item"><div class="staff-rank ${rc}">${ri}</div><div class="staff-avatar-small">${s.name.charAt(0).toUpperCase()}</div><div class="staff-performance-details"><div class="staff-performance-name">${escapeHtml(s.name)}</div><div class="staff-performance-meta">${s.count} sale${s.count !== 1 ? 's' : ''}</div></div><div class="staff-performance-total">${money(s.total)}</div></div>`; }).join('');
  } catch (err) { showToast('Error', 'Reports: ' + err.message, 'error'); }
}

function renderSalesChart(salesByDay, period) {
  const canvas = document.getElementById('sales-chart');
  if (!canvas) return;
  const now = new Date();
  const labels = [], data = [];
  let days = 1;
  if (period === 'week') days = 7;
  else if (period === 'month') days = 30;
  if (period === 'today' || period === 'yesterday') {
    const td = period === 'today' ? new Date() : new Date(now.getTime() - 86400000);
    labels.push(td.toLocaleDateString('en-ZM', { weekday: 'short', month: 'short', day: 'numeric' }));
    data.push(salesByDay[td.toISOString().split('T')[0]] || 0);
  } else {
    for (let i = days - 1; i >= 0; i--) { const d = new Date(now.getTime() - i * 86400000); labels.push(d.toLocaleDateString('en-ZM', { month: 'short', day: 'numeric' })); data.push(salesByDay[d.toISOString().split('T')[0]] || 0); }
  }
  if (salesChart) salesChart.destroy();
  const isDark = document.body.classList.contains('dark-mode');
  salesChart = new Chart(canvas, { type: 'line', data: { labels, datasets: [{ label: 'Sales (' + CURRENCY + ')', data, backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1', borderWidth: 3, pointBackgroundColor: '#6366f1', pointBorderColor: '#fff', pointBorderWidth: 2, pointRadius: 6, fill: true, tension: 0.4 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(0,0,0,0.8)', padding: 12, callbacks: { label: ctx => CURRENCY + ' ' + ctx.parsed.y.toLocaleString('en-ZM', { minimumFractionDigits: 2 }) } } }, scales: { y: { beginAtZero: true, grid: { color: isDark ? '#334155' : '#e2e8f0' }, ticks: { color: isDark ? '#cbd5e1' : '#475569', callback: v => CURRENCY + ' ' + v.toLocaleString('en-ZM') } }, x: { grid: { color: isDark ? '#334155' : '#e2e8f0' }, ticks: { color: isDark ? '#cbd5e1' : '#475569' } } } } });
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
  if (!currentOrgId) return;
  document.getElementById('stat-total-products').textContent = products.length;
  document.getElementById('stat-low-stock').textContent = getLowStockItems().length + getOutOfStockItems().length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  try {
    const snap = await db.collection('organizations').doc(currentOrgId).collection('orders').where('createdAt', '>=', firebase.firestore.Timestamp.fromDate(today)).get();
    let todaySales = 0, todayOrders = 0;
    const salesByStaff = {};
    snap.forEach(doc => { const o = doc.data(); todaySales += o.total || 0; todayOrders++; const sid = o.cashierId || 'unknown'; const sn = o.cashierName || 'Unknown'; if (!salesByStaff[sid]) salesByStaff[sid] = { name: sn, count: 0, total: 0 }; salesByStaff[sid].count++; salesByStaff[sid].total += o.total || 0; });
    document.getElementById('stat-today-sales').textContent = moneyValue(todaySales);
    document.getElementById('stat-today-orders').textContent = todayOrders;
    const sortedStaff = Object.values(salesByStaff).sort((a, b) => b.total - a.total);
    document.getElementById('staff-performance').innerHTML = sortedStaff.length === 0 ? '<p style="color:var(--gray-500);text-align:center;padding:20px;">No sales today</p>' : sortedStaff.map((s, i) => { const rc = i < 3 ? `rank-${i + 1}` : ''; const ri = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1; return `<div class="staff-performance-item"><div class="staff-rank ${rc}">${ri}</div><div class="staff-avatar-small">${s.name.charAt(0).toUpperCase()}</div><div class="staff-performance-details"><div class="staff-performance-name">${escapeHtml(s.name)}</div><div class="staff-performance-meta">${s.count} sale${s.count !== 1 ? 's' : ''}</div></div><div class="staff-performance-total">${money(s.total)}</div></div>`; }).join('');
    const recentSnap = await db.collection('organizations').doc(currentOrgId).collection('orders').orderBy('createdAt', 'desc').limit(5).get();
    const items = [];
    recentSnap.forEach(doc => { const o = doc.data(); const date = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('en-ZM') : 'Pending'; const ic = (o.items || []).reduce((s, i) => s + i.qty, 0); items.push(`<div style="padding:14px 0;border-bottom:1px solid var(--gray-100);display:flex;justify-content:space-between;align-items:center;"><div><div style="font-weight:600;font-size:14px;">Sale of ${ic} items by ${escapeHtml(o.cashierName || 'Unknown')}</div><small>${date}</small></div><div style="font-weight:700;color:var(--success);font-size:16px;">${money(o.total)}</div></div>`); });
    document.getElementById('recent-activity').innerHTML = items.join('') || '<p style="text-align:center;padding:20px;">No activity yet</p>';
  } catch (err) { console.error('Dashboard:', err); }
}

// ==========================================
// DARK MODE & THEME
// ==========================================
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('darkMode', isDark ? 'on' : 'off');
  document.querySelectorAll('#theme-btn i, #theme-btn-mobile i').forEach(icon => { if (isDark) { icon.classList.remove('bx-moon'); icon.classList.add('bx-sun'); } else { icon.classList.remove('bx-sun'); icon.classList.add('bx-moon'); } });
  if (document.getElementById('reports-tab').classList.contains('active')) { const af = document.querySelector('.filter-btn.active'); if (af) loadReports(af.id.replace('filter-', '')); }
  showToast(isDark ? 'Dark Mode' : 'Light Mode', 'Enabled', 'info');
}

function loadDarkModePreference() {
  if (localStorage.getItem('darkMode') === 'on') { document.body.classList.add('dark-mode'); document.querySelectorAll('#theme-btn i, #theme-btn-mobile i').forEach(icon => { icon.classList.remove('bx-moon'); icon.classList.add('bx-sun'); }); }
}

function setThemeColor(color) {
  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-dark', shadeColor(color, -15));
  document.documentElement.style.setProperty('--primary-light', shadeColor(color, 40));
  localStorage.setItem('themeColor', color);
  if (currentOrgId) db.collection('organizations').doc(currentOrgId).update({ themeColor: color }).catch(() => {});
  document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.toggle('active', sw.dataset.color === color));
}

function shadeColor(color, percent) {
  let R = parseInt(color.substring(1,3), 16), G = parseInt(color.substring(3,5), 16), B = parseInt(color.substring(5,7), 16);
  R = Math.min(255, Math.max(0, parseInt(R * (100 + percent) / 100)));
  G = Math.min(255, Math.max(0, parseInt(G * (100 + percent) / 100)));
  B = Math.min(255, Math.max(0, parseInt(B * (100 + percent) / 100)));
  return '#' + R.toString(16).padStart(2, '0') + G.toString(16).padStart(2, '0') + B.toString(16).padStart(2, '0');
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
  document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.toggle('active', sw.dataset.color === color));
}

async function saveBusinessInfo() {
  const name = document.getElementById('setting-biz-name').value.trim();
  const phone = document.getElementById('setting-phone').value.trim();
  const address = document.getElementById('setting-address').value.trim();
  const email = document.getElementById('setting-email').value.trim();
  if (!name) { showToast('Error', 'Business name required', 'error'); return; }
  try { await db.collection('organizations').doc(currentOrgId).update({ name, phone, address, email }); currentOrg.name = name; currentOrg.phone = phone; currentOrg.address = address; currentOrg.email = email; document.getElementById('business-name').textContent = name; showToast('Success', 'Updated', 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

async function saveTaxSettings() {
  const taxPercent = parseFloat(document.getElementById('setting-tax').value);
  const currency = document.getElementById('setting-currency').value.trim() || 'K';
  if (isNaN(taxPercent) || taxPercent < 0 || taxPercent > 100) { showToast('Error', 'Valid tax rate (0-100)', 'error'); return; }
  try { await db.collection('organizations').doc(currentOrgId).update({ taxRate: taxPercent / 100, currency }); currentOrg.taxRate = taxPercent / 100; currentOrg.currency = currency; TAX_RATE = taxPercent / 100; CURRENCY = currency; renderCart(); renderProducts(); showToast('Success', 'Updated', 'success'); }
  catch (err) { showToast('Error', err.message, 'error'); }
}

// ==========================================
// BARCODE SCANNER
// ==========================================
async function openScanner() {
  const modal = document.getElementById('scanner-modal'); modal.classList.add('active');
  const status = document.getElementById('scanner-status'); const flashBtn = document.getElementById('flashlight-btn');
  if (flashBtn) flashBtn.style.display = 'none';
  status.textContent = 'Requesting camera...';
  lastScannedCode = null; lastScanTime = 0; scannerProcessing = false;
  try {
    codeReader = new ZXing.BrowserMultiFormatReader();
    const devices = await codeReader.listVideoInputDevices();
    if (!devices.length) { status.textContent = '❌ No camera'; return; }
    let deviceId = devices[0].deviceId;
    const back = devices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('rear') || d.label.toLowerCase().includes('environment'));
    if (back) deviceId = back.deviceId;
    status.textContent = '📷 Scanning...';
    codeReader.decodeFromVideoDevice(deviceId, 'scanner-video', (result) => { if (result) handleScannedBarcode(result.getText()); });
    setTimeout(checkFlashlightSupport, 500);
    setTimeout(checkFlashlightSupport, 1500);
    setTimeout(checkFlashlightSupport, 3000);
  } catch (err) { status.textContent = '❌ ' + err.message; }
}

async function checkFlashlightSupport() {
  const video = document.getElementById('scanner-video'); const flashBtn = document.getElementById('flashlight-btn');
  if (!video || !video.srcObject) return;
  currentStream = video.srcObject;
  const track = currentStream.getVideoTracks()[0];
  if (!track) return;
  try { const c = track.getCapabilities ? track.getCapabilities() : {}; if (c.torch) flashBtn.style.display = 'flex'; else { try { await track.applyConstraints({ advanced: [{ torch: false }] }); flashBtn.style.display = 'flex'; } catch (e) { flashBtn.style.display = 'none'; } } } catch (err) {}
}

async function toggleFlashlight() {
  if (!currentStream) return;
  const track = currentStream.getVideoTracks()[0]; if (!track) return;
  const flashBtn = document.getElementById('flashlight-btn');
  try { flashlightOn = !flashlightOn; await track.applyConstraints({ advanced: [{ torch: flashlightOn }] }); if (flashlightOn) { flashBtn.classList.add('active'); showToast('Flashlight', 'On', 'info'); } else { flashBtn.classList.remove('active'); showToast('Flashlight', 'Off', 'info'); } }
  catch (err) { flashlightOn = !flashlightOn; }
}

function handleScannedBarcode(code) {
  const now = Date.now();
  if (scannerProcessing) return;
  if (lastScannedCode === code && (now - lastScanTime) < 3000) return;
  if ((now - lastScanTime) < 500) return;
  scannerProcessing = true; lastScannedCode = code; lastScanTime = now;
  if (navigator.vibrate) navigator.vibrate(100);
  const product = products.find(p => p.sku === code || p.barcode === code);
  if (product) {
    if (product.qtyOnHand === 0) { document.getElementById('scanner-status').textContent = `⚠️ Out of stock: ${product.name}`; showToast('Out of Stock', product.name, 'warning'); setTimeout(() => { scannerProcessing = false; }, 500); return; }
    addToCart(product.id);
    document.getElementById('scanner-status').textContent = `✓ Added: ${product.name}`;
    showToast('Scanned!', product.name, 'success');
    setTimeout(closeScanner, 800);
  } else {
    document.getElementById('scanner-status').textContent = `❌ Not found: ${code}`;
    showToast('Not Found', code, 'warning');
    if (currentUserData?.role !== 'cashier') { setTimeout(() => { if (confirm(`Barcode "${code}" not found.\n\nAdd as new product?`)) { closeScanner(); showTab('products'); document.getElementById('new-sku').value = code; document.getElementById('new-name').focus(); } else scannerProcessing = false; }, 1000); }
    else setTimeout(() => { scannerProcessing = false; }, 2000);
  }
}

function closeScanner() {
  document.getElementById('scanner-modal').classList.remove('active');
  if (flashlightOn && currentStream) { const track = currentStream.getVideoTracks()[0]; if (track) try { track.applyConstraints({ advanced: [{ torch: false }] }); } catch (err) {} }
  flashlightOn = false; currentStream = null; lastScannedCode = null; lastScanTime = 0; scannerProcessing = false;
  const flashBtn = document.getElementById('flashlight-btn');
  if (flashBtn) { flashBtn.classList.remove('active'); flashBtn.style.display = 'none'; }
  if (codeReader) { codeReader.reset(); codeReader = null; }
}

// ==========================================
// RECEIPT
// ==========================================
function generateReceiptHTML(orderData) {
  const date = new Date();
  const dateStr = date.toLocaleString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const orderNum = 'R' + Date.now().toString().slice(-8);
  let html = `<div class="receipt-header-print"><h4>${escapeHtml(currentOrg?.name || 'BUSINESS')}</h4>${currentOrg?.address ? `<p>${escapeHtml(currentOrg.address)}</p>` : ''}${currentOrg?.phone ? `<p>Tel: ${escapeHtml(currentOrg.phone)}</p>` : ''}</div><div style="text-align:center;padding:8px 0;font-size:11px;"><p><strong>RECEIPT</strong></p><p>Receipt #: ${orderNum}</p><p>${dateStr}</p><p>Cashier: ${escapeHtml(orderData.cashierName || currentUserData?.fullName || 'Unknown')}</p></div><div style="border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;padding:8px 0;margin:8px 0;"><div style="display:flex;justify-content:space-between;font-weight:700;font-size:11px;"><span>ITEM</span><span>TOTAL</span></div></div>`;
  orderData.items.forEach(item => { html += `<div class="receipt-item"><div class="receipt-item-name">${escapeHtml(item.name)}</div><div class="receipt-item-details"><span>${item.qty} x ${money(item.price)}</span><span><strong>${money(item.lineTotal)}</strong></span></div></div>`; });
  html += `<div class="receipt-totals"><div class="receipt-total-row"><span>Subtotal:</span><span>${money(orderData.subtotal)}</span></div><div class="receipt-total-row"><span>VAT (${(TAX_RATE * 100).toFixed(0)}%):</span><span>${money(orderData.tax)}</span></div><div class="receipt-total-row grand"><span>TOTAL:</span><span>${money(orderData.total)}</span></div><div class="receipt-total-row"><span>Paid:</span><span>${money(orderData.amountPaid)}</span></div><div class="receipt-total-row"><span>Change:</span><span>${money(orderData.changeGiven)}</span></div></div><div class="receipt-footer-print"><p><strong>Thank you!</strong></p><p>Please come again 🙏</p></div>`;
  return { html, orderNum, dateStr };
}

function showReceiptModal(orderData) { currentReceipt = orderData; document.getElementById('receipt-preview').innerHTML = generateReceiptHTML(orderData).html; document.getElementById('receipt-modal').classList.add('active'); }
function closeReceiptModal() { document.getElementById('receipt-modal').classList.remove('active'); currentReceipt = null; }

function printReceipt() {
  const receiptHTML = document.getElementById('receipt-preview').innerHTML;
  const pw = window.open('', '', 'width=400,height=600');
  pw.document.write(`<!DOCTYPE html><html><head><title>Receipt</title><style>body{font-family:'Courier New',monospace;font-size:12px;padding:20px;max-width:300px;margin:0 auto;}.receipt-header-print{text-align:center;padding-bottom:12px;border-bottom:2px dashed #000;margin-bottom:12px;}.receipt-header-print h4{font-size:16px;margin-bottom:4px;}.receipt-header-print p{font-size:11px;margin:2px 0;}.receipt-item{padding:6px 0;border-bottom:1px dotted #999;}.receipt-item-name{font-weight:bold;}.receipt-item-details{display:flex;justify-content:space-between;font-size:11px;}.receipt-totals{padding-top:12px;margin-top:12px;border-top:2px dashed #000;}.receipt-total-row{display:flex;justify-content:space-between;padding:3px 0;}.receipt-total-row.grand{font-size:14px;font-weight:bold;padding:8px 0;border-top:1px solid #000;border-bottom:1px solid #000;margin:6px 0;}.receipt-footer-print{text-align:center;margin-top:16px;padding-top:12px;border-top:2px dashed #000;font-size:11px;}</style></head><body>${receiptHTML}</body></html>`);
  pw.document.close();
  setTimeout(() => { pw.print(); pw.close(); }, 250);
}

function downloadReceiptPDF() {
  if (!currentReceipt) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: [80, 297] });
  let y = 10; const cx = 40;
  doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text(currentOrg?.name || 'BUSINESS', cx, y, { align: 'center' }); y += 6;
  doc.setFontSize(8); doc.setFont(undefined, 'normal');
  if (currentOrg?.address) { doc.text(currentOrg.address, cx, y, { align: 'center' }); y += 4; }
  if (currentOrg?.phone) { doc.text('Tel: ' + currentOrg.phone, cx, y, { align: 'center' }); y += 4; }
  y += 2; doc.line(5, y, 75, y); y += 5;
  const on = 'R' + Date.now().toString().slice(-8);
  doc.setFont(undefined, 'bold'); doc.text('RECEIPT', cx, y, { align: 'center' }); y += 5;
  doc.setFont(undefined, 'normal'); doc.text('Receipt #: ' + on, 5, y); y += 4; doc.text('Date: ' + new Date().toLocaleString('en-ZM'), 5, y); y += 4; doc.text('Cashier: ' + (currentReceipt.cashierName || 'Unknown'), 5, y); y += 5;
  doc.line(5, y, 75, y); y += 5;
  doc.setFont(undefined, 'bold'); doc.text('ITEM', 5, y); doc.text('TOTAL', 75, y, { align: 'right' }); y += 4; doc.setFont(undefined, 'normal');
  currentReceipt.items.forEach(item => { doc.setFont(undefined, 'bold'); doc.text(item.name.substring(0, 30), 5, y); y += 4; doc.setFont(undefined, 'normal'); doc.text(`${item.qty} x ${money(item.price)}`, 5, y); doc.text(money(item.lineTotal), 75, y, { align: 'right' }); y += 5; });
  y += 2; doc.line(5, y, 75, y); y += 5;
  doc.text('Subtotal:', 5, y); doc.text(money(currentReceipt.subtotal), 75, y, { align: 'right' }); y += 4;
  doc.text(`VAT (${(TAX_RATE * 100).toFixed(0)}%):`, 5, y); doc.text(money(currentReceipt.tax), 75, y, { align: 'right' }); y += 5;
  doc.setFont(undefined, 'bold'); doc.setFontSize(11); doc.text('TOTAL:', 5, y); doc.text(money(currentReceipt.total), 75, y, { align: 'right' }); y += 6;
  doc.setFont(undefined, 'normal'); doc.setFontSize(8);
  doc.text('Paid:', 5, y); doc.text(money(currentReceipt.amountPaid), 75, y, { align: 'right' }); y += 4;
  doc.text('Change:', 5, y); doc.text(money(currentReceipt.changeGiven), 75, y, { align: 'right' }); y += 6;
  doc.line(5, y, 75, y); y += 5;
  doc.setFont(undefined, 'bold'); doc.text('Thank you!', cx, y, { align: 'center' });
  doc.save(`Receipt_${on}.pdf`);
  showToast('Downloaded!', 'PDF saved', 'success');
}

async function shareReceipt() {
  if (!currentReceipt) return;
  const on = 'R' + Date.now().toString().slice(-8);
  const bn = currentOrg?.name || 'Business';
  let text = `🧾 *${bn}* - Receipt #${on}\n\n`;
  currentReceipt.items.forEach(i => { text += `${i.name}\n  ${i.qty} x ${money(i.price)} = ${money(i.lineTotal)}\n`; });
  text += `\nSubtotal: ${money(currentReceipt.subtotal)}\nVAT: ${money(currentReceipt.tax)}\n*TOTAL: ${money(currentReceipt.total)}*\nPaid: ${money(currentReceipt.amountPaid)}\nChange: ${money(currentReceipt.changeGiven)}\n\n_Thank you!_`;
  if (navigator.share) { try { await navigator.share({ title: `Receipt from ${bn}`, text }); } catch (err) {} }
  else { try { await navigator.clipboard.writeText(text); showToast('Copied!', 'Paste in WhatsApp', 'success'); } catch (err) { window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank'); } }
}

function reprintReceipt(orderId) {
  db.collection('organizations').doc(currentOrgId).collection('orders').doc(orderId).get()
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
  toast.innerHTML = `<i class='bx ${icons[type]}'></i><div class="toast-content"><div class="toast-title">${title}</div><div class="toast-message">${message}</div></div>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'slideIn 0.3s reverse'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function updateMobileTitle(title) { const el = document.getElementById('mobile-title'); if (el) el.textContent = title; }

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

// ==========================================
// AUTO LOGIN CHECK - FIXED
// ==========================================
auth.onAuthStateChanged(async (user) => {
  if (user) { 
    currentUser = user; 
    // Skip auto-routing if a registration is currently in progress.
    // The signup/join functions handle screen navigation manually after all 
    // database writes are confirmed.
    if (!isRegistering) {
      await showPOS(); 
    }
  }
  else { 
    currentUser = null; 
    currentUserData = null; 
    showLogin(); 
  }
});
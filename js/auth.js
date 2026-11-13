// PIN Authentication, SHA-256 hashing, lockout rate-limiting & first-run bootstrap
import { isFirebaseConfigured, saveLocalFirebaseConfig } from './firebase-config.js';
import { bootstrapFirstAdmin, fetchInitialConfigAndRoster, stopRealtimeListeners } from './db.js';
import { state } from './state.js';
import { sha256Hex, showToast } from './utils.js';
import { t } from './i18n.js';

const LOCKOUT_KEY = 'loja_pin_lockout';
const SESSION_USER_KEY = 'loja_user';
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

let onLoginSuccessCallback = null;

export function setOnLoginSuccess(fn) {
  onLoginSuccessCallback = fn;
}

function getLockState() {
  try {
    const raw = sessionStorage.getItem(LOCKOUT_KEY);
    return raw ? JSON.parse(raw) : { count: 0, until: 0 };
  } catch {
    return { count: 0, until: 0 };
  }
}

function setLockState(data) {
  sessionStorage.setItem(LOCKOUT_KEY, JSON.stringify(data));
}

export async function initializeAuthModal() {
  const loginOverlay = document.getElementById('login-overlay');
  const setupBox = document.getElementById('firebase-setup-box');
  const bootstrapBox = document.getElementById('first-admin-box');
  const pinBox = document.getElementById('pin-login-box');

  if (!isFirebaseConfigured()) {
    setupBox.style.display = 'block';
    bootstrapBox.style.display = 'none';
    pinBox.style.display = 'none';
    if (loginOverlay && !loginOverlay.open) loginOverlay.showModal?.();
    return;
  }

  setupBox.style.display = 'none';
  bootstrapBox.style.display = 'none';
  pinBox.style.display = 'none';
  const errDiv = document.getElementById('login-error');
  if (errDiv) errDiv.innerText = '';
  if (loginOverlay && !loginOverlay.open) loginOverlay.showModal?.();

  // Restore session if present while refreshing config/roster in background
  const savedUser = sessionStorage.getItem(SESSION_USER_KEY);
  try {
    const { roster } = await fetchInitialConfigAndRoster();
    if (roster.length === 0) {
      bootstrapBox.style.display = 'block';
      pinBox.style.display = 'none';
      if (loginOverlay && !loginOverlay.open) loginOverlay.showModal?.();
      return;
    }

    bootstrapBox.style.display = 'none';
    pinBox.style.display = 'block';

    if (savedUser) {
      const parsed = JSON.parse(savedUser);
      const liveMember = roster.find((m) => m.name === parsed.name || (parsed.id && m.id === parsed.id));
      if (liveMember) {
        state.currentUser = {
          id: liveMember.id,
          name: liveMember.name,
          role: liveMember.role,
          storeAssignment: liveMember.storeAssignment || 'All Stores'
        };
        await onLoginSuccessCallback?.();
        return;
      }
      sessionStorage.removeItem(SESSION_USER_KEY);
    }
  } catch (err) {
    if (errDiv) errDiv.innerText = 'Firebase connection error: ' + err.message;
  }

  if (loginOverlay && !loginOverlay.open) loginOverlay.showModal?.();
  document.getElementById('login-pin')?.focus();
}

export async function attemptLogin() {
  const pinInput = document.getElementById('login-pin');
  const errorDiv = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  const pin = (pinInput?.value || '').trim();
  errorDiv.innerText = '';

  const lock = getLockState();
  if (lock.until && Date.now() < lock.until) {
    const secs = Math.ceil((lock.until - Date.now()) / 1000);
    errorDiv.innerText =
      state.currentLanguage === 'pt'
        ? `Muitas tentativas. Aguarde ${secs}s.`
        : `Too many attempts. Wait ${secs}s.`;
    return;
  }

  if (!pin) {
    errorDiv.innerText = t('login_err_empty', 'Please enter your PIN.');
    return;
  }

  btn.disabled = true;
  btn.innerText = t('login_authenticating', 'Authenticating...');

  try {
    if (state.teamRoster.length === 0) {
      await fetchInitialConfigAndRoster();
    }
    const pinHash = await sha256Hex(pin);
    const matched = state.teamRoster.find(
      (m) => (m.pinHash && m.pinHash === pinHash) || (m.pin && String(m.pin) === pin)
    );

    if (!matched) {
      const nextCount = (lock.count || 0) + 1;
      setLockState({
        count: nextCount >= MAX_ATTEMPTS ? 0 : nextCount,
        until: nextCount >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0
      });
      errorDiv.innerText = t('login_err_invalid', 'Invalid PIN.');
      return;
    }

    setLockState({ count: 0, until: 0 });
    state.currentUser = {
      id: matched.id,
      name: matched.name,
      role: matched.role,
      storeAssignment: matched.storeAssignment || 'All Stores'
    };
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(state.currentUser));
    pinInput.value = '';
    await onLoginSuccessCallback?.();
  } catch (err) {
    errorDiv.innerText = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.innerText = t('login_btn', 'Login');
  }
}

export async function handleBootstrapAdminSubmit() {
  const name = (document.getElementById('bootstrap-admin-name')?.value || '').trim();
  const pin = (document.getElementById('bootstrap-admin-pin')?.value || '').trim();
  const errDiv = document.getElementById('login-error');
  errDiv.innerText = '';

  if (!name || pin.length < 4) {
    errDiv.innerText =
      state.currentLanguage === 'pt'
        ? 'Informe seu nome e um PIN com pelo menos 4 caracteres.'
        : 'Enter your name and a PIN with at least 4 characters.';
    return;
  }

  try {
    const admin = await bootstrapFirstAdmin(name, pin);
    state.currentUser = {
      id: admin.id,
      name: admin.name,
      role: admin.role,
      storeAssignment: admin.storeAssignment
    };
    sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(state.currentUser));
    showToast(state.currentLanguage === 'pt' ? 'Administrador inicial criado!' : 'Initial Admin created!');
    await onLoginSuccessCallback?.();
  } catch (err) {
    errDiv.innerText = err.message;
  }
}

export async function handleLocalFirebaseConfigSave() {
  const raw = (document.getElementById('firebase-config-paste')?.value || '').trim();
  const errDiv = document.getElementById('login-error');
  errDiv.innerText = '';
  try {
    // Accept either pure JSON or pasted JS object literal with unquoted keys
    const normalized = raw
      .replace(/^\s*(const|export\s+const)\s+\w+\s*=\s*/, '')
      .replace(/;\s*$/, '')
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"');
    const parsed = JSON.parse(normalized);
    if (!parsed.apiKey || !parsed.projectId || !parsed.appId) {
      throw new Error('Config must include apiKey, projectId, and appId.');
    }
    saveLocalFirebaseConfig(parsed);
    await initializeAuthModal();
  } catch (err) {
    errDiv.innerText = 'Invalid Firebase config JSON: ' + err.message;
  }
}

export function logout() {
  stopRealtimeListeners();
  sessionStorage.removeItem(SESSION_USER_KEY);
  location.reload();
}

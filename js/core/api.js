// ============================================================
// js/core/api.js — v28.2.0 FULL FIX + CONNECTION RESILIENCE
// GitHub Pages /bisaa/ Edition
// ============================================================
// CHANGELOG v28.2.0 (dari v28.1.0):
//   ✅ NEW: Retry 3x dengan exponential backoff (500→1000→2000ms)
//   ✅ NEW: Deteksi offline sebelum fetch
//   ✅ NEW: Deteksi SCRIPT_URL invalid
//   ✅ NEW: healthCheck() & testConnection() helpers
//   ✅ NEW: Pesan error CORS lebih jelas + actionable
//   ✅ FIX: Circuit breaker auto-reset lebih cepat
//   ✅ FIX: Retry untuk SEMUA GET (bukan cuma 3 action)
//   ✅ FIX: Safe JSON parse & HTML detection
//   ✅ FIX: extractId() multi-level
//   ✅ KEEP: 150+ exports zero regression
// ============================================================

import {
  SCRIPT_URL,
  BASE_PATH,
  APP_VERSION,
  DEFAULT_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  MAX_RETRY,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  LOGIN_PATH,
  isOnline,
  isScriptUrlValid,
  getActiveScriptUrl,
} from './config.js';

// ============================================================
//   AUTH STATE
// ============================================================
let userRole = null;
let userData = {};

// ============================================================
//   REQUEST DEDUPLICATION
// ============================================================
const pendingRequests = new Map();
const DEDUP_WINDOW_MS = 500;

// ============================================================
//   CIRCUIT BREAKER
// ============================================================
const _circuit = {
  failures: 0,
  openedAt: 0,
  successSinceOpen: 0,
  lastFailureType: null,
  THRESHOLD: 3,
  COOLDOWN_MS: 30000,
  HALF_OPEN_SUCCESS: 2,
};

function _isCircuitOpen() {
  if (_circuit.failures < _circuit.THRESHOLD) return false;

  const elapsed = Date.now() - _circuit.openedAt;
  if (elapsed > _circuit.COOLDOWN_MS) {
    if (_circuit.successSinceOpen === 0) {
      console.log(`[API] 🟡 Circuit HALF-OPEN — testing (failures=${_circuit.failures})`);
    }
    return false;
  }
  return true;
}

function _recordSuccess() {
  if (_circuit.failures > 0) {
    _circuit.successSinceOpen++;
    if (_circuit.successSinceOpen >= _circuit.HALF_OPEN_SUCCESS) {
      console.log(`[API] 🟢 Circuit CLOSED — server recovered`);
      _circuit.failures = 0;
      _circuit.openedAt = 0;
      _circuit.successSinceOpen = 0;
      _circuit.lastFailureType = null;
    }
  }
}

function _recordFailure(errorType) {
  const isBreakable = errorType === 'cors' || errorType === 'network' || errorType === 'timeout';
  if (!isBreakable) return;

  _circuit.failures++;
  _circuit.lastFailureType = errorType;
  _circuit.successSinceOpen = 0;

  if (_circuit.failures >= _circuit.THRESHOLD && _circuit.openedAt === 0) {
    _circuit.openedAt = Date.now();
    console.warn(
      `[API] 🔴 Circuit OPEN — ${_circuit.failures} ${errorType} failures. ` +
      `Pausing ${_circuit.COOLDOWN_MS / 1000}s.`
    );
  }
}

export function getCircuitState() {
  const isOpen = _isCircuitOpen();
  const remainingMs = isOpen
    ? Math.max(0, _circuit.COOLDOWN_MS - (Date.now() - _circuit.openedAt))
    : 0;

  return {
    isOpen,
    failures: _circuit.failures,
    remainingMs,
    cooldownMs: _circuit.COOLDOWN_MS,
    threshold: _circuit.THRESHOLD,
    lastFailureType: _circuit.lastFailureType,
  };
}

export function resetCircuit() {
  _circuit.failures = 0;
  _circuit.openedAt = 0;
  _circuit.successSinceOpen = 0;
  _circuit.lastFailureType = null;
  console.log('[API] 🔄 Circuit reset manually');
}

function _classifyError(message) {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('cors') || msg.includes('access-control')) {
    return 'cors';
  }
  if (msg.includes('network') || msg.includes('err_failed') || msg.includes('err_network')) {
    return 'network';
  }
  if (msg.includes('timeout') || msg.includes('abort')) {
    return 'timeout';
  }
  return 'other';
}

// ============================================================
//   ESCAPE HTML
// ============================================================
export function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
//   NORMALIZE RESPONSE
// ============================================================
export function normalizeResult(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (res.data && Array.isArray(res.data.data)) return res.data.data;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

export function normalizeObject(res, fallback = null) {
  if (res === null || res === undefined) return fallback;
  if (Array.isArray(res)) return res[0] || fallback;
  if (typeof res === 'object') {
    if (res.success === false) return fallback;
    if (res.data !== undefined) {
      if (res.data && typeof res.data === 'object' && res.data.data !== undefined) {
        return res.data.data || fallback;
      }
      return res.data;
    }
    return res;
  }
  return fallback;
}

// ============================================================
//   EXTRACT ID (multi-level)
// ============================================================
export function extractId(result) {
  if (!result) return null;

  const candidates = [
    result.id,
    result.pesertaId,
    result.newId,
    result.rowIndex,
    result.data?.id,
    result.data?.pesertaId,
    result.data?.newId,
    result.data?.rowIndex,
    result.data?.data?.id,
    result.data?.data?.pesertaId,
    result.result?.id,
  ];

  for (const c of candidates) {
    if (c !== undefined && c !== null && c !== '' && c !== 0) {
      return c;
    }
  }
  return null;
}

// ============================================================
//   UTILITY: toParams
// ============================================================
function toParams(arg, key) {
  if (arg === undefined || arg === null) return {};
  if (typeof arg === 'object' && !Array.isArray(arg)) return { ...arg };
  if (key) {
    const o = {};
    o[key] = arg;
    return o;
  }
  return {};
}

// ============================================================
//   UTILITY: JSON serialize decision
// ============================================================
function shouldJsonSerialize(v) {
  if (v === null || v === undefined) return false;
  if (typeof v !== 'object') return false;
  if (v instanceof Date) return false;
  if (typeof Blob !== 'undefined' && v instanceof Blob) return false;
  if (typeof File !== 'undefined' && v instanceof File) return false;
  if (typeof FormData !== 'undefined' && v instanceof FormData) return false;
  if (typeof ArrayBuffer !== 'undefined' && v instanceof ArrayBuffer) return false;
  return true;
}

// ============================================================
//   SAFE STORAGE (in-memory fallback)
// ============================================================
const _memoryStore = new Map();

function safeLocalGet(key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* blocked */ }
  return _memoryStore.get('L:' + key) || null;
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
    _memoryStore.delete('L:' + key);
    return true;
  } catch (e) {
    _memoryStore.set('L:' + key, value);
    return false;
  }
}

function safeLocalRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* silent */ }
  _memoryStore.delete('L:' + key);
}

function safeSessionGet(key) {
  try {
    const v = sessionStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* blocked */ }
  return _memoryStore.get('S:' + key) || null;
}

function safeSessionSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
    _memoryStore.delete('S:' + key);
    return true;
  } catch (e) {
    _memoryStore.set('S:' + key, value);
    return false;
  }
}

function safeSessionRemove(key) {
  try { sessionStorage.removeItem(key); } catch (e) { /* silent */ }
  _memoryStore.delete('S:' + key);
}

// ============================================================
//   TOAST
// ============================================================
export function showToast(message, type = 'success') {
  let toastEl = document.getElementById('apiToast');

  if (!toastEl) {
    if (typeof bootstrap === 'undefined' || !bootstrap.Toast) {
      console.log(`[Toast/${type}]`, message);
      return;
    }

    const container = document.createElement('div');
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.id = 'apiToastContainer';
    container.style.zIndex = '99999';
    container.innerHTML = `
      <div id="apiToast" class="toast border-0 shadow-lg" role="alert" data-bs-delay="3000">
        <div class="toast-header bg-white border-0">
          <i class="bi me-2" id="apiToastIcon"></i>
          <strong class="me-auto" id="apiToastTitle">Berhasil</strong>
          <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Tutup"></button>
        </div>
        <div class="toast-body" id="apiToastMessage"></div>
      </div>
    `;
    document.body.appendChild(container);
    toastEl = document.getElementById('apiToast');
  }

  const msgEl = document.getElementById('apiToastMessage');
  const icon = document.getElementById('apiToastIcon');
  const title = document.getElementById('apiToastTitle');

  if (msgEl) msgEl.innerText = String(message ?? '');

  const icons = {
    success: { cls: 'bi-check-circle-fill text-success', title: 'Berhasil' },
    error:   { cls: 'bi-x-circle-fill text-danger', title: 'Gagal' },
    warning: { cls: 'bi-exclamation-triangle-fill text-warning', title: 'Peringatan' },
    info:    { cls: 'bi-info-circle-fill text-primary', title: 'Info' },
  };
  const cfg = icons[type] || icons.info;
  if (icon) icon.className = `bi ${cfg.cls}`;
  if (title) title.innerText = cfg.title;

  if (toastEl && typeof bootstrap !== 'undefined' && bootstrap.Toast) {
    try { bootstrap.Toast.getOrCreateInstance(toastEl).show(); }
    catch (e) { console.log(`[Toast/${type}]`, message); }
  }
}

// ============================================================
//   AUTH STATE MANAGEMENT
// ============================================================
export function getUserRole() { return userRole; }
export function getUserData() { return userData; }
export function setUserRole(role) { userRole = role; }
export function setUserData(data) { userData = data || {}; }

export function persistAuthState() {
  const state = { role: userRole, data: userData };
  const serialized = JSON.stringify(state);
  safeSessionSet(AUTH_STORAGE_KEY, serialized);
  safeLocalSet(AUTH_STORAGE_KEY, serialized);
}

export function loadAuthState() {
  let serialized = safeSessionGet(AUTH_STORAGE_KEY);
  if (!serialized) serialized = safeLocalGet(AUTH_STORAGE_KEY);

  if (serialized) {
    try {
      const state = JSON.parse(serialized);
      userRole = state.role || null;
      userData = state.data || {};
    } catch (e) {
      console.warn('[API] loadAuthState parse error:', e);
      userRole = null;
      userData = {};
    }
  }

  try { updateNavbarMenu(); } catch (e) { /* silent */ }
  return { role: userRole, data: userData };
}

export function logout() {
  userRole = null;
  userData = {};

  safeSessionRemove(AUTH_STORAGE_KEY);
  safeLocalRemove(AUTH_STORAGE_KEY);

  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith(CACHE_PREFIX) || key.startsWith('pkd_member_cache_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => safeLocalRemove(k));
  } catch (e) { /* silent */ }

  safeSessionRemove('pkd_filter_lokasi');
  safeSessionRemove('pkd_filter_angkatan');

  window.location.href = BASE_PATH + 'index.html';
}

// ============================================================
//   NAVBAR MENU
// ============================================================
export function updateNavbarMenu() {
  const menu = document.getElementById('navbarUserMenu');
  if (!menu) return;

  let html = '';

  if (userRole === 'admin') {
    html = `
      <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
        <i class="bi bi-shield-fill me-1"></i>Admin
      </span>
      <div class="dropdown">
        <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
          <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Admin')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item" href="${BASE_PATH}app.html#/admin/dashboard">
            <i class="bi bi-gear-wide me-2"></i>Dashboard
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item" id="apiLogoutBtn" type="button">
            <i class="bi bi-box-arrow-right me-2"></i>Logout
          </button></li>
        </ul>
      </div>`;
  } else if (userRole === 'ketua_pac') {
    html = `
      <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
        <i class="bi bi-person-badge me-1"></i>Ketua PAC
      </span>
      <div class="dropdown">
        <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
          <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Ketua PAC')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item" href="${BASE_PATH}ketua_pac.html">
            <i class="bi bi-gear-wide me-2"></i>Dashboard
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item" id="apiLogoutBtn" type="button">
            <i class="bi bi-box-arrow-right me-2"></i>Logout
          </button></li>
        </ul>
      </div>`;
  } else if (userRole === 'member') {
    html = `
      <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
        <i class="bi bi-person-circle me-1"></i>Member
      </span>
      <div class="dropdown">
        <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
          <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Member')}
        </button>
        <ul class="dropdown-menu dropdown-menu-end">
          <li><a class="dropdown-item" href="${BASE_PATH}member.html">
            <i class="bi bi-speedometer2 me-2"></i>Dashboard
          </a></li>
          <li><hr class="dropdown-divider"></li>
          <li><button class="dropdown-item" id="apiLogoutBtn" type="button">
            <i class="bi bi-box-arrow-right me-2"></i>Logout
          </button></li>
        </ul>
      </div>`;
  } else {
    html = `
      <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
        <i class="bi bi-person-circle me-1"></i>Guest
      </span>
      <button class="btn btn-outline-primary rounded-pill px-4" id="apiLoginBtn" type="button">
        Login
      </button>`;
  }

  menu.innerHTML = html;

  document.getElementById('apiLogoutBtn')?.addEventListener('click', function (e) {
    e.preventDefault();
    logout();
  });
  document.getElementById('apiLoginBtn')?.addEventListener('click', function () {
    window.location.href = BASE_PATH + 'login.html';
  });
}

// ============================================================
//   ⭐ CORE API CALL — v28.2.0
// ============================================================
export function callApi(action, params = {}, method = 'GET', timeout = DEFAULT_TIMEOUT_MS) {
  method = String(method || 'GET').toUpperCase();

  // Cek online
  if (!isOnline()) {
    return Promise.resolve({
      success: false,
      error: 'Browser sedang offline. Periksa koneksi internet Anda.',
      _offline: true,
    });
  }

  // Cek SCRIPT_URL valid
  if (!isScriptUrlValid()) {
    console.error('[API] ❌ SCRIPT_URL tidak valid, cek js/core/config.js');
    return Promise.resolve({
      success: false,
      error: 'Konfigurasi server tidak valid. Hubungi admin.',
      _configError: true,
    });
  }

  // Circuit breaker
  if (_isCircuitOpen()) {
    const remaining = Math.max(0, _circuit.COOLDOWN_MS - (Date.now() - _circuit.openedAt));
    return Promise.resolve({
      success: false,
      error: `Server sibuk — coba lagi dalam ${Math.ceil(remaining / 1000)}s`,
      _circuitOpen: true,
      _retryAfterMs: remaining,
    });
  }

  const dedupParams = { ...params };
  delete dedupParams._t;
  delete dedupParams._nocache;

  const useDedup = (method === 'GET');
  const dedupeKey = useDedup
    ? `${method}:${action}:${JSON.stringify(dedupParams)}`
    : null;

  if (useDedup && pendingRequests.has(dedupeKey)) {
    return pendingRequests.get(dedupeKey);
  }

  const promise = new Promise((resolve) => {
    try {
      const cleanParams = {};
      Object.keys(params || {}).forEach(key => {
        const val = params[key];
        if (val === undefined || val === null) return;

        if (val instanceof Date) {
          cleanParams[key] = val.toISOString();
        } else if (shouldJsonSerialize(val)) {
          cleanParams[key] = JSON.stringify(val);
        } else {
          cleanParams[key] = val;
        }
      });

      const activeUrl = getActiveScriptUrl();
      let url = activeUrl;
      let fetchOptions;

      if (method === 'GET') {
        const qs = new URLSearchParams({ action, ...cleanParams }).toString();
        url += '?' + qs;
        fetchOptions = {
          method: 'GET',
          mode: 'cors',
          redirect: 'follow',
          credentials: 'omit',
          cache: 'no-store',
          headers: { 'Accept': 'application/json' },
        };
      } else {
        const body = new URLSearchParams({ action, ...cleanParams }).toString();
        fetchOptions = {
          method: 'POST',
          mode: 'cors',
          redirect: 'follow',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body,
        };
      }

      // ⭐ Retry semua GET (resilient)
      const retries = (method === 'GET') ? MAX_RETRY : 0;

      _fetchWithRetry(url, fetchOptions, timeout, retries)
        .then(response => {
          if (response && response.success) {
            _recordSuccess();
          } else if (response && response.error) {
            const errorType = _classifyError(response.error);
            _recordFailure(errorType);
          }
          resolve(response);
        })
        .catch(err => {
          const errorType = _classifyError(err.message);
          _recordFailure(errorType);
          resolve({
            success: false,
            error: err.message || 'Unknown error',
            _errorType: errorType,
          });
        });
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });

  if (useDedup) {
    pendingRequests.set(dedupeKey, promise);
    promise.finally(() => {
      setTimeout(() => pendingRequests.delete(dedupeKey), DEDUP_WINDOW_MS);
    });
  }

  return promise;
}

// ============================================================
//   FETCH WITH RETRY (Exponential Backoff)
// ============================================================
async function _fetchWithRetry(url, options, timeout, maxRetry) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const result = await _fetchOnce(url, options, timeout);

      if (!result._httpError || !result._retryable) {
        return result;
      }

      lastError = new Error(result.error);
      if (attempt < maxRetry) {
        const delay = 500 * Math.pow(2, attempt);
        console.warn(`[API] HTTP error, retry ${attempt + 1}/${maxRetry} in ${delay}ms`);
        await _sleep(delay);
        continue;
      }
    } catch (e) {
      lastError = e;
      if (attempt < maxRetry) {
        const delay = 500 * Math.pow(2, attempt);
        console.warn(`[API] Network error, retry ${attempt + 1}/${maxRetry} in ${delay}ms:`, e.message);
        await _sleep(delay);
        continue;
      }
    }
  }

  throw lastError || new Error('Request failed after retries');
}

// ============================================================
//   FETCH ONCE
// ============================================================
function _fetchOnce(url, options, timeout) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, timeout);

    const startTime = Date.now();

    fetch(url, { ...options, signal: controller.signal })
      .then(response => {
        clearTimeout(timeoutId);

        if (!response.ok) {
          const retryable = response.status >= 500 && response.status < 600;
          return response.text().then(text => {
            console.warn('[API] HTTP', response.status, '→', text.substring(0, 200));
            resolve({
              success: false,
              error: `Server Error (${response.status}). Coba lagi dalam beberapa saat.`,
              _httpError: true,
              _retryable: retryable,
            });
          });
        }

        return response.text().then(text => {
          if (!text || text.trim() === '') {
            return resolve({ success: true, data: [] });
          }

          const trimmed = text.trim();

          // Detect HTML response
          if (trimmed.startsWith('<') || trimmed.toLowerCase().includes('<html')) {
            if (text.includes('accounts.google.com') || text.includes('Sign in')) {
              console.error('[API] ❌ GAS deployment BUKAN "Anyone"');
              return resolve({
                success: false,
                error: 'Deployment GAS belum di-set "Anyone". Buka GAS → Deploy → Manage Deployments → Who has access → "Anyone".',
                _configError: true,
              });
            }
            return resolve({
              success: false,
              error: 'Server mengembalikan HTML, bukan JSON. Cek deployment GAS.',
              _configError: true,
            });
          }

          try {
            const data = JSON.parse(text);

            if (data && typeof data === 'object' && !Array.isArray(data)) {
              if (data.success === undefined) {
                resolve({ success: true, data });
              } else {
                resolve(data);
              }
            } else {
              resolve({ success: true, data });
            }
          } catch (parseErr) {
            console.error('[API] JSON parse error:', parseErr.message);
            resolve({
              success: false,
              error: `JSON parse error: ${parseErr.message}`,
              _parseError: true,
            });
          }
        });
      })
      .catch(err => {
        clearTimeout(timeoutId);
        const elapsed = Date.now() - startTime;

        if (err.name === 'AbortError') {
          reject(new Error(`Request timeout (${elapsed}ms). Server tidak merespons.`));
        } else if (err.name === 'TypeError' && err.message && err.message.includes('Failed to fetch')) {
          reject(new Error(
            'CORS_ERROR: Gagal terhubung ke server. ' +
            'Kemungkinan: (1) Deployment GAS belum "Anyone", ' +
            '(2) Koneksi internet bermasalah, (3) Server sedang throttle.'
          ));
        } else {
          reject(new Error(err.message || 'Network error'));
        }
      });
  });
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//   FETCH WITH CACHE
// ============================================================
export async function fetchWithCache(action, params = {}, cacheKey, cacheAgeMinutes = 30, forceRefresh = false) {
  if (!cacheKey) return await callApi(action, params, 'GET');

  const fullKey = CACHE_PREFIX + cacheKey;
  const now = Date.now();
  let cached = null;

  try {
    const item = safeLocalGet(fullKey);
    if (item) {
      const parsed = JSON.parse(item);
      if (parsed && (now - parsed.timestamp) < cacheAgeMinutes * 60 * 1000) {
        cached = parsed.data;
      } else {
        safeLocalRemove(fullKey);
      }
    }
  } catch (e) { /* silent */ }

  if (!forceRefresh && cached !== null) return cached;

  try {
    const res = await callApi(action, params, 'GET');
    let data = (res && res.data !== undefined) ? res.data : res;
    if (data === undefined || data === null) data = [];

    safeLocalSet(fullKey, JSON.stringify({ data, timestamp: now }));
    return data;
  } catch (e) {
    if (cached !== null) return cached;
    throw e;
  }
}

// ============================================================
//   GUARD PUBLIC ACCESS
// ============================================================
let _loginModeCache = { value: null, timestamp: 0 };
const LOGIN_MODE_CACHE_MS = 30000;

export async function guardPublicAccess() {
  if (userRole) return true;

  try {
    let enabled = false;
    const now = Date.now();

    if (_loginModeCache.value !== null && (now - _loginModeCache.timestamp) < LOGIN_MODE_CACHE_MS) {
      enabled = _loginModeCache.value;
    } else {
      const modeRes = await getLoginMode();
      enabled = !!(modeRes && modeRes.success && modeRes.enabled);
      _loginModeCache = { value: enabled, timestamp: now };
    }

    if (enabled) {
      const redirect = window.location.pathname + window.location.search;
      window.location.href = BASE_PATH + 'login.html?redirect=' + encodeURIComponent(redirect);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[API] guardPublicAccess check failed, allowing access:', e);
    return true;
  }
}

// ============================================================
//   DEFAULT FORM FIELDS
// ============================================================
export function getDefaultFormFields() {
  return [
    { id: 'nama_lengkap', label: 'Nama Lengkap', type: 'text', options: '', required: true, isCore: true },
    { id: 'tempat_tgl_lahir', label: 'Tempat & Tanggal Lahir', type: 'text', options: '', required: true, isCore: true },
    { id: 'pekerjaan', label: 'Pekerjaan', type: 'text', options: '', required: true, isCore: true },
    { id: 'pendidikan_terakhir', label: 'Pendidikan Terakhir', type: 'text', options: '', required: true, isCore: true },
    { id: 'alamat', label: 'Alamat', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'no_hp', label: 'No HP', type: 'text', options: '', required: true, isCore: true },
    { id: 'email', label: 'Email', type: 'text', options: '', required: true, isCore: true },
    { id: 'utusan', label: 'Utusan (PAC)', type: 'select', options: 'PAC Bantul,PAC Banguntapan,PAC Sewon,PAC Kasihan,PAC Pajangan,PAC Sedayu,PAC Pandak,PAC Piyungan,PAC Pleret,PAC Jetis,PAC Imogiri,PAC Dlingo,PAC Bambanglipuro,PAC Sanden,PAC Kretek,PAC Pundong,PAC Srandakan,Lainnya', required: true, isCore: true },
    { id: 'pengalaman_organisasi', label: 'Pengalaman Organisasi', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'foto', label: 'Foto', type: 'file', options: '', required: true, isCore: true },
    { id: 'surat_rekomendasi', label: 'Surat Rekomendasi', type: 'file', options: '', required: false, isCore: true },
  ];
}

// ============================================================
//   DATE/TIME HELPERS
// ============================================================
export function formatDateID(dateInput, opts) {
  if (!dateInput) return '-';
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', opts || {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch (e) { return '-'; }
}

export function formatDateTimeID(dateInput) {
  if (!dateInput) return '-';
  try {
    const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) { return '-'; }
}

export function getLocalDateOnly(dateInput) {
  if (dateInput === null || dateInput === undefined) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function timeSinceID(dateInput) {
  if (!dateInput) return '';
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return secs + ' dtk lalu';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + ' mnt lalu';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' jam lalu';
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + ' hr lalu';
  const months = Math.floor(days / 30);
  if (months < 12) return months + ' bln lalu';
  return Math.floor(months / 12) + ' thn lalu';
}

// ============================================================
//   FILE HELPERS
// ============================================================
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('File kosong'));
    if (file.size === 0) return reject(new Error('File kosong (0 byte)'));
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (!r || typeof r !== 'string') return reject(new Error('Hasil baca file tidak valid'));
      resolve(r);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

export function uploadToDrive(token, file, fileNameOverride) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('File kosong'));
    if (!token) return reject(new Error('Token tidak tersedia'));

    const formData = new FormData();
    formData.append(
      'metadata',
      new Blob([JSON.stringify({ name: fileNameOverride || file.name })], { type: 'application/json' })
    );
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.timeout = 120000;

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error('Respons Drive tidak valid')); }
      } else {
        reject(new Error(`Upload Drive gagal (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error saat upload ke Drive'));
    xhr.ontimeout = () => reject(new Error('Upload Drive timeout'));
    xhr.send(formData);
  });
}

// ============================================================
//   DOWNLOAD HELPERS
// ============================================================
export function downloadJSON(data, filename) {
  try {
    const json = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `export_${getLocalDateOnly(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    console.error('[downloadJSON]', e);
    return false;
  }
}

export function downloadCSV(rows, headers, filename) {
  try {
    const headerLine = headers.map(h => `"${String(h).replace(/"/g, '""')}"`).join(',');
    const dataLines = rows.map(row =>
      row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csv = '\uFEFF' + [headerLine, ...dataLines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || `export_${getLocalDateOnly(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    console.error('[downloadCSV]', e);
    return false;
  }
}

export function getAppVersion() {
  return APP_VERSION;
}

// ============================================================
//   DIAGNOSTIC HELPERS
// ============================================================
export async function healthCheck() {
  return await callApi('health', {}, 'GET', HEALTH_TIMEOUT_MS);
}

export async function ping() {
  return await callApi('ping', {}, 'GET', HEALTH_TIMEOUT_MS);
}

export async function testConnection() {
  try {
    const res = await callApi('ping', {}, 'GET', HEALTH_TIMEOUT_MS);
    return res && res.success === true;
  } catch (e) {
    return false;
  }
}

// ============================================================
//   AUTHENTICATION
// ============================================================
export function verifyAdmin(username, password) { return callApi('verifyAdmin', { username, password }, 'GET'); }
export function verifyKetuaPAC(username, password) { return callApi('verifyKetuaPAC', { username, password }, 'GET'); }
export function verifyMember(username, password) { return callApi('verifyMember', { username, password }, 'GET'); }
export function updateAdminPassword(username, newPassword) { return callApi('updateAdminPassword', { username, newPassword }, 'POST'); }

// ============================================================
//   PESERTA
// ============================================================
export function getPesertaList(statusOrParams) { return callApi('getPesertaList', toParams(statusOrParams, 'status'), 'GET'); }
export function submitPeserta(data) { return callApi('submitPeserta', data, 'POST'); }
export function updatePeserta(data) { return callApi('updatePeserta', data, 'POST'); }
export function deletePeserta(id) { return callApi('deletePeserta', { id }, 'POST'); }
export function approvePeserta(id) { return callApi('approvePeserta', { id }, 'POST'); }
export function rejectPeserta(id) { return callApi('rejectPeserta', { id }, 'POST'); }
export function getPesertaById(id) { return callApi('getPesertaById', { id }, 'GET'); }
export function getPesertaCredentials(id) { return callApi('getPesertaCredentials', { id }, 'GET'); }
export function resetPesertaPassword(id, newPassword) { return callApi('resetPesertaPassword', { id, newPassword }, 'POST'); }
export function getTotalPeserta() { return callApi('getTotalPeserta', {}, 'GET'); }
export function getAlumniList() { return callApi('getAlumniList', {}, 'GET'); }
export function moveToAlumni(id) { return callApi('moveToAlumni', { id }, 'POST'); }
export function moveMultipleToAlumni(ids) { return callApi('moveMultipleToAlumni', { ids }, 'POST'); }
export function moveBackToActive(id) { return callApi('moveBackToActive', { id }, 'POST'); }

// ============================================================
//   SESI ABSEN
// ============================================================
export function getSesiAbsen() { return callApi('getSesiAbsen', {}, 'GET'); }

export function addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) {
  return callApi('addSesiAbsen', {
    nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password,
  }, 'POST');
}

export function updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) {
  return callApi('updateSesiAbsen', {
    id, nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password,
  }, 'POST');
}

export function deleteSesiAbsen(id) { return callApi('deleteSesiAbsen', { id }, 'POST'); }
export function regenerateQRSesi(id) { return callApi('regenerateQRSesi', { id }, 'POST'); }
export function toggleAttendanceSession(id, open) { return callApi('toggleAttendanceSession', { id, open }, 'POST'); }
export function getAttendanceSessionStatus(id) { return callApi('getAttendanceSessionStatus', { id }, 'GET'); }

// ============================================================
//   ABSENSI
// ============================================================
export function submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
  return callApi('submitAbsen', {
    nama, sesiId, tandaTangan, password, qrToken, pesertaId,
  }, 'POST');
}

export function getAbsensiResponses() { return callApi('getAbsensiResponses', {}, 'GET'); }
export function getAttendanceBySesi(sesiId) { return callApi('getAttendanceBySesi', { sesiId }, 'GET'); }
export function deleteAbsensi(params) { return callApi('deleteAbsensi', params, 'POST'); }
export function getAttendanceMatrix() { return callApi('getAttendanceMatrix', {}, 'GET'); }
export function exportAttendanceMatrixCSV() { return callApi('exportAttendanceMatrixCSV', {}, 'GET'); }

// ============================================================
//   MATERI
// ============================================================
export function getMateriList() { return callApi('getMateriList', {}, 'GET'); }
export function addMateri(judul, deskripsi, file, fileName, uploadBy) {
  return callApi('addMateri', { judul, deskripsi, file, fileName, uploadBy }, 'POST');
}
export function updateMateri(params) { return callApi('updateMateri', params, 'POST'); }
export function deleteMateri(id, fileId) { return callApi('deleteMateri', { id, fileId }, 'POST'); }

// ============================================================
//   SKRINING
// ============================================================
export function getSkriningQuestions() { return callApi('getSkriningQuestions', {}, 'GET'); }
export function addSkriningQuestion(params) { return callApi('addSkriningQuestion', params, 'POST'); }
export function updateSkriningQuestion(params) { return callApi('updateSkriningQuestion', params, 'POST'); }
export function deleteSkriningQuestion(id) { return callApi('deleteSkriningQuestion', { id }, 'POST'); }
export function submitSkrining(params) { return callApi('submitSkrining', params, 'POST'); }
export function getSkriningResponses() { return callApi('getSkriningResponses', {}, 'GET'); }
export function updateSkriningResponse(params) { return callApi('updateSkriningResponse', params, 'POST'); }
export function deleteSkriningResponse(id) { return callApi('deleteSkriningResponse', { id }, 'POST'); }

// ============================================================
//   PRETEST
// ============================================================
export function getPretestQuestions() { return callApi('getPretestQuestions', {}, 'GET'); }
export function addPretestQuestion(params) { return callApi('addPretestQuestion', params, 'POST'); }
export function updatePretestQuestion(params) { return callApi('updatePretestQuestion', params, 'POST'); }
export function deletePretestQuestion(id) { return callApi('deletePretestQuestion', { id }, 'POST'); }
export function submitPretest(nama, nohp, alamat, answers, score) {
  return callApi('submitPretest', { nama, nohp, alamat, answers, score }, 'POST');
}
export function getPretestResponses() { return callApi('getPretestResponses', {}, 'GET'); }

// ============================================================
//   POSTTEST
// ============================================================
export function getPosttestQuestions() { return callApi('getPosttestQuestions', {}, 'GET'); }
export function addPosttestQuestion(params) { return callApi('addPosttestQuestion', params, 'POST'); }
export function updatePosttestQuestion(params) { return callApi('updatePosttestQuestion', params, 'POST'); }
export function deletePosttestQuestion(id) { return callApi('deletePosttestQuestion', { id }, 'POST'); }
export function submitPosttest(nama, nohp, alamat, answers, score) {
  return callApi('submitPosttest', { nama, nohp, alamat, answers, score }, 'POST');
}
export function getPosttestResponses() { return callApi('getPosttestResponses', {}, 'GET'); }

// ============================================================
//   KADER
// ============================================================
export function getKaderList() { return callApi('getKaderList', {}, 'GET'); }
export function addKader(params) { return callApi('addKader', params, 'POST'); }
export function updateKader(params) { return callApi('updateKader', params, 'POST'); }
export function deleteKader(id) { return callApi('deleteKader', { id }, 'POST'); }

// ============================================================
//   INFORMASI & USULAN
// ============================================================
export function getInfoList() { return callApi('getInfoList', {}, 'GET'); }
export function addInfo(params) { return callApi('addInfo', params, 'POST'); }
export function updateInfo(params) { return callApi('updateInfo', params, 'POST'); }
export function deleteInfo(id) { return callApi('deleteInfo', { id }, 'POST'); }
export function toggleInfoStatus(id) { return callApi('toggleInfoStatus', { id }, 'POST'); }
export function getUsulanList() { return callApi('getUsulanList', {}, 'GET'); }
export function submitUsulan(params) { return callApi('submitUsulan', params, 'POST'); }
export function updateUsulanStatus(id, status) { return callApi('updateUsulanStatus', { id, status }, 'POST'); }

// ============================================================
//   ASET DIGITAL & FOLDERS
// ============================================================
export function getAssetList() { return callApi('getAssetList', {}, 'GET'); }
export function addAsset(params) { return callApi('addAsset', params, 'POST'); }
export function updateAsset(params) { return callApi('updateAsset', params, 'POST'); }
export function deleteAsset(id) { return callApi('deleteAsset', { id }, 'POST'); }
export function getFolders(params) { return callApi('getFolders', params || {}, 'GET'); }
export function addFolder(nama, parentId) { return callApi('addFolder', { nama, parentId }, 'POST'); }
export function deleteFolder(id) { return callApi('deleteFolder', { id }, 'POST'); }
export function toggleFolderPublic(params) { return callApi('toggleFolderPublic', params, 'POST'); }
export function toggleFolderHideFromGallery(params) { return callApi('toggleFolderHideFromGallery', params, 'POST'); }
export function setFolderPassword(params) { return callApi('setFolderPassword', params, 'POST'); }
export function clearFolderPassword(params) { return callApi('clearFolderPassword', params, 'POST'); }
export function verifyFolderPassword(params) { return callApi('verifyFolderPassword', params, 'GET'); }
export function getAssetPublicConfig() { return callApi('getAssetPublicConfig', {}, 'GET'); }
export function verifyAssetPublicPassword(params) { return callApi('verifyAssetPublicPassword', params, 'GET'); }
export function setAssetPublicPassword(params) { return callApi('setAssetPublicPassword', params, 'POST'); }
export function publishAllAssetsToPublic() { return callApi('publishAllAssetsToPublic', {}, 'POST'); }

// ============================================================
//   DRIVE TOKEN
// ============================================================
export function getDriveToken() { return callApi('getDriveToken', {}, 'GET'); }

// ============================================================
//   SERTIFIKAT
// ============================================================
export function getUploadedCertificates() { return callApi('getUploadedCertificates', {}, 'GET'); }
export function getCertificateTemplates() { return callApi('getCertificateTemplates', {}, 'GET'); }
export function addCertificateTemplateManual(params) { return callApi('addCertificateTemplateManual', params, 'POST'); }
export function updateCertificateTemplate(params) { return callApi('updateCertificateTemplate', params, 'POST'); }
export function deleteCertificateTemplate(id) { return callApi('deleteCertificateTemplate', { id }, 'POST'); }
export function generateCertificateForParticipant(templateId, pesertaId) {
  return callApi('generateCertificateForParticipant', { templateId, pesertaId }, 'POST');
}
export function generateCertificates(params) { return callApi('generateCertificates', params, 'POST'); }
export function uploadManualCertificate(params) { return callApi('uploadManualCertificate', params, 'POST'); }
export function deleteCertificate(id) { return callApi('deleteCertificate', { id }, 'POST'); }
export function getCertPresets() { return callApi('getCertPresets', {}, 'GET'); }
export function addCertPreset(params) { return callApi('addCertPreset', params, 'POST'); }
export function updateCertPreset(params) { return callApi('updateCertPreset', params, 'POST'); }
export function deleteCertPreset(id) { return callApi('deleteCertPreset', { id }, 'POST'); }
export function listCertificateLayouts() { return callApi('listCertificateLayouts', {}, 'GET'); }
export function saveCertificateLayout(nama, data_json, id) {
  return callApi('saveCertificateLayout', { nama, data_json, id }, 'POST');
}
export function getCertificateLayout(identifier) {
  const p = (typeof identifier === 'object') ? identifier : { nama: identifier };
  return callApi('getCertificateLayout', p, 'GET');
}
export function verifyCertificate(nomor) { return callApi('verifyCertificate', { nomor }, 'GET'); }
export function getNextCertificateNumber() { return callApi('getNextCertificateNumber', {}, 'GET'); }

// ============================================================
//   TANDA TANGAN DIGITAL
// ============================================================
export function getAllDigitalApprovals() { return callApi('getAllDigitalApprovals', {}, 'GET'); }
export function bulkGenerateTTD(params) { return callApi('bulkGenerateTTD', params || {}, 'POST'); }

export function submitDigitalSignature(role, nama, signature, password, peserta_nama, kegunaan) {
  return callApi('submitDigitalSignature', {
    role, nama, signature, password, peserta_nama, kegunaan,
  }, 'POST');
}

export function getDigitalApproval(role) { return callApi('getDigitalApproval', { role }, 'GET'); }
export function deleteDigitalApprovalByPeserta(peserta_nama) {
  return callApi('deleteDigitalApprovalByPeserta', { peserta_nama }, 'POST');
}
export function getSignPasswords() { return callApi('getSignPasswords', {}, 'GET'); }
export function updateSignPassword(role, newPassword) {
  return callApi('updateSignPassword', { role, newPassword }, 'POST');
}
export function verifySignPassword(role, password) { return callApi('verifySignPassword', { role, password }, 'POST'); }

export function bulkSignForRole(role, nama, signature, password, filterPac, kegunaan) {
  return callApi('bulkSignForRole', {
    role, nama, signature, password,
    filterPac: filterPac || '',
    kegunaan: kegunaan || 'Untuk verifikasi sertifikat PKD',
  }, 'POST');
}

export function getSignatureOrderStatus() { return callApi('getSignatureOrderStatus', {}, 'GET'); }

// ============================================================
//   TIM INSTRUKTUR
// ============================================================
export function getTimInstrukturList() { return callApi('getTimInstrukturList', {}, 'GET'); }
export function addTimInstruktur(params) { return callApi('addTimInstruktur', params, 'POST'); }
export function updateTimInstruktur(params) { return callApi('updateTimInstruktur', params, 'POST'); }
export function deleteTimInstruktur(id) { return callApi('deleteTimInstruktur', { id }, 'POST'); }
export function reorderTimInstruktur(orders) { return callApi('reorderTimInstruktur', { orders }, 'POST'); }

// ============================================================
//   RTL
// ============================================================
export function getRTLTasks(pesertaIdOrParams) { return callApi('getRTLTasks', toParams(pesertaIdOrParams, 'pesertaId'), 'GET'); }
export function addRTLTask(params) { return callApi('addRTLTask', params, 'POST'); }
export function updateRTLTask(params) { return callApi('updateRTLTask', params, 'POST'); }
export function deleteRTLTask(id) { return callApi('deleteRTLTask', { id }, 'POST'); }
export function approveRTLTask(id) { return callApi('approveRTLTask', { id }, 'POST'); }
export function approveAllRTL(pesertaIdOrParams) { return callApi('approveAllRTL', toParams(pesertaIdOrParams, 'pesertaId'), 'POST'); }
export function getRTLStatus(pesertaIdOrParams) { return callApi('getRTLStatus', toParams(pesertaIdOrParams, 'pesertaId'), 'GET'); }
export function submitRTLAttachment(taskId, fileData, fileName) {
  return callApi('submitRTLAttachment', { taskId, fileData, fileName }, 'POST');
}
export function getRTLAttachments(taskId) { return callApi('getRTLAttachments', { taskId }, 'GET'); }

// ============================================================
//   ANGKATAN PKD
// ============================================================
export function getAngkatanPKDList() {
  return callApi('getAngkatanPKDList', {}, 'GET');
}

export function getAngkatanPKDWithCount() {
  return callApi('getAngkatanPKDWithCount', {}, 'GET');
}

export function getAngkatanDetail(namaOrId) {
  const params = {};
  const str = String(namaOrId || '').trim();

  if (/^\d+$/.test(str)) {
    params.id = str;
    params.lokasiId = str;
  } else {
    params.nama = str;
  }

  return callApi('getAngkatanDetail', params, 'GET');
}

export function addAngkatanPKD(nama, tahun, status, lokasi, tglMulai, tglSelesai) {
  return callApi('addAngkatanPKD', {
    nama: String(nama || '').trim(),
    tahun: tahun || new Date().getFullYear(),
    status: status || 'aktif',
    lokasi: lokasi || String(nama || '').trim(),
    tanggal_mulai: tglMulai || '',
    tanggal_selesai: tglSelesai || '',
  }, 'POST');
}

export function updateAngkatanPKD(data) {
  return callApi('updateAngkatanPKD', data, 'POST');
}

export function deleteAngkatanPKD(id) {
  return callApi('deleteAngkatanPKD', { id }, 'POST');
}

// Legacy alias
export const getLokasiPKDList = getAngkatanPKDList;
export const getLokasiPKDWithCount = getAngkatanPKDWithCount;
export const addLokasiPKD = (nama) => addAngkatanPKD(nama);
export const deleteLokasiPKD = deleteAngkatanPKD;

// ============================================================
//   MEMBER
// ============================================================
export function getMemberData(username) { return callApi('getMemberData', { username }, 'GET'); }
export function updateMemberProfile(username, data) { return callApi('updateMemberProfile', { username, ...data }, 'POST'); }
export function getMemberSkrining(params) { return callApi('getMemberSkrining', params, 'GET'); }
export function getMemberAbsensi(params) { return callApi('getMemberAbsensi', params, 'GET'); }
export function getMemberSertifikat(params) { return callApi('getMemberSertifikat', params, 'GET'); }
export function getMemberUsername(params) { return callApi('getMemberUsername', params, 'GET'); }
export function verifyMemberForgot(params) { return callApi('verifyMemberForgot', params, 'GET'); }
export function resetMemberPassword(params) { return callApi('resetMemberPassword', params, 'POST'); }

// ============================================================
//   PENGATURAN
// ============================================================
export function getQuizSettings() { return callApi('getQuizSettings', {}, 'GET'); }
export function setQuizSettings(params) { return callApi('setQuizSettings', params, 'POST'); }
export function saveQuizSettings(params) { return callApi('saveQuizSettings', params, 'POST'); }
export function getLoginMode() { return callApi('getLoginMode', {}, 'GET'); }
export function setLoginMode(enabled) { return callApi('setLoginMode', { enabled }, 'POST'); }
export function getPublicVisibility() { return callApi('getPublicVisibility', {}, 'GET'); }
export function setPublicVisibility(data) { return callApi('setPublicVisibility', { data }, 'POST'); }
export function getPKDLokasi() { return callApi('getPKDLokasi', {}, 'GET'); }
export function setPKDLokasi(lokasi) { return callApi('setPKDLokasi', { lokasi }, 'POST'); }
export function getFormSettings() { return callApi('getFormSettings', {}, 'GET'); }
export function setFormSettings(fields) { return callApi('setFormSettings', { fields }, 'POST'); }
export function getRealtimeSetting() { return callApi('getRealtimeSetting', {}, 'GET'); }
export function setRealtimeSetting(enabled) { return callApi('setRealtimeSetting', { enabled }, 'POST'); }
export function getDashboardStats() { return callApi('getDashboardStats', {}, 'GET'); }

// ============================================================
//   KONTAK
// ============================================================
export function submitKontak(nama, email, pesan, username, role, ip) {
  return callApi('submitKontak', { nama, email, pesan, username, role, ip }, 'POST');
}

// ============================================================
//   MIGRATION
// ============================================================
export function migrateSettingsBooleans() { return callApi('migrateSettingsBooleans', {}, 'POST'); }

// ============================================================
//   PASSWORD DIAGNOSTICS
// ============================================================
export function debugVerifyPassword(username, password) {
  return callApi('debugVerifyPassword', { username, password }, 'GET');
}
export function auditAllPasswords() { return callApi('auditAllPasswords', {}, 'GET'); }
export function repairHashes(params) { return callApi('repairHashes', params, 'POST'); }

// ============================================================
//   CONVENIENCE HELPERS
// ============================================================
export async function getSesiAbsenById(id) {
  const res = await getSesiAbsen();
  const list = Array.isArray(res) ? res : (res?.data || []);
  return list.find(s => String(s.id) === String(id)) || null;
}

export async function getPesertaByStatus(status) {
  return await getPesertaList({ status });
}

export function unreadNotifCount() {
  try {
    const raw = safeLocalGet('pkd_notif_read_ids');
    if (!raw) return 0;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch (e) { return 0; }
}

// ============================================================
//   AUTO-INIT
// ============================================================
if (typeof document !== 'undefined') {
  try { loadAuthState(); }
  catch (e) { console.warn('[API] Auto-init loadAuthState failed:', e); }
}

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  `%c API v28.2.0 — Connection Resilience Edition `,
  'background:#16a34a;color:#fff;padding:4px 8px;border-radius:4px;font-weight:600;'
);
console.log(
  `%c 💡 Retry 3x backoff | Offline detect | healthCheck() | testConnection() `,
  'background:#0f172a;color:#fbbf24;padding:2px 6px;border-radius:4px;font-weight:600;'
);
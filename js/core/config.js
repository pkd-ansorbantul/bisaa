// ============================================================
// js/core/config.js — v26.2.0 CONNECTION RESILIENCE EDITION
// ============================================================
// CHANGELOG v26.2.0 (dari v26.1.9):
//   ✅ NEW: isScriptUrlValid(), isOnline(), getActiveScriptUrl()
//   ✅ NEW: FALLBACK_SCRIPT_URL untuk redundancy
//   ✅ NEW: STARTUP_TIMEOUT_MS (15s) & HEALTH_TIMEOUT_MS (8s)
//   ✅ FIX: Validasi config saat boot dengan logging jelas
//   ✅ FIX: MAX_RETRY 2 → 3 untuk resiliency
//   ✅ KEEP: Semua config dari v26.1.9
// ============================================================

// ============================================================
//   BACKEND URL
// ============================================================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwuVzK1obgk9PDmP4hxr8CDpNcegoFlpAt9D0FI-sQxM1FQVCZCqHcfTAIa_FGwIf7Z-w/exec';

// Fallback URL (opsional — isi kalau ada deployment backup)
const FALLBACK_SCRIPT_URL = '';

// ============================================================
//   BASE PATH — FIXED /bisaa/ (GitHub Pages)
// ============================================================
const BASE_PATH = '/bisaa/';

// ============================================================
//   APP METADATA
// ============================================================
const APP_NAME        = 'PKD GP Ansor Kabupaten Bantul';
const APP_NAME_SHORT  = 'PKD GP Ansor';
const APP_SUBTITLE    = 'Kabupaten Bantul';
const APP_VERSION     = '26.2.0';
const APP_ICON        = '/bisaa/LOGOANSOR.webp';

// ============================================================
//   ENVIRONMENT DETECTION
// ============================================================
function detectEnvironment() {
  if (typeof window === 'undefined') return 'node';
  try {
    const host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return 'development';
    }
    if (host.includes('github.io')) return 'github';
    if (host.includes('netlify.app') || host.includes('netlify.com')) return 'netlify';
    if (host.includes('vercel.app')) return 'vercel';
    return 'production';
  } catch (e) {
    return 'unknown';
  }
}

const ENVIRONMENT = detectEnvironment();

// ============================================================
//   TIMEOUT & RETRY
// ============================================================
const DEFAULT_TIMEOUT_MS = 30000;
const STARTUP_TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS  = 8000;
const MAX_RETRY          = 3;

// ============================================================
//   CACHE
// ============================================================
const CACHE_PREFIX      = 'pkd_cache_';
const AUTH_STORAGE_KEY  = 'pkd_auth';

// ============================================================
//   ROUTING
// ============================================================
const DEFAULT_ROUTE = '#/admin/dashboard';
const LOGIN_PATH    = '/bisaa/login.html';

// ============================================================
//   PUBLIC PAGES REGISTRY
// ============================================================
const PUBLIC_PAGES = {
  LANDING:         'index.html',
  LOGIN:           'login.html',
  FORGOT:          'forgot_account.html',
  VERIFIKASI:      'verifikasi.html',
  VERIFIKASI_QR:   'verifikasi_qr.html',
  VERIFIKASI_SIGN: 'verifikasi_signature.html',
  PUBLIC_ASSETS:   'public_assets.html',
  ABSEN:           'absen.html',
  SKRINING:        'skrining.html',
  PRETEST:         'pretest.html',
  POSTTEST:        'posttest.html',
  MATERI:          'materi.html',
  INFORMASI:       'informasi.html',
  KADER:           'kader.html',
  ABOUT:           'about.html',
  USULAN:          'usulan_form.html',
  SIGN_KETUA_PC:   'sign_ketua_pc.html',
  SIGN_SEKRETARIS: 'sign_sekretaris.html',
  SIGN_INSTRUKTUR: 'sign_instruktur.html',
};

// ============================================================
//   CONNECTION HEALTH HELPERS
// ============================================================

export function isScriptUrlValid() {
  if (!SCRIPT_URL || typeof SCRIPT_URL !== 'string') return false;
  if (!SCRIPT_URL.startsWith('https://script.google.com/')) return false;
  if (!SCRIPT_URL.endsWith('/exec')) return false;
  return true;
}

export function isOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function getActiveScriptUrl() {
  if (isScriptUrlValid()) return SCRIPT_URL;
  if (FALLBACK_SCRIPT_URL && FALLBACK_SCRIPT_URL.startsWith('https://')) {
    console.warn('[Config] ⚠️ Primary URL invalid, using fallback');
    return FALLBACK_SCRIPT_URL;
  }
  return SCRIPT_URL;
}

// ============================================================
//   BOOT VALIDATION & LOG
// ============================================================
(function validateConfig() {
  const style  = 'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;';
  const style2 = 'color:#0f172a;font-weight:500;';

  if (!isScriptUrlValid()) {
    console.error('[Config] ❌ SCRIPT_URL tidak valid:', SCRIPT_URL);
    console.error('[Config] URL harus dimulai "https://script.google.com/" dan berakhir "/exec"');
  }

  if (BASE_PATH !== '/bisaa/') {
    console.warn('[Config] ⚠️ BASE_PATH bukan "/bisaa/" — cek deploy GitHub Pages');
  }

  if (!isOnline()) {
    console.warn('[Config] ⚠️ Browser sedang offline');
  }

  console.log(
    `%c[Config]%c ENV: ${ENVIRONMENT} | BASE_PATH: ${BASE_PATH} | v${APP_VERSION} | Online: ${isOnline() ? '✅' : '❌'}`,
    style, style2
  );
})();

// ============================================================
//   EXPORTS
// ============================================================
export {
  SCRIPT_URL,
  FALLBACK_SCRIPT_URL,
  BASE_PATH,
  ENVIRONMENT,
  APP_NAME,
  APP_NAME_SHORT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_ICON,
  DEFAULT_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  MAX_RETRY,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,
};

export default {
  SCRIPT_URL,
  FALLBACK_SCRIPT_URL,
  BASE_PATH,
  ENVIRONMENT,
  APP_NAME,
  APP_NAME_SHORT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_ICON,
  DEFAULT_TIMEOUT_MS,
  STARTUP_TIMEOUT_MS,
  HEALTH_TIMEOUT_MS,
  MAX_RETRY,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,
  isScriptUrlValid,
  isOnline,
  getActiveScriptUrl,
};
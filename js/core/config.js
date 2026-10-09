// ============================================================
// js/core/config.js — v26.1.9 GITHUB PAGES /bisaa/ EDITION
// ============================================================
// CHANGELOG v26.1.9:
//   ✅ REMOVE: buildUrl, buildPageUrl, isProduction, isDevelopment
//      (dead code — tidak dipakai di codebase)
//   ✅ REMOVE dari export: RETRY_BACKOFF_MS, DEFAULT_CACHE_AGE,
//      SESSION_TTL_MS (unused)
//   ✅ Keep: SCRIPT_URL, BASE_PATH, APP_*, DEFAULT_ROUTE, LOGIN_PATH,
//      PUBLIC_PAGES (dipakai atau referensi dokumentasi)
//   ✅ Safe storage wrapper untuk environment check
// ============================================================

// ============================================================
//   BACKEND URL
// ============================================================
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwuVzK1obgk9PDmP4hxr8CDpNcegoFlpAt9D0FI-sQxM1FQVCZCqHcfTAIa_FGwIf7Z-w/exec';

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
const APP_VERSION     = '26.1.9';
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
const MAX_RETRY          = 2;

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
//   BOOT VALIDATION & LOG
// ============================================================
(function validateConfig() {
  if (!SCRIPT_URL || !SCRIPT_URL.startsWith('https://script.google.com/')) {
    console.error('[Config] ⚠️ SCRIPT_URL tidak valid:', SCRIPT_URL);
  }
  if (BASE_PATH !== '/bisaa/') {
    console.warn('[Config] ⚠️ BASE_PATH bukan "/bisaa/" — cek deploy GitHub Pages');
  }

  const style  = 'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;';
  const style2 = 'color:#0f172a;font-weight:500;';
  console.log(
    `%c[Config]%c ENV: ${ENVIRONMENT} | BASE_PATH: ${BASE_PATH} | v${APP_VERSION}`,
    style, style2
  );
})();

// ============================================================
//   EXPORTS (named) — v26.1.9 pruned
// ============================================================
export {
  SCRIPT_URL,
  BASE_PATH,
  ENVIRONMENT,
  APP_NAME,
  APP_NAME_SHORT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_ICON,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRY,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,
};

// ============================================================
//   DEFAULT EXPORT
// ============================================================
export default {
  SCRIPT_URL,
  BASE_PATH,
  ENVIRONMENT,
  APP_NAME,
  APP_NAME_SHORT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_ICON,
  DEFAULT_TIMEOUT_MS,
  MAX_RETRY,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,
};
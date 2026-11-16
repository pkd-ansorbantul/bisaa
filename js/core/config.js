// ============================================================
// js/core/config.js — Full Fix Production Ready v26.1.5
// ============================================================
// Konfigurasi global untuk SPA (app.html) + MPA (index, login,
// verifikasi, sign_*, absen, dst).
//
// Sinkron dengan:
//   - code.gs           → v26.1.5
//   - api.js            → v26.1.5
//   - theme.css         → v26.1.4
//   - sign_*.html       → v26.1.5
//
// Changelog dari v26.1.4:
//   ✅ APP_VERSION 26.1.4 → 26.1.5
//   ✅ Console banner update
//
// Changelog dari v26.1.3:
//   ✅ detectBasePath() lebih robust
//   ✅ SCRIPT_URL validation lebih informatif
//   ✅ Tambah helper: buildUrl, buildPageUrl, isProduction, isDevelopment
//   ✅ Tambah konstanta: LOGIN_PATH, DEFAULT_ROUTE, PUBLIC_PAGES
//   ✅ Fail-safe: error detection → fallback aman
// ============================================================

// ============================================================
//   ENVIRONMENT DETECTION
// ============================================================

/**
 * Deteksi environment berdasarkan hostname.
 * @returns {'development'|'production'|'unknown'|'node'}
 */
function detectEnvironment() {
  if (typeof window === 'undefined') return 'node';
  try {
    const host = window.location.hostname || '';
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return 'development';
    }
    if (host.includes('github.io')) return 'production';
    return 'unknown';
  } catch (e) {
    return 'unknown';
  }
}

/**
 * Deteksi base path aplikasi.
 *
 * Contoh hasil:
 *   - https://pkd-ansorbantul.github.io/bisaa/app.html  → '/bisaa/'
 *   - http://localhost:8000/bisaa/app.html               → '/bisaa/'
 *   - http://localhost:8000/app.html                     → '/'       (server root = bisaa/)
 *   - file:///.../bisaa/app.html                         → '/'       (tidak untuk production)
 *
 * @returns {string} Base path dengan trailing slash
 */
function detectBasePath() {
  if (typeof window === 'undefined') return '/';

  try {
    const path = window.location.pathname || '/';

    // 1. Prioritas: cari '/bisaa/' dalam path (case-insensitive)
    if (/\/bisaa\//i.test(path)) return '/bisaa/';

    // 2. GitHub Pages tanpa /bisaa/ eksplisit → assume /bisaa/
    const host = window.location.hostname || '';
    if (host.includes('github.io')) return '/bisaa/';

    // 3. Fallback: ambil folder pertama jika path bukan file di root
    const parts = path.split('/').filter(Boolean);
    if (parts.length > 0 && !path.endsWith('.html') && !parts[parts.length - 1].includes('.')) {
      return `/${parts[0]}/`;
    }

    // 4. Default: root
    return '/';
  } catch (e) {
    console.warn('[Config] detectBasePath error, fallback ke "/":', e);
    return '/';
  }
}

// ============================================================
//   CORE CONSTANTS (EDIT DI SINI UNTUK DEPLOY)
// ============================================================

/**
 * URL deployment Google Apps Script (backend).
 * Ganti setelah deploy ulang code.gs.
 */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwxASeF-qhPvERBi_bmS063irDlDioSjqeOi59pnSnPESo0tlHkFA7k43oSCqcyP-q1/exec';

// ===== APP METADATA =====
const APP_NAME        = 'PKD GP Ansor Kabupaten Bantul';
const APP_NAME_SHORT  = 'PKD GP Ansor';
const APP_SUBTITLE    = 'Kabupaten Bantul';
const APP_VERSION     = '26.1.5';
const APP_ICON        = '/bisaa/LOGO%20ANSOR.webp';

// ===== TIMEOUT & RETRY =====
const DEFAULT_TIMEOUT_MS = 30000;   // 30 detik
const MAX_RETRY          = 2;       // retry 2× untuk GET
const RETRY_BACKOFF_MS   = 500;     // base backoff

// ===== CACHE =====
const DEFAULT_CACHE_AGE = 10;       // menit
const CACHE_PREFIX      = 'pkd_cache_';
const AUTH_STORAGE_KEY  = 'pkd_auth';
const SESSION_TTL_MS    = 24 * 60 * 60 * 1000;  // 24 jam

// ===== ROUTING =====
const DEFAULT_ROUTE = '#/admin/dashboard';
const LOGIN_PATH    = '/bisaa/login.html';

// ===== PUBLIC MPA PAGES =====
const PUBLIC_PAGES = {
  LANDING:           'index.html',
  LOGIN:             'login.html',
  FORGOT:            'forgot_account.html',
  VERIFIKASI:        'verifikasi.html',
  VERIFIKASI_QR:     'verifikasi_qr.html',
  VERIFIKASI_SIGN:   'verifikasi_signature.html',
  PUBLIC_ASSETS:     'public_assets.html',
  ABSEN:             'absen.html',
  SKRINING:          'skrining.html',
  PRETEST:           'pretest.html',
  POSTTEST:          'posttest.html',
  MATERI:            'materi.html',
  INFORMASI:         'informasi.html',
  KADER:             'kader.html',
  ABOUT:             'about.html',
  USULAN:            'usulan_form.html',
  SIGN_KETUA_PC:     'sign_ketua_pc.html',
  SIGN_SEKRETARIS:   'sign_sekretaris.html',
  SIGN_INSTRUKTUR:   'sign_instruktur.html',
};

// ===== DETECTED VALUES (dijalankan sekali saat module load) =====
const BASE_PATH   = detectBasePath();
const ENVIRONMENT = detectEnvironment();

// ============================================================
//   CONFIG VALIDATION (fail-safe, tidak throw)
// ============================================================

(function validateConfig() {
  // Cek SCRIPT_URL format
  if (!SCRIPT_URL || !SCRIPT_URL.startsWith('https://script.google.com/')) {
    console.error(
      '[Config] ⚠️ SCRIPT_URL tidak valid.\n' +
      'Nilai saat ini: ' + SCRIPT_URL + '\n' +
      'Update di js/core/config.js → SCRIPT_URL'
    );
  }

  // Cek BASE_PATH
  if (!BASE_PATH || !BASE_PATH.startsWith('/') || !BASE_PATH.endsWith('/')) {
    console.error('[Config] ⚠️ BASE_PATH tidak valid:', BASE_PATH);
  }

  // Cek APP_VERSION format (semver-ish)
  if (!/^\d+\.\d+\.\d+/.test(APP_VERSION)) {
    console.warn('[Config] ⚠️ APP_VERSION tidak mengikuti format semver:', APP_VERSION);
  }

  // Log info (hanya saat development)
  if (ENVIRONMENT === 'development') {
    console.log(
      '%c[Config]%c ENV: ' + ENVIRONMENT +
      ' | BASE_PATH: ' + BASE_PATH +
      ' | VERSION: ' + APP_VERSION,
      'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;',
      'color:#0f172a;font-weight:500;'
    );
  }
})();

// ============================================================
//   HELPER FUNCTIONS
// ============================================================

/**
 * Gabungkan BASE_PATH dengan path relatif.
 * @param {string} relPath - Path relatif, contoh: 'login.html' atau 'views/admin/peserta.html'
 * @returns {string} Absolute URL path
 *
 * @example
 *   buildUrl('login.html')             // → '/bisaa/login.html'
 *   buildUrl('views/admin/peserta.js') // → '/bisaa/views/admin/peserta.js'
 *   buildUrl('/external/foo')          // → '/external/foo' (leading slash dipakai apa adanya)
 */
function buildUrl(relPath) {
  if (!relPath) return BASE_PATH;
  const clean = String(relPath).replace(/^\/+/, '');
  return BASE_PATH + clean;
}

/**
 * Build URL untuk public MPA page.
 * @param {string} pageKey - Key dari PUBLIC_PAGES, contoh: 'LOGIN', 'VERIFIKASI'
 * @returns {string} Absolute URL
 */
function buildPageUrl(pageKey) {
  const rel = PUBLIC_PAGES[pageKey];
  if (!rel) {
    console.warn('[Config] buildPageUrl: unknown page key:', pageKey);
    return BASE_PATH;
  }
  return BASE_PATH + rel;
}

/**
 * Cek apakah environment saat ini production.
 * @returns {boolean}
 */
function isProduction() {
  return ENVIRONMENT === 'production';
}

/**
 * Cek apakah environment saat ini development.
 * @returns {boolean}
 */
function isDevelopment() {
  return ENVIRONMENT === 'development';
}

// ============================================================
//   EXPORTS (named)
// ============================================================
export {
  // Core
  SCRIPT_URL,
  BASE_PATH,
  ENVIRONMENT,

  // App metadata
  APP_NAME,
  APP_NAME_SHORT,
  APP_SUBTITLE,
  APP_VERSION,
  APP_ICON,

  // Timeout & retry
  DEFAULT_TIMEOUT_MS,
  MAX_RETRY,
  RETRY_BACKOFF_MS,

  // Cache & storage
  DEFAULT_CACHE_AGE,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  SESSION_TTL_MS,

  // Routing
  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,

  // Helpers
  buildUrl,
  buildPageUrl,
  isProduction,
  isDevelopment,
};

// ============================================================
//   DEFAULT EXPORT (backward-compatibility)
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
  RETRY_BACKOFF_MS,

  DEFAULT_CACHE_AGE,
  CACHE_PREFIX,
  AUTH_STORAGE_KEY,
  SESSION_TTL_MS,

  DEFAULT_ROUTE,
  LOGIN_PATH,
  PUBLIC_PAGES,

  buildUrl,
  buildPageUrl,
  isProduction,
  isDevelopment,
};
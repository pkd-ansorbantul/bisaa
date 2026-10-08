// ============================================================
// js/app.js — v27.5.0 ROUTE-NORMALIZER + CIRCUIT-BREAKER AWARE
// ============================================================
// CHANGELOG v27.5.0 (dari v27.4.0):
//   ✅ FIX CRITICAL: Route alias — typo "skriining" auto-redirect ke "skrining"
//   ✅ FIX CRITICAL: normalizeRoute() — hapus karakter aneh, trailing slash
//   ✅ FIX: Preload fragment + JS tidak fail kan route salah
//   ✅ FIX: Auto-sync 180s + MIN_SYNC_GAP 60s (anti GAS throttle)
//   ✅ FIX: Circuit breaker status check sebelum trigger sync
//   ✅ NEW: ALL_ROUTES constant untuk debug
//   ✅ NEW: validateRoutes() saat boot — log route yang file-nya 404
//   ✅ NEW: window.__pkd.diagnose() untuk health check lengkap
//   ✅ KEEP: Semua fitur v27.4.0
// ============================================================

import {
  getUserRole,
  updateNavbarMenu,
  loadAuthState,
  escapeHtml,
  showToast,
  getCircuitState,
} from './core/api.js';

import {
  BASE_PATH,
  DEFAULT_ROUTE,
  LOGIN_PATH,
} from './core/config.js';

import { loadSidebar } from './components/sidebar.js';
import { loadBottomNav } from './components/bottom-nav.js';
import { mount as mountThemeToggle } from './components/theme-toggle.js';
import { mount as mountCommandPalette } from './components/command-palette.js';
import { mount as mountNotificationCenter } from './components/notification-center.js';
import Router from './router.js';

// ============================================================
//   CONSTANTS
// ============================================================
const APP_VERSION = '27.5.0';

const DATA_PRELOAD_TIMEOUT_MS       = 20000;
const ENSURE_READY_TIMEOUT_MS       = 10000;
const AUTO_SYNC_INTERVAL_MS         = 180000;  // 3 menit
const MIN_SYNC_GAP_MS               = 60000;   // 1 menit
const IDLE_THRESHOLD_MS             = 5 * 60 * 1000;
const FAILED_MODULE_RETRY_DELAY_MS  = 3000;
const FAILED_MODULE_MAX_RETRY       = 3;
const QUIZ_PRELOAD_DELAY_MS         = 2000;

// ============================================================
//   ROUTES — 18 Views (dengan alias support)
// ============================================================
const ROUTES = {
  '#/admin/dashboard':      { html: BASE_PATH + 'views/admin/dashboard.html',      js: BASE_PATH + 'views/admin/dashboard.js' },
  '#/admin/peserta':        { html: BASE_PATH + 'views/admin/peserta.html',        js: BASE_PATH + 'views/admin/peserta.js' },
  '#/admin/alumni':         { html: BASE_PATH + 'views/admin/alumni.html',         js: BASE_PATH + 'views/admin/alumni.js' },
  '#/admin/kader':          { html: BASE_PATH + 'views/admin/kader.html',          js: BASE_PATH + 'views/admin/kader.js' },
  '#/admin/tim-instruktur': { html: BASE_PATH + 'views/admin/tim-instruktur.html', js: BASE_PATH + 'views/admin/tim-instruktur.js' },
  '#/admin/sesi-absen':     { html: BASE_PATH + 'views/admin/sesi-absen.html',     js: BASE_PATH + 'views/admin/sesi-absen.js' },
  '#/admin/data-absensi':   { html: BASE_PATH + 'views/admin/data-absensi.html',   js: BASE_PATH + 'views/admin/data-absensi.js' },
  '#/admin/rekap-absensi':  { html: BASE_PATH + 'views/admin/rekap-absensi.html',  js: BASE_PATH + 'views/admin/rekap-absensi.js' },
  '#/admin/skrining':       { html: BASE_PATH + 'views/admin/skrining.html',       js: BASE_PATH + 'views/admin/skrining.js' },
  '#/admin/sertifikat':     { html: BASE_PATH + 'views/admin/sertifikat.html',     js: BASE_PATH + 'views/admin/sertifikat.js' },
  '#/admin/tanda-tangan':   { html: BASE_PATH + 'views/admin/tanda-tangan.html',   js: BASE_PATH + 'views/admin/tanda-tangan.js' },
  '#/admin/rtl':            { html: BASE_PATH + 'views/admin/rtl.html',            js: BASE_PATH + 'views/admin/rtl.js' },
  '#/admin/pengaturan':     { html: BASE_PATH + 'views/admin/pengaturan.html',     js: BASE_PATH + 'views/admin/pengaturan.js' },
  '#/admin/informasi':      { html: BASE_PATH + 'views/admin/informasi.html',      js: BASE_PATH + 'views/admin/informasi.js' },
  '#/admin/asset':          { html: BASE_PATH + 'views/admin/asset.html',          js: BASE_PATH + 'views/admin/asset.js' },
  '#/admin/pretest':        { html: BASE_PATH + 'views/admin/pretest.html',        js: BASE_PATH + 'views/admin/pretest.js' },
  '#/admin/posttest':       { html: BASE_PATH + 'views/admin/posttest.html',       js: BASE_PATH + 'views/admin/posttest.js' },
  '#/admin/materi':         { html: BASE_PATH + 'views/admin/materi.html',         js: BASE_PATH + 'views/admin/materi.js' },
};

// ============================================================
//   ⚡ ROUTE ALIASES — auto-fix typo
// ============================================================
const ROUTE_ALIASES = {
  // Typo umum
  '#/admin/skriining':       '#/admin/skrining',
  '#/admin/skrinng':         '#/admin/skrining',
  '#/admin/skrinig':         '#/admin/skrining',
  '#/admin/skining':         '#/admin/skrining',

  '#/admin/sertifkat':       '#/admin/sertifikat',
  '#/admin/sertifikat':      '#/admin/sertifikat',
  '#/admin/certifikat':      '#/admin/sertifikat',

  '#/admin/tandatangan':     '#/admin/tanda-tangan',
  '#/admin/tanda_tangan':    '#/admin/tanda-tangan',
  '#/admin/ttd':             '#/admin/tanda-tangan',

  '#/admin/dataabsensi':     '#/admin/data-absensi',
  '#/admin/data_absensi':    '#/admin/data-absensi',

  '#/admin/rekapabsensi':    '#/admin/rekap-absensi',
  '#/admin/rekap_absensi':   '#/admin/rekap-absensi',

  '#/admin/sesiabsen':       '#/admin/sesi-absen',
  '#/admin/sesi_absen':      '#/admin/sesi-absen',

  '#/admin/timinstruktur':   '#/admin/tim-instruktur',
  '#/admin/tim_instruktur':  '#/admin/tim-instruktur',

  '#/admin/pretest':         '#/admin/pretest',
  '#/admin/pre-test':        '#/admin/pretest',
  '#/admin/pre_test':        '#/admin/pretest',
  '#/admin/prestest':        '#/admin/pretest',

  '#/admin/postest':         '#/admin/posttest',
  '#/admin/post-test':       '#/admin/posttest',
  '#/admin/post_test':       '#/admin/posttest',

  // Trailing slash variants
  '#/admin/dashboard/':      '#/admin/dashboard',
  '#/admin/peserta/':        '#/admin/peserta',
  '#/admin/alumni/':         '#/admin/alumni',
  '#/admin/kader/':          '#/admin/kader',
  '#/admin/materi/':         '#/admin/materi',
};

// ============================================================
//   ⚡ NEW: NORMALIZE ROUTE HASH
// ============================================================
/**
 * Normalisasi hash supaya route selalu match.
 * - Trim whitespace
 * - Hapus trailing slash (kecuali root)
 * - Hapus karakter zero-width & unicode aneh
 * - Apply ROUTE_ALIASES
 */
function normalizeRoute(hash) {
  if (!hash || typeof hash !== 'string') return '#/admin/dashboard';

  let h = hash.trim();

  // Hapus zero-width & karakter kontrol
  h = h.replace(/[\u200B-\u200D\uFEFF]/g, '');

  // Pastikan mulai dengan '#/'
  if (!h.startsWith('#')) h = '#' + h;
  if (h === '#' || h === '#/') return '#/admin/dashboard';
  if (!h.startsWith('#/')) h = '#/' + h.slice(1);

  // Hapus trailing slash (kecuali root)
  if (h.length > 3 && h.endsWith('/')) {
    h = h.slice(0, -1);
  }

  // Apply alias
  if (ROUTE_ALIASES[h]) {
    console.log(`[Route] 🔄 Aliased "${h}" → "${ROUTE_ALIASES[h]}"`);
    h = ROUTE_ALIASES[h];
  }

  // Case-normalize (lowercase)
  h = h.toLowerCase();

  return h;
}

// ============================================================
//   MODULE STATE
// ============================================================
let router = null;
let isBooted = false;
let autoSyncInterval = null;
let isSyncing = false;
let adminModule = null;
let lastUserActivity = Date.now();
let lastSyncAt = 0;
let dataReady = false;
let corsErrorShown = false;

window.__pkdFailedModules = new Map();

// ============================================================
//   UTILITY
// ============================================================
function findElement(ids) {
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function getRouteCount() {
  return Object.keys(ROUTES).length;
}

function updateLoaderText(text) {
  const loader = document.getElementById('initialLoader');
  if (!loader) return;
  const textEl = loader.querySelector('.text');
  if (textEl) textEl.textContent = text;
}

function updateLoaderProgress(current, total) {
  const loader = document.getElementById('initialLoader');
  if (!loader) return;
  let progress = loader.querySelector('.preload-progress');
  if (!progress) {
    progress = document.createElement('div');
    progress.className = 'preload-progress';
    progress.style.cssText = 'margin-top:8px;font-size:0.75rem;color:#94a3b8;transition:opacity 0.3s;';
    loader.appendChild(progress);
  }
  progress.textContent = `${current} / ${total}`;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================
//   SAFE DYNAMIC IMPORT
// ============================================================
async function safeImport(url, options = {}) {
  const { silent = false, maxRetry = 2 } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const importUrl = attempt === 0 ? url : `${url}?retry=${Date.now()}&attempt=${attempt}`;
      const mod = await import(/* @vite-ignore */ importUrl);

      if (window.__pkdFailedModules.has(url)) {
        window.__pkdFailedModules.delete(url);
        console.log(`[SafeImport] ✅ Recovered: ${url}`);
      }
      return mod;
    } catch (e) {
      lastError = e;
      const msg = String(e?.message || e || '');
      const isRetryable =
        msg.includes('Failed to fetch') ||
        msg.includes('ERR_ABORTED') ||
        msg.includes('dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('404') ||
        msg.includes('NetworkError');

      if (!isRetryable) {
        if (!silent) console.error(`[SafeImport] Non-retryable: ${url}`);
        throw e;
      }

      if (attempt < maxRetry) {
        if (!silent) console.warn(`[SafeImport] Retry ${attempt + 1}/${maxRetry}: ${url}`);
        await sleep(300 * (attempt + 1));
      } else {
        const info = window.__pkdFailedModules.get(url) || { count: 0, lastError: '' };
        window.__pkdFailedModules.set(url, { count: info.count + 1, lastError: msg });
        if (!silent) console.error(`[SafeImport] ❌ FAILED: ${url}`);
        throw e;
      }
    }
  }
  throw lastError || new Error('SafeImport failed');
}

// ============================================================
//   ⚡ NEW: VALIDATE ROUTE FILES (saat boot)
// ============================================================
async function validateRouteFiles() {
  console.log('[Boot] 🔍 Validating route files...');
  const results = [];
  const entries = Object.entries(ROUTES);

  const checks = entries.map(async ([route, cfg]) => {
    try {
      const [htmlRes, jsRes] = await Promise.all([
        fetch(cfg.html, { method: 'HEAD', cache: 'no-store' }).catch(() => ({ ok: false, status: 0 })),
        fetch(cfg.js, { method: 'HEAD', cache: 'no-store' }).catch(() => ({ ok: false, status: 0 })),
      ]);

      results.push({
        route,
        html: htmlRes.status,
        js: jsRes.status,
        ok: htmlRes.ok && jsRes.ok,
      });
    } catch (e) {
      results.push({ route, html: 0, js: 0, ok: false, error: e.message });
    }
  });

  await Promise.allSettled(checks);

  const failed = results.filter(r => !r.ok);
  if (failed.length > 0) {
    console.warn('[Boot] ⚠️ Route file issues detected:');
    console.table(failed);
  } else {
    console.log('[Boot] ✅ All 18 route files verified');
  }
  return results;
}

// ============================================================
//   WAIT FOR DATA READY
// ============================================================
async function waitForDataReady(maxAttempts = 50) {
  if (!adminModule) return false;

  const hasEnsure = typeof adminModule.ensureDataReady === 'function';
  const hasIsReady = typeof adminModule.isReady === 'function';

  if (hasEnsure) {
    console.log('[Boot] ⏳ Using AdminModule.ensureDataReady()...');
    try {
      const ready = await adminModule.ensureDataReady(ENSURE_READY_TIMEOUT_MS);
      return ready;
    } catch (e) {
      console.warn('[Boot] ensureDataReady error:', e.message);
    }
  }

  console.log('[Boot] ⏳ Manual polling for data ready...');
  for (let i = 0; i < maxAttempts; i++) {
    try {
      if (hasIsReady && adminModule.isReady()) {
        console.log(`[Boot] ✅ Data ready (via isReady) after ${i * 200}ms`);
        return true;
      }

      if (typeof adminModule.hasData === 'function' && adminModule.hasData()) {
        console.log(`[Boot] ✅ Data ready (via hasData) after ${i * 200}ms`);
        return true;
      }

      const stats = adminModule.getStats() || {};
      const total =
        (stats.totalPeserta || 0) +
        (stats.totalSesi || 0) +
        (stats.totalMateri || 0) +
        (stats.totalAlumni || 0);

      if (total > 0) {
        console.log(`[Boot] ✅ Data ready (via getStats) after ${i * 200}ms — ${total} entities`);
        return true;
      }
    } catch (e) { /* continue */ }
    await sleep(200);
  }

  return false;
}

// ============================================================
//   GLOBAL ERROR HANDLERS
// ============================================================
(function setupGlobalErrorHandlers() {
  window.addEventListener('error', function (e) {
    const msg = (e && e.message) || '';
    const isModuleError =
      msg.includes('Failed to resolve module') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Cannot find module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('404');

    if (isModuleError) {
      console.error('[GlobalError]', e);
      const errorContainer = document.getElementById('moduleLoadError');
      if (errorContainer) errorContainer.style.display = 'block';
    }
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    const reason = e && e.reason;
    const msg = (reason && reason.message) || String(reason || '');
    if (msg.includes('AbortError') || msg.includes('Request timeout')) return;
    console.error('[UnhandledRejection]', reason);
  });
})();

// ============================================================
//   LOADING & ERROR UI
// ============================================================
function hideInitialLoader() {
  const loader = document.getElementById('initialLoader');
  if (!loader) return;
  loader.classList.add('hidden');
  setTimeout(() => {
    try { loader.remove(); } catch (e) { /* silent */ }
  }, 400);
}

function showAppShell() {
  const shell = findElement(['appShell', 'adminWrapper']);
  if (!shell) return;
  shell.style.removeProperty('visibility');
  shell.style.visibility = 'visible';
  shell.classList.add('is-ready');
}

function renderShellError(message, detail) {
  const shell = findElement(['appShell', 'adminWrapper']);
  if (!shell) return;
  const safeMsg = escapeHtml(message || 'Terjadi kesalahan.');
  const safeDetail = detail ? escapeHtml(detail) : '';
  const safeLogin = escapeHtml(LOGIN_PATH);

  shell.innerHTML = `
    <div class="d-flex justify-content-center align-items-center p-4" style="min-height:100vh;">
      <div class="text-center" style="max-width:560px;">
        <i class="bi bi-exclamation-triangle-fill text-danger" style="font-size:4rem;" aria-hidden="true"></i>
        <h4 class="fw-bold mt-3">Gagal Memuat Aplikasi</h4>
        <p class="text-muted small">${safeMsg}</p>
        ${safeDetail ? `<div class="alert alert-danger small text-start">${safeDetail}</div>` : ''}
        <div class="d-flex gap-2 justify-content-center flex-wrap mt-3">
          <button class="btn btn-primary rounded-pill px-4" data-shell-action="reload" type="button">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i> Refresh
          </button>
          <button class="btn btn-warning rounded-pill px-4" data-shell-action="clearcache" type="button">
            <i class="bi bi-trash me-1" aria-hidden="true"></i> Clear Cache
          </button>
          <a href="${safeLogin}" class="btn btn-outline-secondary rounded-pill px-4">
            <i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i> Login Ulang
          </a>
        </div>
      </div>
    </div>`;

  shell.querySelector('[data-shell-action="reload"]')?.addEventListener('click', () => window.location.reload());
  shell.querySelector('[data-shell-action="clearcache"]')?.addEventListener('click', async () => {
    if (!confirm('Hapus cache browser & reload?')) return;
    try {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
      sessionStorage.clear();
      const toKeep = {};
      ['pkd_auth'].forEach(k => { const v = localStorage.getItem(k); if (v) toKeep[k] = v; });
      localStorage.clear();
      Object.keys(toKeep).forEach(k => localStorage.setItem(k, toKeep[k]));
    } catch (e) { /* silent */ }
    window.location.reload();
  });
}

// ============================================================
//   PARTIALS LOADER
// ============================================================
async function loadPartialsWithRetry() {
  const maxRetry = 1;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      await Promise.all([
        Promise.resolve(loadSidebar()).catch(e => { throw e; }),
        Promise.resolve(loadBottomNav()).catch(e => { throw e; }),
      ]);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetry) await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Gagal memuat partials');
}

// ============================================================
//   PRELOAD DATA
// ============================================================
async function preloadAllData() {
  console.log('[Boot] ⚡ Preloading data (blocking, timeout 20s)...');
  updateLoaderText('Memuat data...');

  const startTime = Date.now();

  try {
    const mod = await safeImport('./modules/admin.js', { silent: true });
    adminModule = mod.AdminModule || mod.default;

    if (!adminModule) throw new Error('AdminModule tidak tersedia');

    const loadPromise = adminModule.loadAllData(true);

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ __timeout: true }), DATA_PRELOAD_TIMEOUT_MS);
    });

    const result = await Promise.race([loadPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;

    if (result && result.__timeout) {
      console.warn(`[Boot] ⚠️ Data preload TIMEOUT after ${elapsed}ms`);
      loadPromise
        .then((r) => {
          if (r && r.success) {
            console.log('[Boot] ✅ Data loaded late in background');
            dataReady = true;
            window.dispatchEvent(new CustomEvent('pkd:data-ready'));
          }
        })
        .catch((e) => console.warn('[Boot] Late load error:', e.message));
      return { success: false, error: 'timeout', timeout: true };
    }

    if (result && result.success) {
      console.log(`[Boot] ✅ Data loaded in ${elapsed}ms via ${result.source || 'unknown'}`);
      return { success: true, elapsed };
    }

    return { success: false, error: result?.error };
  } catch (e) {
    const elapsed = Date.now() - startTime;
    console.warn(`[Boot] ⚠️ Preload failed after ${elapsed}ms:`, e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//   PRELOAD FRAGMENTS + MODULES
// ============================================================
async function preloadAllFragmentsAndModules() {
  const totalRoutes = Object.keys(ROUTES).length;
  const entries = Object.entries(ROUTES);
  let loaded = 0;
  const total = totalRoutes * 2;

  const tasks = entries.flatMap(([route, cfg]) => {
    const htmlTask = fetch(cfg.html, { cache: 'force-cache' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
      .then(html => {
        if (html && html.trim() && router) router.fragmentCache.set(cfg.html, html);
        loaded++;
        updateLoaderProgress(loaded, total);
      })
      .catch((err) => {
        console.warn(`[Boot] ⚠️ Fragment failed: ${cfg.html}`);
        loaded++;
        updateLoaderProgress(loaded, total);
      });

    const jsTask = safeImport(cfg.js, { silent: true })
      .then(() => { loaded++; updateLoaderProgress(loaded, total); })
      .catch((err) => {
        console.warn(`[Boot] ⚠️ Module failed: ${cfg.js}`);
        loaded++;
        updateLoaderProgress(loaded, total);
      });

    return [htmlTask, jsTask];
  });

  await Promise.allSettled(tasks);

  const failedCount = window.__pkdFailedModules.size;
  if (failedCount > 0) {
    console.warn(`[Boot] ⚠️ ${failedCount} module(s) failed — retry background`);
  }
  console.log(`[Boot] ✅ Preloaded ${totalRoutes} fragments + ${totalRoutes} modules`);
}

// ============================================================
//   PRELOAD QUIZ QUESTIONS
// ============================================================
function preloadQuizQuestions() {
  setTimeout(async () => {
    console.log('[Boot] ⚡ Preloading quiz questions...');

    const tasks = [
      safeImport(BASE_PATH + 'views/admin/pretest.js', { silent: true })
        .then(mod => mod && typeof mod.preloadData === 'function' ? mod.preloadData() : { success: false })
        .catch(e => ({ success: false, error: e.message })),
      safeImport(BASE_PATH + 'views/admin/posttest.js', { silent: true })
        .then(mod => mod && typeof mod.preloadData === 'function' ? mod.preloadData() : { success: false })
        .catch(e => ({ success: false, error: e.message })),
    ];

    const results = await Promise.allSettled(tasks);
    results.forEach((r, i) => {
      const kind = i === 0 ? 'pretest' : 'posttest';
      if (r.status === 'fulfilled' && r.value && r.value.success) {
        console.log(`[Boot] ✅ ${kind} preloaded: ${r.value.count ?? 0} items`);
      }
    });
  }, QUIZ_PRELOAD_DELAY_MS);
}

// ============================================================
//   AUTO-RETRY FAILED MODULES
// ============================================================
function scheduleFailedModuleRetry() {
  setTimeout(async () => {
    const failed = window.__pkdFailedModules;
    if (!failed || failed.size === 0) return;

    console.log(`[Boot] 🔄 Retrying ${failed.size} failed module(s)...`);
    const urls = Array.from(failed.keys());

    for (const url of urls) {
      const info = failed.get(url);
      if (info && info.count >= FAILED_MODULE_MAX_RETRY) continue;
      try {
        await safeImport(url, { silent: false, maxRetry: 0 });
        console.log(`[Boot] ✅ Retry OK: ${url}`);
      } catch (e) { /* silent */ }
    }

    if (failed.size > 0) scheduleFailedModuleRetry();
  }, FAILED_MODULE_RETRY_DELAY_MS);
}

// ============================================================
//   USER ACTIVITY TRACKING
// ============================================================
(function trackUserActivity() {
  const handler = () => { lastUserActivity = Date.now(); };
  ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev => {
    window.addEventListener(ev, handler, { passive: true });
  });
})();

// ============================================================
//   AUTO-SYNC — Anti-throttle
// ============================================================
function startAutoSync() {
  if (autoSyncInterval) return;

  console.log(
    `[AutoSync] ✅ Started (interval=${AUTO_SYNC_INTERVAL_MS/1000}s, ` +
    `minGap=${MIN_SYNC_GAP_MS/1000}s, idle=${IDLE_THRESHOLD_MS/60000}min)`
  );

  autoSyncInterval = setInterval(async () => {
    // Guard 1: tab hidden
    if (document.hidden) return;
    // Guard 2: already syncing
    if (isSyncing) return;
    // Guard 3: user idle
    const idleMs = Date.now() - lastUserActivity;
    if (idleMs > IDLE_THRESHOLD_MS) {
      console.log(`[AutoSync] ⏸️ Skip — user idle ${Math.round(idleMs/60000)}min`);
      return;
    }
    // Guard 4: adminModule not ready
    if (!adminModule) return;
    // Guard 5: min gap
    const sinceLast = Date.now() - lastSyncAt;
    if (sinceLast < MIN_SYNC_GAP_MS) {
      console.log(`[AutoSync] ⏸️ Skip — ${Math.round(sinceLast/1000)}s < ${MIN_SYNC_GAP_MS/1000}s gap`);
      return;
    }
    // Guard 6: circuit breaker
    try {
      const circuit = getCircuitState();
      if (circuit && circuit.isOpen) {
        console.log(
          `[AutoSync] 🔴 Circuit OPEN (${circuit.failures} failures) — ` +
          `wait ${Math.round(circuit.remainingMs/1000)}s`
        );
        return;
      }
    } catch (e) { /* silent */ }

    // LULUS SEMUA GUARD
    isSyncing = true;
    lastSyncAt = Date.now();

    try {
      const result = await adminModule.loadAllData(false);
      if (result && result.success && !result.skipped) {
        console.log('[AutoSync] ✅ Synced');
      }
    } catch (e) {
      const msg = String(e.message || '').toLowerCase();
      const isCors = msg.includes('failed to fetch') || msg.includes('network');

      console.warn(`[AutoSync] ⚠️ Failed: ${e.message}`);

      if (isCors && !corsErrorShown) {
        corsErrorShown = true;
        try {
          showToast('Server sedang sibuk. Data lama tetap ditampilkan.', 'warning');
        } catch (err) { /* silent */ }
        setTimeout(() => { corsErrorShown = false; }, 5 * 60 * 1000);
      }
    } finally {
      isSyncing = false;
    }
  }, AUTO_SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
    console.log('[AutoSync] ⏹️ Stopped');
  }
}

// ============================================================
//   INTERACTIVE FEATURES
// ============================================================
async function mountInteractiveFeatures() {
  try { mountThemeToggle(); console.log('[Boot] ✅ Theme Toggle'); }
  catch (e) { console.warn('[Boot] Theme Toggle gagal:', e); }

  try { mountCommandPalette(); console.log('[Boot] ✅ Command Palette'); }
  catch (e) { console.warn('[Boot] Command Palette gagal:', e); }

  try { await mountNotificationCenter(); console.log('[Boot] ✅ Notification Center'); }
  catch (e) { console.warn('[Boot] Notification Center gagal:', e); }
}

// ============================================================
//   BOOT SEQUENCE
// ============================================================
async function boot() {
  if (isBooted) { console.warn('[Boot] Skip.'); return; }
  isBooted = true;

  console.log(`[Boot] Starting PKD GP Ansor Admin v${APP_VERSION}...`);
  const bootStart = Date.now();

  // 1. Auth state
  try { loadAuthState(); }
  catch (e) { console.error('[Boot] loadAuthState failed:', e); }

  // 2. Role check
  const role = getUserRole();
  if (role !== 'admin') {
    console.warn('[Boot] Non-admin:', role);
    window.location.replace(LOGIN_PATH);
    return;
  }

  // 3. Navbar
  try { updateNavbarMenu(); }
  catch (e) { console.warn('[Boot] updateNavbarMenu failed:', e); }

  // 4. Partials
  try {
    await loadPartialsWithRetry();
    console.log('[Boot] ✅ Partials loaded');
  } catch (e) {
    console.error('[Boot] Failed to load partials:', e);
    renderShellError(
      'Gagal memuat komponen navigasi.',
      `Pastikan file ${BASE_PATH}partials/sidebar.html dan ${BASE_PATH}partials/bottom-nav.html tersedia.`
    );
    return;
  }

  // 5. View container
  const viewContainer = findElement(['view-container', 'appOutlet']);
  if (!viewContainer) {
    console.error('[Boot] #view-container tidak ditemukan');
    renderShellError('Elemen #view-container tidak ditemukan di DOM.');
    return;
  }

  // 6. Create router
  try {
    router = new Router(viewContainer, ROUTES, {
      defaultRoute: DEFAULT_ROUTE,
      scrollBehavior: 'top',
      useCacheBuster: false,
      showLoadingUI: true,
      maxRetries: 2,
      debug: false,
      prefetchEnabled: true,
    });
    window.__router = router;
    window.__routes = ROUTES;
    window.__routeAliases = ROUTE_ALIASES;
    window.__pkdAppVersion = APP_VERSION;
  } catch (e) {
    console.error('[Boot] Failed to create router:', e);
    renderShellError('Gagal inisialisasi router.', e.message);
    return;
  }

  // ⚡ 6b. NORMALIZE initial hash
  const currentHash = window.location.hash;
  if (currentHash) {
    const normalized = normalizeRoute(currentHash);
    if (normalized !== currentHash) {
      console.log(`[Boot] 🔄 Normalizing initial hash: "${currentHash}" → "${normalized}"`);
      try {
        history.replaceState(null, '', normalized);
      } catch (e) {
        window.location.hash = normalized;
      }
    }
  }

  // 7. PARALLEL PRELOAD
  updateLoaderText('Memuat menu & data...');

  const fragmentsPromise = preloadAllFragmentsAndModules();
  const dataPromise = preloadAllData();
  const validatePromise = validateRouteFiles();

  await Promise.allSettled([fragmentsPromise, dataPromise, validatePromise]);

  console.log('[Boot] ✅ Preload complete (fragments + data + validation)');

  // 7b. Verify data ready
  updateLoaderText('Memverifikasi data...');

  const isReady = await waitForDataReady();

  if (isReady) {
    dataReady = true;
    window.dispatchEvent(new CustomEvent('pkd:data-ready'));

    const stats = adminModule && typeof adminModule.getStats === 'function'
      ? adminModule.getStats()
      : {};
    console.log('[Boot] ✅ Data verified ready:', {
      peserta: stats.totalPeserta || 0,
      sesi: stats.totalSesi || 0,
      materi: stats.totalMateri || 0,
      alumni: stats.totalAlumni || 0,
    });
  } else {
    console.warn('[Boot] ⚠️ Data not verified — dashboard may show skeleton first');
  }

  // Preload quiz
  preloadQuizQuestions();
  scheduleFailedModuleRetry();

  // 8. Set default hash (with normalization)
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') {
    window.location.hash = DEFAULT_ROUTE;
  } else {
    const normalized = normalizeRoute(hash);
    if (normalized !== hash) {
      console.log(`[Boot] 🔄 Normalizing hash before router.start()`);
      window.location.hash = normalized;
    }
  }

  // 9. Start SPA
  updateLoaderText('Menyiapkan halaman...');
  try {
    router.start();
    console.log('[Boot] ✅ SPA started');
  } catch (e) {
    console.error('[Boot] Router start failed:', e);
    renderShellError('Gagal memulai navigasi.', e.message);
    return;
  }

  // 10. Hide loader
  updateLoaderText('Siap!');
  hideInitialLoader();
  showAppShell();
  window.__pkdAppLoaded = true;
  window.dispatchEvent(new CustomEvent('pkd:app-loaded'));

  // 11. Interactive features
  await mountInteractiveFeatures();

  // 12. Auto-sync
  startAutoSync();

  // 13. Global handlers
  installKeyboardShortcuts();
  installBeforeUnloadGuard();
  installBfcacheGuard();
  installTitleUpdate();
  installHashChangeNormalizer();  // ⬅️ NEW

  // 14. Done
  const totalBoot = Date.now() - bootStart;
  console.log(
    `%c PKD GP Ansor Bantul — SPA v${APP_VERSION} `,
    'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;',
    `Routes: ${getRouteCount()} | Aliases: ${Object.keys(ROUTE_ALIASES).length} | Boot: ${totalBoot}ms | Data: ${dataReady ? '✅ Ready' : '⚠️ Skeleton'}`
  );
}

// ============================================================
//   ⚡ NEW: HASH CHANGE NORMALIZER
//   Auto-normalize typo saat user klik link (tanpa reload)
// ============================================================
function installHashChangeNormalizer() {
  if (window.__pkdHashNormalizerInstalled) return;
  window.__pkdHashNormalizerInstalled = true;

  window.addEventListener('hashchange', function () {
    const raw = window.location.hash;
    if (!raw) return;

    const normalized = normalizeRoute(raw);
    if (normalized === raw) return;

    console.log(`[HashNormalizer] 🔄 Auto-fix: "${raw}" → "${normalized}"`);
    try {
      history.replaceState(null, '', normalized);
      // Trigger router manual
      if (router && typeof router.navigate === 'function') {
        router.navigate(normalized);
      }
    } catch (e) {
      window.location.hash = normalized;
    }
  });
}

// ============================================================
//   KEYBOARD SHORTCUTS
// ============================================================
function installKeyboardShortcuts() {
  if (window.__pkdShortcutsInstalled) return;
  window.__pkdShortcutsInstalled = true;

  document.addEventListener('keydown', function (e) {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey) return;
    if (!e.altKey) return;

    const key = String(e.key || '').toLowerCase();
    const routes = {
      'd': '#/admin/dashboard',
      'p': '#/admin/peserta',
      'a': '#/admin/sesi-absen',
      's': '#/admin/skrining',
      'r': '#/admin/rtl',
      'q': '#/admin/tanda-tangan',
      'm': '#/admin/materi',
      'k': '#/admin/kader',
      't': '#/admin/tim-instruktur',
    };
    if (routes[key]) {
      e.preventDefault();
      if (router) router.navigate(routes[key]);
    }
  });
}

// ============================================================
//   BEFORE UNLOAD GUARD
// ============================================================
function installBeforeUnloadGuard() {
  if (window.__pkdUnloadGuardInstalled) return;
  window.__pkdUnloadGuardInstalled = true;

  window.addEventListener('beforeunload', function (e) {
    if (!document.querySelector('.modal.show')) return;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
}

// ============================================================
//   BFCACHE GUARD
// ============================================================
function installBfcacheGuard() {
  if (window.__pkdBfcacheGuardInstalled) return;
  window.__pkdBfcacheGuardInstalled = true;

  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    if (!window.__pkdAppLoaded) return;
    try {
      const role = getUserRole();
      if (role !== 'admin') window.location.replace(LOGIN_PATH);
    } catch (err) {
      window.location.replace(LOGIN_PATH);
    }
  });
}

// ============================================================
//   TITLE UPDATE
// ============================================================
function installTitleUpdate() {
  if (window.__pkdTitleUpdateInstalled) return;
  window.__pkdTitleUpdateInstalled = true;

  window.addEventListener('routeChanged', function (e) {
    const detail = e && e.detail;
    if (!detail || !detail.path) return;
    const path = detail.path.replace('#/admin/', '').replace(/\//g, ' ');
    const title = path.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    document.title = (title || 'Admin') + ' · PKD GP Ansor Bantul';
  });
}

// ============================================================
//   AUTO-START
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

// ============================================================
//   DEBUG HELPERS
// ============================================================
window.__pkd = {
  version: APP_VERSION,
  isDataReady: () => dataReady,

  getRouter: () => router,
  getRoutes: () => ROUTES,
  getRouteCount: getRouteCount,
  getAliases: () => ROUTE_ALIASES,
  navigate: (hash) => {
    const normalized = normalizeRoute(hash);
    if (router) router.navigate(normalized);
  },
  normalizeRoute: normalizeRoute,   // ⬅️ NEW public API
  reload: () => router && router.reload(),
  destroy: () => router && router.destroy(),

  openPalette: () => window.dispatchEvent(new CustomEvent('palette:open')),
  closePalette: () => window.dispatchEvent(new CustomEvent('palette:close')),
  toggleTheme: () => window.dispatchEvent(new CustomEvent('theme:toggle')),
  setTheme: (t) => window.dispatchEvent(new CustomEvent('theme:set', { detail: { theme: t } })),
  openShortcuts: () => window.dispatchEvent(new CustomEvent('shortcuts:open')),

  getAdminModule: () => adminModule,
  forceSync: async () => {
    if (!adminModule) return { success: false, error: 'AdminModule belum siap' };
    const t0 = Date.now();
    const result = await adminModule.loadAllData(true);
    lastSyncAt = Date.now();
    return { ...result, elapsed: Date.now() - t0 };
  },

  getFailedModules: () => {
    const result = {};
    window.__pkdFailedModules.forEach((v, k) => { result[k] = v; });
    return result;
  },
  clearFailedModules: () => { window.__pkdFailedModules.clear(); },
  retryFailedModules: async () => {
    const failed = window.__pkdFailedModules;
    if (failed.size === 0) return;
    const urls = Array.from(failed.keys());
    for (const url of urls) {
      try { await safeImport(url, { silent: false, maxRetry: 1 }); }
      catch (e) { /* silent */ }
    }
  },

  preloadQuiz: () => preloadQuizQuestions(),
  startAutoSync,
  stopAutoSync,
  isAutoSyncRunning: () => !!autoSyncInterval,
  getStats: () => adminModule && typeof adminModule.getStats === 'function'
    ? adminModule.getStats()
    : null,

  // ⬇️ NEW: Full diagnostic
  diagnose: async () => {
    const report = {
      version: APP_VERSION,
      dataReady,
      isSyncing,
      lastSyncAgo: lastSyncAt ? `${Math.round((Date.now() - lastSyncAt)/1000)}s` : 'never',
      lastUserActivityAgo: `${Math.round((Date.now() - lastUserActivity)/1000)}s`,
      autoSyncRunning: !!autoSyncInterval,
      failedModules: window.__pkdFailedModules.size,
      routeCount: Object.keys(ROUTES).length,
      aliasCount: Object.keys(ROUTE_ALIASES).length,
    };
    try { report.circuit = getCircuitState(); }
    catch (e) { report.circuit = 'unavailable'; }
    try { report.stats = adminModule?.getStats?.() || null; }
    catch (e) { report.stats = null; }
    try { report.routeFiles = await validateRouteFiles(); }
    catch (e) { report.routeFiles = 'check failed'; }

    console.table(report);
    return report;
  },

  // ⬇️ NEW: Quick route check
  checkRoutes: async () => {
    const results = [];
    for (const [route, config] of Object.entries(ROUTES)) {
      try {
        const [htmlRes, jsRes] = await Promise.all([
          fetch(config.html, { method: 'HEAD', cache: 'no-store' }).catch(() => ({ ok: false, status: 0 })),
          fetch(config.js, { method: 'HEAD', cache: 'no-store' }).catch(() => ({ ok: false, status: 0 })),
        ]);
        results.push({
          route: route.replace('#/admin/', ''),
          html: htmlRes.status,
          js: jsRes.status,
          ok: htmlRes.ok && jsRes.ok ? '✅' : '❌',
        });
      } catch (e) {
        results.push({ route, error: e.message, ok: '❌' });
      }
    }
    console.table(results);
    return results;
  },
};

console.log(
  '%c App v27.5.0 — Route Normalizer + Circuit-Breaker Aware ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
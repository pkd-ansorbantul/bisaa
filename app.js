// ============================================================
// js/app.js — v27.3.2 FINAL STABLE EDITION
// ============================================================
// CHANGELOG v27.3.2 (dari v27.3.1):
//   ✅ FIX: Parallel preload (fragments + data) — boot lebih cepat
//   ✅ FIX: Loader dengan progress informatif
//   ✅ FIX: Data preload blocking dengan timeout 15s
//     → Dashboard render langsung dengan data (bukan skeleton)
//   ✅ FIX: Fallback ke skeleton kalau timeout
//   ✅ FIX: Race-safe navigation + token guard
//   ✅ NEW: window.__pkd.isDataReady() untuk cek status data
//   ✅ NEW: Event 'pkd:data-ready' dan 'pkd:app-loaded'
//   ✅ KEEP: Semua 18 routes + interactive features
//   ✅ KEEP: Preload quiz questions (pretest + posttest)
//   ✅ KEEP: Safe import dengan retry + failed tracking
//   ✅ KEEP: Auto-sync idle-aware 60s
//   ✅ KEEP: BFCache guard + beforeunload guard
//   ✅ KEEP: Keyboard shortcuts Alt+D/P/A/S/R/Q/M/K/T
//   ✅ KEEP: Subscription + manual refresh via window.__pkd
// ============================================================

import {
  getUserRole,
  updateNavbarMenu,
  loadAuthState,
  escapeHtml,
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
const APP_VERSION = '27.3.2';

const DATA_PRELOAD_TIMEOUT_MS       = 15000;   // 15s — blocking max
const AUTO_SYNC_INTERVAL_MS         = 60000;   // 60s
const IDLE_THRESHOLD_MS             = 5 * 60 * 1000; // 5 menit
const FAILED_MODULE_RETRY_DELAY_MS  = 3000;    // 3s
const FAILED_MODULE_MAX_RETRY       = 3;
const QUIZ_PRELOAD_DELAY_MS         = 2000;    // 2s setelah SPA start

// ============================================================
//   ROUTES — 18 Views
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
//   MODULE STATE
// ============================================================
let router = null;
let isBooted = false;
let autoSyncInterval = null;
let isSyncing = false;
let adminModule = null;
let lastUserActivity = Date.now();
let dataReady = false;

// Track failed modules untuk retry
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

// ============================================================
//   SAFE DYNAMIC IMPORT dengan RETRY
// ============================================================
async function safeImport(url, options = {}) {
  const { silent = false, maxRetry = 2 } = options;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const importUrl = attempt === 0
        ? url
        : `${url}?retry=${Date.now()}&attempt=${attempt}`;

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
        if (!silent) console.error(`[SafeImport] Non-retryable: ${url} — ${msg}`);
        throw e;
      }

      if (attempt < maxRetry) {
        if (!silent) {
          console.warn(`[SafeImport] Retry ${attempt + 1}/${maxRetry}: ${url}`);
        }
        await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      } else {
        const info = window.__pkdFailedModules.get(url) || { count: 0, lastError: '' };
        window.__pkdFailedModules.set(url, {
          count: info.count + 1,
          lastError: msg,
        });
        if (!silent) console.error(`[SafeImport] ❌ FAILED: ${url}`, msg);
        throw e;
      }
    }
  }

  throw lastError || new Error('SafeImport failed');
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

  const safeMsg    = escapeHtml(message || 'Terjadi kesalahan.');
  const safeDetail = detail ? escapeHtml(detail) : '';
  const safeLogin  = escapeHtml(LOGIN_PATH);

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

  shell.querySelector('[data-shell-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });

  shell.querySelector('[data-shell-action="clearcache"]')?.addEventListener('click', async () => {
    if (!confirm('Hapus cache browser & reload?\n\nData akan diambil ulang dari server.')) return;
    try {
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map(n => caches.delete(n)));
      }
      sessionStorage.clear();
      const authKeys = ['pkd_auth'];
      const toKeep = {};
      authKeys.forEach(k => {
        const v = localStorage.getItem(k);
        if (v) toKeep[k] = v;
      });
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
        Promise.resolve(loadSidebar()).catch(e => {
          console.error('[Boot] Sidebar load failed:', e);
          throw e;
        }),
        Promise.resolve(loadBottomNav()).catch(e => {
          console.error('[Boot] Bottom-nav load failed:', e);
          throw e;
        }),
      ]);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetry) {
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  throw lastErr || new Error('Gagal memuat partials');
}

// ============================================================
//   PRELOAD DATA (via getBootstrapData batch)
//   ⚡ BLOCKING sampai siap atau timeout 15s
// ============================================================
async function preloadAllData() {
  console.log('[Boot] ⚡ Preloading data (blocking, timeout 15s)...');
  updateLoaderText('Memuat data...');

  const startTime = Date.now();

  try {
    const mod = await safeImport('./modules/admin.js', { silent: true });
    adminModule = mod.AdminModule || mod.default;

    if (!adminModule) {
      throw new Error('AdminModule tidak tersedia');
    }

    const loadPromise = adminModule.loadAllData(true);

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ __timeout: true }), DATA_PRELOAD_TIMEOUT_MS);
    });

    const result = await Promise.race([loadPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;

    if (result && result.__timeout) {
      console.warn(`[Boot] ⚠️ Data preload TIMEOUT after ${elapsed}ms — fallback to skeleton`);

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
      const stats = adminModule.getStats() || {};
      console.log(`[Boot] ✅ Data preloaded in ${elapsed}ms via ${result.source || 'unknown'}`);
      console.log('[Boot] Stats:', {
        peserta: stats.totalPeserta || 0,
        sesi: stats.totalSesi || 0,
        materi: stats.totalMateri || 0,
        alumni: stats.totalAlumni || 0,
      });
      dataReady = true;
      window.dispatchEvent(new CustomEvent('pkd:data-ready'));
      return { success: true, elapsed };
    }

    console.warn('[Boot] ⚠️ Preload partial:', result?.error);
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
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then(html => {
        if (html && html.trim() && router) {
          router.fragmentCache.set(cfg.html, html);
        }
        loaded++;
        updateLoaderProgress(loaded, total);
      })
      .catch((err) => {
        console.warn(`[Boot] ⚠️ Fragment failed: ${cfg.html}`, err.message);
        loaded++;
        updateLoaderProgress(loaded, total);
      });

    const jsTask = safeImport(cfg.js, { silent: true })
      .then(() => {
        loaded++;
        updateLoaderProgress(loaded, total);
      })
      .catch((err) => {
        console.warn(`[Boot] ⚠️ Module failed: ${cfg.js}`, err.message);
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
//   PRELOAD QUIZ QUESTIONS (Pretest + Posttest)
// ============================================================
function preloadQuizQuestions() {
  setTimeout(async () => {
    console.log('[Boot] ⚡ Preloading quiz questions (pretest + posttest)...');

    const tasks = [
      safeImport(BASE_PATH + 'views/admin/pretest.js', { silent: true })
        .then(mod => {
          if (mod && typeof mod.preloadData === 'function') return mod.preloadData();
          return { success: false, error: 'preloadData not exported' };
        })
        .catch(e => ({ success: false, error: e.message })),

      safeImport(BASE_PATH + 'views/admin/posttest.js', { silent: true })
        .then(mod => {
          if (mod && typeof mod.preloadData === 'function') return mod.preloadData();
          return { success: false, error: 'preloadData not exported' };
        })
        .catch(e => ({ success: false, error: e.message })),
    ];

    const results = await Promise.allSettled(tasks);

    results.forEach((r, i) => {
      const kind = i === 0 ? 'pretest' : 'posttest';
      if (r.status === 'fulfilled' && r.value && r.value.success) {
        console.log(`[Boot] ✅ ${kind} questions preloaded: ${r.value.count ?? 0} items (via ${r.value.source || 'unknown'})`);
      } else {
        const err = (r.status === 'fulfilled' && r.value && r.value.error) || r.reason?.message || 'unknown';
        console.warn(`[Boot] ⚠️ ${kind} preload failed: ${err}`);
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
      if (info && info.count >= FAILED_MODULE_MAX_RETRY) {
        console.error(`[Boot] ❌ Giving up: ${url}`);
        continue;
      }

      try {
        await safeImport(url, { silent: false, maxRetry: 0 });
        console.log(`[Boot] ✅ Retry OK: ${url}`);
      } catch (e) {
        console.warn(`[Boot] ⚠️ Retry failed: ${url}`, e.message);
      }
    }

    if (failed.size > 0) {
      scheduleFailedModuleRetry();
    }
  }, FAILED_MODULE_RETRY_DELAY_MS);
}

// ============================================================
//   AUTO-SYNC GLOBAL (IDLE-AWARE)
// ============================================================
(function trackUserActivity() {
  const handler = () => { lastUserActivity = Date.now(); };
  ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(ev => {
    window.addEventListener(ev, handler, { passive: true });
  });
})();

function startAutoSync() {
  if (autoSyncInterval) {
    console.warn('[AutoSync] Sudah berjalan, skip');
    return;
  }

  console.log(`[AutoSync] ✅ Started (${AUTO_SYNC_INTERVAL_MS / 1000}s, idle-aware)`);

  autoSyncInterval = setInterval(async () => {
    if (document.hidden || isSyncing) return;
    if (Date.now() - lastUserActivity > IDLE_THRESHOLD_MS) return;
    if (!adminModule) return;

    isSyncing = true;
    try {
      const result = await adminModule.loadAllData(false);
      if (result && result.success && !result.skipped) {
        console.log('[AutoSync] ✅ Data synced');
      }
    } catch (e) {
      console.warn('[AutoSync] Failed:', e.message);
    } finally {
      isSyncing = false;
    }
  }, AUTO_SYNC_INTERVAL_MS);
}

function stopAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
    console.log('[AutoSync] Stopped');
  }
}

// ============================================================
//   INTERACTIVE FEATURES
// ============================================================
async function mountInteractiveFeatures() {
  try {
    mountThemeToggle();
    console.log('[Boot] ✅ Theme Toggle');
  } catch (e) {
    console.warn('[Boot] Theme Toggle gagal:', e);
  }

  try {
    mountCommandPalette();
    console.log('[Boot] ✅ Command Palette');
  } catch (e) {
    console.warn('[Boot] Command Palette gagal:', e);
  }

  try {
    await mountNotificationCenter();
    console.log('[Boot] ✅ Notification Center');
  } catch (e) {
    console.warn('[Boot] Notification Center gagal:', e);
  }
}

// ============================================================
//   BOOT SEQUENCE — v27.3.2
// ============================================================
async function boot() {
  if (isBooted) {
    console.warn('[Boot] Sudah dijalankan, skip.');
    return;
  }
  isBooted = true;

  console.log(`[Boot] Starting PKD GP Ansor Admin v${APP_VERSION}...`);
  const bootStart = Date.now();

  // ===== 1. Load auth state =====
  try { loadAuthState(); }
  catch (e) { console.error('[Boot] loadAuthState failed:', e); }

  // ===== 2. Cek role =====
  const role = getUserRole();
  if (role !== 'admin') {
    console.warn('[Boot] Non-admin role:', role, '→ redirect ke login');
    window.location.replace(LOGIN_PATH);
    return;
  }

  // ===== 3. Update navbar =====
  try { updateNavbarMenu(); }
  catch (e) { console.warn('[Boot] updateNavbarMenu failed:', e); }

  // ===== 4. Load partials =====
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

  // ===== 5. Cek view container =====
  const viewContainer = findElement(['view-container', 'appOutlet']);
  if (!viewContainer) {
    console.error('[Boot] #view-container tidak ditemukan');
    renderShellError('Elemen #view-container tidak ditemukan di DOM.');
    return;
  }

  // ===== 6. Create router =====
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

    window.__router  = router;
    window.__routes  = ROUTES;
    window.__pkdAppVersion = APP_VERSION;
  } catch (e) {
    console.error('[Boot] Failed to create router:', e);
    renderShellError('Gagal inisialisasi router.', e.message);
    return;
  }

  // ============================================================
  // 7. PARALLEL PRELOAD: fragments + data
  //    Loader tetap tampil sampai keduanya selesai (timeout 15s)
  // ============================================================
  updateLoaderText('Memuat menu & data...');

  // Fragment + module preload (parallel)
  const fragmentsPromise = preloadAllFragmentsAndModules();

  // Data preload (blocking, timeout 15s)
  const dataPromise = preloadAllData();

  // Tunggu keduanya selesai
  await Promise.allSettled([fragmentsPromise, dataPromise]);

  console.log('[Boot] ✅ Preload complete (fragments + data)');

  // ⚡ Preload quiz questions di background (non-blocking)
  preloadQuizQuestions();
  scheduleFailedModuleRetry();

  // ===== 8. Set default hash =====
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') {
    window.location.hash = DEFAULT_ROUTE;
  }

  // ===== 9. Start SPA =====
  updateLoaderText('Menyiapkan halaman...');
  try {
    router.start();
    console.log('[Boot] ✅ SPA started');
  } catch (e) {
    console.error('[Boot] Router start failed:', e);
    renderShellError('Gagal memulai navigasi.', e.message);
    return;
  }

  // ===== 10. Hide loader, show app =====
  updateLoaderText('Siap!');
  hideInitialLoader();
  showAppShell();
  window.__pkdAppLoaded = true;
  window.dispatchEvent(new CustomEvent('pkd:app-loaded'));

  // ===== 11. Mount interactive features =====
  await mountInteractiveFeatures();

  // ===== 12. Start auto-sync =====
  startAutoSync();

  // ===== 13. Install global handlers =====
  installKeyboardShortcuts();
  installBeforeUnloadGuard();
  installBfcacheGuard();
  installTitleUpdate();

  // ===== 14. Done =====
  const totalBoot = Date.now() - bootStart;
  console.log(
    `%c PKD GP Ansor Bantul — SPA v${APP_VERSION} `,
    'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;',
    `Routes: ${getRouteCount()} | Boot: ${totalBoot}ms | Data: ${dataReady ? '✅ Ready' : '⚠️ Skeleton'}`
  );
}

// ============================================================
//   KEYBOARD SHORTCUTS
// ============================================================
function installKeyboardShortcuts() {
  if (window.__pkdShortcutsInstalled) return;
  window.__pkdShortcutsInstalled = true;

  document.addEventListener('keydown', function (e) {
    const tag = (e.target && e.target.tagName) || '';
    if (
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
      (e.target && e.target.isContentEditable)
    ) return;

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
      if (role !== 'admin') {
        window.location.replace(LOGIN_PATH);
      }
    } catch (err) {
      window.location.replace(LOGIN_PATH);
    }
  });
}

// ============================================================
//   TITLE UPDATE ON ROUTE CHANGE
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
//   EXPOSE DEBUG HELPERS
// ============================================================
window.__pkd = {
  version: APP_VERSION,

  // Data status
  isDataReady: () => dataReady,
  getStats: () => adminModule ? adminModule.getStats() : null,

  // Router
  getRouter: () => router,
  getRoutes: () => ROUTES,
  getRouteCount: getRouteCount,
  navigate: (hash) => router && router.navigate(hash),
  reload: () => router && router.reload(),
  destroy: () => router && router.destroy(),

  // Interactive features
  openPalette: () => window.dispatchEvent(new CustomEvent('palette:open')),
  closePalette: () => window.dispatchEvent(new CustomEvent('palette:close')),
  toggleTheme: () => window.dispatchEvent(new CustomEvent('theme:toggle')),
  setTheme: (t) => window.dispatchEvent(new CustomEvent('theme:set', { detail: { theme: t } })),
  openShortcuts: () => window.dispatchEvent(new CustomEvent('shortcuts:open')),

  // Data management
  getAdminModule: () => adminModule,
  forceSync: async () => {
    if (!adminModule) {
      console.warn('[forceSync] AdminModule belum siap');
      return { success: false, error: 'AdminModule belum siap' };
    }
    console.log('[forceSync] ⚡ Forcing full data sync...');
    const t0 = Date.now();
    const result = await adminModule.loadAllData(true);
    const elapsed = Date.now() - t0;
    console.log(`[forceSync] ${result.success ? '✅' : '⚠️'} Done in ${elapsed}ms`);
    return { ...result, elapsed };
  },

  forceSyncAll: async () => {
    if (router) router.fragmentCache.clear();
    if (adminModule) await adminModule.loadAllData(true);
    if (router) await router.reload();
  },

  // Failed modules inspection
  getFailedModules: () => {
    const result = {};
    window.__pkdFailedModules.forEach((v, k) => { result[k] = v; });
    return result;
  },
  clearFailedModules: () => {
    window.__pkdFailedModules.clear();
    console.log('[__pkd] Failed modules cleared');
  },
  retryFailedModules: async () => {
    const failed = window.__pkdFailedModules;
    if (failed.size === 0) {
      console.log('[__pkd] No failed modules');
      return;
    }
    const urls = Array.from(failed.keys());
    for (const url of urls) {
      try {
        await safeImport(url, { silent: false, maxRetry: 1 });
        console.log(`[__pkd] ✅ Retry OK: ${url}`);
      } catch (e) {
        console.warn(`[__pkd] ⚠️ Retry failed: ${url}`, e.message);
      }
    }
  },

  // Quiz preload (manual trigger)
  preloadQuiz: () => preloadQuizQuestions(),

  // Auto-sync control
  startAutoSync,
  stopAutoSync,
  isAutoSyncRunning: () => !!autoSyncInterval,
};

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c App v27.3.2 — Final Stable Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
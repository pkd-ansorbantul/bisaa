// ============================================================
// js/app.js — v27.2.1 ROBUST BOOT EDITION
// ============================================================
// CHANGELOG v27.2.1 (dari v27.2.0):
//   ✅ FIX CRITICAL: Preload data tidak lagi blocking render view
//     → User lihat dashboard dalam 2-3s (bukan 10s+)
//   ✅ FIX: Soft-skip preload data setelah 10s — app jalan dulu
//   ✅ FIX: Fragment/module preload blocking, data preload background
//   ✅ FIX: Timeout guard lebih longgar untuk cold start GAS
//   ✅ FIX: Silent error saat preload (tidak crash app)
//   ✅ FIX: Auto-sync idle-aware + guard race condition
//   ✅ KEEP: Semua 18 routes + interactive features
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

// ✅ Local constant
const APP_VERSION = '27.2.1';

// ============================================================
//   v27.2.1: TIMEOUT CONSTANTS (lebih longgar untuk cold start)
// ============================================================
const PRELOAD_DATA_SOFT_SKIP_MS = 10000;  // 10s — kalau data belum siap, skip (background)
const AUTO_SYNC_INTERVAL_MS = 60000;      // 60s
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;  // 5 menit

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
//   GLOBAL ERROR HANDLERS
// ============================================================
(function setupGlobalErrorHandlers() {
  window.addEventListener('error', function (e) {
    const msg = (e && e.message) || '';
    const filename = (e && e.filename) || '';

    const isModuleError =
      msg.includes('Failed to resolve module') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('Cannot find module') ||
      msg.includes('Importing a module script failed') ||
      msg.includes('404') ||
      filename.includes('api.js');

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

  const safeMsg    = escapeHtml(message || 'Terjadi kesalahan saat memuat aplikasi.');
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
          <a href="${safeLogin}" class="btn btn-outline-secondary rounded-pill px-4">
            <i class="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i> Login Ulang
          </a>
        </div>
      </div>
    </div>`;

  shell.querySelector('[data-shell-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });
}

// ============================================================
//   PARTIALS LOADER — 1× retry
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
//   ⚡ v27.2.1: PRELOAD DATA dengan SOFT-SKIP
//   Kalau data belum siap dalam 10s, skip — app jalan dulu
// ============================================================
async function preloadAllData() {
  console.log('[Boot] ⚡ Preloading all data (background)...');
  updateLoaderText('Memuat data...');

  const startTime = Date.now();

  try {
    const mod = await import('./modules/admin.js');
    adminModule = mod.AdminModule || mod.default;

    if (!adminModule) {
      throw new Error('AdminModule tidak tersedia');
    }

    // ⚡ Race: data load vs soft-skip timeout
    const loadPromise = adminModule.loadAllData(true);

    const softSkipPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({ __softSkip: true });
      }, PRELOAD_DATA_SOFT_SKIP_MS);
    });

    const result = await Promise.race([loadPromise, softSkipPromise]);
    const elapsed = Date.now() - startTime;

    if (result && result.__softSkip) {
      // Soft-skip: biarkan loadPromise jalan di background
      console.warn(`[Boot] ⚠️ Soft-skip preload data after ${elapsed}ms — app jalan dulu`);
      // Tangkap hasil di background (tidak unhandled)
      loadPromise
        .then((r) => {
          if (r && r.success) {
            console.log('[Boot] ✅ Data loaded in background');
            window.dispatchEvent(new CustomEvent('pkd:data-ready'));
          } else {
            console.warn('[Boot] ⚠️ Background load partial:', r?.error);
          }
        })
        .catch((e) => console.warn('[Boot] Background load error:', e.message));

      return { success: false, error: 'soft-skip', softSkip: true };
    }

    if (result && result.success) {
      const stats = adminModule.getStats() || {};
      console.log(`[Boot] ✅ Data preloaded in ${elapsed}ms via ${result.source || 'unknown'}`);
      console.log('[Boot] Stats:', {
        peserta: stats.totalPeserta || 0,
        sesi: stats.totalSesi || 0,
        materi: stats.totalMateri || 0,
        timInstruktur: stats.totalTimInstruktur || 0,
      });
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
//   ⚡ v27.2.1: PRELOAD SEMUA FRAGMENT HTML + MODULE JS
//   Ini BLOCKING — selesai dulu baru render view pertama
// ============================================================
async function preloadAllFragmentsAndModules() {
  const totalRoutes = Object.keys(ROUTES).length;
  updateLoaderText(`Memuat ${totalRoutes} menu...`);

  const entries = Object.entries(ROUTES);
  let loaded = 0;
  const total = totalRoutes * 2; // fragments + modules

  const tasks = entries.flatMap(([route, cfg]) => {
    // Prefetch HTML fragment
    const htmlTask = fetch(cfg.html, { cache: 'force-cache' })
      .then(r => r.ok ? r.text() : null)
      .then(html => {
        if (html && html.trim() && router) {
          router.fragmentCache.set(cfg.html, html);
        }
        loaded++;
        updateLoaderProgress(loaded, total);
      })
      .catch(() => {
        loaded++;
        updateLoaderProgress(loaded, total);
      });

    // Preload JS module
    const jsTask = import(cfg.js)
      .then(() => {
        loaded++;
        updateLoaderProgress(loaded, total);
      })
      .catch(() => {
        loaded++;
        updateLoaderProgress(loaded, total);
      });

    return [htmlTask, jsTask];
  });

  await Promise.allSettled(tasks);
  console.log(`[Boot] ✅ Preloaded ${totalRoutes} fragments + ${totalRoutes} modules`);
}

// ============================================================
//   ⚡ AUTO-SYNC GLOBAL (IDLE-AWARE)
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

  console.log(`[AutoSync] ✅ Started (interval: ${AUTO_SYNC_INTERVAL_MS / 1000}s, idle-aware)`);

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
    console.log('[Boot] ✅ Theme Toggle mounted');
  } catch (e) {
    console.warn('[Boot] Theme Toggle gagal mount:', e);
  }

  try {
    mountCommandPalette();
    console.log('[Boot] ✅ Command Palette mounted');
  } catch (e) {
    console.warn('[Boot] Command Palette gagal mount:', e);
  }

  try {
    await mountNotificationCenter();
    console.log('[Boot] ✅ Notification Center mounted');
  } catch (e) {
    console.warn('[Boot] Notification Center gagal mount:', e);
  }
}

// ============================================================
//   BOOT SEQUENCE — v27.2.1 ROBUST
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
    console.warn('[Boot] Non-admin role detected:', role, '→ redirect ke login');
    window.location.replace(LOGIN_PATH);
    return;
  }

  // ===== 3. Update navbar =====
  try { updateNavbarMenu(); }
  catch (e) { console.warn('[Boot] updateNavbarMenu failed:', e); }

  // ===== 4. Load partials (sidebar + bottom-nav) =====
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
    console.error('[Boot] #view-container tidak ditemukan di DOM');
    renderShellError('Elemen #view-container tidak ditemukan di DOM.');
    return;
  }

  // ===== 6. Create router (SEBELUM preload fragment) =====
  try {
    router = new Router(viewContainer, ROUTES, {
      defaultRoute: DEFAULT_ROUTE,
      scrollBehavior: 'top',
      useCacheBuster: false,
      showLoadingUI: true,
      maxRetries: 1,
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

  // ===== 7. ⚡ PRELOAD: fragment + module (BLOCKING), data (background) =====
  updateLoaderText('Memuat menu...');

  // Data preload jalan di background — TIDAK di-await
  const dataPromise = preloadAllData();

  // Fragment + module preload — BLOCKING sebentar (0.5s-2s)
  try {
    await preloadAllFragmentsAndModules();
    console.log('[Boot] ✅ Fragments + modules ready');
  } catch (e) {
    console.warn('[Boot] Preload fragments partial:', e.message);
  }

  // ===== 8. Set default hash =====
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') {
    window.location.hash = DEFAULT_ROUTE;
  }

  // ===== 9. Start SPA (JANGAN tunggu data preload) =====
  try {
    router.start();
    console.log('[Boot] ✅ SPA started for admin');
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

  // ===== 14. Await data preload di BACKGROUND (tidak block UI) =====
  dataPromise
    .then((result) => {
      if (result.success) {
        console.log(`[Boot] ✅ Data preload OK (${result.elapsed}ms)`);
      } else if (result.softSkip) {
        console.warn(`[Boot] ⚠️ Data preload soft-skipped (background)`);
      } else {
        console.warn(`[Boot] ⚠️ Data preload partial: ${result.error}`);
      }
    })
    .catch((e) => console.warn('[Boot] Data preload error:', e));

  // ===== 15. Done =====
  const totalBoot = Date.now() - bootStart;
  console.log(
    `%c PKD GP Ansor Bantul — SPA v${APP_VERSION} `,
    'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;',
    `Routes: ${getRouteCount()} | Boot: ${totalBoot}ms | Auto-sync: 60s`
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
    const hasOpenModal = document.querySelector('.modal.show');
    if (!hasOpenModal) return;
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

    console.log('[Boot] Page restored from bfcache, checking auth...');

    if (!window.__pkdAppLoaded) {
      console.log('[Boot] bfcache: app belum pernah load, skip guard');
      return;
    }

    try {
      const role = getUserRole();
      if (role !== 'admin') {
        console.log('[Boot] bfcache: role invalid → redirect to login');
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

    const path = detail.path
      .replace('#/admin/', '')
      .replace(/\//g, ' ');

    const title = path
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

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

  // Force sync + clear cache + reload view
  forceSyncAll: async () => {
    console.log('[forceSyncAll] ⚡ Force sync everything...');
    if (router) router.fragmentCache.clear();
    if (adminModule) await adminModule.loadAllData(true);
    if (router) await router.reload();
  },

  startAutoSync,
  stopAutoSync,
  isAutoSyncRunning: () => !!autoSyncInterval,
  getStats: () => adminModule ? adminModule.getStats() : null,
};

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c App v27.2.1 — Robust Boot Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
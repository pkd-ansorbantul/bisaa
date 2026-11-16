// ============================================================
// js/app.js — Full Production SPA Bootstrap (v26.1.6)
// ============================================================
// Entry point SPA admin. Tanggung jawab:
//   1. Load auth state dari storage
//   2. Guard: redirect non-admin ke login
//   3. Load partials (sidebar + bottom-nav) secara paralel
//   4. Setup Router + register routes (18 routes)
//   5. Hide initial loader & show app shell
//   6. Set flag __pkdAppLoaded (untuk fallback timer di app.html)
//   7. Global error handlers (module load failure, unhandled rejection)
//   8. Global keyboard shortcuts
//   9. Warn before unload jika ada modal terbuka
//
// v26.1.6 UPDATE:
//   ✅ Tambah route #/admin/tim-instruktur
//   ✅ Keyboard shortcut Alt+T → Tim Instruktur
//   ✅ Route count dinamis di console banner
// ============================================================

import {
  getUserRole,
  updateNavbarMenu,
  loadAuthState,
} from './core/api.js';

import { loadSidebar } from './components/sidebar.js';
import { loadBottomNav } from './components/bottom-nav.js';
import Router from './router.js';

// ============================================================
//   APP VERSION & ROUTE REGISTRY — 18 Views
// ============================================================
const APP_VERSION = '26.1.6';

const ROUTES = {
  '#/admin/dashboard':       { html: '/bisaa/views/admin/dashboard.html',       js: '/bisaa/views/admin/dashboard.js' },
  '#/admin/peserta':         { html: '/bisaa/views/admin/peserta.html',         js: '/bisaa/views/admin/peserta.js' },
  '#/admin/alumni':          { html: '/bisaa/views/admin/alumni.html',          js: '/bisaa/views/admin/alumni.js' },
  '#/admin/kader':           { html: '/bisaa/views/admin/kader.html',           js: '/bisaa/views/admin/kader.js' },
  '#/admin/tim-instruktur':  { html: '/bisaa/views/admin/tim-instruktur.html',  js: '/bisaa/views/admin/tim-instruktur.js' },   // ⭐ v26.1.6
  '#/admin/sesi-absen':      { html: '/bisaa/views/admin/sesi-absen.html',      js: '/bisaa/views/admin/sesi-absen.js' },
  '#/admin/data-absensi':    { html: '/bisaa/views/admin/data-absensi.html',    js: '/bisaa/views/admin/data-absensi.js' },
  '#/admin/rekap-absensi':   { html: '/bisaa/views/admin/rekap-absensi.html',   js: '/bisaa/views/admin/rekap-absensi.js' },
  '#/admin/skrining':        { html: '/bisaa/views/admin/skrining.html',        js: '/bisaa/views/admin/skrining.js' },
  '#/admin/sertifikat':      { html: '/bisaa/views/admin/sertifikat.html',      js: '/bisaa/views/admin/sertifikat.js' },
  '#/admin/tanda-tangan':    { html: '/bisaa/views/admin/tanda-tangan.html',    js: '/bisaa/views/admin/tanda-tangan.js' },
  '#/admin/rtl':             { html: '/bisaa/views/admin/rtl.html',             js: '/bisaa/views/admin/rtl.js' },
  '#/admin/pengaturan':      { html: '/bisaa/views/admin/pengaturan.html',      js: '/bisaa/views/admin/pengaturan.js' },
  '#/admin/informasi':       { html: '/bisaa/views/admin/informasi.html',       js: '/bisaa/views/admin/informasi.js' },
  '#/admin/asset':           { html: '/bisaa/views/admin/asset.html',           js: '/bisaa/views/admin/asset.js' },
  '#/admin/pretest':         { html: '/bisaa/views/admin/pretest.html',         js: '/bisaa/views/admin/pretest.js' },
  '#/admin/posttest':        { html: '/bisaa/views/admin/posttest.html',        js: '/bisaa/views/admin/posttest.js' },
  '#/admin/materi':          { html: '/bisaa/views/admin/materi.html',          js: '/bisaa/views/admin/materi.js' },
};

const DEFAULT_ROUTE = '#/admin/dashboard';
const LOGIN_PATH    = '/bisaa/login.html';

// ============================================================
//   MODULE STATE
// ============================================================
let router = null;
let isBooted = false;

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

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getRouteCount() {
  return Object.keys(ROUTES).length;
}

// ============================================================
//   GLOBAL ERROR HANDLERS
//   (dipasang SEBELUM boot supaya menangkap error saat load module)
// ============================================================
(function setupGlobalErrorHandlers() {
  // --- Error saat load module ES ---
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

      const dashboardContent = document.getElementById('dashboardContent');
      if (dashboardContent) dashboardContent.innerHTML = '';

      const refreshBtn = document.getElementById('refreshDataBtn');
      if (refreshBtn) refreshBtn.style.display = 'none';

      const cacheStatus = document.getElementById('cacheStatus');
      if (cacheStatus) cacheStatus.textContent = 'Error 404';
    }
  }, true);

  // --- Unhandled promise rejection ---
  window.addEventListener('unhandledrejection', function (e) {
    const reason = e && e.reason;
    const msg = (reason && reason.message) || String(reason || '');

    // Filter error yang tidak critical
    if (msg.includes('AbortError') || msg.includes('Request timeout')) {
      return;
    }

    console.error('[UnhandledRejection]', reason);
  });
})();

// ============================================================
//   LOADING & ERROR UI HELPERS
// ============================================================
function renderShellLoading() {
  const shell = findElement(['appShell', 'adminWrapper']);
  if (!shell) return;

  shell.innerHTML = `
    <div class="d-flex justify-content-center align-items-center" style="min-height:100vh;">
      <div class="text-center">
        <div class="spinner-border text-primary" style="width:3rem;height:3rem;"></div>
        <p class="mt-3 text-muted small mb-0">Memuat aplikasi…</p>
      </div>
    </div>
  `;
}

function renderShellError(message, detail) {
  const shell = findElement(['appShell', 'adminWrapper']);
  if (!shell) return;

  const safeMsg    = escapeHtml(message || 'Terjadi kesalahan saat memuat aplikasi.');
  const safeDetail = detail ? escapeHtml(detail) : '';

  shell.innerHTML = `
    <div class="d-flex justify-content-center align-items-center p-4" style="min-height:100vh;">
      <div class="text-center" style="max-width:560px;">
        <i class="bi bi-exclamation-triangle-fill text-danger" style="font-size:4rem;"></i>
        <h4 class="fw-bold mt-3">Gagal Memuat Aplikasi</h4>
        <p class="text-muted small">${safeMsg}</p>
        ${safeDetail ? `<div class="alert alert-danger small text-start">${safeDetail}</div>` : ''}
        <div class="d-flex gap-2 justify-content-center flex-wrap mt-3">
          <button class="btn btn-primary rounded-pill px-4" data-shell-action="reload">
            <i class="bi bi-arrow-clockwise me-1"></i> Refresh
          </button>
          <a href="${LOGIN_PATH}" class="btn btn-outline-secondary rounded-pill px-4">
            <i class="bi bi-box-arrow-in-right me-1"></i> Login Ulang
          </a>
        </div>
      </div>
    </div>
  `;

  shell.querySelector('[data-shell-action="reload"]')?.addEventListener('click', () => {
    window.location.reload();
  });
}

// ============================================================
//   HIDE INITIAL LOADER & SHOW APP SHELL
// ============================================================
function hideInitialLoader() {
  const loader = document.getElementById('initialLoader');
  if (!loader) return;

  loader.classList.add('hidden');

  // Hapus elemen setelah animasi selesai
  setTimeout(() => {
    try { loader.remove(); } catch (e) { /* ignore */ }
  }, 400);
}

function showAppShell() {
  const shell = findElement(['appShell', 'adminWrapper']);
  if (!shell) return;

  shell.style.removeProperty('visibility');
  shell.style.visibility = 'visible';
  shell.classList.add('is-ready');
}

// ============================================================
//   PARTIALS LOADER — dengan 1× retry
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
//   BOOT SEQUENCE
// ============================================================
async function boot() {
  // Cegah double-boot
  if (isBooted) {
    console.warn('[Boot] Sudah dijalankan, skip.');
    return;
  }
  isBooted = true;

  // ----------------------------------------------------------
  //   1. Load auth state dari session/localStorage
  // ----------------------------------------------------------
  try {
    loadAuthState();
  } catch (e) {
    console.error('[Boot] loadAuthState failed:', e);
  }

  // ----------------------------------------------------------
  //   2. Guard: redirect jika bukan admin
  // ----------------------------------------------------------
  const role = getUserRole();
  if (role !== 'admin') {
    console.warn('[Boot] Non-admin role detected:', role, '→ redirect ke login');
    window.location.replace(LOGIN_PATH);
    return;
  }

  // ----------------------------------------------------------
  //   3. Update navbar user menu
  // ----------------------------------------------------------
  try {
    updateNavbarMenu();
  } catch (e) {
    console.warn('[Boot] updateNavbarMenu failed:', e);
  }

  // ----------------------------------------------------------
  //   4. Load partials: sidebar + bottom-nav (paralel + retry)
  // ----------------------------------------------------------
  try {
    await loadPartialsWithRetry();
  } catch (e) {
    console.error('[Boot] Failed to load partials:', e);
    renderShellError(
      'Gagal memuat komponen navigasi.',
      'Pastikan file /bisaa/partials/sidebar.html dan /bisaa/partials/bottom-nav.html tersedia.'
    );
    return;
  }

  // ----------------------------------------------------------
  //   5. Cari view container
  // ----------------------------------------------------------
  const viewContainer = findElement(['view-container', 'appOutlet']);
  if (!viewContainer) {
    console.error('[Boot] #view-container / #appOutlet tidak ditemukan di DOM');
    renderShellError('Elemen #view-container tidak ditemukan di DOM.');
    return;
  }

  // ----------------------------------------------------------
  //   6. Setup Router
  // ----------------------------------------------------------
  try {
    router = new Router(viewContainer, ROUTES, {
      defaultRoute: DEFAULT_ROUTE,
      scrollBehavior: 'top',
      useCacheBuster: true,
      showLoadingUI: true,
      maxRetries: 1,
      debug: false,
    });

    // Expose ke window untuk debugging
    window.__router  = router;
    window.__routes  = ROUTES;
    window.__pkdAppVersion = APP_VERSION;
  } catch (e) {
    console.error('[Boot] Failed to create router:', e);
    renderShellError('Gagal inisialisasi router.', e.message);
    return;
  }

  // ----------------------------------------------------------
  //   7. Handle missing hash → redirect ke default
  // ----------------------------------------------------------
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') {
    window.location.hash = DEFAULT_ROUTE;
    // 'hashchange' akan trigger router render
  }

  // ----------------------------------------------------------
  //   8. Start router
  // ----------------------------------------------------------
  try {
    router.start();
    console.log('[Boot] ✅ SPA started for admin');
  } catch (e) {
    console.error('[Boot] Router start failed:', e);
    renderShellError('Gagal memulai navigasi.', e.message);
    return;
  }

  // ----------------------------------------------------------
  //   9. Hide loader + show app shell + flag loaded
  // ----------------------------------------------------------
  hideInitialLoader();
  showAppShell();
  window.__pkdAppLoaded = true;

  // ----------------------------------------------------------
  //   10. Install global keyboard shortcuts
  // ----------------------------------------------------------
  installKeyboardShortcuts();

  // ----------------------------------------------------------
  //   11. Warn before unload jika ada modal terbuka
  // ----------------------------------------------------------
  installBeforeUnloadGuard();

  // ----------------------------------------------------------
  //   12. Console banner (dynamic route count)
  // ----------------------------------------------------------
  console.log(
    `%c PKD GP Ansor Bantul — SPA v${APP_VERSION} `,
    'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;',
    `Routes: ${getRouteCount()}`
  );
}

// ============================================================
//   KEYBOARD SHORTCUTS
// ============================================================
function installKeyboardShortcuts() {
  // Guard supaya tidak dobel saat app.js re-import
  if (window.__pkdShortcutsInstalled) return;
  window.__pkdShortcutsInstalled = true;

  document.addEventListener('keydown', function (e) {
    // Skip kalau user sedang ketik di input / textarea / contenteditable
    const tag = (e.target && e.target.tagName) || '';
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (e.target && e.target.isContentEditable)
    ) {
      return;
    }

    // Hanya proses kalau Alt ditekan (tanpa Ctrl / Meta)
    if (!e.altKey || e.ctrlKey || e.metaKey) return;

    const key = String(e.key || '').toLowerCase();

    // Alt + D → Dashboard
    if (key === 'd') {
      e.preventDefault();
      router && router.navigate('#/admin/dashboard');
      return;
    }

    // Alt + P → Peserta
    if (key === 'p') {
      e.preventDefault();
      router && router.navigate('#/admin/peserta');
      return;
    }

    // Alt + A → Sesi Absen
    if (key === 'a') {
      e.preventDefault();
      router && router.navigate('#/admin/sesi-absen');
      return;
    }

    // Alt + S → Skrining
    if (key === 's') {
      e.preventDefault();
      router && router.navigate('#/admin/skrining');
      return;
    }

    // Alt + R → RTL
    if (key === 'r') {
      e.preventDefault();
      router && router.navigate('#/admin/rtl');
      return;
    }

    // Alt + Q → Tanda Tangan
    if (key === 'q') {
      e.preventDefault();
      router && router.navigate('#/admin/tanda-tangan');
      return;
    }

    // Alt + M → Materi
    if (key === 'm') {
      e.preventDefault();
      router && router.navigate('#/admin/materi');
      return;
    }

    // Alt + K → Kader
    if (key === 'k') {
      e.preventDefault();
      router && router.navigate('#/admin/kader');
      return;
    }

    // ⭐ v26.1.6: Alt + T → Tim Instruktur
    if (key === 't') {
      e.preventDefault();
      router && router.navigate('#/admin/tim-instruktur');
      return;
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
    // Cek apakah ada modal yang sedang terbuka
    const hasOpenModal = document.querySelector('.modal.show');
    if (!hasOpenModal) return;

    // Biarkan browser menampilkan dialog konfirmasi
    e.preventDefault();
    e.returnValue = '';
    return '';
  });
}

// ============================================================
//   AUTO-START
// ============================================================
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  // DOM sudah siap (module script bisa jalan setelah DOM parsed)
  boot();
}

// ============================================================
//   EXPOSE HELPERS UNTUK DEBUGGING
// ============================================================
window.__pkd = {
  version: APP_VERSION,
  getRouter: () => router,
  getRoutes: () => ROUTES,
  getRouteCount: getRouteCount,
  navigate: (hash) => router && router.navigate(hash),
  reload: () => router && router.reload(),
  destroy: () => router && router.destroy(),
};
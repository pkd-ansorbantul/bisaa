// ============================================================
// js/components/sidebar.js — v28.0.0 ANGKATAN PKD EDITION
// ============================================================
// CHANGELOG v28.0.0 (dari v27.3.0):
//   ✅ REMOVED: loadLokasiPKDSubmenu() (tidak dipakai lagi)
//   ✅ REMOVED: Submenu dinamis Lokasi PKD
//   ✅ KEEP: Menu statis "Angkatan PKD" di sidebar.html
//   ✅ KEEP: Mobile drawer + swipe-close + backdrop
//   ✅ KEEP: Submenu accordion + route navigation + logout
//   ✅ KEEP: Minimize/maximize (desktop)
//   ✅ KEEP: Theme toggle binding
//   ✅ FIX: Cleanup listener saat unload
//   ✅ Zero memory leak
// ============================================================

import {
  logout as apiLogout,
  escapeHtml,
  getUserRole,
} from '../core/api.js';
import { BASE_PATH } from '../core/config.js';
import {
  getEl,
  debounce,
} from '../core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const SIDEBAR_CONTAINER_ID  = 'sidebar-container';
const SIDEBAR_WRAPPER_ID    = 'sidebarWrapper';
const MINIMIZED_STORAGE_KEY = 'pkd_sidebar_minimized';
const PUBLIC_INDEX_URL      = BASE_PATH + 'index.html';
const LOGO_URL              = BASE_PATH + 'LOGOANSOR.webp';
const MOBILE_BREAKPOINT     = 992;

// ============================================================
//   FALLBACK HTML
// ============================================================
const FALLBACK_SIDEBAR_HTML = `
<div class="sidebar-wrapper" id="sidebarWrapper" role="navigation" aria-label="Navigasi utama">

  <div class="sidebar-header">
    <div id="notif-center-container" class="sidebar-header-notif" aria-label="Notifikasi"></div>
    <div class="sidebar-header-controls">
      <button
        type="button"
        id="sidebarThemeToggleBtn"
        class="sidebar-mini-btn theme-toggle-btn"
        title="Toggle Tema (Dark / Light)"
        aria-label="Toggle tema gelap atau terang"
        aria-pressed="false"
      >
        <i class="bi bi-sun-fill theme-icon-light" aria-hidden="true"></i>
        <i class="bi bi-moon-stars-fill theme-icon-dark" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        id="toggleSidebarBtn"
        class="sidebar-mini-btn sidebar-minimize-btn"
        title="Minimize / Maximize Sidebar"
        aria-label="Minimize atau maximize sidebar"
      >
        <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
      </button>
      <button
        type="button"
        id="closeSidebarBtn"
        class="sidebar-mini-btn sidebar-close-btn"
        title="Tutup Menu"
        aria-label="Tutup menu navigasi"
      >
        <i class="bi bi-x-lg" aria-hidden="true"></i>
      </button>
    </div>
  </div>

  <div class="sidebar-brand-area">
    <a class="brand-sidebar" href="${PUBLIC_INDEX_URL}" title="Kunjungi Beranda Publik" target="_self">
      <img src="${LOGO_URL}" alt="GP Ansor">
      <div>
        <div class="brand-sidebar-title">PKD GP Ansor</div>
        <span class="brand-sidebar-sub">Kabupaten Bantul</span>
      </div>
    </a>
  </div>

  <div class="sidebar-menu-area">
    <div class="nav flex-column nav-pills" id="sidebarMenu" role="tablist">

      <a class="nav-link" href="#/admin/dashboard" data-route="#/admin/dashboard" title="Dashboard">
        <i class="bi bi-speedometer2" aria-hidden="true"></i>
        <span>Dashboard</span>
      </a>

      <div class="nav-link" data-target="akademik" title="Akademik" role="button" tabindex="0" aria-expanded="false">
        <i class="bi bi-book" aria-hidden="true"></i>
        <span>Akademik</span>
      </div>
      <div class="submenu" id="submenu-akademik">
        <a class="nav-link" href="#/admin/pretest" data-route="#/admin/pretest" title="Pre-test">
          <i class="bi bi-pencil-square" aria-hidden="true"></i>
          <span>Pre-test</span>
        </a>
        <a class="nav-link" href="#/admin/posttest" data-route="#/admin/posttest" title="Post-test">
          <i class="bi bi-trophy" aria-hidden="true"></i>
          <span>Post-test</span>
        </a>
        <a class="nav-link" href="#/admin/materi" data-route="#/admin/materi" title="Materi">
          <i class="bi bi-file-earmark-pdf" aria-hidden="true"></i>
          <span>Materi</span>
        </a>
      </div>

      <div class="nav-link" data-target="peserta" title="Peserta" role="button" tabindex="0" aria-expanded="false">
        <i class="bi bi-people" aria-hidden="true"></i>
        <span>Peserta</span>
      </div>
      <div class="submenu" id="submenu-peserta">
        <a class="nav-link" href="#/admin/peserta" data-route="#/admin/peserta" title="Peserta">
          <i class="bi bi-person-badge" aria-hidden="true"></i>
          <span>Peserta</span>
        </a>
        <a class="nav-link" href="#/admin/kader" data-route="#/admin/kader" title="Kader">
          <i class="bi bi-people-fill" aria-hidden="true"></i>
          <span>Kader</span>
        </a>
        <a class="nav-link" href="#/admin/tim-instruktur" data-route="#/admin/tim-instruktur" title="Tim Instruktur">
          <i class="bi bi-person-vcard" aria-hidden="true"></i>
          <span>Tim Instruktur</span>
        </a>
      </div>

      <a class="nav-link" href="#/admin/angkatan-pkd" data-route="#/admin/angkatan-pkd" title="Angkatan PKD">
        <i class="bi bi-mortarboard-fill" aria-hidden="true"></i>
        <span>Angkatan PKD</span>
      </a>

      <div class="nav-link" data-target="absensi" title="Absensi" role="button" tabindex="0" aria-expanded="false">
        <i class="bi bi-calendar-check" aria-hidden="true"></i>
        <span>Absensi</span>
      </div>
      <div class="submenu" id="submenu-absensi">
        <a class="nav-link" href="#/admin/sesi-absen" data-route="#/admin/sesi-absen" title="Sesi Absen">
          <i class="bi bi-calendar-event" aria-hidden="true"></i>
          <span>Sesi Absen</span>
        </a>
        <a class="nav-link" href="#/admin/data-absensi" data-route="#/admin/data-absensi" title="Data Absensi">
          <i class="bi bi-table" aria-hidden="true"></i>
          <span>Data Absensi</span>
        </a>
        <a class="nav-link" href="#/admin/rekap-absensi" data-route="#/admin/rekap-absensi" title="Rekap Absensi">
          <i class="bi bi-bar-chart" aria-hidden="true"></i>
          <span>Rekap Absensi</span>
        </a>
      </div>

      <div class="nav-link" data-target="informasi" title="Informasi" role="button" tabindex="0" aria-expanded="false">
        <i class="bi bi-info-circle" aria-hidden="true"></i>
        <span>Informasi</span>
      </div>
      <div class="submenu" id="submenu-informasi">
        <a class="nav-link" href="#/admin/informasi" data-route="#/admin/informasi" title="Informasi">
          <i class="bi bi-newspaper" aria-hidden="true"></i>
          <span>Informasi</span>
        </a>
        <a class="nav-link" href="#/admin/asset" data-route="#/admin/asset" title="Aset Digital">
          <i class="bi bi-image" aria-hidden="true"></i>
          <span>Aset Digital</span>
        </a>
      </div>

      <a class="nav-link" href="#/admin/skrining" data-route="#/admin/skrining" title="Skrining">
        <i class="bi bi-clipboard-check" aria-hidden="true"></i>
        <span>Skrining</span>
      </a>

      <a class="nav-link" href="#/admin/sertifikat" data-route="#/admin/sertifikat" title="Sertifikat">
        <i class="bi bi-patch-check" aria-hidden="true"></i>
        <span>Sertifikat</span>
      </a>

      <a class="nav-link" href="#/admin/tanda-tangan" data-route="#/admin/tanda-tangan" title="Tanda Tangan">
        <i class="bi bi-pencil-square" aria-hidden="true"></i>
        <span>Tanda Tangan</span>
      </a>

      <a class="nav-link" href="#/admin/rtl" data-route="#/admin/rtl" title="RTL & Tugas">
        <i class="bi bi-file-earmark-text" aria-hidden="true"></i>
        <span>RTL &amp; Tugas</span>
      </a>

      <a class="nav-link" href="#/admin/pengaturan" data-route="#/admin/pengaturan" title="Pengaturan">
        <i class="bi bi-gear" aria-hidden="true"></i>
        <span>Pengaturan</span>
      </a>

      <div class="sidebar-logout"></div>
      <a class="nav-link text-danger" href="#" id="sidebarLogoutBtn" title="Logout" role="button" tabindex="0">
        <i class="bi bi-box-arrow-right" aria-hidden="true"></i>
        <span>Logout</span>
      </a>

    </div>
  </div>
</div>`;

// ============================================================
//   MODULE STATE
// ============================================================
const listeners = [];
let isSidebarLoaded = false;
let isBehaviorInitialized = false;
let resizeTimer = null;
let outsideClickHandler = null;
let escKeyHandler = null;

// Mobile drawer state
let isMobileDrawerOpen = false;
let swipeStartX = 0;
let swipeStartY = 0;
let swipeCurrentX = 0;
let isSwiping = false;
let touchStartHandler = null;
let touchMoveHandler = null;
let touchEndHandler = null;

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el || typeof el.addEventListener !== 'function') return null;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
  return handler;
}

function safeLocalGet(key) {
  try { return localStorage.getItem(key); }
  catch (e) { return null; }
}

function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) { return false; }
}

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function updateToggleIcon(isMinimized) {
  const toggleBtn = getEl('toggleSidebarBtn');
  const icon = toggleBtn?.querySelector('i');
  if (!icon) return;

  icon.className = 'bi bi-arrow-left-right';
  icon.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
  icon.style.transform = isMinimized ? 'rotate(180deg)' : 'rotate(0deg)';
}

// ============================================================
//   BODY SCROLL LOCK
// ============================================================
function lockBodyScroll() {
  document.body.style.overflow = 'hidden';
  document.body.classList.add('sidebar-drawer-open');
}

function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.classList.remove('sidebar-drawer-open');
}

// ============================================================
//   MOBILE DRAWER — PUBLIC API
// ============================================================
export function openMobileDrawer() {
  const sidebar = getEl(SIDEBAR_WRAPPER_ID);
  const backdrop = getEl('sidebarBackdrop');
  if (!sidebar || !isMobile()) return;

  sidebar.classList.add('show');
  if (backdrop) {
    backdrop.classList.add('show');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  lockBodyScroll();
  isMobileDrawerOpen = true;

  setTimeout(() => {
    try {
      const firstLink = sidebar.querySelector('.nav-link');
      firstLink?.focus?.({ preventScroll: true });
    } catch (e) { /* silent */ }
  }, 320);

  window.dispatchEvent(new CustomEvent('sidebar:mobile-opened'));
}

export function closeMobileDrawer() {
  const sidebar = getEl(SIDEBAR_WRAPPER_ID);
  const backdrop = getEl('sidebarBackdrop');
  if (!sidebar) return;

  sidebar.classList.remove('show');
  if (backdrop) {
    backdrop.classList.remove('show');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  unlockBodyScroll();
  isMobileDrawerOpen = false;

  window.dispatchEvent(new CustomEvent('sidebar:mobile-closed'));
}

export function toggleMobileDrawer() {
  if (isMobileDrawerOpen) closeMobileDrawer();
  else openMobileDrawer();
}

// ============================================================
//   SWIPE-TO-CLOSE GESTURE
// ============================================================
function attachSwipeGesture(sidebar) {
  if (!sidebar) return;

  touchStartHandler = function (e) {
    if (!isMobile() || !isMobileDrawerOpen) return;
    const touch = e.touches[0];
    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeCurrentX = 0;
    isSwiping = false;
  };

  touchMoveHandler = function (e) {
    if (!isMobile() || !isMobileDrawerOpen || swipeStartX === 0) return;
    const touch = e.touches[0];
    const dx = touch.clientX - swipeStartX;
    const dy = touch.clientY - swipeStartY;

    if (Math.abs(dx) < Math.abs(dy)) return;
    if (dx > 0) return;

    isSwiping = true;
    swipeCurrentX = Math.max(dx, -sidebar.offsetWidth);

    sidebar.style.transform = `translateX(${swipeCurrentX}px)`;
    sidebar.style.transition = 'none';
  };

  touchEndHandler = function () {
    if (!isSwiping) {
      swipeStartX = 0;
      return;
    }

    sidebar.style.transition = '';
    sidebar.style.transform = '';

    if (Math.abs(swipeCurrentX) > sidebar.offsetWidth * 0.3) {
      closeMobileDrawer();
    }

    swipeStartX = 0;
    swipeStartY = 0;
    swipeCurrentX = 0;
    isSwiping = false;
  };

  on(sidebar, 'touchstart', touchStartHandler, { passive: true });
  on(sidebar, 'touchmove', touchMoveHandler, { passive: true });
  on(sidebar, 'touchend', touchEndHandler);
}

// ============================================================
//   LOAD SIDEBAR
// ============================================================
export async function loadSidebar() {
  const container = getEl(SIDEBAR_CONTAINER_ID);
  if (!container) {
    console.warn('[Sidebar] Container #' + SIDEBAR_CONTAINER_ID + ' tidak ditemukan');
    return;
  }

  if (isSidebarLoaded) {
    console.warn('[Sidebar] Sudah diload, skip');
    return;
  }

  let htmlText = null;

  try {
    const res = await fetch(`${BASE_PATH}partials/sidebar.html?v=${Date.now()}`);
    if (res.ok) {
      htmlText = await res.text();
    } else {
      console.warn('[Sidebar] Fetch HTTP', res.status, '→ using fallback');
    }
  } catch (e) {
    console.warn('[Sidebar] Fetch failed:', e.message, '→ using fallback');
  }

  if (!htmlText || !htmlText.trim()) {
    console.warn('[Sidebar] Using fallback HTML');
    htmlText = FALLBACK_SIDEBAR_HTML;
  }

  container.innerHTML = htmlText;
  initSidebarBehavior();
  isSidebarLoaded = true;

  console.log('[Sidebar] ✅ Loaded');
}

// ============================================================
//   INIT BEHAVIOR
// ============================================================
function initSidebarBehavior() {
  if (isBehaviorInitialized) return;
  isBehaviorInitialized = true;

  const sidebar = getEl(SIDEBAR_WRAPPER_ID);
  if (!sidebar) {
    console.warn('[Sidebar] Wrapper #' + SIDEBAR_WRAPPER_ID + ' tidak ditemukan');
    return;
  }

  // ==========================================================
  //   RESTORE MINIMIZED STATE (desktop only)
  // ==========================================================
  const minimizedSaved = safeLocalGet(MINIMIZED_STORAGE_KEY);
  if (minimizedSaved === 'true' && !isMobile()) {
    sidebar.classList.add('minimized');
    updateToggleIcon(true);
  } else {
    updateToggleIcon(false);
  }

  // ==========================================================
  //   TOGGLE MINIMIZE (desktop)
  // ==========================================================
  on(getEl('toggleSidebarBtn'), 'click', () => {
    if (isMobile()) return;

    sidebar.classList.toggle('minimized');
    const isMinimized = sidebar.classList.contains('minimized');

    updateToggleIcon(isMinimized);
    safeLocalSet(MINIMIZED_STORAGE_KEY, isMinimized ? 'true' : 'false');

    window.dispatchEvent(new CustomEvent('sidebar:minimized', {
      detail: { minimized: isMinimized },
    }));
  });

  // ==========================================================
  //   MOBILE DRAWER CONTROLS
  // ==========================================================
  on(getEl('mobileMenuBtn'), 'click', (e) => {
    e.preventDefault();
    toggleMobileDrawer();
  });

  on(getEl('closeSidebarBtn'), 'click', (e) => {
    e.preventDefault();
    closeMobileDrawer();
  });

  on(getEl('sidebarBackdrop'), 'click', () => {
    if (isMobileDrawerOpen) closeMobileDrawer();
  });

  on(getEl('mobileThemeBtn'), 'click', (e) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('theme:toggle'));
  });

  on(window, 'sidebar:mobile-toggle', () => toggleMobileDrawer());
  on(window, 'sidebar:mobile-open', () => openMobileDrawer());
  on(window, 'sidebar:mobile-close', () => closeMobileDrawer());

  // ==========================================================
  //   THEME TOGGLE — hanya set ARIA (theme-toggle.js handle click)
  // ==========================================================
  const themeBtn = getEl('sidebarThemeToggleBtn');
  if (themeBtn && !themeBtn.dataset.sidebarBound) {
    themeBtn.dataset.sidebarBound = '1';
    if (!themeBtn.hasAttribute('aria-label')) {
      themeBtn.setAttribute('aria-label', 'Toggle tema gelap atau terang');
    }
  }

  // ==========================================================
  //   SUBMENU — Event Delegation
  // ==========================================================
  const menuArea = sidebar.querySelector('.sidebar-menu-area');
  if (menuArea) {
    on(menuArea, 'click', (e) => {
      const link = e.target.closest('.nav-link[data-target]');
      if (!link) return;
      e.preventDefault();
      toggleSubmenu(link, sidebar);
    });

    on(menuArea, 'keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const link = e.target.closest('.nav-link[data-target]');
      if (!link) return;
      e.preventDefault();
      toggleSubmenu(link, sidebar);
    });
  }

  // ==========================================================
  //   ROUTE NAVIGATION — Event Delegation
  // ==========================================================
  on(sidebar, 'click', (e) => {
    const link = e.target.closest('[data-route]');
    if (!link) return;
    e.preventDefault();

    const route = link.dataset.route;
    if (!route) return;

    window.dispatchEvent(new CustomEvent('router:navigate', {
      detail: { hash: route },
    }));

    if (isMobile() && isMobileDrawerOpen) {
      closeMobileDrawer();
    }
  });

  // ==========================================================
  //   LOGOUT
  // ==========================================================
  on(getEl('sidebarLogoutBtn'), 'click', (e) => {
    e.preventDefault();

    if (!confirm('Yakin ingin logout dari sistem?')) return;

    try {
      apiLogout();
    } catch (err) {
      console.error('[Sidebar] Logout error:', err);
      window.location.href = BASE_PATH + 'index.html';
    }
  });

  // ==========================================================
  //   ESC KEY
  // ==========================================================
  escKeyHandler = (e) => {
    if (e.key !== 'Escape') return;

    if (isMobileDrawerOpen) {
      closeMobileDrawer();
      return;
    }

    sidebar.querySelectorAll('.submenu.open').forEach(sm => {
      sm.classList.remove('open');
    });
    sidebar.querySelectorAll('.nav-link[data-target]').forEach(p => {
      p.setAttribute('aria-expanded', 'false');
      p.classList.remove('active');
    });
  };
  on(document, 'keydown', escKeyHandler);

  // ==========================================================
  //   MOBILE: Close on click outside
  // ==========================================================
  outsideClickHandler = (e) => {
    if (!isMobile()) return;
    if (!isMobileDrawerOpen) return;
    if (!sidebar.classList.contains('show')) return;

    const isClickInside = sidebar.contains(e.target);
    const isBackdrop = e.target.closest('#sidebarBackdrop');
    const isToggleClick = e.target.closest('#mobileMenuBtn');

    if (!isClickInside && !isToggleClick && !isBackdrop) {
      closeMobileDrawer();
    }
  };
  on(document, 'click', outsideClickHandler);

  // ==========================================================
  //   RESIZE HANDLER (debounced)
  // ==========================================================
  const handleResize = debounce(() => {
    if (!isMobile()) {
      if (isMobileDrawerOpen) closeMobileDrawer();
      sidebar.classList.remove('show');
      unlockBodyScroll();

      if (safeLocalGet(MINIMIZED_STORAGE_KEY) === 'true') {
        sidebar.classList.add('minimized');
        updateToggleIcon(true);
      }
    } else {
      sidebar.classList.remove('minimized');
      updateToggleIcon(false);
    }
  }, 200);
  on(window, 'resize', handleResize);

  // ==========================================================
  //   AUTO-CLOSE saat route berubah (mobile)
  // ==========================================================
  on(window, 'routeChanged', () => {
    if (isMobile() && isMobileDrawerOpen) {
      closeMobileDrawer();
    }
  });

  // ==========================================================
  //   SWIPE-TO-CLOSE GESTURE (mobile)
  // ==========================================================
  attachSwipeGesture(sidebar);

  // ==========================================================
  //   INITIAL ACTIVE STATE
  // ==========================================================
  const currentHash = window.location.hash || '#/admin/dashboard';
  updateSidebarActive(currentHash);

  on(window, 'routeChanged', (e) => {
    const path = e?.detail?.path;
    if (path) updateSidebarActive(path);
  });

  // ==========================================================
  //   NOTIFY COMPONENTS
  // ==========================================================
  try {
    window.dispatchEvent(new CustomEvent('sidebar:ready'));
  } catch (e) { /* silent */ }
}

// ============================================================
//   TOGGLE SUBMENU
// ============================================================
function toggleSubmenu(link, sidebar) {
  if (sidebar.classList.contains('minimized') && !isMobile()) {
    sidebar.classList.remove('minimized');
    safeLocalSet(MINIMIZED_STORAGE_KEY, 'false');
    updateToggleIcon(false);
  }

  const targetId = 'submenu-' + link.dataset.target;
  const submenu = getEl(targetId);
  if (!submenu) return;

  const isOpen = submenu.classList.contains('open');

  sidebar.querySelectorAll('.submenu').forEach(sm => {
    if (sm.id !== targetId) sm.classList.remove('open');
  });
  sidebar.querySelectorAll('.nav-link[data-target]').forEach(p => {
    if (p !== link) {
      p.setAttribute('aria-expanded', 'false');
      p.classList.remove('active');
    }
  });

  submenu.classList.toggle('open', !isOpen);
  link.setAttribute('aria-expanded', String(!isOpen));
  link.classList.toggle('active', !isOpen);
}

// ============================================================
//   UPDATE ACTIVE STATE
// ============================================================
export function updateSidebarActive(route) {
  if (!route) return;

  const sidebar = getEl(SIDEBAR_WRAPPER_ID);
  if (!sidebar) return;

  const allRoutes = sidebar.querySelectorAll('[data-route]');
  let hasActive = false;

  allRoutes.forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('active', isActive);
    link.toggleAttribute('aria-current', isActive);

    if (isActive) {
      hasActive = true;

      const submenu = link.closest('.submenu');
      if (submenu) {
        submenu.classList.add('open');

        const parentTarget = submenu.id.replace('submenu-', '');
        sidebar.querySelectorAll('.nav-link[data-target]').forEach(parent => {
          if (parent.dataset.target === parentTarget) {
            parent.classList.add('active');
            parent.setAttribute('aria-expanded', 'true');
          } else {
            parent.classList.remove('active');
            parent.setAttribute('aria-expanded', 'false');
          }
        });
      }
    }
  });

  if (!hasActive) {
    sidebar.querySelectorAll('.nav-link[data-target]').forEach(parent => {
      parent.classList.remove('active');
      parent.setAttribute('aria-expanded', 'false');
    });
  }
}

// ============================================================
//   MANUAL TOGGLE (public API)
// ============================================================
export function toggleSidebar() {
  const sidebar = getEl(SIDEBAR_WRAPPER_ID);
  if (!sidebar) return;

  if (isMobile()) {
    toggleMobileDrawer();
    return;
  }

  sidebar.classList.toggle('minimized');
  const isMinimized = sidebar.classList.contains('minimized');

  updateToggleIcon(isMinimized);
  safeLocalSet(MINIMIZED_STORAGE_KEY, isMinimized ? 'true' : 'false');
}

// ============================================================
//   UNLOAD CLEANUP
// ============================================================
export function unloadSidebar() {
  if (isMobileDrawerOpen) {
    closeMobileDrawer();
  }

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); }
    catch (e) { /* silent */ }
  });
  listeners.length = 0;

  isSidebarLoaded = false;
  isBehaviorInitialized = false;
  isMobileDrawerOpen = false;

  if (resizeTimer) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
  }
  outsideClickHandler = null;
  escKeyHandler = null;
  touchStartHandler = null;
  touchMoveHandler = null;
  touchEndHandler = null;
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default {
  loadSidebar,
  updateSidebarActive,
  toggleSidebar,
  unloadSidebar,
  openMobileDrawer,
  closeMobileDrawer,
  toggleMobileDrawer,
};

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Sidebar v28.0.0 — Angkatan PKD Edition ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
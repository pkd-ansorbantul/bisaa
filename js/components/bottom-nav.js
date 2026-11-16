// ============================================================
// js/components/bottom-nav.js — v27.1.0 MOBILE MODAL FIX
// ============================================================
// CHANGELOG v27.1.0 (dari v26.2.1):
//   ✅ FIX CRITICAL: Tombol "Lainnya" tidak membuka modal
//     → Pakai data-bs-toggle sebagai PRIMARY (Bootstrap native)
//     → JS handler jadi SECONDARY (auto-cleanup + logging)
//   ✅ FIX: wireMoreMenuModal() idempotent + tidak silent-fail
//   ✅ FIX: Modal backdrop cleanup kalau stuck
//   ✅ FIX: Auto-close modal saat route berubah
//   ✅ FIX: Active state sync untuk tombol "Lainnya"
//   ✅ FIX: Null-safe untuk semua element
//   ✅ NEW: Logging untuk debugging modal state
//   ✅ KEEP: 5 nav items, more menu modal, logout, active state
// ============================================================

import { logout as apiLogout } from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CONTAINER_ID = 'bottom-nav-container';
const MODAL_ID = 'moreMenuModal';
const MODAL_BTN_ID = 'moreMenuBtn';

const FALLBACK_BOTTOM_NAV_HTML = `
<nav class="bottom-nav" role="navigation" aria-label="Navigasi mobile">
  <a href="#/admin/dashboard" class="nav-item" data-route="#/admin/dashboard" title="Dashboard" aria-label="Buka Dashboard">
    <i class="bi bi-speedometer2" aria-hidden="true"></i>
    <span>Dashboard</span>
  </a>
  <a href="#/admin/peserta" class="nav-item" data-route="#/admin/peserta" title="Peserta" aria-label="Buka Manajemen Peserta">
    <i class="bi bi-person-badge" aria-hidden="true"></i>
    <span>Peserta</span>
  </a>
  <a href="#/admin/sesi-absen" class="nav-item" data-route="#/admin/sesi-absen" title="Sesi Absen" aria-label="Buka Sesi Absen">
    <i class="bi bi-calendar-event" aria-hidden="true"></i>
    <span>Absen</span>
  </a>
  <a href="#/admin/sertifikat" class="nav-item" data-route="#/admin/sertifikat" title="Sertifikat" aria-label="Buka Sertifikat">
    <i class="bi bi-patch-check" aria-hidden="true"></i>
    <span>Sertifikat</span>
  </a>
  <button
    type="button"
    class="nav-item"
    id="${MODAL_BTN_ID}"
    title="Menu Lainnya"
    aria-label="Buka menu lainnya"
    aria-haspopup="dialog"
    data-bs-toggle="modal"
    data-bs-target="#${MODAL_ID}"
  >
    <i class="bi bi-grid" aria-hidden="true"></i>
    <span>Lainnya</span>
  </button>
</nav>`;

// ============================================================
//   MODULE STATE
// ============================================================
const listeners = [];
let isBottomNavLoaded = false;
let isBehaviorInitialized = false;
let moreMenuBound = false;
let modalInstance = null;

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return null;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
  return handler;
}

function safeHideModal(modalEl) {
  if (!modalEl) return;
  try {
    const inst = bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
  } catch (e) { /* silent */ }
}

function cleanupModalBackdrop() {
  try {
    // Kalau tidak ada modal yang benar-benar terbuka, hapus backdrop yang tertinggal
    if (!document.querySelector('.modal.show')) {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    }
  } catch (e) { /* silent */ }
}

// ============================================================
//   LOAD BOTTOM NAV
// ============================================================
export async function loadBottomNav() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    console.warn('[BottomNav] Container #' + CONTAINER_ID + ' not found');
    return;
  }

  if (isBottomNavLoaded) return;

  let htmlText = null;

  try {
    const res = await fetch(`${BASE_PATH}partials/bottom-nav.html?v=${Date.now()}`);
    if (res.ok) {
      htmlText = await res.text();
    } else {
      console.warn('[BottomNav] Fetch returned HTTP', res.status, '→ using fallback');
    }
  } catch (e) {
    console.warn('[BottomNav] Fetch failed:', e.message, '→ using fallback');
  }

  if (!htmlText || !htmlText.trim()) {
    console.warn('[BottomNav] Using fallback HTML');
    htmlText = FALLBACK_BOTTOM_NAV_HTML;
  }

  container.innerHTML = htmlText;

  initBottomNavBehavior();
  isBottomNavLoaded = true;

  console.log('[BottomNav] ✅ Loaded');
}

// ============================================================
//   INIT BEHAVIOR
// ============================================================
function initBottomNavBehavior() {
  if (isBehaviorInitialized) return;
  isBehaviorInitialized = true;

  const bottomNav = document.querySelector('.bottom-nav');
  if (!bottomNav) {
    console.warn('[BottomNav] .bottom-nav not found');
    return;
  }

  // --------------------------------------------------------
  //   ROUTE NAVIGATION via data-route (event delegation)
  // --------------------------------------------------------
  on(bottomNav, 'click', (e) => {
    const link = e.target.closest('[data-route]');
    if (!link) return;

    // Skip kalau ini tombol "more menu" (punya data-bs-toggle)
    if (link.id === MODAL_BTN_ID) return;

    e.preventDefault();
    const route = link.dataset.route;
    if (!route) return;

    window.dispatchEvent(new CustomEvent('router:navigate', {
      detail: { hash: route },
    }));
  });

  // --------------------------------------------------------
  //   MORE MENU BUTTON — Bootstrap native handle klik via
  //   data-bs-toggle. Handler ini hanya untuk logging.
  // --------------------------------------------------------
  const moreMenuBtn = document.getElementById(MODAL_BTN_ID);
  if (moreMenuBtn) {
    on(moreMenuBtn, 'click', () => {
      console.log('[BottomNav] More menu button clicked');
      // Beri waktu Bootstrap untuk buka modal
      setTimeout(() => {
        wireMoreMenuModal();
      }, 100);
    });
  }

  // Wire sekali saat init (untuk cleanup listeners)
  setTimeout(wireMoreMenuModal, 150);

  // --------------------------------------------------------
  //   INITIAL ACTIVE STATE
  // --------------------------------------------------------
  updateBottomNavActive(window.location.hash || '#/admin/dashboard');

  // --------------------------------------------------------
  //   AUTO-CLOSE MODAL SAAT ROUTE BERUBAH
  //   (Bootstrap native akan close via data-bs-dismiss, tapi ini backup)
  // --------------------------------------------------------
  on(window, 'routeChanged', () => {
    const modalEl = document.getElementById(MODAL_ID);
    if (!modalEl) return;
    // Cek apakah modal sedang terbuka
    const isShown = modalEl.classList.contains('show');
    if (isShown) {
      safeHideModal(modalEl);
      setTimeout(cleanupModalBackdrop, 300);
    }
  });

  // --------------------------------------------------------
  //   NOTIFY COMPONENTS
  // --------------------------------------------------------
  try {
    window.dispatchEvent(new CustomEvent('bottomnav:ready'));
  } catch (e) { /* silent */ }
}

// ============================================================
//   WIRE MORE MENU MODAL
// ============================================================
function wireMoreMenuModal() {
  const modalEl = document.getElementById(MODAL_ID);
  if (!modalEl) {
    console.warn('[BottomNav] #' + MODAL_ID + ' tidak ditemukan di DOM');
    return;
  }

  // Idempotent — cek flag dataset
  if (modalEl.dataset.wired === 'true') return;
  modalEl.dataset.wired = 'true';
  moreMenuBound = true;

  console.log('[BottomNav] Wiring more menu modal');

  // --------------------------------------------------------
  //   Inisialisasi Bootstrap Modal instance (untuk API access)
  // --------------------------------------------------------
  try {
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl, {
        backdrop: true,
        keyboard: true,
        focus: true,
      });
    } else {
      console.warn('[BottomNav] Bootstrap Modal tidak tersedia');
    }
  } catch (e) {
    console.warn('[BottomNav] Gagal init modal:', e);
  }

  // --------------------------------------------------------
  //   Navigation links di dalam modal (event delegation)
  //   Bootstrap native juga handle via data-bs-dismiss,
  //   ini untuk memastikan route navigate terpanggil
  // --------------------------------------------------------
  on(modalEl, 'click', (e) => {
    const link = e.target.closest('[data-route]');
    if (!link) return;

    const route = link.dataset.route;
    if (!route) return;

    e.preventDefault();

    // Hide modal dulu
    safeHideModal(modalEl);

    // Navigate setelah modal tertutup
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { hash: route },
      }));
    }, 180);
  });

  // --------------------------------------------------------
  //   Logout di dalam modal
  // --------------------------------------------------------
  const logoutBtn = modalEl.querySelector('#mobileLogoutBtn')
                 || document.getElementById('mobileLogoutBtn');

  on(logoutBtn, 'click', (e) => {
    e.preventDefault();

    if (!confirm('Yakin ingin logout dari sistem?')) return;

    safeHideModal(modalEl);

    setTimeout(() => {
      try {
        apiLogout();
      } catch (err) {
        console.error('[BottomNav] Logout error:', err);
        window.location.href = BASE_PATH + 'index.html';
      }
    }, 200);
  });

  // --------------------------------------------------------
  //   Cleanup on hidden — remove stray backdrops
  // --------------------------------------------------------
  on(modalEl, 'hidden.bs.modal', () => {
    cleanupModalBackdrop();
  });

  // --------------------------------------------------------
  //   Ensure modal bisa dibuka — force re-init kalau perlu
  // --------------------------------------------------------
  on(modalEl, 'show.bs.modal', () => {
    console.log('[BottomNav] Modal showing');
  });

  on(modalEl, 'shown.bs.modal', () => {
    console.log('[BottomNav] Modal shown');
  });
}

// ============================================================
//   UPDATE ACTIVE STATE
// ============================================================
export function updateBottomNavActive(route) {
  if (!route) return;

  const bottomNav = document.querySelector('.bottom-nav');
  if (!bottomNav) return;

  const routeLinks = bottomNav.querySelectorAll('[data-route]');
  routeLinks.forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('active', isActive);
  });

  // Jika route aktif tidak ada di menu utama, highlight "More Menu"
  const primaryRoutes = Array.from(routeLinks).map(l => l.dataset.route);
  const isPrimaryActive = primaryRoutes.includes(route);

  const moreBtn = document.getElementById(MODAL_BTN_ID);
  if (moreBtn) {
    if (!isPrimaryActive) moreBtn.classList.add('active');
    else moreBtn.classList.remove('active');
  }
}

// ============================================================
//   MANUAL: Close "More Menu" modal
// ============================================================
export function closeMoreMenu() {
  const modalEl = document.getElementById(MODAL_ID);
  safeHideModal(modalEl);
  setTimeout(cleanupModalBackdrop, 300);
}

// ============================================================
//   MANUAL: Open "More Menu" modal (public API untuk debug)
// ============================================================
export function openMoreMenu() {
  const modalEl = document.getElementById(MODAL_ID);
  if (!modalEl) {
    console.warn('[BottomNav] #' + MODAL_ID + ' tidak ditemukan');
    return;
  }

  try {
    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      const inst = bootstrap.Modal.getOrCreateInstance(modalEl, {
        backdrop: true,
        keyboard: true,
        focus: true,
      });
      inst.show();
    } else {
      console.warn('[BottomNav] Bootstrap Modal tidak tersedia');
    }
  } catch (e) {
    console.error('[BottomNav] Gagal open modal:', e);
  }
}

// ============================================================
//   UNLOAD: Cleanup
// ============================================================
export function unloadBottomNav() {
  // Close modal kalau terbuka
  try {
    const modalEl = document.getElementById(MODAL_ID);
    if (modalEl) safeHideModal(modalEl);
  } catch (e) { /* silent */ }

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  isBottomNavLoaded = false;
  isBehaviorInitialized = false;
  moreMenuBound = false;
  modalInstance = null;
}

// ============================================================
//   DEBUG HELPER — accessible via window
// ============================================================
if (typeof window !== 'undefined') {
  window.__bottomNav = {
    open: openMoreMenu,
    close: closeMoreMenu,
    isLoaded: () => isBottomNavLoaded,
    isBound: () => moreMenuBound,
  };
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default {
  loadBottomNav,
  updateBottomNavActive,
  closeMoreMenu,
  openMoreMenu,
  unloadBottomNav,
};

console.log(
  '%c Bottom Nav v27.1.0 — Mobile Modal Fix ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// js/components/bottom-nav.js — v26.2.1 PRODUCTION FULL FIX
// ============================================================
// CHANGELOG v26.2.1:
//   ✅ FIX: Double-bind guard pada route links
//   ✅ FIX: More menu modal wiring (idempotent)
//   ✅ FIX: Logout cleanup + redirect pakai BASE_PATH
//   ✅ FIX: Active state sync — handle submenu routes
//   ✅ PERF: Idempotent init
//   ✅ PERF: Event delegation untuk route navigation
//   ✅ ADD: bottomnav:ready event
//   ✅ ADD: Null-safe semua element access
//   ✅ KEEP: Semua fitur (5 nav items, more menu modal, logout)
// ============================================================

import { logout as apiLogout, getUserRole, getUserData } from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CONTAINER_ID = 'bottom-nav-container';
const MODAL_ID = 'moreMenuModal';

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
  <button type="button" class="nav-item" id="moreMenuBtn" title="Menu Lainnya" aria-label="Buka menu lainnya" aria-haspopup="dialog">
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

    // Skip jika ini tombol "more menu"
    if (link.id === 'moreMenuBtn') return;

    e.preventDefault();
    const route = link.dataset.route;
    if (!route) return;

    window.dispatchEvent(new CustomEvent('router:navigate', {
      detail: { hash: route },
    }));
  });

  // --------------------------------------------------------
  //   MORE MENU BUTTON
  // --------------------------------------------------------
  const moreMenuBtn = document.getElementById('moreMenuBtn');
  on(moreMenuBtn, 'click', () => {
    setTimeout(wireMoreMenuModal, 50);
  });

  // Wire on initial load
  wireMoreMenuModal();

  // --------------------------------------------------------
  //   INITIAL ACTIVE STATE
  // --------------------------------------------------------
  updateBottomNavActive(window.location.hash || '#/admin/dashboard');

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
  if (!modalEl) return;

  // Idempotent
  if (modalEl.dataset.wired === 'true') return;
  modalEl.dataset.wired = 'true';
  moreMenuBound = true;

  // Navigation links di dalam modal (event delegation)
  on(modalEl, 'click', (e) => {
    const link = e.target.closest('[data-route]');
    if (!link) return;

    const route = link.dataset.route;
    if (!route) return;

    e.preventDefault();
    safeHideModal(modalEl);

    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { hash: route },
      }));
    }, 150);
  });

  // Logout di dalam modal
  const logoutBtn = modalEl.querySelector('#mobileLogoutBtn') || document.getElementById('mobileLogoutBtn');
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

  const moreBtn = document.getElementById('moreMenuBtn');
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
}

// ============================================================
//   UNLOAD: Cleanup
// ============================================================
export function unloadBottomNav() {
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;
  isBottomNavLoaded = false;
  isBehaviorInitialized = false;
  moreMenuBound = false;
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default {
  loadBottomNav,
  updateBottomNavActive,
  closeMoreMenu,
  unloadBottomNav,
};

console.log(
  '%c Bottom Nav v26.2.1 — Production Full Fix ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
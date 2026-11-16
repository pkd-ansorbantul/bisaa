// js/components/bottom-nav.js — Full Fix Bottom Nav Loader (Final)
// Fitur:
// - Load partials/bottom-nav.html via fetch dengan fallback HTML
// - Router integration via custom event 'router:navigate'
// - Active state sync dari hash
// - Logout dari mobile "More" menu
// - Auto-init "More Menu" modal behavior
// - Cleanup lifecycle

import { logout as apiLogout, getUserRole, getUserData } from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CONTAINER_ID = 'bottom-nav-container';
const MODAL_ID = 'moreMenuModal';

// Fallback HTML jika fetch partials gagal
const FALLBACK_BOTTOM_NAV_HTML = `
<div class="bottom-nav">
  <a href="#/admin/dashboard" class="nav-item" data-route="#/admin/dashboard">
    <i class="bi bi-speedometer2"></i><span>Dashboard</span>
  </a>
  <a href="#/admin/peserta" class="nav-item" data-route="#/admin/peserta">
    <i class="bi bi-person-badge"></i><span>Peserta</span>
  </a>
  <a href="#/admin/sesi-absen" class="nav-item" data-route="#/admin/sesi-absen">
    <i class="bi bi-calendar-event"></i><span>Absen</span>
  </a>
  <a href="#/admin/sertifikat" class="nav-item" data-route="#/admin/sertifikat">
    <i class="bi bi-patch-check"></i><span>Sertifikat</span>
  </a>
  <a href="#" class="nav-item" id="moreMenuBtn" data-bs-toggle="modal" data-bs-target="#moreMenuModal">
    <i class="bi bi-grid"></i><span>Lainnya</span>
  </a>
</div>`;

// ============================================================
//   STATE
// ============================================================
const listeners = [];
let isBottomNavLoaded = false;

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler) {
  if (!el) return;
  el.addEventListener(ev, handler);
  listeners.push({ el, ev, handler });
}

function safeLocalStorage(fn) {
  try { return fn(); } catch (e) { return null; }
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

  // Coba fetch partials
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

  // Fallback
  if (!htmlText || !htmlText.trim()) {
    console.warn('[BottomNav] Using fallback HTML');
    htmlText = FALLBACK_BOTTOM_NAV_HTML;
  }

  container.innerHTML = htmlText;

  // Init behavior
  initBottomNavBehavior();

  isBottomNavLoaded = true;
}

// ============================================================
//   INIT BEHAVIOR
// ============================================================
function initBottomNavBehavior() {
  const bottomNav = document.querySelector('.bottom-nav');
  if (!bottomNav) {
    console.warn('[BottomNav] .bottom-nav not found');
    return;
  }

  // --------------------------------------------------------
  //   ROUTE NAVIGATION via data-route
  // --------------------------------------------------------
  const routeLinks = bottomNav.querySelectorAll('[data-route]');
  routeLinks.forEach(link => {
    on(link, 'click', (e) => {
      // Skip jika ini tombol "more menu" (bukan navigasi)
      if (link.id === 'moreMenuBtn') return;

      e.preventDefault();
      const route = link.dataset.route;
      if (!route) return;

      // Dispatch custom event untuk router
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { hash: route },
      }));
    });
  });

  // --------------------------------------------------------
  //   MORE MENU BUTTON: handle bootstrap modal + wire logout
  // --------------------------------------------------------
  const moreMenuBtn = document.getElementById('moreMenuBtn');
  on(moreMenuBtn, 'click', (e) => {
    // Bootstrap modal di-trigger via data-bs-toggle, tapi kita
    // perlu wire logout button di dalamnya.
    // Delay sedikit agar modal sudah render
    setTimeout(wireMoreMenuModal, 50);
  });

  // --------------------------------------------------------
  //   WIRE "MORE MENU" MODAL (jika ada di DOM)
  // --------------------------------------------------------
  wireMoreMenuModal();

  // --------------------------------------------------------
  //   INITIAL ACTIVE STATE
  // --------------------------------------------------------
  updateBottomNavActive(window.location.hash || '#/admin/dashboard');
}

// ============================================================
//   WIRE MORE MENU MODAL
// ============================================================
function wireMoreMenuModal() {
  const modalEl = document.getElementById(MODAL_ID);
  if (!modalEl) return;

  // Skip jika sudah di-wire
  if (modalEl.dataset.wired === 'true') return;
  modalEl.dataset.wired = 'true';

  // --------------------------------------------------------
  //   NAVIGATION LINKS di dalam modal
  // --------------------------------------------------------
  const routeLinks = modalEl.querySelectorAll('[data-route]');
  routeLinks.forEach(link => {
    on(link, 'click', (e) => {
      const route = link.dataset.route;
      if (!route) return;

      // Close modal dulu
      try {
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst) inst.hide();
      } catch (err) {}

      // Navigate
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('router:navigate', {
          detail: { hash: route },
        }));
      }, 150);

      e.preventDefault();
    });
  });

  // --------------------------------------------------------
  //   LOGOUT di dalam modal
  // --------------------------------------------------------
  const logoutBtn = modalEl.querySelector('#mobileLogoutBtn') || document.getElementById('mobileLogoutBtn');
  on(logoutBtn, 'click', (e) => {
    e.preventDefault();

    if (!confirm('Yakin ingin logout dari sistem?')) return;

    // Close modal
    try {
      const inst = bootstrap.Modal.getInstance(modalEl);
      if (inst) inst.hide();
    } catch (err) {}

    // Logout
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
//   UPDATE ACTIVE STATE (dipanggil dari router)
// ============================================================
export function updateBottomNavActive(route) {
  if (!route) return;

  const bottomNav = document.querySelector('.bottom-nav');
  if (!bottomNav) return;

  // Update active state di bottom nav utama
  const routeLinks = bottomNav.querySelectorAll('[data-route]');
  routeLinks.forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('active', isActive);
  });

  // Jika route aktif tidak ada di 4 menu utama (mis. berada di
  // menu sekunder), highlight tombol "More Menu"
  const primaryRoutes = Array.from(routeLinks).map(l => l.dataset.route);
  const isPrimaryActive = primaryRoutes.includes(route);

  if (!isPrimaryActive) {
    const moreBtn = document.getElementById('moreMenuBtn');
    if (moreBtn) moreBtn.classList.add('active');
  } else {
    const moreBtn = document.getElementById('moreMenuBtn');
    if (moreBtn) moreBtn.classList.remove('active');
  }
}

// ============================================================
//   MANUAL: Close "More Menu" modal
// ============================================================
export function closeMoreMenu() {
  const modalEl = document.getElementById(MODAL_ID);
  if (!modalEl) return;

  try {
    const inst = bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
  } catch (e) {}
}

// ============================================================
//   UNLOAD: Cleanup
// ============================================================
export function unloadBottomNav() {
  listeners.forEach(({ el, ev, handler }) => {
    try { el.removeEventListener(ev, handler); } catch (e) {}
  });
  listeners.length = 0;
  isBottomNavLoaded = false;
}
// ============================================================
// js/components/sidebar.js — Full Fix Sidebar Loader (v26.1.1)
// ============================================================
// Fitur:
// - Load partials/sidebar.html via fetch (dengan cache buster)
// - Fallback: render sidebar dari string jika fetch gagal
// - Toggle minimize (dengan persistensi localStorage)
// - Submenu expand/collapse (accordion)
// - Router integration via custom event 'router:navigate'
// - Active state sync (dari hash + manual call)
// - Logout integration
// - Mobile responsive handling (auto-close saat navigasi)
// - Escape key: close all submenus & mobile sidebar
// - Cleanup lifecycle (unloadSidebar)
//
// v26.1.1 UPDATE:
// ✅ Fallback HTML: brand → link ke index.html publik (bukan #/admin/dashboard)
// ✅ Hapus data-route dari brand → supaya tidak trigger SPA router
// ✅ Brand click handler: force navigate ke index.html (jaga-jaga kalau
//    browser block default anchor behavior)
// ✅ Title brand lebih deskriptif
// ✅ Update header versi → v26.1.1
// ============================================================

import { logout as apiLogout, getUserRole, getUserData, escapeHtml } from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const SIDEBAR_CONTAINER_ID = 'sidebar-container';
const SIDEBAR_WRAPPER_ID = 'sidebarWrapper';
const MINIMIZED_STORAGE_KEY = 'pkd_sidebar_minimized';
const PUBLIC_INDEX_URL = BASE_PATH + 'index.html';

// ============================================================
//   FALLBACK HTML — digunakan jika fetch partials gagal
//   NOTE: Brand area link ke INDEX.HTML (publik), BUKAN SPA route
// ============================================================
const FALLBACK_SIDEBAR_HTML = `
<div class="sidebar-wrapper" id="sidebarWrapper" role="navigation" aria-label="Navigasi utama">

  <div class="sidebar-toggle">
    <button type="button" id="toggleSidebarBtn" title="Minimize / Maximize Sidebar" aria-label="Minimize atau maximize sidebar">
      <i class="bi bi-arrow-left-right" aria-hidden="true"></i>
    </button>
  </div>

  <!-- ⭐ Brand → link ke beranda publik -->
  <div class="sidebar-brand-area">
    <a class="brand-sidebar" href="${PUBLIC_INDEX_URL}" title="Kunjungi Beranda Publik" target="_self">
      <img src="${BASE_PATH}LOGO%20ANSOR.webp" alt="GP Ansor">
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

      <div class="nav-link" data-target="akademik" title="Akademik" role="button" tabindex="0">
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

      <div class="nav-link" data-target="peserta" title="Peserta" role="button" tabindex="0">
        <i class="bi bi-people" aria-hidden="true"></i>
        <span>Peserta</span>
      </div>
      <div class="submenu" id="submenu-peserta">
        <a class="nav-link" href="#/admin/peserta" data-route="#/admin/peserta" title="Peserta">
          <i class="bi bi-person-badge" aria-hidden="true"></i>
          <span>Peserta</span>
        </a>
        <a class="nav-link" href="#/admin/alumni" data-route="#/admin/alumni" title="Alumni">
          <i class="bi bi-award" aria-hidden="true"></i>
          <span>Alumni</span>
        </a>
        <a class="nav-link" href="#/admin/kader" data-route="#/admin/kader" title="Kader">
          <i class="bi bi-people-fill" aria-hidden="true"></i>
          <span>Kader</span>
        </a>
      </div>

      <div class="nav-link" data-target="absensi" title="Absensi" role="button" tabindex="0">
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

      <div class="nav-link" data-target="informasi" title="Informasi" role="button" tabindex="0">
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
//   STATE (module-level — untuk cleanup)
// ============================================================
const listeners = [];
let isSidebarLoaded = false;

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
}

function safeLocalStorage(fn) {
  try { return fn(); } catch (e) { return null; }
}

function isMobile() {
  return window.innerWidth < 992;
}

// ============================================================
//   LOAD SIDEBAR
// ============================================================
export async function loadSidebar() {
  const container = document.getElementById(SIDEBAR_CONTAINER_ID);
  if (!container) {
    console.warn('[Sidebar] Container #' + SIDEBAR_CONTAINER_ID + ' not found');
    return;
  }

  // Cegah double-load
  if (isSidebarLoaded) return;

  let htmlText = null;

  // Coba fetch partials
  try {
    const res = await fetch(`${BASE_PATH}partials/sidebar.html?v=${Date.now()}`);
    if (res.ok) {
      htmlText = await res.text();
    } else {
      console.warn('[Sidebar] Fetch returned HTTP', res.status, '→ using fallback');
    }
  } catch (e) {
    console.warn('[Sidebar] Fetch failed:', e.message, '→ using fallback');
  }

  // Fallback jika fetch gagal
  if (!htmlText || !htmlText.trim()) {
    console.warn('[Sidebar] Using fallback HTML');
    htmlText = FALLBACK_SIDEBAR_HTML;
  }

  container.innerHTML = htmlText;

  // Init behaviors
  initSidebarBehavior();

  isSidebarLoaded = true;
}

// ============================================================
//   INIT BEHAVIOR
// ============================================================
function initSidebarBehavior() {
  const sidebar = document.getElementById(SIDEBAR_WRAPPER_ID);
  if (!sidebar) {
    console.warn('[Sidebar] Wrapper #' + SIDEBAR_WRAPPER_ID + ' not found');
    return;
  }

  // Restore minimized state dari localStorage
  const minimizedSaved = safeLocalStorage(() => localStorage.getItem(MINIMIZED_STORAGE_KEY));
  if (minimizedSaved === 'true' && !isMobile()) {
    sidebar.classList.add('minimized');
  }

  // --------------------------------------------------------
  //   TOGGLE MINIMIZE
  // --------------------------------------------------------
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  on(toggleBtn, 'click', () => {
    sidebar.classList.toggle('minimized');
    const isMinimized = sidebar.classList.contains('minimized');

    // Update icon
    const icon = toggleBtn.querySelector('i');
    if (icon) {
      icon.classList.toggle('bi-arrow-left-right', !isMinimized);
      icon.classList.toggle('bi-arrow-right-left', isMinimized);
    }

    // Persist state
    safeLocalStorage(() => localStorage.setItem(MINIMIZED_STORAGE_KEY, isMinimized ? 'true' : 'false'));
  });

  // --------------------------------------------------------
  //   BRAND CLICK — force navigate ke index.html
  //   (jaga-jaga kalau browser block anchor default behavior)
  // --------------------------------------------------------
  const brandLink = sidebar.querySelector('.brand-sidebar');
  on(brandLink, 'click', function (e) {
    // Tidak ada data-route → tidak ada konflik dengan SPA router
    // Tapi kita eksplisit paksa navigasi kalau href ada
    const href = this.getAttribute('href');
    if (!href || href.startsWith('#')) return; // biarkan default

    // Pastikan tidak di-preventDefault oleh handler lain
    e.stopPropagation();

    // Kalau href adalah same-origin, biarkan browser handle
    // (jangan intercept manual supaya browser bisa resolve full URL)
  });

  // --------------------------------------------------------
  //   SUBMENU EXPAND/COLLAPSE
  // --------------------------------------------------------
  const submenuLinks = sidebar.querySelectorAll('.sidebar-menu-area .nav-link[data-target]');
  submenuLinks.forEach(link => {
    on(link, 'click', (e) => {
      e.preventDefault();

      // Jika sidebar minimized, expand dulu
      if (sidebar.classList.contains('minimized')) {
        sidebar.classList.remove('minimized');
        safeLocalStorage(() => localStorage.setItem(MINIMIZED_STORAGE_KEY, 'false'));
        const icon = toggleBtn?.querySelector('i');
        if (icon) {
          icon.classList.add('bi-arrow-left-right');
          icon.classList.remove('bi-arrow-right-left');
        }
      }

      const targetId = 'submenu-' + link.dataset.target;
      const submenu = document.getElementById(targetId);
      if (!submenu) return;

      const isOpen = submenu.classList.contains('open');

      // Close all other submenus (accordion behavior)
      sidebar.querySelectorAll('.submenu').forEach(sm => {
        if (sm.id !== targetId) sm.classList.remove('open');
      });

      // Toggle target
      submenu.classList.toggle('open', !isOpen);
    });

    // Keyboard support
    on(link, 'keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        link.click();
      }
    });
  });

  // --------------------------------------------------------
  //   ROUTE NAVIGATION via data-route
  //   (Brand area TIDAK punya data-route → tidak akan kena handler ini)
  // --------------------------------------------------------
  const routeLinks = sidebar.querySelectorAll('[data-route]');
  routeLinks.forEach(link => {
    on(link, 'click', (e) => {
      e.preventDefault();
      const route = link.dataset.route;
      if (!route) return;

      // Dispatch custom event untuk router
      window.dispatchEvent(new CustomEvent('router:navigate', {
        detail: { hash: route },
      }));

      // Mobile: auto-close sidebar setelah navigate
      if (isMobile()) {
        sidebar.classList.remove('show');
      }
    });
  });

  // --------------------------------------------------------
  //   LOGOUT
  // --------------------------------------------------------
  const logoutBtn = document.getElementById('sidebarLogoutBtn');
  on(logoutBtn, 'click', (e) => {
    e.preventDefault();

    // Konfirmasi logout
    if (!confirm('Yakin ingin logout dari sistem?')) return;

    try {
      apiLogout();
    } catch (err) {
      console.error('[Sidebar] Logout error:', err);
      // Fallback: redirect manual
      window.location.href = BASE_PATH + 'index.html';
    }
  });

  // --------------------------------------------------------
  //   ESC KEY: Close all submenus + mobile sidebar
  // --------------------------------------------------------
  on(document, 'keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Close all submenus
    sidebar.querySelectorAll('.submenu.open').forEach(sm => {
      sm.classList.remove('open');
    });

    // Close mobile sidebar
    if (isMobile()) {
      sidebar.classList.remove('show');
    }
  });

  // --------------------------------------------------------
  //   MOBILE: Auto-close sidebar saat klik di luar
  // --------------------------------------------------------
  on(document, 'click', (e) => {
    if (!isMobile()) return;
    if (!sidebar.classList.contains('show')) return;

    const isClickInside = sidebar.contains(e.target);
    const isToggleClick = e.target.closest('.navbar-toggler') || e.target.closest('#mobileSidebarBtn');

    if (!isClickInside && !isToggleClick) {
      sidebar.classList.remove('show');
    }
  });

  // --------------------------------------------------------
  //   RESIZE: Handle mobile → desktop transition
  // --------------------------------------------------------
  let resizeTimer = null;
  on(window, 'resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      // Desktop: remove mobile 'show' class, restore minimized state
      if (!isMobile()) {
        sidebar.classList.remove('show');
        const minimizedSaved = safeLocalStorage(() => localStorage.getItem(MINIMIZED_STORAGE_KEY));
        if (minimizedSaved === 'true') {
          sidebar.classList.add('minimized');
        }
      } else {
        // Mobile: remove minimized
        sidebar.classList.remove('minimized');
      }
    }, 200);
  });

  // --------------------------------------------------------
  //   INITIAL ACTIVE STATE berdasarkan hash saat ini
  // --------------------------------------------------------
  updateSidebarActive(window.location.hash || '#/admin/dashboard');
}

// ============================================================
//   UPDATE ACTIVE STATE (dipanggil dari router)
// ============================================================
export function updateSidebarActive(route) {
  if (!route) return;

  const sidebar = document.getElementById(SIDEBAR_WRAPPER_ID);
  if (!sidebar) return;

  const allRoutes = sidebar.querySelectorAll('[data-route]');
  let hasActive = false;

  allRoutes.forEach(link => {
    const isActive = link.dataset.route === route;
    link.classList.toggle('active', isActive);

    if (isActive) {
      hasActive = true;

      // Auto-open parent submenu
      const submenu = link.closest('.submenu');
      if (submenu) {
        submenu.classList.add('open');

        // Highlight parent nav-link juga
        const parentTarget = submenu.id.replace('submenu-', '');
        sidebar.querySelectorAll('.nav-link[data-target]').forEach(parent => {
          if (parent.dataset.target === parentTarget) {
            parent.classList.add('active');
          } else {
            parent.classList.remove('active');
          }
        });
      }
    }
  });

  // Jika tidak ada yang aktif (mis. route tidak dikenal),
  // remove active dari semua parent data-target juga
  if (!hasActive) {
    sidebar.querySelectorAll('.nav-link[data-target]').forEach(parent => {
      parent.classList.remove('active');
    });
  }
}

// ============================================================
//   MANUAL: TOGGLE SIDEBAR (dipanggil dari luar, mis. tombol navbar mobile)
// ============================================================
export function toggleSidebar() {
  const sidebar = document.getElementById(SIDEBAR_WRAPPER_ID);
  if (!sidebar) return;

  if (isMobile()) {
    sidebar.classList.toggle('show');
  } else {
    sidebar.classList.toggle('minimized');
    const toggleBtn = document.getElementById('toggleSidebarBtn');
    const icon = toggleBtn?.querySelector('i');
    if (icon) {
      const isMinimized = sidebar.classList.contains('minimized');
      icon.classList.toggle('bi-arrow-left-right', !isMinimized);
      icon.classList.toggle('bi-arrow-right-left', isMinimized);
    }
    safeLocalStorage(() => localStorage.setItem(MINIMIZED_STORAGE_KEY,
      sidebar.classList.contains('minimized') ? 'true' : 'false'));
  }
}

// ============================================================
//   UNLOAD: Cleanup
// ============================================================
export function unloadSidebar() {
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;
  isSidebarLoaded = false;
}

// ============================================================
//   AUTO-CLEANUP saat halaman unload
// ============================================================
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    // Cleanup ringan — hanya clear timer jika ada (future-proofing)
    // Full cleanup sudah ada di unloadSidebar()
  }, { once: true });
}

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Sidebar v26.1.1 — Brand → Index Publik ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
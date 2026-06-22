// =====================================================
//   SPA - SINGLE PAGE APPLICATION FOR PKD GP ANSOR
//   Versi 2.0.0
//   File: admin/spa.js
// =====================================================

/**
 * SPA Module - Menangani navigasi tanpa reload halaman
 * Mendukung semua menu admin (dashboard, skrining, pretest, posttest,
 * sesi absen, materi, peserta, alumni, kader, informasi,
 * data absensi, rekap absensi, sertifikat, pengaturan)
 * 
 * Integrasi dengan DataCache untuk akses data instan.
 */

const SPA = (function() {
  'use strict';

  // =====================================================
  //   KONFIGURASI
  // =====================================================

  const CONFIG = {
    // Selector untuk konten utama
    contentSelector: '.content-wrapper',
    // Selector untuk menu sidebar dan bottom nav
    menuSelector: '.nav-pills .nav-link, .bottom-nav .nav-item',
    // Selector untuk link yang harus di-handle oleh SPA
    linkSelector: 'a[href$=".html"]',
    // Class untuk menandai menu aktif
    activeClass: 'active',
    // Base path (relative dari folder admin)
    basePath: './',
    // Debug mode
    debug: true,
    // Fallback ke reload jika SPA gagal
    fallbackReload: true,
    // Waktu loading minimal (ms) untuk efek smooth
    minLoadTime: 200,
    // Waktu maksimal loading (ms) sebelum fallback
    maxLoadTime: 10000
  };

  // =====================================================
  //   STATE
  // =====================================================

  let state = {
    currentUrl: window.location.pathname,
    isLoading: false,
    loadTimer: null,
    contentWrapper: null,
    lastLoadedUrl: null
  };

  // =====================================================
  //   UTILITY FUNCTIONS
  // =====================================================

  function log(message, data) {
    if (CONFIG.debug) {
      console.log('[SPA]', message, data || '');
    }
  }

  function error(message, data) {
    console.error('[SPA]', message, data || '');
  }

  function warn(message) {
    console.warn('[SPA]', message);
  }

  /**
   * Mengekstrak nama file dari URL
   */
  function getFilename(url) {
    if (!url) return '';
    const parts = url.split('/');
    return parts[parts.length - 1].split('?')[0];
  }

  /**
   * Mengekstrak nama halaman dari URL (tanpa .html)
   */
  function getPageName(url) {
    const filename = getFilename(url);
    return filename.replace('.html', '');
  }

  /**
   * Mengecek apakah URL adalah halaman internal
   */
  function isInternalLink(href) {
    if (!href) return false;
    if (href.startsWith('http') || href.startsWith('https')) return false;
    if (href.startsWith('#')) return false;
    if (href.startsWith('javascript:')) return false;
    if (href.startsWith('mailto:')) return false;
    if (href.startsWith('tel:')) return false;
    return true;
  }

  /**
   * Memeriksa apakah URL mengarah ke halaman admin
   */
  function isAdminPage(url) {
    const pageName = getPageName(url);
    const adminPages = [
      'dashboard_admin', 'skrining_admin', 'pretest_admin', 'posttest_admin',
      'sesi_absen_admin', 'materi_admin', 'peserta_admin', 'alumni_admin',
      'kader_admin', 'informasi_admin', 'data_absensi_admin', 'rekap_absensi_admin',
      'sertifikat_admin', 'pengaturan_admin'
    ];
    return adminPages.includes(pageName);
  }

  /**
   * Menampilkan skeleton loading
   */
  function showSkeleton() {
    return `
      <div class="text-center py-5 fade-in">
        <div class="spinner-border text-primary" style="width: 3rem; height: 3rem;" role="status">
          <span class="visually-hidden">Memuat...</span>
        </div>
        <p class="text-muted mt-2 small">Memuat halaman...</p>
      </div>
    `;
  }

  /**
   * Menampilkan pesan error
   */
  function showError(message) {
    return `
      <div class="alert alert-danger border-0 shadow-sm fade-in">
        <h6><i class="bi bi-exclamation-triangle me-2"></i>Gagal memuat halaman</h6>
        <p class="mb-0">${message || 'Terjadi kesalahan saat memuat halaman.'}</p>
        <button class="btn btn-outline-danger btn-sm mt-2" onclick="location.reload()">
          <i class="bi bi-arrow-clockwise me-1"></i> Muat ulang
        </button>
      </div>
    `;
  }

  // =====================================================
  //   CORE SPA FUNCTIONS
  // =====================================================

  /**
   * Memuat konten dari URL target
   */
  async function loadContent(targetUrl) {
    // Prevent loading same page
    if (state.lastLoadedUrl === targetUrl && !state.isLoading) {
      log('Halaman sudah dimuat, skip:', targetUrl);
      return;
    }

    // Prevent concurrent loads
    if (state.isLoading) {
      log('Sedang memuat, skip:', targetUrl);
      return;
    }

    state.isLoading = true;
    const startTime = performance.now();

    // Show skeleton
    const container = document.querySelector(CONFIG.contentSelector);
    if (!container) {
      error('Content wrapper tidak ditemukan');
      state.isLoading = false;
      return;
    }

    container.innerHTML = showSkeleton();

    // Set timeout fallback
    const timeoutId = setTimeout(() => {
      if (state.isLoading) {
        warn('Loading timeout, fallback ke reload');
        state.isLoading = false;
        window.location.href = targetUrl;
      }
    }, CONFIG.maxLoadTime);

    try {
      log('Memuat konten dari:', targetUrl);

      // Fetch halaman target
      const response = await fetch(targetUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const html = await response.text();

      // Parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Ekstrak content wrapper
      const newContent = doc.querySelector(CONFIG.contentSelector);
      if (!newContent) {
        throw new Error('Halaman target tidak memiliki content-wrapper');
      }

      // Ekstrak scripts
      const scripts = newContent.querySelectorAll('script');

      // Ganti konten lama dengan konten baru
      container.innerHTML = newContent.innerHTML;

      // Eksekusi script dari konten baru
      scripts.forEach(oldScript => {
        const newScript = document.createElement('script');
        // Copy text content
        newScript.textContent = oldScript.textContent;
        // Copy attributes
        Array.from(oldScript.attributes).forEach(attr => {
          newScript.setAttribute(attr.name, attr.value);
        });
        container.appendChild(newScript);
      });

      // Update URL without reload
      const relativeUrl = targetUrl.replace(/^\.\//, '');
      const newUrl = relativeUrl;
      if (window.location.pathname !== newUrl) {
        window.history.pushState({ path: newUrl }, '', newUrl);
      }

      // Update active states
      updateActiveStates(newUrl);

      // Update last loaded URL
      state.lastLoadedUrl = newUrl;

      // Calculate load time
      const endTime = performance.now();
      const loadTime = endTime - startTime;

      log(`Halaman dimuat dalam ${loadTime.toFixed(0)}ms:`, newUrl);

      // Dispatch event 'pageLoaded' for page-specific init
      window.dispatchEvent(new CustomEvent('pageLoaded', {
        detail: { url: newUrl, pageName: getPageName(newUrl), loadTime: loadTime }
      }));

      // Dispatch event 'pageReady' for global listeners
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pageReady'));
      }, 10);

    } catch (err) {
      error('Gagal memuat halaman:', err);

      container.innerHTML = showError(
        `Tidak dapat memuat halaman <strong>${getFilename(targetUrl)}</strong>.<br>
        ${err.message}<br>
        <small class="text-muted">Klik tombol di bawah untuk memuat ulang halaman.</small>`
      );

      // Fallback reload if configured
      if (CONFIG.fallbackReload) {
        setTimeout(() => {
          if (confirm('Gagal memuat halaman. Ingin memuat ulang?')) {
            window.location.href = targetUrl;
          }
        }, 1500);
      }

    } finally {
      clearTimeout(timeoutId);
      state.isLoading = false;
    }
  }

  // =====================================================
  //   ACTIVE STATE MANAGEMENT
  // =====================================================

  /**
   * Memperbarui status active pada menu sidebar dan bottom nav
   */
  function updateActiveStates(currentUrl) {
    // Update sidebar
    const sidebarLinks = document.querySelectorAll('.sidebar-wrapper .nav-pills .nav-link');
    sidebarLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const isActive = href === currentUrl || href === './' + currentUrl || currentUrl.endsWith(href);
        link.classList.toggle(CONFIG.activeClass, isActive);
      }
    });

    // Update bottom nav
    const bottomNavLinks = document.querySelectorAll('.bottom-nav .nav-item');
    bottomNavLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const isActive = href === currentUrl || href === './' + currentUrl || currentUrl.endsWith(href);
        link.classList.toggle(CONFIG.activeClass, isActive);
      }
    });
  }

  // =====================================================
  //   EVENT HANDLERS
  // =====================================================

  /**
   * Menangani klik pada link menu
   */
  function handleMenuClick(e) {
    const link = e.currentTarget;
    const href = link.getAttribute('href');

    if (!href || !isInternalLink(href)) {
      return; // Biarkan default (buka di tab baru, mailto, dll.)
    }

    // Handle # links (scroll)
    if (href === '#') {
      e.preventDefault();
      return;
    }

    // Cegah navigasi default
    e.preventDefault();

    // Jika link sudah active, jangan reload
    if (link.classList.contains(CONFIG.activeClass)) {
      log('Link sudah active, skip:', href);
      return;
    }

    // Muat konten
    loadContent(href);
  }

  /**
   * Menangani event popstate (back/forward)
   */
  function handlePopState(e) {
    const stateData = e.state;
    if (stateData && stateData.path) {
      log('Popstate detected, loading:', stateData.path);
      loadContent(stateData.path);
    } else {
      // Fallback ke URL saat ini
      const currentPath = window.location.pathname;
      const filename = currentPath.split('/').pop() || 'dashboard_admin.html';
      log('Popstate fallback to:', filename);
      loadContent(filename);
    }
  }

  // =====================================================
  //   INITIALIZATION
  // =====================================================

  /**
   * Inisialisasi SPA
   */
  function init() {
    log('Inisialisasi SPA...');

    // Cari content wrapper
    state.contentWrapper = document.querySelector(CONFIG.contentSelector);
    if (!state.contentWrapper) {
      error('Content wrapper tidak ditemukan, SPA tidak akan berfungsi');
      return false;
    }

    // Setup menu links (sidebar + bottom nav)
    const menuLinks = document.querySelectorAll(CONFIG.menuSelector);
    if (menuLinks.length === 0) {
      warn('Tidak ada menu link yang ditemukan');
    } else {
      menuLinks.forEach(link => {
        link.addEventListener('click', handleMenuClick);
      });
      log(`Berhasil setup ${menuLinks.length} menu link`);
    }

    // Setup all internal links (optional)
    const allLinks = document.querySelectorAll(CONFIG.linkSelector);
    allLinks.forEach(link => {
      // Hanya link yang bukan menu utama
      if (!link.closest('.nav-pills') && !link.closest('.bottom-nav')) {
        link.addEventListener('click', function(e) {
          const href = this.getAttribute('href');
          if (href && isInternalLink(href) && href !== '#' && !href.startsWith('javascript:')) {
            e.preventDefault();
            loadContent(href);
          }
        });
      }
    });

    // Setup popstate
    window.addEventListener('popstate', handlePopState);

    // Set initial active state based on current URL
    const currentUrl = window.location.pathname.split('/').pop() || 'dashboard_admin.html';
    updateActiveStates(currentUrl);
    state.lastLoadedUrl = currentUrl;

    // Dispatch event when SPA is ready
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('spaReady', {
        detail: { version: '2.0.0' }
      }));
    }, 100);

    log('SPA siap digunakan');
    return true;
  }

  // =====================================================
  //   PUBLIC API
  // =====================================================

  const publicAPI = {
    init: init,
    load: loadContent,
    reload: function() {
      const current = window.location.pathname.split('/').pop() || 'dashboard_admin.html';
      loadContent(current);
    },
    navigate: loadContent,
    getState: function() {
      return { ...state };
    },
    isActive: function(url) {
      const current = window.location.pathname.split('/').pop() || 'dashboard_admin.html';
      return url === current || current.endsWith(url);
    },
    setDebug: function(enabled) {
      CONFIG.debug = enabled;
    }
  };

  // =====================================================
  //   AUTO-INITIALIZE
  // =====================================================

  // Jalankan init saat DOM siap
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      init();
    });
  } else {
    // DOM sudah siap
    init();
  }

  return publicAPI;

})();

// =====================================================
//   EXPORT TO WINDOW
// =====================================================

if (typeof window !== 'undefined') {
  window.SPA = SPA;
  console.log('%c SPA v2.0.0 Loaded ', 'background: #2563eb; color: white; padding: 4px; border-radius: 4px;');
}

// =====================================================
//   INTEGRATION WITH DATACACHE
// =====================================================

// Mendengarkan event pageLoaded untuk memicu inisialisasi data
document.addEventListener('pageLoaded', function(e) {
  const pageName = e.detail.pageName || '';

  // Cari fungsi init di halaman yang dimuat
  // Setiap halaman admin diharapkan memiliki fungsi init() atau window.initPage()
  if (typeof window.initPage === 'function') {
    window.initPage(pageName);
  }

  // Fallback: panggil fungsi init jika ada
  if (typeof window.init === 'function' && pageName !== 'dashboard_admin') {
    // Hindari double init untuk dashboard
    setTimeout(() => {
      window.init();
    }, 50);
  }
});

// Mendengarkan event spaReady untuk integrasi lebih lanjut
document.addEventListener('spaReady', function(e) {
  console.log('SPA ready with version:', e.detail.version);

  // Jika DataCache tersedia, log status
  if (typeof DataCache !== 'undefined') {
    const stats = DataCache.getStats();
    console.log('DataCache stats:', stats);
  }
});

// Mendengarkan event pageReady untuk inisialisasi setelah DOM stabil
document.addEventListener('pageReady', function() {
  // Re-run sidebar toggle jika ada
  const toggleBtn = document.getElementById('toggleSidebarBtn');
  const sidebar = document.getElementById('sidebarWrapper');
  if (toggleBtn && sidebar) {
    // Hapus listener lama (jika ada) dan tambah baru
    // (Implementasi sederhana: jangan duplicate listener)
    // Kita asumsikan toggle sudah di-handle di admin.html
  }

  // Re-inisialisasi tooltips jika ada
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  if (tooltipTriggerList.length > 0) {
    tooltipTriggerList.forEach(el => {
      new bootstrap.Tooltip(el);
    });
  }
});

// =====================================================
//   END OF SPA.JS
// =====================================================
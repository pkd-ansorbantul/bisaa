// ============================================================
// js/router.js — Full Production Hash Router (v26.1.6)
// ============================================================
// Fitur:
// ✅ Hash-based routing (#/admin/xxx)
// ✅ Fragment HTML cache (in-memory Map)
// ✅ Dynamic JS module loading dengan mount()/unmount() lifecycle
// ✅ Query string parsing (?key=value)
// ✅ Sidebar & bottom-nav active state sync (DOM + event)
// ✅ Custom event 'router:navigate' (dari sidebar/bottom-nav)
// ✅ Custom event 'routeChanged' (dikirim ke global)
// ✅ Scroll behavior: top | smooth | none
// ✅ Cache buster support (opsional)
// ✅ Concurrent navigation guard (token-based)
// ✅ Retry otomatis untuk fragment yang gagal load
// ✅ Error UI user-friendly (not found + render error)
// ✅ Bootstrap modal artifact cleanup
// ✅ Public API: start(), navigate(), reload(), destroy(), getCurrentRoute()
// ============================================================

// ============================================================
//   DEFAULT OPTIONS
// ============================================================
const DEFAULT_OPTIONS = {
  defaultRoute: '#/admin/dashboard',
  scrollBehavior: 'top',       // 'top' | 'smooth' | 'none'
  useCacheBuster: true,
  showLoadingUI: true,
  maxRetries: 1,
  debug: false,
};

// ============================================================
//   ROUTER CLASS
// ============================================================
class Router {
  /**
   * @param {HTMLElement} container - Element tempat konten di-inject
   * @param {Object} routes - Registry route: { '#/admin/xxx': { html, js } }
   * @param {Object} [options] - Override default options
   */
  constructor(container, routes, options = {}) {
    // ====== VALIDASI ======
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[Router] Container harus HTMLElement yang valid');
    }
    if (!routes || typeof routes !== 'object' || Object.keys(routes).length === 0) {
      throw new Error('[Router] Routes harus object dengan minimal 1 route');
    }

    // ====== SIMPAN REFERENSI ======
    this.container = container;
    this.routes = routes;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // ====== STATE ======
    this.currentRoute = null;         // hash path aktif (contoh: '#/admin/peserta')
    this.currentHash = null;          // hash lengkap termasuk query
    this.currentCleanup = null;       // cleanup function dari mount() sebelumnya
    this.currentModule = null;        // module JS yang sedang aktif
    this.navigationToken = 0;         // token untuk cegah race condition
    this.isNavigating = false;
    this.hasStarted = false;
    this.fragmentCache = new Map();   // url → html string
    this.failedRoutes = new Set();    // tracking route gagal

    // ====== BIND HANDLERS ======
    this._onHashChange = this._onHashChange.bind(this);
    this._onRouterNavigate = this._onRouterNavigate.bind(this);
    this._onPopState = this._onPopState.bind(this);

    // ====== ATTACH GLOBAL LISTENERS ======
    window.addEventListener('hashchange', this._onHashChange);
    window.addEventListener('router:navigate', this._onRouterNavigate);
    window.addEventListener('popstate', this._onPopState);

    if (this.options.debug) {
      console.log('[Router] Initialized dengan', Object.keys(routes).length, 'routes');
    }
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  /**
   * Start router — panggil sekali setelah DOM ready.
   * Render route saat ini, atau redirect ke default route.
   */
  start() {
    if (this.hasStarted) {
      console.warn('[Router] Sudah started, mengabaikan panggilan kedua');
      return;
    }
    this.hasStarted = true;

    const currentHash = this._normalizeHash(window.location.hash);

    // Hash kosong / '#' / '#/' → redirect ke default route
    if (!currentHash || currentHash === '#' || currentHash === '#/') {
      this.navigate(this.options.defaultRoute, { replace: true });
      return;
    }

    // Render route saat ini
    this._render();
  }

  /**
   * Navigate ke route tertentu.
   * @param {string} hash - contoh: '#/admin/peserta' atau '#/admin/peserta?page=2'
   * @param {Object} [opts] - { replace: boolean } → true untuk replace history
   */
  navigate(hash, opts = {}) {
    if (!hash || typeof hash !== 'string') {
      console.warn('[Router] navigate() butuh hash string');
      return;
    }

    const target = this._normalizeHash(hash);
    const currentHash = window.location.hash;

    // Hash sama dengan current → force re-render (user klik menu yang sama)
    if (target === currentHash) {
      this._render(true);
      return;
    }

    if (opts.replace) {
      // Replace: ganti hash tanpa push history, langsung render
      try {
        history.replaceState(null, '', target);
      } catch (e) {
        console.warn('[Router] replaceState gagal:', e);
      }
      this._render();
    } else {
      // Normal: set hash → hashchange event akan trigger render
      window.location.hash = target;
    }
  }

  /**
   * Force reload route saat ini (bersihkan cache fragment + re-import module).
   * @returns {Promise<void>}
   */
  async reload() {
    if (this.currentRoute) {
      const route = this._resolveRoute(this.currentRoute);
      if (route && route.html) {
        this.fragmentCache.delete(route.html);
      }
    }
    await this._render(true);
  }

  /**
   * Get current route.
   * @returns {string|null} contoh: '#/admin/peserta'
   */
  getCurrentRoute() {
    return this.currentRoute;
  }

  /**
   * Destroy router — lepas semua listener & cleanup. Panggil saat halaman unload.
   */
  destroy() {
    window.removeEventListener('hashchange', this._onHashChange);
    window.removeEventListener('router:navigate', this._onRouterNavigate);
    window.removeEventListener('popstate', this._onPopState);

    if (typeof this.currentCleanup === 'function') {
      try { this.currentCleanup(); } catch (e) { /* silent */ }
    }

    this.currentCleanup = null;
    this.currentModule = null;
    this.fragmentCache.clear();
    this.failedRoutes.clear();
    this.hasStarted = false;

    if (this.options.debug) {
      console.log('[Router] Destroyed');
    }
  }

  /* ============================================================
     EVENT HANDLERS
     ============================================================ */

  _onHashChange() {
    this._render();
  }

  _onPopState() {
    // Browser back/forward — hash sudah berubah, render ulang
    this._render();
  }

  _onRouterNavigate(e) {
    const hash = e && e.detail && e.detail.hash;
    if (!hash) return;
    this.navigate(hash);
  }

  /* ============================================================
     CORE RENDER
     ============================================================ */
  async _render(force = false) {
    const rawHash = window.location.hash || this.options.defaultRoute;
    const { path: hashPath, query } = this._parseHash(rawHash);

    // ---- Guard: hash kosong ----
    if (!hashPath || hashPath === '#' || hashPath === '#/') {
      this.navigate(this.options.defaultRoute, { replace: true });
      return;
    }

    // ---- Resolve route ----
    const route = this._resolveRoute(hashPath);
    if (!route) {
      this._renderNotFound(hashPath);
      return;
    }

    // ---- Skip kalau route sama & bukan force & tidak sedang navigasi ----
    // NOTE: Gunakan hash lengkap (termasuk query) agar perubahan query tetap re-render
    const isSameRoute = this.currentHash === rawHash;
    if (!force && isSameRoute && !this.isNavigating) {
      this._syncActiveState(hashPath);
      window.dispatchEvent(new CustomEvent('routeChanged', {
        detail: { path: hashPath, query, route, cached: true },
      }));
      return;
    }

    // ---- Token untuk cegah race condition ----
    const myToken = ++this.navigationToken;
    this.isNavigating = true;

    // ---- STEP 1: Cleanup previous view ----
    await this._cleanupPrevious();

    if (myToken !== this.navigationToken) {
      this.isNavigating = false;
      return;
    }

    // ---- STEP 2: Tampilkan loading ----
    if (this.options.showLoadingUI) {
      this._showLoading();
    }

    // ---- STEP 3: Load fragment HTML ----
    let html;
    try {
      html = await this._loadFragment(route.html, force);
    } catch (e) {
      if (myToken !== this.navigationToken) return;
      this.isNavigating = false;
      this._renderError(
        hashPath,
        'Gagal Memuat Halaman',
        e.message || 'Tidak dapat memuat konten halaman.'
      );
      return;
    }

    if (myToken !== this.navigationToken) {
      this.isNavigating = false;
      return;
    }

    // ---- STEP 4: Inject HTML ----
    this.container.innerHTML = html;

    // ---- STEP 5: Load & mount JS module ----
    try {
      const mod = await this._loadModule(route.js, force);

      if (myToken !== this.navigationToken) {
        this.isNavigating = false;
        return;
      }

      this.currentModule = mod;

      // Prioritas: named export `mount()`
      if (mod && typeof mod.mount === 'function') {
        const cleanup = await mod.mount({
          path: hashPath,
          query,
          outlet: this.container,
          router: this,
        });

        // Cleanup bisa dari return value ATAU named export unmount()
        if (typeof cleanup === 'function') {
          this.currentCleanup = cleanup;
        } else if (typeof mod.unmount === 'function') {
          this.currentCleanup = mod.unmount;
        } else {
          this.currentCleanup = null;
        }
      }
      // Fallback: default export sebagai function
      else if (mod && typeof mod.default === 'function') {
        const cleanup = await mod.default({
          path: hashPath,
          query,
          outlet: this.container,
          router: this,
        });
        this.currentCleanup = typeof cleanup === 'function' ? cleanup : null;
      } else {
        console.warn('[Router] Module tidak punya mount():', route.js);
        this.currentCleanup = null;
      }
    } catch (e) {
      if (myToken !== this.navigationToken) return;
      this.isNavigating = false;
      console.error('[Router] Gagal load/mount module:', e);
      this._renderError(
        hashPath,
        'Gagal Memuat Logic Halaman',
        e.message || 'Terjadi kesalahan saat memuat script halaman.'
      );
      return;
    }

    // ---- STEP 6: Finalize ----
    this.currentRoute = hashPath;
    this.currentHash = rawHash;
    this.isNavigating = false;

    // Update active state sidebar & bottom-nav
    this._syncActiveState(hashPath);

    // Scroll behavior
    this._applyScrollBehavior();

    // Dispatch event global untuk sinkronisasi komponen lain
    window.dispatchEvent(new CustomEvent('routeChanged', {
      detail: { path: hashPath, query, route, cached: false },
    }));

    if (this.options.debug) {
      console.log('[Router] ✅ Rendered:', hashPath, query);
    }
  }

  /* ============================================================
     CLEANUP PREVIOUS VIEW
     ============================================================ */

  async _cleanupPrevious() {
    // 1. Panggil cleanup function dari mount() sebelumnya
    if (typeof this.currentCleanup === 'function') {
      try {
        await Promise.resolve(this.currentCleanup());
      } catch (e) {
        console.warn('[Router] Cleanup error:', e);
      }
      this.currentCleanup = null;
    }

    // 2. Panggil named export unmount() kalau ada
    if (this.currentModule && typeof this.currentModule.unmount === 'function') {
      try {
        await Promise.resolve(this.currentModule.unmount());
      } catch (e) {
        console.warn('[Router] unmount() error:', e);
      }
    }

    // 3. Bersihkan artifact Bootstrap modal yang mungkin tertinggal
    this._cleanupBootstrapArtifacts();

    // 4. Reset module reference
    this.currentModule = null;
  }

  _cleanupBootstrapArtifacts() {
    try {
      document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    } catch (e) { /* silent */ }
  }

  /* ============================================================
     LOAD FRAGMENT HTML (dengan cache + retry)
     ============================================================ */

  async _loadFragment(url, force = false) {
    if (!force && this.fragmentCache.has(url)) {
      return this.fragmentCache.get(url);
    }

    const cacheBuster = this.options.useCacheBuster ? `?v=${Date.now()}` : '';
    const finalUrl = url + cacheBuster;

    let lastError = null;
    const maxRetry = this.options.maxRetries;

    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        const res = await fetch(finalUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/html' },
          cache: 'no-store',
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${res.statusText}`);
        }

        const html = await res.text();

        if (!html || !html.trim()) {
          throw new Error('Konten HTML kosong');
        }

        this.fragmentCache.set(url, html);
        this.failedRoutes.delete(url);
        return html;
      } catch (e) {
        lastError = e;
        if (attempt < maxRetry) {
          await this._sleep(300 * (attempt + 1));
        }
      }
    }

    this.failedRoutes.add(url);
    throw lastError || new Error('Gagal load fragment setelah retry');
  }

  /* ============================================================
     LOAD JS MODULE (dynamic import)
     ============================================================ */

  async _loadModule(url, force = false) {
    // Dynamic import: browser otomatis cache module.
    // Untuk force reload, tambahkan cache buster di URL query.
    const cacheBuster = (force && this.options.useCacheBuster)
      ? `?v=${Date.now()}`
      : '';
    const finalUrl = url + cacheBuster;

    return await import(finalUrl);
  }

  /* ============================================================
     ROUTE RESOLVER
     ============================================================ */

  _resolveRoute(hashPath) {
    if (!hashPath) return null;

    // 1. Exact match (dengan atau tanpa # prefix)
    if (this.routes[hashPath]) return this.routes[hashPath];

    const withHash = hashPath.startsWith('#') ? hashPath : '#' + hashPath;
    if (this.routes[withHash]) return this.routes[withHash];

    const withoutHash = hashPath.startsWith('#') ? hashPath.slice(1) : hashPath;
    if (this.routes[withoutHash]) return this.routes[withoutHash];

    // 2. Pattern match untuk dynamic routes (contoh: '#/admin/user/:id')
    for (const key of Object.keys(this.routes)) {
      if (this._matchPattern(key, withHash)) {
        return this.routes[key];
      }
    }

    return null;
  }

  _matchPattern(pattern, path) {
    if (!pattern.includes(':')) return false;

    const patParts = pattern.split('/');
    const pathParts = path.split('/');

    if (patParts.length !== pathParts.length) return false;

    for (let i = 0; i < patParts.length; i++) {
      if (patParts[i].startsWith(':')) continue;
      if (patParts[i] !== pathParts[i]) return false;
    }
    return true;
  }

  /* ============================================================
     HASH PARSER
     ============================================================ */

  _parseHash(rawHash) {
    if (!rawHash) return { path: '', query: {} };

    const hashOnly = rawHash.startsWith('#') ? rawHash : '#' + rawHash;
    const qIdx = hashOnly.indexOf('?');

    if (qIdx === -1) {
      return { path: hashOnly, query: {} };
    }

    const path = hashOnly.slice(0, qIdx);
    const queryStr = hashOnly.slice(qIdx + 1);
    const query = {};

    try {
      new URLSearchParams(queryStr).forEach((v, k) => {
        query[k] = v;
      });
    } catch (e) {
      console.warn('[Router] Gagal parse query:', queryStr);
    }

    return { path, query };
  }

  _normalizeHash(hash) {
    if (!hash) return '';
    return hash.startsWith('#') ? hash : '#' + hash;
  }

  /* ============================================================
     ACTIVE STATE SYNC (Sidebar + Bottom Nav)
     ============================================================ */

  _syncActiveState(hashPath) {
    // ---- 1. Sidebar ----
    const sidebarLinks = document.querySelectorAll(
      '#sidebar-container [data-route], #sidebarRoot [data-route], #sidebarWrapper [data-route], .sidebar-wrapper [data-route]'
    );

    sidebarLinks.forEach(link => {
      const isActive = link.dataset.route === hashPath;
      link.classList.toggle('active', isActive);

      // Auto-open parent submenu jika route ini aktif
      if (isActive) {
        const submenu = link.closest('.submenu');
        if (submenu) {
          submenu.classList.add('open');
          // Highlight parent nav-link
          const parentTarget = submenu.id.replace('submenu-', '');
          let parent = submenu.previousElementSibling;
          while (parent && !parent.classList.contains('nav-link')) {
            parent = parent.previousElementSibling;
          }
          if (parent && parent.dataset.target === parentTarget) {
            parent.classList.add('active');
          }
        }
      }
    });

    // ---- 2. Bottom Nav ----
    const bottomNavLinks = document.querySelectorAll(
      '#bottom-nav-container [data-route], #bottomNavRoot [data-route], .bottom-nav [data-route]'
    );

    bottomNavLinks.forEach(link => {
      const isActive = link.dataset.route === hashPath;
      link.classList.toggle('active', isActive);
    });
  }

  /* ============================================================
     LOADING UI
     ============================================================ */

  _showLoading() {
    this.container.innerHTML = `
      <div class="d-flex justify-content-center align-items-center" style="min-height:50vh;">
        <div class="text-center">
          <div class="spinner-border text-primary" role="status" style="width:2.5rem;height:2.5rem;">
            <span class="visually-hidden">Memuat halaman...</span>
          </div>
          <p class="mt-3 text-muted small mb-0">Memuat halaman…</p>
        </div>
      </div>
    `;
  }

  /* ============================================================
     ERROR UI
     ============================================================ */

  _renderNotFound(hashPath) {
    const safeHash = this._escapeHtml(hashPath);
    const safeDefault = this._escapeHtml(this.options.defaultRoute);

    this.container.innerHTML = `
      <div class="d-flex justify-content-center align-items-center p-4" style="min-height:60vh;">
        <div class="text-center" style="max-width:520px;">
          <i class="bi bi-signpost-split-fill text-warning" style="font-size:4rem;"></i>
          <h4 class="fw-bold mt-3">Halaman Tidak Ditemukan</h4>
          <p class="text-muted small mb-3">
            Route <code>${safeHash}</code> tidak terdaftar pada sistem.
          </p>
          <button class="btn btn-primary rounded-pill px-4" data-router-action="home">
            <i class="bi bi-house-door-fill me-1"></i> Kembali ke Dashboard
          </button>
        </div>
      </div>
    `;

    this.container.querySelector('[data-router-action="home"]')?.addEventListener('click', () => {
      this.navigate(this.options.defaultRoute);
    });

    window.dispatchEvent(new CustomEvent('routeChanged', {
      detail: { path: hashPath, notFound: true },
    }));
  }

  _renderError(hashPath, title, detail) {
    const safeTitle = this._escapeHtml(title || 'Terjadi Kesalahan');
    const safeDetail = this._escapeHtml(detail || 'Silakan coba lagi.');
    const safePath = this._escapeHtml(hashPath || '');

    this.container.innerHTML = `
      <div class="d-flex justify-content-center align-items-center p-4" style="min-height:60vh;">
        <div class="text-center" style="max-width:560px;">
          <i class="bi bi-exclamation-triangle-fill text-danger" style="font-size:4rem;"></i>
          <h4 class="fw-bold mt-3">${safeTitle}</h4>
          <p class="text-muted small mb-0">Route: <code>${safePath}</code></p>
          <div class="alert alert-danger small text-start mt-3 mb-0">${safeDetail}</div>
          <div class="d-flex gap-2 justify-content-center flex-wrap mt-3">
            <button class="btn btn-primary rounded-pill px-4" data-router-action="retry">
              <i class="bi bi-arrow-clockwise me-1"></i> Coba Lagi
            </button>
            <button class="btn btn-outline-secondary rounded-pill px-4" data-router-action="home">
              <i class="bi bi-house-door me-1"></i> Ke Dashboard
            </button>
          </div>
        </div>
      </div>
    `;

    // Bind action buttons
    this.container.querySelectorAll('[data-router-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.routerAction;
        if (action === 'retry') {
          this.reload();
        } else if (action === 'home') {
          this.navigate(this.options.defaultRoute);
        }
      });
    });

    window.dispatchEvent(new CustomEvent('routeChanged', {
      detail: { path: hashPath, error: true, title: safeTitle },
    }));
  }

  /* ============================================================
     SCROLL BEHAVIOR
     ============================================================ */

  _applyScrollBehavior() {
    const mode = this.options.scrollBehavior;
    if (mode === 'none') return;

    try {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: mode === 'smooth' ? 'smooth' : 'auto',
      });
    } catch (e) {
      // Fallback untuk browser lama
      window.scrollTo(0, 0);
    }
  }

  /* ============================================================
     UTILITY
     ============================================================ */

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

// ============================================================
//   EXPORTS
// ============================================================
export default Router;
export { Router };
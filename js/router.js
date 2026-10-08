// ============================================================
// js/router.js — v27.2.2 ROBUST MODULE LOAD EDITION
// ============================================================
// CHANGELOG v27.2.2 (dari v27.2.0):
//   ✅ FIX CRITICAL: Dynamic import ERR_ABORTED → retry + fallback
//   ✅ NEW: _loadModule dengan retry 2x + cache buster
//   ✅ NEW: Skip retry kalau error non-retryable (syntax error, dll)
//   ✅ NEW: Track failed module ke window.__pkdFailedModules
//   ✅ FIX: Race-safe navigation (pending queue tetap robust)
//   ✅ FIX: Error UI menampilkan info retry
//   ✅ KEEP: Prefetch semua route
//   ✅ KEEP: Cache buster OFF untuk HTML fragment
//   ✅ KEEP: HTML fragment cache + retry (1×)
// ============================================================

const DEFAULT_OPTIONS = {
  defaultRoute: '#/admin/dashboard',
  scrollBehavior: 'top',
  useCacheBuster: false,
  showLoadingUI: true,
  maxRetries: 2,
  debug: false,
  prefetchEnabled: true,
};

// ============================================================
//   ROUTER CLASS
// ============================================================
class Router {
  constructor(container, routes, options = {}) {
    if (!container || !(container instanceof HTMLElement)) {
      throw new Error('[Router] Container harus HTMLElement yang valid');
    }
    if (!routes || typeof routes !== 'object' || Object.keys(routes).length === 0) {
      throw new Error('[Router] Routes harus object dengan minimal 1 route');
    }

    this.container = container;
    this.routes = routes;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // STATE
    this.currentRoute = null;
    this.currentHash = null;
    this.currentCleanup = null;
    this.currentModule = null;
    this.navigationToken = 0;
    this.isNavigating = false;
    this.isRendering = false;
    this.hasStarted = false;
    this.fragmentCache = new Map();
    this.failedRoutes = new Set();

    // Pending queue
    this.pendingHash = null;
    this.pendingForce = false;

    // BIND
    this._onHashChange = this._onHashChange.bind(this);
    this._onRouterNavigate = this._onRouterNavigate.bind(this);
    this._onPopState = this._onPopState.bind(this);

    // LISTENERS
    window.addEventListener('hashchange', this._onHashChange);
    window.addEventListener('router:navigate', this._onRouterNavigate);
    window.addEventListener('popstate', this._onPopState);

    if (this.options.debug) {
      console.log('[Router] Initialized', Object.keys(routes).length, 'routes');
    }
  }

  /* ============================================================
     PUBLIC API
     ============================================================ */

  start() {
    if (this.hasStarted) {
      console.warn('[Router] Sudah started, skip');
      return;
    }
    this.hasStarted = true;

    const currentHash = this._normalizeHash(window.location.hash);

    if (!currentHash || currentHash === '#' || currentHash === '#/') {
      this.navigate(this.options.defaultRoute, { replace: true });
      return;
    }

    this._render();
  }

  navigate(hash, opts = {}) {
    if (!hash || typeof hash !== 'string') {
      console.warn('[Router] navigate() butuh hash string');
      return;
    }

    const target = this._normalizeHash(hash);
    const currentHash = window.location.hash;

    if (target === currentHash) {
      this._render(true);
      return;
    }

    if (opts.replace) {
      try {
        history.replaceState(null, '', target);
      } catch (e) {
        console.warn('[Router] replaceState gagal:', e);
      }
      this._render();
    } else {
      window.location.hash = target;
    }
  }

  async reload() {
    if (this.currentRoute) {
      const route = this._resolveRoute(this.currentRoute);
      if (route && route.html) {
        this.fragmentCache.delete(route.html);
      }
    }
    await this._render(true);
  }

  getCurrentRoute() {
    return this.currentRoute;
  }

  getCurrentHash() {
    return this.currentHash;
  }

  isMounted() {
    return !!(this.currentModule && this.currentHash);
  }

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
    this.isNavigating = false;
    this.isRendering = false;
    this.pendingHash = null;
    this.pendingForce = false;
    this.currentRoute = null;
    this.currentHash = null;

    if (this.options.debug) console.log('[Router] Destroyed');
  }

  /* ============================================================
     EVENT HANDLERS
     ============================================================ */

  _onHashChange() { this._render(); }
  _onPopState() { this._render(); }

  _onRouterNavigate(e) {
    const hash = e && e.detail && e.detail.hash;
    if (!hash) return;
    this.navigate(hash);
  }

  /* ============================================================
     CORE RENDER — SKIP-IF-MOUNTED
     ============================================================ */
  async _render(force = false) {
    const rawHash = window.location.hash || this.options.defaultRoute;
    const { path: hashPath, query } = this._parseHash(rawHash);

    if (!hashPath || hashPath === '#' || hashPath === '#/') {
      this.navigate(this.options.defaultRoute, { replace: true });
      return;
    }

    const route = this._resolveRoute(hashPath);
    if (!route) {
      this._renderNotFound(hashPath);
      return;
    }

    // ===== SKIP-IF-MOUNTED =====
    const isSameRoute = this.currentHash === rawHash;
    const isMounted = !!this.currentModule;

    if (!force && isSameRoute && isMounted && !this.isNavigating) {
      if (this.options.debug) {
        console.log('[Router] ⚡ Skip re-mount (view already mounted):', hashPath);
      }

      this._syncActiveState(hashPath);

      window.dispatchEvent(new CustomEvent('route:reused', {
        detail: { path: hashPath, query, route },
      }));

      window.dispatchEvent(new CustomEvent('routeChanged', {
        detail: { path: hashPath, query, route, cached: true, reused: true },
      }));

      return;
    }

    // ===== Pending queue =====
    if (this.isRendering) {
      if (this.options.debug) {
        console.log('[Router] Render in progress, queue pending:', rawHash);
      }
      this.pendingHash = rawHash;
      this.pendingForce = force;
      return;
    }

    const myToken = ++this.navigationToken;
    this.isNavigating = true;
    this.isRendering = true;

    try {
      // STEP 1: Cleanup previous
      await this._cleanupPrevious();

      if (myToken !== this.navigationToken) return;

      // STEP 2: Loading UI
      const isCached = this.fragmentCache.has(route.html);
      if (this.options.showLoadingUI && !isCached) {
        this._showLoading();
      }

      // STEP 3: Load fragment
      let html;
      try {
        html = await this._loadFragment(route.html, force);
      } catch (e) {
        if (myToken !== this.navigationToken) return;
        this._renderError(
          hashPath,
          'Gagal Memuat Halaman',
          e.message || 'Tidak dapat memuat konten halaman.'
        );
        return;
      }

      if (myToken !== this.navigationToken) return;

      // STEP 4: Inject HTML
      this.container.innerHTML = html;

      // STEP 5: Load & mount JS module — v27.2.2 ROBUST
      try {
        const mod = await this._loadModule(route.js);

        if (myToken !== this.navigationToken) return;

        this.currentModule = mod;

        if (mod && typeof mod.mount === 'function') {
          const cleanup = await mod.mount({
            path: hashPath,
            query,
            outlet: this.container,
            router: this,
          });

          if (typeof cleanup === 'function') {
            this.currentCleanup = cleanup;
          } else if (typeof mod.unmount === 'function') {
            this.currentCleanup = mod.unmount;
          } else {
            this.currentCleanup = null;
          }
        } else if (mod && typeof mod.default === 'function') {
          const cleanup = await mod.default({
            path: hashPath, query,
            outlet: this.container,
            router: this,
          });
          this.currentCleanup = typeof cleanup === 'function' ? cleanup : null;
        } else if (mod && mod.default && typeof mod.default.mount === 'function') {
          const cleanup = await mod.default.mount({
            path: hashPath, query,
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
        console.error('[Router] Gagal load/mount module:', e);
        this._renderError(
          hashPath,
          'Gagal Memuat Logic Halaman',
          e.message || 'Terjadi kesalahan saat memuat script.'
        );
        return;
      }

      // STEP 6: Finalize
      this.currentRoute = hashPath;
      this.currentHash = rawHash;

      this._syncActiveState(hashPath);
      this._applyScrollBehavior();

      window.dispatchEvent(new CustomEvent('routeChanged', {
        detail: { path: hashPath, query, route, cached: false, reused: false },
      }));

      if (this.options.debug) console.log('[Router] ✅ Rendered:', hashPath);

    } finally {
      this.isNavigating = false;
      this.isRendering = false;

      if (this.pendingHash && this.pendingHash !== this.currentHash) {
        const nextHash = this.pendingHash;
        const nextForce = this.pendingForce;
        this.pendingHash = null;
        this.pendingForce = false;

        if (this.options.debug) {
          console.log('[Router] Processing pending render:', nextHash);
        }

        setTimeout(() => {
          if (window.location.hash === nextHash || nextForce) {
            this._render(nextForce);
          } else {
            this._render();
          }
        }, 0);
      }
    }
  }

  /* ============================================================
     CLEANUP
     ============================================================ */
  async _cleanupPrevious() {
    if (typeof this.currentCleanup === 'function') {
      try {
        await Promise.resolve(this.currentCleanup());
      } catch (e) {
        console.warn('[Router] Cleanup error:', e);
      }
      this.currentCleanup = null;
    }

    this._cleanupBootstrapArtifacts();
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
     FRAGMENT LOADER
     ============================================================ */
  async _loadFragment(url, force = false) {
    if (!force && this.fragmentCache.has(url)) {
      return this.fragmentCache.get(url);
    }

    const cacheBuster = force && this.options.useCacheBuster ? `?v=${Date.now()}` : '';
    const finalUrl = url + cacheBuster;
    const maxRetry = this.options.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        const res = await fetch(finalUrl, {
          method: 'GET',
          headers: { 'Accept': 'text/html' },
          cache: force ? 'no-store' : 'force-cache',
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
          console.warn(`[Router] Fragment retry ${attempt + 1}/${maxRetry}: ${url}`, e.message);
          await this._sleep(300 * (attempt + 1));
        }
      }
    }

    this.failedRoutes.add(url);
    throw lastError || new Error('Gagal load fragment setelah retry');
  }

  /* ============================================================
     MODULE LOADER — v27.2.2 ROBUST RETRY
     ============================================================ */
  async _loadModule(url) {
    const maxRetry = this.options.maxRetries;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetry; attempt++) {
      try {
        if (this.options.debug) {
          console.log(`[Router] Loading module (attempt ${attempt + 1}/${maxRetry + 1}):`, url);
        }

        // Cache buster HANYA saat retry (attempt > 0)
        const importUrl = attempt === 0
          ? url
          : `${url}?retry=${Date.now()}&attempt=${attempt}`;

        const mod = await import(/* @vite-ignore */ importUrl);

        // ✅ Sukses — hapus dari failed registry
        if (window.__pkdFailedModules && window.__pkdFailedModules.has(url)) {
          window.__pkdFailedModules.delete(url);
          console.log(`[Router] ✅ Module recovered: ${url}`);
        }

        return mod;

      } catch (e) {
        lastError = e;
        const msg = String(e?.message || e || '');

        // Skip retry untuk error yang tidak akan pulih dengan retry
        const isRetryable =
          msg.includes('Failed to fetch') ||
          msg.includes('ERR_ABORTED') ||
          msg.includes('dynamically imported module') ||
          msg.includes('Importing a module script failed') ||
          msg.includes('NetworkError') ||
          msg.includes('404');

        if (!isRetryable) {
          console.error(`[Router] Non-retryable module error: ${url}`, msg);
          throw e;
        }

        if (attempt < maxRetry) {
          console.warn(`[Router] Module retry ${attempt + 1}/${maxRetry}: ${url} — ${msg}`);
          await this._sleep(400 * (attempt + 1));
        } else {
          // Track sebagai failed untuk background retry
          if (window.__pkdFailedModules) {
            const info = window.__pkdFailedModules.get(url) || { count: 0, lastError: '' };
            window.__pkdFailedModules.set(url, {
              count: info.count + 1,
              lastError: msg,
            });
          }
          console.error(`[Router] ❌ Module FAILED after ${maxRetry + 1} attempts: ${url}`);
          throw e;
        }
      }
    }

    throw lastError || new Error('Module load failed');
  }

  /* ============================================================
     ROUTE RESOLVER
     ============================================================ */
  _resolveRoute(hashPath) {
    if (!hashPath) return null;

    if (this.routes[hashPath]) return this.routes[hashPath];

    const withHash = hashPath.startsWith('#') ? hashPath : '#' + hashPath;
    if (this.routes[withHash]) return this.routes[withHash];

    const withoutHash = hashPath.startsWith('#') ? hashPath.slice(1) : hashPath;
    if (this.routes[withoutHash]) return this.routes[withoutHash];

    return null;
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
     ACTIVE STATE SYNC
     ============================================================ */
  _syncActiveState(hashPath) {
    // Sidebar
    const sidebarLinks = document.querySelectorAll(
      '#sidebar-container [data-route], #sidebarRoot [data-route], #sidebarWrapper [data-route], .sidebar-wrapper [data-route]'
    );

    sidebarLinks.forEach(link => {
      const isActive = link.dataset.route === hashPath;
      link.classList.toggle('active', isActive);

      if (isActive) {
        const submenu = link.closest('.submenu');
        if (submenu) {
          submenu.classList.add('open');
          let parent = submenu.previousElementSibling;
          while (parent && !parent.classList.contains('nav-link')) {
            parent = parent.previousElementSibling;
          }
          const parentTarget = submenu.id.replace('submenu-', '');
          if (parent && parent.dataset.target === parentTarget) {
            parent.classList.add('active');
          }
        }
      }
    });

    // Bottom Nav
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
            <span class="visually-hidden">Memuat halaman…</span>
          </div>
          <p class="mt-3 text-muted small mb-0">Memuat halaman…</p>
        </div>
      </div>
    `;
  }

  /* ============================================================
     ERROR UI — v27.2.2 dengan Retry Info
     ============================================================ */
  _renderNotFound(hashPath) {
    const safeHash = this._escapeHtml(hashPath);

    this.container.innerHTML = `
      <div class="d-flex justify-content-center align-items-center p-4" style="min-height:60vh;">
        <div class="text-center" style="max-width:520px;">
          <i class="bi bi-signpost-split-fill text-warning" style="font-size:4rem;"></i>
          <h4 class="fw-bold mt-3">Halaman Tidak Ditemukan</h4>
          <p class="text-muted small mb-3">
            Route <code>${safeHash}</code> tidak terdaftar pada sistem.
          </p>
          <button class="btn btn-primary rounded-pill px-4" data-router-action="home" type="button">
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
            <button class="btn btn-primary rounded-pill px-4" data-router-action="retry" type="button">
              <i class="bi bi-arrow-clockwise me-1"></i> Coba Lagi
            </button>
            <button class="btn btn-warning rounded-pill px-4" data-router-action="clearcache" type="button">
              <i class="bi bi-trash me-1"></i> Clear Cache & Retry
            </button>
            <button class="btn btn-outline-secondary rounded-pill px-4" data-router-action="home" type="button">
              <i class="bi bi-house-door me-1"></i> Ke Dashboard
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.querySelectorAll('[data-router-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.routerAction;
        if (action === 'retry') {
          this.reload();
        } else if (action === 'home') {
          this.navigate(this.options.defaultRoute);
        } else if (action === 'clearcache') {
          // Clear fragment cache & failed registry
          this.fragmentCache.clear();
          this.failedRoutes.clear();
          if (window.__pkdFailedModules) window.__pkdFailedModules.clear();
          await this.reload();
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
        top: 0, left: 0,
        behavior: mode === 'smooth' ? 'smooth' : 'auto',
      });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  }

  /* ============================================================
     PREFETCH ROUTES
     ============================================================ */
  _preloadRoutes() {
    const entries = Object.entries(this.routes);
    entries.forEach(([routeKey, r]) => {
      if (!r || !r.html) return;
      if (this.fragmentCache.has(r.html)) return;
      if (this.failedRoutes.has(r.html)) return;

      fetch(r.html, { cache: 'force-cache' })
        .then(res => res.ok ? res.text() : null)
        .then(html => {
          if (html && html.trim()) {
            this.fragmentCache.set(r.html, html);
          }
        })
        .catch(() => { /* silent */ });
    });
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

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Router v27.2.2 — Robust Module Load Edition ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
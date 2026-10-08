// ============================================================
// js/core/view-helpers.js — v27.1.0 SUBSCRIPTION EDITION
// ============================================================
// Shared view helpers untuk 18 admin views.
// Zero dependency kecuali bootstrap (untuk getModal).
// ============================================================
// CHANGELOG v27.1.0 (dari v27.0.0):
//   ✅ NEW: createViewContext() — auto-subscribe ke AdminModule
//     → options.watchTypes: ['all', 'peserta', ...]
//     → options.onDataChange: (type, state) => {}
//     → cleanup() otomatis unsubscribe
//   ✅ NEW: createViewContext() — onRefreshButton helper
//     → auto bind tombol refresh ke window.__pkd.forceSync()
//   ✅ NEW: setCacheStatus() helper — konsisten semua view
//   ✅ NEW: escapeHtmlLocal() — alias konsisten
//   ✅ NEW: computeListHash() — sentralisasi (hilangkan duplikasi)
//   ✅ NEW: safeFocus() — null-safe focus
//   ✅ NEW: renderPagination() — unified pagination
//   ✅ FIX: createViewContext() cleanup lebih robust
//   ✅ FIX: setBtnLoading() restore previous disabled state
//   ✅ FIX: debounce() type-safe + preserve this context
//   ✅ FIX: throttle() trailing edge handled
//   ✅ FIX: waitFor() reject on invalid predicate
//   ✅ FIX: ensureChartJS() singleton + retry-safe
//   ✅ FIX: sortBy() handles null/undefined
//   ✅ FIX: paginate() safe with size=0
//   ✅ KEEP: All v27.0.0 helpers (backward compatible)
// ============================================================

export const POLL_INTERVAL_30S  = 30000;
export const POLL_INTERVAL_45S  = 45000;
export const POLL_INTERVAL_60S  = 60000;
export const POLL_INTERVAL_90S  = 90000;
export const POLL_INTERVAL_120S = 120000;
export const SEARCH_DEBOUNCE    = 200;

// ============================================================
//   ESCAPE HTML (local alias — hindari circular import)
// ============================================================
export function escapeHtmlLocal(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ============================================================
//   ⚡ NEW: COMPUTE LIST HASH (sentralisasi)
// ============================================================
/**
 * Hitung hash ringan untuk deteksi perubahan list.
 * Jauh lebih murah dari JSON.stringify(list) untuk list besar.
 *
 * @param {Array} list - Array data
 * @param {string[]} fields - Field yang dicek (default: ['id', 'timestamp'])
 * @returns {string} Hash string
 */
export function computeListHash(list, fields = ['id', 'timestamp']) {
  if (!Array.isArray(list) || list.length === 0) return '0';
  const first = list[0] || {};
  const last = list[list.length - 1] || {};
  const parts = [String(list.length)];
  fields.forEach(f => {
    parts.push(String(first[f] ?? ''));
    parts.push(String(last[f] ?? ''));
  });
  return parts.join('|');
}

// ============================================================
//   ⚡ NEW: SET CACHE STATUS (konsisten semua view)
// ============================================================
/**
 * Update badge cache status di view.
 * @param {string} status - 'Live' | 'Cache' | 'Memuat...' | 'Error' | 'Offline'
 * @param {string} elementId - ID elemen (default: 'cacheStatus')
 */
export function setCacheStatus(status, elementId = 'cacheStatus') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

// ============================================================
//   ⚡ NEW: SAFE FOCUS
// ============================================================
export function safeFocus(id) {
  try {
    const el = document.getElementById(id);
    if (el && typeof el.focus === 'function') el.focus();
  } catch (e) { /* silent */ }
}

// ============================================================
//   DOM HELPERS
// ============================================================
export function getEl(id) {
  return document.getElementById(id);
}

export function getEls(selector, root) {
  try {
    return Array.from((root || document).querySelectorAll(selector));
  } catch (e) { return []; }
}

export function setText(id, value) {
  const el = getEl(id);
  if (el) el.textContent = value;
}

export function setHtml(id, html) {
  const el = getEl(id);
  if (el) el.innerHTML = html;
}

export function showEl(id, display) {
  const el = getEl(id);
  if (el) el.style.display = display || 'block';
}

export function hideEl(id) {
  const el = getEl(id);
  if (el) el.style.display = 'none';
}

export function toggleClass(el, cls, force) {
  if (!el || !el.classList) return;
  if (force === undefined) el.classList.toggle(cls);
  else el.classList.toggle(cls, force);
}

// ============================================================
//   ASYNC HELPERS
// ============================================================
export function debounce(fn, delay = SEARCH_DEBOUNCE) {
  if (typeof fn !== 'function') {
    console.warn('[debounce] Invalid fn, return no-op');
    return () => {};
  }

  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  const wrapped = function (...args) {
    lastArgs = args;
    lastThis = this;

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try { fn.apply(lastThis, lastArgs); }
      catch (e) { console.warn('[debounce]', e); }
    }, delay);
  };

  wrapped.cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    lastArgs = null;
    lastThis = null;
  };

  wrapped.flush = function () {
    if (timer) { clearTimeout(timer); timer = null; }
    if (lastArgs) {
      try { fn.apply(lastThis, lastArgs); }
      catch (e) { console.warn('[debounce.flush]', e); }
      lastArgs = null;
      lastThis = null;
    }
  };

  return wrapped;
}

export function throttle(fn, limit = 100) {
  if (typeof fn !== 'function') return () => {};

  let lastCall = 0;
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  return function (...args) {
    const now = Date.now();
    const ctx = this;
    lastArgs = args;
    lastThis = ctx;

    const remaining = limit - (now - lastCall);

    if (remaining <= 0) {
      lastCall = now;
      try { fn.apply(ctx, args); }
      catch (e) { console.warn('[throttle]', e); }
      lastArgs = null;
      lastThis = null;
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        if (lastArgs) {
          try { fn.apply(lastThis, lastArgs); }
          catch (e) { console.warn('[throttle]', e); }
          lastArgs = null;
          lastThis = null;
        }
      }, remaining);
    }
  };
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function runWhenIdle(fn, timeout = 2000) {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(fn, { timeout });
  } else {
    setTimeout(fn, 1);
  }
}

export function waitFor(predicate, timeoutMs = 5000, intervalMs = 100) {
  return new Promise((resolve) => {
    if (typeof predicate !== 'function') {
      console.warn('[waitFor] Invalid predicate, resolve false');
      return resolve(false);
    }

    const start = Date.now();
    const check = () => {
      let ok = false;
      try { ok = !!predicate(); } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      setTimeout(check, intervalMs);
    };
    check();
  });
}

// ============================================================
//   UI HELPERS
// ============================================================
export function setBtnLoading(btn, loading, text) {
  if (!btn) return () => {};

  const original = {
    html: btn.innerHTML,
    disabled: btn.disabled,
    cls: btn.className,
  };

  if (loading) {
    btn.disabled = true;
    btn.classList.add('is-loading');
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>${text || 'Memuat...'}`;
  }

  return () => {
    btn.disabled = original.disabled;
    btn.className = original.cls;
    btn.innerHTML = original.html;
  };
}

export function safeHideModal(instance) {
  if (!instance) return;
  try { instance.hide(); } catch (e) { /* silent */ }
}

export function safeDisposeModal(instance) {
  if (!instance) return;
  try { instance.dispose(); } catch (e) { /* silent */ }
}

export function cleanupBootstrapArtifacts() {
  try {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } catch (e) { /* silent */ }
}

export function confirmAsync(message) {
  return new Promise((resolve) => {
    try { resolve(window.confirm(message)); }
    catch (e) { resolve(false); }
  });
}

// ============================================================
//   FOCUS PRESERVATION
// ============================================================
export function captureFocusState(inputId) {
  const input = getEl(inputId);
  const isFocused = !!(input && document.activeElement === input);

  return {
    isFocused,
    cursorPos: isFocused ? (input.selectionStart || 0) : 0,
  };
}

export function restoreFocusState(inputId, saved) {
  if (!saved || !saved.isFocused) return;
  const input = getEl(inputId);
  if (!input) return;

  try {
    input.focus({ preventScroll: true });
    const pos = Math.min(saved.cursorPos || 0, input.value.length);
    input.setSelectionRange(pos, pos);
  } catch (e) { /* silent */ }
}

// ============================================================
//   ⚡ NEW: VIEW CONTEXT dengan SUBSCRIPTION
// ============================================================
/**
 * Create a view context dengan listener registry, modal cache,
 * guards, dan OPTIONAL auto-subscribe ke AdminModule.
 *
 * @param {Object} initialState - State awal view
 * @param {Object} options
 * @param {string[]} options.watchTypes - Tipe data yang di-watch (default: ['all'])
 * @param {Function} options.onDataChange - (type, state) => {} dipanggil saat data berubah
 * @param {boolean} options.autoSubscribe - Auto subscribe saat mount (default: false)
 * @returns {Object} View context
 */
export function createViewContext(initialState = {}, options = {}) {
  const listeners = [];
  const modals = {};
  const disposers = [];

  let mounted = false;
  let refreshing = false;
  let saving = false;

  // ⚡ Subscription state
  let dataUnsubscribe = null;
  const watchTypes = Array.isArray(options.watchTypes) ? options.watchTypes : ['all'];
  const onDataChange = typeof options.onDataChange === 'function' ? options.onDataChange : null;

  const ctx = {
    state: { ...initialState },

    get mounted() { return mounted; },
    set mounted(v) { mounted = !!v; },

    get refreshing() { return refreshing; },
    set refreshing(v) { refreshing = !!v; },

    get saving() { return saving; },
    set saving(v) { saving = !!v; },

    // ============ LISTENER REGISTRY ============
    on(el, ev, handler, opts) {
      if (!el || typeof el.addEventListener !== 'function') return null;
      el.addEventListener(ev, handler, opts);
      listeners.push({ el, ev, handler, opts });
      return handler;
    },

    // ============ DISPOSER REGISTRY (custom cleanup) ============
    addDisposer(fn) {
      if (typeof fn === 'function') disposers.push(fn);
    },

    // ============ MODAL CACHE ============
    getModal(id) {
      const el = getEl(id);
      if (!el) return null;

      if (!modals[id]) {
        if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
          console.warn('[ViewCtx] bootstrap.Modal tidak tersedia');
          return null;
        }
        try { modals[id] = new bootstrap.Modal(el); }
        catch (e) {
          console.warn('[ViewCtx] Gagal init modal:', id, e);
          return null;
        }
      }
      return modals[id];
    },

    // ============ ⚡ NEW: SUBSCRIBE TO DATA ============
    /**
     * Subscribe ke perubahan data AdminModule.
     * Otomatis di-unsubscribe saat cleanup().
     */
    async subscribeToData() {
      if (dataUnsubscribe) return; // Already subscribed

      try {
        const mod = await import('../modules/admin.js');
        const subscribeFn = mod.subscribe || (mod.AdminModule && mod.AdminModule.subscribe);

        if (typeof subscribeFn !== 'function') {
          console.warn('[ViewCtx] subscribe() tidak tersedia di admin.js');
          return;
        }

        dataUnsubscribe = subscribeFn((type, state) => {
          if (!mounted) return;
          const shouldTrigger =
            watchTypes.includes('all') ||
            watchTypes.includes(type) ||
            type === 'multiple' ||
            type === 'cleared';

          if (!shouldTrigger) return;

          try {
            onDataChange?.(type, state);
          } catch (e) {
            console.warn('[ViewCtx] onDataChange error:', e);
          }
        });
      } catch (e) {
        console.warn('[ViewCtx] subscribeToData failed:', e);
      }
    },

    // ============ ⚡ NEW: BIND REFRESH BUTTON ============
    /**
     * Auto-bind tombol refresh ke force sync global.
     * @param {string} buttonId - ID tombol (default: 'refreshDataBtn')
     * @param {string} successMsg - Pesan sukses (opsional)
     */
    bindRefreshButton(buttonId = 'refreshDataBtn', successMsg = 'Data disegarkan') {
      const btn = getEl(buttonId);
      if (!btn) return;

      const handler = async (e) => {
        if (saving) return;
        saving = true;
        const restore = setBtnLoading(btn, true, 'Memuat...');

        try {
          // ⚡ Use global force sync
          if (window.__pkd && typeof window.__pkd.forceSync === 'function') {
            await window.__pkd.forceSync();
          } else {
            // Fallback: load via AdminModule
            const mod = await import('../modules/admin.js');
            const AdminMod = mod.AdminModule || mod.default;
            if (AdminMod && typeof AdminMod.loadAllData === 'function') {
              await AdminMod.loadAllData(true);
            }
          }

          // Manual trigger onDataChange
          try { onDataChange?.('manual-refresh', null); }
          catch (err) { /* silent */ }

          if (successMsg) {
            // Dynamic import untuk hindari circular
            import('./api.js').then(({ showToast }) => {
              try { showToast(successMsg, 'success'); } catch (e) { /* silent */ }
            }).catch(() => {});
          }
        } catch (err) {
          console.warn('[ViewCtx] Refresh error:', err);
          import('./api.js').then(({ showToast }) => {
            try { showToast('Gagal menyegarkan: ' + err.message, 'error'); } catch (e) { /* silent */ }
          }).catch(() => {});
        } finally {
          restore();
          saving = false;
        }
      };

      ctx.on(btn, 'click', handler);
    },

    // ============ CLEANUP ============
    cleanup() {
      // 1. Remove all DOM listeners
      listeners.forEach(({ el, ev, handler, opts }) => {
        try { el.removeEventListener(ev, handler, opts); }
        catch (e) { /* silent */ }
      });
      listeners.length = 0;

      // 2. Dispose all modals
      Object.values(modals).forEach(m => {
        try { m?.dispose?.(); } catch (e) { /* silent */ }
      });
      Object.keys(modals).forEach(k => delete modals[k]);

      // 3. Run custom disposers
      disposers.forEach(fn => {
        try { fn(); } catch (e) { /* silent */ }
      });
      disposers.length = 0;

      // 4. ⚡ Unsubscribe dari data changes
      if (dataUnsubscribe) {
        try { dataUnsubscribe(); } catch (e) { /* silent */ }
        dataUnsubscribe = null;
      }
    },
  };

  return ctx;
}

// ============================================================
//   TABLE DELEGATION
// ============================================================
export function delegateTableClicks(container, handlers) {
  if (!container) return null;
  if (container.dataset.delegated === '1') return null;
  container.dataset.delegated = '1';

  const listener = (e) => {
    // 1. Sort
    const sortEl = e.target.closest('[data-sort]');
    if (sortEl && handlers.onSort) {
      e.preventDefault();
      handlers.onSort(sortEl.dataset.sort);
      return;
    }

    // 2. Action
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;

      if (action === 'goto' && handlers.onPage) {
        e.preventDefault();
        const page = parseInt(actionEl.dataset.page, 10);
        if (!isNaN(page)) handlers.onPage(page);
        return;
      }

      if (handlers.onAction) {
        handlers.onAction(action, actionEl.dataset.id, actionEl);
      }
      return;
    }

    // 3. Pagination-only button
    const pageEl = e.target.closest('[data-page]');
    if (pageEl && handlers.onPage) {
      e.preventDefault();
      const page = parseInt(pageEl.dataset.page, 10);
      if (!isNaN(page)) handlers.onPage(page);
    }
  };

  container.addEventListener('click', listener);

  return () => {
    container.removeEventListener('click', listener);
    delete container.dataset.delegated;
  };
}

// ============================================================
//   SORT + PAGINATE
// ============================================================
export function sortBy(list, column, direction = 'asc', type = 'string') {
  if (!Array.isArray(list) || !column) return list;

  const dir = direction === 'asc' ? 1 : -1;

  list.sort((a, b) => {
    let va = a[column];
    let vb = b[column];

    if (type === 'date') {
      va = new Date(va || 0).getTime() || 0;
      vb = new Date(vb || 0).getTime() || 0;
    } else if (type === 'number') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else if (type === 'boolean') {
      va = va ? 1 : 0;
      vb = vb ? 1 : 0;
    } else {
      va = String(va ?? '').toLowerCase();
      vb = String(vb ?? '').toLowerCase();
    }

    if (va < vb) return -1 * dir;
    if (va > vb) return  1 * dir;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  return list;
}

export function paginate(list, page, size) {
  const safeList = Array.isArray(list) ? list : [];
  const total = safeList.length;
  const safeSize = Math.max(1, Number(size) || 15);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * safeSize;
  const end = Math.min(start + safeSize, total);

  return {
    items: safeList.slice(start, end),
    page: safePage,
    totalPages,
    total,
    start,
    end,
  };
}

// ============================================================
//   PAGINATION HELPER
// ============================================================
export function renderPagination(opts) {
  const {
    currentPage = 1,
    totalPages = 1,
    totalItems = 0,
    itemsPerPage = 15,
    pageDataLength = 0,
    dataAction = 'goto',
    dataPageAttr = 'page',
    maxButtons = 7,
  } = opts || {};

  const start = (currentPage - 1) * itemsPerPage;
  const end = Math.min(start + itemsPerPage, totalItems);

  let html = `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">
      Menampilkan ${pageDataLength > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data
    </div>
    <div class="btn-group">`;

  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  const btn = (page, label, disabled = false, active = false) => {
    if (disabled) {
      return `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>${label}</button>`;
    }
    return `<button type="button" class="btn btn-sm ${active ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="${dataAction}" ${dataPageAttr}="${page}">${label}</button>`;
  };

  if (startPage > 1) {
    html += btn(1, '1', false, false);
    if (startPage > 2) {
      html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    html += btn(i, String(i), false, i === currentPage);
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    }
    html += btn(totalPages, String(totalPages), false, false);
  }

  html += `</div></div>`;
  return html;
}

// ============================================================
//   LAZY LOAD: Chart.js
// ============================================================
let _chartJSPromise = null;

export function ensureChartJS() {
  if (typeof window.Chart !== 'undefined') {
    return Promise.resolve(window.Chart);
  }

  if (_chartJSPromise) return _chartJSPromise;

  _chartJSPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    s.async = true;

    s.onload = () => {
      if (typeof window.Chart === 'undefined') {
        _chartJSPromise = null;
        return reject(new Error('Chart.js loaded tapi Chart global tidak tersedia'));
      }
      resolve(window.Chart);
    };

    s.onerror = () => {
      _chartJSPromise = null;
      reject(new Error('Gagal load Chart.js'));
    };

    document.head.appendChild(s);
  });

  return _chartJSPromise;
}

// ============================================================
//   RESPONSE NORMALIZER
// ============================================================
export function normalizeResult(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  return [];
}

export function normalizeObject(res, fallback = null) {
  if (res === null || res === undefined) return fallback;
  if (Array.isArray(res)) return res[0] || fallback;
  if (typeof res === 'object') {
    if (res.success === false) return fallback;
    if (res.data !== undefined) return res.data;
    return res;
  }
  return fallback;
}

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c View Helpers v27.1.0 — Subscription Edition ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
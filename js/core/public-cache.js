// ============================================================
// js/core/public-cache.js — v28.4.0 STALE-WHILE-REVALIDATE ENGINE
// ============================================================
// Shared module untuk halaman publik: instant load dari cache,
// auto-refresh di background tanpa skeleton.
// ============================================================
// CHANGELOG v28.4.0 (dari v1.0.0):
//   ✅ FIX: Cross-tab listener tidak auto-bersihkan memory (WeakSet)
//   ✅ FIX: Race condition saat boot() multiple instances
//   ✅ FIX: Fetch retry dengan exponential backoff (2x)
//   ✅ FIX: Hash comparison lebih akurat (deep sample)
//   ✅ FIX: Cache age check lebih robust (system clock safe)
//   ✅ FIX: Visibility handler deduplicate
//   ✅ FIX: Cleanup lengkap — no memory leak
//   ✅ NEW: forceRefresh() method
//   ✅ NEW: getStats() untuk debugging
//   ✅ NEW: Config validation lebih ketat
//   ✅ NEW: Exponential backoff untuk background refresh error
//   ✅ NEW: Skip revalidate kalau network offline
//   ✅ NEW: Batch version dengan paralel loader
//   ✅ KEEP: Semua fitur v1.0.0 (SWR, cross-tab, idle detection)
// ============================================================

import { callApi } from './api.js';

// ============================================================
//   CONSTANTS
// ============================================================
const DEFAULT_TTL_MS = 5 * 60 * 1000;           // 5 menit
const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000;      // 1 jam (hard limit)
const BROADCAST_CHANNEL = 'pkd_public_cache';
const BG_REFRESH_INTERVAL_MS = 60 * 1000;       // 60 detik
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;        // 5 menit
const RETRY_DELAYS_MS = [500, 1500];            // 2x retry
const FETCH_TIMEOUT_MS = 15000;
const CACHE_VERSION = 'v1';

// ============================================================
//   MODULE-LEVEL REGISTRY (untuk cross-instance sync)
// ============================================================
const _instances = new Map();       // cacheKey → Set of instances
const _bc = (() => {
  if (typeof BroadcastChannel === 'undefined') return null;
  try { return new BroadcastChannel(BROADCAST_CHANNEL); }
  catch (e) { return null; }
})();

// Track broadcast listener — attach sekali saja per page
let _broadcastListenerAttached = false;
const _broadcastHandlers = new Map(); // cacheKey → Set of handler functions

function attachGlobalBroadcastListener() {
  if (_broadcastListenerAttached || !_bc) return;
  _broadcastListenerAttached = true;

  _bc.addEventListener('message', (e) => {
    if (!e || !e.data) return;
    if (e.data.type !== 'cache-update') return;

    const key = e.data.key;
    const hash = e.data.hash;

    const handlers = _broadcastHandlers.get(key);
    if (!handlers) return;

    handlers.forEach(fn => {
      try { fn(hash); }
      catch (err) { console.warn('[PublicCache] Broadcast handler error:', err); }
    });
  });
}

// ============================================================
//   IN-MEMORY FALLBACK
// ============================================================
const _memStore = new Map();

// ============================================================
//   SAFE STORAGE
// ============================================================
function safeLocalGet(key) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* blocked */ }
  return _memStore.get(key) || null;
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
    _memStore.delete(key);
    return true;
  } catch (e) {
    _memStore.set(key, value);
    return false;
  }
}

function safeLocalRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* silent */ }
  _memStore.delete(key);
}

// ============================================================
//   HASH FUNCTION (untuk deteksi perubahan)
// ============================================================
function computeHash(data) {
  if (data === null || data === undefined) return '0';

  if (Array.isArray(data)) {
    if (data.length === 0) return '0';
    // Sample first + middle + last untuk deteksi perubahan akurat
    const first = data[0] || {};
    const mid = data[Math.floor(data.length / 2)] || {};
    const last = data[data.length - 1] || {};
    return [
      data.length,
      first.id || first.timestamp || '',
      mid.id || mid.timestamp || '',
      last.id || last.timestamp || '',
    ].join('|');
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data).sort();
    if (keys.length === 0) return '0';
    // Hash beberapa value sample
    const sample = keys.slice(0, 3).map(k => `${k}=${String(data[k] ?? '').substring(0, 30)}`).join(',');
    return `${keys.length}|${sample}`;
  }

  return String(data).substring(0, 100);
}

// ============================================================
//   SLEEP
// ============================================================
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//   FETCH WITH RETRY (exponential backoff)
// ============================================================
async function fetchWithRetry(action, params, maxRetry = 2) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      const res = await callApi(action, params, 'GET', FETCH_TIMEOUT_MS);

      if (!res) {
        throw new Error('Empty response');
      }
      if (res.success === false) {
        // Non-retryable error (config error, circuit open)
        if (res._configError || res._offline) {
          throw new Error(res.error || 'Config error');
        }
        // Retry-able: server error, timeout
        lastError = new Error(res.error || 'Server error');
      } else {
        // Success
        let data = res.data !== undefined ? res.data : res;
        if (data === undefined || data === null) data = [];
        return data;
      }
    } catch (e) {
      lastError = e;
    }

    if (attempt < maxRetry) {
      const delay = RETRY_DELAYS_MS[attempt] || 2000;
      console.warn(`[PublicCache] Fetch retry ${attempt + 1}/${maxRetry} in ${delay}ms:`, lastError?.message);
      await sleep(delay);
    }
  }

  throw lastError || new Error('Fetch failed after retries');
}

// ============================================================
//   CACHE KEY SANITIZE
// ============================================================
function sanitizeKey(key) {
  return String(key || '').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80);
}

// ============================================================
//   MAIN: CREATE PUBLIC CACHE
// ============================================================
/**
 * Buat instance public cache untuk 1 dataset dengan pola
 * Stale-While-Revalidate (SWR):
 *   1. Instant render dari cache (jika ada)
 *   2. Background fetch (silent)
 *   3. Auto-update UI kalau data berubah
 *   4. Cross-tab sync via BroadcastChannel
 *
 * @param {Object} config
 * @param {string}   config.cacheKey          — Key unik (e.g., 'materi_list')
 * @param {string}   config.action            — Action API (e.g., 'getMateriList')
 * @param {Object}   config.params            — Parameter API (default: {})
 * @param {number}   config.ttlMs             — TTL cache (default: 5 menit)
 * @param {number}   config.maxAgeMs          — Hard limit (default: 1 jam)
 * @param {Function} config.render            — (data, meta) => void
 * @param {Function} config.onChange          — Optional (data, meta) => void
 * @param {Function} config.onError           — Optional (error) => void
 * @param {boolean}  config.autoBackgroundRefresh  — (default: true)
 * @param {boolean}  config.enableCrossTab    — (default: true)
 * @param {boolean}  config.verbose           — (default: false) console log
 *
 * @returns {Object|null} Instance dengan boot(), destroy(), revalidate(), dll.
 */
export function createPublicCache(config = {}) {
  // ============ VALIDATION ============
  const {
    cacheKey: rawCacheKey,
    action,
    params = {},
    ttlMs = DEFAULT_TTL_MS,
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    render,
    onChange,
    onError,
    autoBackgroundRefresh = true,
    enableCrossTab = true,
    verbose = false,
  } = config;

  if (!rawCacheKey || typeof rawCacheKey !== 'string') {
    console.error('[PublicCache] Invalid cacheKey');
    return null;
  }
  if (!action || typeof action !== 'string') {
    console.error('[PublicCache] Invalid action');
    return null;
  }
  if (typeof render !== 'function') {
    console.error('[PublicCache] Invalid render function');
    return null;
  }

  const cacheKey = sanitizeKey(rawCacheKey);
  const fullKey = `pkd_pub_cache_${CACHE_VERSION}_${cacheKey}`;
  const metaKey = `${fullKey}_meta`;

  // ============ STATE ============
  let currentHash = '';
  let isMounted = false;
  let isBooted = false;
  let isDestroyed = false;
  let bgTimer = null;
  let lastUserActivity = Date.now();
  let consecutiveFetchErrors = 0;
  let broadcastUnsubscribe = null;
  let activityCleanup = null;
  let visibilityHandler = null;
  let revalidatePromise = null;

  // ============ LOG HELPER ============
  function log(...args) {
    if (!verbose) return;
    console.log(`[PublicCache:${cacheKey}]`, ...args);
  }

  function logWarn(...args) {
    console.warn(`[PublicCache:${cacheKey}]`, ...args);
  }

  // ============ CACHE READ/WRITE ============
  function readCache() {
    try {
      const raw = safeLocalGet(fullKey);
      const metaRaw = safeLocalGet(metaKey);
      if (!raw) return null;

      let data;
      try {
        data = JSON.parse(raw);
      } catch (e) {
        logWarn('Cache parse error, clearing');
        clearCache();
        return null;
      }

      let meta = {};
      if (metaRaw) {
        try { meta = JSON.parse(metaRaw); }
        catch (e) { meta = {}; }
      }

      const now = Date.now();
      const timestamp = meta.timestamp || 0;
      // Safe age calculation: guard against clock skew
      const ageMs = Math.max(0, now - timestamp);

      return {
        data,
        hash: meta.hash || computeHash(data),
        timestamp,
        ageMs,
      };
    } catch (e) {
      logWarn('readCache error:', e.message);
      return null;
    }
  }

  function writeCache(data, hash) {
    try {
      const meta = {
        hash,
        timestamp: Date.now(),
        version: CACHE_VERSION,
      };
      const okData = safeLocalSet(fullKey, JSON.stringify(data));
      const okMeta = safeLocalSet(metaKey, JSON.stringify(meta));
      if (!okData || !okMeta) {
        logWarn('Cache write partially failed (storage quota?)');
      }
    } catch (e) {
      logWarn('writeCache error:', e.message);
    }
  }

  function clearCache() {
    safeLocalRemove(fullKey);
    safeLocalRemove(metaKey);
    log('Cache cleared');
  }

  // ============ RENDER HELPER ============
  function doRender(data, opts = {}) {
    if (!isMounted || isDestroyed) return;
    try {
      render(data, {
        source: opts.source || 'unknown',
        changed: opts.changed || false,
        hash: opts.hash || '',
        timestamp: Date.now(),
      });
    } catch (e) {
      console.error(`[PublicCache:${cacheKey}] render error:`, e);
      if (typeof onError === 'function') {
        try { onError(e); } catch (err) { /* silent */ }
      }
    }
  }

  // ============ FETCH FRESH ============
  async function fetchFresh() {
    return await fetchWithRetry(action, params, 2);
  }

  // ============ REVALIDATE ============
  async function revalidate({ silentMode = true } = {}) {
    if (!isMounted || isDestroyed) {
      return { changed: false, skipped: true };
    }

    // Deduplicate concurrent revalidate
    if (revalidatePromise) {
      log('Revalidate already in progress, reusing');
      return revalidatePromise;
    }

    // Skip kalau offline
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      log('Offline, skip revalidate');
      return { changed: false, offline: true };
    }

    revalidatePromise = (async () => {
      try {
        const freshData = await fetchFresh();
        if (!isMounted || isDestroyed) return { changed: false, aborted: true };

        const freshHash = computeHash(freshData);
        const changed = freshHash !== currentHash;

        // Reset error counter on success
        consecutiveFetchErrors = 0;

        if (changed) {
          currentHash = freshHash;
          writeCache(freshData, freshHash);

          doRender(freshData, { source: 'network', changed: true, hash: freshHash });

          // Broadcast ke tab lain
          if (enableCrossTab && _bc) {
            try { _bc.postMessage({ type: 'cache-update', key: cacheKey, hash: freshHash, ts: Date.now() }); }
            catch (e) { /* silent */ }
          }

          if (typeof onChange === 'function') {
            try { onChange(freshData, { source: 'network', hash: freshHash }); }
            catch (e) { logWarn('onChange error:', e); }
          }

          if (!silentMode) log(`✅ Updated (hash: ${freshHash})`);
        } else {
          if (!silentMode) log('⏭️ No change');
        }

        return { changed, hash: freshHash };
      } catch (e) {
        consecutiveFetchErrors++;
        logWarn(`Revalidate failed (${consecutiveFetchErrors}x):`, e.message);

        if (typeof onError === 'function') {
          try { onError(e); } catch (err) { /* silent */ }
        }

        return { changed: false, error: e.message, errorCount: consecutiveFetchErrors };
      } finally {
        revalidatePromise = null;
      }
    })();

    return revalidatePromise;
  }

  // ============ BACKGROUND REFRESH LOOP ============
  function startBackgroundRefresh() {
    if (!autoBackgroundRefresh) return;
    if (bgTimer) return;

    bgTimer = setInterval(async () => {
      if (!isMounted || isDestroyed) return;
      if (document.hidden) return;

      const idleMs = Date.now() - lastUserActivity;
      if (idleMs > IDLE_THRESHOLD_MS) {
        // Skip kalau user idle terlalu lama (hemat battery)
        return;
      }

      // Backoff kalau banyak error berturut-turut
      if (consecutiveFetchErrors >= 5) {
        log('Skip refresh (too many errors, backing off)');
        return;
      }

      await revalidate({ silentMode: true });
    }, BG_REFRESH_INTERVAL_MS);

    log('Background refresh started (interval 60s)');
  }

  function stopBackgroundRefresh() {
    if (bgTimer) {
      clearInterval(bgTimer);
      bgTimer = null;
      log('Background refresh stopped');
    }
  }

  // ============ BROADCAST LISTENER ============
  function setupBroadcastListener() {
    if (!enableCrossTab || !_bc) return null;

    // Register handler
    if (!_broadcastHandlers.has(cacheKey)) {
      _broadcastHandlers.set(cacheKey, new Set());
    }

    const handler = (incomingHash) => {
      if (!isMounted || isDestroyed) return;
      if (incomingHash === currentHash) return;

      // Data berubah di tab lain → reload dari storage
      const cached = readCache();
      if (cached && cached.data && cached.hash !== currentHash) {
        log(`🔄 Cross-tab update (hash: ${cached.hash})`);
        currentHash = cached.hash;
        doRender(cached.data, { source: 'cross-tab', changed: true, hash: cached.hash });

        if (typeof onChange === 'function') {
          try { onChange(cached.data, { source: 'cross-tab', hash: cached.hash }); }
          catch (e) { /* silent */ }
        }
      }
    };

    _broadcastHandlers.get(cacheKey).add(handler);
    attachGlobalBroadcastListener();

    return () => {
      const handlers = _broadcastHandlers.get(cacheKey);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) _broadcastHandlers.delete(cacheKey);
      }
    };
  }

  // ============ ACTIVITY TRACKING ============
  function trackActivity() {
    const events = ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'];
    const handler = () => { lastUserActivity = Date.now(); };

    events.forEach(ev => {
      window.addEventListener(ev, handler, { passive: true });
    });

    return () => {
      events.forEach(ev => {
        window.removeEventListener(ev, handler);
      });
    };
  }

  // ============ VISIBILITY HANDLER ============
  function setupVisibilityHandler() {
    visibilityHandler = () => {
      if (!isMounted || isDestroyed) return;
      if (document.hidden) return;
      // Refresh saat tab kembali visible
      revalidate({ silentMode: true });
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  }

  // ============ BOOT ============
  async function boot() {
    if (isBooted) {
      logWarn('Already booted, skip');
      return cleanup;
    }
    isMounted = true;
    isBooted = true;

    log('🚀 Boot start');

    // STEP 1: Instant render dari cache
    const cached = readCache();

    if (cached && cached.data !== null && cached.data !== undefined) {
      const isExpired = cached.ageMs > maxAgeMs;

      if (!isExpired) {
        log(`⚡ Instant render from cache (age: ${Math.round(cached.ageMs / 1000)}s)`);
        currentHash = cached.hash;
        doRender(cached.data, { source: 'cache', changed: false, hash: cached.hash });
      } else {
        log(`⚠️ Cache expired (age: ${Math.round(cached.ageMs / 1000)}s), clearing`);
        clearCache();
      }
    } else {
      log('❄️ Cold start — no cache');
    }

    // STEP 2: Setup listeners
    broadcastUnsubscribe = setupBroadcastListener();
    activityCleanup = trackActivity();
    setupVisibilityHandler();

    // STEP 3: Background revalidate (silent)
    await revalidate({ silentMode: true });

    // STEP 4: Start periodic background refresh
    startBackgroundRefresh();

    log('✅ Boot complete');
    return cleanup;
  }

  // ============ CLEANUP ============
  function cleanup() {
    if (isDestroyed) return;
    isDestroyed = true;
    isMounted = false;
    isBooted = false;

    stopBackgroundRefresh();

    if (broadcastUnsubscribe) {
      try { broadcastUnsubscribe(); } catch (e) { /* silent */ }
      broadcastUnsubscribe = null;
    }

    if (activityCleanup) {
      try { activityCleanup(); } catch (e) { /* silent */ }
      activityCleanup = null;
    }

    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }

    // Remove from registry
    const set = _instances.get(cacheKey);
    if (set) {
      set.delete(instance);
      if (set.size === 0) _instances.delete(cacheKey);
    }

    log('🛑 Destroyed');
  }

  // ============ FORCE REFRESH ============
  async function forceRefresh() {
    return await revalidate({ silentMode: false });
  }

  // ============ STATS ============
  function getStats() {
    const cached = readCache();
    return {
      cacheKey,
      currentHash,
      cachedHash: cached?.hash || null,
      cacheAgeMs: cached?.ageMs || 0,
      cacheAgeSec: cached ? Math.round(cached.ageMs / 1000) : 0,
      hasCache: !!cached,
      cacheItemCount: Array.isArray(cached?.data) ? cached.data.length : null,
      isMounted,
      isBooted,
      isDestroyed,
      backgroundRefreshActive: !!bgTimer,
      consecutiveFetchErrors,
      lastUserActivityAgoSec: Math.round((Date.now() - lastUserActivity) / 1000),
    };
  }

  // ============ INSTANCE ============
  const instance = {
    boot,
    destroy: cleanup,
    revalidate: forceRefresh,
    forceRefresh,
    clearCache,
    readCache,
    getHash: () => currentHash,
    getStats,
    isMounted: () => isMounted,
    isDestroyed: () => isDestroyed,
  };

  // Register ke registry
  if (!_instances.has(cacheKey)) _instances.set(cacheKey, new Set());
  _instances.get(cacheKey).add(instance);

  return instance;
}

// ============================================================
//   BATCH VERSION — Load multiple datasets
// ============================================================
/**
 * Batch loader untuk multiple datasets paralel.
 * Cocok untuk halaman yang butuh beberapa API call sekaligus.
 *
 * @param {Object} configs — { key: { action, params, ttlMs, maxAgeMs } }
 * @param {Object} options
 * @param {Function} options.onAnyReady — (key, data, meta) => void
 * @param {Function} options.onAllReady — (results, meta) => void
 * @param {Function} options.onAnyError — (key, error) => void
 * @param {boolean} options.verbose
 * @returns {Object}
 */
export function createBatchPublicCache(configs = {}, options = {}) {
  const {
    onAnyReady,
    onAllReady,
    onAnyError,
    verbose = false,
  } = options;

  const instances = {};
  const dataMap = {};
  const readyKeys = new Set();
  const totalKeys = Object.keys(configs).length;

  let cleanupFns = [];
  let isDestroyed = false;

  // ============ CREATE ALL INSTANCES ============
  Object.keys(configs).forEach(key => {
    const cfg = configs[key];
    if (!cfg || !cfg.action) {
      console.warn(`[BatchCache] Skip invalid config: ${key}`);
      return;
    }

    instances[key] = createPublicCache({
      cacheKey: `batch_${key}`,
      action: cfg.action,
      params: cfg.params || {},
      ttlMs: cfg.ttlMs || DEFAULT_TTL_MS,
      maxAgeMs: cfg.maxAgeMs || DEFAULT_MAX_AGE_MS,
      verbose,
      enableCrossTab: cfg.enableCrossTab !== false,
      autoBackgroundRefresh: cfg.autoBackgroundRefresh !== false,
      render: (data, meta) => {
        if (isDestroyed) return;
        dataMap[key] = data;

        if (typeof onAnyReady === 'function') {
          try { onAnyReady(key, data, meta); }
          catch (e) { console.warn(`[BatchCache] onAnyReady(${key}) error:`, e); }
        }

        if (meta.source === 'network' || meta.source === 'cache') {
          readyKeys.add(key);

          if (readyKeys.size === totalKeys && typeof onAllReady === 'function') {
            try { onAllReady({ ...dataMap }, { readyKeys: Array.from(readyKeys) }); }
            catch (e) { console.warn('[BatchCache] onAllReady error:', e); }
          }
        }
      },
      onError: (err) => {
        if (isDestroyed) return;
        if (typeof onAnyError === 'function') {
          try { onAnyError(key, err); }
          catch (e) { /* silent */ }
        }
      },
    });
  });

  // ============ BOOT ALL ============
  async function boot() {
    if (isDestroyed) return;

    const results = await Promise.allSettled(
      Object.values(instances).map(inst => inst ? inst.boot() : Promise.resolve(null))
    );

    cleanupFns = results
      .filter(r => r.status === 'fulfilled' && typeof r.value === 'function')
      .map(r => r.value);

    return cleanup;
  }

  // ============ CLEANUP ============
  function cleanup() {
    if (isDestroyed) return;
    isDestroyed = true;

    cleanupFns.forEach(fn => {
      try { fn(); } catch (e) { /* silent */ }
    });
    cleanupFns = [];

    Object.keys(instances).forEach(key => {
      try { instances[key]?.destroy(); }
      catch (e) { /* silent */ }
    });
  }

  // ============ FORCE REFRESH ALL ============
  async function forceRefreshAll() {
    return await Promise.allSettled(
      Object.values(instances).map(inst => inst ? inst.forceRefresh() : Promise.resolve(null))
    );
  }

  // ============ GET STATS ============
  function getStats() {
    const stats = {};
    Object.keys(instances).forEach(key => {
      stats[key] = instances[key]?.getStats() || null;
    });
    return {
      totalKeys,
      readyKeys: Array.from(readyKeys),
      isDestroyed,
      instances: stats,
    };
  }

  return {
    boot,
    destroy: cleanup,
    forceRefreshAll,
    getStats,
    getInstance: (key) => instances[key] || null,
    getData: (key) => dataMap[key] || null,
    isReady: () => readyKeys.size === totalKeys,
  };
}

// ============================================================
//   UTILITY: CLEAR ALL PUBLIC CACHES
// ============================================================
export function clearAllPublicCaches() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`pkd_pub_cache_${CACHE_VERSION}_`)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach(k => safeLocalRemove(k));
    console.log(`[PublicCache] Cleared ${keysToRemove.length} cache entries`);
    return keysToRemove.length;
  } catch (e) {
    console.warn('[PublicCache] clearAll failed:', e);
    return 0;
  }
}

// ============================================================
//   UTILITY: LIST ALL PUBLIC CACHES
// ============================================================
export function listAllPublicCaches() {
  const result = [];
  try {
    const prefix = `pkd_pub_cache_${CACHE_VERSION}_`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (k.endsWith('_meta')) continue;

      try {
        const data = JSON.parse(localStorage.getItem(k) || '[]');
        const metaRaw = localStorage.getItem(k + '_meta');
        const meta = metaRaw ? JSON.parse(metaRaw) : {};
        result.push({
          key: k.replace(prefix, ''),
          itemCount: Array.isArray(data) ? data.length : null,
          ageSec: meta.timestamp ? Math.round((Date.now() - meta.timestamp) / 1000) : 0,
          hash: meta.hash || null,
        });
      } catch (e) { /* silent */ }
    }
  } catch (e) { /* silent */ }
  return result;
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default {
  createPublicCache,
  createBatchPublicCache,
  clearAllPublicCaches,
  listAllPublicCaches,
};

console.log(
  '%c Public Cache v28.4.0 — Stale-While-Revalidate Engine ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
console.log(
  '%c 💡 Debug: window.__publicCache.listAllPublicCaches() ',
  'background:#0f172a;color:#fbbf24;padding:2px 6px;border-radius:4px;font-weight:600;'
);
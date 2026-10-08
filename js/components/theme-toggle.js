// ============================================================
// js/components/theme-toggle.js — v26.1.9 GITHUB PAGES /bisaa/
// ============================================================
// CHANGELOG v26.1.9:
//   ✅ FIX: Auto-create <meta name="theme-color"> jika tidak ada
//   ✅ FIX: Set flag global window.__themeToggleMounted untuk cegah
//           double-handle Ctrl+Shift+D (fallback di app.html)
//   ✅ FIX: Listener `keydown` untuk Ctrl+Shift+D di-mount di sini
//           (fallback di app.html hanya jalan kalau flag false)
//   ✅ Guard agar tidak double-bind button via WeakSet
// ============================================================

// ============================================================
//   CONSTANTS
// ============================================================
const STORAGE_KEY = 'pkd_theme';
const THEMES = { LIGHT: 'light', DARK: 'dark' };

// ============================================================
//   MODULE STATE
// ============================================================
let isMounted = false;
let currentTheme = null;
let mediaQueryList = null;
let mutationObserver = null;

const listeners = [];
const boundButtons = new WeakSet();

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
}

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}

function safeStorageRemove(key) {
  try { localStorage.removeItem(key); return true; } catch (e) { return false; }
}

function dispatchEvent(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  } catch (e) { /* silent */ }
}

// ============================================================
//   THEME DETECTION
// ============================================================
function getSystemTheme() {
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return THEMES.DARK;
    }
  } catch (e) { /* silent */ }
  return THEMES.LIGHT;
}

function getSavedTheme() {
  const saved = safeStorageGet(STORAGE_KEY);
  if (saved === THEMES.DARK || saved === THEMES.LIGHT) return saved;
  return null;
}

export function getTheme() {
  return currentTheme || document.documentElement.getAttribute('data-theme') || getSystemTheme();
}

// ============================================================
//   APPLY THEME — v26.1.9 FIX meta theme-color
// ============================================================
export function applyTheme(theme) {
  const next = (theme === THEMES.DARK) ? THEMES.DARK : THEMES.LIGHT;

  try {
    document.documentElement.setAttribute('data-theme', next);
    currentTheme = next;

    // ⚠️ FIX v26.1.9: Auto-create meta theme-color jika belum ada.
    // Sebelumnya kode hanya update kalau `<meta>` sudah ada di DOM.
    // Kalau tidak ada, mobile browser tidak update address bar.
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (!metaThemeColor) {
      metaThemeColor = document.createElement('meta');
      metaThemeColor.name = 'theme-color';
      document.head.appendChild(metaThemeColor);
    }
    metaThemeColor.setAttribute('content', next === THEMES.DARK ? '#0f172a' : '#2563eb');

    dispatchEvent('theme:changed', { theme: next });
  } catch (e) {
    console.warn('[ThemeToggle] applyTheme error:', e);
  }
}

// ============================================================
//   SET / TOGGLE THEME
// ============================================================
export function setTheme(theme, persist = true) {
  const next = (theme === THEMES.DARK) ? THEMES.DARK : THEMES.LIGHT;
  applyTheme(next);

  if (persist) {
    safeStorageSet(STORAGE_KEY, next);
  }

  updateAllButtons();
  return next;
}

export function toggleTheme() {
  const cur = getTheme();
  const next = cur === THEMES.DARK ? THEMES.LIGHT : THEMES.DARK;
  setTheme(next, true);

  dispatchEvent('theme:toggled', { from: cur, to: next });
  return next;
}

export function clearSavedTheme() {
  safeStorageRemove(STORAGE_KEY);
  const sys = getSystemTheme();
  applyTheme(sys);
  updateAllButtons();
  return sys;
}

// ============================================================
//   INIT (auto-detect + apply)
// ============================================================
export function initTheme() {
  const saved = getSavedTheme();
  if (saved) {
    applyTheme(saved);
  } else {
    applyTheme(getSystemTheme());
  }
}

// ============================================================
//   BUTTON BINDING
// ============================================================
function handleButtonClick(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  toggleTheme();
}

function bindButton(btn) {
  if (!btn || boundButtons.has(btn)) return;
  boundButtons.add(btn);

  if (!btn.hasAttribute('aria-label')) {
    btn.setAttribute('aria-label', 'Toggle tema (dark / light)');
  }
  if (!btn.hasAttribute('title')) {
    btn.setAttribute('title', 'Toggle Tema (Dark / Light)');
  }
  btn.setAttribute('role', 'button');
  if (!btn.hasAttribute('tabindex')) {
    btn.setAttribute('tabindex', '0');
  }

  on(btn, 'click', handleButtonClick);

  on(btn, 'keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      handleButtonClick(ev);
    }
  });

  updateButton(btn);
}

function getToggleSelectors() {
  return [
    '#sidebarThemeToggleBtn',
    '[data-theme-toggle]',
    '.theme-toggle-btn',
  ];
}

function scanAndBind() {
  const selectors = getToggleSelectors();
  selectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(bindButton);
    } catch (e) { /* silent */ }
  });
}

// ============================================================
//   UPDATE BUTTON STATE
// ============================================================
function updateButton(btn) {
  if (!btn) return;
  const theme = getTheme();
  btn.setAttribute('data-current-theme', theme);
  btn.setAttribute('aria-pressed', theme === THEMES.DARK ? 'true' : 'false');
}

function updateAllButtons() {
  scanAndBind();
  const selectors = getToggleSelectors();
  selectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(updateButton);
    } catch (e) { /* silent */ }
  });
}

// ============================================================
//   STORAGE SYNC (antar tab)
// ============================================================
function handleStorageSync(e) {
  if (!e || e.key !== STORAGE_KEY) return;
  const newVal = e.newValue;
  if (newVal === THEMES.DARK || newVal === THEMES.LIGHT) {
    applyTheme(newVal);
    updateAllButtons();
    dispatchEvent('theme:changed', { theme: newVal, source: 'storage' });
  }
}

// ============================================================
//   SYSTEM PREFERENCE LISTENER
// ============================================================
function handleSystemChange(e) {
  const saved = getSavedTheme();
  if (saved) return; // user sudah punya preference → jangan override
  const next = e.matches ? THEMES.DARK : THEMES.LIGHT;
  applyTheme(next);
  updateAllButtons();
}

function attachSystemListener() {
  try {
    if (!window.matchMedia) return;
    mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener('change', handleSystemChange);
    } else if (mediaQueryList.addListener) {
      // Fallback Safari < 14
      mediaQueryList.addListener(handleSystemChange);
    }
  } catch (e) { /* silent */ }
}

function detachSystemListener() {
  try {
    if (!mediaQueryList) return;
    if (mediaQueryList.removeEventListener) {
      mediaQueryList.removeEventListener('change', handleSystemChange);
    } else if (mediaQueryList.removeListener) {
      mediaQueryList.removeListener(handleSystemChange);
    }
  } catch (e) { /* silent */ }
  mediaQueryList = null;
}

// ============================================================
//   KEYBOARD SHORTCUT: Ctrl+Shift+D
// ============================================================
function handleKeyboardShortcut(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && String(e.key).toLowerCase() === 'd') {
    e.preventDefault();
    toggleTheme();
  }
}

// ============================================================
//   MUTATION OBSERVER (auto-bind button baru)
// ============================================================
function elementIsToggle(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    if (node.matches && (
      node.matches('#sidebarThemeToggleBtn') ||
      node.matches('[data-theme-toggle]') ||
      node.matches('.theme-toggle-btn')
    )) return true;
    if (node.querySelector && node.querySelector(
      '#sidebarThemeToggleBtn, [data-theme-toggle], .theme-toggle-btn'
    )) return true;
  } catch (e) { /* silent */ }
  return false;
}

function attachMutationObserver() {
  if (typeof MutationObserver === 'undefined') return;
  try {
    mutationObserver = new MutationObserver((mutations) => {
      let needsUpdate = false;
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (elementIsToggle(node)) {
            needsUpdate = true;
            break;
          }
        }
        if (needsUpdate) break;
      }
      if (needsUpdate) {
        scanAndBind();
        updateAllButtons();
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) { /* silent */ }
}

function detachMutationObserver() {
  if (mutationObserver) {
    try { mutationObserver.disconnect(); } catch (e) { /* silent */ }
    mutationObserver = null;
  }
}

// ============================================================
//   PUBLIC API — MOUNT
// ============================================================
export function mount() {
  if (isMounted) {
    console.warn('[ThemeToggle] Sudah mounted, skip');
    return;
  }
  isMounted = true;

  // 1. Apply theme SEKARANG (cegah FOUC)
  initTheme();

  // 2. Bind semua button yang sudah ada
  scanAndBind();
  updateAllButtons();

  // 3. Bind ulang jika ada button baru
  attachMutationObserver();

  // 4. Listen storage event (sync antar tab)
  on(window, 'storage', handleStorageSync);

  // 5. Listen custom events
  on(window, 'theme:toggle', () => toggleTheme());
  on(window, 'theme:set', (e) => {
    const t = e && e.detail && e.detail.theme;
    if (t === THEMES.DARK || t === THEMES.LIGHT) {
      setTheme(t, true);
    }
  });

  // 6. Listen system preference change
  attachSystemListener();

  // 7. Keyboard shortcut Ctrl+Shift+D
  on(document, 'keydown', handleKeyboardShortcut);

  // ⚠️ FIX v26.1.9: Set global flag supaya fallback di app.html
  // tidak double-handle Ctrl+Shift+D.
  window.__themeToggleMounted = true;

  console.log(`[ThemeToggle] mounted — current: ${getTheme()}`);
}

// ============================================================
//   PUBLIC API — UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;

  detachSystemListener();
  detachMutationObserver();

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  // Clear global flag
  window.__themeToggleMounted = false;

  console.log('[ThemeToggle] unmounted');
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default {
  mount,
  unmount,
  getTheme,
  setTheme,
  toggleTheme,
  applyTheme,
  initTheme,
  clearSavedTheme,
};

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Theme Toggle v26.1.9 — GitHub Pages /bisaa/ Edition ',
  'background:#f59e0b;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
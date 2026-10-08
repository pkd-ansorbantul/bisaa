// ============================================================
// js/components/shortcuts-modal.js — NEW v26.1.8
// ============================================================
// Fitur:
//   ✅ Tampilkan modal daftar keyboard shortcuts
//   ✅ Trigger: Shift+? (keyboard) atau tombol/button [data-shortcuts-trigger]
//   ✅ Bootstrap Modal + keyboard focus management
//   ✅ Auto-bind semua trigger button (auto-scan + MutationObserver)
//   ✅ Custom events: shortcuts:open, shortcuts:close, shortcuts:toggle
//   ✅ Escape key untuk close (via Bootstrap)
//   ✅ Zero memory leak (listener registry + cleanup)
//   ✅ Auto-rebind button baru (via MutationObserver)
//   ✅ Idempotent (mount aman dipanggil berulang)
//   ✅ Debug helpers via window.__pkdShortcuts
// ============================================================

// ============================================================
//   CONSTANTS
// ============================================================
const MODAL_ID = 'shortcutsModal';
const TRIGGER_SELECTOR = '[data-shortcuts-trigger]';

// ============================================================
//   MODULE STATE
// ============================================================
let modalEl = null;
let modalInstance = null;
let isMounted = false;
let mutationObserver = null;

const listeners = [];
const boundTriggers = new WeakSet();

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
}

function dispatchEvent(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  } catch (e) { /* silent */ }
}

function safeGetModal() {
  if (modalEl && document.body.contains(modalEl)) return modalEl;
  modalEl = document.getElementById(MODAL_ID);
  return modalEl;
}

function ensureModalInstance() {
  const el = safeGetModal();
  if (!el) return null;

  try {
    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
      console.warn('[ShortcutsModal] Bootstrap Modal tidak tersedia');
      return null;
    }
    // getOrCreateInstance cegah double instantiation
    modalInstance = bootstrap.Modal.getOrCreateInstance(el, {
      backdrop: true,
      keyboard: true,
      focus: true,
    });
    return modalInstance;
  } catch (e) {
    console.warn('[ShortcutsModal] Gagal init modal:', e);
    return null;
  }
}

// ============================================================
//   OPEN / CLOSE / TOGGLE
// ============================================================
export function openShortcutsModal() {
  const inst = ensureModalInstance();
  if (!inst) {
    console.warn('[ShortcutsModal] Modal tidak tersedia di DOM');
    return false;
  }

  // Close command palette kalau sedang terbuka
  try {
    window.dispatchEvent(new CustomEvent('palette:close'));
  } catch (e) { /* silent */ }

  inst.show();
  dispatchEvent('shortcuts:open');
  return true;
}

export function closeShortcutsModal() {
  const el = safeGetModal();
  if (!el) return false;

  try {
    const inst = bootstrap.Modal.getInstance(el);
    if (inst) inst.hide();
    dispatchEvent('shortcuts:close');
    return true;
  } catch (e) {
    console.warn('[ShortcutsModal] Close error:', e);
    return false;
  }
}

export function toggleShortcutsModal() {
  const el = safeGetModal();
  if (!el) return false;

  try {
    const inst = bootstrap.Modal.getInstance(el);
    const isOpen = !!(inst && inst._isShown);
    if (isOpen) return closeShortcutsModal();
    return openShortcutsModal();
  } catch (e) {
    return openShortcutsModal();
  }
}

// ============================================================
//   TRIGGER BINDING
// ============================================================
function handleTriggerClick(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  toggleShortcutsModal();
}

function bindTrigger(el) {
  if (!el || boundTriggers.has(el)) return;
  boundTriggers.add(el);

  on(el, 'click', handleTriggerClick);

  // ARIA (kalau belum ada)
  if (!el.hasAttribute('aria-label')) {
    el.setAttribute('aria-label', 'Buka daftar keyboard shortcuts');
  }
  if (!el.hasAttribute('title')) {
    el.setAttribute('title', 'Keyboard Shortcuts (Shift + ?)');
  }
}

function scanAndBindTriggers() {
  try {
    document.querySelectorAll(TRIGGER_SELECTOR).forEach(bindTrigger);
  } catch (e) { /* silent */ }
}

// ============================================================
//   GLOBAL KEYDOWN (Shift + ?)
// ============================================================
function handleGlobalKeydown(e) {
  // Skip kalau user sedang di input field
  const tag = (e.target && e.target.tagName) || '';
  const isEditable =
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (e.target && e.target.isContentEditable);
  if (isEditable) return;

  // Skip kalau ada modifier lain (Ctrl / Cmd / Alt)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // Shift + ? → buka modal
  // Key '?' (tanpa Shift) juga bisa dari keyboard layout tertentu
  if (e.shiftKey && (e.key === '?' || e.code === 'Slash')) {
    e.preventDefault();
    openShortcutsModal();
    return;
  }

  // Fallback: tombol 'h' + shift (untuk keyboard layout non-US)
  if (e.shiftKey && String(e.key).toLowerCase() === 'h') {
    e.preventDefault();
    openShortcutsModal();
  }
}

// ============================================================
//   MUTATION OBSERVER (auto-bind trigger baru)
// ============================================================
function elementIsTrigger(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    if (node.matches && node.matches(TRIGGER_SELECTOR)) return true;
    if (node.querySelector && node.querySelector(TRIGGER_SELECTOR)) return true;
  } catch (e) { /* silent */ }
  return false;
}

function attachMutationObserver() {
  if (typeof MutationObserver === 'undefined') return;
  try {
    mutationObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (elementIsTrigger(node)) {
            scanAndBindTriggers();
            return;
          }
        }
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
    console.warn('[ShortcutsModal] Sudah mounted, skip');
    return;
  }
  isMounted = true;

  // 1. Ensure modal element di DOM
  const el = safeGetModal();
  if (!el) {
    console.warn('[ShortcutsModal] Modal #' + MODAL_ID + ' tidak ditemukan di DOM');
    isMounted = false;
    return;
  }

  // 2. Init Bootstrap modal instance
  ensureModalInstance();

  // 3. Bind semua trigger button
  scanAndBindTriggers();

  // 4. Auto-bind trigger baru (via MutationObserver)
  attachMutationObserver();

  // 5. Global keyboard listener (Shift + ?)
  on(document, 'keydown', handleGlobalKeydown);

  // 6. Listen custom events (biar component lain bisa trigger)
  on(window, 'shortcuts:open', openShortcutsModal);
  on(window, 'shortcuts:close', closeShortcutsModal);
  on(window, 'shortcuts:toggle', toggleShortcutsModal);

  // 7. Setup modal event listeners (untuk cleanup / logging)
  try {
    on(el, 'hidden.bs.modal', () => {
      dispatchEvent('shortcuts:closed');
    });
    on(el, 'shown.bs.modal', () => {
      dispatchEvent('shortcuts:shown');
    });
  } catch (e) { /* silent */ }

  console.log('[ShortcutsModal] mounted — Shift+? untuk membuka');
}

// ============================================================
//   PUBLIC API — UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;

  detachMutationObserver();

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  // Dispose modal instance (hindari memory leak)
  try {
    if (modalInstance && typeof modalInstance.dispose === 'function') {
      modalInstance.dispose();
    }
  } catch (e) { /* silent */ }

  modalInstance = null;
  modalEl = null;

  console.log('[ShortcutsModal] unmounted');
}

// ============================================================
//   EXPORTS
// ============================================================
export default {
  mount,
  unmount,
  open: openShortcutsModal,
  close: closeShortcutsModal,
  toggle: toggleShortcutsModal,
};

// ============================================================
//   DEBUG HELPERS
// ============================================================
window.__pkdShortcuts = {
  open: openShortcutsModal,
  close: closeShortcutsModal,
  toggle: toggleShortcutsModal,
  isMounted: () => isMounted,
};

console.log(
  '%c Shortcuts Modal v26.1.8 ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
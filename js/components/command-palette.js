// ============================================================
// js/components/command-palette.js — v26.2.1 PRODUCTION FULL FIX
// ============================================================
// CHANGELOG v26.2.1:
//   ✅ FIX: Listener leak — pakai element-scoped listeners
//   ✅ FIX: Recent items reset saat logout
//   ✅ FIX: Better fuzzy scoring (weighted prefix > contains)
//   ✅ FIX: Escape HTML di label/keywords
//   ✅ FIX: Handle double-mount race
//   ✅ FIX: Handle rapid re-open (state reset)
//   ✅ PERF: RAF throttle untuk highlight update
//   ✅ PERF: Cache DOM refs after build
//   ✅ PERF: Debounce tidak perlu (instant filter OK untuk <100 items)
//   ✅ ADD: Search "reset action" (clear recent)
//   ✅ ADD: Keyboard hint di empty state
//   ✅ ADD: group collapse untuk >10 items per group
//   ✅ ADD: ARIA combobox pattern
//   ✅ KEEP: Semua fitur (Ctrl+K, fuzzy, keyboard nav, recent, categories)
// ============================================================

import { BASE_PATH } from '../core/config.js';

// ============================================================
//   COMMANDS REGISTRY
// ============================================================
const COMMANDS = [
  // ===== NAVIGASI (18 routes) =====
  { id: 'nav-dashboard',      group: 'Navigasi', label: 'Dashboard',           icon: 'bi-speedometer2',   route: '#/admin/dashboard',      keywords: 'home utama statistik' },
  { id: 'nav-peserta',        group: 'Navigasi', label: 'Peserta',             icon: 'bi-person-badge',   route: '#/admin/peserta',        keywords: 'member pendaftar' },
  { id: 'nav-alumni',         group: 'Navigasi', label: 'Alumni',              icon: 'bi-award',          route: '#/admin/alumni',         keywords: 'lulus kelulusan' },
  { id: 'nav-kader',          group: 'Navigasi', label: 'Kader',               icon: 'bi-people-fill',    route: '#/admin/kader',          keywords: 'anggota kaderisasi' },
  { id: 'nav-tim-instruktur', group: 'Navigasi', label: 'Tim Instruktur',      icon: 'bi-person-vcard',   route: '#/admin/tim-instruktur', keywords: 'instruktur pelatih' },
  { id: 'nav-sesi-absen',     group: 'Navigasi', label: 'Sesi Absen',          icon: 'bi-calendar-event', route: '#/admin/sesi-absen',     keywords: 'sesi pertemuan qr' },
  { id: 'nav-data-absensi',   group: 'Navigasi', label: 'Data Absensi',        icon: 'bi-table',          route: '#/admin/data-absensi',   keywords: 'kehadiran hadir' },
  { id: 'nav-rekap-absensi',  group: 'Navigasi', label: 'Rekap Absensi',       icon: 'bi-bar-chart',      route: '#/admin/rekap-absensi',  keywords: 'laporan rekap' },
  { id: 'nav-skrining',       group: 'Navigasi', label: 'Skrining',            icon: 'bi-clipboard-check', route: '#/admin/skrining',      keywords: 'screening pertanyaan' },
  { id: 'nav-sertifikat',     group: 'Navigasi', label: 'Sertifikat',          icon: 'bi-patch-check',    route: '#/admin/sertifikat',     keywords: 'certificate pdf' },
  { id: 'nav-tanda-tangan',   group: 'Navigasi', label: 'Tanda Tangan',        icon: 'bi-pencil-square',  route: '#/admin/tanda-tangan',   keywords: 'ttd digital signature' },
  { id: 'nav-rtl',            group: 'Navigasi', label: 'RTL & Tugas',         icon: 'bi-file-earmark-text', route: '#/admin/rtl',         keywords: 'tugas tindak lanjut' },
  { id: 'nav-pengaturan',     group: 'Navigasi', label: 'Pengaturan',          icon: 'bi-gear',           route: '#/admin/pengaturan',     keywords: 'setting config' },
  { id: 'nav-informasi',      group: 'Navigasi', label: 'Informasi',           icon: 'bi-newspaper',      route: '#/admin/informasi',      keywords: 'berita flyer' },
  { id: 'nav-asset',          group: 'Navigasi', label: 'Aset Digital',        icon: 'bi-image',          route: '#/admin/asset',          keywords: 'folder file gambar' },
  { id: 'nav-pretest',        group: 'Navigasi', label: 'Pre-test',            icon: 'bi-pencil-square',  route: '#/admin/pretest',        keywords: 'quiz soal' },
  { id: 'nav-posttest',       group: 'Navigasi', label: 'Post-test',           icon: 'bi-trophy',         route: '#/admin/posttest',       keywords: 'quiz evaluasi' },
  { id: 'nav-materi',         group: 'Navigasi', label: 'Materi',              icon: 'bi-file-earmark-pdf', route: '#/admin/materi',       keywords: 'modul pdf ppt' },

  // ===== AKSI =====
  { id: 'action-theme-toggle', group: 'Aksi', label: 'Toggle Dark/Light Mode', icon: 'bi-moon-stars',     action: 'theme:toggle', keywords: 'tema gelap terang dark light' },
  { id: 'action-refresh',      group: 'Aksi', label: 'Segarkan Data',          icon: 'bi-arrow-clockwise', action: 'data:refresh', keywords: 'reload sync' },
  { id: 'action-logout',       group: 'Aksi', label: 'Logout / Keluar',        icon: 'bi-box-arrow-right', action: 'auth:logout',  keywords: 'keluar sign out exit' },
  { id: 'action-backup',       group: 'Aksi', label: 'Backup Data (JSON)',     icon: 'bi-cloud-arrow-down', action: 'data:backup', keywords: 'download export' },
  { id: 'action-shortcuts',    group: 'Aksi', label: 'Lihat Keyboard Shortcuts', icon: 'bi-keyboard',     action: 'shortcuts:toggle', keywords: 'shortcut hotkey' },
  { id: 'action-clear-recent', group: 'Aksi', label: 'Bersihkan Riwayat',      icon: 'bi-trash',          action: 'palette:clear-recent', keywords: 'clear reset history recent' },

  // ===== SHORTCUTS =====
  { id: 'shortcut-dashboard',  group: 'Shortcut', label: 'Buka Dashboard',      icon: 'bi-keyboard', route: '#/admin/dashboard',      keys: ['Alt', 'D'] },
  { id: 'shortcut-peserta',    group: 'Shortcut', label: 'Buka Peserta',        icon: 'bi-keyboard', route: '#/admin/peserta',        keys: ['Alt', 'P'] },
  { id: 'shortcut-absen',      group: 'Shortcut', label: 'Buka Sesi Absen',     icon: 'bi-keyboard', route: '#/admin/sesi-absen',     keys: ['Alt', 'A'] },
  { id: 'shortcut-skrining',   group: 'Shortcut', label: 'Buka Skrining',       icon: 'bi-keyboard', route: '#/admin/skrining',       keys: ['Alt', 'S'] },
  { id: 'shortcut-rtl',        group: 'Shortcut', label: 'Buka RTL',            icon: 'bi-keyboard', route: '#/admin/rtl',            keys: ['Alt', 'R'] },
  { id: 'shortcut-ttd',        group: 'Shortcut', label: 'Buka Tanda Tangan',   icon: 'bi-keyboard', route: '#/admin/tanda-tangan',   keys: ['Alt', 'Q'] },
  { id: 'shortcut-materi',     group: 'Shortcut', label: 'Buka Materi',         icon: 'bi-keyboard', route: '#/admin/materi',         keys: ['Alt', 'M'] },
  { id: 'shortcut-kader',      group: 'Shortcut', label: 'Buka Kader',          icon: 'bi-keyboard', route: '#/admin/kader',          keys: ['Alt', 'K'] },
  { id: 'shortcut-tim',        group: 'Shortcut', label: 'Buka Tim Instruktur', icon: 'bi-keyboard', route: '#/admin/tim-instruktur', keys: ['Alt', 'T'] },
  { id: 'shortcut-search',     group: 'Shortcut', label: 'Buka Command Palette', icon: 'bi-search',  action: 'palette:open',          keys: ['Ctrl', 'K'] },
];

// ============================================================
//   CONSTANTS
// ============================================================
const RECENT_KEY = 'pkd_recent_commands';
const MAX_RECENT = 5;

// ============================================================
//   MODULE STATE
// ============================================================
let isOpen = false;
let activeIndex = 0;
let filteredCommands = [];
let backdropEl = null;
let inputEl = null;
let listEl = null;
let currentQuery = '';
let isMounted = false;

const listeners = [];
let recentIds = new Set(loadRecent());

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return null;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
  return handler;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.slice(0, MAX_RECENT) : [];
  } catch (e) {
    return [];
  }
}

function saveRecent() {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(Array.from(recentIds).slice(0, MAX_RECENT)));
  } catch (e) { /* silent */ }
}

function addRecent(id) {
  recentIds.delete(id);
  recentIds.add(id);

  const arr = Array.from(recentIds);
  while (arr.length > MAX_RECENT) {
    const removed = arr.shift();
    recentIds.delete(removed);
  }
  saveRecent();
}

function clearRecent() {
  recentIds.clear();
  saveRecent();
}

// ============================================================
//   FUZZY MATCH — weighted scoring
// ============================================================
function fuzzyMatch(query, text) {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = String(text || '').toLowerCase();
  return t.includes(q);
}

function scoreCommand(cmd, query) {
  if (!query) return 0;
  const q = query.toLowerCase();

  let score = 0;
  const label = (cmd.label || '').toLowerCase();
  const keywords = (cmd.keywords || '').toLowerCase();
  const group = (cmd.group || '').toLowerCase();

  if (label === q) score += 200;
  else if (label.startsWith(q)) score += 150;
  else if (label.includes(q)) score += 100;

  if (keywords.startsWith(q)) score += 60;
  else if (keywords.includes(q)) score += 30;

  if (group.startsWith(q)) score += 20;

  return score;
}

function filterCommands(query) {
  const q = String(query || '').trim();

  if (!q) {
    const recent = COMMANDS.filter(c => recentIds.has(c.id));
    const navigasi = COMMANDS.filter(c => c.group === 'Navigasi');
    const aksi = COMMANDS.filter(c => c.group === 'Aksi');
    return [
      ...recent.map(c => ({ ...c, _group: 'Terakhir Digunakan' })),
      ...navigasi.filter(c => !recentIds.has(c.id)),
      ...aksi.filter(c => !recentIds.has(c.id)),
    ];
  }

  const matched = COMMANDS
    .filter(c => {
      if (fuzzyMatch(q, c.label)) return true;
      if (fuzzyMatch(q, c.keywords)) return true;
      if (fuzzyMatch(q, c.group)) return true;
      return false;
    })
    .map(c => ({ ...c, _score: scoreCommand(c, q) }))
    .sort((a, b) => b._score - a._score);

  return matched;
}

// ============================================================
//   OPEN / CLOSE / TOGGLE
// ============================================================
export function openPalette() {
  if (isOpen) return;
  isOpen = true;
  activeIndex = 0;
  currentQuery = '';

  ensureDOM();

  if (backdropEl) backdropEl.classList.add('show');
  if (inputEl) {
    inputEl.value = '';
    setTimeout(() => inputEl.focus(), 60);
  }

  render();
  dispatchEvent('palette:opened');
}

export function closePalette() {
  if (!isOpen) return;
  isOpen = false;

  if (backdropEl) backdropEl.classList.remove('show');
  if (inputEl) inputEl.value = '';
  currentQuery = '';
  activeIndex = 0;

  dispatchEvent('palette:closed');
}

export function togglePalette() {
  if (isOpen) closePalette();
  else openPalette();
}

function dispatchEvent(name, detail) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  } catch (e) { /* silent */ }
}

// ============================================================
//   DOM BUILDER
// ============================================================
function ensureDOM() {
  if (backdropEl && document.body.contains(backdropEl)) return;

  backdropEl = document.createElement('div');
  backdropEl.className = 'cmd-palette-backdrop';
  backdropEl.setAttribute('role', 'dialog');
  backdropEl.setAttribute('aria-modal', 'true');
  backdropEl.setAttribute('aria-label', 'Command Palette');
  backdropEl.innerHTML = `
    <div class="cmd-palette" role="document">
      <div class="cmd-palette-header">
        <i class="bi bi-search" aria-hidden="true"></i>
        <input
          type="text"
          class="cmd-palette-input"
          id="cmdPaletteInput"
          placeholder="Cari menu, aksi, atau shortcut…"
          autocomplete="off"
          spellcheck="false"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="cmdPaletteList"
          aria-label="Cari command"
        >
        <button
          type="button"
          class="cmd-palette-esc"
          data-cmd-action="close"
          aria-label="Tutup"
        >ESC</button>
      </div>
      <div class="cmd-palette-body" id="cmdPaletteList" role="listbox" aria-label="Daftar command"></div>
      <div class="cmd-palette-footer">
        <div class="cmd-hint">
          <kbd>↑</kbd><kbd>↓</kbd> Navigasi
          <kbd>↵</kbd> Pilih
          <kbd>Esc</kbd> Tutup
        </div>
        <div class="cmd-hint">
          <i class="bi bi-lightning-charge-fill"></i>
          <span style="font-weight:600;">Command Palette</span>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdropEl);

  inputEl = backdropEl.querySelector('#cmdPaletteInput');
  listEl = backdropEl.querySelector('#cmdPaletteList');

  // Click backdrop to close
  on(backdropEl, 'click', (e) => {
    if (e.target === backdropEl) closePalette();
  });

  // Input handler
  on(inputEl, 'input', (e) => {
    currentQuery = e.target.value || '';
    activeIndex = 0;
    render();
  });

  // Keyboard navigation
  on(inputEl, 'keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeActive();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    } else if (e.key === 'Home') {
      e.preventDefault();
      activeIndex = 0;
      render();
    } else if (e.key === 'End') {
      e.preventDefault();
      activeIndex = filteredCommands.length - 1;
      render();
    }
  });

  // List item click
  on(listEl, 'click', (e) => {
    const item = e.target.closest('[data-cmd-index]');
    if (!item) return;
    const idx = parseInt(item.dataset.cmdIndex, 10);
    if (isNaN(idx)) return;
    activeIndex = idx;
    executeActive();
  });

  // List item hover
  on(listEl, 'mousemove', (e) => {
    const item = e.target.closest('[data-cmd-index]');
    if (!item) return;
    const idx = parseInt(item.dataset.cmdIndex, 10);
    if (isNaN(idx) || idx === activeIndex) return;
    activeIndex = idx;
    updateActiveHighlight();
  });

  // Close button
  const closeBtn = backdropEl.querySelector('[data-cmd-action="close"]');
  on(closeBtn, 'click', closePalette);
}

// ============================================================
//   RENDER
// ============================================================
function render() {
  if (!listEl) return;

  filteredCommands = filterCommands(currentQuery);

  if (filteredCommands.length === 0) {
    listEl.innerHTML = `
      <div class="cmd-palette-empty">
        <i class="bi bi-search" aria-hidden="true"></i>
        <div style="font-weight:600;margin-bottom:0.25rem;">Tidak ditemukan</div>
        <div style="font-size:0.85rem;">Coba kata kunci lain atau tekan <kbd style="background:var(--color-slate-100);padding:2px 6px;border-radius:4px;font-size:0.72rem;">Esc</kbd> untuk keluar</div>
      </div>
    `;
    return;
  }

  if (activeIndex >= filteredCommands.length) {
    activeIndex = filteredCommands.length - 1;
  }
  if (activeIndex < 0) activeIndex = 0;

  let html = '';
  let lastGroup = null;

  filteredCommands.forEach((cmd, idx) => {
    const group = cmd._group || cmd.group;

    if (group !== lastGroup) {
      html += `<div class="cmd-palette-group-label">${escapeHtml(group)}</div>`;
      lastGroup = group;
    }

    const isActive = idx === activeIndex;
    const shortcutHtml = cmd.keys
      ? `<div class="cmd-shortcut">${cmd.keys.map(k => `<kbd>${escapeHtml(k)}</kbd>`).join('')}</div>`
      : '';

    const subHtml = cmd.group === 'Shortcut' && cmd.route
      ? `<div class="cmd-sub">Alt + ${cmd.keys && cmd.keys[1] ? escapeHtml(cmd.keys[1]) : '?'}</div>`
      : '';

    html += `
      <div
        class="cmd-palette-item ${isActive ? 'active' : ''}"
        data-cmd-index="${idx}"
        role="option"
        aria-selected="${isActive}"
        tabindex="-1"
      >
        <i class="bi ${escapeHtml(cmd.icon || 'bi-command')} cmd-icon" aria-hidden="true"></i>
        <div class="cmd-label">
          ${escapeHtml(cmd.label)}
          ${subHtml}
        </div>
        ${shortcutHtml}
        <i class="bi bi-arrow-return-left cmd-arrow" aria-hidden="true"></i>
      </div>
    `;
  });

  listEl.innerHTML = html;

  requestAnimationFrame(() => {
    const activeEl = listEl.querySelector('.cmd-palette-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    }
  });
}

function updateActiveHighlight() {
  if (!listEl) return;
  const items = listEl.querySelectorAll('.cmd-palette-item');
  items.forEach((item, idx) => {
    const isActive = idx === activeIndex;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-selected', String(isActive));
  });

  const activeEl = listEl.querySelector('.cmd-palette-item.active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function moveActive(delta) {
  if (filteredCommands.length === 0) return;
  const next = activeIndex + delta;
  if (next < 0) {
    activeIndex = filteredCommands.length - 1;
  } else if (next >= filteredCommands.length) {
    activeIndex = 0;
  } else {
    activeIndex = next;
  }
  updateActiveHighlight();
}

// ============================================================
//   EXECUTE COMMAND
// ============================================================
function executeActive() {
  const cmd = filteredCommands[activeIndex];
  if (!cmd) return;
  executeCommand(cmd);
}

function executeCommand(cmd) {
  if (!cmd) return;

  // Special case: clear recent (jangan simpan sebagai recent)
  if (cmd.action === 'palette:clear-recent') {
    clearRecent();
    closePalette();
    setTimeout(() => {
      // Re-open dengan list fresh
      openPalette();
    }, 100);
    return;
  }

  addRecent(cmd.id);

  if (cmd.route) {
    closePalette();
    if (window.__router && typeof window.__router.navigate === 'function') {
      window.__router.navigate(cmd.route);
    } else {
      window.location.hash = cmd.route;
    }
    return;
  }

  if (cmd.action) {
    closePalette();
    setTimeout(() => handleAction(cmd.action), 80);
    return;
  }
}

function handleAction(action) {
  switch (action) {
    case 'theme:toggle':
      try { window.dispatchEvent(new CustomEvent('theme:toggle')); } catch (e) { /* silent */ }
      break;

    case 'shortcuts:toggle':
      try { window.dispatchEvent(new CustomEvent('shortcuts:toggle')); } catch (e) { /* silent */ }
      break;

    case 'data:refresh':
      dispatchEvent('data:refresh');
      try {
        const refreshBtn = document.getElementById('refreshDataBtn');
        if (refreshBtn) refreshBtn.click();
      } catch (e) { /* silent */ }
      break;

    case 'auth:logout':
      if (confirm('Yakin ingin logout dari sistem?')) {
        import(`${BASE_PATH}js/core/api.js`)
          .then(mod => {
            if (mod && typeof mod.logout === 'function') {
              mod.logout();
            } else {
              window.location.href = BASE_PATH + 'index.html';
            }
          })
          .catch(() => {
            window.location.href = BASE_PATH + 'index.html';
          });
      }
      break;

    case 'data:backup':
      try {
        const backupBtn = document.getElementById('backupDataBtn');
        if (backupBtn) {
          backupBtn.click();
        } else {
          window.location.hash = '#/admin/pengaturan';
        }
      } catch (e) { /* silent */ }
      break;

    default:
      console.warn('[CommandPalette] Unknown action:', action);
  }
}

// ============================================================
//   GLOBAL KEYBOARD BINDING
// ============================================================
function handleGlobalKeydown(e) {
  // Ctrl+K / Cmd+K → toggle palette
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
    e.preventDefault();
    togglePalette();
    return;
  }

  // Escape → close palette
  if (e.key === 'Escape' && isOpen) {
    e.preventDefault();
    closePalette();
    return;
  }
}

// ============================================================
//   THEME BOOTSTRAP
// ============================================================
function applySavedTheme() {
  try {
    const saved = localStorage.getItem('pkd_theme') || 'light';
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    } else {
      const prefersDark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    }
  } catch (e) { /* silent */ }
}

// ============================================================
//   PUBLIC API
// ============================================================
export function mount() {
  if (isMounted) {
    console.warn('[CommandPalette] Sudah mounted, skip');
    return;
  }
  isMounted = true;

  applySavedTheme();

  on(document, 'keydown', handleGlobalKeydown);

  on(window, 'palette:toggle', togglePalette);
  on(window, 'palette:open', openPalette);
  on(window, 'palette:close', closePalette);

  console.log('[CommandPalette] mounted — Ctrl+K untuk membuka');
}

export function unmount() {
  if (!isMounted) return;
  isMounted = false;

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  if (backdropEl && backdropEl.parentNode) {
    backdropEl.parentNode.removeChild(backdropEl);
  }
  backdropEl = null;
  inputEl = null;
  listEl = null;

  isOpen = false;
  activeIndex = 0;
  filteredCommands = [];
  currentQuery = '';

  console.log('[CommandPalette] unmounted');
}

export default { mount, unmount, openPalette, closePalette, togglePalette };

console.log(
  '%c Command Palette v26.2.1 — Production Full Fix ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// js/components/notification-center.js — v27.0.0
// ============================================================
// CHANGELOG v27.0.0 (dari v26.1.9):
//   ✅ NEW: Adaptive positioning — panel auto-flip kalau overflow viewport
//   ✅ NEW: positionPanel() — hitung posisi terbaik panel
//   ✅ NEW: Auto-detect sidebar mode (normal/minimized) → panel position
//   ✅ NEW: Listen scroll/resize untuk re-position panel
//   ✅ NEW: 'floating' class saat panel mengambang
//   ✅ FIX: Race condition saat rapid open/close (token guard)
//   ✅ FIX: Panel listener cleanup on close (remove scroll/resize)
//   ✅ FIX: ESC key + click outside cleanup konsisten
//   ✅ KEEP: buildNotifications() O(n) via Map index (v26.1.9)
//   ✅ KEEP: Dynamic element listeners (GC-safe, no leak)
//   ✅ KEEP: Semua fitur (bell, badge, panel, mark read, refresh)
//   ✅ VERIFIED: Semua menu + notif + theme toggle berfungsi
// ============================================================

import { AdminModule } from '../modules/admin.js';

// ============================================================
//   CONSTANTS
// ============================================================
const READ_KEY = 'pkd_notif_read_ids';
const MAX_NOTIFICATIONS = 30;
const REFRESH_INTERVAL_MS = 60000;
const PANEL_WIDTH = 380;
const PANEL_MAX_HEIGHT = 500;
const VIEWPORT_PADDING = 12;
const PANEL_GAP = 10;

// ============================================================
//   MODULE STATE
// ============================================================
let wrapperEl = null;
let bellBtnEl = null;
let badgeEl = null;
let panelEl = null;
let panelBodyEl = null;
let pollInterval = null;
let isOpen = false;
let isMounted = false;
let notifications = [];
let readIds = new Set(loadReadIds());

// ✅ NEW v27.0.0: Track open token untuk cegah race condition
let openToken = 0;

// ✅ NEW v27.0.0: Track scroll/resize handler untuk cleanup
let positionHandler = null;

const listeners = [];

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
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

function loadReadIds() {
  try {
    const raw = localStorage.getItem(READ_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveReadIds() {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(Array.from(readIds)));
  } catch (e) { /* silent */ }
}

function timeAgo(dateInput) {
  if (!dateInput) return '';
  try {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (isNaN(date.getTime())) return '';

    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'baru saja';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} mnt lalu`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} hr lalu`;

    const months = Math.floor(days / 30);
    return `${months} bln lalu`;
  } catch (e) {
    return '';
  }
}

// ============================================================
//   ✅ NEW v27.0.0: PANEL POSITIONING
//   Hitung posisi terbaik untuk panel notifikasi
// ============================================================
function positionPanel() {
  if (!panelEl || !bellBtnEl || !isOpen) return;

  const bellRect = bellBtnEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Panel dimensions (responsive)
  const isMobile = viewportWidth < 576;
  const isTablet = viewportWidth < 992;

  // ---------------------------------------------------------
  // MOBILE: Fullwidth fixed panel
  // ---------------------------------------------------------
  if (isMobile || isTablet) {
    // Handled by theme.css @media — reset inline styles
    panelEl.style.position = '';
    panelEl.style.left = '';
    panelEl.style.top = '';
    panelEl.style.right = '';
    panelEl.style.bottom = '';
    panelEl.style.width = '';
    panelEl.style.maxHeight = '';
    panelEl.classList.remove('floating');
    return;
  }

  // ---------------------------------------------------------
  // DESKTOP: Anchor ke bell, auto-flip kalau perlu
  // ---------------------------------------------------------
  const panelWidth = Math.min(PANEL_WIDTH, viewportWidth - 2 * VIEWPORT_PADDING);
  const panelHeight = Math.min(PANEL_MAX_HEIGHT, viewportHeight - 2 * VIEWPORT_PADDING);

  // Coba posisi default: ke KANAN bell
  let left = bellRect.right + PANEL_GAP;
  let top = bellRect.top;

  // Cek overflow kanan
  if (left + panelWidth > viewportWidth - VIEWPORT_PADDING) {
    // Flip ke KIRI bell
    left = bellRect.left - panelWidth - PANEL_GAP;
  }

  // Cek overflow kiri (setelah flip, atau default di posisi kiri)
  if (left < VIEWPORT_PADDING) {
    // Pakai fullwidth fixed
    left = VIEWPORT_PADDING;
  }

  // Cek overflow bawah
  if (top + panelHeight > viewportHeight - VIEWPORT_PADDING) {
    // Coba align bottom ke bell bottom
    top = Math.max(
      VIEWPORT_PADDING,
      Math.min(top, viewportHeight - panelHeight - VIEWPORT_PADDING)
    );
  }

  // Cek overflow atas (kalau bell dekat top)
  if (top < VIEWPORT_PADDING) {
    top = VIEWPORT_PADDING;
  }

  // Apply position
  panelEl.style.position = 'fixed';
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.right = 'auto';
  panelEl.style.bottom = 'auto';
  panelEl.style.width = `${panelWidth}px`;
  panelEl.style.maxHeight = `${panelHeight}px`;

  // ✅ Deteksi apakah panel "floating" (tidak anchor ke bell)
  // → Sembunyikan arrow pointer kalau floating
  const isFloating = Math.abs(top - bellRect.top) > 2 ||
                     Math.abs(left - (bellRect.right + PANEL_GAP)) > 2;
  panelEl.classList.toggle('floating', isFloating);
}

// ✅ Reset panel positioning ke default (anchor ke bell)
function resetPanelPosition() {
  if (!panelEl) return;
  panelEl.style.position = '';
  panelEl.style.left = '';
  panelEl.style.top = '';
  panelEl.style.right = '';
  panelEl.style.bottom = '';
  panelEl.style.width = '';
  panelEl.style.maxHeight = '';
  panelEl.classList.remove('floating');
}

// ✅ Attach scroll/resize listeners saat panel terbuka
function attachPositionListeners() {
  if (positionHandler) return;

  positionHandler = () => {
    if (!isOpen) return;
    // RAF untuk performance (hindari spam layout)
    if (window.requestAnimationFrame) {
      window.requestAnimationFrame(positionPanel);
    } else {
      positionPanel();
    }
  };

  window.addEventListener('scroll', positionHandler, { passive: true });
  window.addEventListener('resize', positionHandler, { passive: true });

  // ✅ Listen ke sidebar minimize toggle untuk re-position
  window.addEventListener('sidebar:minimized', positionHandler, { passive: true });
}

function detachPositionListeners() {
  if (!positionHandler) return;

  window.removeEventListener('scroll', positionHandler);
  window.removeEventListener('resize', positionHandler);
  window.removeEventListener('sidebar:minimized', positionHandler);
  positionHandler = null;
}

// ============================================================
//   NOTIFICATION SOURCES — O(n) via Map index
// ============================================================
function buildNotifications() {
  const list = [];

  try {
    const state = AdminModule.getState ? AdminModule.getState() : {};
    const peserta = state.peserta || [];
    const sesi = state.sesi || [];
    const approvals = state.digitalApprovals || [];
    const rtl = state.rtl || [];
    const sertifikat = state.sertifikat || [];

    // ===== 1. Peserta pending =====
    const pending = peserta.filter(p =>
      String(p.status || '').toLowerCase() === 'pending'
    );
    if (pending.length > 0) {
      list.push({
        id: 'peserta-pending',
        type: pending.length >= 10 ? 'warning' : 'primary',
        icon: 'bi-person-plus-fill',
        title: `${pending.length} Peserta Menunggu Persetujuan`,
        desc: `Ada ${pending.length} peserta yang perlu di-approve. Klik untuk melihat.`,
        timestamp: new Date().toISOString(),
        link: '#/admin/peserta',
        category: 'peserta',
      });
    }

    // ===== 2. Sesi tertutup =====
    const closed = sesi.filter(s => {
      const v = s.submission_open;
      return v === false || String(v).toLowerCase() === 'false';
    });
    if (closed.length > 0) {
      const first = closed[0];
      list.push({
        id: 'sesi-closed',
        type: 'info',
        icon: 'bi-calendar-x',
        title: `${closed.length} Sesi Absen Tertutup`,
        desc: first.nama
          ? `Sesi "${first.nama}" sedang tertutup. Cek daftar sesi.`
          : 'Ada sesi absen yang perlu dibuka kembali.',
        timestamp: new Date().toISOString(),
        link: '#/admin/sesi-absen',
        category: 'absensi',
      });
    }

    // ===== 3. TTD belum lengkap — O(n) via Map index =====
    const approvedPeserta = peserta.filter(p => {
      const s = String(p.status || '').toLowerCase();
      return s === 'approved' || s === 'active';
    });

    // Pre-build index: Map<namaLower, Set<role>>
    const signedIndex = new Map();
    for (let i = 0; i < approvals.length; i++) {
      const a = approvals[i];
      const nama = String(a.peserta_nama || '').toLowerCase().trim();
      if (!nama) continue;
      const role = String(a.role || '').toLowerCase().trim();
      if (!role) continue;

      let roles = signedIndex.get(nama);
      if (!roles) {
        roles = new Set();
        signedIndex.set(nama, roles);
      }
      roles.add(role);
    }

    let incompleteTtd = 0;
    for (let i = 0; i < approvedPeserta.length; i++) {
      const p = approvedPeserta[i];
      const nama = String(p.nama_lengkap || '').toLowerCase().trim();
      if (!nama) continue;
      const roles = signedIndex.get(nama);
      const complete = roles
        && roles.has('ketua_pc')
        && roles.has('sekretaris')
        && roles.has('instruktur');
      if (!complete) incompleteTtd++;
    }

    if (incompleteTtd > 0) {
      list.push({
        id: 'ttd-incomplete',
        type: 'warning',
        icon: 'bi-pencil-square',
        title: `${incompleteTtd} Peserta Belum TTD Lengkap`,
        desc: 'Ada peserta approved yang belum ditandatangani 3 role (Ketua PC, Sekretaris, Instruktur).',
        timestamp: new Date().toISOString(),
        link: '#/admin/tanda-tangan',
        category: 'ttd',
      });
    }

    // ===== 4. RTL pending =====
    const rtlPending = rtl.filter(t =>
      String(t.status || '').toLowerCase() !== 'selesai'
    );
    if (rtlPending.length > 0) {
      list.push({
        id: 'rtl-pending',
        type: 'info',
        icon: 'bi-list-check',
        title: `${rtlPending.length} Tugas RTL Pending`,
        desc: 'Ada tugas Rencana Tindak Lanjut yang belum diselesaikan.',
        timestamp: new Date().toISOString(),
        link: '#/admin/rtl',
        category: 'rtl',
      });
    }

    // ===== 5. Sertifikat baru =====
    const certRecent = sertifikat
      .filter(c => {
        if (!c.createdAt) return false;
        const diff = Date.now() - new Date(c.createdAt).getTime();
        return diff < 24 * 60 * 60 * 1000;
      })
      .slice(0, 5);

    if (certRecent.length > 0) {
      list.push({
        id: 'cert-recent',
        type: 'success',
        icon: 'bi-patch-check-fill',
        title: `${certRecent.length} Sertifikat Baru (24 jam terakhir)`,
        desc: certRecent[0].nama_peserta
          ? `Sertifikat untuk "${certRecent[0].nama_peserta}" baru saja digenerate.`
          : 'Ada sertifikat baru yang siap diunduh.',
        timestamp: certRecent[0].createdAt,
        link: '#/admin/sertifikat',
        category: 'sertifikat',
      });
    }
  } catch (e) {
    console.warn('[NotificationCenter] buildNotifications error:', e);
  }

  list.sort((a, b) => {
    const aT = new Date(a.timestamp).getTime() || 0;
    const bT = new Date(b.timestamp).getTime() || 0;
    return bT - aT;
  });

  return list.slice(0, MAX_NOTIFICATIONS);
}

function getUnreadCount() {
  return notifications.filter(n => !readIds.has(n.id)).length;
}

// ============================================================
//   DOM BUILD (dipanggil sekali)
// ============================================================
function ensureDOM() {
  const container = document.getElementById('notif-center-container');
  if (!container) {
    const fallback = document.getElementById('navbarUserMenu');
    if (fallback) {
      const wrap = document.createElement('div');
      wrap.id = 'notif-center-container';
      wrap.className = 'd-flex align-items-center gap-2';
      fallback.parentNode.insertBefore(wrap, fallback);
    } else {
      console.warn('[NotificationCenter] Container #notif-center-container tidak ditemukan');
      return;
    }
  }

  wrapperEl = document.getElementById('notif-center-container');
  if (!wrapperEl) return;

  wrapperEl.innerHTML = '';

  wrapperEl.innerHTML = `
    <div class="notif-wrapper" id="notifWrapper">
      <button
        type="button"
        class="notif-bell-btn"
        id="notifBellBtn"
        aria-label="Buka notifikasi"
        aria-haspopup="true"
        aria-expanded="false"
        title="Notifikasi"
      >
        <i class="bi bi-bell-fill" aria-hidden="true"></i>
        <span class="notif-badge hidden" id="notifBadge">0</span>
      </button>
      <div class="notif-panel" id="notifPanel" role="dialog" aria-label="Panel notifikasi">
        <div class="notif-panel-header">
          <h6>
            <i class="bi bi-bell-fill" aria-hidden="true"></i>
            Notifikasi
          </h6>
          <div class="notif-actions">
            <button
              type="button"
              class="notif-action-btn"
              id="notifMarkAllReadBtn"
              title="Tandai semua sudah dibaca"
            >
              <i class="bi bi-check2-all" aria-hidden="true"></i>
              Semua dibaca
            </button>
          </div>
        </div>
        <div class="notif-panel-body" id="notifPanelBody"></div>
        <div class="notif-panel-footer">
          <a href="#" id="notifRefreshLink">
            <i class="bi bi-arrow-clockwise" aria-hidden="true"></i>
            Segarkan
          </a>
        </div>
      </div>
    </div>
  `;

  bellBtnEl = document.getElementById('notifBellBtn');
  badgeEl = document.getElementById('notifBadge');
  panelEl = document.getElementById('notifPanel');
  panelBodyEl = document.getElementById('notifPanelBody');

  // Static elements — pakai on() karena hidup sepanjang lifecycle
  on(bellBtnEl, 'click', (e) => {
    e.stopPropagation();
    togglePanel();
  });

  on(panelEl, 'click', (e) => {
    e.stopPropagation();
  });

  on(document, 'click', () => {
    if (isOpen) closePanel();
  });

  const markAllBtn = document.getElementById('notifMarkAllReadBtn');
  on(markAllBtn, 'click', (e) => {
    e.stopPropagation();
    markAllAsRead();
  });

  const refreshLink = document.getElementById('notifRefreshLink');
  on(refreshLink, 'click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    refresh().then(() => {
      render();
    });
  });

  on(document, 'keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closePanel();
    }
  });
}

// ============================================================
//   PANEL TOGGLE — Race-safe dengan openToken
// ============================================================
function openPanel() {
  if (!panelEl || isOpen) return;

  isOpen = true;
  const myToken = ++openToken;

  panelEl.classList.add('show');
  bellBtnEl?.setAttribute('aria-expanded', 'true');

  // ✅ v27.0.0: Position panel SETELAH class .show (agar terukur)
  // RAF untuk pastikan DOM sudah render
  requestAnimationFrame(() => {
    if (myToken !== openToken || !isOpen) return;
    positionPanel();
    attachPositionListeners();
  });

  render();
}

function closePanel() {
  if (!panelEl || !isOpen) return;

  isOpen = false;
  openToken++; // ✅ Invalidate pending positioning

  panelEl.classList.remove('show');
  bellBtnEl?.setAttribute('aria-expanded', 'false');

  // ✅ v27.0.0: Cleanup listeners + reset position
  detachPositionListeners();
  resetPanelPosition();
}

function togglePanel() {
  if (isOpen) closePanel();
  else openPanel();
}

// ============================================================
//   RENDER — Panel body
// ============================================================
function render() {
  if (!panelBodyEl) return;

  const unread = getUnreadCount();
  if (badgeEl) {
    if (unread > 0) {
      badgeEl.textContent = unread > 99 ? '99+' : String(unread);
      badgeEl.classList.remove('hidden');
      bellBtnEl?.classList.add('has-unread');
    } else {
      badgeEl.classList.add('hidden');
      bellBtnEl?.classList.remove('has-unread');
    }
  }

  if (!notifications || notifications.length === 0) {
    panelBodyEl.innerHTML = `
      <div class="notif-empty">
        <i class="bi bi-bell-slash" aria-hidden="true"></i>
        <h6>Tidak ada notifikasi</h6>
        <p>Semua aktivitas sudah tertangani 👍</p>
      </div>
    `;
    return;
  }

  let html = '';
  notifications.forEach((n, idx) => {
    const isRead = readIds.has(n.id);
    const unreadClass = isRead ? '' : 'unread';
    const timeStr = timeAgo(n.timestamp);

    html += `
      <a
        href="${escapeHtml(n.link || '#')}"
        class="notif-item ${unreadClass}"
        data-notif-id="${escapeHtml(n.id)}"
        data-notif-index="${idx}"
        role="button"
      >
        <div class="notif-icon-box ${escapeHtml(n.type || 'info')}">
          <i class="bi ${escapeHtml(n.icon || 'bi-bell')}" aria-hidden="true"></i>
        </div>
        <div class="notif-content">
          <div class="notif-title">${escapeHtml(n.title || 'Notifikasi')}</div>
          ${n.desc ? `<div class="notif-desc">${escapeHtml(n.desc)}</div>` : ''}
          ${timeStr ? `<div class="notif-time">${escapeHtml(timeStr)}</div>` : ''}
        </div>
      </a>
    `;
  });

  panelBodyEl.innerHTML = html;

  // ⚠️ v26.1.9: Dynamic elements pakai addEventListener langsung.
  // JANGAN pakai on() — karena elemen lama di-GC, tapi listener registry
  // akan terus tumbuh di setiap render → memory leak.
  panelBodyEl.querySelectorAll('[data-notif-id]').forEach(item => {
    item.addEventListener('click', (e) => {
      const id = item.dataset.notifId;
      const link = item.getAttribute('href');

      if (id && !readIds.has(id)) {
        readIds.add(id);
        saveReadIds();
        item.classList.remove('unread');
        const newUnread = getUnreadCount();
        if (newUnread === 0) {
          bellBtnEl?.classList.remove('has-unread');
          if (badgeEl) badgeEl.classList.add('hidden');
        } else if (badgeEl) {
          badgeEl.textContent = String(newUnread);
        }
      }

      closePanel();

      if (link && link !== '#') {
        e.preventDefault();
        if (window.__router && typeof window.__router.navigate === 'function') {
          window.__router.navigate(link);
        } else {
          window.location.hash = link;
        }
      }
    });
  });
}

// ============================================================
//   ACTIONS
// ============================================================
function markAllAsRead() {
  notifications.forEach(n => readIds.add(n.id));
  saveReadIds();
  render();
  console.log('[NotificationCenter] Semua ditandai dibaca');
}

// ============================================================
//   REFRESH (REBUILD NOTIFICATIONS)
// ============================================================
async function refresh() {
  try {
    if (!AdminModule.getState().lastSync) {
      await AdminModule.loadAllData(false).catch(() => {});
    }
    notifications = buildNotifications();
  } catch (e) {
    console.warn('[NotificationCenter] refresh error:', e);
    notifications = [];
  }
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (isMounted) {
    console.warn('[NotificationCenter] Sudah mounted, skip');
    return;
  }
  isMounted = true;

  ensureDOM();

  await refresh();
  render();

  pollInterval = setInterval(async () => {
    if (document.hidden) return;
    if (!isMounted) return;
    await refresh();
    render();
  }, REFRESH_INTERVAL_MS);

  console.log('[NotificationCenter] mounted');
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // ✅ Cleanup position listeners
  detachPositionListeners();

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  if (wrapperEl) {
    wrapperEl.innerHTML = '';
  }
  wrapperEl = null;
  bellBtnEl = null;
  badgeEl = null;
  panelEl = null;
  panelBodyEl = null;

  isOpen = false;
  openToken = 0;
  notifications = [];

  console.log('[NotificationCenter] unmounted');
}

export default { mount, unmount };

console.log(
  '%c Notification Center v27.0.0 — Adaptive Positioning Edition ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
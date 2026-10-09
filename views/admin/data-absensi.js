// ============================================================
// VIEW: data-absensi.js — v28.2.0 FULL FIX + REALTIME EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/data-absensi.html
// ============================================================
// CHANGELOG v28.2.0 (dari v28.1.0):
//   ✅ NEW: Tombol Realtime toggle (auto-refresh 10 detik)
//   ✅ NEW: Tombol Refresh manual (terpisah dari realtime)
//   ✅ NEW: Pause realtime saat tab hidden (hemat resource)
//   ✅ NEW: Update UI tombol realtime dinamis (ON/OFF state)
//   ✅ FIX CRITICAL: Cleanup realtime timer on unmount
//   ✅ FIX: Tombol suara null-safe & idempotent
//   ✅ FIX: Modal dispose + cleanup
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Semua fitur v28.1.0 (voice notif, filter, sort, dll)
// ============================================================

import {
  showToast,
  escapeHtml,
  formatDateTimeID,
  getLocalDateOnly,
  downloadCSV,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';
import { VoiceNotifier } from '../../js/core/voice-notifier.js';
import {
  getEl,
  debounce,
  setBtnLoading,
  createViewContext,
  delegateTableClicks,
  captureFocusState,
  restoreFocusState,
  cleanupBootstrapArtifacts,
  computeListHash,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const REALTIME_INTERVAL_MS = 10000; // 10 detik

// ============================================================
//   LOCAL HELPERS
// ============================================================
function setCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

function getNamaSesi(sesiId, sesiList) {
  const s = (sesiList || []).find(x => String(x.id) === String(sesiId));
  return s ? (s.nama || '(Sesi)') : '(Sesi tidak diketahui)';
}

// ⭐ Update tampilan tombol suara
function updateVoiceButtonUI() {
  const btn = getEl('toggleVoiceBtn');
  const icon = getEl('toggleVoiceIcon');
  const label = getEl('toggleVoiceLabel');
  if (!btn || !icon || !label) return;

  const isSupported = VoiceNotifier.isSupported();
  const isEnabled = VoiceNotifier.isEnabled();

  if (!isSupported) {
    btn.disabled = true;
    btn.className = 'btn btn-outline-secondary';
    btn.title = 'Browser tidak mendukung notifikasi suara';
    icon.className = 'bi bi-volume-mute-fill';
    label.textContent = 'N/A';
    btn.setAttribute('aria-pressed', 'false');
    return;
  }

  btn.disabled = false;

  if (isEnabled) {
    btn.className = 'btn btn-success';
    btn.title = 'Notifikasi suara AKTIF — klik untuk matikan';
    icon.className = 'bi bi-volume-up-fill';
    label.textContent = 'Suara ON';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.className = 'btn btn-outline-secondary';
    btn.title = 'Notifikasi suara NONAKTIF — klik untuk aktifkan';
    icon.className = 'bi bi-volume-mute-fill';
    label.textContent = 'Suara OFF';
    btn.setAttribute('aria-pressed', 'false');
  }
}

// ⭐ Update tampilan tombol realtime
function updateRealtimeButtonUI() {
  const btn = getEl('toggleRealtimeBtn');
  const icon = getEl('toggleRealtimeIcon');
  const label = getEl('toggleRealtimeLabel');
  if (!btn || !icon || !label) return;

  if (ctx.state.isRealtimeActive) {
    btn.className = 'btn btn-info';
    btn.title = 'Realtime AKTIF — auto refresh tiap 10 detik. Klik untuk matikan.';
    icon.className = 'bi bi-broadcast';
    label.textContent = 'Realtime ON';
    btn.setAttribute('aria-pressed', 'true');
  } else {
    btn.className = 'btn btn-outline-info';
    btn.title = 'Realtime NONAKTIF — klik untuk aktifkan (auto refresh 10 detik)';
    icon.className = 'bi bi-broadcast';
    label.textContent = 'Realtime OFF';
    btn.setAttribute('aria-pressed', 'false');
  }
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    absensiList: [],
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    filterSesi: '',
    filterTanggal: '',
    sortColumn: 'timestamp',
    sortDirection: 'desc',
    currentPage: 1,
    itemsPerPage: 15,
    pendingDeleteId: null,
    lastAbsensiHash: '',
    lastSesiHash: '',
    // ⭐ Realtime state
    isRealtimeActive: false,
    realtimeTimer: null,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'absensi'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[DataAbsensiView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[DataAbsensiView] Re-render error:', e);
      }
    },
  }
);

let tableDelegationCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[DataAbsensiView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[DataAbsensiView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    absensiList: [],
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    filterSesi: '',
    filterTanggal: '',
    sortColumn: 'timestamp',
    sortDirection: 'desc',
    currentPage: 1,
    pendingDeleteId: null,
    lastAbsensiHash: '',
    lastSesiHash: '',
    isRealtimeActive: false,
    realtimeTimer: null,
  });

  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');
  if (filterSesiEl) filterSesiEl.value = '';
  if (filterTanggalEl) filterTanggalEl.value = '';
  if (searchEl) searchEl.value = '';

  // ⭐ Reset voice notifier (skip first scan)
  VoiceNotifier.reset();

  // ⭐ Update UI tombol
  updateVoiceButtonUI();
  updateRealtimeButtonUI();

  // ⚡ Instant render dari preload cache
  const cachedAbsen = AdminModule.getAbsensiList() || [];
  const cachedSesi = AdminModule.getSesiList() || [];

  if (cachedAbsen.length > 0 || cachedSesi.length > 0) {
    console.log('[DataAbsensiView] ⚡ Rendering from preload cache');
    ctx.state.absensiList = cachedAbsen.map(a => ({ ...a }));
    ctx.state.sesiList = cachedSesi.map(s => ({ ...s }));
    ctx.state.lastAbsensiHash = computeListHash(ctx.state.absensiList);
    ctx.state.lastSesiHash = computeListHash(ctx.state.sesiList, ['id', 'nama']);

    // ⭐ Track existing IDs (skip first scan)
    VoiceNotifier.detectNewAbsen(ctx.state.absensiList, true);

    renderSesiFilter();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[DataAbsensiView] ⚠️ No cache, showing skeleton');
    renderSkeleton();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cachedAbsen.length === 0 && cachedSesi.length === 0) {
    await loadData(false);
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[DataAbsensiView] unmounted');

  // ⭐ Stop realtime timer
  stopRealtimeMode();

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REALTIME MODE
// ============================================================
function startRealtimeMode() {
  // Bersihkan timer lama kalau ada
  if (ctx.state.realtimeTimer) {
    clearInterval(ctx.state.realtimeTimer);
    ctx.state.realtimeTimer = null;
  }

  ctx.state.isRealtimeActive = true;

  ctx.state.realtimeTimer = setInterval(async () => {
    if (!ctx.mounted) return;
    if (document.hidden) return; // ⭐ Pause saat tab tidak aktif
    if (ctx.saving) return;

    try {
      console.log('[DataAbsensi] 📡 Realtime polling...');
      await AdminModule.loadAllData(true);
      refreshFromCache();
    } catch (e) {
      console.warn('[DataAbsensi] Realtime poll error:', e.message);
    }
  }, REALTIME_INTERVAL_MS);

  console.log('[DataAbsensi] ▶️ Realtime mode started (interval: 10s)');
}

function stopRealtimeMode() {
  if (ctx.state.realtimeTimer) {
    clearInterval(ctx.state.realtimeTimer);
    ctx.state.realtimeTimer = null;
  }
  ctx.state.isRealtimeActive = false;
  console.log('[DataAbsensi] ⏹️ Realtime mode stopped');
}

function handleToggleRealtime() {
  if (ctx.state.isRealtimeActive) {
    stopRealtimeMode();
    updateRealtimeButtonUI();
    showToast('📡 Realtime mode NONAKTIF', 'info');
  } else {
    startRealtimeMode();
    updateRealtimeButtonUI();
    showToast('📡 Realtime AKTIF — auto refresh tiap 10 detik', 'success');
  }
}

// ============================================================
//   REFRESH FROM CACHE + VOICE NOTIF DETECTION
// ============================================================
function refreshFromCache() {
  const freshAbsen = AdminModule.getAbsensiList() || [];
  const freshSesi = AdminModule.getSesiList() || [];

  const absenHash = computeListHash(freshAbsen);
  const sesiHash = computeListHash(freshSesi, ['id', 'nama']);

  const absenChanged = absenHash !== ctx.state.lastAbsensiHash;
  const sesiChanged = sesiHash !== ctx.state.lastSesiHash;

  if (!absenChanged && !sesiChanged) {
    console.log('[DataAbsensiView] No change, skip re-render');
    return;
  }

  // ⭐ DETEKSI ABSEN BARU — announce via suara
  if (absenChanged) {
    const newAbsen = VoiceNotifier.detectNewAbsen(freshAbsen, false);

    if (newAbsen.length > 0) {
      console.log(`[DataAbsensiView] 🎙️ ${newAbsen.length} absen baru terdeteksi`);

      const sesiLookup = freshSesi;

      // Announce satu per satu (sudah urut by timestamp ASC)
      newAbsen.forEach(item => {
        const nama = String(item.nama || 'Peserta').trim();
        const sesiNama = item.namaSesi || getNamaSesi(item.sesiId, sesiLookup);
        VoiceNotifier.announceAbsen(nama, sesiNama);
      });

      // Show toast visual juga
      if (newAbsen.length === 1) {
        const item = newAbsen[0];
        const sesiNama = item.namaSesi || getNamaSesi(item.sesiId, sesiLookup);
        showToast(`✅ ${item.nama} — ${sesiNama}`, 'success');
      } else {
        showToast(`✅ ${newAbsen.length} absen baru masuk`, 'success');
      }
    }

    ctx.state.absensiList = freshAbsen.map(a => ({ ...a }));
    ctx.state.lastAbsensiHash = absenHash;
  }

  if (sesiChanged) {
    ctx.state.sesiList = freshSesi.map(s => ({ ...s }));
    ctx.state.lastSesiHash = sesiHash;
    renderSesiFilter();
  }

  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');

  // ⭐ Toggle suara
  ctx.on(getEl('toggleVoiceBtn'), 'click', () => {
    if (!VoiceNotifier.isSupported()) {
      showToast('Browser Anda tidak mendukung notifikasi suara', 'warning');
      return;
    }

    const newState = VoiceNotifier.toggle();
    updateVoiceButtonUI();

    if (newState) {
      showToast('🔊 Notifikasi suara AKTIF', 'success');
      setTimeout(() => VoiceNotifier.testVoice(), 400);
    } else {
      showToast('🔇 Notifikasi suara NONAKTIF', 'info');
    }
  });

  // ⭐ Toggle realtime
  ctx.on(getEl('toggleRealtimeBtn'), 'click', handleToggleRealtime);

  // Filter apply
  ctx.on(getEl('applyFilterBtn'), 'click', () => {
    ctx.state.filterSesi = filterSesiEl ? filterSesiEl.value : '';
    ctx.state.filterTanggal = filterTanggalEl ? filterTanggalEl.value : '';
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Filter reset
  ctx.on(getEl('resetFilterBtn'), 'click', () => {
    if (filterSesiEl) filterSesiEl.value = '';
    if (filterTanggalEl) filterTanggalEl.value = '';
    if (searchEl) searchEl.value = '';
    ctx.state.filterSesi = '';
    ctx.state.filterTanggal = '';
    ctx.state.searchQuery = '';
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Search debounced
  ctx.on(searchEl, 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  // Toolbar — Refresh manual
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);

  // Export CSV
  ctx.on(getEl('exportDataBtn'), 'click', exportCSV);

  // Delete confirm
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // ✅ DELEGATION — table
  const container = getEl('absensiTableContainer');
  if (container) {
    tableDelegationCleanup = delegateTableClicks(container, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => handleTableAction(action, id),
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   LOAD DATA (fallback)
// ============================================================
async function loadData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[DataAbsensiView] load error:', e);
    const c = getEl('absensiTableContainer');
    if (c && ctx.state.absensiList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

async function handleRefresh(e) {
  if (ctx.saving) return;
  const btn = e?.currentTarget || getEl('refreshDataBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    console.log('[DataAbsensi] 🔄 Manual refresh...');
    await AdminModule.loadAllData(true);
    refreshFromCache();
    showToast('Data disegarkan', 'success');
    console.log('[DataAbsensi] ✅ Manual refresh complete');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   STATS
// ============================================================
function renderStats() {
  const list = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;
  const total = list.length;

  const pesertaSet = new Set();
  const sesiSet = new Set();
  let todayCount = 0;
  const today = getLocalDateOnly(new Date());

  list.forEach(item => {
    if (item.nama) pesertaSet.add(String(item.nama).trim().toLowerCase());
    if (item.sesiId) sesiSet.add(String(item.sesiId));
    if (getLocalDateOnly(item.timestamp) === today) todayCount++;
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotal', total);
  setText('statPeserta', pesertaSet.size);
  setText('statSesi', sesiSet.size);
  setText('statHariIni', todayCount);
}

// ============================================================
//   DROPDOWN SESI
// ============================================================
function renderSesiFilter() {
  const sel = getEl('filterSesi');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua Sesi</option>';
  ctx.state.sesiList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.nama || ('Sesi ' + s.id);
    if (String(cur) === String(s.id)) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('absensiTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(5).fill(0).map(() =>
        `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = ctx.state.absensiList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.nama || '').toLowerCase().includes(q) ||
      String(item.namaSesi || getNamaSesi(item.sesiId, ctx.state.sesiList) || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.filterSesi !== '') {
    arr = arr.filter(item => String(item.sesiId) === String(ctx.state.filterSesi));
  }

  if (ctx.state.filterTanggal !== '') {
    arr = arr.filter(item => getLocalDateOnly(item.timestamp) === ctx.state.filterTanggal);
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (ctx.state.sortColumn === 'timestamp') {
        va = new Date(a.timestamp || 0).getTime();
        vb = new Date(b.timestamp || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else if (ctx.state.sortColumn === 'namaSesi') {
        va = String(a.namaSesi || getNamaSesi(a.sesiId, ctx.state.sesiList)).toLowerCase();
        vb = String(b.namaSesi || getNamaSesi(b.sesiId, ctx.state.sesiList)).toLowerCase();
      } else {
        va = String(a[ctx.state.sortColumn] || '').toLowerCase();
        vb = String(b[ctx.state.sortColumn] || '').toLowerCase();
      }
      if (va < vb) return ctx.state.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return ctx.state.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  return arr;
}

function applyFiltersAndSort() {
  ctx.state.filteredList = getFiltered();
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;
  renderTable();
  renderStats();
}

// ============================================================
//   RENDER: TABLE
// ============================================================
function renderTable() {
  const c = getEl('absensiTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  const totalItems = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filteredList.slice(start, end);

  const arrow = (col) => {
    if (ctx.state.sortColumn !== col) return '↕';
    return ctx.state.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-bordered table-hover table-sm align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th style="cursor:pointer;" data-sort="nama" role="button" tabindex="0">Nama Peserta ${arrow('nama')}</th>
      <th style="cursor:pointer;" data-sort="namaSesi" role="button" tabindex="0">Sesi ${arrow('namaSesi')}</th>
      <th style="cursor:pointer;" data-sort="timestamp" role="button" tabindex="0">Waktu Absen ${arrow('timestamp')}</th>
      <th style="width:130px;" class="text-center">Tanda Tangan</th>
      <th style="width:110px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.filterSesi || ctx.state.filterTanggal || ctx.state.searchQuery;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data absensi${hasFilter ? ' untuk filter ini' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const namaSesi = item.namaSesi || getNamaSesi(item.sesiId, ctx.state.sesiList);
      const safeId = escapeHtml(String(item.id || ''));
      const ttd = item.signatureDriveId
        ? `<a href="https://drive.google.com/file/d/${escapeHtml(item.signatureDriveId)}/view"
             target="_blank" rel="noopener noreferrer"
             class="btn btn-sm btn-outline-primary"
             aria-label="Lihat tanda tangan ${escapeHtml(item.nama || '')}">
             <i class="bi bi-eye" aria-hidden="true"></i> Lihat
           </a>`
        : '<span class="text-muted small">-</span>';

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td><small>${escapeHtml(namaSesi)}</small></td>
        <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
        <td class="text-center">${ttd}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1"
                  data-action="detail" data-id="${safeId}"
                  title="Detail" aria-label="Lihat detail">
            <i class="bi bi-info-circle" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger"
                  data-action="delete" data-id="${safeId}"
                  title="Hapus" aria-label="Hapus data">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">Menampilkan ${pageData.length > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data</div>
    <div class="btn-group">`;

  const maxButtons = 7;
  let startPage = Math.max(1, ctx.state.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) {
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="1">1</button>`;
    if (startPage > 2) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button type="button" class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  restoreFocusState('searchInput', savedFocus);
}

// ============================================================
//   SORT & PAGINATION
// ============================================================
function handleSort(col) {
  if (ctx.state.sortColumn === col) {
    ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    ctx.state.sortColumn = col;
    ctx.state.sortDirection = 'asc';
  }
  ctx.state.currentPage = 1;
  applyFiltersAndSort();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderTable();
  getEl('absensiTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   TABLE ACTION ROUTER
// ============================================================
function handleTableAction(action, id) {
  if (action === 'detail') viewAbsensiDetail(id);
  else if (action === 'delete') confirmDeleteAbsensi(id);
}

// ============================================================
//   DETAIL
// ============================================================
function viewAbsensiDetail(id) {
  const item = ctx.state.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const namaSesi = item.namaSesi || getNamaSesi(item.sesiId, ctx.state.sesiList);
  const ttdLink = item.signatureDriveId
    ? `<a href="https://drive.google.com/file/d/${escapeHtml(item.signatureDriveId)}/view"
         target="_blank" rel="noopener noreferrer"
         class="btn btn-sm btn-outline-primary">
         <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> Buka TTD
       </a>`
    : '<span class="text-muted">Tidak ada tanda tangan</span>';

  const content = getEl('detailAbsensiContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama Peserta:</strong><br>${escapeHtml(item.nama || '-')}</div>
      <div class="list-group-item py-3"><strong>ID Peserta:</strong> <code>${escapeHtml(String(item.pesertaId || '-'))}</code></div>
      <div class="list-group-item py-3"><strong>Sesi:</strong> ${escapeHtml(namaSesi)} <small class="text-muted">(ID: ${escapeHtml(String(item.sesiId || '-'))})</small></div>
      <div class="list-group-item py-3"><strong>Waktu Absen:</strong> ${escapeHtml(formatDateTimeID(item.timestamp))}</div>
      <div class="list-group-item py-3"><strong>ID Drive TTD:</strong><br><code class="small" style="word-break:break-all;">${escapeHtml(String(item.signatureDriveId || '-'))}</code></div>
      <div class="list-group-item py-3"><strong>Tanda Tangan:</strong><br>${ttdLink}</div>
    </div>`;

  ctx.getModal('detailAbsensiModal')?.show();
}

// ============================================================
//   DELETE
// ============================================================
function confirmDeleteAbsensi(id) {
  const item = ctx.state.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }
  ctx.state.pendingDeleteId = id;
  const idEl = getEl('deleteAbsensiId');
  if (idEl) idEl.value = id;
  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const id = getEl('deleteAbsensiId')?.value || ctx.state.pendingDeleteId;
  if (!id) return;

  const item = ctx.state.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const btn = e?.currentTarget || getEl('confirmDeleteBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const payload = {
      id: id,
      _rowIndex: item._rowIndex || undefined,
      nama: item.nama || undefined,
      sesiId: item.sesiId || undefined,
      pesertaId: item.pesertaId || undefined,
    };

    const { deleteAbsensi } = await import('../../js/core/api.js');
    const res = await deleteAbsensi(payload);

    if (res && res.success) {
      showToast('Data absensi berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      await AdminModule.loadAllData(true);
      refreshFromCache();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus di server');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteId = null;
  }
}

// ============================================================
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const headers = ['No', 'Nama Peserta', 'ID Peserta', 'Sesi', 'ID Sesi', 'Waktu Absen', 'Drive TTD'];
  const rows = data.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId, ctx.state.sesiList);
    return [
      i + 1,
      item.nama || '',
      item.pesertaId || '',
      namaSesi,
      item.sesiId || '',
      formatDateTimeID(item.timestamp),
      item.signatureDriveId || '',
    ];
  });

  const fileName = `data_absensi_${getLocalDateOnly(new Date())}.csv`;
  if (downloadCSV(rows, headers, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Data Absensi View v28.2.0 — Full Fix + Realtime Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
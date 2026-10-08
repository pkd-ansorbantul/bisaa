// ============================================================
// VIEW: sesi-absen.js — v27.2.0 PRELOAD + SUBSCRIPTION
// Dimuat oleh: js/router.js
// HTML: views/admin/sesi-absen.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 60s
//   ✅ FIX: Normalize submission_open konsisten (string|boolean)
//   ✅ FIX: QR canvas cleanup via ctx.cleanup
//   ✅ FIX: Modal dispose otomatis (zero leak)
//   ✅ FIX: Null-safe semua element access
//   ✅ FIX: Focus preservation saat re-render
//   ✅ FIX: Attendance modal — better error handling
//   ✅ KEEP: Toggle status, QR generation, regenerate token
//   ✅ Zero memory leak
// ============================================================

import {
  showToast,
  escapeHtml,
  callApi,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
import { AdminModule } from '../../js/modules/admin.js';
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

function formatDateTime(dateStr) {
  if (!dateStr || dateStr === '') return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(dateStr); }
}

function normalizeSesiList(freshData) {
  return (freshData || []).map(item => {
    let isOpen = false;
    const v = item.submission_open;
    if (typeof v === 'boolean') isOpen = v;
    else if (typeof v === 'string') isOpen = v.trim().toLowerCase() === 'true';

    // Fallback ke legacy field `aktif`
    if (!isOpen && item.aktif !== undefined && item.aktif !== null) {
      if (typeof item.aktif === 'boolean') isOpen = item.aktif;
      else if (typeof item.aktif === 'string') isOpen = item.aktif.trim().toLowerCase() === 'true';
    }
    return { ...item, submission_open: isOpen };
  });
}

function generateQrToken() {
  return 'qr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    currentPage: 1,
    itemsPerPage: 15,
    sortColumn: null,
    sortDirection: 'asc',
    pendingDeleteId: null,
    qrCanvasRef: null,
    lastHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'sesi'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[SesiAbsenView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[SesiAbsenView] Re-render error:', e);
      }
    },
  }
);

let tableCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[SesiAbsenView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[SesiAbsenView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    currentPage: 1,
    sortColumn: null,
    sortDirection: 'asc',
    pendingDeleteId: null,
    qrCanvasRef: null,
    lastHash: '',
  });

  const searchEl = getEl('searchInput');
  if (searchEl) searchEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getSesiList() || [];
  if (cached.length > 0) {
    console.log('[SesiAbsenView] ⚡ Rendering from preload cache');
    ctx.state.sesiList = normalizeSesiList(cached);
    ctx.state.lastHash = computeListHash(ctx.state.sesiList);
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[SesiAbsenView] ⚠️ No cache, showing skeleton');
    renderSkeleton();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cached.length === 0) {
    await loadSesiAbsen(false);
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[SesiAbsenView] unmounted');

  if (tableCleanup) {
    try { tableCleanup(); } catch (e) { /* silent */ }
    tableCleanup = null;
  }

  ctx.state.qrCanvasRef = null;
  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = AdminModule.getSesiList() || [];
  const cleaned = normalizeSesiList(fresh);
  const freshHash = computeListHash(cleaned);

  if (freshHash === ctx.state.lastHash) {
    console.log('[SesiAbsenView] No change, skip re-render');
    return;
  }

  ctx.state.sesiList = cleaned;
  ctx.state.lastHash = freshHash;
  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  // Toolbar
  ctx.on(getEl('addSesiAbsenBtn'), 'click', openAddModal);
  ctx.on(getEl('exportDataBtn'), 'click', exportData);
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefreshClick);
  ctx.on(getEl('saveSesiAbsenBtn'), 'click', saveSesiAbsen);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);
  ctx.on(getEl('downloadQRSesiBtn'), 'click', downloadQrPng);

  // Password visibility toggle (delegation)
  ctx.on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });

  // QR modal cleanup
  const qrModalEl = getEl('qrSesiModal');
  if (qrModalEl) {
    ctx.on(qrModalEl, 'hidden.bs.modal', () => {
      ctx.state.qrCanvasRef = null;
      const container = getEl('qrSesiCanvasContainer');
      if (container) container.innerHTML = '';
      const dataText = getEl('qrSesiDataText');
      if (dataText) dataText.innerHTML = '';
    });
  }

  // ✅ DELEGATION — table
  const tableContainer = getEl('sesiAbsenTableContainer');
  if (tableContainer) {
    tableCleanup = delegateTableClicks(tableContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => handleTableAction(action, id),
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefreshClick(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  ctx.saving = true;

  try {
    await AdminModule.loadAllData(true);
    refreshFromCache();
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   LOAD (fallback)
// ============================================================
async function loadSesiAbsen(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[SesiAbsenView] load error:', e);
    if (ctx.state.sesiList.length > 0) {
      applyFiltersAndSort();
      showToast('Error: ' + e.message + ' — menampilkan data lama', 'warning');
    } else {
      const c = getEl('sesiAbsenTableContainer');
      if (c) {
        c.innerHTML = `<div class="alert alert-danger text-center">
          Gagal memuat data: ${escapeHtml(e.message)}
        </div>`;
      }
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('sesiAbsenTableContainer');
  if (!c) return;

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>`;
  for (let i = 0; i < 7; i++) {
    html += `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`;
  }
  html += `</tr></thead><tbody>`;
  for (let r = 0; r < 5; r++) {
    html += '<tr>';
    for (let i = 0; i < 7; i++) {
      html += `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`;
    }
    html += '</tr>';
  }
  html += `</tbody></table></div>`;
  c.innerHTML = html;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function applyFiltersAndSort() {
  let filtered = ctx.state.sesiList.slice();

  // Filter search
  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama || '').toLowerCase().includes(q)
    );
  }

  // Sort
  if (ctx.state.sortColumn) {
    const col = ctx.state.sortColumn;
    const dir = ctx.state.sortDirection === 'asc' ? 1 : -1;

    filtered.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (typeof va === 'boolean') va = va ? 1 : 0;
      if (typeof vb === 'boolean') vb = vb ? 1 : 0;

      va = (va ?? '').toString().toLowerCase();
      vb = (vb ?? '').toString().toLowerCase();

      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  ctx.state.filteredList = filtered;

  // Preserve current page
  const totalPages = Math.max(1, Math.ceil(filtered.length / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  renderTable();
}

// ============================================================
//   RENDER: TABLE
// ============================================================
function renderTable() {
  const c = getEl('sesiAbsenTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  const totalItems = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filteredList.slice(start, end);

  const arrow = (col) => {
    if (ctx.state.sortColumn !== col) return '↕';
    return ctx.state.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th data-sort="nama" style="cursor:pointer;">Nama Sesi ${arrow('nama')}</th>
      <th data-sort="waktu_mulai" style="cursor:pointer;">Waktu Mulai ${arrow('waktu_mulai')}</th>
      <th data-sort="waktu_selesai" style="cursor:pointer;">Waktu Selesai ${arrow('waktu_selesai')}</th>
      <th data-sort="submission_open" style="cursor:pointer;">Status ${arrow('submission_open')}</th>
      <th style="width:180px;">QR Sesi</th>
      <th style="width:290px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery;
    html += `<tr><td colspan="7" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      ${hasFilter ? 'Tidak ada hasil pencarian.' : 'Tidak ada data sesi absen.'}
    </td></tr>`;
  } else {
    pageData.forEach((item, index) => {
      const globalIdx = start + index + 1;
      const isOpen = item.submission_open === true;
      const statusBadge = isOpen ? 'bg-success' : 'bg-danger';
      const statusLabel = isOpen ? 'Buka' : 'Tutup';
      const safeId = escapeHtml(String(item.id));

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td>${escapeHtml(formatDateTime(item.waktu_mulai))}</td>
        <td>${escapeHtml(formatDateTime(item.waktu_selesai))}</td>
        <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td>
          <button class="btn btn-sm btn-outline-dark" data-action="qr" data-id="${safeId}" title="Tampilkan QR" aria-label="Tampilkan QR">
            <i class="bi bi-qr-code" aria-hidden="true"></i> QR
          </button>
          <button class="btn btn-sm btn-outline-secondary ms-1" data-action="regen" data-id="${safeId}" title="Regenerate Token" aria-label="Regenerate Token">
            <i class="bi bi-arrow-repeat" aria-hidden="true"></i> Regenerate
          </button>
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info" data-action="view" data-id="${safeId}" title="Detail" aria-label="Detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning ms-1" data-action="edit" data-id="${safeId}" title="Edit" aria-label="Edit">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button class="btn btn-sm btn-outline-success ms-1" data-action="attendance" data-id="${safeId}" title="Daftar Hadir" aria-label="Daftar Hadir">
            <i class="bi bi-people" aria-hidden="true"></i>
          </button>
          <button class="btn btn-sm btn-outline-${isOpen ? 'warning' : 'success'} ms-1" data-action="toggle" data-id="${safeId}" title="Toggle Status" aria-label="Toggle Status">
            ${isOpen ? 'Tutup' : 'Buka'}
          </button>
          <button class="btn btn-sm btn-outline-danger ms-1" data-action="delete" data-id="${safeId}" title="Hapus" aria-label="Hapus">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  // Pagination
  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">
      Menampilkan ${pageData.length > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data
    </div>
    <div class="btn-group">`;

  const maxButtons = 7;
  let startPage = Math.max(1, ctx.state.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="1">1</button>`;
    if (startPage > 2) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    }
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
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
  getEl('sesiAbsenTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   TABLE ACTION ROUTER
// ============================================================
function handleTableAction(action, id) {
  switch (action) {
    case 'qr':          return generateQRSesi(id);
    case 'regen':       return regenerateQRSesi(id);
    case 'view':        return viewSesiAbsen(id);
    case 'edit':        return editSesiAbsen(id);
    case 'attendance':  return viewAttendance(id);
    case 'toggle':      return toggleSesi(id);
    case 'delete':      return deleteSesiAbsen(id);
    default:
      console.warn('[SesiAbsenView] Unknown action:', action);
  }
}

// ============================================================
//   CRUD
// ============================================================
function openAddModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editSesiAbsenId', '');
  setVal('sesiNama', '');
  setVal('sesiWaktuMulai', '');
  setVal('sesiWaktuSelesai', '');
  setVal('sesiPassword', '');

  const aktifEl = getEl('sesiAktif');
  if (aktifEl) aktifEl.checked = true;

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Tambah Sesi Absen';

  ctx.getModal('sesiAbsenFormModal')?.show();
}

function editSesiAbsen(id) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const toLocal = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editSesiAbsenId', id);
  setVal('sesiNama', item.nama || '');
  setVal('sesiWaktuMulai', toLocal(item.waktu_mulai));
  setVal('sesiWaktuSelesai', toLocal(item.waktu_selesai));
  setVal('sesiPassword', '');

  const aktifEl = getEl('sesiAktif');
  if (aktifEl) aktifEl.checked = item.submission_open === true;

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Sesi Absen';

  ctx.getModal('sesiAbsenFormModal')?.show();
}

function viewSesiAbsen(id) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const hasPassword = !!(item.passwordHash && String(item.passwordHash).trim() !== '');
  const content = getEl('detailContent');
  if (!content) return;

  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama Sesi:</strong> ${escapeHtml(item.nama || '-')}</div>
      <div class="list-group-item py-3"><strong>Waktu Mulai:</strong> ${escapeHtml(formatDateTime(item.waktu_mulai))}</div>
      <div class="list-group-item py-3"><strong>Waktu Selesai:</strong> ${escapeHtml(formatDateTime(item.waktu_selesai))}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> ${item.submission_open ? '✅ Buka' : '❌ Tutup'}</div>
      <div class="list-group-item py-3"><strong>Password:</strong> ${hasPassword ? '🔒 Terproteksi' : '🔓 Tanpa password'}</div>
      <div class="list-group-item py-3"><strong>Token QR:</strong> <code style="word-break:break-all; font-size:0.8rem;">${escapeHtml(item.qrToken || 'Belum ada')}</code></div>
    </div>`;

  ctx.getModal('detailSesiAbsenModal')?.show();
}

function deleteSesiAbsen(id) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  ctx.state.pendingDeleteId = id;

  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = item.nama || '—';

  const idEl = getEl('deleteSesiAbsenId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('confirmDeleteBtn');
  const id = ctx.state.pendingDeleteId || getEl('deleteSesiAbsenId')?.value;
  if (!id) return;

  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;

  try {
    const res = await AdminModule.deleteSesiAbsen(id);
    if (res && res.success) {
      showToast('Sesi absen berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteId = null;
  }
}

async function saveSesiAbsen(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('saveSesiAbsenBtn');
  const id = getEl('editSesiAbsenId')?.value || '';
  const nama = getEl('sesiNama')?.value.trim() || '';
  const waktuMulai = getEl('sesiWaktuMulai')?.value || '';
  const waktuSelesai = getEl('sesiWaktuSelesai')?.value || '';
  const password = getEl('sesiPassword')?.value || '';
  const aktif = getEl('sesiAktif')?.checked ?? true;

  if (!nama) {
    showToast('Nama sesi wajib diisi', 'error');
    getEl('sesiNama')?.focus();
    return;
  }

  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.saving = true;

  try {
    let res;
    if (id) {
      res = await AdminModule.updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password);
    } else {
      res = await AdminModule.addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password);
    }

    if (res && res.success) {
      showToast(id ? 'Sesi berhasil diperbarui' : 'Sesi berhasil ditambahkan', 'success');
      ctx.getModal('sesiAbsenFormModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

async function toggleSesi(id) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const newState = !(item.submission_open === true);
  if (!confirm(`Ubah status sesi "${item.nama}" menjadi ${newState ? 'BUKA' : 'TUTUP'}?`)) return;

  try {
    const res = await AdminModule.toggleAttendanceSession(id, newState);
    if (res && res.success) {
      showToast(`Sesi ${newState ? 'dibuka' : 'ditutup'}`, 'success');
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah status');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   QR GENERATION
// ============================================================
async function generateQRSesi(sesiId) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  // Ensure qrToken
  if (!item.qrToken) {
    try {
      const res = await AdminModule.regenerateQRSesi(sesiId);
      if (res && res.success) item.qrToken = res.qrToken;
      else item.qrToken = generateQrToken();
    } catch {
      item.qrToken = generateQrToken();
    }
  }

  if (typeof qrcode !== 'function') {
    showToast('Library QR tidak tersedia', 'error');
    return;
  }

  try {
    const absenUrl = `${window.location.origin}${BASE_PATH}absen.html?sesi_id=${encodeURIComponent(sesiId)}&token=${encodeURIComponent(item.qrToken)}`;
    const qr = qrcode(0, 'M');
    qr.addData(absenUrl);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = 8;
    const margin = 16;
    const size = moduleCount * cellSize + margin * 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c2d = canvas.getContext('2d');

    c2d.fillStyle = '#ffffff';
    c2d.fillRect(0, 0, size, size);

    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          c2d.fillStyle = '#000000';
          c2d.fillRect(
            margin + col * cellSize,
            margin + row * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }

    const container = getEl('qrSesiCanvasContainer');
    if (!container) return;
    container.innerHTML = '';

    canvas.style.border = '2px solid #e2e8f0';
    canvas.style.borderRadius = '16px';
    canvas.style.padding = '12px';
    canvas.style.background = 'white';
    canvas.style.maxWidth = '280px';
    container.appendChild(canvas);
    ctx.state.qrCanvasRef = canvas;

    const dataText = getEl('qrSesiDataText');
    if (dataText) {
      dataText.innerHTML = `
        <strong>Sesi:</strong> ${escapeHtml(item.nama)}<br>
        <strong>ID Sesi:</strong> ${escapeHtml(String(sesiId))}<br>
        <span class="text-success">✨ Scan QR ini untuk absen tanpa password</span><br>
        <span class="text-muted small">Token: <code>${escapeHtml(item.qrToken)}</code></span>
      `;
    }

    ctx.getModal('qrSesiModal')?.show();
  } catch (e) {
    showToast('Gagal generate QR: ' + e.message, 'error');
  }
}

async function regenerateQRSesi(sesiId) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (!confirm(`Regenerate QR untuk sesi "${item.nama}"? QR lama tidak akan berlaku lagi.`)) return;

  try {
    const res = await AdminModule.regenerateQRSesi(sesiId);
    if (res && res.success) {
      item.qrToken = res.qrToken;
      showToast('QR berhasil diregenerasi', 'success');
    } else {
      throw new Error((res && res.error) || 'Gagal regenerate');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

function downloadQrPng() {
  const canvas = ctx.state.qrCanvasRef;
  if (!canvas) {
    showToast('QR belum tersedia', 'warning');
    return;
  }
  try {
    const link = document.createElement('a');
    link.download = `QR_Sesi_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('QR berhasil diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh QR', 'error');
  }
}

// ============================================================
//   ATTENDANCE LIST
// ============================================================
async function viewAttendance(sesiId) {
  const item = ctx.state.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const label = getEl('attendanceModalLabel');
  if (label) {
    label.innerHTML = `<i class="bi bi-people me-2" aria-hidden="true"></i>Daftar Hadir — ${escapeHtml(item.nama)}`;
  }

  const body = getEl('attendanceModalBody');
  if (body) {
    body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`;
  }

  ctx.getModal('attendanceModal')?.show();

  try {
    const res = await callApi('getAttendanceBySesi', { sesiId }, 'GET');
    const attendees = (res && res.success && Array.isArray(res.data)) ? res.data : [];

    const bodyEl = getEl('attendanceModalBody');
    if (!bodyEl) return;

    if (attendees.length === 0) {
      bodyEl.innerHTML = `<div class="alert alert-info text-center mb-0">
        <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
        Belum ada peserta yang hadir di sesi ini.
      </div>`;
      return;
    }

    let html = `<div class="mb-2 small text-muted">Total <strong>${attendees.length}</strong> peserta hadir</div>
      <div class="list-group">`;

    attendees.forEach((a, i) => {
      const ts = a.timestamp ? new Date(a.timestamp).toLocaleString('id-ID') : '-';
      const sig = a.signatureDriveId
        ? `<a href="https://drive.google.com/file/d/${escapeHtml(a.signatureDriveId)}/view"
              target="_blank" rel="noopener noreferrer"
              class="btn btn-sm btn-outline-primary" aria-label="Lihat TTD">
              <i class="bi bi-eye" aria-hidden="true"></i> TTD
            </a>`
        : '';

      html += `<div class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${i + 1}. ${escapeHtml(a.nama || '-')}</strong>
          ${a.pesertaId ? `<span class="badge bg-secondary ms-2">ID: ${escapeHtml(String(a.pesertaId))}</span>` : ''}
          <div class="small text-muted mt-1"><i class="bi bi-clock me-1" aria-hidden="true"></i>${escapeHtml(ts)}</div>
        </div>
        ${sig}
      </div>`;
    });
    html += `</div>`;
    bodyEl.innerHTML = html;
  } catch (e) {
    const bodyEl = getEl('attendanceModalBody');
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="alert alert-danger mb-0">Gagal memuat: ${escapeHtml(e.message)}</div>`;
    }
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = ctx.state.filteredList.length > 0 ? ctx.state.filteredList : ctx.state.sesiList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const exportArr = data.map(item => ({
    id: item.id,
    nama: item.nama,
    waktu_mulai: item.waktu_mulai,
    waktu_selesai: item.waktu_selesai,
    aktif: item.submission_open,
    qrToken: item.qrToken,
  }));

  try {
    const json = JSON.stringify(exportArr, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sesi_absen_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Sesi Absen View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
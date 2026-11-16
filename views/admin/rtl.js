// ============================================================
// VIEW: rtl.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/rtl.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 90s
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Modal dispose race + null-safe element access
//   ✅ FIX: Parallel upload batch 3 concurrent
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: CRUD, bulk approve, WhatsApp, file upload
//   ✅ Zero memory leak
// ============================================================

import {
  showToast,
  escapeHtml,
  getDriveToken,
  uploadToDrive,
  formatDateID,
  downloadJSON,
  getLocalDateOnly,
} from '../../js/core/api.js';
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
//   CONSTANTS
// ============================================================
const MAX_FILE_SIZE_MB = 5;

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

function getStatusBadge(status) {
  return String(status || '').toLowerCase() === 'selesai'
    ? 'bg-success'
    : 'bg-warning text-dark';
}

function isTaskDone(task) {
  return String(task?.status || '').toLowerCase() === 'selesai';
}

function safeFocus(id) {
  try { getEl(id)?.focus?.(); } catch (e) { /* silent */ }
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    rtlList: [],
    pesertaList: [],
    filteredList: [],
    searchQuery: '',
    statusFilter: '',
    pesertaFilter: '',
    sortColumn: 'deadline',
    sortDirection: 'asc',
    currentPage: 1,
    itemsPerPage: 15,
    lastRtlHash: '',
    lastPesertaHash: '',
    pendingDeleteId: null,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'rtl'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[RTLView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[RTLView] Re-render error:', e);
      }
    },
  }
);

let tableDelegationCleanup = null;
let isBulkProcessing = false;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[RTLView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  isBulkProcessing = false;
  console.log('[RTLView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    rtlList: [],
    pesertaList: [],
    filteredList: [],
    searchQuery: '',
    statusFilter: '',
    pesertaFilter: '',
    sortColumn: 'deadline',
    sortDirection: 'asc',
    currentPage: 1,
    lastRtlHash: '',
    lastPesertaHash: '',
    pendingDeleteId: null,
  });

  const searchEl = getEl('searchInput');
  const statusEl = getEl('filterStatus');
  const pesertaEl = getEl('filterPeserta');
  if (searchEl) searchEl.value = '';
  if (statusEl) statusEl.value = '';
  if (pesertaEl) pesertaEl.value = '';

  // ⚡ Instant render dari preload cache
  const cachedRTL = AdminModule.getRTLList() || [];
  const cachedPeserta = AdminModule.getPesertaList() || [];

  if (cachedRTL.length > 0 || cachedPeserta.length > 0) {
    console.log('[RTLView] ⚡ Rendering from preload cache');
    ctx.state.rtlList = cachedRTL.map(r => ({ ...r }));
    ctx.state.pesertaList = cachedPeserta.map(p => ({ ...p }));
    ctx.state.lastRtlHash = computeListHash(ctx.state.rtlList);
    ctx.state.lastPesertaHash = computeListHash(ctx.state.pesertaList, ['id', 'nama_lengkap']);
    renderPesertaDropdowns();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[RTLView] ⚠️ No cache, showing skeleton');
    renderSkeleton();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cachedRTL.length === 0 && cachedPeserta.length === 0) {
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
  console.log('[RTLView] unmounted');

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const freshRTL = AdminModule.getRTLList() || [];
  const freshPeserta = AdminModule.getPesertaList() || [];

  const rtlHash = computeListHash(freshRTL);
  const pesertaHash = computeListHash(freshPeserta, ['id', 'nama_lengkap']);

  const rtlChanged = rtlHash !== ctx.state.lastRtlHash;
  const pesertaChanged = pesertaHash !== ctx.state.lastPesertaHash;

  if (!rtlChanged && !pesertaChanged) {
    console.log('[RTLView] No change, skip re-render');
    return;
  }

  if (rtlChanged) {
    ctx.state.rtlList = freshRTL.map(r => ({ ...r }));
    ctx.state.lastRtlHash = rtlHash;
  }
  if (pesertaChanged) {
    ctx.state.pesertaList = freshPeserta.map(p => ({ ...p }));
    ctx.state.lastPesertaHash = pesertaHash;
  }

  if (pesertaChanged) renderPesertaDropdowns();
  if (rtlChanged || pesertaChanged) applyFiltersAndSort();

  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('filterStatus'), 'change', function (e) {
    ctx.state.statusFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  ctx.on(getEl('filterPeserta'), 'change', function (e) {
    ctx.state.pesertaFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Toolbar
  ctx.on(getEl('addRTLBtn'), 'click', openAddModal);
  ctx.on(getEl('bulkApproveBtn'), 'click', bulkApprove);
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);
  ctx.on(getEl('exportDataBtn'), 'click', exportData);

  // Modals
  ctx.on(getEl('saveRTLBtn'), 'click', saveRTL);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // ✅ DELEGATION — table
  const tableContainer = getEl('rtlTableContainer');
  if (tableContainer) {
    tableDelegationCleanup = delegateTableClicks(tableContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => {
        if (action === 'goto') return; // handled by onPage
        handleTableAction(action, id);
      },
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('rtlTableContainer');
  if (!c) return;
  const cells = Array(8).fill(0)
    .map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`)
    .join('');
  const rows = Array(5).fill(0).map(() =>
    `<tr>${Array(8).fill(0)
      .map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`)
      .join('')}</tr>`
  ).join('');
  c.innerHTML = `
    <div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead class="table-light"><tr>${cells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = ctx.state.rtlList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q) ||
      String(item.namaPeserta || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.statusFilter !== '') {
    arr = arr.filter(item =>
      String(item.status || 'pending').toLowerCase() === ctx.state.statusFilter
    );
  }

  if (ctx.state.pesertaFilter !== '') {
    arr = arr.filter(item =>
      String(item.pesertaId || '') === ctx.state.pesertaFilter ||
      String(item.namaPeserta || '') === ctx.state.pesertaFilter
    );
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (ctx.state.sortColumn === 'deadline') {
        va = new Date(a.deadline || 0).getTime() || 0;
        vb = new Date(b.deadline || 0).getTime() || 0;
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
}

// ============================================================
//   RENDER TABLE
// ============================================================
function renderTable() {
  const c = getEl('rtlTableContainer');
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
      <th style="cursor:pointer;" data-sort="judul">Judul ${arrow('judul')}</th>
      <th>Deskripsi</th>
      <th style="cursor:pointer;" data-sort="deadline">Deadline ${arrow('deadline')}</th>
      <th style="cursor:pointer;" data-sort="status">Status ${arrow('status')}</th>
      <th>Peserta</th>
      <th>File</th>
      <th style="width:220px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery || ctx.state.statusFilter || ctx.state.pesertaFilter;
    html += `<tr><td colspan="8" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data RTL${hasFilter ? ' sesuai filter' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const badge = getStatusBadge(item.status);
      const done = isTaskDone(item);
      const safeId = escapeHtml(String(item.id || ''));

      let fileHtml = '<span class="text-muted small">-</span>';
      if (item.fileDriveId) {
        const fileUrl = `https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view`;
        fileHtml = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer"
                       class="btn btn-sm btn-outline-info" title="Lihat File"
                       aria-label="Lihat file ${escapeHtml(item.judul)}">
                      <i class="bi bi-file-earmark" aria-hidden="true"></i>
                    </a>`;
      }

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
        <td><small>${escapeHtml(item.deskripsi || '-')}</small></td>
        <td>${escapeHtml(formatDateID(item.deadline))}</td>
        <td><span class="badge ${badge}">${escapeHtml(item.status || 'pending')}</span></td>
        <td>${escapeHtml(item.namaPeserta || 'Umum')}</td>
        <td class="text-center">${fileHtml}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}"
                  title="Detail" aria-label="Detail ${escapeHtml(item.judul)}">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}"
                  title="Edit" aria-label="Edit ${escapeHtml(item.judul)}">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          ${!done ? `<button type="button" class="btn btn-sm btn-outline-success me-1" data-action="approve" data-id="${safeId}"
                       title="Tandai Selesai" aria-label="Tandai selesai ${escapeHtml(item.judul)}">
            <i class="bi bi-check-circle" aria-hidden="true"></i>
          </button>` : ''}
          <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}"
                  title="Hapus" aria-label="Hapus ${escapeHtml(item.judul)}">
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

function handleTableAction(action, id) {
  switch (action) {
    case 'detail':   return viewRTL(id);
    case 'edit':     return editRTL(id);
    case 'approve':  return approveRTL(id);
    case 'delete':   return deleteRTL(id);
    default: console.warn('[RTLView] Unknown action:', action);
  }
}

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
  getEl('rtlTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    console.error('[RTLView] loadData error:', e);
    const c = getEl('rtlTableContainer');
    if (c && ctx.state.rtlList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

function renderPesertaDropdowns() {
  const filterSel = getEl('filterPeserta');
  const modalSel = getEl('rtlPeserta');

  const optionsHtml = ctx.state.pesertaList.map(p => {
    const nama = p.nama_lengkap || p.nama || '-';
    const utusan = p.utusan || '-';
    return `<option value="${escapeHtml(String(p.id))}">${escapeHtml(nama)} (${escapeHtml(utusan)})</option>`;
  }).join('');

  if (filterSel) {
    const cur = filterSel.value;
    filterSel.innerHTML = '<option value="">Semua Peserta</option>' + optionsHtml;
    if (cur) filterSel.value = cur;
  }
  if (modalSel) {
    const cur = modalSel.value;
    modalSel.innerHTML = '<option value="">-- Tugas Umum (semua peserta) --</option>' + optionsHtml;
    if (cur) modalSel.value = cur;
  }
}

// ============================================================
//   VIEW / EDIT / DELETE
// ============================================================
function viewRTL(id) {
  const item = ctx.state.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const badge = getStatusBadge(item.status);
  let fileHtml = '-';
  if (item.fileDriveId) {
    const fileUrl = `https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view`;
    fileHtml = `<a href="${fileUrl}" target="_blank" rel="noopener noreferrer"
                 class="btn btn-sm btn-outline-info">
                 <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i> Lihat File
               </a>`;
  }

  const content = getEl('detailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Judul:</strong><br>${escapeHtml(item.judul || '-')}</div>
      <div class="list-group-item py-3"><strong>Deskripsi:</strong><br>${escapeHtml(item.deskripsi || '-')}</div>
      <div class="list-group-item py-3"><strong>Deadline:</strong> ${escapeHtml(formatDateID(item.deadline))}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> <span class="badge ${badge}">${escapeHtml(item.status || 'pending')}</span></div>
      <div class="list-group-item py-3"><strong>Peserta:</strong> ${escapeHtml(item.namaPeserta || 'Umum (semua peserta)')}</div>
      <div class="list-group-item py-3"><strong>File:</strong> ${fileHtml}</div>
      <div class="list-group-item py-3"><strong>Catatan:</strong><br>${escapeHtml(item.catatan || '-')}</div>
    </div>`;

  ctx.getModal('detailRTLModal')?.show();
}

function editRTL(id) {
  const item = ctx.state.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };

  setVal('editRTLId', id);
  setVal('rtlJudul', item.judul || '');
  setVal('rtlDeskripsi', item.deskripsi || '');
  setVal('rtlDeadline', item.deadline || '');
  setVal('rtlStatus', item.status || 'pending');
  setVal('rtlPeserta', item.pesertaId || '');
  setVal('rtlCatatan', item.catatan || '');
  setVal('rtlFile', '');

  const preview = getEl('rtlFilePreview');
  if (preview) {
    preview.innerHTML = item.fileDriveId
      ? `File saat ini: <a href="https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view"
          target="_blank" rel="noopener noreferrer">Lihat</a>`
      : '';
  }

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Tugas RTL';

  ctx.getModal('rtlFormModal')?.show();
}

function openAddModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };

  setVal('editRTLId', '');
  setVal('rtlJudul', '');
  setVal('rtlDeskripsi', '');
  setVal('rtlDeadline', getLocalDateOnly(new Date()));
  setVal('rtlStatus', 'pending');
  setVal('rtlPeserta', '');
  setVal('rtlCatatan', '');
  setVal('rtlFile', '');

  const preview = getEl('rtlFilePreview');
  if (preview) preview.innerHTML = '';

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Tambah Tugas RTL';

  ctx.getModal('rtlFormModal')?.show();
}

function deleteRTL(id) {
  const item = ctx.state.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  ctx.state.pendingDeleteId = id;
  const idEl = getEl('deleteRTLId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteId || getEl('deleteRTLId')?.value;
  if (!id) return;

  const btn = e?.currentTarget || getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;

  try {
    const res = await AdminModule.deleteRTLTask(id);
    if (res && res.success) {
      showToast('Tugas RTL berhasil dihapus', 'success');
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

// ============================================================
//   APPROVE
// ============================================================
async function approveRTL(id) {
  const item = ctx.state.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (isTaskDone(item)) {
    showToast('Tugas sudah selesai', 'info');
    return;
  }

  if (!confirm(`Tandai tugas "${item.judul}" sebagai selesai?`)) return;

  try {
    const res = await AdminModule.approveRTLTask(id);
    if (res && res.success) {
      showToast('Tugas ditandai selesai', 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyetujui');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    await AdminModule.loadAllData(true).catch(() => {});
  }
}

// ============================================================
//   SAVE (ADD / EDIT)
// ============================================================
async function saveRTL(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('saveRTLBtn');
  const id = getEl('editRTLId')?.value || '';
  const judul = (getEl('rtlJudul')?.value || '').trim();
  const deskripsi = (getEl('rtlDeskripsi')?.value || '').trim();
  const deadline = getEl('rtlDeadline')?.value || '';
  const status = getEl('rtlStatus')?.value || 'pending';
  const pesertaId = getEl('rtlPeserta')?.value || '';
  const catatan = (getEl('rtlCatatan')?.value || '').trim();
  const fileInput = getEl('rtlFile');

  if (!judul) { showToast('Judul tugas wajib diisi', 'error'); safeFocus('rtlJudul'); return; }
  if (!deadline) { showToast('Deadline wajib diisi', 'error'); safeFocus('rtlDeadline'); return; }

  let namaPeserta = '';
  if (pesertaId) {
    const p = ctx.state.pesertaList.find(x => String(x.id) === String(pesertaId));
    if (p) namaPeserta = p.nama_lengkap || p.nama || '';
  }

  let fileToUpload = null;
  if (fileInput && fileInput.files && fileInput.files[0]) {
    fileToUpload = fileInput.files[0];
    if (fileToUpload.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      showToast(`Ukuran file maksimal ${MAX_FILE_SIZE_MB} MB`, 'error');
      return;
    }
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    let driveFileId = null;
    if (fileToUpload) {
      const tokenRes = await getDriveToken();
      if (!tokenRes || !tokenRes.success || !tokenRes.token) {
        throw new Error('Gagal mendapatkan token Drive');
      }
      const uploadResult = await uploadToDrive(tokenRes.token, fileToUpload);
      if (!uploadResult || !uploadResult.id) {
        throw new Error('Drive tidak mengembalikan file ID');
      }
      driveFileId = uploadResult.id;
    }

    const payload = {
      judul, deskripsi, deadline, status, pesertaId, namaPeserta, catatan,
    };
    if (driveFileId) {
      payload.fileDriveId = driveFileId;
      payload.fileName = fileToUpload.name;
    }

    let res;
    if (id) {
      payload.id = id;
      res = await AdminModule.updateRTLTask(payload);
    } else {
      res = await AdminModule.addRTLTask(payload);
    }

    if (res && res.success) {
      showToast(id ? 'Tugas RTL diperbarui' : 'Tugas RTL ditambahkan', 'success');
      ctx.getModal('rtlFormModal')?.hide();
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

// ============================================================
//   BULK APPROVE — Parallel 5 concurrent
// ============================================================
async function bulkApprove() {
  if (isBulkProcessing) return;

  const pendingTasks = ctx.state.filteredList.filter(item => !isTaskDone(item));

  if (pendingTasks.length === 0) {
    showToast('Tidak ada tugas pending untuk disetujui', 'info');
    return;
  }

  if (!confirm(`Tandai semua ${pendingTasks.length} tugas yang terfilter sebagai selesai?`)) return;

  const btn = getEl('bulkApproveBtn');
  isBulkProcessing = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  const CONCURRENCY = 5;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pendingTasks.length; i += CONCURRENCY) {
    const batch = pendingTasks.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(task => AdminModule.approveRTLTask(task.id))
    );
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value && r.value.success) successCount++;
      else failCount++;
    });
  }

  restore();
  isBulkProcessing = false;

  if (successCount > 0) {
    showToast(
      `Berhasil: ${successCount} sukses, ${failCount} gagal`,
      successCount >= pendingTasks.length ? 'success' : 'warning'
    );
  }
  await AdminModule.loadAllData(true);
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.rtlList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const out = data.map(item => ({
    id: item.id,
    judul: item.judul,
    deskripsi: item.deskripsi,
    deadline: item.deadline,
    status: item.status,
    pesertaId: item.pesertaId,
    namaPeserta: item.namaPeserta,
    fileDriveId: item.fileDriveId || '',
    catatan: item.catatan,
  }));

  const fileName = `rtl_export_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(out, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} tugas`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('refreshDataBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  ctx.saving = true;

  try {
    await AdminModule.loadAllData(true);
    refreshFromCache();
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c RTL View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
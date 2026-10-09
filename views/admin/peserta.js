// ============================================================
// VIEW: peserta.js — v27.3.0 PRELOAD + SUBSCRIPTION + LOKASI PKD FILTER
// Dimuat oleh: js/router.js
// HTML: views/admin/peserta.html
// ============================================================
// CHANGELOG v27.3.0 (dari v27.2.0):
//   ✅ NEW: Filter Lokasi PKD dari sessionStorage (dari sidebar)
//   ✅ NEW: Filter banner dengan count + tombol hapus
//   ✅ NEW: Statistik menyesuaikan filter lokasi
//   ✅ NEW: Auto re-render banner saat data berubah
//   ✅ FIX: applyLokasiFilter() di getFilteredPeserta()
//   ✅ FIX: Reset filter saat unmount
//   ✅ FIX: Race-safe renderFilterBanner
//   ✅ KEEP: Semua fitur v27.2.0 (Form builder, ID Card, TTD, dll)
//   ✅ Zero memory leak
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import {
  callApi,
  showToast,
  escapeHtml,
  resetPesertaPassword as apiResetPesertaPassword,
  getLokasiPKDList as apiGetLokasiPKDList,
  addLokasiPKD as apiAddLokasiPKD,
  deleteLokasiPKD as apiDeleteLokasiPKD,
  getDefaultFormFields,
  fileToBase64,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
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
  waitFor,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const MAX_FILE_SIZE_MB = 5;
const GENERATE_CONCURRENCY = 5;
const PKD_FILTER_STORAGE_KEY = 'pkd_filter_lokasi';

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
  const s = String(status || 'pending').toLowerCase();
  if (s === 'approved' || s === 'active') return 'bg-success';
  if (s === 'rejected') return 'bg-danger';
  if (s === 'alumni') return 'bg-secondary';
  return 'bg-warning text-dark';
}

function getPkdFilterFromStorage() {
  try { return sessionStorage.getItem(PKD_FILTER_STORAGE_KEY) || ''; }
  catch (e) { return ''; }
}

function setPkdFilterToStorage(value) {
  try {
    if (value) sessionStorage.setItem(PKD_FILTER_STORAGE_KEY, value);
    else sessionStorage.removeItem(PKD_FILTER_STORAGE_KEY);
  } catch (e) { /* silent */ }
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    pesertaList: [],
    filteredList: [],
    formStructure: [],
    rtlData: [],
    approvalsData: [],
    lokasiPKDList: [],
    searchQuery: '',
    statusFilter: '',
    lokasiPkdFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    selectedIds: new Set(),
    pendingDeleteId: null,
    pendingCredentialId: null,
    pendingCertIds: [],
    isLoadingFormStructure: false,
    isLoadingLokasiPKD: false,
    lastHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'peserta'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[PesertaView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[PesertaView] Re-render error:', e);
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
    console.warn('[PesertaView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[PesertaView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    pesertaList: [],
    filteredList: [],
    rtlData: [],
    approvalsData: [],
    searchQuery: '',
    statusFilter: '',
    lokasiPkdFilter: '',
    currentPage: 1,
    pendingDeleteId: null,
    pendingCredentialId: null,
    pendingCertIds: [],
    selectedIds: new Set(),
    lastHash: '',
  });

  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterStatus');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getPesertaList() || [];
  if (cached.length > 0) {
    console.log('[PesertaView] ⚡ Rendering from preload cache');
    ctx.state.pesertaList = cached.map(p => ({ ...p }));
    ctx.state.rtlData = AdminModule.getRTLList() || [];
    ctx.state.approvalsData = AdminModule.getDigitalApprovals() || [];
    ctx.state.lastHash = computeListHash(ctx.state.pesertaList);
    renderStats();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[PesertaView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
  }
  renderSkeletonFormBuilder();

  bindEvents();

  // ===== ⭐ NEW: Baca filter Lokasi PKD dari sessionStorage =====
  const pkdFilter = getPkdFilterFromStorage();
  if (pkdFilter) {
    console.log('[PesertaView] 🎯 Filter Lokasi PKD:', pkdFilter);
    ctx.state.lokasiPkdFilter = pkdFilter;
    renderFilterBanner(pkdFilter);
    // Re-apply filter karena state berubah
    applyFiltersAndSort();
  }

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Parallel load — form structure + lokasi (fallback hanya kalau cache kosong)
  await Promise.allSettled([
    loadFormStructure(),
    loadLokasiPKD(),
    cached.length === 0 ? loadPesertaData(false) : Promise.resolve(),
  ]);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[PesertaView] unmounted');

  if (tableCleanup) {
    try { tableCleanup(); } catch (e) { /* silent */ }
    tableCleanup = null;
  }

  // ⭐ Cleanup banner
  const banner = document.getElementById('pesertaFilterBanner');
  if (banner) {
    try { banner.remove(); } catch (e) { /* silent */ }
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = AdminModule.getPesertaList() || [];
  const freshHash = computeListHash(fresh);

  if (freshHash === ctx.state.lastHash) {
    console.log('[PesertaView] No change, skip re-render');
    return;
  }

  ctx.state.pesertaList = fresh.map(p => ({ ...p }));
  ctx.state.lastHash = freshHash;
  ctx.state.rtlData = AdminModule.getRTLList() || [];
  ctx.state.approvalsData = AdminModule.getDigitalApprovals() || [];

  renderStats();
  applyFiltersAndSort();
  setCacheStatus('Live');

  // ⭐ Re-render banner kalau filter masih ada
  if (ctx.state.lokasiPkdFilter) {
    renderFilterBanner(ctx.state.lokasiPkdFilter);
  }
}

// ============================================================
//   ⭐ NEW: FILTER BANNER
// ============================================================
function renderFilterBanner(lokasi) {
  // Hapus banner lama
  const oldBanner = document.getElementById('pesertaFilterBanner');
  if (oldBanner) oldBanner.remove();

  if (!lokasi) return;

  const container = document.getElementById('pesertaTableContainer');
  if (!container || !container.parentNode) return;

  const banner = document.createElement('div');
  banner.id = 'pesertaFilterBanner';
  banner.className = 'alert alert-info d-flex align-items-center gap-2 mb-3 rounded-3 shadow-sm flex-wrap';
  banner.style.cssText = 'border-left:4px solid #2563eb;';
  banner.innerHTML = `
    <i class="bi bi-geo-alt-fill fs-5 text-primary" aria-hidden="true"></i>
    <div class="flex-grow-1">
      <strong>Filter Lokasi PKD:</strong> ${escapeHtml(lokasi)}
      <span class="badge bg-primary ms-2" id="pesertaFilterCount">0</span>
    </div>
    <button type="button"
            class="btn btn-sm btn-outline-secondary rounded-pill"
            id="clearPesertaFilterBtn"
            aria-label="Hapus filter lokasi">
      <i class="bi bi-x-circle me-1" aria-hidden="true"></i>
      Hapus Filter
    </button>
  `;

  container.parentNode.insertBefore(banner, container);

  // Bind clear button
  banner.querySelector('#clearPesertaFilterBtn')?.addEventListener('click', () => {
    setPkdFilterToStorage('');
    ctx.state.lokasiPkdFilter = '';
    banner.remove();

    // Sync active state di sidebar
    const submenu = document.getElementById('submenu-lokasi-pkd');
    if (submenu) {
      submenu.querySelectorAll('[data-pkd-filter]').forEach(l => {
        l.classList.toggle('active', l.dataset.pkdFilter === '');
      });
    }

    applyFiltersAndSort();
    showToast('Filter dihapus', 'info');
  });
}

function updateFilterBannerCount(count) {
  const el = document.getElementById('pesertaFilterCount');
  if (el) el.textContent = String(count);
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Toolbar
  ctx.on(getEl('addPesertaBtn'), 'click', handleAddPeserta);
  ctx.on(getEl('exportDataBtn'), 'click', handleExport);
  ctx.on(getEl('moveToAlumniBtn'), 'click', handleMoveToAlumni);
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);
  ctx.on(getEl('bulkGenerateTTDBtn'), 'click', handleBulkTTD);
  ctx.on(getEl('generateCertificateBtn'), 'click', handleGenerateCert);

  // Search & filter
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

  // Form builder
  ctx.on(getEl('addFieldBtn'), 'click', handleAddField);
  ctx.on(getEl('saveFormStructureBtn'), 'click', handleSaveFormStructure);
  ctx.on(getEl('saveFieldBtn'), 'click', handleSaveField);

  ctx.on(getEl('fieldType'), 'change', function () {
    const group = getEl('fieldOptionsGroup');
    if (group) group.style.display = (this.value === 'radio' || this.value === 'select') ? 'block' : 'none';
  });

  // Lokasi PKD
  ctx.on(getEl('addLokasiBtn'), 'click', handleAddLokasi);
  ctx.on(getEl('savePkdLokasiBtn'), 'click', handleSavePkdLokasi);

  // Modals
  ctx.on(getEl('savePesertaBtn'), 'click', handleSavePeserta);
  ctx.on(getEl('confirmDeleteBtn'), 'click', handleConfirmDelete);
  ctx.on(getEl('resetCredentialPasswordBtn'), 'click', handleResetPassword);
  ctx.on(getEl('generateCertSubmit'), 'click', handleGenerateCertSubmit);

  // Modal cleanup
  const pesertaFormModalEl = getEl('pesertaFormModal');
  if (pesertaFormModalEl) {
    ctx.on(pesertaFormModalEl, 'hidden.bs.modal', () => {
      const container = getEl('dynamicAdminFormContainer');
      if (container) container.innerHTML = '';
      const editId = getEl('editPesertaId');
      if (editId) editId.value = '';
    });
  }

  const fieldEditorModalEl = getEl('fieldEditorModal');
  if (fieldEditorModalEl) {
    ctx.on(fieldEditorModalEl, 'hidden.bs.modal', () => {
      const editId = getEl('editFieldId');
      if (editId) editId.value = '';
    });
  }

  // ✅ DELEGATION — peserta table
  const tableContainer = getEl('pesertaTableContainer');
  if (tableContainer) {
    tableCleanup = delegateTableClicks(tableContainer, {
      onAction: (action, id) => handleRowAction(action, id),
      onPage: (page) => {
        ctx.state.currentPage = page;
        applyFiltersAndSort();
      },
    });

    // Change event — checkbox
    ctx.on(tableContainer, 'change', (e) => {
      if (e.target.matches('#selectAllPeserta')) {
        const isChecked = e.target.checked;
        const checkboxes = tableContainer.querySelectorAll('.peserta-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = isChecked;
          const id = String(cb.value);
          if (isChecked) ctx.state.selectedIds.add(id);
          else ctx.state.selectedIds.delete(id);
        });
        updateBulkActionButtons();
        return;
      }
      if (e.target.matches('.peserta-checkbox')) {
        const id = String(e.target.value);
        if (e.target.checked) ctx.state.selectedIds.add(id);
        else ctx.state.selectedIds.delete(id);

        const all = tableContainer.querySelectorAll('.peserta-checkbox');
        const checked = tableContainer.querySelectorAll('.peserta-checkbox:checked');
        const selectAll = tableContainer.querySelector('#selectAllPeserta');
        if (selectAll) {
          selectAll.checked = all.length > 0 && all.length === checked.length;
          selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
        }
        updateBulkActionButtons();
      }
    });
  }

  // ✅ DELEGATION — form builder
  const formBuilderEl = getEl('formBuilderContainer');
  if (formBuilderEl) {
    ctx.on(formBuilderEl, 'click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit-field') editField(id);
      else if (action === 'delete-field') deleteField(id);
    });
  }

  // ✅ DELEGATION — lokasi PKD list
  const lokasiContainer = getEl('lokasiPKDListContainer');
  if (lokasiContainer) {
    ctx.on(lokasiContainer, 'click', (e) => {
      const btn = e.target.closest('[data-lokasi-id]');
      if (!btn) return;
      e.preventDefault();
      deleteLokasiPKDItem(btn.dataset.lokasiId);
    });
  }
}

// ============================================================
//   LOAD PESERTA DATA (fallback)
// ============================================================
async function loadPesertaData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[PesertaView] load error:', e);
    const c = getEl('pesertaTableContainer');
    if (c && ctx.state.pesertaList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger">Gagal memuat data: ${escapeHtml(e.message)}</div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: Stats
// ============================================================
function renderStats() {
  // ⭐ NEW: Kalau ada filter lokasi, pakai filteredList untuk stats
  const useFiltered = ctx.state.lokasiPkdFilter && ctx.state.filteredList.length >= 0;
  const list = useFiltered ? ctx.state.filteredList : ctx.state.pesertaList;

  const total = list.length;
  const pending = list.filter(p => String(p.status || '').toLowerCase() === 'pending').length;
  const approved = list.filter(p => {
    const s = String(p.status || '').toLowerCase();
    return s === 'approved' || s === 'active';
  }).length;
  const alumni = list.filter(p => String(p.status || '').toLowerCase() === 'alumni').length;

  const setText = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  setText('statTotal', total);
  setText('statPending', pending);
  setText('statApproved', approved);
  setText('statAlumni', alumni);
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredPeserta(query, status) {
  let filtered = ctx.state.pesertaList.slice();

  // ⭐ NEW: Apply filter Lokasi PKD dulu
  const lokasiFilter = ctx.state.lokasiPkdFilter;
  if (lokasiFilter) {
    filtered = filtered.filter(item =>
      String(item.lokasi_pkd || '').trim() === lokasiFilter
    );
  }

  if (query && query.trim() !== '') {
    const q = query.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama_lengkap || '').toLowerCase().includes(q) ||
      (item.email || '').toLowerCase().includes(q) ||
      (item.no_hp || '').toLowerCase().includes(q) ||
      (item.utusan || '').toLowerCase().includes(q) ||
      (item.lokasi_pkd || '').toLowerCase().includes(q)
    );
  }

  if (status && status.trim() !== '') {
    const s = status.toLowerCase().trim();
    filtered = filtered.filter(item =>
      String(item.status || 'pending').toLowerCase().trim() === s
    );
  }

  return filtered;
}

function applyFiltersAndSort() {
  let filtered = getFilteredPeserta(ctx.state.searchQuery, ctx.state.statusFilter);

  filtered.sort((a, b) => {
    const aIsAlumni = String(a.status || '').toLowerCase().trim() === 'alumni';
    const bIsAlumni = String(b.status || '').toLowerCase().trim() === 'alumni';
    if (aIsAlumni && !bIsAlumni) return 1;
    if (!aIsAlumni && bIsAlumni) return -1;
    const aT = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bT = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return bT - aT;
  });

  ctx.state.filteredList = filtered;

  // ⭐ Update banner count
  if (ctx.state.lokasiPkdFilter) {
    updateFilterBannerCount(filtered.length);
  }

  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  renderStats();
  renderTable();
}

// ============================================================
//   RENDER: Skeleton
// ============================================================
function renderSkeletonTable() {
  const c = getEl('pesertaTableContainer');
  if (!c) return;
  let html = '<div class="table-responsive"><table class="table table-hover align-middle"><thead class="table-light"><tr>';
  for (let i = 0; i < 9; i++) {
    html += '<th><div class="skeleton-box" style="height:20px;width:60px;"></div></th>';
  }
  html += '</tr></thead><tbody>';
  for (let r = 0; r < 5; r++) {
    html += '<tr>';
    for (let i = 0; i < 9; i++) {
      html += '<td><div class="skeleton-box" style="height:20px;width:80px;"></div></td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  c.innerHTML = html;
}

// ============================================================
//   RENDER: Table
// ============================================================
function renderTable() {
  const c = getEl('pesertaTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  const totalItems = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filteredList.slice(start, end);

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:40px;"><input type="checkbox" id="selectAllPeserta" aria-label="Pilih semua"></th>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>Email</th>
      <th>No HP</th>
      <th>Utusan</th>
      <th>Lokasi PKD</th>
      <th>Status</th>
      <th style="width:60px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    html += `<tr><td colspan="9" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      ${(ctx.state.searchQuery || ctx.state.statusFilter || ctx.state.lokasiPkdFilter) ? 'Tidak ada peserta sesuai filter.' : 'Tidak ada data peserta.'}
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const status = String(item.status || 'pending').toLowerCase();
      const badge = getStatusBadge(status);
      const isApproved = status === 'approved' || status === 'active';
      const safeId = escapeHtml(String(item.id));
      const isChecked = ctx.state.selectedIds.has(String(item.id));

      html += `<tr>
        <td><input type="checkbox" class="peserta-checkbox" value="${safeId}" ${isChecked ? 'checked' : ''} aria-label="Pilih peserta ${escapeHtml(item.nama_lengkap || '')}"></td>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama_lengkap || '-')}</strong></td>
        <td>${escapeHtml(item.email || '-')}</td>
        <td>${escapeHtml(item.no_hp || '-')}</td>
        <td>${escapeHtml(item.utusan || '-')}</td>
        <td><span class="badge bg-info text-dark">${escapeHtml(item.lokasi_pkd || '-')}</span></td>
        <td><span class="badge ${badge}">${escapeHtml(status)}</span></td>
        <td>
          <div class="dropdown action-dropdown">
            <button class="btn-icon" type="button" data-bs-toggle="dropdown" aria-label="Menu aksi">
              <i class="bi bi-three-dots-vertical" aria-hidden="true"></i>
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
              <li><a class="dropdown-item" href="#" data-action="view" data-id="${safeId}">
                <i class="bi bi-eye text-info" aria-hidden="true"></i> Lihat Detail</a></li>
              <li><a class="dropdown-item" href="#" data-action="edit" data-id="${safeId}">
                <i class="bi bi-pencil text-warning" aria-hidden="true"></i> Edit Data</a></li>
              ${isApproved ? `
                <li><a class="dropdown-item" href="#" data-action="idcard" data-id="${safeId}">
                  <i class="bi bi-person-vcard text-success" aria-hidden="true"></i> Lihat ID Card</a></li>
                <li><a class="dropdown-item" href="#" data-action="credential" data-id="${safeId}">
                  <i class="bi bi-key text-warning" aria-hidden="true"></i> Lihat Kredensial</a></li>
              ` : ''}
              <li><hr class="dropdown-divider"></li>
              ${status === 'pending' ? `
                <li><a class="dropdown-item text-success" href="#" data-action="approve" data-id="${safeId}">
                  <i class="bi bi-check-circle" aria-hidden="true"></i> Setujui Peserta</a></li>
              ` : ''}
              ${isApproved ? `
                <li><a class="dropdown-item" href="#" data-action="ttd" data-id="${safeId}">
                  <i class="bi bi-pencil-square text-primary" aria-hidden="true"></i> TTD Digital</a></li>
                <li><a class="dropdown-item" href="#" data-action="cert" data-id="${safeId}">
                  <i class="bi bi-file-earmark-pdf text-success" aria-hidden="true"></i> Buat Sertifikat</a></li>
                <li><a class="dropdown-item" href="#" data-action="rtl" data-id="${safeId}">
                  <i class="bi bi-check2-square text-secondary" aria-hidden="true"></i> ACC Semua RTL</a></li>
              ` : ''}
              <li><hr class="dropdown-divider"></li>
              <li><a class="dropdown-item text-danger" href="#" data-action="delete" data-id="${safeId}">
                <i class="bi bi-trash" aria-hidden="true"></i> Hapus Peserta</a></li>
            </ul>
          </div>
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
    html += `<button type="button" class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}" data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;
  updateBulkActionButtons();
  restoreFocusState('searchInput', savedFocus);
}

function updateBulkActionButtons() {
  const count = ctx.state.selectedIds.size;
  const btn = getEl('moveToAlumniBtn');
  if (btn) btn.disabled = count === 0;
}

function getSelectedIds() {
  return Array.from(ctx.state.selectedIds);
}

// ============================================================
//   ROW ACTION ROUTER
// ============================================================
function handleRowAction(action, id) {
  switch (action) {
    case 'view':       return viewPeserta(id);
    case 'edit':       return editPeserta(id);
    case 'approve':    return approvePeserta(id);
    case 'delete':     return confirmDelete(id);
    case 'idcard':     return showIdCard(id);
    case 'credential': return showCredential(id);
    case 'ttd':        return showTTD(id);
    case 'cert':       return generateCertForOne(id);
    case 'rtl':        return approveRTL(id);
    default: console.warn('[PesertaView] Unknown action:', action);
  }
}

// ============================================================
//   CRUD: Add / Edit / Delete
// ============================================================
async function handleAddPeserta() {
  if (ctx.saving) return;
  const editId = getEl('editPesertaId');
  const title = getEl('formModalTitle');
  if (editId) editId.value = '';
  if (title) title.innerText = 'Tambah Peserta';

  await renderDynamicForm(null);
  ctx.getModal('pesertaFormModal')?.show();
}

function viewPeserta(id) {
  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  let html = '<div class="list-group list-group-flush">';
  ctx.state.formStructure.forEach(field => {
    if (field.type === 'file') return;
    const val = item[field.id] || '-';
    html += `<div class="list-group-item py-2"><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(String(val))}</div>`;
  });
  html += `<div class="list-group-item py-2"><strong>Lokasi PKD:</strong> ${escapeHtml(item.lokasi_pkd || '-')}</div>`;
  html += `<div class="list-group-item py-2"><strong>Status:</strong> <span class="badge ${getStatusBadge(item.status)}">${escapeHtml(item.status || 'pending')}</span></div>`;
  html += '</div>';

  const detailContent = getEl('detailContent');
  if (detailContent) detailContent.innerHTML = html;
  ctx.getModal('detailPesertaModal')?.show();
}

async function editPeserta(id) {
  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const editId = getEl('editPesertaId');
  const title = getEl('formModalTitle');
  if (editId) editId.value = id;
  if (title) title.innerText = 'Edit Peserta';

  await renderDynamicForm(item);
  ctx.getModal('pesertaFormModal')?.show();
}

function confirmDelete(id) {
  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }
  ctx.state.pendingDeleteId = id;
  ctx.getModal('deleteConfirmModal')?.show();
}

async function handleConfirmDelete(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteId;
  if (!id) return;

  const btn = e?.currentTarget || getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;

  try {
    const res = await AdminModule.deletePeserta(id);
    if (res.success) {
      showToast('Peserta berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      ctx.state.selectedIds.delete(String(id));
      await AdminModule.loadAllData(true);
    } else {
      throw new Error(res.error || 'Gagal menghapus');
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
async function approvePeserta(id) {
  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) return;
  if (!confirm(`Setujui peserta "${item.nama_lengkap}"? Akun login akan otomatis dibuat.`)) return;

  try {
    const res = await AdminModule.approvePeserta(id);
    if (res.success) {
      showToast('Peserta disetujui! Password default = No HP.', 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error(res.error || 'Gagal menyetujui');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   CREDENTIALS
// ============================================================
async function showCredential(id) {
  try {
    const res = await callApi('getPesertaCredentials', { id }, 'GET');
    if (!res || !res.success || !res.data) {
      showToast((res && res.error) ? res.error : 'Kredensial tidak ditemukan', 'error');
      return;
    }
    ctx.state.pendingCredentialId = id;

    const setText = (elId, val) => { const el = getEl(elId); if (el) el.innerText = val; };
    setText('credentialNama', res.data.nama_lengkap || '-');
    setText('credentialUsername', res.data.username || '-');
    setText('credentialPasswordHint', res.data.passwordHint || 'No HP terdaftar');

    ctx.getModal('credentialModal')?.show();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function handleResetPassword(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingCredentialId;
  if (!id) { showToast('Data tidak valid', 'error'); return; }

  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Peserta tidak ditemukan', 'error'); return; }

  const newPassword = item.no_hp;
  if (!newPassword) { showToast('Peserta tidak punya No HP terdaftar', 'error'); return; }

  if (!confirm(`Reset password untuk "${item.nama_lengkap}" ke No HP (${newPassword})?`)) return;

  const btn = e?.currentTarget || getEl('resetCredentialPasswordBtn');
  const restore = setBtnLoading(btn, true, 'Memproses...');
  ctx.saving = true;

  try {
    const res = await apiResetPesertaPassword(id, newPassword);
    if (res && res.success) {
      showToast('Password berhasil direset ke No HP.', 'success');
      ctx.getModal('credentialModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal reset password');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   ID CARD
// ============================================================
function showIdCard(id) {
  const item = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const status = String(item.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'active') {
    showToast('ID Card hanya untuk peserta yang disetujui/aktif.', 'warning');
    return;
  }

  const nama = item.nama_lengkap || '-';
  const alamat = item.alamat || '-';
  const idPeserta = item.id || '-';

  const content = getEl('idCardModalContent');
  if (!content) return;

  content.innerHTML = `
    <div class="id-card-wrapper">
      <div id="idCard" class="id-card">
        <div class="header">
          <img src="${BASE_PATH}LOGOANSOR.webp" alt="Ansor">
          <h5>PKD GP Ansor <small>Kabupaten Bantul</small></h5>
        </div>
        <div class="body">
          <div class="qr-area">
            <div id="adminQrContainer" style="width:100%;height:100%;display:flex;justify-content:center;align-items:center;"></div>
          </div>
          <div class="data-area">
            <div><span class="label">ID Peserta</span><div class="value">${escapeHtml(String(idPeserta))}</div></div>
            <div><span class="label">Nama Lengkap</span><div class="value">${escapeHtml(nama)}</div></div>
            <div><span class="label">Alamat</span><div class="value" style="font-weight:400;">${escapeHtml(alamat)}</div></div>
          </div>
        </div>
        <div class="footer">Password Login: <span>No HP Terdaftar</span></div>
      </div>
    </div>
    <div class="text-center mt-3">
      <button type="button" class="btn btn-primary px-4" id="downloadAdminIdCardBtn">
        <i class="bi bi-download" aria-hidden="true"></i> Unduh Kartu (PNG)
      </button>
    </div>`;

  // Generate QR
  const qrTarget = getEl('adminQrContainer');
  if (qrTarget && typeof qrcode === 'function') {
    qrTarget.innerHTML = '';
    try {
      const qr = qrcode(0, 'M');
      qr.addData(`peserta_id=${idPeserta}`);
      qr.make();
      const moduleCount = qr.getModuleCount();
      const cellSize = 8;
      const margin = 4;
      const size = moduleCount * cellSize + margin * 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx2 = canvas.getContext('2d');
      ctx2.fillStyle = '#ffffff';
      ctx2.fillRect(0, 0, size, size);
      for (let r = 0; r < moduleCount; r++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(r, col)) {
            ctx2.fillStyle = '#000000';
            ctx2.fillRect(margin + col * cellSize, margin + r * cellSize, cellSize, cellSize);
          }
        }
      }
      qrTarget.appendChild(canvas);
    } catch (err) {
      qrTarget.innerHTML = '<div class="text-muted small">QR error</div>';
    }
  }

  ctx.getModal('adminIdCardModal')?.show();

  setTimeout(() => {
    const btn = getEl('downloadAdminIdCardBtn');
    if (!btn) return;
    btn.onclick = function () {
      const el = getEl('idCard');
      if (!el) return;
      if (typeof html2canvas === 'undefined') {
        showToast('Fitur download tidak tersedia', 'error');
        return;
      }
      const btnEl = this;
      const original = btnEl.innerHTML;
      btnEl.disabled = true;
      btnEl.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Memuat...';

      html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
        .then(c => {
          const link = document.createElement('a');
          link.download = `Kartu_ID_${nama.replace(/\s+/g, '_')}.png`;
          link.href = c.toDataURL('image/png');
          link.click();
          showToast('Kartu ID diunduh', 'success');
        })
        .catch(err => showToast('Gagal unduh: ' + err.message, 'error'))
        .finally(() => {
          btnEl.disabled = false;
          btnEl.innerHTML = original;
        });
    };
  }, 300);
}

// ============================================================
//   TTD DIGITAL
// ============================================================
async function showTTD(id) {
  const peserta = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!peserta) { showToast('Peserta tidak ditemukan', 'error'); return; }
  const nama = peserta.nama_lengkap;

  try {
    const all = AdminModule.getDigitalApprovals() || [];
    const filtered = all.filter(a =>
      String(a.peserta_nama || '').toLowerCase().trim() === String(nama).toLowerCase().trim()
    );

    const container = getEl('ttdCardsContainer');
    const emptyMsg = getEl('ttdEmptyMessage');
    if (!container || !emptyMsg) return;

    if (filtered.length === 0) {
      container.innerHTML = '';
      emptyMsg.style.display = 'block';
    } else {
      emptyMsg.style.display = 'none';

      const roleMap = { ketua_pc: null, sekretaris: null, instruktur: null };
      filtered.forEach(a => {
        if (!roleMap[a.role] || new Date(a.timestamp) > new Date(roleMap[a.role].timestamp)) {
          roleMap[a.role] = a;
        }
      });

      const roleLabels = { ketua_pc: 'Ketua PC', sekretaris: 'Sekretaris', instruktur: 'Instruktur' };
      let html = '';

      Object.keys(roleMap).forEach(role => {
        const a = roleMap[role];
        if (!a || !a.driveId) return;

        const verifyUrl = `${window.location.origin}${BASE_PATH}verifikasi_signature.html?role=${encodeURIComponent(role)}&driveId=${encodeURIComponent(a.driveId)}`;

        let qrUrl = '';
        if (typeof qrcode === 'function') {
          try {
            const qr = qrcode(0, 'M');
            qr.addData(verifyUrl);
            qr.make();
            const moduleCount = qr.getModuleCount();
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 200;
            const ctx2 = canvas.getContext('2d');
            ctx2.fillStyle = '#ffffff';
            ctx2.fillRect(0, 0, 200, 200);
            ctx2.strokeStyle = '#d1d5db';
            ctx2.lineWidth = 4;
            ctx2.strokeRect(0, 0, 200, 200);
            const padding = 16;
            const cellSize = (200 - padding * 2) / moduleCount;
            for (let r = 0; r < moduleCount; r++) {
              for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(r, col)) {
                  ctx2.fillStyle = '#000000';
                  ctx2.fillRect(padding + col * cellSize, padding + r * cellSize, cellSize, cellSize);
                }
              }
            }
            qrUrl = canvas.toDataURL('image/png');
          } catch (err) { /* silent */ }
        }

        html += `<div class="col-md-6">
          <div class="ttd-box">
            <span class="role-badge">${roleLabels[role]}</span>
            <div class="ttd-qr-container">
              ${qrUrl ? `<img src="${qrUrl}" alt="QR TTD ${roleLabels[role]}">` : '<div class="text-muted small">QR tidak tersedia</div>'}
            </div>
            <h6 class="fw-bold mb-1">${escapeHtml(a.nama || '-')}</h6>
            <p class="small text-muted mb-2">${escapeHtml(a.kegunaan || 'Verifikasi Sertifikat')}</p>
            <div class="d-flex gap-2 justify-content-center flex-wrap">
              ${qrUrl ? `<a href="${qrUrl}" download="QR_${role}_${nama.replace(/\s+/g, '_')}.png" class="btn btn-sm btn-outline-primary" title="Download QR">
                <i class="bi bi-download" aria-hidden="true"></i>
              </a>` : ''}
              <a href="${verifyUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary" title="Verifikasi">
                <i class="bi bi-eye" aria-hidden="true"></i>
              </a>
            </div>
          </div>
        </div>`;
      });

      container.innerHTML = html || '<div class="col-12 text-center text-muted py-3">Tidak ada TTD valid.</div>';
    }

    ctx.getModal('ttdModal')?.show();
  } catch (e) {
    showToast('Gagal memuat TTD: ' + e.message, 'error');
  }
}

// ============================================================
//   ACC RTL
// ============================================================
async function approveRTL(id) {
  const peserta = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!peserta) return;
  if (!confirm(`Setujui SEMUA tugas RTL untuk "${peserta.nama_lengkap}"?`)) return;

  try {
    const res = await callApi('approveAllRTL', { pesertaId: id }, 'POST');
    if (res.success) {
      showToast(`Semua RTL disetujui (${res.updated || 0} tugas)`, 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error(res.error || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   ELIGIBILITY CHECK
// ============================================================
function isEligible(p) {
  const status = String(p.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'active') {
    return { eligible: false, reason: 'Status belum disetujui' };
  }

  const tasks = ctx.state.rtlData.filter(t => String(t.pesertaId) === String(p.id));
  if (tasks.length > 0 && !tasks.every(t => String(t.status).toLowerCase() === 'selesai')) {
    return { eligible: false, reason: 'RTL belum selesai' };
  }

  const nama = p.nama_lengkap;
  const filtered = ctx.state.approvalsData.filter(a =>
    String(a.peserta_nama || '').toLowerCase().trim() === String(nama || '').toLowerCase().trim()
  );
  const has = role => filtered.some(a => a.role === role);
  if (!has('ketua_pc') || !has('sekretaris') || !has('instruktur')) {
    return { eligible: false, reason: 'TTD belum lengkap' };
  }
  return { eligible: true };
}

// ============================================================
//   GENERATE CERTIFICATE
// ============================================================
async function generateCertForOne(id) {
  const peserta = ctx.state.pesertaList.find(p => String(p.id) === String(id));
  if (!peserta) { showToast('Peserta tidak ditemukan', 'error'); return; }
  const check = isEligible(peserta);
  if (!check.eligible) {
    showToast('Peserta belum memenuhi syarat: ' + check.reason, 'warning');
    return;
  }
  await openGenerateModal([String(id)]);
}

function handleGenerateCert() {
  const ids = getSelectedIds();
  if (ids.length === 0) {
    showToast('Pilih minimal satu peserta', 'info');
    return;
  }
  openGenerateModal(ids);
}

async function openGenerateModal(ids) {
  try {
    const tplRes = await callApi('getCertificateTemplates', {}, 'GET');
    const templates = (tplRes && tplRes.data) ? tplRes.data
      : (Array.isArray(tplRes) ? tplRes : []);

    const sel = getEl('certTemplateSelect');
    if (sel) {
      if (templates.length === 0) {
        sel.innerHTML = '<option value="">-- Belum ada template — buat dulu di menu Sertifikat --</option>';
      } else {
        sel.innerHTML = '<option value="">-- Pilih Template --</option>' +
          templates.map(t => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.nama_template)}</option>`).join('');
      }
    }

    const participants = ctx.state.pesertaList.filter(p => ids.includes(String(p.id)));
    let listHtml = '';
    let allValid = true;

    participants.forEach(p => {
      const check = isEligible(p);
      if (check.eligible) {
        listHtml += `<span class="text-success d-block mb-1">✅ ${escapeHtml(p.nama_lengkap)}</span>`;
      } else {
        listHtml += `<span class="text-danger d-block mb-1">❌ ${escapeHtml(p.nama_lengkap)} <small>(${escapeHtml(check.reason)})</small></span>`;
        allValid = false;
      }
    });

    const listEl = getEl('selectedParticipantsList');
    if (listEl) listEl.innerHTML = listHtml;

    const statusMsg = getEl('generateStatusMsg');
    if (statusMsg) {
      statusMsg.innerHTML = allValid
        ? '<i class="bi bi-check-circle text-success" aria-hidden="true"></i> Semua peserta memenuhi syarat.'
        : '<i class="bi bi-exclamation-triangle text-warning" aria-hidden="true"></i> Ada peserta yang belum memenuhi syarat.';
    }

    const submitBtn = getEl('generateCertSubmit');
    if (submitBtn) {
      submitBtn.disabled = !allValid || templates.length === 0;
      submitBtn.dataset.ids = JSON.stringify(ids);
    }

    const progressEl = getEl('generateProgress');
    if (progressEl) progressEl.style.display = 'none';

    const resultEl = getEl('generateResultArea');
    if (resultEl) resultEl.innerHTML = '';

    ctx.getModal('generateCertModal')?.show();
  } catch (e) {
    showToast('Gagal membuka modal: ' + e.message, 'error');
  }
}

async function handleGenerateCertSubmit(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('generateCertSubmit');
  if (!btn) return;

  let ids;
  try { ids = JSON.parse(btn.dataset.ids || '[]'); }
  catch (err) { ids = []; }

  const templateId = getEl('certTemplateSelect')?.value;
  if (!templateId) { showToast('Pilih template dulu', 'warning'); return; }

  const participants = ctx.state.pesertaList.filter(p => ids.includes(String(p.id)));
  const valid = participants.filter(p => isEligible(p).eligible);

  if (valid.length === 0) {
    showToast('Tidak ada peserta yang memenuhi syarat', 'warning');
    return;
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  const progressEl = getEl('generateProgress');
  const progressBar = document.querySelector('#generateProgress .progress-bar');
  const progressText = getEl('generateProgressText');
  if (progressEl) progressEl.style.display = 'block';

  const results = [];
  const errors = [];
  let completed = 0;

  const updateProgress = (nama) => {
    completed++;
    if (progressText) progressText.innerText = `Memproses ${completed}/${valid.length}: ${nama}`;
    if (progressBar) progressBar.style.width = ((completed / valid.length) * 100) + '%';
  };

  for (let i = 0; i < valid.length; i += GENERATE_CONCURRENCY) {
    if (!ctx.mounted) break;

    const batch = valid.slice(i, i + GENERATE_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(p => callApi('generateCertificateForParticipant', { templateId, pesertaId: p.id }, 'POST'))
    );

    batchResults.forEach((r, idx) => {
      const p = batch[idx];
      if (r.status === 'fulfilled' && r.value && r.value.success) {
        results.push({ nama: p.nama_lengkap, nomor: r.value.nomorSertifikat, url: r.value.pdfUrl });
      } else {
        errors.push({ nama: p.nama_lengkap, error: (r.value && r.value.error) || r.reason?.message || 'Gagal' });
      }
      updateProgress(p.nama_lengkap);
    });
  }

  if (progressEl) progressEl.style.display = 'none';

  let html = '';
  if (results.length > 0) {
    html += `<div class="alert alert-success">✅ Berhasil: ${results.length} sertifikat.</div>`;
    html += `<div class="table-responsive"><table class="table table-sm">
      <thead><tr><th>Nama</th><th>Nomor</th><th>PDF</th></tr></thead><tbody>`;
    results.forEach(r => {
      html += `<tr>
        <td>${escapeHtml(r.nama)}</td>
        <td><code>${escapeHtml(r.nomor || '')}</code></td>
        <td><a href="${escapeHtml(r.url || '#')}" target="_blank" rel="noopener" class="btn btn-sm btn-success">
          <i class="bi bi-download" aria-hidden="true"></i>
        </a></td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  if (errors.length > 0) {
    html += `<div class="alert alert-danger"><strong>Gagal:</strong><ul class="mb-0">`;
    errors.forEach(err => { html += `<li>${escapeHtml(err.nama)}: ${escapeHtml(err.error)}</li>`; });
    html += `</ul></div>`;
  }

  const resultEl = getEl('generateResultArea');
  if (resultEl) resultEl.innerHTML = html;

  restore();
  ctx.saving = false;
}

// ============================================================
//   BULK TTD
// ============================================================
async function handleBulkTTD(e) {
  if (ctx.saving) return;

  if (!confirm('Generate TTD digital untuk SEMUA peserta approved/active? Ini akan memakan waktu.')) return;

  const btn = e?.currentTarget || getEl('bulkGenerateTTDBtn');
  const restore = setBtnLoading(btn, true, 'Memproses...');
  ctx.saving = true;

  try {
    const res = await callApi('bulkGenerateTTD', {}, 'POST');
    if (res && res.success) {
      showToast(`Berhasil generate ${res.addedCount || 0} TTD untuk ${res.totalPeserta || 0} peserta`, 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   MOVE TO ALUMNI
// ============================================================
async function handleMoveToAlumni(e) {
  if (ctx.saving) return;

  const ids = getSelectedIds();
  if (ids.length === 0) { showToast('Pilih minimal satu peserta', 'warning'); return; }
  if (!confirm(`Pindahkan ${ids.length} peserta ke Alumni?`)) return;

  const btn = e?.currentTarget || getEl('moveToAlumniBtn');
  const restore = setBtnLoading(btn, true, 'Memindahkan...');
  ctx.saving = true;

  try {
    const res = await AdminModule.moveMultipleToAlumni(ids);
    if (res.success) {
      showToast(`Berhasil memindahkan ${res.moved || ids.length} peserta ke Alumni`, 'success');
      ctx.state.selectedIds.clear();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error(res.error || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
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
    showToast('Data berhasil disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   EXPORT
// ============================================================
function handleExport() {
  const data = ctx.state.filteredList;
  if (data.length === 0) {
    showToast('Tidak ada data', 'info');
    return;
  }

  const out = data.map(item => ({
    id: item.id,
    nama: item.nama_lengkap,
    email: item.email,
    hp: item.no_hp,
    utusan: item.utusan,
    lokasi_pkd: item.lokasi_pkd,
    status: item.status,
  }));

  try {
    const json = JSON.stringify(out, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `peserta_export_${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Ekspor ${data.length} data berhasil`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   FORM BUILDER
// ============================================================
async function loadFormStructure() {
  if (ctx.state.isLoadingFormStructure) return;
  ctx.state.isLoadingFormStructure = true;

  try {
    const apiRes = await callApi('getFormSettings', {}, 'GET');
    let raw = (apiRes && apiRes.data) ? apiRes.data : null;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }

    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      const correct = raw.find(cfg =>
        Array.isArray(cfg) && cfg.find(f => f.id === 'surat_rekomendasi' && f.required === false)
      );
      ctx.state.formStructure = correct || raw[0];
    } else if (Array.isArray(raw) && raw.length > 0) {
      ctx.state.formStructure = raw;
    } else {
      ctx.state.formStructure = getDefaultFormFields();
    }
    renderFormStructure();
  } catch (e) {
    console.warn('[PesertaView] loadFormStructure:', e);
    ctx.state.formStructure = getDefaultFormFields();
    renderFormStructure();
  } finally {
    ctx.state.isLoadingFormStructure = false;
  }
}

function renderSkeletonFormBuilder() {
  const c = getEl('formBuilderContainer');
  if (!c) return;
  let html = '';
  for (let i = 0; i < 6; i++) {
    html += `<div class="col-md-6 col-lg-4"><div class="field-builder-card">
      <div style="width:100%;">
        <div class="skeleton-box" style="height:1.2rem;width:70%;margin-bottom:6px;"></div>
        <div class="skeleton-box" style="height:0.9rem;width:40%;"></div>
      </div>
    </div></div>`;
  }
  c.innerHTML = html;
}

function renderFormStructure() {
  const c = getEl('formBuilderContainer');
  if (!c) return;

  if (!ctx.state.formStructure.length) {
    c.innerHTML = '<div class="col-12 text-center text-muted">Belum ada field.</div>';
    return;
  }

  let html = '';
  ctx.state.formStructure.forEach(field => {
    const isCore = field.isCore === true;
    const typeLabel = { text: 'Teks', textarea: 'Textarea', radio: 'Radio', select: 'Select', file: 'File' }[field.type] || field.type;

    html += `<div class="col-md-6 col-lg-4"><div class="field-builder-card">
      <div>
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="field-meta">${typeLabel} ${field.required ? '(Wajib)' : ''}</div>
      </div>
      <div class="d-flex gap-2">
        ${isCore ? '<span class="badge bg-secondary"><i class="bi bi-lock-fill" aria-hidden="true"></i> Core</span>' : `
          <button type="button" class="btn btn-sm btn-outline-warning" data-action="edit-field" data-id="${escapeHtml(field.id)}" aria-label="Edit field">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-field" data-id="${escapeHtml(field.id)}" aria-label="Hapus field">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        `}
      </div>
    </div></div>`;
  });
  c.innerHTML = html;
}

function handleAddField() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editFieldId', '');
  setVal('fieldLabel', '');
  setVal('fieldType', 'text');
  setVal('fieldOptions', '');

  const reqEl = getEl('fieldRequired');
  if (reqEl) reqEl.checked = false;

  const titleEl = getEl('fieldModalTitle');
  if (titleEl) titleEl.innerText = 'Tambah Field Baru';

  const optGroup = getEl('fieldOptionsGroup');
  if (optGroup) optGroup.style.display = 'none';

  ctx.getModal('fieldEditorModal')?.show();
}

function editField(id) {
  const f = ctx.state.formStructure.find(x => x.id === id);
  if (!f) return;

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editFieldId', id);
  setVal('fieldLabel', f.label || '');
  setVal('fieldType', f.type || 'text');
  setVal('fieldOptions', f.options || '');

  const reqEl = getEl('fieldRequired');
  if (reqEl) reqEl.checked = f.required === true;

  const titleEl = getEl('fieldModalTitle');
  if (titleEl) titleEl.innerText = 'Edit Field';

  const optGroup = getEl('fieldOptionsGroup');
  if (optGroup) optGroup.style.display = (f.type === 'radio' || f.type === 'select') ? 'block' : 'none';

  ctx.getModal('fieldEditorModal')?.show();
}

function deleteField(id) {
  if (!confirm('Hapus field ini?')) return;
  ctx.state.formStructure = ctx.state.formStructure.filter(f => f.id !== id);
  renderFormStructure();
  showToast('Field dihapus (klik Simpan Struktur untuk menerapkan)', 'info');
}

function handleSaveField() {
  const idEl = getEl('editFieldId');
  const labelEl = getEl('fieldLabel');
  const typeEl = getEl('fieldType');
  const optEl = getEl('fieldOptions');
  const reqEl = getEl('fieldRequired');

  const id = idEl ? idEl.value : '';
  const label = labelEl ? labelEl.value.trim() : '';
  const type = typeEl ? typeEl.value : 'text';
  const options = optEl ? optEl.value.trim() : '';
  const required = reqEl ? reqEl.checked : false;

  if (!label) { showToast('Label wajib diisi', 'error'); return; }
  if ((type === 'radio' || type === 'select') && !options) {
    showToast('Opsi wajib diisi', 'error');
    return;
  }

  if (id) {
    const idx = ctx.state.formStructure.findIndex(f => f.id === id);
    if (idx !== -1) {
      ctx.state.formStructure[idx] = { ...ctx.state.formStructure[idx], label, type, options, required };
    }
  } else {
    ctx.state.formStructure.push({
      id: 'field_' + Date.now(),
      label, type, options, required,
      isCore: false,
    });
  }

  renderFormStructure();
  ctx.getModal('fieldEditorModal')?.hide();
  showToast('Field tersimpan. Klik "Simpan Struktur" untuk menerapkan.', 'info');
}

async function handleSaveFormStructure(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('saveFormStructureBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.saving = true;

  try {
    const res = await AdminModule.setFormSettings(ctx.state.formStructure);
    if (res.success) {
      showToast('Struktur form berhasil disimpan!', 'success');
      await AdminModule.loadAllData(true);
      await loadFormStructure();
    } else {
      throw new Error(res.error || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   LOKASI PKD
// ============================================================
async function loadLokasiPKD() {
  try {
    const res = await apiGetLokasiPKDList();
    if (!ctx.mounted) return;
    ctx.state.lokasiPKDList = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
    renderLokasiPKDList();
  } catch (e) {
    ctx.state.lokasiPKDList = [];
    renderLokasiPKDList();
  }
}

function renderLokasiPKDList() {
  const c = getEl('lokasiPKDListContainer');
  if (!c) return;

  if (ctx.state.lokasiPKDList.length === 0) {
    c.innerHTML = '<p class="text-muted small">Belum ada lokasi PKD.</p>';
  } else {
    let html = '';
    ctx.state.lokasiPKDList.forEach(item => {
      html += `<div class="lokasi-pkd-item">
        <span><span class="badge bg-primary">${escapeHtml(item.nama)}</span></span>
        <button type="button" class="btn btn-sm btn-outline-danger" data-lokasi-id="${escapeHtml(String(item.id))}" aria-label="Hapus lokasi">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>`;
    });
    c.innerHTML = html;
  }

  const sel = getEl('pkdLokasiSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Semua Lokasi --</option>';
    ctx.state.lokasiPKDList.forEach(l => {
      const opt = document.createElement('option');
      opt.value = l.nama;
      opt.textContent = l.nama;
      if (cur === l.nama) opt.selected = true;
      sel.appendChild(opt);
    });
  }
}

async function deleteLokasiPKDItem(id) {
  if (!confirm('Hapus lokasi ini?')) return;
  try {
    const res = await apiDeleteLokasiPKD(id);
    if (res && res.success) {
      showToast('Lokasi dihapus', 'success');
      await loadLokasiPKD();
      loadPkdLokasiSetting();

      // ⭐ Notify sidebar untuk refresh submenu
      window.dispatchEvent(new CustomEvent('pkd:lokasi-updated'));
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function handleAddLokasi(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('addLokasiBtn');
  const input = getEl('newLokasiInput');
  const nama = input ? input.value.trim() : '';
  if (!nama) { showToast('Nama lokasi wajib diisi', 'error'); return; }

  const restore = setBtnLoading(btn, true, '');
  ctx.saving = true;

  try {
    const res = await apiAddLokasiPKD(nama);
    if (res && res.success) {
      showToast('Lokasi ditambahkan', 'success');
      if (input) input.value = '';
      await loadLokasiPKD();

      // ⭐ Notify sidebar untuk refresh submenu
      window.dispatchEvent(new CustomEvent('pkd:lokasi-updated'));
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

async function loadPkdLokasiSetting() {
  try {
    const res = await callApi('getPKDLokasi', {}, 'GET');
    if (!ctx.mounted) return;
    if (res && res.success) {
      const cur = res.data || '';
      const sel = getEl('pkdLokasiSelect');
      if (sel) {
        for (let opt of sel.options) {
          if (opt.value === cur) { opt.selected = true; break; }
        }
      }
      const statusEl = getEl('pkdLokasiStatus');
      if (statusEl) statusEl.innerText = `Filter saat ini: ${cur || 'Semua Lokasi'}`;
    }
  } catch (e) { /* silent */ }
}

async function handleSavePkdLokasi(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('savePkdLokasiBtn');
  const lokasi = getEl('pkdLokasiSelect')?.value || '';

  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.saving = true;

  try {
    const res = await callApi('setPKDLokasi', { lokasi }, 'POST');
    if (res && res.success) {
      const statusEl = getEl('pkdLokasiStatus');
      if (statusEl) statusEl.innerText = `✅ Filter disimpan: ${lokasi || 'Semua Lokasi'}`;
      showToast('Filter lokasi diperbarui', 'success');
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (err) {
    const statusEl = getEl('pkdLokasiStatus');
    if (statusEl) statusEl.innerText = `❌ Gagal: ${err.message}`;
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   DYNAMIC FORM — Race-safe wait
// ============================================================
async function ensureLokasiPKDLoaded() {
  if (ctx.state.lokasiPKDList.length > 0) return;
  if (ctx.state.isLoadingLokasiPKD) {
    await waitFor(() => ctx.state.lokasiPKDList.length > 0, 3000, 100);
    if (ctx.state.lokasiPKDList.length > 0) return;
  }

  ctx.state.isLoadingLokasiPKD = true;
  try {
    const res = await apiGetLokasiPKDList();
    ctx.state.lokasiPKDList = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
  } catch (e) {
    ctx.state.lokasiPKDList = [];
  } finally {
    ctx.state.isLoadingLokasiPKD = false;
  }
}

async function renderDynamicForm(data) {
  const c = getEl('dynamicAdminFormContainer');
  if (!c) return;

  c.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div><p class="mt-2 small text-muted">Memuat struktur form...</p></div>';

  if (ctx.state.formStructure.length === 0 || ctx.state.isLoadingFormStructure) {
    await waitFor(() => ctx.state.formStructure.length > 0 && !ctx.state.isLoadingFormStructure, 3000, 100);
  }
  if (ctx.state.formStructure.length === 0) {
    ctx.state.formStructure = getDefaultFormFields();
  }

  const fields = ctx.state.formStructure;
  await ensureLokasiPKDLoaded();
  const lokasiList = ctx.state.lokasiPKDList;

  let html = `<form id="dynamicAdminForm" autocomplete="off">`;

  fields.forEach(field => {
    const val = data ? (data[field.id] || '') : '';
    const req = field.required ? 'required' : '';
    const ast = field.required ? ' <span class="text-danger">*</span>' : '';

    if (field.id === 'foto') {
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label><input type="file" class="form-control" name="${field.id}" accept="image/*" ${req}></div>`;
    } else if (field.id === 'surat_rekomendasi') {
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label><input type="file" class="form-control" name="${field.id}" accept=".pdf,image/*" ${req}></div>`;
    } else if (field.type === 'textarea') {
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label><textarea class="form-control" name="${field.id}" rows="3" ${req}>${escapeHtml(String(val))}</textarea></div>`;
    } else if (field.type === 'radio') {
      const options = String(field.options || '').split(',').map(s => s.trim()).filter(Boolean);
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label>`;
      options.forEach((opt, i) => {
        html += `<div class="form-check form-check-inline"><input class="form-check-input" type="radio" name="${field.id}" value="${escapeHtml(opt)}" id="${field.id}_${i}" ${val === opt ? 'checked' : ''} ${req}><label class="form-check-label" for="${field.id}_${i}">${escapeHtml(opt)}</label></div>`;
      });
      html += `</div>`;
    } else if (field.type === 'select') {
      const options = String(field.options || '').split(',').map(s => s.trim()).filter(Boolean);
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label><select class="form-select" name="${field.id}" ${req}><option value="">-- Pilih --</option>`;
      options.forEach(opt => {
        html += `<option value="${escapeHtml(opt)}" ${val === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`;
      });
      html += `</select>`;

      if (field.id === 'utusan') {
        const isLainnya = val && String(val).startsWith('Lainnya');
        html += `<div id="utusanLuarContainerAdmin" style="display:${isLainnya ? 'block' : 'none'};margin-top:8px;">
          <label class="form-label fw-bold">Tulis Asal (Lainnya)</label>
          <input type="text" class="form-control" name="utusan_luar" placeholder="Contoh: PC Sleman, Luar DIY" value="${isLainnya ? escapeHtml(String(val).replace('Lainnya - ', '')) : ''}">
        </div>`;
      }
      html += `</div>`;
    } else {
      html += `<div class="mb-3"><label class="form-label fw-bold">${escapeHtml(field.label)}${ast}</label><input type="text" class="form-control" name="${field.id}" value="${escapeHtml(String(val))}" ${req}></div>`;
    }
  });

  const currentStatus = data ? (data.status || 'pending') : 'pending';
  const statusOptions = ['pending', 'approved', 'active', 'alumni', 'rejected'];
  html += `<div class="mb-3">
    <label class="form-label fw-bold">Status Peserta <span class="text-danger">*</span></label>
    <select class="form-select" name="status" required>
      ${statusOptions.map(o => `<option value="${o}" ${currentStatus === o ? 'selected' : ''}>${o.charAt(0).toUpperCase() + o.slice(1)}</option>`).join('')}
    </select>
    <div class="form-text text-muted small">⚠️ Status <strong>Approved</strong> akan membuat akun login. Status <strong>Alumni</strong> akan memindahkan ke daftar Alumni.</div>
  </div>`;

  html += `<div class="mb-3">
    <label class="form-label fw-bold">Lokasi PKD <span class="text-danger">*</span></label>`;

  if (lokasiList.length === 0) {
    html += `
      <div class="alert alert-warning small mb-0">
        <i class="bi bi-exclamation-triangle me-1"></i>
        <strong>Belum ada lokasi PKD.</strong><br>
        Silakan tutup modal ini dan tambahkan lokasi di bagian <strong>Lokasi PKD</strong> di bawah halaman.
        <input type="hidden" name="lokasi_pkd" value="" data-empty="true">
      </div>`;
  } else {
    html += `
      <select class="form-select" name="lokasi_pkd" required>
        <option value="">-- Pilih Lokasi --</option>
        ${lokasiList.map(l => `<option value="${escapeHtml(l.nama)}" ${(data && data.lokasi_pkd === l.nama) ? 'selected' : ''}>${escapeHtml(l.nama)}</option>`).join('')}
      </select>`;
  }
  html += `</div>`;

  html += `</form>`;
  c.innerHTML = html;

  const utusanSel = c.querySelector('select[name="utusan"]');
  const luarContainer = c.querySelector('#utusanLuarContainerAdmin');
  if (utusanSel && luarContainer) {
    utusanSel.onchange = function () {
      if (this.value === 'Lainnya') {
        luarContainer.style.display = 'block';
      } else {
        luarContainer.style.display = 'none';
        const luarInput = luarContainer.querySelector('input[name="utusan_luar"]');
        if (luarInput) luarInput.value = '';
      }
    };
  }
}

// ============================================================
//   SAVE PESERTA
// ============================================================
async function handleSavePeserta(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('savePesertaBtn');
  const id = getEl('editPesertaId')?.value || '';
  const form = document.querySelector('#dynamicAdminFormContainer form');
  if (!form) { showToast('Form tidak ditemukan', 'error'); return; }

  const formData = new FormData(form);
  const data = { id };

  ctx.state.formStructure.forEach(field => {
    if (field.type === 'file') return;
    const v = formData.get(field.id);
    data[field.id] = v !== null ? v : '';
  });

  const statusSel = form.querySelector('select[name="status"]');
  data.status = statusSel ? statusSel.value : 'pending';

  const lokSel = form.querySelector('select[name="lokasi_pkd"]');
  data.lokasi_pkd = lokSel ? lokSel.value : '';

  if (!data.lokasi_pkd) {
    showToast('Lokasi PKD wajib diisi. Tambahkan lokasi terlebih dahulu di bagian bawah halaman.', 'error');
    return;
  }

  if (data.utusan === 'Lainnya') {
    const luarInput = form.querySelector('input[name="utusan_luar"]');
    const luarVal = luarInput ? luarInput.value.trim() : '';
    data.utusan = luarVal ? ('Lainnya - ' + luarVal) : 'Lainnya (tidak diisi)';
  }

  if (!data.nama_lengkap) { showToast('Nama lengkap wajib diisi', 'error'); return; }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const fotoInput = form.querySelector('input[name="foto"]');
    if (fotoInput && fotoInput.files && fotoInput.files[0]) {
      const f = fotoInput.files[0];
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) throw new Error(`Foto maksimal ${MAX_FILE_SIZE_MB} MB`);
      data.foto = await fileToBase64(f);
    }

    const suratInput = form.querySelector('input[name="surat_rekomendasi"]');
    if (suratInput && suratInput.files && suratInput.files[0]) {
      const f = suratInput.files[0];
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) throw new Error(`Surat maksimal ${MAX_FILE_SIZE_MB} MB`);
      data.surat_rekomendasi = await fileToBase64(f);
    }

    const res = id
      ? await AdminModule.updatePeserta(data)
      : await AdminModule.addPeserta(data);

    if (res.success) {
      showToast(id ? 'Data diperbarui' : 'Data ditambahkan', 'success');
      ctx.getModal('pesertaFormModal')?.hide();
      await AdminModule.loadAllData(true);

      // ⭐ Notify sidebar (kalau lokasi baru muncul)
      window.dispatchEvent(new CustomEvent('pkd:lokasi-updated'));
    } else {
      throw new Error(res.error || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
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
  '%c Peserta View v27.3.0 — Lokasi PKD Filter Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
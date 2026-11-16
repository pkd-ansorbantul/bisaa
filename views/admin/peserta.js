// ============================================================
// VIEW: peserta.js — Full Fix v26.1.2 Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/peserta.html
// ============================================================
// Fitur:
// ✅ CRUD peserta (add/edit/delete/view)
// ✅ Approve/Reject dengan auto-create akun
// ✅ Bulk move ke Alumni
// ✅ Form Builder (add/edit/delete field) + save structure
// ✅ Manajemen Lokasi PKD (CRUD + filter)
// ✅ ID Card digital (QR + download PNG)
// ✅ Kredensial + reset password
// ✅ TTD Digital viewer per peserta
// ✅ Generate sertifikat (single + batch dengan validasi)
// ✅ Bulk TTD generate untuk semua approved
// ✅ ACC semua RTL peserta
// ✅ Search, filter status, pagination
// ✅ Auto-refresh 30 detik (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
//
// v26.1.2 FIXES:
// ✅ BUG-A1: await renderDynamicForm() sebelum show modal
// ✅ BUG-A2: fix URL verify_signature.html → verifikasi_signature.html
// ✅ BUG-A3: updateBulkActionButtons() setelah render
// ✅ BUG-A4: checkbox persistence via STATE.selectedIds (Set)
// ✅ BUG-A5: reload formStructure setelah save
// ✅ BUG-A6: better handling empty lokasi PKD list
// ✅ BUG-A7: fileToBase64 validasi empty
// ✅ BUG-A8: reset modal saat hidden
// ✅ BUG-A9: getSelectedIds dari STATE (bukan DOM)
// ✅ Guard isSaving untuk semua handler async
// ✅ Loading state pada semua tombol
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import {
  callApi,
  showToast,
  escapeHtml,
  getUserRole,
  resetPesertaPassword as apiResetPesertaPassword,
  getLokasiPKDList as apiGetLokasiPKDList,
  addLokasiPKD as apiAddLokasiPKD,
  deleteLokasiPKD as apiDeleteLokasiPKD,
} from '../../js/core/api.js';

// ============================================================
//   MODULE STATE
// ============================================================
let refreshInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;
let isSaving = false;

const STATE = {
  pesertaList: [],
  filteredList: [],
  formStructure: [],
  rtlData: [],
  approvalsData: [],
  lokasiPKDList: [],
  searchQuery: '',
  statusFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
  pendingDeleteId: null,
  pendingCredentialId: null,
  selectedIds: new Set(),  // ✅ BUG-A4: persist across renders
  isLoadingFormStructure: false,
  isLoadingLokasiPKD: false,
  modals: {},
};

const listeners = [];

// ============================================================
//   UTILITY
// ============================================================
function on(el, ev, handler, options) {
  if (!el) return null;
  el.addEventListener(ev, handler, options);
  listeners.push({ el, ev, handler, options });
  return handler;
}

function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function getEl(id) {
  return document.getElementById(id);
}

function getModal(id) {
  const el = getEl(id);
  if (!el) return null;
  if (!STATE.modals[id]) {
    try {
      STATE.modals[id] = new bootstrap.Modal(el);
    } catch (e) {
      console.warn('[PesertaView] Gagal init modal:', id, e);
      return null;
    }
  }
  return STATE.modals[id];
}

function disposeAllModals() {
  Object.keys(STATE.modals).forEach(id => {
    try { STATE.modals[id]?.dispose?.(); } catch (e) { /* silent */ }
  });
  STATE.modals = {};
}

function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${loadingText || 'Memuat...'}`;
  }
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('File kosong'));
      return;
    }
    if (file.size === 0) {
      reject(new Error('File berukuran 0 byte'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!result || typeof result !== 'string') {
        reject(new Error('Hasil baca file tidak valid'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[PesertaView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[PesertaView] mounted');

  // Reset state
  STATE.pesertaList = [];
  STATE.filteredList = [];
  STATE.rtlData = [];
  STATE.approvalsData = [];
  STATE.searchQuery = '';
  STATE.statusFilter = '';
  STATE.currentPage = 1;
  STATE.pendingDeleteId = null;
  STATE.pendingCredentialId = null;
  STATE.selectedIds.clear();
  isSaving = false;

  // Reset form
  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterStatus');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // Initial render
  renderSkeletonTable();
  renderSkeletonFormBuilder();

  // Bind events
  bindTopLevelEvents();
  bindFormBuilderEvents();
  bindLokasiPKDEvents();
  bindModalEvents();

  // Load data paralel
  await Promise.allSettled([
    loadPesertaData(false).catch(e => console.error('[PesertaView] loadPesertaData:', e)),
    loadFormStructure().catch(e => console.error('[PesertaView] loadFormStructure:', e)),
    loadLokasiPKD().catch(e => console.error('[PesertaView] loadLokasiPKD:', e)),
  ]);

  loadPkdLokasiSetting().catch(() => {});

  // Auto refresh 30s
  refreshInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    AdminModule.loadAllData(false)
      .then(() => {
        const fresh = AdminModule.getPesertaList() || [];
        if (JSON.stringify(STATE.pesertaList) !== JSON.stringify(fresh)) {
          STATE.pesertaList = fresh;
          renderStats();
          applyFiltersAndSort();
          updateCacheStatus('Live');
        }
      })
      .catch(() => updateCacheStatus('Offline'))
      .finally(() => { isRefreshing = false; });
  }, 30000);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[PesertaView] unmounted');

  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  disposeAllModals();

  try {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } catch (e) { /* silent */ }
}

// ============================================================
//   BIND: Top-Level Events
// ============================================================
function bindTopLevelEvents() {
  on(getEl('addPesertaBtn'), 'click', (e) => {
    handleAddPeserta(e).catch(err => showToast('Gagal: ' + err.message, 'error'));
  });
  on(getEl('exportDataBtn'), 'click', handleExport);
  on(getEl('moveToAlumniBtn'), 'click', handleMoveToAlumni);
  on(getEl('refreshDataBtn'), 'click', handleRefresh);
  on(getEl('bulkGenerateTTDBtn'), 'click', handleBulkTTD);
  on(getEl('generateCertificateBtn'), 'click', handleGenerateCert);

  on(getEl('searchInput'), 'input', handleSearchInput);
  on(getEl('filterStatus'), 'change', handleStatusFilterChange);
}

// ============================================================
//   BIND: Form Builder
// ============================================================
function bindFormBuilderEvents() {
  on(getEl('addFieldBtn'), 'click', handleAddField);
  on(getEl('saveFormStructureBtn'), 'click', handleSaveFormStructure);
  on(getEl('saveFieldBtn'), 'click', handleSaveField);

  on(getEl('fieldType'), 'change', function () {
    const group = getEl('fieldOptionsGroup');
    if (group) {
      group.style.display =
        (this.value === 'radio' || this.value === 'select') ? 'block' : 'none';
    }
  });
}

// ============================================================
//   BIND: Lokasi PKD
// ============================================================
function bindLokasiPKDEvents() {
  on(getEl('addLokasiBtn'), 'click', handleAddLokasi);
  on(getEl('savePkdLokasiBtn'), 'click', handleSavePkdLokasi);
}

// ============================================================
//   BIND: Modal Actions
// ============================================================
function bindModalEvents() {
  on(getEl('savePesertaBtn'), 'click', handleSavePeserta);
  on(getEl('confirmDeleteBtn'), 'click', handleConfirmDelete);
  on(getEl('resetCredentialPasswordBtn'), 'click', handleResetPassword);
  on(getEl('generateCertSubmit'), 'click', handleGenerateCertSubmit);

  // ✅ BUG-A8: Reset modal form saat hidden
  const pesertaFormModalEl = getEl('pesertaFormModal');
  if (pesertaFormModalEl) {
    on(pesertaFormModalEl, 'hidden.bs.modal', () => {
      const container = getEl('dynamicAdminFormContainer');
      if (container) container.innerHTML = '';
      const editId = getEl('editPesertaId');
      if (editId) editId.value = '';
    });
  }

  // Reset field editor saat hidden
  const fieldEditorModalEl = getEl('fieldEditorModal');
  if (fieldEditorModalEl) {
    on(fieldEditorModalEl, 'hidden.bs.modal', () => {
      const editId = getEl('editFieldId');
      if (editId) editId.value = '';
    });
  }
}

// ============================================================
//   LOAD DATA PESERTA
// ============================================================
async function loadPesertaData(forceRefresh = false) {
  updateCacheStatus('Memuat...');
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }

    STATE.pesertaList = AdminModule.getPesertaList() || [];

    // Load RTL & approvals (untuk validasi sertifikat)
    try {
      const [rtlRes, apRes] = await Promise.all([
        callApi('getRTLTasks', {}, 'GET'),
        callApi('getAllDigitalApprovals', {}, 'GET'),
      ]);
      STATE.rtlData = (rtlRes && rtlRes.data) ? rtlRes.data
        : (Array.isArray(rtlRes) ? rtlRes : []);
      STATE.approvalsData = (apRes && apRes.data) ? apRes.data
        : (Array.isArray(apRes) ? apRes : []);
    } catch (e) {
      console.warn('[PesertaView] Gagal load RTL/approvals:', e);
      STATE.rtlData = [];
      STATE.approvalsData = [];
    }

    renderStats();
    applyFiltersAndSort();
    updateCacheStatus('Live');
  } catch (e) {
    console.error('[PesertaView] load error:', e);
    const c = getEl('pesertaTableContainer');
    if (c && STATE.pesertaList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger">Gagal memuat data: ${escapeHtml(e.message)}</div>`;
    }
    updateCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: Stats
// ============================================================
function renderStats() {
  const list = STATE.pesertaList;
  const total = list.length;
  const pending = list.filter(p => String(p.status || '').toLowerCase() === 'pending').length;
  const approved = list.filter(p => {
    const s = String(p.status || '').toLowerCase();
    return s === 'approved' || s === 'active';
  }).length;
  const alumni = list.filter(p => String(p.status || '').toLowerCase() === 'alumni').length;

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotal', total);
  setText('statPending', pending);
  setText('statApproved', approved);
  setText('statAlumni', alumni);
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredPeserta(query, status) {
  let filtered = STATE.pesertaList;

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
  let filtered = getFilteredPeserta(STATE.searchQuery, STATE.statusFilter);

  filtered.sort((a, b) => {
    const aIsAlumni = String(a.status || '').toLowerCase().trim() === 'alumni';
    const bIsAlumni = String(b.status || '').toLowerCase().trim() === 'alumni';
    if (aIsAlumni && !bIsAlumni) return 1;
    if (!aIsAlumni && bIsAlumni) return -1;
    const aT = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bT = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return bT - aT;
  });

  STATE.filteredList = filtered;
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;
  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  renderTable(filtered.slice(start, end), totalItems);
}

// ============================================================
//   RENDER: Table Skeleton
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
function renderTable(data, totalItems) {
  const c = getEl('pesertaTableContainer');
  if (!c) return;

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

  if (data.length === 0) {
    html += `<tr><td colspan="9" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      ${(STATE.searchQuery || STATE.statusFilter) ? 'Tidak ada peserta sesuai filter.' : 'Tidak ada data peserta.'}
    </td></tr>`;
  } else {
    data.forEach((item, i) => {
      const globalIdx = (STATE.currentPage - 1) * STATE.itemsPerPage + i + 1;
      const status = String(item.status || 'pending').toLowerCase();
      const badge = getStatusBadge(status);
      const isApproved = status === 'approved' || status === 'active';
      const safeId = escapeHtml(String(item.id));
      const isChecked = STATE.selectedIds.has(String(item.id));

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

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">Menampilkan ${data.length > 0 ? (STATE.currentPage - 1) * STATE.itemsPerPage + 1 : 0} - ${Math.min(STATE.currentPage * STATE.itemsPerPage, totalItems)} dari ${totalItems} data</div>
    <div class="btn-group">`;

  const maxButtons = 7;
  let startPage = Math.max(1, STATE.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) {
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-page="1">1</button>`;
    if (startPage > 2) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button type="button" class="btn btn-sm ${i === STATE.currentPage ? 'btn-primary' : 'btn-outline-secondary'}" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  bindTableEvents();

  // ✅ BUG-A3: Update bulk action buttons setelah render
  updateBulkActionButtons();
}

function bindTableEvents() {
  const c = getEl('pesertaTableContainer');
  if (!c) return;

  // Select all checkbox
  c.querySelector('#selectAllPeserta')?.addEventListener('change', function () {
    const checkboxes = c.querySelectorAll('.peserta-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = this.checked;
      const id = cb.value;
      if (this.checked) {
        STATE.selectedIds.add(String(id));
      } else {
        STATE.selectedIds.delete(String(id));
      }
    });
    updateBulkActionButtons();
  });

  // Individual checkboxes
  c.querySelectorAll('.peserta-checkbox').forEach(cb => {
    cb.addEventListener('change', function () {
      const id = String(this.value);
      if (this.checked) {
        STATE.selectedIds.add(id);
      } else {
        STATE.selectedIds.delete(id);
      }
      // Update "select all" state
      const all = c.querySelectorAll('.peserta-checkbox');
      const checked = c.querySelectorAll('.peserta-checkbox:checked');
      const selectAll = c.querySelector('#selectAllPeserta');
      if (selectAll) {
        selectAll.checked = all.length > 0 && all.length === checked.length;
        selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
      }
      updateBulkActionButtons();
    });
  });

  // Action buttons
  c.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      handleRowAction(this.dataset.action, this.dataset.id);
    });
  });

  // Pagination
  c.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', function () {
      STATE.currentPage = parseInt(this.dataset.page);
      applyFiltersAndSort();
    });
  });
}

function updateBulkActionButtons() {
  const count = STATE.selectedIds.size;
  const btn = getEl('moveToAlumniBtn');
  if (btn) btn.disabled = count === 0;
}

// ✅ BUG-A9: Ambil dari STATE, bukan DOM
function getSelectedIds() {
  return Array.from(STATE.selectedIds);
}

// ============================================================
//   ROW ACTION ROUTER
// ============================================================
function handleRowAction(action, id) {
  switch (action) {
    case 'view':       return viewPeserta(id);
    case 'edit':       return editPeserta(id).catch(e => showToast('Gagal: ' + e.message, 'error'));
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
async function handleAddPeserta(e) {
  const btn = e?.currentTarget || getEl('addPesertaBtn');
  const editId = getEl('editPesertaId');
  const title = getEl('formModalTitle');
  if (editId) editId.value = '';
  if (title) title.innerText = 'Tambah Peserta';

  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    // ✅ BUG-A1: await renderDynamicForm sebelum show modal
    await renderDynamicForm(null);
    getModal('pesertaFormModal')?.show();
  } catch (err) {
    showToast('Gagal memuat form: ' + err.message, 'error');
  } finally {
    restore();
  }
}

function viewPeserta(id) {
  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  let html = '<div class="list-group list-group-flush">';
  STATE.formStructure.forEach(field => {
    const val = item[field.id] || '-';
    html += `<div class="list-group-item py-2"><strong>${escapeHtml(field.label)}:</strong> ${escapeHtml(String(val))}</div>`;
  });
  html += `<div class="list-group-item py-2"><strong>Lokasi PKD:</strong> ${escapeHtml(item.lokasi_pkd || '-')}</div>`;
  html += `<div class="list-group-item py-2"><strong>Status:</strong> <span class="badge ${getStatusBadge(item.status)}">${escapeHtml(item.status || 'pending')}</span></div>`;
  html += '</div>';

  const detailContent = getEl('detailContent');
  if (detailContent) detailContent.innerHTML = html;

  getModal('detailPesertaModal')?.show();
}

async function editPeserta(id) {
  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const editId = getEl('editPesertaId');
  const title = getEl('formModalTitle');
  if (editId) editId.value = id;
  if (title) title.innerText = 'Edit Peserta';

  // ✅ BUG-A1: await renderDynamicForm sebelum show modal
  await renderDynamicForm(item);
  getModal('pesertaFormModal')?.show();
}

function confirmDelete(id) {
  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }
  STATE.pendingDeleteId = id;
  getModal('deleteConfirmModal')?.show();
}

async function handleConfirmDelete(e) {
  if (isSaving) return;

  const id = STATE.pendingDeleteId;
  if (!id) return;

  const btn = e?.currentTarget || getEl('confirmDeleteBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await AdminModule.deletePeserta(id);
    if (res.success) {
      showToast('Peserta berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();
      STATE.selectedIds.delete(String(id));
      await loadPesertaData(true);
    } else {
      throw new Error(res.error || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
    STATE.pendingDeleteId = null;
  }
}

// ============================================================
//   APPROVE
// ============================================================
async function approvePeserta(id) {
  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!item) return;
  if (!confirm(`Setujui peserta "${item.nama_lengkap}"? Akun login akan otomatis dibuat.`)) return;

  try {
    const res = await AdminModule.approvePeserta(id);
    if (res.success) {
      showToast('Peserta disetujui! Password default = No HP.', 'success');
      await loadPesertaData(true);
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
    STATE.pendingCredentialId = id;

    const setText = (elId, val) => {
      const el = getEl(elId);
      if (el) el.innerText = val;
    };
    setText('credentialNama', res.data.nama_lengkap || '-');
    setText('credentialUsername', res.data.username || '-');
    setText('credentialPasswordHint', res.data.passwordHint || 'No HP terdaftar');

    getModal('credentialModal')?.show();
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function handleResetPassword(e) {
  if (isSaving) return;

  const id = STATE.pendingCredentialId;
  if (!id) { showToast('Data tidak valid', 'error'); return; }

  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Peserta tidak ditemukan', 'error'); return; }

  const newPassword = item.no_hp;
  if (!newPassword) { showToast('Peserta tidak punya No HP terdaftar', 'error'); return; }

  if (!confirm(`Reset password untuk "${item.nama_lengkap}" ke No HP (${newPassword})?`)) return;

  const btn = e?.currentTarget || getEl('resetCredentialPasswordBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  try {
    const res = await apiResetPesertaPassword(id, newPassword);
    if (res && res.success) {
      showToast('Password berhasil direset ke No HP.', 'success');
      getModal('credentialModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal reset password');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   ID CARD
// ============================================================
function showIdCard(id) {
  const item = STATE.pesertaList.find(p => String(p.id) === String(id));
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
          <img src="/bisaa/LOGO%20ANSOR.webp" alt="Ansor">
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
    </div>
  `;

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
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      for (let r = 0; r < moduleCount; r++) {
        for (let col = 0; col < moduleCount; col++) {
          if (qr.isDark(r, col)) {
            ctx.fillStyle = '#000000';
            ctx.fillRect(margin + col * cellSize, margin + r * cellSize, cellSize, cellSize);
          }
        }
      }
      qrTarget.appendChild(canvas);
    } catch (err) {
      console.warn('[PesertaView] QR generate error:', err);
      qrTarget.innerHTML = '<div class="text-muted small">QR error</div>';
    }
  } else if (qrTarget) {
    qrTarget.innerHTML = '<div class="text-muted small">QR library tidak tersedia</div>';
  }

  getModal('adminIdCardModal')?.show();

  // Bind download button
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
//   TTD DIGITAL VIEW — FIXED URL path
// ============================================================
async function showTTD(id) {
  const peserta = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!peserta) { showToast('Peserta tidak ditemukan', 'error'); return; }
  const nama = peserta.nama_lengkap;

  try {
    const res = await callApi('getAllDigitalApprovals', {}, 'GET');
    const all = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
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

        // ✅ BUG-A2 FIX: URL yang benar adalah verifikasi_signature.html
        const verifyUrl = `${window.location.origin}/bisaa/verifikasi_signature.html?role=${encodeURIComponent(role)}&driveId=${encodeURIComponent(a.driveId)}`;

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
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 200, 200);
            ctx.strokeStyle = '#d1d5db';
            ctx.lineWidth = 4;
            ctx.strokeRect(0, 0, 200, 200);
            const padding = 16;
            const cellSize = (200 - padding * 2) / moduleCount;
            for (let r = 0; r < moduleCount; r++) {
              for (let col = 0; col < moduleCount; col++) {
                if (qr.isDark(r, col)) {
                  ctx.fillStyle = '#000000';
                  ctx.fillRect(padding + col * cellSize, padding + r * cellSize, cellSize, cellSize);
                }
              }
            }
            qrUrl = canvas.toDataURL('image/png');
          } catch (err) {
            console.warn('[PesertaView] TTD QR error:', err);
          }
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

    getModal('ttdModal')?.show();
  } catch (e) {
    showToast('Gagal memuat TTD: ' + e.message, 'error');
  }
}

// ============================================================
//   ACC RTL
// ============================================================
async function approveRTL(id) {
  const peserta = STATE.pesertaList.find(p => String(p.id) === String(id));
  if (!peserta) return;

  if (!confirm(`Setujui SEMUA tugas RTL untuk "${peserta.nama_lengkap}"?`)) return;

  try {
    const res = await callApi('approveAllRTL', { pesertaId: id }, 'POST');
    if (res.success) {
      showToast(`Semua RTL disetujui (${res.updated || 0} tugas)`, 'success');
      await loadPesertaData(true);
    } else {
      throw new Error(res.error || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   GENERATE SERTIFIKAT
// ============================================================
function isEligible(p) {
  const status = String(p.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'active') {
    return { eligible: false, reason: 'Status belum disetujui' };
  }

  const tasks = STATE.rtlData.filter(t => String(t.pesertaId) === String(p.id));
  if (tasks.length > 0 && !tasks.every(t => String(t.status).toLowerCase() === 'selesai')) {
    return { eligible: false, reason: 'RTL belum selesai' };
  }

  const nama = p.nama_lengkap;
  const filtered = STATE.approvalsData.filter(a =>
    String(a.peserta_nama || '').toLowerCase().trim() === String(nama || '').toLowerCase().trim()
  );
  const has = role => filtered.some(a => a.role === role);
  if (!has('ketua_pc') || !has('sekretaris') || !has('instruktur')) {
    return { eligible: false, reason: 'TTD belum lengkap' };
  }
  return { eligible: true };
}

async function generateCertForOne(id) {
  const peserta = STATE.pesertaList.find(p => String(p.id) === String(id));
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
      sel.innerHTML = '<option value="">-- Pilih Template --</option>' +
        templates.map(t => `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.nama_template)}</option>`).join('');
    }

    const participants = STATE.pesertaList.filter(p => ids.includes(String(p.id)));
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
      submitBtn.disabled = !allValid;
      submitBtn.dataset.ids = JSON.stringify(ids);
    }

    const progressEl = getEl('generateProgress');
    if (progressEl) progressEl.style.display = 'none';

    const resultEl = getEl('generateResultArea');
    if (resultEl) resultEl.innerHTML = '';

    getModal('generateCertModal')?.show();
  } catch (e) {
    showToast('Gagal membuka modal: ' + e.message, 'error');
  }
}

async function handleGenerateCertSubmit(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('generateCertSubmit');
  if (!btn) return;

  let ids;
  try {
    ids = JSON.parse(btn.dataset.ids || '[]');
  } catch (err) { ids = []; }

  const templateId = getEl('certTemplateSelect')?.value;
  if (!templateId) { showToast('Pilih template dulu', 'warning'); return; }

  const participants = STATE.pesertaList.filter(p => ids.includes(String(p.id)));
  const valid = participants.filter(p => isEligible(p).eligible);

  if (valid.length === 0) {
    showToast('Tidak ada peserta yang memenuhi syarat', 'warning');
    return;
  }

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  const progressEl = getEl('generateProgress');
  if (progressEl) progressEl.style.display = 'block';

  const results = [];
  const errors = [];

  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const progressText = getEl('generateProgressText');
    const progressBar = document.querySelector('#generateProgress .progress-bar');
    if (progressText) progressText.innerText = `Memproses ${i + 1}/${valid.length}: ${p.nama_lengkap}`;
    if (progressBar) progressBar.style.width = ((i + 1) / valid.length * 100) + '%';

    try {
      const res = await callApi('generateCertificateForParticipant', { templateId, pesertaId: p.id }, 'POST');
      if (res && res.success) {
        results.push({ nama: p.nama_lengkap, nomor: res.nomorSertifikat, url: res.pdfUrl });
      } else {
        errors.push({ nama: p.nama_lengkap, error: (res && res.error) || 'Gagal' });
      }
    } catch (err) {
      errors.push({ nama: p.nama_lengkap, error: err.message });
    }
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
    errors.forEach(err => {
      html += `<li>${escapeHtml(err.nama)}: ${escapeHtml(err.error)}</li>`;
    });
    html += `</ul></div>`;
  }

  const resultEl = getEl('generateResultArea');
  if (resultEl) resultEl.innerHTML = html;

  restore();
  isSaving = false;
}

// ============================================================
//   BULK TTD
// ============================================================
async function handleBulkTTD(e) {
  if (isSaving) return;

  if (!confirm('Generate TTD digital untuk SEMUA peserta approved/active? Ini akan memakan waktu.')) return;

  const btn = e?.currentTarget || getEl('bulkGenerateTTDBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  try {
    const res = await callApi('bulkGenerateTTD', {}, 'POST');
    if (res && res.success) {
      showToast(`Berhasil generate ${res.addedCount || 0} TTD untuk ${res.totalPeserta || 0} peserta`, 'success');
      await loadPesertaData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   MOVE TO ALUMNI
// ============================================================
async function handleMoveToAlumni(e) {
  if (isSaving) return;

  const ids = getSelectedIds();
  if (ids.length === 0) { showToast('Pilih minimal satu peserta', 'warning'); return; }
  if (!confirm(`Pindahkan ${ids.length} peserta ke Alumni?`)) return;

  const btn = e?.currentTarget || getEl('moveToAlumniBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    const res = await AdminModule.moveMultipleToAlumni(ids);
    if (res.success) {
      showToast(`Berhasil memindahkan ${res.moved || ids.length} peserta ke Alumni`, 'success');
      STATE.selectedIds.clear();
      await loadPesertaData(true);
    } else {
      throw new Error(res.error || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('refreshDataBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    await loadPesertaData(true);
    showToast('Data berhasil disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   SEARCH & FILTER
// ============================================================
function handleSearchInput(e) {
  clearTimeout(searchDebounceTimer);
  const value = e.target.value;
  searchDebounceTimer = setTimeout(() => {
    STATE.searchQuery = value;
    STATE.currentPage = 1;
    applyFiltersAndSort();
  }, 300);
}

function handleStatusFilterChange(e) {
  STATE.statusFilter = e.target.value;
  STATE.currentPage = 1;
  applyFiltersAndSort();
}

// ============================================================
//   EXPORT
// ============================================================
function handleExport() {
  const data = STATE.filteredList;
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
    a.href = url;
    a.download = `peserta_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Ekspor ${data.length} data berhasil`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   FORM BUILDER
// ============================================================
async function loadFormStructure() {
  if (STATE.isLoadingFormStructure) return;
  STATE.isLoadingFormStructure = true;

  try {
    const apiRes = await callApi('getFormSettings', {}, 'GET');
    let raw = (apiRes && apiRes.data) ? apiRes.data : null;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch (e) { raw = null; }
    }

    if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
      const correct = raw.find(cfg => Array.isArray(cfg) && cfg.find(f => f.id === 'surat_rekomendasi' && f.required === false));
      STATE.formStructure = correct || raw[0];
    } else if (Array.isArray(raw) && raw.length > 0) {
      STATE.formStructure = raw;
    } else {
      STATE.formStructure = getDefaultFormFieldsLocal();
    }
    renderFormStructure();
  } catch (e) {
    console.warn('[PesertaView] loadFormStructure:', e);
    STATE.formStructure = getDefaultFormFieldsLocal();
    renderFormStructure();
  } finally {
    STATE.isLoadingFormStructure = false;
  }
}

function getDefaultFormFieldsLocal() {
  return [
    { id: 'nama_lengkap', label: 'Nama Lengkap', type: 'text', options: '', required: true, isCore: true },
    { id: 'tempat_tgl_lahir', label: 'Tempat & Tanggal Lahir', type: 'text', options: '', required: true, isCore: true },
    { id: 'pekerjaan', label: 'Pekerjaan', type: 'text', options: '', required: true, isCore: true },
    { id: 'pendidikan_terakhir', label: 'Pendidikan Terakhir', type: 'text', options: '', required: true, isCore: true },
    { id: 'alamat', label: 'Alamat', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'no_hp', label: 'No HP', type: 'text', options: '', required: true, isCore: true },
    { id: 'email', label: 'Email', type: 'text', options: '', required: true, isCore: true },
    { id: 'utusan', label: 'Utusan (PAC)', type: 'select', options: 'PAC Bantul,PAC Banguntapan,PAC Sewon,PAC Kasihan,PAC Pajangan,PAC Sedayu,PAC Pandak,PAC Piyungan,PAC Pleret,PAC Jetis,PAC Imogiri,PAC Dlingo,PAC Bambanglipuro,PAC Sanden,PAC Kretek,PAC Pundong,PAC Srandakan,Lainnya', required: true, isCore: true },
    { id: 'pengalaman_organisasi', label: 'Pengalaman Organisasi', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'foto', label: 'Foto', type: 'file', options: '', required: true, isCore: true },
    { id: 'surat_rekomendasi', label: 'Surat Rekomendasi', type: 'file', options: '', required: false, isCore: true },
  ];
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

  if (!STATE.formStructure.length) {
    c.innerHTML = '<div class="col-12 text-center text-muted">Belum ada field.</div>';
    return;
  }

  let html = '';
  STATE.formStructure.forEach(field => {
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

  c.querySelectorAll('[data-action="edit-field"]').forEach(btn => {
    btn.addEventListener('click', function () {
      editField(this.dataset.id);
    });
  });
  c.querySelectorAll('[data-action="delete-field"]').forEach(btn => {
    btn.addEventListener('click', function () {
      deleteField(this.dataset.id);
    });
  });
}

function handleAddField() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
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

  getModal('fieldEditorModal')?.show();
}

function editField(id) {
  const f = STATE.formStructure.find(x => x.id === id);
  if (!f) return;

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };

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

  getModal('fieldEditorModal')?.show();
}

function deleteField(id) {
  if (!confirm('Hapus field ini?')) return;
  STATE.formStructure = STATE.formStructure.filter(f => f.id !== id);
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
    const idx = STATE.formStructure.findIndex(f => f.id === id);
    if (idx !== -1) {
      STATE.formStructure[idx] = { ...STATE.formStructure[idx], label, type, options, required };
    }
  } else {
    STATE.formStructure.push({
      id: 'field_' + Date.now(),
      label, type, options, required,
      isCore: false,
    });
  }

  renderFormStructure();
  getModal('fieldEditorModal')?.hide();
  showToast('Field tersimpan. Klik "Simpan Struktur" untuk menerapkan.', 'info');
}

async function handleSaveFormStructure(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('saveFormStructureBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await AdminModule.setFormSettings(STATE.formStructure);
    if (res.success) {
      showToast('Struktur form berhasil disimpan!', 'success');
      // ✅ BUG-A5: Reload form structure setelah save
      await AdminModule.loadAllData(true);
      await loadFormStructure();
    } else {
      throw new Error(res.error || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   DYNAMIC FORM (Add/Edit Peserta)
// ============================================================
async function ensureLokasiPKDLoaded() {
  if (STATE.lokasiPKDList && STATE.lokasiPKDList.length > 0) return;
  if (STATE.isLoadingLokasiPKD) return;
  STATE.isLoadingLokasiPKD = true;
  try {
    const res = await apiGetLokasiPKDList();
    STATE.lokasiPKDList = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
  } catch (e) {
    STATE.lokasiPKDList = [];
  } finally {
    STATE.isLoadingLokasiPKD = false;
  }
}

async function renderDynamicForm(data) {
  const c = getEl('dynamicAdminFormContainer');
  if (!c) return;

  const fields = STATE.formStructure.length > 0 ? STATE.formStructure : getDefaultFormFieldsLocal();
  await ensureLokasiPKDLoaded();
  const lokasiList = STATE.lokasiPKDList;

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

  // Status
  const currentStatus = data ? (data.status || 'pending') : 'pending';
  const statusOptions = ['pending', 'approved', 'active', 'alumni', 'rejected'];
  html += `<div class="mb-3">
    <label class="form-label fw-bold">Status Peserta <span class="text-danger">*</span></label>
    <select class="form-select" name="status" required>
      ${statusOptions.map(o => `<option value="${o}" ${currentStatus === o ? 'selected' : ''}>${o.charAt(0).toUpperCase() + o.slice(1)}</option>`).join('')}
    </select>
    <div class="form-text text-muted small">⚠️ Status <strong>Approved</strong> akan membuat akun login. Status <strong>Alumni</strong> akan memindahkan ke daftar Alumni.</div>
  </div>`;

  // ✅ BUG-A6: Better handling empty lokasi list
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

  // Bind utusan "Lainnya" toggle
  const utusanSel = c.querySelector('select[name="utusan"]');
  const luarContainer = c.querySelector('#utusanLuarContainerAdmin');
  if (utusanSel && luarContainer) {
    utusanSel.onchange = function () {
      luarContainer.style.display = this.value === 'Lainnya' ? 'block' : 'none';
    };
  }
}

// ============================================================
//   SAVE PESERTA
// ============================================================
async function handleSavePeserta(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('savePesertaBtn');
  const id = getEl('editPesertaId')?.value || '';
  const form = document.querySelector('#dynamicAdminFormContainer form');
  if (!form) { showToast('Form tidak ditemukan', 'error'); return; }

  const formData = new FormData(form);
  const data = { id };

  STATE.formStructure.forEach(field => {
    if (field.type === 'file') return;
    const v = formData.get(field.id);
    data[field.id] = v !== null ? v : '';
  });

  const statusSel = form.querySelector('select[name="status"]');
  data.status = statusSel ? statusSel.value : 'pending';

  const lokSel = form.querySelector('select[name="lokasi_pkd"]');
  data.lokasi_pkd = lokSel ? lokSel.value : '';

  // Check if lokasi is empty (BUG-A6 case)
  const lokasiEmpty = !data.lokasi_pkd;
  if (lokasiEmpty) {
    showToast('Lokasi PKD wajib diisi. Tambahkan lokasi terlebih dahulu di bagian bawah halaman.', 'error');
    return;
  }

  if (data.utusan === 'Lainnya') {
    const luarInput = form.querySelector('input[name="utusan_luar"]');
    const luarVal = luarInput ? luarInput.value.trim() : '';
    data.utusan = luarVal ? ('Lainnya - ' + luarVal) : 'Lainnya (tidak diisi)';
  }

  if (!data.nama_lengkap) { showToast('Nama lengkap wajib diisi', 'error'); return; }

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    // Files
    const fotoInput = form.querySelector('input[name="foto"]');
    if (fotoInput && fotoInput.files && fotoInput.files[0]) {
      const f = fotoInput.files[0];
      if (f.size > 5 * 1024 * 1024) {
        throw new Error('Foto maksimal 5 MB');
      }
      data.foto = await fileToBase64(f);
    }

    const suratInput = form.querySelector('input[name="surat_rekomendasi"]');
    if (suratInput && suratInput.files && suratInput.files[0]) {
      const f = suratInput.files[0];
      if (f.size > 5 * 1024 * 1024) {
        throw new Error('Surat maksimal 5 MB');
      }
      data.surat_rekomendasi = await fileToBase64(f);
    }

    const res = id
      ? await AdminModule.updatePeserta(data)
      : await AdminModule.addPeserta(data);

    if (res.success) {
      showToast(id ? 'Data diperbarui' : 'Data ditambahkan', 'success');
      getModal('pesertaFormModal')?.hide();
      await loadPesertaData(true);
    } else {
      throw new Error(res.error || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   LOKASI PKD
// ============================================================
async function loadLokasiPKD() {
  try {
    const res = await apiGetLokasiPKDList();
    STATE.lokasiPKDList = (res && res.data) ? res.data : (Array.isArray(res) ? res : []);
    renderLokasiPKDList();
  } catch (e) {
    STATE.lokasiPKDList = [];
    renderLokasiPKDList();
  }
}

function renderLokasiPKDList() {
  const c = getEl('lokasiPKDListContainer');
  if (!c) return;

  if (STATE.lokasiPKDList.length === 0) {
    c.innerHTML = '<p class="text-muted small">Belum ada lokasi PKD.</p>';
  } else {
    let html = '';
    STATE.lokasiPKDList.forEach(item => {
      html += `<div class="lokasi-pkd-item">
        <span><span class="badge bg-primary">${escapeHtml(item.nama)}</span></span>
        <button type="button" class="btn btn-sm btn-outline-danger" data-lokasi-id="${escapeHtml(String(item.id))}" aria-label="Hapus lokasi">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>`;
    });
    c.innerHTML = html;

    c.querySelectorAll('[data-lokasi-id]').forEach(btn => {
      btn.addEventListener('click', function () {
        deleteLokasiPKDItem(this.dataset.lokasiId);
      });
    });
  }

  const sel = getEl('pkdLokasiSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Semua Lokasi --</option>';
    STATE.lokasiPKDList.forEach(l => {
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
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function handleAddLokasi(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('addLokasiBtn');
  const input = getEl('newLokasiInput');
  const nama = input ? input.value.trim() : '';
  if (!nama) { showToast('Nama lokasi wajib diisi', 'error'); return; }

  isSaving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    const res = await apiAddLokasiPKD(nama);
    if (res && res.success) {
      showToast('Lokasi ditambahkan', 'success');
      if (input) input.value = '';
      await loadLokasiPKD();
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

async function loadPkdLokasiSetting() {
  try {
    const res = await callApi('getPKDLokasi', {}, 'GET');
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
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('savePkdLokasiBtn');
  const lokasi = getEl('pkdLokasiSelect')?.value || '';

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

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
    isSaving = false;
  }
}

// ============================================================
//   UTILITY
// ============================================================
function getStatusBadge(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'approved' || s === 'active') return 'bg-success';
  if (s === 'rejected') return 'bg-danger';
  if (s === 'alumni') return 'bg-secondary';
  return 'bg-warning text-dark';
}

function updateCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  el.className = 'cache-status ' + (
    status === 'Live' ? 'live'
      : status === 'Offline' ? 'offline'
        : ''
  );
}
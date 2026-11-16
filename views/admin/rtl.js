// ============================================================
// VIEW: rtl.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/rtl.html
// ============================================================
// Fitur:
// ✅ CRUD tugas RTL (add/edit/delete/detail)
// ✅ Bulk approve (filtered tasks)
// ✅ Filter status (pending/selesai)
// ✅ Filter peserta (dropdown auto-populate)
// ✅ Search debounced
// ✅ Sort (judul, deadline, status)
// ✅ Pagination
// ✅ Upload file attachment
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
// ============================================================

import { showToast, escapeHtml } from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
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
  pendingDeleteId: null,
  isSaving: false,
  isBulkProcessing: false,
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
    STATE.modals[id] = new bootstrap.Modal(el);
  }
  return STATE.modals[id];
}

function disposeAllModals() {
  Object.keys(STATE.modals).forEach(id => {
    try { STATE.modals[id]?.dispose?.(); } catch (e) {}
  });
  STATE.modals = {};
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const s = String(dateStr);
    const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return '-'; }
}

function getStatusBadge(status) {
  return String(status || '').toLowerCase() === 'selesai'
    ? 'bg-success'
    : 'bg-warning text-dark';
}

function isTaskDone(task) {
  return String(task.status || '').toLowerCase() === 'selesai';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[RTLView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[RTLView] mounted');

  // Reset state
  STATE.rtlList = [];
  STATE.pesertaList = [];
  STATE.filteredList = [];
  STATE.searchQuery = '';
  STATE.statusFilter = '';
  STATE.pesertaFilter = '';
  STATE.sortColumn = 'deadline';
  STATE.sortDirection = 'asc';
  STATE.currentPage = 1;
  STATE.pendingDeleteId = null;
  STATE.isSaving = false;
  STATE.isBulkProcessing = false;

  // Reset form filter
  const searchEl = getEl('searchInput');
  const statusEl = getEl('filterStatus');
  const pesertaEl = getEl('filterPeserta');
  if (searchEl) searchEl.value = '';
  if (statusEl) statusEl.value = '';
  if (pesertaEl) pesertaEl.value = '';

  renderSkeleton();
  await loadData(true);
  bindEvents();

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    loadData(false)
      .catch(() => {})
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
  console.log('[RTLView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) {}
  });
  listeners.length = 0;

  disposeAllModals();

  try {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } catch (e) {}
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  const searchEl = getEl('searchInput');
  const statusEl = getEl('filterStatus');
  const pesertaEl = getEl('filterPeserta');

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFiltersAndSort();
  }, 300));

  on(statusEl, 'change', function (e) {
    STATE.statusFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(pesertaEl, 'change', function (e) {
    STATE.pesertaFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(getEl('addRTLBtn'), 'click', openAddModal);
  on(getEl('bulkApproveBtn'), 'click', bulkApprove);

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await loadData(true);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  on(getEl('saveRTLBtn'), 'click', saveRTL);
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('rtlTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(8).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(5).fill(0).map(() =>
        `<tr>${Array(8).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = STATE.rtlList.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q) ||
      String(item.namaPeserta || '').toLowerCase().includes(q)
    );
  }

  if (STATE.statusFilter !== '') {
    arr = arr.filter(item =>
      String(item.status || 'pending').toLowerCase() === STATE.statusFilter
    );
  }

  if (STATE.pesertaFilter !== '') {
    arr = arr.filter(item =>
      String(item.pesertaId || '') === STATE.pesertaFilter ||
      String(item.namaPeserta || '') === STATE.pesertaFilter
    );
  }

  if (STATE.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (STATE.sortColumn === 'deadline') {
        va = new Date(a.deadline || 0).getTime();
        vb = new Date(b.deadline || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else {
        va = String(a[STATE.sortColumn] || '').toLowerCase();
        vb = String(b[STATE.sortColumn] || '').toLowerCase();
      }
      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  return arr;
}

function applyFiltersAndSort() {
  STATE.filteredList = getFiltered();
  STATE.currentPage = 1;
  renderTable();
}

// ============================================================
//   RENDER TABLE
// ============================================================
function renderTable() {
  const c = getEl('rtlTableContainer');
  if (!c) return;

  const totalItems = STATE.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;

  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = STATE.filteredList.slice(start, end);

  const arrow = (col) => {
    if (STATE.sortColumn !== col) return '↕';
    return STATE.sortDirection === 'asc' ? '↑' : '↓';
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
    const hasFilter = STATE.searchQuery || STATE.statusFilter || STATE.pesertaFilter;
    html += `<tr><td colspan="8" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
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
        fileHtml = `<a href="https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view"
                       target="_blank" rel="noopener" class="btn btn-sm btn-outline-info" title="Lihat File">
                      <i class="bi bi-file-earmark"></i>
                    </a>`;
      }

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
        <td><small>${escapeHtml(item.deskripsi || '-')}</small></td>
        <td>${escapeHtml(formatDate(item.deadline))}</td>
        <td><span class="badge ${badge}">${escapeHtml(item.status || 'pending')}</span></td>
        <td>${escapeHtml(item.namaPeserta || 'Umum')}</td>
        <td class="text-center">${fileHtml}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}" title="Detail">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          ${!done ? `<button class="btn btn-sm btn-outline-success me-1" data-action="approve" data-id="${safeId}" title="Tandai Selesai">
            <i class="bi bi-check-circle"></i>
          </button>` : ''}
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  // Pagination
  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">Menampilkan ${pageData.length > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data</div>
    <div class="btn-group">`;

  const maxButtons = 7;
  let startPage = Math.max(1, STATE.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) startPage = Math.max(1, endPage - maxButtons + 1);

  if (startPage > 1) {
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="1">1</button>`;
    if (startPage > 2) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${i === STATE.currentPage ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTableAction);
  });
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

function handleTableAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id;
  const page = parseInt(e.currentTarget.dataset.page);

  switch (action) {
    case 'detail':  return viewRTL(id);
    case 'edit':    return editRTL(id);
    case 'approve': return approveRTL(id);
    case 'delete':  return deleteRTL(id);
    case 'goto':    return goToPage(page);
  }
}

function handleSort(col) {
  if (STATE.sortColumn === col) {
    STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortColumn = col;
    STATE.sortDirection = 'asc';
  }
  STATE.currentPage = 1;
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
  getEl('rtlTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    STATE.rtlList = AdminModule.getRTLList() || [];
    STATE.pesertaList = AdminModule.getPesertaList() || [];

    renderPesertaDropdowns();
    applyFiltersAndSort();

    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[RTLView] loadData error:', e);
    const c = getEl('rtlTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    if (cacheEl) {
      cacheEl.textContent = 'Error';
      cacheEl.className = 'cache-status offline';
    }
  }
}

function renderPesertaDropdowns() {
  const filterSel = getEl('filterPeserta');
  const modalSel = getEl('rtlPeserta');

  const optionsHtml = STATE.pesertaList.map(p => {
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
  const item = STATE.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const badge = getStatusBadge(item.status);
  let fileHtml = '-';
  if (item.fileDriveId) {
    fileHtml = `<a href="https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view"
                 target="_blank" rel="noopener" class="btn btn-sm btn-outline-info">
                 <i class="bi bi-box-arrow-up-right me-1"></i> Lihat File
               </a>`;
  }

  const content = getEl('detailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Judul:</strong><br>${escapeHtml(item.judul || '-')}</div>
      <div class="list-group-item py-3"><strong>Deskripsi:</strong><br>${escapeHtml(item.deskripsi || '-')}</div>
      <div class="list-group-item py-3"><strong>Deadline:</strong> ${escapeHtml(formatDate(item.deadline))}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> <span class="badge ${badge}">${escapeHtml(item.status || 'pending')}</span></div>
      <div class="list-group-item py-3"><strong>Peserta:</strong> ${escapeHtml(item.namaPeserta || 'Umum (semua peserta)')}</div>
      <div class="list-group-item py-3"><strong>File:</strong> ${fileHtml}</div>
      <div class="list-group-item py-3"><strong>Catatan:</strong><br>${escapeHtml(item.catatan || '-')}</div>
    </div>`;

  getModal('detailRTLModal')?.show();
}

function editRTL(id) {
  const item = STATE.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  getEl('editRTLId').value = id;
  getEl('rtlJudul').value = item.judul || '';
  getEl('rtlDeskripsi').value = item.deskripsi || '';
  getEl('rtlDeadline').value = item.deadline || '';
  getEl('rtlStatus').value = item.status || 'pending';
  getEl('rtlPeserta').value = item.pesertaId || '';
  getEl('rtlCatatan').value = item.catatan || '';
  getEl('rtlFile').value = '';
  const preview = getEl('rtlFilePreview');
  if (preview) {
    preview.innerHTML = item.fileDriveId
      ? `File saat ini: <a href="https://drive.google.com/file/d/${escapeHtml(item.fileDriveId)}/view" target="_blank" rel="noopener">Lihat</a>`
      : '';
  }
  getEl('formModalTitle').textContent = 'Edit Tugas RTL';

  getModal('rtlFormModal')?.show();
}

function openAddModal() {
  getEl('editRTLId').value = '';
  getEl('rtlJudul').value = '';
  getEl('rtlDeskripsi').value = '';
  getEl('rtlDeadline').value = new Date().toISOString().slice(0, 10);
  getEl('rtlStatus').value = 'pending';
  getEl('rtlPeserta').value = '';
  getEl('rtlCatatan').value = '';
  getEl('rtlFile').value = '';
  const preview = getEl('rtlFilePreview');
  if (preview) preview.innerHTML = '';
  getEl('formModalTitle').textContent = 'Tambah Tugas RTL';

  getModal('rtlFormModal')?.show();
}

function deleteRTL(id) {
  STATE.pendingDeleteId = id;
  getEl('deleteRTLId').value = id;
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const id = getEl('deleteRTLId').value;
  if (!id) return;

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await AdminModule.deleteRTLTask(id);
    if (res && res.success) {
      STATE.rtlList = STATE.rtlList.filter(x => String(x.id) !== String(id));
      applyFiltersAndSort();
      showToast('Tugas RTL berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.pendingDeleteId = null;
  }
}

async function approveRTL(id) {
  const item = STATE.rtlList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (isTaskDone(item)) {
    showToast('Tugas sudah selesai', 'info');
    return;
  }

  if (!confirm(`Tandai tugas "${item.judul}" sebagai selesai?`)) return;

  try {
    const res = await AdminModule.approveRTLTask(id);
    if (res && res.success) {
      item.status = 'selesai';
      applyFiltersAndSort();
      showToast('Tugas ditandai selesai', 'success');
      setTimeout(() => loadData(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal menyetujui');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   SAVE (ADD / EDIT)
// ============================================================
async function saveRTL() {
  if (STATE.isSaving) return;

  const id = getEl('editRTLId').value;
  const judul = getEl('rtlJudul').value.trim();
  const deskripsi = getEl('rtlDeskripsi').value.trim();
  const deadline = getEl('rtlDeadline').value;
  const status = getEl('rtlStatus').value;
  const pesertaId = getEl('rtlPeserta').value;
  const catatan = getEl('rtlCatatan').value.trim();
  const fileInput = getEl('rtlFile');

  if (!judul) { showToast('Judul tugas wajib diisi', 'error'); return; }
  if (!deadline) { showToast('Deadline wajib diisi', 'error'); return; }

  // Cari nama peserta
  let namaPeserta = '';
  if (pesertaId) {
    const p = STATE.pesertaList.find(x => String(x.id) === String(pesertaId));
    if (p) namaPeserta = p.nama_lengkap || p.nama || '';
  }

  const btn = getEl('saveRTLBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    let fileData = null;
    let fileName = null;
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showToast('Ukuran file maksimal 5 MB', 'error');
        btn.disabled = false;
        btn.innerHTML = original;
        STATE.isSaving = false;
        return;
      }
      fileData = await fileToBase64(file);
      fileName = file.name;
    }

    const payload = {
      judul, deskripsi, deadline, status, pesertaId, namaPeserta, catatan,
    };
    if (fileData) {
      payload.fileDriveId = fileData;
      payload.fileName = fileName;
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
      getModal('rtlFormModal')?.hide();
      await loadData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

// ============================================================
//   BULK APPROVE (yang terfilter)
// ============================================================
async function bulkApprove() {
  if (STATE.isBulkProcessing) return;

  const pendingTasks = STATE.filteredList.filter(item => !isTaskDone(item));

  if (pendingTasks.length === 0) {
    showToast('Tidak ada tugas pending untuk disetujui', 'info');
    return;
  }

  if (!confirm(`Tandai semua ${pendingTasks.length} tugas yang terfilter sebagai selesai?`)) return;

  const btn = getEl('bulkApproveBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memproses...';
  STATE.isBulkProcessing = true;

  let successCount = 0;
  try {
    for (const task of pendingTasks) {
      try {
        const res = await AdminModule.approveRTLTask(task.id);
        if (res && res.success) successCount++;
      } catch (e) { /* continue */ }
    }
    showToast(`Berhasil menyelesaikan ${successCount} dari ${pendingTasks.length} tugas`, 'success');
    await loadData(true);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isBulkProcessing = false;
  }
}
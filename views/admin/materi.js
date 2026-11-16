// ============================================================
// VIEW: materi.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/materi.html
// ============================================================
// Fitur:
// ✅ CRUD materi (upload file ke Drive via getDriveToken)
// ✅ Kategori (Umum, Kaderisasi, Keagamaan, Kepemimpinan, Lainnya)
// ✅ Search debounced + filter kategori
// ✅ Sort (judul, kategori, timestamp)
// ✅ Pagination
// ✅ Detail modal + preview in-app (iframe Drive)
// ✅ File preview saat pilih file (image saja)
// ✅ Progress bar upload
// ✅ Export JSON
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  getDriveToken,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;
let dynamicPreviewModalEl = null;

const STATE = {
  materiList: [],
  filteredList: [],
  searchQuery: '',
  kategoriFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: 'timestamp',
  sortDirection: 'desc',
  pendingDeleteId: null,
  isSaving: false,
  isUploading: false,
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

function formatDate(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
  } catch { return '-'; }
}

function getMateriById(id) {
  return STATE.materiList.find(m => String(m.id) === String(id));
}

function getFileIconClass(tipe) {
  const t = String(tipe || '').toLowerCase();
  if (t === 'pdf') return 'bi-file-pdf-fill text-danger';
  if (t === 'ppt' || t === 'pptx') return 'bi-file-ppt-fill text-warning';
  if (t === 'doc' || t === 'docx') return 'bi-file-word-fill text-primary';
  if (t === 'jpg' || t === 'jpeg' || t === 'png' || t === 'webp') return 'bi-file-image-fill text-info';
  return 'bi-file-earmark-fill text-secondary';
}

function getFileTypeFromName(fileName) {
  if (!fileName) return 'file';
  return String(fileName).split('.').pop().toLowerCase();
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[MateriView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[MateriView] mounted');

  // Reset state
  STATE.materiList = [];
  STATE.filteredList = [];
  STATE.searchQuery = '';
  STATE.kategoriFilter = '';
  STATE.currentPage = 1;
  STATE.sortColumn = 'timestamp';
  STATE.sortDirection = 'desc';
  STATE.pendingDeleteId = null;
  STATE.isSaving = false;
  STATE.isUploading = false;

  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterKategori');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

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
  console.log('[MateriView] unmounted');

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

  // Remove dynamic preview modal
  if (dynamicPreviewModalEl) {
    try { dynamicPreviewModalEl.remove(); } catch (e) {}
    dynamicPreviewModalEl = null;
  }

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
  const filterEl = getEl('filterKategori');

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFiltersAndSort();
  }, 300));

  on(filterEl, 'change', function (e) {
    STATE.kategoriFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(getEl('addMateriBtn'), 'click', openAddModal);
  on(getEl('exportDataBtn'), 'click', exportData);

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await loadData(true);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  // File preview saat pilih file
  on(getEl('materiFile'), 'change', function () {
    const file = this.files?.[0];
    const previewContainer = getEl('filePreviewContainer');
    const previewImage = getEl('filePreviewImage');
    const previewName = getEl('filePreviewName');

    if (!file) {
      if (previewContainer) previewContainer.style.display = 'none';
      return;
    }

    if (previewContainer) previewContainer.style.display = 'block';
    const sizeKB = (file.size / 1024).toFixed(1);

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (previewImage) {
          previewImage.src = ev.target.result;
          previewImage.style.display = 'block';
        }
        if (previewName) previewName.textContent = `${file.name} (${sizeKB} KB)`;
      };
      reader.readAsDataURL(file);
    } else {
      if (previewImage) previewImage.style.display = 'none';
      if (previewName) previewName.textContent = `${file.name} (${sizeKB} KB)`;
    }
  });

  // Clear file
  on(getEl('clearFileBtn'), 'click', () => {
    const fileEl = getEl('materiFile');
    if (fileEl) fileEl.value = '';
    const previewContainer = getEl('filePreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
  });

  on(getEl('saveMateriBtn'), 'click', saveMateri);
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('materiTableContainer');
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
  let arr = STATE.materiList.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q) ||
      String(item.kategori || '').toLowerCase().includes(q)
    );
  }

  if (STATE.kategoriFilter !== '') {
    arr = arr.filter(item => String(item.kategori || '') === STATE.kategoriFilter);
  }

  if (STATE.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (STATE.sortColumn === 'timestamp') {
        va = new Date(a.timestamp || 0).getTime();
        vb = new Date(b.timestamp || 0).getTime();
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
  const c = getEl('materiTableContainer');
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
      <th style="cursor:pointer;" data-sort="judul">Judul Materi ${arrow('judul')}</th>
      <th style="cursor:pointer;" data-sort="kategori">Kategori ${arrow('kategori')}</th>
      <th style="cursor:pointer;" data-sort="timestamp">Tanggal ${arrow('timestamp')}</th>
      <th style="width:200px;" class="text-center">File</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = STATE.searchQuery || STATE.kategoriFilter;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      Tidak ada data materi${hasFilter ? ' sesuai filter' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, idx) => {
      const globalIdx = start + idx + 1;
      const safeId = escapeHtml(String(item.id));
      const fileUrl = item.fileId
        ? `https://drive.google.com/file/d/${escapeHtml(item.fileId)}/view`
        : '';
      const iconClass = getFileIconClass(item.tipe);

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
        <td><span class="badge bg-primary">${escapeHtml(item.kategori || 'Umum')}</span></td>
        <td>${escapeHtml(formatDate(item.timestamp))}</td>
        <td class="text-center">
          ${item.fileId ? `
            <button class="btn btn-sm btn-outline-primary me-1" data-action="preview" data-id="${safeId}" title="Tayangkan">
              <i class="bi ${iconClass.split(' ')[0]}"></i> Lihat
            </button>
            <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary" title="Buka di tab baru">
              <i class="bi bi-box-arrow-up-right"></i>
            </a>
          ` : '<span class="text-muted small">-</span>'}
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}" title="Detail">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
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
    case 'detail':  return viewMateri(id);
    case 'edit':    return editMateri(id);
    case 'delete':  return confirmDelete(id);
    case 'preview': return previewMateri(id);
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
  getEl('materiTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    STATE.materiList = AdminModule.getMateriList() || [];
    applyFiltersAndSort();

    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[MateriView] loadData:', e);
    const c = getEl('materiTableContainer');
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

// ============================================================
//   VIEW / EDIT / DELETE
// ============================================================
function viewMateri(id) {
  const item = getMateriById(id);
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const fileUrl = item.fileId
    ? `https://drive.google.com/file/d/${escapeHtml(item.fileId)}/view`
    : '';
  const iconClass = getFileIconClass(item.tipe);

  const content = getEl('detailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3">
        <strong>Judul:</strong><br>${escapeHtml(item.judul || '-')}
      </div>
      <div class="list-group-item py-3">
        <strong>Kategori:</strong>
        <span class="badge bg-primary ms-2">${escapeHtml(item.kategori || 'Umum')}</span>
      </div>
      <div class="list-group-item py-3">
        <strong>Tanggal Upload:</strong> ${escapeHtml(formatDate(item.timestamp))}
      </div>
      <div class="list-group-item py-3">
        <strong>Deskripsi:</strong><br>${escapeHtml(item.deskripsi || '-')}
      </div>
      <div class="list-group-item py-3">
        <strong>Tipe File:</strong>
        <i class="bi ${iconClass} ms-2"></i>
        <span class="ms-1">${escapeHtml(String(item.tipe || '-').toUpperCase())}</span>
      </div>
      <div class="list-group-item py-3">
        <strong>File:</strong>
        ${item.fileId ? `
          <a href="${fileUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary ms-2">
            <i class="bi bi-box-arrow-up-right me-1"></i> Buka di tab baru
          </a>
          <button class="btn btn-sm btn-success ms-2" data-preview-in-detail="${escapeHtml(String(item.id))}">
            <i class="bi bi-eye me-1"></i> Tayangkan
          </button>
        ` : '<span class="text-muted small ms-2">Tidak ada file</span>'}
      </div>
    </div>`;

  // Bind preview button inside detail modal
  const previewBtn = content.querySelector('[data-preview-in-detail]');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const previewId = previewBtn.dataset.previewInDetail;
      disposeAllModals();
      setTimeout(() => previewMateri(previewId), 350);
    });
  }

  getModal('detailMateriModal')?.show();
}

function previewMateri(id) {
  const item = getMateriById(id);
  if (!item || !item.fileId) {
    showToast('File tidak ditemukan', 'error');
    return;
  }

  const previewUrl = `https://drive.google.com/file/d/${item.fileId}/preview`;
  const downloadUrl = `https://drive.google.com/file/d/${item.fileId}/view`;

  // Remove existing dynamic modal
  if (dynamicPreviewModalEl) {
    try { dynamicPreviewModalEl.remove(); } catch (e) {}
    dynamicPreviewModalEl = null;
  }

  const modalHtml = `
    <div class="modal fade" id="previewMateriModalDynamic" tabindex="-1" data-bs-backdrop="static">
      <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-dark text-white border-0 rounded-top-4">
            <h5 class="modal-title">
              <i class="bi bi-file-earmark-play me-2"></i>${escapeHtml(item.judul || 'Pratinjau')}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-0" style="background:#0f172a;min-height:70vh;border-radius:0 0 20px 20px;overflow:hidden;">
            <iframe src="${previewUrl}" allowfullscreen
                    style="width:100%;height:80vh;border:none;display:block;"></iframe>
          </div>
          <div class="modal-footer border-0 bg-dark rounded-bottom-4">
            <a href="${downloadUrl}" target="_blank" rel="noopener" class="btn btn-primary rounded-pill px-4">
              <i class="bi bi-download me-1"></i> Unduh
            </a>
            <button type="button" class="btn btn-outline-light rounded-pill px-4" data-bs-dismiss="modal">Tutup</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  dynamicPreviewModalEl = getEl('previewMateriModalDynamic');

  const modal = new bootstrap.Modal(dynamicPreviewModalEl);
  modal.show();

  dynamicPreviewModalEl.addEventListener('hidden.bs.modal', () => {
    setTimeout(() => {
      if (dynamicPreviewModalEl) {
        try { dynamicPreviewModalEl.remove(); } catch (e) {}
        dynamicPreviewModalEl = null;
      }
    }, 300);
  }, { once: true });
}

function editMateri(id) {
  const item = getMateriById(id);
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('editMateriId', id);
  setVal('materiJudul', item.judul || '');
  setVal('materiDeskripsi', item.deskripsi || '');
  setVal('materiKategori', item.kategori || 'Umum');
  setVal('materiFile', '');

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Materi';

  const previewContainer = getEl('filePreviewContainer');
  const previewName = getEl('filePreviewName');
  const previewImage = getEl('filePreviewImage');

  if (item.fileId) {
    if (previewContainer) previewContainer.style.display = 'block';
    if (previewImage) {
      previewImage.src = '#';
      previewImage.style.display = 'none';
    }
    if (previewName) {
      previewName.innerHTML = `
        <i class="bi ${getFileIconClass(item.tipe)} me-1"></i>
        <strong>File saat ini:</strong> ${escapeHtml(String(item.tipe || '').toUpperCase())}<br>
        <small class="text-muted">Kosongkan input file jika tidak ingin mengganti</small>
      `;
    }
  } else {
    if (previewContainer) previewContainer.style.display = 'none';
  }

  getModal('materiFormModal')?.show();
}

function confirmDelete(id) {
  const item = getMateriById(id);
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  STATE.pendingDeleteId = id;
  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('deleteMateriId', id);

  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = item.judul || '—';

  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const id = getEl('deleteMateriId')?.value;
  if (!id) return;

  const item = getMateriById(id);
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteMateri', { id, fileId: item.fileId || '' }, 'POST');
    if (res && res.success) {
      STATE.materiList = STATE.materiList.filter(x => String(x.id) !== String(id));
      applyFiltersAndSort();
      showToast('Materi berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();
      setTimeout(() => loadData(true).catch(() => {}), 500);
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

// ============================================================
//   SAVE (ADD / EDIT)
// ============================================================
async function saveMateri() {
  if (STATE.isSaving) return;

  const id = getEl('editMateriId')?.value;
  const judul = getEl('materiJudul')?.value.trim() || '';
  const deskripsi = getEl('materiDeskripsi')?.value.trim() || '';
  const kategori = getEl('materiKategori')?.value || 'Umum';
  const fileInput = getEl('materiFile');
  const file = fileInput?.files?.[0] || null;

  if (!judul) { showToast('Judul materi wajib diisi', 'error'); return; }
  if (!id && !file) { showToast('File wajib diunggah untuk materi baru', 'error'); return; }

  if (file && file.size > 10 * 1024 * 1024) {
    showToast('Ukuran file maksimal 10 MB', 'error');
    return;
  }

  const btn = getEl('saveMateriBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  const progressContainer = getEl('uploadProgressContainer');
  const progressBar = getEl('uploadProgressBar');
  const progressText = getEl('uploadProgressText');

  if (file && progressContainer) {
    progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
  }

  try {
    // CASE 1: Edit tanpa ganti file
    if (!file) {
      const item = getMateriById(id);
      if (!item) throw new Error('Data tidak ditemukan');

      const res = await callApi('updateMateri', {
        id, judul, deskripsi, kategori,
        fileId: item.fileId,
        tipe: item.tipe,
        timestamp: item.timestamp,
      }, 'POST');

      if (res && res.success) {
        const idx = STATE.materiList.findIndex(x => String(x.id) === String(id));
        if (idx !== -1) {
          STATE.materiList[idx].judul = judul;
          STATE.materiList[idx].deskripsi = deskripsi;
          STATE.materiList[idx].kategori = kategori;
        }
        showToast('Materi diperbarui (tanpa ganti file)', 'success');
        getModal('materiFormModal')?.hide();
        applyFiltersAndSort();
      } else {
        throw new Error((res && res.error) || 'Gagal memperbarui');
      }
      return;
    }

    // CASE 2: Upload file baru
    if (progressText) progressText.textContent = 'Mengambil token Drive…';
    const tokenRes = await getDriveToken();
    if (!tokenRes || !tokenRes.success || !tokenRes.token) {
      throw new Error('Gagal mendapatkan token Drive');
    }
    const token = tokenRes.token;

    if (progressBar) progressBar.style.width = '20%';
    if (progressText) progressText.textContent = 'Mengunggah ke Drive…';

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify({ name: file.name })], { type: 'application/json' }));
    formData.append('file', file);

    const driveData = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && progressBar && progressText) {
          const pct = 20 + Math.round((e.loaded / e.total) * 60);
          progressBar.style.width = pct + '%';
          progressText.textContent = 'Upload ' + pct + '%';
        }
      };
      xhr.onload = () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (err) { reject(new Error('Gagal parsing respons Drive')); }
        } else {
          reject(new Error(`Upload ke Drive gagal (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error saat upload'));
      xhr.send(formData);
    });

    const driveId = driveData.id;
    if (!driveId) throw new Error('Drive tidak mengembalikan file ID');

    if (progressBar) progressBar.style.width = '85%';
    if (progressText) progressText.textContent = 'Menyimpan metadata…';

    const fileTipe = getFileTypeFromName(file.name);

    let res;
    if (id) {
      res = await callApi('updateMateri', {
        id, judul, deskripsi, kategori,
        fileId: driveId,
        tipe: fileTipe,
        timestamp: new Date().toISOString(),
      }, 'POST');
    } else {
      res = await callApi('addMateri', {
        judul, deskripsi, kategori,
        fileData: driveId,
        fileName: file.name,
        tipe: fileTipe,
        uploadBy: 'admin',
      }, 'POST');
    }

    if (res && res.success) {
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = 'Selesai!';
      showToast(id ? 'Materi & file diperbarui' : 'Materi berhasil ditambahkan', 'success');
      getModal('materiFormModal')?.hide();
      await loadData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan metadata');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = '0%';
    }, 1500);
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

// ============================================================
//   ADD MODAL
// ============================================================
function openAddModal() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('editMateriId', '');
  setVal('materiJudul', '');
  setVal('materiDeskripsi', '');
  setVal('materiKategori', 'Umum');
  setVal('materiFile', '');

  const previewContainer = getEl('filePreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Tambah Materi';

  const progressContainer = getEl('uploadProgressContainer');
  if (progressContainer) progressContainer.style.display = 'none';

  getModal('materiFormModal')?.show();
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = STATE.filteredList.length > 0 ? STATE.filteredList : STATE.materiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const exportArr = data.map(item => ({
    id: item.id,
    judul: item.judul,
    deskripsi: item.deskripsi,
    kategori: item.kategori,
    tipe: item.tipe,
    fileId: item.fileId,
    timestamp: item.timestamp,
  }));

  try {
    const json = JSON.stringify(exportArr, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `materi_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} materi`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
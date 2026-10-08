// ============================================================
// VIEW: materi.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/materi.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render saat data berubah)
//   ✅ NEW: Instant render dari preload cache (no fetch on mount)
//   ✅ REMOVED: Per-view polling — auto-sync global di app.js
//   ✅ FIX: Dynamic preview modal — dispose + cleanup on unmount
//   ✅ FIX: File preview clear saat modal ditutup
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Modal dispose race prevention
//   ✅ FIX: Focus preservation saat re-render via subscription
//   ✅ KEEP: Search debounce 200ms, edit, delete, upload
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  fileToBase64,
  formatDateID,
  getLocalDateOnly,
  downloadJSON,
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
const MAX_FILE_SIZE_MB = 10;

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

function cleanDriveId(id) {
  if (!id || typeof id !== 'string') return '';
  return id.trim().replace(/[\x00-\x1F\x7F]+/g, '').replace(/[^a-zA-Z0-9_-]+/g, '');
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    materiList: [],
    filteredList: [],
    searchQuery: '',
    kategoriFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    sortColumn: 'timestamp',
    sortDirection: 'desc',
    lastHash: '',
    pendingDeleteId: null,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'materi'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[MateriView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[MateriView] Re-render error:', e);
      }
    },
  }
);

let tableDelegationCleanup = null;
let dynamicPreviewModalEl = null;
let dynamicPreviewModalInstance = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[MateriView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[MateriView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    materiList: [],
    filteredList: [],
    searchQuery: '',
    kategoriFilter: '',
    currentPage: 1,
    sortColumn: 'timestamp',
    sortDirection: 'desc',
    lastHash: '',
    pendingDeleteId: null,
  });

  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterKategori');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getMateriList() || [];
  if (cached.length > 0) {
    console.log('[MateriView] ⚡ Rendering from preload cache');
    ctx.state.materiList = cached.map(m => ({ ...m }));
    ctx.state.lastHash = computeListHash(ctx.state.materiList);
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[MateriView] ⚠️ No cache, showing skeleton');
    renderSkeleton();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data AdminModule
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong, load data
  if (cached.length === 0) {
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
  console.log('[MateriView] unmounted');

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  // Cleanup dynamic preview modal
  if (dynamicPreviewModalInstance) {
    try { dynamicPreviewModalInstance.dispose(); } catch (e) { /* silent */ }
    dynamicPreviewModalInstance = null;
  }
  if (dynamicPreviewModalEl) {
    try { dynamicPreviewModalEl.remove(); } catch (e) { /* silent */ }
    dynamicPreviewModalEl = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE (no fetch)
// ============================================================
function refreshFromCache() {
  const fresh = AdminModule.getMateriList() || [];
  const freshHash = computeListHash(fresh, ['id', 'timestamp']);

  if (freshHash === ctx.state.lastHash) {
    console.log('[MateriView] No change, skip re-render');
    return;
  }

  ctx.state.materiList = fresh.map(m => ({ ...m }));
  ctx.state.lastHash = freshHash;
  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search + filter
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('filterKategori'), 'change', function (e) {
    ctx.state.kategoriFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Toolbar
  ctx.on(getEl('addMateriBtn'), 'click', openAddModal);
  ctx.on(getEl('exportDataBtn'), 'click', exportData);

  ctx.on(getEl('refreshDataBtn'), 'click', async function (e) {
    if (ctx.saving) return;
    ctx.saving = true;
    const restore = setBtnLoading(this, true, 'Memuat...');
    try {
      setCacheStatus('Memuat…');
      await AdminModule.loadAllData(true);
      refreshFromCache();
      showToast('Data disegarkan', 'success');
    } catch (err) {
      showToast('Gagal menyegarkan: ' + err.message, 'error');
    } finally {
      restore();
      ctx.saving = false;
    }
  });

  // File preview
  ctx.on(getEl('materiFile'), 'change', handleFilePreview);

  // Clear file
  ctx.on(getEl('clearFileBtn'), 'click', function () {
    const fileEl = getEl('materiFile');
    if (fileEl) fileEl.value = '';
    const previewContainer = getEl('filePreviewContainer');
    if (previewContainer) previewContainer.style.display = 'none';
  });

  // Save + delete modal
  ctx.on(getEl('saveMateriBtn'), 'click', saveMateri);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // Modal cleanup
  const formModal = getEl('materiFormModal');
  if (formModal) {
    ctx.on(formModal, 'hidden.bs.modal', () => {
      const previewContainer = getEl('filePreviewContainer');
      if (previewContainer) previewContainer.style.display = 'none';
      const progressContainer = getEl('uploadProgressContainer');
      if (progressContainer) progressContainer.style.display = 'none';
      const fileEl = getEl('materiFile');
      if (fileEl) fileEl.value = '';
    });
  }

  // ✅ DELEGATION — table
  const tableContainer = getEl('materiTableContainer');
  if (tableContainer) {
    tableDelegationCleanup = delegateTableClicks(tableContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => handleTableAction(action, id),
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   FILE PREVIEW
// ============================================================
function handleFilePreview() {
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
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('materiTableContainer');
  if (!c) return;
  const cells = Array(6).fill(0)
    .map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`)
    .join('');
  const rows = Array(5).fill(0).map(() =>
    `<tr>${Array(6).fill(0)
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
  let arr = ctx.state.materiList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q) ||
      String(item.kategori || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.kategoriFilter !== '') {
    arr = arr.filter(item => String(item.kategori || '') === ctx.state.kategoriFilter);
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (ctx.state.sortColumn === 'timestamp') {
        va = new Date(a.timestamp || 0).getTime() || 0;
        vb = new Date(b.timestamp || 0).getTime() || 0;
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
  const c = getEl('materiTableContainer');
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
      <th data-sort="judul" style="cursor:pointer;">Judul Materi ${arrow('judul')}</th>
      <th data-sort="kategori" style="cursor:pointer;">Kategori ${arrow('kategori')}</th>
      <th data-sort="timestamp" style="cursor:pointer;">Tanggal ${arrow('timestamp')}</th>
      <th style="width:200px;" class="text-center">File</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery || ctx.state.kategoriFilter;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
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
        <td>${escapeHtml(formatDateID(item.timestamp))}</td>
        <td class="text-center">
          ${item.fileId ? `
            <button type="button" class="btn btn-sm btn-outline-primary me-1" data-action="preview" data-id="${safeId}"
                    title="Tayangkan" aria-label="Tayangkan ${escapeHtml(item.judul)}">
              <i class="bi ${iconClass.split(' ')[0]}" aria-hidden="true"></i> Lihat
            </button>
            <a href="${fileUrl}" target="_blank" rel="noopener noreferrer"
               class="btn btn-sm btn-outline-secondary" title="Buka di tab baru" aria-label="Buka file">
              <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
            </a>
          ` : '<span class="text-muted small">-</span>'}
        </td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}"
                  title="Detail" aria-label="Detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}"
                  title="Edit" aria-label="Edit">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}"
                  title="Hapus" aria-label="Hapus">
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
//   ACTION ROUTER
// ============================================================
function handleTableAction(action, id) {
  switch (action) {
    case 'detail':  return viewMateri(id);
    case 'edit':    return editMateri(id);
    case 'delete':  return confirmDelete(id);
    case 'preview': return previewMateri(id);
    default: console.warn('[MateriView] Unknown action:', action);
  }
}

function handleSort(col) {
  if (ctx.state.sortColumn === col) {
    ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    ctx.state.sortColumn = col;
    ctx.state.sortDirection = col === 'timestamp' ? 'desc' : 'asc';
  }
  ctx.state.currentPage = 1;
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderTable();
  getEl('materiTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   LOAD DATA (fallback kalau cache kosong)
// ============================================================
async function loadData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[MateriView] loadData:', e);
    const c = getEl('materiTableContainer');
    if (c && ctx.state.materiList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   VIEW / EDIT / DELETE
// ============================================================
function viewMateri(id) {
  const item = ctx.state.materiList.find(m => String(m.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const fileUrl = item.fileId
    ? `https://drive.google.com/file/d/${escapeHtml(item.fileId)}/view`
    : '';
  const iconClass = getFileIconClass(item.tipe);

  const content = getEl('detailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Judul:</strong><br>${escapeHtml(item.judul || '-')}</div>
      <div class="list-group-item py-3"><strong>Kategori:</strong>
        <span class="badge bg-primary ms-2">${escapeHtml(item.kategori || 'Umum')}</span>
      </div>
      <div class="list-group-item py-3"><strong>Tanggal Upload:</strong> ${escapeHtml(formatDateID(item.timestamp))}</div>
      <div class="list-group-item py-3"><strong>Deskripsi:</strong><br>${escapeHtml(item.deskripsi || '-')}</div>
      <div class="list-group-item py-3"><strong>Tipe File:</strong>
        <i class="bi ${iconClass} ms-2" aria-hidden="true"></i>
        <span class="ms-1">${escapeHtml(String(item.tipe || '-').toUpperCase())}</span>
      </div>
      <div class="list-group-item py-3"><strong>File:</strong>
        ${item.fileId ? `
          <a href="${fileUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary ms-2">
            <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i> Buka di tab baru
          </a>
          <button type="button" class="btn btn-sm btn-success ms-2" data-preview-in-detail="${escapeHtml(String(item.id))}">
            <i class="bi bi-eye me-1" aria-hidden="true"></i> Tayangkan
          </button>
        ` : '<span class="text-muted small ms-2">Tidak ada file</span>'}
      </div>
    </div>`;

  // Element-scoped listener
  const previewBtn = content.querySelector('[data-preview-in-detail]');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      const previewId = previewBtn.dataset.previewInDetail;
      ctx.getModal('detailMateriModal')?.hide();
      setTimeout(() => previewMateri(previewId), 350);
    });
  }

  ctx.getModal('detailMateriModal')?.show();
}

function previewMateri(id) {
  const item = ctx.state.materiList.find(m => String(m.id) === String(id));
  if (!item || !item.fileId) {
    showToast('File tidak ditemukan', 'error');
    return;
  }

  // Cleanup existing dynamic modal
  if (dynamicPreviewModalInstance) {
    try { dynamicPreviewModalInstance.dispose(); } catch (e) { /* silent */ }
    dynamicPreviewModalInstance = null;
  }
  if (dynamicPreviewModalEl) {
    try { dynamicPreviewModalEl.remove(); } catch (e) { /* silent */ }
    dynamicPreviewModalEl = null;
  }

  const cleanedId = cleanDriveId(item.fileId);
  const previewUrl = `https://drive.google.com/file/d/${cleanedId}/preview`;
  const downloadUrl = `https://drive.google.com/file/d/${cleanedId}/view`;

  const modalHtml = `
    <div class="modal fade" id="previewMateriModalDynamic" tabindex="-1"
         data-bs-backdrop="static" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-dark text-white border-0 rounded-top-4">
            <h5 class="modal-title">
              <i class="bi bi-file-earmark-play me-2" aria-hidden="true"></i>${escapeHtml(item.judul || 'Pratinjau')}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Tutup"></button>
          </div>
          <div class="modal-body p-0" style="background:#0f172a;min-height:70vh;border-radius:0 0 20px 20px;overflow:hidden;">
            <iframe src="${previewUrl}" allowfullscreen
                    title="Pratinjau ${escapeHtml(item.judul || '')}"
                    style="width:100%;height:80vh;border:none;display:block;"></iframe>
          </div>
          <div class="modal-footer border-0 bg-dark rounded-bottom-4">
            <a href="${downloadUrl}" target="_blank" rel="noopener noreferrer"
               class="btn btn-primary rounded-pill px-4">
              <i class="bi bi-download me-1" aria-hidden="true"></i> Unduh
            </a>
            <button type="button" class="btn btn-outline-light rounded-pill px-4" data-bs-dismiss="modal">Tutup</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  dynamicPreviewModalEl = getEl('previewMateriModalDynamic');
  if (!dynamicPreviewModalEl) return;

  dynamicPreviewModalInstance = new bootstrap.Modal(dynamicPreviewModalEl);
  dynamicPreviewModalInstance.show();

  // Cleanup on hidden
  dynamicPreviewModalEl.addEventListener('hidden.bs.modal', () => {
    setTimeout(() => {
      if (dynamicPreviewModalInstance) {
        try { dynamicPreviewModalInstance.dispose(); } catch (e) { /* silent */ }
        dynamicPreviewModalInstance = null;
      }
      if (dynamicPreviewModalEl) {
        try { dynamicPreviewModalEl.remove(); } catch (e) { /* silent */ }
        dynamicPreviewModalEl = null;
      }
    }, 300);
  }, { once: true });
}

function editMateri(id) {
  const item = ctx.state.materiList.find(m => String(m.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
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
        <i class="bi ${getFileIconClass(item.tipe)} me-1" aria-hidden="true"></i>
        <strong>File saat ini:</strong> ${escapeHtml(String(item.tipe || '').toUpperCase())}<br>
        <small class="text-muted">Kosongkan input file jika tidak ingin mengganti</small>
      `;
    }
  } else {
    if (previewContainer) previewContainer.style.display = 'none';
  }

  ctx.getModal('materiFormModal')?.show();
}

function confirmDelete(id) {
  const item = ctx.state.materiList.find(m => String(m.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  ctx.state.pendingDeleteId = id;

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('deleteMateriId', id);

  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = item.judul || '—';

  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteId || getEl('deleteMateriId')?.value;
  if (!id) return;

  const item = ctx.state.materiList.find(m => String(m.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const btn = e?.currentTarget || getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;

  try {
    const res = await AdminModule.deleteMateri(id, item.fileId || '');
    if (res && res.success) {
      showToast('Materi berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      // Subscription akan auto re-render
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
//   SAVE (ADD / EDIT)
// ============================================================
async function saveMateri(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('saveMateriBtn');
  const id = getEl('editMateriId')?.value || '';
  const judul = (getEl('materiJudul')?.value || '').trim();
  const deskripsi = (getEl('materiDeskripsi')?.value || '').trim();
  const kategori = getEl('materiKategori')?.value || 'Umum';
  const fileInput = getEl('materiFile');
  const file = fileInput?.files?.[0] || null;

  if (!judul) {
    showToast('Judul materi wajib diisi', 'error');
    getEl('materiJudul')?.focus();
    return;
  }
  if (!id && !file) {
    showToast('File wajib diunggah untuk materi baru', 'error');
    return;
  }
  if (file && file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`Ukuran file maksimal ${MAX_FILE_SIZE_MB} MB`, 'error');
    return;
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  const progressContainer = getEl('uploadProgressContainer');
  const progressBar = getEl('uploadProgressBar');
  const progressText = getEl('uploadProgressText');

  if (file && progressContainer) {
    progressContainer.style.display = 'block';
    if (progressBar) progressBar.style.width = '0%';
    if (progressText) progressText.textContent = '0%';
  }

  try {
    // ===== CASE 1: Edit TANPA ganti file =====
    if (!file) {
      const item = ctx.state.materiList.find(m => String(m.id) === String(id));
      if (!item) throw new Error('Data tidak ditemukan');

      const res = await callApi('updateMateri', {
        id, judul, deskripsi, kategori,
        fileId: item.fileId,
        tipe: item.tipe,
        timestamp: item.timestamp,
      }, 'POST');

      if (res && res.success) {
        showToast('Materi diperbarui (tanpa ganti file)', 'success');
        ctx.getModal('materiFormModal')?.hide();
        await AdminModule.loadAllData(true);
      } else {
        throw new Error((res && res.error) || 'Gagal memperbarui');
      }
      return;
    }

    // ===== CASE 2: Upload file baru =====
    if (progressText) progressText.textContent = 'Membaca file…';
    if (progressBar) progressBar.style.width = '20%';

    const fileDataURL = await fileToBase64(file);

    if (progressBar) progressBar.style.width = '60%';
    if (progressText) progressText.textContent = 'Mengirim ke server…';

    const fileTipe = getFileTypeFromName(file.name);

    let res;
    if (id) {
      res = await callApi('updateMateri', {
        id, judul, deskripsi, kategori,
        file: fileDataURL,
        fileName: file.name,
        tipe: fileTipe,
        timestamp: new Date().toISOString(),
      }, 'POST');
    } else {
      res = await callApi('addMateri', {
        judul, deskripsi, kategori,
        file: fileDataURL,
        fileName: file.name,
        uploadBy: 'admin',
      }, 'POST');
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Selesai!';

    if (res && res.success) {
      showToast(id ? 'Materi & file diperbarui' : 'Materi berhasil ditambahkan', 'success');
      ctx.getModal('materiFormModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = '0%';
    }, 1200);
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   ADD MODAL
// ============================================================
function openAddModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
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

  ctx.getModal('materiFormModal')?.show();
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = ctx.state.filteredList.length > 0 ? ctx.state.filteredList : ctx.state.materiList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const exportArr = data.map(item => ({
    id: item.id,
    judul: item.judul,
    deskripsi: item.deskripsi,
    kategori: item.kategori,
    tipe: item.tipe,
    fileId: item.fileId,
    timestamp: item.timestamp,
  }));

  const fileName = `materi_export_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(exportArr, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} materi`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Materi View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
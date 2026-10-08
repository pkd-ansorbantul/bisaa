// ============================================================
// VIEW: informasi.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/informasi.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Poll 120s — auto-sync global handle
//   ✅ FIX: Modal cleanup (delete confirm, usulan action)
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Form, edit, toggle, delete, usulan ACC/reject
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  formatDateID,
  fileToBase64,
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
const MAX_FILE_SIZE_MB = 2;

const MENU_FIELDS = [
  { id: 'jenis', label: 'Jenis' },
  { id: 'judul', label: 'Judul' },
  { id: 'tanggal_mulai', label: 'Tanggal' },
  { id: 'urutan', label: 'Urutan' },
  { id: 'status', label: 'Status' },
];

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
  return String(status || 'aktif').toLowerCase() === 'selesai' ? 'bg-success' : 'bg-primary';
}

function getStatusLabel(status) {
  return String(status || 'aktif').toLowerCase() === 'selesai' ? '✅ Selesai' : '🔄 Aktif';
}

function getThumbUrl(driveId, size) {
  if (!driveId) return '';
  const clean = String(driveId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) return '';
  return `https://drive.google.com/thumbnail?id=${clean}&sz=w${size || 100}`;
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    informasiList: [],
    filteredList: [],
    usulanList: [],
    searchQuery: '',
    jenisFilter: '',
    statusFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    sortColumn: 'createdAt',
    sortDirection: 'desc',
    lastInfoHash: '',
    lastUsulanHash: '',
    pendingDeleteId: null,
    pendingUsulanId: null,
    pendingUsulanType: null,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'informasi'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[InformasiView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[InformasiView] Re-render error:', e);
      }
    },
  }
);

let infoTableDelegationCleanup = null;
let usulanTableDelegationCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[InformasiView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[InformasiView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    informasiList: [],
    filteredList: [],
    usulanList: [],
    searchQuery: '',
    jenisFilter: '',
    statusFilter: '',
    currentPage: 1,
    sortColumn: 'createdAt',
    sortDirection: 'desc',
    lastInfoHash: '',
    lastUsulanHash: '',
    pendingDeleteId: null,
    pendingUsulanId: null,
    pendingUsulanType: null,
  });

  resetForm();

  const searchEl = getEl('searchInput');
  const jenisEl = getEl('filterJenis');
  const statusEl = getEl('filterStatus');
  if (searchEl) searchEl.value = '';
  if (jenisEl) jenisEl.value = '';
  if (statusEl) statusEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getInformasiList() || [];
  if (cached.length > 0) {
    console.log('[InformasiView] ⚡ Rendering from preload cache');
    ctx.state.informasiList = cached.map(i => ({ ...i }));
    ctx.state.lastInfoHash = computeListHash(ctx.state.informasiList);
    applyFiltersAndSort();
    renderUsulanTable();
    setCacheStatus('Live');
  } else {
    console.log('[InformasiView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
    renderSkeletonUsulan();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong, load data
  if (cached.length === 0) {
    await Promise.allSettled([
      loadInformasi(false),
      loadUsulan(),
    ]);
  } else {
    // Tetap load usulan (tidak di-preload)
    loadUsulan().catch(() => {});
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[InformasiView] unmounted');

  if (infoTableDelegationCleanup) {
    try { infoTableDelegationCleanup(); } catch (e) { /* silent */ }
    infoTableDelegationCleanup = null;
  }
  if (usulanTableDelegationCleanup) {
    try { usulanTableDelegationCleanup(); } catch (e) { /* silent */ }
    usulanTableDelegationCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = AdminModule.getInformasiList() || [];
  const freshHash = computeListHash(fresh);

  if (freshHash === ctx.state.lastInfoHash) {
    console.log('[InformasiView] No change, skip re-render');
    return;
  }

  ctx.state.informasiList = fresh.map(i => ({ ...i }));
  ctx.state.lastInfoHash = freshHash;
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

  ctx.on(getEl('filterJenis'), 'change', function (e) {
    ctx.state.jenisFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  ctx.on(getEl('filterStatus'), 'change', function (e) {
    ctx.state.statusFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Form
  ctx.on(getEl('infoForm'), 'submit', submitInfoForm);
  ctx.on(getEl('cancelEditBtn'), 'click', resetForm);

  // Toolbar
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);
  ctx.on(getEl('refreshUsulanBtn'), 'click', handleRefreshUsulan);
  ctx.on(getEl('exportDataBtn'), 'click', exportData);

  // Modal actions
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);
  ctx.on(getEl('usulanActionBtn'), 'click', executeUsulanAction);

  // ✅ DELEGATION — informasi table
  const infoContainer = getEl('informasiTableContainer');
  if (infoContainer) {
    infoTableDelegationCleanup = delegateTableClicks(infoContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => {
        if (action === 'edit') editInfo(id);
        else if (action === 'toggle') toggleStatus(id);
        else if (action === 'delete') confirmDelete(id);
      },
      onPage: (page) => goToPage(page),
    });
  }

  // ✅ DELEGATION — usulan table
  const usulanContainer = getEl('usulanTableContainer');
  if (usulanContainer) {
    usulanTableDelegationCleanup = delegateTableClicks(usulanContainer, {
      onAction: (action, id) => {
        if (action === 'approve' || action === 'reject') {
          openUsulanActionModal(id, action);
        }
      },
    });
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonTable() {
  const c = getEl('informasiTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(9).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(5).fill(0).map(() =>
        `<tr>${Array(9).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

function renderSkeletonUsulan() {
  const c = getEl('usulanTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-sm align-middle">
      <thead class="table-light"><tr>
        ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(3).fill(0).map(() =>
        `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredInformasi() {
  let arr = ctx.state.informasiList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.jenisFilter !== '') {
    arr = arr.filter(item => String(item.jenis || '').toLowerCase() === ctx.state.jenisFilter);
  }

  if (ctx.state.statusFilter !== '') {
    arr = arr.filter(item => String(item.status || 'aktif').toLowerCase() === ctx.state.statusFilter);
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      let va = a[ctx.state.sortColumn];
      let vb = b[ctx.state.sortColumn];

      if (ctx.state.sortColumn === 'createdAt' || ctx.state.sortColumn === 'tanggal_mulai') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else if (ctx.state.sortColumn === 'urutan') {
        va = parseInt(va) || 0;
        vb = parseInt(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }

      if (va < vb) return ctx.state.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return ctx.state.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  return arr;
}

function applyFiltersAndSort() {
  ctx.state.filteredList = getFilteredInformasi();
  const total = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(total / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;
  renderTable();
}

// ============================================================
//   RENDER — INFORMASI TABLE
// ============================================================
function renderTable() {
  const c = getEl('informasiTableContainer');
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
      <th style="cursor:pointer;" data-sort="jenis">Jenis ${arrow('jenis')}</th>
      <th style="cursor:pointer;" data-sort="judul">Judul ${arrow('judul')}</th>
      <th>Deskripsi</th>
      <th style="cursor:pointer;" data-sort="tanggal_mulai">Tanggal & Lokasi ${arrow('tanggal_mulai')}</th>
      <th>Gambar</th>
      <th style="cursor:pointer;" data-sort="urutan">Urutan ${arrow('urutan')}</th>
      <th style="cursor:pointer;" data-sort="status">Status ${arrow('status')}</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery || ctx.state.jenisFilter || ctx.state.statusFilter;
    html += `<tr><td colspan="9" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data informasi${hasFilter ? ' sesuai filter' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, idx) => {
      const globalIdx = start + idx + 1;
      const isFlyer = String(item.jenis || '').toLowerCase() === 'flyer';
      const safeId = escapeHtml(String(item.id || ''));

      let tanggal = item.tanggal_mulai ? formatDateID(item.tanggal_mulai) : '';
      if (item.tanggal_akhir) tanggal += ' - ' + formatDateID(item.tanggal_akhir);
      const lokasi = item.lokasi
        ? `<br><small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(item.lokasi)}</small>`
        : '';

      let preview = '-';
      if (isFlyer && item.url) {
        const thumbUrl = getThumbUrl(item.url, 100);
        const fullUrl = `https://drive.google.com/file/d/${escapeHtml(item.url)}/view`;
        preview = `<a href="${fullUrl}" target="_blank" rel="noopener">
          <img src="${thumbUrl}" alt="flyer" class="border rounded"
               style="max-width:80px;max-height:60px;object-fit:cover;cursor:pointer;"
               onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';">
          <i class="bi bi-image" style="display:none;font-size:1.5rem;color:#94a3b8;" aria-hidden="true"></i>
        </a>`;
      }

      const badge = getStatusBadge(item.status);
      const statusLabel = getStatusLabel(item.status);
      const isSelesai = String(item.status || '').toLowerCase() === 'selesai';

      html += `<tr>
        <td>${globalIdx}</td>
        <td><span class="badge ${isFlyer ? 'bg-info text-dark' : 'bg-primary'}">${isFlyer ? 'Flyer' : 'Timeline'}</span></td>
        <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
        <td><small>${escapeHtml(item.deskripsi || '-')}</small></td>
        <td>${tanggal || '-'}${lokasi}</td>
        <td>${preview}</td>
        <td>${escapeHtml(String(item.urutan || ''))}</td>
        <td><span class="badge ${badge}">${statusLabel}</span></td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit" aria-label="Edit">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-${isSelesai ? 'success' : 'secondary'} me-1"
                  data-action="toggle" data-id="${safeId}"
                  title="${isSelesai ? 'Aktifkan' : 'Tandai Selesai'}"
                  aria-label="${isSelesai ? 'Aktifkan' : 'Tandai Selesai'}">
            <i class="bi ${isSelesai ? 'bi-arrow-counterclockwise' : 'bi-check-circle'}" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus" aria-label="Hapus">
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

function handleSort(col) {
  if (ctx.state.sortColumn === col) {
    ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    ctx.state.sortColumn = col;
    ctx.state.sortDirection = col === 'createdAt' ? 'desc' : 'asc';
  }
  ctx.state.currentPage = 1;
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderTable();
  getEl('informasiTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   RENDER — USULAN TABLE
// ============================================================
function renderUsulanTable() {
  const c = getEl('usulanTableContainer');
  if (!c) return;

  if (!ctx.state.usulanList || ctx.state.usulanList.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center mb-0 small">
      <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
      Tidak ada usulan pending saat ini.
    </div>`;
    return;
  }

  let html = `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
    <thead class="table-light"><tr>
      <th>Nama</th>
      <th>Usulan (PAC)</th>
      <th>Tanggal</th>
      <th>Lokasi</th>
      <th>No HP</th>
      <th style="width:160px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  ctx.state.usulanList.forEach(u => {
    let tgl = u.tanggal_mulai ? formatDateID(u.tanggal_mulai) : '';
    if (u.tanggal_akhir) tgl += ' - ' + formatDateID(u.tanggal_akhir);
    const safeId = escapeHtml(String(u.id || ''));
    html += `<tr>
      <td>${escapeHtml(u.nama || '-')}</td>
      <td>${escapeHtml(u.usulan || '-')}</td>
      <td><small>${tgl || '-'}</small></td>
      <td>${escapeHtml(u.lokasi || '-')}</td>
      <td>${escapeHtml(u.no_hp || '-')}</td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-success me-1" data-action="approve" data-id="${safeId}" title="Setujui" aria-label="Setujui">
          <i class="bi bi-check-circle" aria-hidden="true"></i> ACC
        </button>
        <button type="button" class="btn btn-sm btn-danger" data-action="reject" data-id="${safeId}" title="Tolak" aria-label="Tolak">
          <i class="bi bi-x-circle" aria-hidden="true"></i> Tolak
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;
}

// ============================================================
//   LOAD — INFORMASI
// ============================================================
async function loadInformasi(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[InformasiView] loadInformasi error:', e);
    const c = getEl('informasiTableContainer');
    if (c && ctx.state.informasiList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   LOAD — USULAN
// ============================================================
async function loadUsulan() {
  try {
    const res = await callApi('getUsulanList', {}, 'GET');
    if (!ctx.mounted) return;
    const list = Array.isArray(res) ? res : (res?.data || []);
    const pending = list.filter(u =>
      String(u.status || '').toLowerCase() === 'pending'
    );
    const freshHash = computeListHash(pending);
    if (freshHash !== ctx.state.lastUsulanHash) {
      ctx.state.usulanList = pending;
      ctx.state.lastUsulanHash = freshHash;
      renderUsulanTable();
    }
  } catch (e) {
    console.warn('[InformasiView] loadUsulan error:', e);
    const c = getEl('usulanTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-info text-center mb-0 small">Gagal memuat usulan.</div>`;
    }
  }
}

// ============================================================
//   FORM
// ============================================================
function resetForm() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editId', '');
  setVal('judulItem', '');
  setVal('deskripsiItem', '');
  setVal('urutanItem', '0');
  setVal('tanggalMulaiItem', '');
  setVal('tanggalAkhirItem', '');
  setVal('lokasiItem', '');
  setVal('fileItem', '');

  const titleEl = getEl('formTitle');
  if (titleEl) titleEl.textContent = 'Tambah Jadwal / Flyer';

  const msgEl = getEl('formMessage');
  if (msgEl) msgEl.innerHTML = '';

  const preview = getEl('fileEditPreview');
  if (preview) preview.style.display = 'none';
}

function editInfo(id) {
  const item = ctx.state.informasiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editId', id);
  setVal('judulItem', item.judul || '');
  setVal('deskripsiItem', item.deskripsi || '');
  setVal('urutanItem', item.urutan || 0);
  setVal('tanggalMulaiItem', item.tanggal_mulai || '');
  setVal('tanggalAkhirItem', item.tanggal_akhir || '');
  setVal('lokasiItem', item.lokasi || '');
  setVal('fileItem', '');

  const titleEl = getEl('formTitle');
  if (titleEl) titleEl.textContent = 'Edit Jadwal / Flyer';

  const msgEl = getEl('formMessage');
  if (msgEl) msgEl.innerHTML = '';

  const preview = getEl('fileEditPreview');
  const previewName = getEl('fileEditPreviewName');
  if (item.url && String(item.jenis).toLowerCase() === 'flyer') {
    if (preview) preview.style.display = 'block';
    if (previewName) {
      previewName.innerHTML = `<a href="https://drive.google.com/file/d/${escapeHtml(item.url)}/view" target="_blank" rel="noopener">Lihat flyer</a>`;
    }
  } else {
    if (preview) preview.style.display = 'none';
  }

  getEl('infoForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitInfoForm(e) {
  e.preventDefault();
  if (ctx.saving) return;

  const id = getEl('editId').value;
  const judul = getEl('judulItem').value.trim();
  const deskripsi = getEl('deskripsiItem').value.trim();
  const urutan = parseInt(getEl('urutanItem').value) || 0;
  const tanggalMulai = getEl('tanggalMulaiItem').value;
  const tanggalAkhir = getEl('tanggalAkhirItem').value;
  const lokasi = getEl('lokasiItem').value.trim();
  const fileInput = getEl('fileItem');
  const msgEl = getEl('formMessage');

  if (!judul || !tanggalMulai) {
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-danger mb-0">Judul dan tanggal mulai wajib diisi.</div>';
    return;
  }

  let fileData = null;
  let fileName = null;
  if (fileInput && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      if (msgEl) msgEl.innerHTML = `<div class="alert alert-danger mb-0">Ukuran file maksimal ${MAX_FILE_SIZE_MB} MB.</div>`;
      return;
    }
    try {
      fileData = await fileToBase64(file);
      fileName = file.name;
    } catch (err) {
      if (msgEl) msgEl.innerHTML = `<div class="alert alert-danger mb-0">Gagal membaca file: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  const btn = getEl('saveBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.saving = true;

  try {
    const payload = {
      judul, deskripsi, urutan,
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      lokasi,
      jenis: fileData ? 'flyer' : 'timeline',
    };
    if (fileData) {
      payload.fileData = fileData;
      payload.fileName = fileName;
    }

    let res;
    if (id) {
      payload.id = id;
      res = await callApi('updateInfo', payload, 'POST');
    } else {
      res = await callApi('addInfo', payload, 'POST');
    }

    if (res && res.success) {
      showToast(id ? 'Informasi diperbarui' : 'Informasi ditambahkan', 'success');
      resetForm();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
    if (msgEl) msgEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(err.message)}</div>`;
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   TOGGLE STATUS
// ============================================================
async function toggleStatus(id) {
  const item = ctx.state.informasiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (!confirm(`Ubah status informasi "${item.judul}"?`)) return;

  try {
    const res = await callApi('toggleInfoStatus', { id }, 'POST');
    if (res && res.success) {
      showToast('Status berhasil diubah', 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah status');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   DELETE
// ============================================================
function confirmDelete(id) {
  ctx.state.pendingDeleteId = id;
  const idEl = getEl('deleteInformasiId');
  if (idEl) idEl.value = id;
  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteId || getEl('deleteInformasiId')?.value;
  if (!id) return;

  const btn = getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;

  try {
    const res = await callApi('deleteInfo', { id }, 'POST');
    if (res && res.success) {
      showToast('Informasi berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteId = null;
  }
}

// ============================================================
//   USULAN ACTIONS
// ============================================================
function openUsulanActionModal(id, type) {
  const item = ctx.state.usulanList.find(u => String(u.id) === String(id));
  if (!item) { showToast('Usulan tidak ditemukan', 'error'); return; }

  const isApprove = type === 'approve';
  ctx.state.pendingUsulanId = id;
  ctx.state.pendingUsulanType = type;

  const idEl = getEl('usulanActionId');
  const typeEl = getEl('usulanActionType');
  if (idEl) idEl.value = id;
  if (typeEl) typeEl.value = type;

  const titleEl = getEl('usulanActionTitle');
  if (titleEl) {
    titleEl.innerHTML = isApprove
      ? '<i class="bi bi-check-circle me-2"></i>Setujui Usulan'
      : '<i class="bi bi-x-circle me-2"></i>Tolak Usulan';
  }

  const msgEl = getEl('usulanActionMessage');
  if (msgEl) {
    msgEl.innerHTML = isApprove
      ? `Setujui usulan dari <strong>${escapeHtml(item.nama || '-')}</strong>?<br>
         <small class="text-muted">Usulan akan otomatis dipublikasikan sebagai informasi.</small>`
      : `Tolak usulan dari <strong>${escapeHtml(item.nama || '-')}</strong>?<br>
         <small class="text-muted">Usulan tidak akan dipublikasikan.</small>`;
  }

  const btn = getEl('usulanActionBtn');
  if (btn) {
    btn.className = `btn ${isApprove ? 'btn-success' : 'btn-danger'} rounded-pill px-4`;
    btn.innerHTML = isApprove
      ? '<i class="bi bi-check-circle me-1"></i> Ya, Setujui'
      : '<i class="bi bi-x-circle me-1"></i> Ya, Tolak';
  }

  ctx.getModal('usulanActionModal')?.show();
}

async function executeUsulanAction() {
  if (ctx.saving) return;

  const id = ctx.state.pendingUsulanId || getEl('usulanActionId')?.value;
  const type = ctx.state.pendingUsulanType || getEl('usulanActionType')?.value;
  if (!id || !type) return;

  const btn = getEl('usulanActionBtn');
  const restore = setBtnLoading(btn, true, 'Memproses...');
  ctx.saving = true;

  const status = type === 'approve' ? 'approved' : 'rejected';

  try {
    const res = await callApi('updateUsulanStatus', { id, status }, 'POST');
    if (res && res.success) {
      showToast(`Usulan berhasil di-${type === 'approve' ? 'setujui' : 'tolak'}`, 'success');
      ctx.getModal('usulanActionModal')?.hide();
      await Promise.all([
        loadUsulan(),
        AdminModule.loadAllData(true),
      ]);
    } else {
      throw new Error((res && res.error) || 'Gagal memproses');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingUsulanId = null;
    ctx.state.pendingUsulanType = null;
  }
}

// ============================================================
//   REFRESH HANDLERS
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  ctx.saving = true;

  try {
    setCacheStatus('Memuat…');
    await AdminModule.loadAllData(true);
    refreshFromCache();
    await loadUsulan();
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

async function handleRefreshUsulan(e) {
  const btn = e.currentTarget || getEl('refreshUsulanBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  try {
    await loadUsulan();
    showToast('Usulan disegarkan', 'success');
  } finally {
    restore();
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = ctx.state.filteredList.length > 0 ? ctx.state.filteredList : ctx.state.informasiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const exportArr = data.map(item => ({
    id: item.id, jenis: item.jenis, judul: item.judul, deskripsi: item.deskripsi,
    url: item.url, urutan: item.urutan, tanggal_mulai: item.tanggal_mulai,
    tanggal_akhir: item.tanggal_akhir, lokasi: item.lokasi, status: item.status,
    createdAt: item.createdAt,
  }));

  const fileName = `informasi_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(exportArr, fileName)) {
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
  '%c Informasi View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// VIEW: alumni.js — v27.1.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/alumni.html
// ============================================================
// CHANGELOG v27.1.0 (dari v27.0.0):
//   ✅ NEW: Instant render dari preload cache (no fetch on mount)
//   ✅ NEW: Subscription pattern — auto re-render saat data berubah
//   ✅ NEW: bindRefreshButton() ke global forceSync
//   ✅ REMOVED: Per-view polling — auto-sync global di app.js
//   ✅ Use createViewContext — listener registry + modal cache
//   ✅ Use delegateTableClicks — 1 listener per table
//   ✅ Use computeListHash from view-helpers (no duplication)
//   ✅ Use setCacheStatus from view-helpers
//   ✅ FIX BUG-003: Clone list dari AdminModule sebelum sort
//   ✅ FIX BUG-008: Default sort direction per column
//   ✅ Focus preservation saat poll
//   ✅ Parallel certMap lookup
//   ✅ Optimistic remove on restore
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
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
  setCacheStatus,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const DEFAULT_SORT_DIRECTIONS = {
  nama_lengkap: 'asc',
  email: 'asc',
  no_hp: 'asc',
  utusan: 'asc',
  alumni_at: 'desc',  // default: terbaru dulu
};

// ============================================================
//   LOCAL HELPERS
// ============================================================
function getYearFromDate(dateVal) {
  if (!dateVal) return null;
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear();
}

// ============================================================
//   CONTEXT — dengan subscription
// ============================================================
const ctx = createViewContext(
  {
    alumniList: [],
    filteredList: [],
    sertifikatList: [],
    searchQuery: '',
    angkatanFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    sortColumn: 'alumni_at',
    sortDirection: 'desc',
    lastAlumniHash: '',
    lastCertHash: '',
    pendingRestoreId: null,
  },
  {
    // ⚡ Auto-subscribe ke perubahan data
    watchTypes: ['all', 'multiple', 'alumni', 'manual-refresh'],
    onDataChange: (type, state) => {
      if (!ctx.mounted) return;
      console.log(`[AlumniView] ⚡ Data changed (${type}) → re-render`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[AlumniView] Re-render error:', e);
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
    console.warn('[AlumniView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[AlumniView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    alumniList: [],
    filteredList: [],
    sertifikatList: [],
    searchQuery: '',
    angkatanFilter: '',
    currentPage: 1,
    sortColumn: 'alumni_at',
    sortDirection: 'desc',
    lastAlumniHash: '',
    lastCertHash: '',
    pendingRestoreId: null,
  });

  // Reset UI
  const searchEl = getEl('searchAlumniInput');
  const filterEl = getEl('filterAngkatan');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  bindEvents();

  // ===== ⚡ INSTANT RENDER dari preload cache =====
  const cachedAlumni = AdminModule.getAlumniList() || [];
  const cachedCerts = AdminModule.getSertifikatList() || [];

  if (cachedAlumni.length > 0 || cachedCerts.length > 0) {
    console.log('[AlumniView] ⚡ Rendering from preload cache');
    ctx.state.alumniList = cachedAlumni.map(a => ({ ...a }));
    ctx.state.sertifikatList = cachedCerts.map(c => ({ ...c }));
    ctx.state.lastAlumniHash = computeListHash(ctx.state.alumniList, ['id', 'alumni_at']);
    ctx.state.lastCertHash = computeListHash(ctx.state.sertifikatList, ['id', 'createdAt']);
    renderStats();
    renderAngkatanFilter();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[AlumniView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
    await loadAlumniData(false);
  }

  // ===== ⚡ SUBSCRIBE ke perubahan data =====
  await ctx.subscribeToData();

  // ===== ⚡ BIND refresh button ke global forceSync =====
  ctx.bindRefreshButton('refreshAlumniBtn', 'Data alumni disegarkan');

  // ⚡ NO POLLING — auto-sync global di app.js

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[AlumniView] unmounted');

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Top-level buttons
  ctx.on(getEl('exportAlumniBtn'), 'click', handleExport);
  ctx.on(getEl('confirmRestoreBtn'), 'click', handleConfirmRestore);

  // Search (debounced)
  ctx.on(getEl('searchAlumniInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  // Filter
  ctx.on(getEl('filterAngkatan'), 'change', function (e) {
    ctx.state.angkatanFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // ✅ DELEGATION — table
  const container = getEl('alumniTableContainer');
  if (container) {
    tableDelegationCleanup = delegateTableClicks(container, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => handleRowAction(action, id),
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   ⚡ NEW: REFRESH FROM CACHE (no fetch)
// ============================================================
function refreshFromCache() {
  const freshAlumni = AdminModule.getAlumniList() || [];
  const freshCerts = AdminModule.getSertifikatList() || [];

  const alumniHash = computeListHash(freshAlumni, ['id', 'alumni_at']);
  const certHash = computeListHash(freshCerts, ['id', 'createdAt']);

  const alumniChanged = alumniHash !== ctx.state.lastAlumniHash;
  const certChanged = certHash !== ctx.state.lastCertHash;

  if (!alumniChanged && !certChanged) {
    console.log('[AlumniView] No change detected, skip re-render');
    return;
  }

  if (alumniChanged) {
    ctx.state.alumniList = freshAlumni.map(a => ({ ...a }));
    ctx.state.lastAlumniHash = alumniHash;
  }
  if (certChanged) {
    ctx.state.sertifikatList = freshCerts.map(c => ({ ...c }));
    ctx.state.lastCertHash = certHash;
  }

  renderStats();
  renderAngkatanFilter();
  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   LOAD DATA (fallback jika preload gagal)
// ============================================================
async function loadAlumniData(forceRefresh = false) {
  if (forceRefresh) setCacheStatus('Memuat...');

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;

    refreshFromCache();
  } catch (e) {
    console.error('[AlumniView] load error:', e);
    const c = getEl('alumniTableContainer');
    if (c && ctx.state.alumniList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data alumni: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: STATS
// ============================================================
function renderStats() {
  const list = ctx.state.alumniList;
  const total = list.length;
  const thisYear = new Date().getFullYear();
  let thisYearCount = 0;
  const yearSet = new Set();

  list.forEach(a => {
    if (!a.alumni_at) return;
    const d = new Date(a.alumni_at);
    if (isNaN(d.getTime())) return;
    const y = d.getFullYear();
    yearSet.add(y);
    if (y === thisYear) thisYearCount++;
  });

  const totalAngkatan = yearSet.size;
  const rataRata = totalAngkatan > 0 ? Math.round(total / totalAngkatan) : 0;

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotalAlumni', total);
  setText('statAlumniTahunIni', thisYearCount);
  setText('statAngkatan', totalAngkatan);
  setText('statRataRata', rataRata);
}

// ============================================================
//   RENDER: ANGKATAN FILTER
// ============================================================
function renderAngkatanFilter() {
  const select = getEl('filterAngkatan');
  if (!select) return;

  const yearSet = new Set();
  ctx.state.alumniList.forEach(a => {
    const y = getYearFromDate(a.alumni_at);
    if (y) yearSet.add(String(y));
  });

  const years = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
  const currentVal = select.value;

  select.innerHTML = '<option value="">Semua Angkatan</option>';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (currentVal === y) opt.selected = true;
    select.appendChild(opt);
  });
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredAlumni(query, angkatan) {
  // ✅ FIX BUG-003: clone sebelum filter (cegah mutasi)
  let filtered = ctx.state.alumniList.slice();

  if (query && query.trim() !== '') {
    const q = query.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama_lengkap || '').toLowerCase().includes(q) ||
      (item.email || '').toLowerCase().includes(q) ||
      (item.no_hp || '').toLowerCase().includes(q) ||
      (item.utusan || '').toLowerCase().includes(q)
    );
  }

  if (angkatan && angkatan !== '') {
    filtered = filtered.filter(item => {
      const y = getYearFromDate(item.alumni_at);
      return y && String(y) === angkatan;
    });
  }

  return filtered;
}

function applyFiltersAndSort() {
  let filtered = getFilteredAlumni(ctx.state.searchQuery, ctx.state.angkatanFilter);

  if (ctx.state.sortColumn) {
    filtered.sort((a, b) => {
      let va, vb;

      if (ctx.state.sortColumn === 'alumni_at') {
        va = a.alumni_at ? new Date(a.alumni_at).getTime() : 0;
        vb = b.alumni_at ? new Date(b.alumni_at).getTime() : 0;
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else {
        va = String(a[ctx.state.sortColumn] || '').toLowerCase();
        vb = String(b[ctx.state.sortColumn] || '').toLowerCase();
      }

      if (va < vb) return ctx.state.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return ctx.state.sortDirection === 'asc' ? 1 : -1;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

  ctx.state.filteredList = filtered;
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  renderTable(filtered.slice(start, end), totalItems);
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeletonTable() {
  const c = getEl('alumniTableContainer');
  if (!c) return;

  const cells = Array(8).fill(0)
    .map(() => `<th><div class="skeleton-box" style="height:20px;width:80px;"></div></th>`)
    .join('');
  const rows = Array(5).fill(0).map(() =>
    `<tr>${Array(8).fill(0)
      .map(() => `<td><div class="skeleton-box" style="height:20px;width:100px;"></div></td>`)
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
//   RENDER: TABLE
// ============================================================
function renderTable(data, totalItems) {
  const c = getEl('alumniTableContainer');
  if (!c) return;

  // ✅ Build certMap O(n) — sekali saja
  const certMap = new Map();
  ctx.state.sertifikatList.forEach(ct => {
    if (!ct.nama_peserta) return;
    const key = String(ct.nama_peserta).toLowerCase().trim();
    if (!certMap.has(key)) certMap.set(key, ct);
  });

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th class="sortable ${ctx.state.sortColumn === 'nama_lengkap' ? ctx.state.sortDirection : ''}"
          data-sort="nama_lengkap" role="button" tabindex="0">Nama</th>
      <th class="sortable ${ctx.state.sortColumn === 'email' ? ctx.state.sortDirection : ''}"
          data-sort="email" role="button" tabindex="0">Email</th>
      <th class="sortable ${ctx.state.sortColumn === 'no_hp' ? ctx.state.sortDirection : ''}"
          data-sort="no_hp" role="button" tabindex="0">No HP</th>
      <th class="sortable ${ctx.state.sortColumn === 'utusan' ? ctx.state.sortDirection : ''}"
          data-sort="utusan" role="button" tabindex="0">Utusan</th>
      <th class="sortable ${ctx.state.sortColumn === 'alumni_at' ? ctx.state.sortDirection : ''}"
          data-sort="alumni_at" role="button" tabindex="0">Tgl Alumni</th>
      <th>Sertifikat</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (data.length === 0) {
    html += `<tr><td colspan="8" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data alumni.
    </td></tr>`;
  } else {
    data.forEach((item, i) => {
      const globalIdx = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage + i + 1;
      const safeId = escapeHtml(String(item.id));

      const certKey = String(item.nama_lengkap || '').toLowerCase().trim();
      const cert = certMap.get(certKey);

      let certHtml = '<span class="text-muted small">-</span>';
      if (cert) {
        const verifyUrl = `/bisaa/verifikasi.html?nomor=${encodeURIComponent(cert.nomor_sertifikat || '')}`;
        certHtml = `
          <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
             class="badge bg-success text-decoration-none"
             title="Verifikasi Sertifikat">
            ${escapeHtml(cert.nomor_sertifikat || '')}
          </a>
          ${cert.pdf_url ? `<br>
            <a href="${escapeHtml(cert.pdf_url)}" target="_blank" rel="noopener noreferrer"
               class="btn btn-sm btn-outline-primary mt-1" title="Download PDF"
               aria-label="Download PDF">
              <i class="bi bi-file-pdf" aria-hidden="true"></i>
            </a>` : ''}
        `;
      }

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama_lengkap || '-')}</strong></td>
        <td>${escapeHtml(item.email || '-')}</td>
        <td>${escapeHtml(item.no_hp || '-')}</td>
        <td>${escapeHtml(item.utusan || '-')}</td>
        <td>${escapeHtml(formatDateID(item.alumni_at))}</td>
        <td>${certHtml}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1"
                  data-action="view" data-id="${safeId}"
                  title="Lihat Detail" aria-label="Lihat detail ${escapeHtml(item.nama_lengkap || '')}">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-warning me-1"
                  data-action="restore" data-id="${safeId}"
                  title="Kembalikan ke Peserta" aria-label="Kembalikan ${escapeHtml(item.nama_lengkap || '')}">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary"
                  data-action="download" data-id="${safeId}"
                  title="Unduh Data" aria-label="Unduh data ${escapeHtml(item.nama_lengkap || '')}">
            <i class="bi bi-download" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  // Pagination
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">Menampilkan ${data.length > 0 ? (ctx.state.currentPage - 1) * ctx.state.itemsPerPage + 1 : 0} - ${Math.min(ctx.state.currentPage * ctx.state.itemsPerPage, totalItems)} dari ${totalItems} data</div>
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
}

// ============================================================
//   SORT & PAGINATION
// ============================================================
function handleSort(col) {
  if (ctx.state.sortColumn === col) {
    ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    // ✅ FIX BUG-008: pakai default direction per column
    ctx.state.sortColumn = col;
    ctx.state.sortDirection = DEFAULT_SORT_DIRECTIONS[col] || 'asc';
  }
  ctx.state.currentPage = 1;
  applyFiltersAndSort();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  applyFiltersAndSort();
}

// ============================================================
//   ROW ACTION ROUTER
// ============================================================
function handleRowAction(action, id) {
  switch (action) {
    case 'view':     return viewAlumni(id);
    case 'restore':  return confirmRestore(id);
    case 'download': return downloadSingle(id);
    default: console.warn('[AlumniView] Unknown action:', action);
  }
}

// ============================================================
//   VIEW DETAIL
// ============================================================
function viewAlumni(id) {
  const item = ctx.state.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const certKey = String(item.nama_lengkap || '').toLowerCase().trim();
  const cert = ctx.state.sertifikatList.find(ct =>
    ct.nama_peserta &&
    String(ct.nama_peserta).toLowerCase().trim() === certKey
  );

  let certHtml = '<div class="list-group-item py-3"><strong>Sertifikat:</strong> Belum ada</div>';
  if (cert) {
    const verifyUrl = `/bisaa/verifikasi.html?nomor=${encodeURIComponent(cert.nomor_sertifikat || '')}`;
    certHtml = `
      <div class="list-group-item py-3">
        <strong>Nomor Sertifikat:</strong>
        <a href="${verifyUrl}" target="_blank" rel="noopener noreferrer"
           class="badge bg-success text-decoration-none ms-2">
          ${escapeHtml(cert.nomor_sertifikat || '')}
        </a>
      </div>
      <div class="list-group-item py-3">
        <strong>PDF:</strong>
        ${cert.pdf_url ? `<a href="${escapeHtml(cert.pdf_url)}" target="_blank" rel="noopener noreferrer" class="ms-2">Unduh</a>` : 'Belum ada PDF'}
      </div>
    `;
  }

  const html = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama:</strong> ${escapeHtml(item.nama_lengkap || '-')}</div>
      <div class="list-group-item py-3"><strong>Email:</strong> ${escapeHtml(item.email || '-')}</div>
      <div class="list-group-item py-3"><strong>No HP:</strong> ${escapeHtml(item.no_hp || '-')}</div>
      <div class="list-group-item py-3"><strong>Tempat/Tgl Lahir:</strong> ${escapeHtml(item.tempat_tgl_lahir || '-')}</div>
      <div class="list-group-item py-3"><strong>Pekerjaan:</strong> ${escapeHtml(item.pekerjaan || '-')}</div>
      <div class="list-group-item py-3"><strong>Pendidikan:</strong> ${escapeHtml(item.pendidikan_terakhir || '-')}</div>
      <div class="list-group-item py-3"><strong>Alamat:</strong> ${escapeHtml(item.alamat || '-')}</div>
      <div class="list-group-item py-3"><strong>Utusan:</strong> ${escapeHtml(item.utusan || '-')}</div>
      <div class="list-group-item py-3"><strong>Pengalaman Organisasi:</strong> ${escapeHtml(item.pengalaman_organisasi || '-')}</div>
      <div class="list-group-item py-3"><strong>Tanggal Alumni:</strong> ${escapeHtml(formatDateID(item.alumni_at))}</div>
      ${certHtml}
    </div>
  `;

  const content = getEl('detailContent');
  if (content) content.innerHTML = html;

  ctx.getModal('detailAlumniModal')?.show();
}

// ============================================================
//   RESTORE
// ============================================================
function confirmRestore(id) {
  const item = ctx.state.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }
  ctx.state.pendingRestoreId = id;
  ctx.getModal('restoreConfirmModal')?.show();
}

async function handleConfirmRestore(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingRestoreId;
  if (!id) return;

  const item = ctx.state.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const btn = e?.currentTarget || getEl('confirmRestoreBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  try {
    const res = await callApi('moveBackToActive', { id }, 'POST');
    if (res && res.success) {
      showToast(`Alumni "${item.nama_lengkap}" dikembalikan ke peserta aktif`, 'success');
      ctx.getModal('restoreConfirmModal')?.hide();

      // ⚡ Optimistic remove
      ctx.state.alumniList = ctx.state.alumniList.filter(x => String(x.id) !== String(id));
      ctx.state.lastAlumniHash = computeListHash(ctx.state.alumniList, ['id', 'alumni_at']);
      applyFiltersAndSort();

      // Sync di background
      setTimeout(() => loadAlumniData(true).catch(() => {}), 400);
    } else {
      throw new Error((res && res.error) || 'Gagal mengembalikan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingRestoreId = null;
  }
}

// ============================================================
//   DOWNLOAD SINGLE
// ============================================================
function downloadSingle(id) {
  const item = ctx.state.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const exportData = {
    id: item.id,
    nama: item.nama_lengkap,
    email: item.email,
    hp: item.no_hp,
    tempat_tgl_lahir: item.tempat_tgl_lahir,
    pekerjaan: item.pekerjaan,
    pendidikan_terakhir: item.pendidikan_terakhir,
    alamat: item.alamat,
    utusan: item.utusan,
    pengalaman_organisasi: item.pengalaman_organisasi,
    alumni_at: item.alumni_at,
  };

  const fileName = `alumni_${(item.nama_lengkap || 'data').replace(/\s+/g, '_')}_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(exportData, fileName)) {
    showToast('Data alumni diunduh', 'success');
  } else {
    showToast('Gagal unduh data', 'error');
  }
}

// ============================================================
//   EXPORT ALL (filtered)
// ============================================================
function handleExport() {
  const data = ctx.state.filteredList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const exportData = data.map(item => ({
    id: item.id,
    nama: item.nama_lengkap,
    email: item.email,
    hp: item.no_hp,
    tempat_tgl_lahir: item.tempat_tgl_lahir,
    pekerjaan: item.pekerjaan,
    pendidikan_terakhir: item.pendidikan_terakhir,
    alamat: item.alamat,
    utusan: item.utusan,
    pengalaman_organisasi: item.pengalaman_organisasi,
    alumni_at: item.alumni_at,
  }));

  const fileName = `alumni_export_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(exportData, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} data alumni`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Alumni View v27.1.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// VIEW: alumni.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/alumni.html
// ============================================================
// Fitur:
// ✅ Stats cards (4): total alumni, tahun ini, angkatan, rata-rata
// ✅ Filter angkatan dropdown (auto-populate)
// ✅ Search (nama, email, HP, utusan)
// ✅ Sort (nama, email, HP, utusan, alumni_at)
// ✅ Pagination (15 item/page)
// ✅ View detail modal
// ✅ Restore (move back to active) dengan konfirmasi
// ✅ Download single alumni (JSON)
// ✅ Export all filtered alumni (JSON)
// ✅ Sertifikat lookup (verifikasi link + PDF)
// ✅ Auto-refresh 30 detik (visibility-aware)
// ✅ Cache status indicator
// ✅ Zero memory leak + full cleanup on unmount
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import { callApi, showToast, escapeHtml } from '../../js/core/api.js';

// ============================================================
//   MODULE-LEVEL STATE
// ============================================================
let refreshInterval = null;
let searchDebounceTimer = null;
let isMounted = false;

const STATE = {
  alumniList: [],
  filteredList: [],
  sertifikatList: [],
  searchQuery: '',
  angkatanFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: 'alumni_at',
  sortDirection: 'desc',
  pendingRestoreId: null,
  modals: {}, // cached Bootstrap modal instances
};

// ============================================================
//   LISTENER REGISTRY (auto-cleanup on unmount)
// ============================================================
const listeners = [];

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
    try { STATE.modals[id]?.dispose?.(); } catch (e) { /* silent */ }
  });
  STATE.modals = {};
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[AlumniView] Sudah mounted, skip double-mount');
    return unmount;
  }
  isMounted = true;
  console.log('[AlumniView] mounted');

  // Initial skeleton
  renderSkeletonTable();

  // Bind events
  bindTopLevelEvents();
  bindModalEvents();

  // Load data
  await loadAlumniData(false);

  // Auto refresh 30 detik
  refreshInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    AdminModule.loadAllData(false)
      .then(() => {
        const fresh = AdminModule.getAlumniList() || [];
        const freshSertifikat = AdminModule.getSertifikatList() || [];
        if (
          JSON.stringify(STATE.alumniList) !== JSON.stringify(fresh) ||
          JSON.stringify(STATE.sertifikatList) !== JSON.stringify(freshSertifikat)
        ) {
          STATE.alumniList = fresh;
          STATE.sertifikatList = freshSertifikat;
          renderStats();
          renderAngkatanFilter();
          applyFiltersAndSort();
          updateCacheStatus('Live');
        }
      })
      .catch(() => updateCacheStatus('Offline'));
  }, 30000);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[AlumniView] unmounted');

  // Interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }

  // Debounce
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // Listeners
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  // Modals
  disposeAllModals();

  // Bootstrap artifact cleanup
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
  on(getEl('exportAlumniBtn'), 'click', handleExport);
  on(getEl('refreshAlumniBtn'), 'click', handleRefresh);
  on(getEl('searchAlumniInput'), 'input', handleSearchInput);
  on(getEl('filterAngkatan'), 'change', handleAngkatanFilterChange);
}

// ============================================================
//   BIND: Modal Events
// ============================================================
function bindModalEvents() {
  on(getEl('confirmRestoreBtn'), 'click', handleConfirmRestore);
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadAlumniData(forceRefresh = false) {
  updateCacheStatus('Memuat...');

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }

    STATE.alumniList = AdminModule.getAlumniList() || [];
    STATE.sertifikatList = AdminModule.getSertifikatList() || [];

    renderStats();
    renderAngkatanFilter();
    applyFiltersAndSort();
    updateCacheStatus('Live');
  } catch (e) {
    console.error('[AlumniView] load error:', e);
    const c = getEl('alumniTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-danger">Gagal memuat data alumni: ${escapeHtml(e.message)}</div>`;
    }
    updateCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: Stats
// ============================================================
function renderStats() {
  const list = STATE.alumniList;
  const total = list.length;

  // Tahun ini
  const thisYear = new Date().getFullYear();
  const thisYearCount = list.filter(a => {
    if (!a.alumni_at) return false;
    const d = new Date(a.alumni_at);
    return !isNaN(d.getTime()) && d.getFullYear() === thisYear;
  }).length;

  // Jumlah angkatan unik
  const yearSet = new Set();
  list.forEach(a => {
    if (a.alumni_at) {
      const d = new Date(a.alumni_at);
      if (!isNaN(d.getTime())) yearSet.add(d.getFullYear());
    }
  });
  const totalAngkatan = yearSet.size;

  // Rata-rata per tahun
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
//   RENDER: Angkatan Filter Dropdown
// ============================================================
function renderAngkatanFilter() {
  const select = getEl('filterAngkatan');
  if (!select) return;

  const yearSet = new Set();
  STATE.alumniList.forEach(a => {
    if (a.alumni_at) {
      const d = new Date(a.alumni_at);
      if (!isNaN(d.getTime())) yearSet.add(String(d.getFullYear()));
    }
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
  let filtered = STATE.alumniList;

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
      if (!item.alumni_at) return false;
      const d = new Date(item.alumni_at);
      return !isNaN(d.getTime()) && String(d.getFullYear()) === angkatan;
    });
  }

  return filtered;
}

function applyFiltersAndSort() {
  let filtered = getFilteredAlumni(STATE.searchQuery, STATE.angkatanFilter);

  // Sort
  if (STATE.sortColumn) {
    filtered.sort((a, b) => {
      let va, vb;

      if (STATE.sortColumn === 'alumni_at') {
        va = a.alumni_at ? new Date(a.alumni_at).getTime() : 0;
        vb = b.alumni_at ? new Date(b.alumni_at).getTime() : 0;
        // Guard NaN
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else {
        va = String(a[STATE.sortColumn] || '').toLowerCase();
        vb = String(b[STATE.sortColumn] || '').toLowerCase();
      }

      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;

      // Tie-breaker: by id desc
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }

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
  const c = getEl('alumniTableContainer');
  if (!c) return;

  let html = '<div class="table-responsive"><table class="table table-hover align-middle"><thead class="table-light"><tr>';
  for (let i = 0; i < 8; i++) {
    html += '<th><div class="skeleton-box" style="height:20px;width:80px;"></div></th>';
  }
  html += '</tr></thead><tbody>';
  for (let r = 0; r < 5; r++) {
    html += '<tr>';
    for (let i = 0; i < 8; i++) {
      html += '<td><div class="skeleton-box" style="height:20px;width:100px;"></div></td>';
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
  const c = getEl('alumniTableContainer');
  if (!c) return;

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th class="sortable ${STATE.sortColumn === 'nama_lengkap' ? STATE.sortDirection : ''}" data-sort="nama_lengkap" role="button" tabindex="0">Nama</th>
      <th class="sortable ${STATE.sortColumn === 'email' ? STATE.sortDirection : ''}" data-sort="email" role="button" tabindex="0">Email</th>
      <th class="sortable ${STATE.sortColumn === 'no_hp' ? STATE.sortDirection : ''}" data-sort="no_hp" role="button" tabindex="0">No HP</th>
      <th class="sortable ${STATE.sortColumn === 'utusan' ? STATE.sortDirection : ''}" data-sort="utusan" role="button" tabindex="0">Utusan</th>
      <th class="sortable ${STATE.sortColumn === 'alumni_at' ? STATE.sortDirection : ''}" data-sort="alumni_at" role="button" tabindex="0">Tgl Alumni</th>
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
      const globalIdx = (STATE.currentPage - 1) * STATE.itemsPerPage + i + 1;
      const safeId = escapeHtml(String(item.id));

      // Cari sertifikat berdasarkan nama (case-insensitive)
      const cert = STATE.sertifikatList.find(c =>
        c.nama_peserta &&
        String(c.nama_peserta).toLowerCase().trim() === String(item.nama_lengkap || '').toLowerCase().trim()
      );

      let certHtml = '<span class="text-muted small">-</span>';
      if (cert) {
        const verifyUrl = `/bisaa/verifikasi.html?nomor=${encodeURIComponent(cert.nomor_sertifikat || '')}`;
        certHtml = `
          <a href="${verifyUrl}" target="_blank" rel="noopener" class="badge bg-success text-decoration-none" title="Verifikasi Sertifikat">
            ${escapeHtml(cert.nomor_sertifikat || '')}
          </a>
          ${cert.pdf_url ? `<br><a href="${escapeHtml(cert.pdf_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary mt-1" title="Download PDF">
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
        <td>${formatDate(item.alumni_at)}</td>
        <td>${certHtml}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="view" data-id="${safeId}" title="Lihat Detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="restore" data-id="${safeId}" title="Kembalikan ke Peserta">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-action="download" data-id="${safeId}" title="Unduh Data">
            <i class="bi bi-download" aria-hidden="true"></i>
          </button>
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
    if (startPage > 2) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>...</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button type="button" class="btn btn-sm ${i === STATE.currentPage ? 'btn-primary' : 'btn-outline-secondary'}" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>...</button>`;
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  // Bind events
  bindTableEvents();
}

function bindTableEvents() {
  const c = getEl('alumniTableContainer');
  if (!c) return;

  // Sort headers
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', function () {
      const col = this.dataset.sort;
      if (STATE.sortColumn === col) {
        STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.sortColumn = col;
        STATE.sortDirection = 'asc';
      }
      STATE.currentPage = 1;
      applyFiltersAndSort();
    });
    th.addEventListener('keypress', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.click();
      }
    });
  });

  // Action buttons
  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', function () {
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
  const item = STATE.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  // Cari sertifikat
  const cert = STATE.sertifikatList.find(c =>
    c.nama_peserta &&
    String(c.nama_peserta).toLowerCase().trim() === String(item.nama_lengkap || '').toLowerCase().trim()
  );

  let certHtml = '<div class="list-group-item py-3"><strong>Sertifikat:</strong> Belum ada</div>';
  if (cert) {
    certHtml = `
      <div class="list-group-item py-3">
        <strong>Nomor Sertifikat:</strong>
        <a href="/bisaa/verifikasi.html?nomor=${encodeURIComponent(cert.nomor_sertifikat || '')}" 
           target="_blank" rel="noopener" class="badge bg-success text-decoration-none ms-2">
          ${escapeHtml(cert.nomor_sertifikat || '')}
        </a>
      </div>
      <div class="list-group-item py-3">
        <strong>PDF:</strong>
        ${cert.pdf_url ? `<a href="${escapeHtml(cert.pdf_url)}" target="_blank" rel="noopener" class="ms-2">Unduh</a>` : 'Belum ada PDF'}
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
      <div class="list-group-item py-3"><strong>Tanggal Alumni:</strong> ${formatDate(item.alumni_at)}</div>
      ${certHtml}
    </div>
  `;

  const content = getEl('detailContent');
  if (content) content.innerHTML = html;

  getModal('detailAlumniModal')?.show();
}

// ============================================================
//   RESTORE (Move Back to Active)
// ============================================================
function confirmRestore(id) {
  const item = STATE.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  STATE.pendingRestoreId = id;
  getModal('restoreConfirmModal')?.show();
}

async function handleConfirmRestore() {
  const id = STATE.pendingRestoreId;
  if (!id) return;

  const item = STATE.alumniList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const btn = getEl('confirmRestoreBtn');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Memproses...';
  }

  try {
    const res = await callApi('moveBackToActive', { id }, 'POST');
    if (res && res.success) {
      showToast(`Alumni "${item.nama_lengkap}" dikembalikan ke peserta aktif`, 'success');
      getModal('restoreConfirmModal')?.hide();
      await loadAlumniData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal mengembalikan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
    STATE.pendingRestoreId = null;
  }
}

// ============================================================
//   DOWNLOAD SINGLE
// ============================================================
function downloadSingle(id) {
  const item = STATE.alumniList.find(p => String(p.id) === String(id));
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

  try {
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alumni_${(item.nama_lengkap || 'data').replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data alumni diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh: ' + e.message, 'error');
  }
}

// ============================================================
//   EXPORT ALL (filtered)
// ============================================================
function handleExport() {
  const data = STATE.filteredList;
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

  try {
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alumni_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data alumni`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh() {
  const btn = getEl('refreshAlumniBtn');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Memuat...';
  }

  try {
    await loadAlumniData(true);
    showToast('Data alumni disegarkan', 'success');
  } catch (e) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// ============================================================
//   SEARCH & FILTER HANDLERS
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

function handleAngkatanFilterChange(e) {
  STATE.angkatanFilter = e.target.value;
  STATE.currentPage = 1;
  applyFiltersAndSort();
}

// ============================================================
//   UTILITY
// ============================================================
function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch (e) {
    return '-';
  }
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
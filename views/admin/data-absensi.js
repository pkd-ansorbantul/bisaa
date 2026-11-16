// ============================================================
// VIEW: data-absensi.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/data-absensi.html
// ============================================================
// Fitur:
// ✅ Stats: total kehadiran, peserta unik, sesi terpakai, absen hari ini
// ✅ Filter sesi & tanggal
// ✅ Search debounced
// ✅ Sort (nama, sesi, timestamp)
// ✅ Pagination
// ✅ Detail modal (termasuk TTD)
// ✅ Delete (dengan fallback 3-tier)
// ✅ Export CSV (UTF-8 BOM)
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + cleanup on unmount
// ============================================================

import {
  showToast,
  escapeHtml,
  getAbsensiResponses,
  deleteAbsensi as apiDeleteAbsensi,
  getSesiAbsen,
} from '../../js/core/api.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
  absensiList: [],
  sesiList: [],
  filteredList: [],
  searchQuery: '',
  filterSesi: '',
  filterTanggal: '',
  sortColumn: 'timestamp',
  sortDirection: 'desc',
  currentPage: 1,
  itemsPerPage: 15,
  pendingDeleteId: null,
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

function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(ts); }
}

function formatDateOnly(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ''; }
}

function normalizeResult(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (res.data && Array.isArray(res.data)) return res.data;
  return [];
}

function getNamaSesi(sesiId) {
  const s = STATE.sesiList.find(x => String(x.id) === String(sesiId));
  return s ? (s.nama || '(Sesi)') : '(Sesi tidak diketahui)';
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[DataAbsensiView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[DataAbsensiView] mounted');

  // Reset state
  STATE.absensiList = [];
  STATE.sesiList = [];
  STATE.filteredList = [];
  STATE.searchQuery = '';
  STATE.filterSesi = '';
  STATE.filterTanggal = '';
  STATE.sortColumn = 'timestamp';
  STATE.sortDirection = 'desc';
  STATE.currentPage = 1;
  STATE.pendingDeleteId = null;

  // Reset form filter
  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');
  if (filterSesiEl) filterSesiEl.value = '';
  if (filterTanggalEl) filterTanggalEl.value = '';
  if (searchEl) searchEl.value = '';

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
  console.log('[DataAbsensiView] unmounted');

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
  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');

  on(getEl('applyFilterBtn'), 'click', () => {
    STATE.filterSesi = filterSesiEl ? filterSesiEl.value : '';
    STATE.filterTanggal = filterTanggalEl ? filterTanggalEl.value : '';
    applyFiltersAndSort();
  });

  on(getEl('resetFilterBtn'), 'click', () => {
    if (filterSesiEl) filterSesiEl.value = '';
    if (filterTanggalEl) filterTanggalEl.value = '';
    if (searchEl) searchEl.value = '';
    STATE.filterSesi = '';
    STATE.filterTanggal = '';
    STATE.searchQuery = '';
    applyFiltersAndSort();
  });

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFiltersAndSort();
  }, 300));

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
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

  on(getEl('exportDataBtn'), 'click', exportCSV);
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    const [absensiRes, sesiRes] = await Promise.all([
      getAbsensiResponses(),
      getSesiAbsen(),
    ]);

    STATE.absensiList = normalizeResult(absensiRes);
    STATE.sesiList = normalizeResult(sesiRes);

    renderSesiFilter();
    applyFiltersAndSort();

    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[DataAbsensiView] load error:', e);
    const c = getEl('absensiTableContainer');
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
//   STATS
// ============================================================
function renderStats() {
  const list = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;
  const total = list.length;

  const pesertaSet = new Set();
  const sesiSet = new Set();
  let todayCount = 0;
  const today = formatDateOnly(new Date());

  list.forEach(item => {
    if (item.nama) pesertaSet.add(String(item.nama).trim().toLowerCase());
    if (item.sesiId) sesiSet.add(String(item.sesiId));
    if (formatDateOnly(item.timestamp) === today) todayCount++;
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotal', total);
  setText('statPeserta', pesertaSet.size);
  setText('statSesi', sesiSet.size);
  setText('statHariIni', todayCount);
}

// ============================================================
//   DROPDOWN SESI
// ============================================================
function renderSesiFilter() {
  const sel = getEl('filterSesi');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua Sesi</option>';
  STATE.sesiList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.nama || ('Sesi ' + s.id);
    if (String(cur) === String(s.id)) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('absensiTableContainer');
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
  let arr = STATE.absensiList.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.nama || '').toLowerCase().includes(q) ||
      String(item.namaSesi || getNamaSesi(item.sesiId) || '').toLowerCase().includes(q)
    );
  }

  if (STATE.filterSesi !== '') {
    arr = arr.filter(item => String(item.sesiId) === String(STATE.filterSesi));
  }

  if (STATE.filterTanggal !== '') {
    arr = arr.filter(item => formatDateOnly(item.timestamp) === STATE.filterTanggal);
  }

  if (STATE.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (STATE.sortColumn === 'timestamp') {
        va = new Date(a.timestamp || 0).getTime();
        vb = new Date(b.timestamp || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else if (STATE.sortColumn === 'namaSesi') {
        va = String(a.namaSesi || getNamaSesi(a.sesiId)).toLowerCase();
        vb = String(b.namaSesi || getNamaSesi(b.sesiId)).toLowerCase();
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
  renderStats();
}

// ============================================================
//   RENDER: TABLE
// ============================================================
function renderTable() {
  const c = getEl('absensiTableContainer');
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

  let html = `<div class="table-responsive"><table class="table table-bordered table-hover table-sm align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th style="cursor:pointer;" data-sort="nama">Nama Peserta ${arrow('nama')}</th>
      <th style="cursor:pointer;" data-sort="namaSesi">Sesi ${arrow('namaSesi')}</th>
      <th style="cursor:pointer;" data-sort="timestamp">Waktu Absen ${arrow('timestamp')}</th>
      <th style="width:130px;" class="text-center">Tanda Tangan</th>
      <th style="width:110px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = STATE.filterSesi || STATE.filterTanggal || STATE.searchQuery;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      Tidak ada data absensi${hasFilter ? ' untuk filter ini' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
      const safeId = escapeHtml(String(item.id || ''));
      const ttd = item.signatureDriveId
        ? `<a href="https://drive.google.com/file/d/${item.signatureDriveId}/view" target="_blank" rel="noopener"
             class="btn btn-sm btn-outline-primary">
             <i class="bi bi-eye"></i> Lihat
           </a>`
        : '<span class="text-muted small">-</span>';

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td><small>${escapeHtml(namaSesi)}</small></td>
        <td><small>${escapeHtml(formatDateTime(item.timestamp))}</small></td>
        <td class="text-center">${ttd}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}" title="Detail">
            <i class="bi bi-info-circle"></i>
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

  if (action === 'detail') viewAbsensiDetail(id);
  else if (action === 'delete') confirmDeleteAbsensi(id);
  else if (action === 'goto') goToPage(page);
}

function handleSort(col) {
  if (STATE.sortColumn === col) {
    STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortColumn = col;
    STATE.sortDirection = 'asc';
  }
  STATE.currentPage = 1;
  applyFiltersAndSort();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
  getEl('absensiTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   DETAIL & DELETE
// ============================================================
function viewAbsensiDetail(id) {
  const item = STATE.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
  const ttdLink = item.signatureDriveId
    ? `<a href="https://drive.google.com/file/d/${item.signatureDriveId}/view" target="_blank" rel="noopener"
         class="btn btn-sm btn-outline-primary"><i class="bi bi-box-arrow-up-right"></i> Buka TTD</a>`
    : '<span class="text-muted">Tidak ada tanda tangan</span>';

  const content = getEl('detailAbsensiContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama Peserta:</strong><br>${escapeHtml(item.nama || '-')}</div>
      <div class="list-group-item py-3"><strong>ID Peserta:</strong> <code>${escapeHtml(String(item.pesertaId || '-'))}</code></div>
      <div class="list-group-item py-3"><strong>Sesi:</strong> ${escapeHtml(namaSesi)} <small class="text-muted">(ID: ${escapeHtml(String(item.sesiId || '-'))})</small></div>
      <div class="list-group-item py-3"><strong>Waktu Absen:</strong> ${escapeHtml(formatDateTime(item.timestamp))}</div>
      <div class="list-group-item py-3"><strong>ID Drive TTD:</strong><br><code class="small" style="word-break:break-all;">${escapeHtml(String(item.signatureDriveId || '-'))}</code></div>
      <div class="list-group-item py-3"><strong>Tanda Tangan:</strong><br>${ttdLink}</div>
    </div>`;

  getModal('detailAbsensiModal')?.show();
}

function confirmDeleteAbsensi(id) {
  const item = STATE.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }
  STATE.pendingDeleteId = id;
  getEl('deleteAbsensiId').value = id;
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const id = getEl('deleteAbsensiId').value;
  if (!id) return;

  const item = STATE.absensiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const payload = {
      id: id,
      _rowIndex: item._rowIndex || undefined,
      nama: item.nama || undefined,
      sesiId: item.sesiId || undefined,
      pesertaId: item.pesertaId || undefined,
    };
    const res = await apiDeleteAbsensi(payload);

    if (res && res.success) {
      showToast('Data absensi berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();

      // Optimistic update
      STATE.absensiList = STATE.absensiList.filter(x => String(x.id) !== String(id));
      applyFiltersAndSort();

      // Sync ulang
      setTimeout(() => loadData(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus di server');
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
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const headers = ['No', 'Nama Peserta', 'ID Peserta', 'Sesi', 'ID Sesi', 'Waktu Absen', 'Drive TTD'];
  const rows = data.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
    return [
      i + 1,
      item.nama || '',
      item.pesertaId || '',
      namaSesi,
      item.sesiId || '',
      formatDateTime(item.timestamp),
      item.signatureDriveId || '',
    ];
  });

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  try {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data_absensi_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
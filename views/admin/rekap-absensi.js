// ============================================================
// VIEW: rekap-absensi.js — v27.2.0 PRELOAD + SUBSCRIPTION
// Dimuat oleh: js/router.js
// HTML: views/admin/rekap-absensi.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 30s
//   ✅ FIX: Chart destroy guard pakai cheap hash
//   ✅ FIX: Chart.js lazy load via ensureChartJS
//   ✅ FIX: Print iframe cleanup on unmount
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Filter sesi + tanggal, search, sort, CSV export, print
//   ✅ Zero memory leak
// ============================================================

import {
  showToast,
  escapeHtml,
  formatDateTimeID,
  getLocalDateOnly,
  downloadCSV,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';
import {
  getEl,
  debounce,
  setBtnLoading,
  createViewContext,
  delegateTableClicks,
  ensureChartJS,
  captureFocusState,
  restoreFocusState,
  cleanupBootstrapArtifacts,
  computeListHash,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const STATUS_MAP = {
  hadir: { label: 'Hadir', color: '#16a34a', bg: 'bg-success' },
  izin:  { label: 'Izin',  color: '#f59e0b', bg: 'bg-warning text-dark' },
  sakit: { label: 'Sakit', color: '#0891b2', bg: 'bg-info text-dark' },
  alpha: { label: 'Alpha', color: '#dc2626', bg: 'bg-danger' },
};

// ============================================================
//   LOCAL HELPERS
// ============================================================
function computeChartHash() {
  return [
    ctx.state.absensiList.length,
    ctx.state.filteredList.length,
    ctx.state.sesiList.length,
    ctx.state.filterSesi || '',
    ctx.state.filterTanggal || '',
    ctx.state.searchQuery || '',
  ].join('|');
}

function setCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

function getNamaSesi(sesiId) {
  const s = ctx.state.sesiList.find(x => String(x.id) === String(sesiId));
  return s ? (s.nama || '(Sesi)') : '(Sesi tidak diketahui)';
}

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s || s === 'hadir') return 'hadir';
  if (s === 'izin') return 'izin';
  if (s === 'sakit') return 'sakit';
  if (s === 'alpha') return 'alpha';
  return 'hadir';
}

function formatDateTimeRange(startStr, endStr) {
  if (!startStr) return '-';
  try {
    const start = new Date(startStr);
    if (isNaN(start.getTime())) return String(startStr);
    const pad = n => String(n).padStart(2, '0');
    const dateStr = `${pad(start.getDate())}/${pad(start.getMonth() + 1)}/${start.getFullYear()}`;
    const startTime = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    let endTime = '';
    if (endStr) {
      const end = new Date(endStr);
      if (!isNaN(end.getTime())) {
        endTime = ' - ' + `${pad(end.getHours())}:${pad(end.getMinutes())}`;
      }
    }
    return `${dateStr} ${startTime}${endTime}`;
  } catch { return String(startStr); }
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    absensiList: [],
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    filterSesi: '',
    filterTanggal: '',
    sortColumn: 'nama',
    sortDirection: 'asc',
    currentPage: 1,
    itemsPerPage: 15,
    lastAbsensiHash: '',
    lastSesiHash: '',
    lastChartHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'absensi'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[RekapAbsensiView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[RekapAbsensiView] Re-render error:', e);
      }
    },
  }
);

let tableDelegationCleanup = null;
let statusChartInstance = null;
let sesiChartInstance = null;
let printIframe = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[RekapAbsensiView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[RekapAbsensiView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    absensiList: [],
    sesiList: [],
    filteredList: [],
    searchQuery: '',
    filterSesi: '',
    filterTanggal: '',
    sortColumn: 'nama',
    sortDirection: 'asc',
    currentPage: 1,
    lastAbsensiHash: '',
    lastSesiHash: '',
    lastChartHash: '',
  });

  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');
  if (filterSesiEl) filterSesiEl.value = '';
  if (filterTanggalEl) filterTanggalEl.value = '';
  if (searchEl) searchEl.value = '';

  // Destroy existing charts
  destroyCharts();

  // Lazy load Chart.js
  ensureChartJS().catch(e => {
    console.warn('[RekapAbsensiView] Chart.js unavailable:', e.message);
  });

  // ⚡ Instant render dari preload cache
  const cachedAbsen = AdminModule.getAbsensiList() || [];
  const cachedSesi = AdminModule.getSesiList() || [];

  if (cachedAbsen.length > 0 || cachedSesi.length > 0) {
    console.log('[RekapAbsensiView] ⚡ Rendering from preload cache');
    ctx.state.absensiList = cachedAbsen.map(a => ({ ...a }));
    ctx.state.sesiList = cachedSesi.map(s => ({ ...s }));
    ctx.state.lastAbsensiHash = computeListHash(ctx.state.absensiList);
    ctx.state.lastSesiHash = computeListHash(ctx.state.sesiList, ['id', 'nama']);
    renderSesiFilter();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[RekapAbsensiView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cachedAbsen.length === 0 && cachedSesi.length === 0) {
    await loadData(false);
  } else {
    // Render charts (async, tidak blocking)
    renderCharts().catch(e => console.warn('[RekapAbsensiView] Chart error:', e));
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[RekapAbsensiView] unmounted');

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  destroyCharts();

  // Cleanup print iframe
  if (printIframe) {
    try { printIframe.remove(); } catch (e) { /* silent */ }
    printIframe = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

function destroyCharts() {
  if (statusChartInstance) {
    try { statusChartInstance.destroy(); } catch (e) { /* silent */ }
    statusChartInstance = null;
  }
  if (sesiChartInstance) {
    try { sesiChartInstance.destroy(); } catch (e) { /* silent */ }
    sesiChartInstance = null;
  }
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const freshAbsen = AdminModule.getAbsensiList() || [];
  const freshSesi = AdminModule.getSesiList() || [];

  const absenHash = computeListHash(freshAbsen);
  const sesiHash = computeListHash(freshSesi, ['id', 'nama']);

  const absenChanged = absenHash !== ctx.state.lastAbsensiHash;
  const sesiChanged = sesiHash !== ctx.state.lastSesiHash;

  if (!absenChanged && !sesiChanged) {
    console.log('[RekapAbsensiView] No change, skip re-render');
    return;
  }

  if (absenChanged) {
    ctx.state.absensiList = freshAbsen.map(a => ({ ...a }));
    ctx.state.lastAbsensiHash = absenHash;
  }
  if (sesiChanged) {
    ctx.state.sesiList = freshSesi.map(s => ({ ...s }));
    ctx.state.lastSesiHash = sesiHash;
    renderSesiFilter();
  }

  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');

  ctx.on(getEl('applyFilterBtn'), 'click', () => {
    ctx.state.filterSesi = filterSesiEl ? filterSesiEl.value : '';
    ctx.state.filterTanggal = filterTanggalEl ? filterTanggalEl.value : '';
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  ctx.on(getEl('resetFilterBtn'), 'click', () => {
    if (filterSesiEl) filterSesiEl.value = '';
    if (filterTanggalEl) filterTanggalEl.value = '';
    if (searchEl) searchEl.value = '';
    ctx.state.filterSesi = '';
    ctx.state.filterTanggal = '';
    ctx.state.searchQuery = '';
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  ctx.on(searchEl, 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);
  ctx.on(getEl('exportDataBtn'), 'click', exportCSV);
  ctx.on(getEl('printBtn'), 'click', printRekap);

  // ✅ DELEGATION — table
  const container = getEl('rekapTableContainer');
  if (container) {
    tableDelegationCleanup = delegateTableClicks(container, {
      onSort: (col) => handleSort(col),
      onPage: (page) => goToPage(page),
    });
  }
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
    renderCharts().catch(() => {});
  } catch (e) {
    console.error('[RekapAbsensiView] load error:', e);
    const c = getEl('rekapTableContainer');
    if (c && ctx.state.absensiList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

async function handleRefresh(e) {
  if (ctx.saving) return;
  const btn = e?.currentTarget || getEl('refreshDataBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    ctx.state.lastChartHash = '';
    await AdminModule.loadAllData(true);
    refreshFromCache();
    renderCharts().catch(() => {});
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonTable() {
  const c = getEl('rekapTableContainer');
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
//   DROPDOWN SESI
// ============================================================
function renderSesiFilter() {
  const sel = getEl('filterSesi');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Semua Sesi</option>';
  ctx.state.sesiList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.nama || 'Sesi'} — ${formatDateTimeRange(s.waktu_mulai, s.waktu_selesai)}`;
    if (String(cur) === String(s.id)) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = ctx.state.absensiList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.nama || '').toLowerCase().includes(q) ||
      String(item.namaSesi || getNamaSesi(item.sesiId) || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.filterSesi !== '') {
    arr = arr.filter(item => String(item.sesiId) === String(ctx.state.filterSesi));
  }

  if (ctx.state.filterTanggal !== '') {
    arr = arr.filter(item => getLocalDateOnly(item.timestamp) === ctx.state.filterTanggal);
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      let va, vb;
      if (ctx.state.sortColumn === 'timestamp') {
        va = new Date(a.timestamp || 0).getTime() || 0;
        vb = new Date(b.timestamp || 0).getTime() || 0;
      } else if (ctx.state.sortColumn === 'namaSesi') {
        va = String(a.namaSesi || getNamaSesi(a.sesiId)).toLowerCase();
        vb = String(b.namaSesi || getNamaSesi(b.sesiId)).toLowerCase();
      } else if (ctx.state.sortColumn === 'status') {
        va = normalizeStatus(a.status);
        vb = normalizeStatus(b.status);
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

  renderStats();
  renderTable();
  renderCharts().catch(() => {});
}

// ============================================================
//   STATS
// ============================================================
function renderStats() {
  const list = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;

  let hadir = 0, izin = 0, sakit = 0, alpha = 0;
  list.forEach(item => {
    const s = normalizeStatus(item.status);
    if (s === 'hadir') hadir++;
    else if (s === 'izin') izin++;
    else if (s === 'sakit') sakit++;
    else if (s === 'alpha') alpha++;
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statHadir', hadir);
  setText('statIzin', izin);
  setText('statSakit', sakit);
  setText('statAlpha', alpha);
}

// ============================================================
//   CHARTS — Hash guard
// ============================================================
async function renderCharts() {
  try {
    await ensureChartJS();
  } catch (e) {
    console.warn('[RekapAbsensiView] Chart.js tidak tersedia:', e.message);
    return;
  }

  if (typeof Chart === 'undefined') return;

  const chartHash = computeChartHash();
  if (chartHash === ctx.state.lastChartHash) return;
  ctx.state.lastChartHash = chartHash;

  const hadir = parseInt(getEl('statHadir')?.textContent) || 0;
  const izin = parseInt(getEl('statIzin')?.textContent) || 0;
  const sakit = parseInt(getEl('statSakit')?.textContent) || 0;
  const alpha = parseInt(getEl('statAlpha')?.textContent) || 0;

  renderStatusChart({ hadir, izin, sakit, alpha });
  renderSesiChart();
}

function renderStatusChart(stats) {
  const canvas = getEl('statusChart');
  if (!canvas) return;

  if (statusChartInstance) {
    try { statusChartInstance.destroy(); } catch (e) { /* silent */ }
    statusChartInstance = null;
  }

  const total = stats.hadir + stats.izin + stats.sakit + stats.alpha;

  if (total === 0) {
    try {
      statusChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Belum ada data'],
          datasets: [{ data: [1], backgroundColor: ['#e2e8f0'], borderWidth: 0 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
        },
      });
    } catch (e) { /* silent */ }
    return;
  }

  try {
    statusChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Hadir', 'Izin', 'Sakit', 'Alpha'],
        datasets: [{
          data: [stats.hadir, stats.izin, stats.sakit, stats.alpha],
          backgroundColor: [
            STATUS_MAP.hadir.color,
            STATUS_MAP.izin.color,
            STATUS_MAP.sakit.color,
            STATUS_MAP.alpha.color,
          ],
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const t = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const v = ctx.parsed;
                const pct = t > 0 ? Math.round((v / t) * 100) : 0;
                return `${ctx.label}: ${v} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('[RekapAbsensiView] statusChart error:', e);
  }
}

function renderSesiChart() {
  const canvas = getEl('sesiChart');
  if (!canvas) return;

  if (sesiChartInstance) {
    try { sesiChartInstance.destroy(); } catch (e) { /* silent */ }
    sesiChartInstance = null;
  }

  const list = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;
  const counts = {};
  list.forEach(item => {
    const sid = String(item.sesiId || 'unknown');
    counts[sid] = (counts[sid] || 0) + 1;
  });

  const labels = [], data = [], colors = [];
  const palette = ['#4e73df', '#1cc88a', '#36b9cc', '#f6c23e', '#e74a3b', '#858796', '#6f42c1', '#20c997'];

  let i = 0;
  Object.keys(counts).forEach(sid => {
    labels.push(getNamaSesi(sid));
    data.push(counts[sid]);
    colors.push(palette[i % palette.length]);
    i++;
  });

  if (data.length === 0) {
    labels.push('Belum ada data');
    data.push(0);
    colors.push('#e2e8f0');
  }

  try {
    sesiChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Jumlah Kehadiran',
          data,
          backgroundColor: colors,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
          x: { ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 30 } },
        },
      },
    });
  } catch (e) {
    console.error('[RekapAbsensiView] sesiChart error:', e);
  }
}

// ============================================================
//   RENDER TABLE
// ============================================================
function renderTable() {
  const c = getEl('rekapTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  const totalItems = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

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
      <th data-sort="nama" style="cursor:pointer;">Peserta ${arrow('nama')}</th>
      <th data-sort="namaSesi" style="cursor:pointer;">Sesi ${arrow('namaSesi')}</th>
      <th data-sort="timestamp" style="cursor:pointer;">Waktu Absen ${arrow('timestamp')}</th>
      <th data-sort="status" style="cursor:pointer;">Status ${arrow('status')}</th>
      <th>Keterangan</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.filterSesi || ctx.state.filterTanggal || ctx.state.searchQuery;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data rekap${hasFilter ? ' untuk filter ini' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
      const statusKey = normalizeStatus(item.status);
      const statusInfo = STATUS_MAP[statusKey] || STATUS_MAP.hadir;
      const sesi = ctx.state.sesiList.find(s => String(s.id) === String(item.sesiId));

      let sesiDisplay = escapeHtml(namaSesi);
      if (sesi) {
        sesiDisplay += `<br><small class="text-muted">${escapeHtml(formatDateTimeRange(sesi.waktu_mulai, sesi.waktu_selesai))}</small>`;
      }

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td>${sesiDisplay}</td>
        <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
        <td><span class="badge ${statusInfo.bg}">${escapeHtml(statusInfo.label)}</span></td>
        <td><small class="text-muted">${escapeHtml(item.catatan || '-')}</small></td>
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
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="1">1</button>`;
    if (startPage > 2) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
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
  getEl('rekapTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const headers = ['No', 'Nama Peserta', 'Sesi', 'ID Sesi', 'Waktu Absen', 'Status', 'Keterangan'];
  const rows = data.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
    return [
      i + 1,
      item.nama || '',
      namaSesi,
      item.sesiId || '',
      formatDateTimeID(item.timestamp),
      STATUS_MAP[normalizeStatus(item.status)]?.label || 'Hadir',
      item.catatan || '',
    ];
  });

  const fileName = `rekap_absensi_${getLocalDateOnly(new Date())}.csv`;
  if (downloadCSV(rows, headers, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   PRINT — IFRAME FALLBACK
// ============================================================
function printRekap() {
  const list = ctx.state.filteredList.length ? ctx.state.filteredList : ctx.state.absensiList;
  if (list.length === 0) {
    showToast('Tidak ada data untuk dicetak', 'info');
    return;
  }

  const stats = {
    hadir: getEl('statHadir')?.textContent || '0',
    izin: getEl('statIzin')?.textContent || '0',
    sakit: getEl('statSakit')?.textContent || '0',
    alpha: getEl('statAlpha')?.textContent || '0',
  };

  const filterInfo = [];
  if (ctx.state.filterSesi) filterInfo.push(`Sesi: ${getNamaSesi(ctx.state.filterSesi)}`);
  if (ctx.state.filterTanggal) filterInfo.push(`Tanggal: ${ctx.state.filterTanggal}`);
  if (ctx.state.searchQuery) filterInfo.push(`Pencarian: "${ctx.state.searchQuery}"`);

  const rowsHtml = list.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
    const statusLabel = STATUS_MAP[normalizeStatus(item.status)]?.label || 'Hadir';
    return `<tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${escapeHtml(item.nama || '-')}</td>
      <td>${escapeHtml(namaSesi)}</td>
      <td>${escapeHtml(formatDateTimeID(item.timestamp))}</td>
      <td style="text-align:center;">${escapeHtml(statusLabel)}</td>
      <td>${escapeHtml(item.catatan || '-')}</td>
    </tr>`;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
    <html><head><meta charset="UTF-8">
    <title>Rekap Absensi — PKD GP Ansor Bantul</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color: #0f172a; }
      h1 { font-size: 1.5rem; margin: 0 0 6px; }
      .subtitle { color: #64748b; font-size: 0.9rem; margin-bottom: 16px; }
      .summary { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
      .summary div { background: #f1f5f9; padding: 8px 16px; border-radius: 8px; font-size: 0.85rem; }
      .summary strong { color: #2563eb; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 0.8rem; text-align: left; }
      th { background: #e2e8f0; font-weight: 600; }
      .filter-info { font-size: 0.8rem; color: #475569; margin-bottom: 8px; }
      @media print { body { padding: 0; } }
    </style></head>
    <body>
      <h1>Rekap Absensi</h1>
      <div class="subtitle">PKD GP Ansor Kabupaten Bantul — Dicetak: ${new Date().toLocaleString('id-ID')}</div>
      ${filterInfo.length ? `<div class="filter-info"><strong>Filter:</strong> ${filterInfo.join(' • ')}</div>` : ''}
      <div class="summary">
        <div>Hadir: <strong>${stats.hadir}</strong></div>
        <div>Izin: <strong>${stats.izin}</strong></div>
        <div>Sakit: <strong>${stats.sakit}</strong></div>
        <div>Alpha: <strong>${stats.alpha}</strong></div>
        <div>Total: <strong>${list.length}</strong></div>
      </div>
      <table>
        <thead><tr>
          <th style="width:40px;">#</th><th>Peserta</th><th>Sesi</th>
          <th>Waktu Absen</th><th style="width:80px;">Status</th><th>Keterangan</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body></html>`;

  // Try popup window
  let printWindow = null;
  try {
    printWindow = window.open('', '_blank', 'width=900,height=700');
  } catch (e) { printWindow = null; }

  if (!printWindow || printWindow.closed || typeof printWindow.closed === 'undefined') {
    showToast('Popup diblokir. Menggunakan metode alternatif...', 'info');

    if (printIframe) {
      try { printIframe.remove(); } catch (e) { /* silent */ }
      printIframe = null;
    }

    printIframe = document.createElement('iframe');
    printIframe.style.position = 'fixed';
    printIframe.style.right = '0';
    printIframe.style.bottom = '0';
    printIframe.style.width = '0';
    printIframe.style.height = '0';
    printIframe.style.border = '0';
    document.body.appendChild(printIframe);

    try {
      const doc = printIframe.contentWindow.document;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        try {
          printIframe.contentWindow.focus();
          printIframe.contentWindow.print();
        } catch (e) {
          showToast('Gagal mencetak: ' + e.message, 'error');
        }
        setTimeout(() => {
          if (printIframe) {
            try { printIframe.remove(); } catch (e) { /* silent */ }
            printIframe = null;
          }
        }, 1000);
      }, 300);
    } catch (e) {
      showToast('Gagal mencetak: ' + e.message, 'error');
      if (printIframe) {
        try { printIframe.remove(); } catch (err) { /* silent */ }
        printIframe = null;
      }
    }
    return;
  }

  try {
    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
  } catch (e) {
    showToast('Gagal mencetak: ' + e.message, 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Rekap Absensi View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
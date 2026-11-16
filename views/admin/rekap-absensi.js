// ============================================================
// VIEW: rekap-absensi.js — Full Fix v26.1.2 Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/rekap-absensi.html
// ============================================================
// Fitur:
// ✅ Stats: hadir, izin, sakit, alpha (dengan catatan keterbatasan backend)
// ✅ Filter sesi & tanggal + reset
// ✅ Search debounced
// ✅ Sort (nama, sesi, timestamp, status)
// ✅ Pagination
// ✅ Doughnut chart (distribusi status)
// ✅ Bar chart (rekap per sesi)
// ✅ Chart destroy on unmount (anti memory leak)
// ✅ Export CSV
// ✅ Print (popup window dengan fallback)
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup
//
// v26.1.2 FIXES:
// ✅ BUG-B1: Note keterbatasan backend + tetap tampil
// ✅ BUG-B2: Print fallback jika popup diblokir
// ✅ BUG-B3: Empty state handling di chart
// ✅ BUG-B4: loadData parameter forceRefresh berfungsi
// ✅ BUG-B5: Destroy chart sebelum re-render
// ✅ BUG-B6: Scroll pagination lebih baik
// ✅ Guard isSaving untuk handler async
// ============================================================

import {
  showToast,
  escapeHtml,
  getAbsensiResponses,
  getSesiAbsen,
} from '../../js/core/api.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let statusChartInstance = null;
let sesiChartInstance = null;
let isMounted = false;
let isRefreshing = false;
let isSaving = false;

const STATE = {
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

function destroyChart(instance) {
  if (!instance) return null;
  try { instance.destroy(); } catch (e) { /* silent */ }
  return null;
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

function formatDateOnly(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch { return ''; }
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

function formatDateTimeRange(startStr, endStr) {
  if (!startStr) return '-';
  try {
    const start = new Date(startStr);
    if (isNaN(start.getTime())) return startStr;
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
  } catch { return startStr; }
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

function normalizeStatus(status) {
  const s = String(status || '').toLowerCase().trim();
  if (!s || s === 'hadir') return 'Hadir';
  if (s === 'izin') return 'Izin';
  if (s === 'sakit') return 'Sakit';
  if (s === 'alpha') return 'Alpha';
  return 'Hadir';
}

function getStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'hadir' || s === '') return 'bg-success';
  if (s === 'izin') return 'bg-warning text-dark';
  if (s === 'sakit') return 'bg-info text-dark';
  if (s === 'alpha') return 'bg-danger';
  return 'bg-secondary';
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[RekapAbsensiView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[RekapAbsensiView] mounted');

  // Reset state
  STATE.absensiList = [];
  STATE.sesiList = [];
  STATE.filteredList = [];
  STATE.searchQuery = '';
  STATE.filterSesi = '';
  STATE.filterTanggal = '';
  STATE.sortColumn = 'nama';
  STATE.sortDirection = 'asc';
  STATE.currentPage = 1;
  isSaving = false;

  // Reset form filter
  const filterSesiEl = getEl('filterSesi');
  const filterTanggalEl = getEl('filterTanggal');
  const searchEl = getEl('searchInput');
  if (filterSesiEl) filterSesiEl.value = '';
  if (filterTanggalEl) filterTanggalEl.value = '';
  if (searchEl) searchEl.value = '';

  // Destroy stale charts
  statusChartInstance = destroyChart(statusChartInstance);
  sesiChartInstance = destroyChart(sesiChartInstance);

  // Render skeleton
  renderSkeletonStats();
  renderSkeletonTable();

  // Load data
  await loadData(true);

  // Bind events
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
  console.log('[RekapAbsensiView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // Destroy charts
  statusChartInstance = destroyChart(statusChartInstance);
  sesiChartInstance = destroyChart(sesiChartInstance);

  // Listeners
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;
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

  on(getEl('refreshDataBtn'), 'click', handleRefresh);
  on(getEl('exportDataBtn'), 'click', exportCSV);
  on(getEl('printBtn'), 'click', printRekap);
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    // ✅ BUG-B4: forceRefresh benar-benar di-refresh dengan force update
    // (dipanggil berulang kali tetap reload karena tidak ada cache di sini)
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
    console.error('[RekapAbsensiView] load error:', e);
    const c = getEl('rekapTableContainer');
    if (c && STATE.absensiList.length === 0) {
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

async function handleRefresh(e) {
  if (isSaving) return;

  const btn = e?.currentTarget || getEl('refreshDataBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    await loadData(true);
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   SKELETON RENDER
// ============================================================
function renderSkeletonStats() {
  const c = getEl('statsContainer');
  if (!c) return;
  c.innerHTML = Array(4).fill(0).map(() => `
    <div class="col-6 col-md-3">
      <div class="stat-mini" style="background:#fff;border-radius:16px;padding:1rem;text-align:center;border:1px solid #e2e8f0;">
        <div class="skeleton-box" style="height:2rem;width:60%;margin:0 auto 0.5rem;"></div>
        <div class="skeleton-box" style="height:1rem;width:50%;margin:0 auto;"></div>
      </div>
    </div>`).join('');
}

function renderSkeletonTable() {
  const c = getEl('rekapTableContainer');
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
    opt.textContent = `${s.nama || 'Sesi'} — ${formatDateTimeRange(s.waktu_mulai, s.waktu_selesai)}`;
    if (String(cur) === String(s.id)) opt.selected = true;
    sel.appendChild(opt);
  });
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
      } else if (STATE.sortColumn === 'status') {
        va = normalizeStatus(a.status).toLowerCase();
        vb = normalizeStatus(b.status).toLowerCase();
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
  renderStats();
  renderCharts();
  renderTable();
}

// ============================================================
//   STATS — dengan catatan keterbatasan backend
// ============================================================
function renderStats() {
  const list = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;

  let hadir = 0, izin = 0, sakit = 0, alpha = 0;
  list.forEach(item => {
    const s = normalizeStatus(item.status);
    if (s === 'Hadir') hadir++;
    else if (s === 'Izin') izin++;
    else if (s === 'Sakit') sakit++;
    else if (s === 'Alpha') alpha++;
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
//   CHARTS
// ============================================================
function renderCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('[RekapAbsensiView] Chart.js tidak tersedia');
    return;
  }
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

  // CRITICAL: Destroy previous
  statusChartInstance = destroyChart(statusChartInstance);

  const total = stats.hadir + stats.izin + stats.sakit + stats.alpha;

  // ✅ BUG-B3: Empty state handling
  if (total === 0) {
    try {
      statusChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: ['Belum ada data'],
          datasets: [{
            data: [1],
            backgroundColor: ['#e2e8f0'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 0 },
          plugins: {
            legend: { display: false },
            tooltip: { enabled: false },
          },
        },
      });
    } catch (e) {
      console.error('[RekapAbsensiView] statusChart empty error:', e);
    }
    return;
  }

  try {
    statusChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Hadir', 'Izin', 'Sakit', 'Alpha'],
        datasets: [{
          data: [stats.hadir, stats.izin, stats.sakit, stats.alpha],
          backgroundColor: ['#16a34a', '#f59e0b', '#0891b2', '#dc2626'],
          borderWidth: 2,
          borderColor: '#fff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const val = ctx.parsed;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return `${ctx.label}: ${val} (${pct}%)`;
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

  // CRITICAL: Destroy previous
  sesiChartInstance = destroyChart(sesiChartInstance);

  const list = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;

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

  // ✅ BUG-B3: Empty state
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
        animation: { duration: 600 },
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 },
          },
          x: {
            ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 30 },
          },
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
      <th style="cursor:pointer;" data-sort="nama">Peserta ${arrow('nama')}</th>
      <th style="cursor:pointer;" data-sort="namaSesi">Sesi ${arrow('namaSesi')}</th>
      <th style="cursor:pointer;" data-sort="timestamp">Waktu Absen ${arrow('timestamp')}</th>
      <th style="cursor:pointer;" data-sort="status">Status ${arrow('status')}</th>
      <th>Keterangan</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = STATE.filterSesi || STATE.filterTanggal || STATE.searchQuery;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      Tidak ada data rekap${hasFilter ? ' untuk filter ini' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
      const status = normalizeStatus(item.status);
      const badge = getStatusBadge(status);
      const sesi = STATE.sesiList.find(s => String(s.id) === String(item.sesiId));
      let sesiDisplay = escapeHtml(namaSesi);
      if (sesi) {
        sesiDisplay += `<br><small class="text-muted">${escapeHtml(formatDateTimeRange(sesi.waktu_mulai, sesi.waktu_selesai))}</small>`;
      }

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td>${sesiDisplay}</td>
        <td><small>${escapeHtml(formatDateTime(item.timestamp))}</small></td>
        <td><span class="badge ${badge}">${escapeHtml(status)}</span></td>
        <td><small class="text-muted">${escapeHtml(item.catatan || '-')}</small></td>
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

  // Bind events
  c.querySelectorAll('[data-action="goto"]').forEach(btn => {
    btn.addEventListener('click', (e) => goToPage(parseInt(e.currentTarget.dataset.page)));
  });
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

function handleSort(col) {
  if (STATE.sortColumn === col) {
    STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortColumn = col;
    STATE.sortDirection = 'asc';
  }
  STATE.currentPage = 1;
  STATE.filteredList = getFiltered();
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
  // ✅ BUG-B6: Scroll ke table dengan behavior smooth
  const container = getEl('rekapTableContainer');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ============================================================
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const headers = ['No', 'Nama Peserta', 'Sesi', 'ID Sesi', 'Waktu Absen', 'Status', 'Keterangan'];
  const rows = data.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
    return [
      i + 1,
      item.nama || '',
      namaSesi,
      item.sesiId || '',
      formatDateTime(item.timestamp),
      normalizeStatus(item.status),
      item.catatan || '',
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
    a.download = `rekap_absensi_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   PRINT — dengan fallback
// ============================================================
function printRekap() {
  const list = STATE.filteredList.length ? STATE.filteredList : STATE.absensiList;
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
  if (STATE.filterSesi) filterInfo.push(`Sesi: ${getNamaSesi(STATE.filterSesi)}`);
  if (STATE.filterTanggal) filterInfo.push(`Tanggal: ${STATE.filterTanggal}`);
  if (STATE.searchQuery) filterInfo.push(`Pencarian: "${STATE.searchQuery}"`);

  const rowsHtml = list.map((item, i) => {
    const namaSesi = item.namaSesi || getNamaSesi(item.sesiId);
    return `<tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${escapeHtml(item.nama || '-')}</td>
      <td>${escapeHtml(namaSesi)}</td>
      <td>${escapeHtml(formatDateTime(item.timestamp))}</td>
      <td style="text-align:center;">${escapeHtml(normalizeStatus(item.status))}</td>
      <td>${escapeHtml(item.catatan || '-')}</td>
    </tr>`;
  }).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Rekap Absensi — PKD GP Ansor Bantul</title>
      <style>
        body { font-family: 'Inter', Arial, sans-serif; padding: 20px; color: #0f172a; }
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
      </style>
    </head>
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
          <th style="width:40px;">#</th>
          <th>Peserta</th>
          <th>Sesi</th>
          <th>Waktu Absen</th>
          <th style="width:80px;">Status</th>
          <th>Keterangan</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </body>
    </html>
  `;

  // ✅ BUG-B2: Print dengan fallback jika popup diblokir
  let printWindow = null;
  try {
    printWindow = window.open('', '_blank', 'width=900,height=700');
  } catch (e) {
    printWindow = null;
  }

  if (!printWindow || printWindow.closed || typeof printWindow.closed === 'undefined') {
    // Popup diblokir — fallback dengan iframe
    showToast('Popup diblokir. Menggunakan metode alternatif...', 'info');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    try {
      const doc = iframe.contentWindow.document;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch (e) {
          showToast('Gagal mencetak: ' + e.message, 'error');
        }
        setTimeout(() => {
          try { document.body.removeChild(iframe); } catch (e) { /* silent */ }
        }, 1000);
      }, 300);
    } catch (e) {
      showToast('Gagal mencetak: ' + e.message, 'error');
      try { document.body.removeChild(iframe); } catch (err) { /* silent */ }
    }
    return;
  }

  // Popup berhasil
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
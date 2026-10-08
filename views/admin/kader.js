// ============================================================
// VIEW: kader.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/kader.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 90s
//   ✅ FIX: Clone list sebelum sort (BUG-003)
//   ✅ FIX: Chart destroy + recreate dengan hash guard
//   ✅ FIX: Chart.js lazy load via ensureChartJS
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Search, filter PAC, charts, export, WhatsApp
//   ✅ Zero memory leak
// ============================================================

import {
  showToast,
  escapeHtml,
  downloadCSV,
  downloadJSON,
  getLocalDateOnly,
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
//   LOCAL HELPERS
// ============================================================
function computeChartHash(list) {
  if (!Array.isArray(list) || list.length === 0) return '0';
  return `${list.length}|${list[0]?.id || ''}|${list[list.length - 1]?.id || ''}`;
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

function normalizePhone(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

function destroyChart(instance) {
  if (!instance) return null;
  try { instance.destroy(); } catch (e) { /* silent */ }
  return null;
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    kaderList: [],
    filteredList: [],
    searchQuery: '',
    pacFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    sortColumn: 'nama_lengkap',
    sortDirection: 'asc',
    lastKaderHash: '',
    lastChartHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'peserta', 'kader'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[KaderView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[KaderView] Re-render error:', e);
      }
    },
  }
);

let tableDelegationCleanup = null;
let chartPacInstance = null;
let chartPendidikanInstance = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[KaderView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[KaderView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    kaderList: [],
    filteredList: [],
    searchQuery: '',
    pacFilter: '',
    currentPage: 1,
    sortColumn: 'nama_lengkap',
    sortDirection: 'asc',
    lastKaderHash: '',
    lastChartHash: '',
  });

  const searchEl = getEl('searchKaderInput');
  const filterEl = getEl('filterPacKader');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = getKaderFromModule();
  if (cached.length > 0) {
    console.log('[KaderView] ⚡ Rendering from preload cache');
    ctx.state.kaderList = cached;
    ctx.state.lastKaderHash = computeListHash(cached, ['id', 'nama_lengkap']);
    renderStats();
    renderPacFilter();
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[KaderView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
  }

  bindEvents();

  // Lazy load Chart.js (background)
  ensureChartJS().catch(e => {
    console.warn('[KaderView] Chart.js unavailable:', e.message);
  });

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cached.length === 0) {
    await loadKaderData(false);
  } else {
    // Render charts (async, tidak blocking)
    renderCharts().catch(e => console.warn('[KaderView] Chart error:', e));
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[KaderView] unmounted');

  if (tableDelegationCleanup) {
    try { tableDelegationCleanup(); } catch (e) { /* silent */ }
    tableDelegationCleanup = null;
  }

  // Destroy charts
  chartPacInstance = destroyChart(chartPacInstance);
  chartPendidikanInstance = destroyChart(chartPendidikanInstance);

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = getKaderFromModule();
  const freshHash = computeListHash(fresh, ['id', 'nama_lengkap']);

  if (freshHash === ctx.state.lastKaderHash) {
    console.log('[KaderView] No change, skip re-render');
    return;
  }

  ctx.state.kaderList = fresh;
  ctx.state.lastKaderHash = freshHash;
  renderStats();
  renderPacFilter();

  // Re-render charts (async)
  renderCharts().catch(e => console.warn('[KaderView] Chart error:', e));

  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  ctx.on(getEl('exportKaderBtn'), 'click', handleExport);
  ctx.on(getEl('refreshKaderBtn'), 'click', handleRefresh);

  ctx.on(getEl('searchKaderInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('filterPacKader'), 'change', function (e) {
    ctx.state.pacFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // ✅ DELEGATION — table
  const tableContainer = getEl('kaderTableContainer');
  if (tableContainer) {
    tableDelegationCleanup = delegateTableClicks(tableContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => handleRowAction(action, id),
      onPage: (page) => goToPage(page),
    });
  }
}

// ============================================================
//   GET KADER FROM MODULE
// ============================================================
function getKaderFromModule() {
  const all = AdminModule.getPesertaList() || [];
  return all
    .filter(p => {
      const s = String(p.status || '').toLowerCase().trim();
      return s === 'approved' || s === 'active';
    })
    .map(p => ({ ...p })); // Clone
}

// ============================================================
//   LOAD DATA (fallback)
// ============================================================
async function loadKaderData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[KaderView] load error:', e);
    const c = getEl('kaderTableContainer');
    if (c && ctx.state.kaderList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data kader: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: STATS
// ============================================================
function renderStats() {
  const list = ctx.state.kaderList;
  const total = list.length;

  const pacSet = new Set();
  const pendSet = new Set();
  const kerjaSet = new Set();

  list.forEach(p => {
    const u = (p.utusan || '').trim();
    if (u) pacSet.add(u);
    const pd = (p.pendidikan_terakhir || '').trim();
    if (pd) pendSet.add(pd);
    const k = (p.pekerjaan || '').trim();
    if (k) kerjaSet.add(k);
  });

  const setText = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  setText('statTotalKader', total);
  setText('statTotalPac', pacSet.size);
  setText('statTotalPendidikan', pendSet.size);
  setText('statTotalPekerjaan', kerjaSet.size);
}

// ============================================================
//   RENDER: PAC FILTER
// ============================================================
function renderPacFilter() {
  const select = getEl('filterPacKader');
  if (!select) return;

  const pacSet = new Set();
  ctx.state.kaderList.forEach(p => {
    const u = (p.utusan || '').trim();
    if (u) pacSet.add(u);
  });

  const list = Array.from(pacSet).sort();
  const currentVal = select.value;

  select.innerHTML = '<option value="">Semua PAC</option>';
  list.forEach(pac => {
    const opt = document.createElement('option');
    opt.value = pac;
    opt.textContent = pac;
    if (currentVal === pac) opt.selected = true;
    select.appendChild(opt);
  });
}

// ============================================================
//   RENDER: CHARTS — Hash guard
// ============================================================
async function renderCharts() {
  try {
    await ensureChartJS();
  } catch (e) {
    console.warn('[KaderView] Chart.js tidak tersedia:', e.message);
    return;
  }

  if (typeof Chart === 'undefined') return;

  // Cheap hash — bukan JSON.stringify
  const chartHash = computeChartHash(ctx.state.kaderList);
  if (chartHash === ctx.state.lastChartHash) return;
  ctx.state.lastChartHash = chartHash;

  await Promise.all([
    renderChartPac(),
    renderChartPendidikan(),
  ]);
}

async function renderChartPac() {
  const canvas = getEl('chartPac');
  if (!canvas) return;

  chartPacInstance = destroyChart(chartPacInstance);

  // Group by PAC
  const pacMap = {};
  ctx.state.kaderList.forEach(p => {
    const key = (p.utusan || 'Tidak diketahui').trim() || 'Tidak diketahui';
    pacMap[key] = (pacMap[key] || 0) + 1;
  });

  const entries = Object.entries(pacMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);

  if (labels.length === 0) {
    labels.push('Belum ada data');
    data.push(0);
  }

  try {
    chartPacInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Jumlah Kader',
          data,
          backgroundColor: 'rgba(37, 99, 235, 0.7)',
          borderColor: '#2563eb',
          borderWidth: 1.5,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
          x: {
            ticks: {
              font: { size: 10 },
              maxRotation: 60,
              minRotation: 30,
              autoSkip: false,
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('[KaderView] ChartPac error:', e);
  }
}

async function renderChartPendidikan() {
  const canvas = getEl('chartPendidikan');
  if (!canvas) return;

  chartPendidikanInstance = destroyChart(chartPendidikanInstance);

  const pendMap = {};
  ctx.state.kaderList.forEach(p => {
    const key = (p.pendidikan_terakhir || 'Tidak diketahui').trim() || 'Tidak diketahui';
    pendMap[key] = (pendMap[key] || 0) + 1;
  });

  const entries = Object.entries(pendMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);

  if (labels.length === 0) {
    labels.push('Belum ada data');
    data.push(0);
  }

  // Deterministic HSL palette
  const colors = labels.map((label, i) => {
    const hue = (i * 360) / Math.max(labels.length, 1);
    return `hsl(${hue}, 70%, 55%)`;
  });

  try {
    chartPendidikanInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 11 }, boxWidth: 12, padding: 8 },
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const val = context.parsed;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                return `${context.label}: ${val} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  } catch (e) {
    console.error('[KaderView] ChartPendidikan error:', e);
  }
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredKader(query, pac) {
  let filtered = ctx.state.kaderList.slice();

  if (query && query.trim() !== '') {
    const q = query.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama_lengkap || '').toLowerCase().includes(q) ||
      (item.utusan || '').toLowerCase().includes(q) ||
      (item.pendidikan_terakhir || '').toLowerCase().includes(q) ||
      (item.pekerjaan || '').toLowerCase().includes(q) ||
      (item.no_hp || '').toLowerCase().includes(q)
    );
  }

  if (pac && pac !== '') {
    filtered = filtered.filter(item => (item.utusan || '').trim() === pac.trim());
  }

  return filtered;
}

function applyFiltersAndSort() {
  let filtered = getFilteredKader(ctx.state.searchQuery, ctx.state.pacFilter);

  if (ctx.state.sortColumn) {
    filtered.sort((a, b) => {
      const va = String(a[ctx.state.sortColumn] || '').toLowerCase();
      const vb = String(b[ctx.state.sortColumn] || '').toLowerCase();

      if (va < vb) return ctx.state.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return ctx.state.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  ctx.state.filteredList = filtered;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;
  renderTable();
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonTable() {
  const c = getEl('kaderTableContainer');
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
//   RENDER TABLE
// ============================================================
function renderTable() {
  const c = getEl('kaderTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchKaderInput');

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
      <th class="sortable" data-sort="nama_lengkap" role="button" tabindex="0">Nama ${arrow('nama_lengkap')}</th>
      <th class="sortable" data-sort="utusan" role="button" tabindex="0">PAC ${arrow('utusan')}</th>
      <th class="sortable" data-sort="pendidikan_terakhir" role="button" tabindex="0">Pendidikan ${arrow('pendidikan_terakhir')}</th>
      <th class="sortable" data-sort="pekerjaan" role="button" tabindex="0">Pekerjaan ${arrow('pekerjaan')}</th>
      <th>No HP</th>
      <th>Lokasi PKD</th>
      <th style="width:150px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    html += `<tr><td colspan="8" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data kader.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const safeId = escapeHtml(String(item.id));

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama_lengkap || '-')}</strong></td>
        <td><span class="badge bg-primary">${escapeHtml(item.utusan || '-')}</span></td>
        <td>${escapeHtml(item.pendidikan_terakhir || '-')}</td>
        <td>${escapeHtml(item.pekerjaan || '-')}</td>
        <td>${escapeHtml(item.no_hp || '-')}</td>
        <td><span class="badge bg-info text-dark">${escapeHtml(item.lokasi_pkd || '-')}</span></td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="view" data-id="${safeId}" title="Lihat Detail" aria-label="Lihat detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-success me-1" data-action="whatsapp" data-id="${safeId}" title="Chat WhatsApp" aria-label="WhatsApp">
            <i class="bi bi-whatsapp" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-action="download" data-id="${safeId}" title="Unduh Data" aria-label="Unduh">
            <i class="bi bi-download" aria-hidden="true"></i>
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
    if (startPage > 2) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>...</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button type="button" class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}" data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>...</button>`;
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  restoreFocusState('searchKaderInput', savedFocus);
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
  getEl('kaderTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   ROW ACTION
// ============================================================
function handleRowAction(action, id) {
  switch (action) {
    case 'view':     return viewKader(id);
    case 'whatsapp': return openWhatsApp(id);
    case 'download': return downloadSingle(id);
    default: console.warn('[KaderView] Unknown action:', action);
  }
}

function viewKader(id) {
  const item = ctx.state.kaderList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const html = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama:</strong> ${escapeHtml(item.nama_lengkap || '-')}</div>
      <div class="list-group-item py-3"><strong>Email:</strong> ${escapeHtml(item.email || '-')}</div>
      <div class="list-group-item py-3"><strong>No HP:</strong> ${escapeHtml(item.no_hp || '-')}</div>
      <div class="list-group-item py-3"><strong>Tempat/Tgl Lahir:</strong> ${escapeHtml(item.tempat_tgl_lahir || '-')}</div>
      <div class="list-group-item py-3"><strong>Pekerjaan:</strong> ${escapeHtml(item.pekerjaan || '-')}</div>
      <div class="list-group-item py-3"><strong>Pendidikan:</strong> ${escapeHtml(item.pendidikan_terakhir || '-')}</div>
      <div class="list-group-item py-3"><strong>Alamat:</strong> ${escapeHtml(item.alamat || '-')}</div>
      <div class="list-group-item py-3"><strong>Utusan (PAC):</strong> ${escapeHtml(item.utusan || '-')}</div>
      <div class="list-group-item py-3"><strong>Pengalaman Organisasi:</strong> ${escapeHtml(item.pengalaman_organisasi || '-')}</div>
      <div class="list-group-item py-3"><strong>Lokasi PKD:</strong> ${escapeHtml(item.lokasi_pkd || '-')}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> <span class="badge bg-success">${escapeHtml(item.status || '-')}</span></div>
    </div>`;

  const content = getEl('detailKaderContent');
  if (content) content.innerHTML = html;
  ctx.getModal('detailKaderModal')?.show();
}

function openWhatsApp(id) {
  const item = ctx.state.kaderList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const phone = normalizePhone(item.no_hp);
  if (!phone) { showToast('No HP tidak tersedia', 'warning'); return; }

  const nama = item.nama_lengkap || '';
  const message = encodeURIComponent(`Assalamu'alaikum ${nama}, ada informasi terkait PKD GP Ansor Bantul.`);

  try {
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
  } catch (e) {
    showToast('Gagal membuka WhatsApp', 'error');
  }
}

function downloadSingle(id) {
  const item = ctx.state.kaderList.find(p => String(p.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const exportData = {
    id: item.id,
    nama: item.nama_lengkap,
    email: item.email,
    hp: item.no_hp,
    utusan: item.utusan,
    pendidikan: item.pendidikan_terakhir,
    pekerjaan: item.pekerjaan,
    alamat: item.alamat,
    lokasi_pkd: item.lokasi_pkd,
    status: item.status,
  };

  const safeName = (item.nama_lengkap || 'data').replace(/\s+/g, '_');
  const fileName = `kader_${safeName}_${getLocalDateOnly(new Date())}.json`;

  if (downloadJSON(exportData, fileName)) {
    showToast('Data kader diunduh', 'success');
  } else {
    showToast('Gagal unduh: ' + (item.nama_lengkap || ''), 'error');
  }
}

// ============================================================
//   EXPORT CSV
// ============================================================
function handleExport() {
  const data = ctx.state.filteredList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const headers = ['No', 'Nama', 'Email', 'No HP', 'PAC', 'Pendidikan', 'Pekerjaan', 'Alamat', 'Lokasi PKD', 'Status'];
  const rows = data.map((item, i) => [
    i + 1,
    item.nama_lengkap || '',
    item.email || '',
    item.no_hp || '',
    item.utusan || '',
    item.pendidikan_terakhir || '',
    item.pekerjaan || '',
    item.alamat || '',
    item.lokasi_pkd || '',
    item.status || '',
  ]);

  const fileName = `kader_${getLocalDateOnly(new Date())}.csv`;
  if (downloadCSV(rows, headers, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} data kader`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('refreshKaderBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    // Force chart refresh
    ctx.state.lastChartHash = '';
    await AdminModule.loadAllData(true);
    refreshFromCache();
    showToast('Data kader disegarkan', 'success');
  } catch (e) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Kader View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
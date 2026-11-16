// ============================================================
// VIEW: kader.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/kader.html
// ============================================================
// Fitur:
// ✅ Statistik (4 cards): total kader, jumlah PAC, jenjang pendidikan, jenis pekerjaan
// ✅ Bar chart sebaran kader per PAC (Chart.js)
// ✅ Doughnut chart sebaran pendidikan (Chart.js)
// ✅ Filter PAC dropdown (auto-populate)
// ✅ Search (nama, PAC, pendidikan, pekerjaan, HP)
// ✅ Sort (nama, PAC, pendidikan, pekerjaan, lokasi PKD)
// ✅ Pagination (15 item/page)
// ✅ Detail modal
// ✅ WhatsApp chat (normalize nomor +62)
// ✅ Download single kader (JSON)
// ✅ Export CSV (semua filtered)
// ✅ Auto-refresh 30 detik (visibility-aware)
// ✅ Chart.js memory leak fix (destroy on unmount)
// ✅ Zero memory leak + full cleanup
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import { showToast, escapeHtml } from '../../js/core/api.js';

// ============================================================
//   MODULE-LEVEL STATE
// ============================================================
let refreshInterval = null;
let searchDebounceTimer = null;
let chartPacInstance = null;
let chartPendidikanInstance = null;
let isMounted = false;

const STATE = {
  kaderList: [],        // Peserta dengan status approved/active
  filteredList: [],
  searchQuery: '',
  pacFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: 'nama_lengkap',
  sortDirection: 'asc',
  modals: {},
};

// ============================================================
//   LISTENER REGISTRY
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

function destroyChart(instance) {
  if (!instance) return null;
  try { instance.destroy(); } catch (e) { /* silent */ }
  return null;
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[KaderView] Sudah mounted, skip double-mount');
    return unmount;
  }
  isMounted = true;
  console.log('[KaderView] mounted');

  // Initial skeleton
  renderSkeletonTable();

  // Bind events
  bindTopLevelEvents();

  // Load data
  await loadKaderData(false);

  // Auto refresh 30 detik
  refreshInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    AdminModule.loadAllData(false)
      .then(() => {
        const fresh = getKaderFromModule();
        if (JSON.stringify(STATE.kaderList) !== JSON.stringify(fresh)) {
          STATE.kaderList = fresh;
          renderStats();
          renderCharts();
          renderPacFilter();
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
  console.log('[KaderView] unmounted');

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

  // Charts (CRITICAL — prevent memory leak)
  chartPacInstance = destroyChart(chartPacInstance);
  chartPendidikanInstance = destroyChart(chartPendidikanInstance);

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
//   BIND EVENTS
// ============================================================
function bindTopLevelEvents() {
  on(getEl('exportKaderBtn'), 'click', handleExport);
  on(getEl('refreshKaderBtn'), 'click', handleRefresh);
  on(getEl('searchKaderInput'), 'input', handleSearchInput);
  on(getEl('filterPacKader'), 'change', handlePacFilterChange);
}

// ============================================================
//   GET KADER FROM MODULE
//   Kader = peserta dengan status approved atau active
// ============================================================
function getKaderFromModule() {
  const allPeserta = AdminModule.getPesertaList() || [];
  return allPeserta.filter(p => {
    const s = String(p.status || '').toLowerCase().trim();
    return s === 'approved' || s === 'active';
  });
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadKaderData(forceRefresh = false) {
  updateCacheStatus('Memuat...');

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }

    STATE.kaderList = getKaderFromModule();

    renderStats();
    renderPacFilter();
    renderCharts();
    applyFiltersAndSort();
    updateCacheStatus('Live');
  } catch (e) {
    console.error('[KaderView] load error:', e);
    const c = getEl('kaderTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-danger">Gagal memuat data kader: ${escapeHtml(e.message)}</div>`;
    }
    updateCacheStatus('Error');
  }
}

// ============================================================
//   RENDER: Stats
// ============================================================
function renderStats() {
  const list = STATE.kaderList;
  const total = list.length;

  // Jumlah PAC unik
  const pacSet = new Set();
  list.forEach(p => {
    const u = (p.utusan || '').trim();
    if (u) pacSet.add(u);
  });

  // Jumlah jenjang pendidikan unik
  const pendSet = new Set();
  list.forEach(p => {
    const pd = (p.pendidikan_terakhir || '').trim();
    if (pd) pendSet.add(pd);
  });

  // Jumlah jenis pekerjaan unik
  const kerjaSet = new Set();
  list.forEach(p => {
    const k = (p.pekerjaan || '').trim();
    if (k) kerjaSet.add(k);
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotalKader', total);
  setText('statTotalPac', pacSet.size);
  setText('statTotalPendidikan', pendSet.size);
  setText('statTotalPekerjaan', kerjaSet.size);
}

// ============================================================
//   RENDER: PAC Filter Dropdown
// ============================================================
function renderPacFilter() {
  const select = getEl('filterPacKader');
  if (!select) return;

  const pacSet = new Set();
  STATE.kaderList.forEach(p => {
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
//   RENDER: Charts (Bar + Doughnut)
// ============================================================
function renderCharts() {
  if (typeof Chart === 'undefined') {
    console.warn('[KaderView] Chart.js tidak tersedia');
    return;
  }

  renderChartPac();
  renderChartPendidikan();
}

function renderChartPac() {
  const canvas = getEl('chartPac');
  if (!canvas) return;

  // CRITICAL: Destroy instance sebelumnya
  chartPacInstance = destroyChart(chartPacInstance);

  // Group by PAC
  const pacMap = {};
  STATE.kaderList.forEach(p => {
    const key = (p.utusan || 'Tidak diketahui').trim() || 'Tidak diketahui';
    pacMap[key] = (pacMap[key] || 0) + 1;
  });

  // Sort by count desc
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
        labels: labels,
        datasets: [{
          label: 'Jumlah Kader',
          data: data,
          backgroundColor: 'rgba(37, 99, 235, 0.7)',
          borderColor: '#2563eb',
          borderWidth: 1.5,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 },
          },
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
    console.error('[KaderView] ChartPac render error:', e);
  }
}

function renderChartPendidikan() {
  const canvas = getEl('chartPendidikan');
  if (!canvas) return;

  // CRITICAL: Destroy instance sebelumnya
  chartPendidikanInstance = destroyChart(chartPendidikanInstance);

  // Group by pendidikan
  const pendMap = {};
  STATE.kaderList.forEach(p => {
    const key = (p.pendidikan_terakhir || 'Tidak diketahui').trim() || 'Tidak diketahui';
    pendMap[key] = (pendMap[key] || 0) + 1;
  });

  // Sort by count desc
  const entries = Object.entries(pendMap).sort((a, b) => b[1] - a[1]);
  const labels = entries.map(e => e[0]);
  const data = entries.map(e => e[1]);

  if (labels.length === 0) {
    labels.push('Belum ada data');
    data.push(0);
  }

  // Dynamic HSL palette
  const colors = labels.map((_, i) => {
    const hue = (i * 360) / Math.max(labels.length, 1);
    return `hsl(${hue}, 70%, 55%)`;
  });

  try {
    chartPendidikanInstance = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: colors,
          borderColor: '#ffffff',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              font: { size: 11 },
              boxWidth: 12,
              padding: 8,
            },
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
    console.error('[KaderView] ChartPendidikan render error:', e);
  }
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredKader(query, pac) {
  let filtered = STATE.kaderList;

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
  let filtered = getFilteredKader(STATE.searchQuery, STATE.pacFilter);

  // Sort
  if (STATE.sortColumn) {
    filtered.sort((a, b) => {
      const va = String(a[STATE.sortColumn] || '').toLowerCase();
      const vb = String(b[STATE.sortColumn] || '').toLowerCase();

      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;

      // Tie-breaker by id
      return String(a.id || '').localeCompare(String(b.id || ''));
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
//   RENDER: Table
// ============================================================
function renderTable(data, totalItems) {
  const c = getEl('kaderTableContainer');
  if (!c) return;

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th class="sortable ${STATE.sortColumn === 'nama_lengkap' ? STATE.sortDirection : ''}" data-sort="nama_lengkap" role="button" tabindex="0">Nama</th>
      <th class="sortable ${STATE.sortColumn === 'utusan' ? STATE.sortDirection : ''}" data-sort="utusan" role="button" tabindex="0">PAC</th>
      <th class="sortable ${STATE.sortColumn === 'pendidikan_terakhir' ? STATE.sortDirection : ''}" data-sort="pendidikan_terakhir" role="button" tabindex="0">Pendidikan</th>
      <th class="sortable ${STATE.sortColumn === 'pekerjaan' ? STATE.sortDirection : ''}" data-sort="pekerjaan" role="button" tabindex="0">Pekerjaan</th>
      <th>No HP</th>
      <th class="sortable ${STATE.sortColumn === 'lokasi_pkd' ? STATE.sortDirection : ''}" data-sort="lokasi_pkd" role="button" tabindex="0">Lokasi PKD</th>
      <th style="width:150px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (data.length === 0) {
    html += `<tr><td colspan="8" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data kader.
    </td></tr>`;
  } else {
    data.forEach((item, i) => {
      const globalIdx = (STATE.currentPage - 1) * STATE.itemsPerPage + i + 1;
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
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="view" data-id="${safeId}" title="Lihat Detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-success me-1" data-action="whatsapp" data-id="${safeId}" title="Chat WhatsApp">
            <i class="bi bi-whatsapp" aria-hidden="true"></i>
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
  const c = getEl('kaderTableContainer');
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
    case 'view':     return viewKader(id);
    case 'whatsapp': return openWhatsApp(id);
    case 'download': return downloadSingle(id);
    default: console.warn('[KaderView] Unknown action:', action);
  }
}

// ============================================================
//   VIEW DETAIL
// ============================================================
function viewKader(id) {
  const item = STATE.kaderList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
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
      <div class="list-group-item py-3"><strong>Utusan (PAC):</strong> ${escapeHtml(item.utusan || '-')}</div>
      <div class="list-group-item py-3"><strong>Pengalaman Organisasi:</strong> ${escapeHtml(item.pengalaman_organisasi || '-')}</div>
      <div class="list-group-item py-3"><strong>Lokasi PKD:</strong> ${escapeHtml(item.lokasi_pkd || '-')}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> <span class="badge bg-success">${escapeHtml(item.status || '-')}</span></div>
    </div>
  `;

  const content = getEl('detailKaderContent');
  if (content) content.innerHTML = html;

  getModal('detailKaderModal')?.show();
}

// ============================================================
//   OPEN WHATSAPP
// ============================================================
function openWhatsApp(id) {
  const item = STATE.kaderList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const hp = String(item.no_hp || '').replace(/[^0-9]/g, '');
  if (!hp) {
    showToast('No HP tidak tersedia', 'warning');
    return;
  }

  // Normalize nomor Indonesia
  let phone = hp;
  if (phone.startsWith('0')) phone = '62' + phone.slice(1);
  else if (phone.startsWith('8')) phone = '62' + phone;

  const nama = item.nama_lengkap || '';
  const message = encodeURIComponent(`Assalamu'alaikum ${nama}, ada informasi terkait PKD GP Ansor Bantul.`);

  try {
    window.open(`https://wa.me/${phone}?text=${message}`, '_blank', 'noopener,noreferrer');
  } catch (e) {
    showToast('Gagal membuka WhatsApp', 'error');
  }
}

// ============================================================
//   DOWNLOAD SINGLE
// ============================================================
function downloadSingle(id) {
  const item = STATE.kaderList.find(p => String(p.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

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

  try {
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kader_${(item.nama_lengkap || 'data').replace(/\s+/g, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Data kader diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh: ' + e.message, 'error');
  }
}

// ============================================================
//   EXPORT CSV (semua filtered)
// ============================================================
function handleExport() {
  const data = STATE.filteredList;
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

  // CSV dengan BOM UTF-8 (untuk Excel)
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  try {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kader_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data kader`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh() {
  const btn = getEl('refreshKaderBtn');
  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Memuat...';
  }

  try {
    await loadKaderData(true);
    showToast('Data kader disegarkan', 'success');
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

function handlePacFilterChange(e) {
  STATE.pacFilter = e.target.value;
  STATE.currentPage = 1;
  applyFiltersAndSort();
}

// ============================================================
//   UTILITY
// ============================================================
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
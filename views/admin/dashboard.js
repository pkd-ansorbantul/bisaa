// ============================================================
// VIEW: dashboard.js — Full Fix Production Ready (Latest)
// Dimuat oleh: js/router.js
// HTML: views/admin/dashboard.html
// ============================================================
// Fitur:
// ✅ Stat cards (6): peserta, sesi, materi, skrining, pretest, posttest
// ✅ Trend indicator (naik/turun vs 7 hari sebelumnya)
// ✅ Chart tren aktivitas 7 hari (Chart.js line) + destroy on unmount
// ✅ Quick actions (4 tombol)
// ✅ Activity feed (6 aktivitas terbaru)
// ✅ Todo list dinamis
// ✅ Global search (peserta/materi/sesi)
// ✅ Auto-refresh 30 detik (visibility-aware + re-entrance guard)
// ✅ Scan QR modal (html5-qrcode) — fullscreen, mode otomatis/manual
// ✅ Signature modal (Signature Pad) — admin absen on behalf
// ✅ Floating scan button
// ✅ Robust mount/unmount lifecycle
// ✅ Zero memory leak (listener registry + chart destroy + scanner stop)
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import {
  callApi,
  showToast,
  escapeHtml,
} from '../../js/core/api.js';

// ============================================================
//   MODULE-LEVEL STATE
// ============================================================
let refreshInterval = null;
let activityChartInstance = null;
let scanQrInstance = null;
let isScannerRunning = false;
let currentScanMode = 'otomatis';
let pendingScanData = { pesertaId: null, nama: null };
let searchDebounceTimer = null;
let signatureModalInstance = null;
let resultModalInstance = null;
let scanModalInstance = null;
let dynamicSignatureModalEl = null;

// Guard: cegah double-mount
let isMounted = false;

// Guard: cegah auto-refresh spam
let isRefreshing = false;

// Listener registry untuk cleanup
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

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[DashboardView] Sudah mounted, skip double-mount');
    return unmount;
  }
  isMounted = true;
  console.log('[DashboardView] mounted');

  // Guard elemen utama
  const dashboardContent = getEl('dashboardContent');
  if (!dashboardContent) {
    console.warn('[DashboardView] #dashboardContent tidak ditemukan');
    isMounted = false;
    return;
  }

  // ===== Bind top-level events =====
  on(getEl('refreshDataBtn'), 'click', handleManualRefresh);
  on(getEl('globalSearchInput'), 'input', handleGlobalSearch);
  on(getEl('scanFloatBtn'), 'click', openScanner);
  on(document, 'click', handleClickOutsideSearch);

  // ===== Init scan mode =====
  initScanModeSafe();

  // ===== Initial data load =====
  await loadData(false);

  // ===== Auto-refresh 30 detik =====
  refreshInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return; // ← guard re-entrance

    isRefreshing = true;
    loadData(false)
      .catch(() => {})
      .finally(() => { isRefreshing = false; });
  }, 30000);

  return unmount;
}

// ============================================================
//   UNMOUNT — cleanup semua resource
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[DashboardView] unmounted');

  // 1. Clear interval
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }

  // 2. Destroy chart
  if (activityChartInstance) {
    try { activityChartInstance.destroy(); } catch (e) { /* silent */ }
    activityChartInstance = null;
  }

  // 3. Stop scanner
  if (isScannerRunning) {
    stopScanner();
  }
  scanQrInstance = null;

  // 4. Clear debounce
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // 5. Remove listeners
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  // 6. Dispose bootstrap modals
  try { signatureModalInstance?.dispose?.(); } catch (e) {}
  try { resultModalInstance?.dispose?.(); } catch (e) {}
  try { scanModalInstance?.dispose?.(); } catch (e) {}
  signatureModalInstance = null;
  resultModalInstance = null;
  scanModalInstance = null;

  // 7. Remove dynamic signature modal
  if (dynamicSignatureModalEl) {
    try { dynamicSignatureModalEl.remove(); } catch (e) {}
    dynamicSignatureModalEl = null;
  }

  // 8. Hide float button
  getEl('scanFloatBtn')?.classList.remove('show');

  // 9. Cleanup Bootstrap artifacts
  try {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } catch (e) { /* silent */ }
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  const container = getEl('dashboardContent');
  if (!container) return;

  updateCacheStatus('Memuat...');

  try {
    // Render dari cache dulu (fast paint)
    if (!forceRefresh && AdminModule.getState().lastSync) {
      try { renderDashboard(); } catch (e) { console.warn('Render cache error:', e); }
      updateCacheStatus('Cache');
    }

    // Fetch fresh
    await AdminModule.loadAllData(forceRefresh);

    // Re-render
    renderDashboard();
    updateCacheStatus('Live');
  } catch (e) {
    console.error('[DashboardView] load error:', e);
    updateCacheStatus('Offline');

    if (forceRefresh) {
      showToast('Gagal menyegarkan data dari server', 'error');
    }

    // Fallback UI kalau belum ada data
    if (!AdminModule.getState().lastSync) {
      container.innerHTML = `
        <div class="alert alert-danger text-center">
          <i class="bi bi-exclamation-triangle-fill fs-1 d-block mb-3" aria-hidden="true"></i>
          <h5>Gagal Memuat Data</h5>
          <p class="small mb-3">${escapeHtml(e.message || 'Terjadi kesalahan')}</p>
          <button class="btn btn-outline-danger" data-dash-action="reload">
            <i class="bi bi-arrow-clockwise me-1"></i>Muat Ulang
          </button>
        </div>
      `;
      container.querySelector('[data-dash-action="reload"]')
        ?.addEventListener('click', () => location.reload());
    }
  }
}

// ============================================================
//   MANUAL REFRESH
// ============================================================
async function handleManualRefresh(e) {
  const btn = e.currentTarget;
  const originalHtml = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Memuat...';

  try {
    await loadData(true);
    showToast('Data berhasil disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan data', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// ============================================================
//   RENDER DASHBOARD
// ============================================================
function renderDashboard() {
  const container = getEl('dashboardContent');
  if (!container) return;

  // ===== Data =====
  const stats = AdminModule.getStats() || {};
  const allPeserta   = AdminModule.getPesertaList()  || [];
  const sesiList     = AdminModule.getSesiList()     || [];
  const materiList   = AdminModule.getMateriList()   || [];
  const skriningList = AdminModule.getSkriningList() || [];
  const pretestList  = AdminModule.getPretestList()  || [];
  const posttestList = AdminModule.getPosttestList() || [];
  const alumniList   = AdminModule.getAlumniList()   || [];

  // ===== Counts =====
  const pendingCount = allPeserta.filter(p =>
    String(p.status || '').toLowerCase() === 'pending'
  ).length;

  const approvedCount = allPeserta.filter(p => {
    const s = String(p.status || '').toLowerCase();
    return s === 'approved' || s === 'active';
  }).length;

  const totalAlumni = alumniList.length;

  const closedSessions = sesiList.filter(s => {
    const v = s.submission_open;
    return v === false || String(v).toLowerCase() === 'false';
  });

  const noMateri = materiList.length === 0;

  // ===== Render =====
  container.innerHTML = `
    <!-- ============ STAT CARDS (6) ============ -->
    <div class="row g-2 g-sm-3 fade-in">
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(allPeserta, 'timestamp'))}
          <div class="stat-number">${stats.totalPeserta ?? 0}</div>
          <div class="stat-label">Total Peserta</div>
          <i class="bi bi-people-fill text-primary" aria-hidden="true"></i>
        </div>
      </div>
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(sesiList, 'waktu_mulai'))}
          <div class="stat-number">${stats.totalSesi ?? 0}</div>
          <div class="stat-label">Sesi Absen</div>
          <i class="bi bi-calendar-event text-primary" aria-hidden="true"></i>
        </div>
      </div>
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(materiList, 'timestamp'))}
          <div class="stat-number">${stats.totalMateri ?? 0}</div>
          <div class="stat-label">Materi</div>
          <i class="bi bi-file-earmark-pdf text-primary" aria-hidden="true"></i>
        </div>
      </div>
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(skriningList, 'timestamp'))}
          <div class="stat-number">${stats.totalSkrining ?? 0}</div>
          <div class="stat-label">Skrining Terisi</div>
          <i class="bi bi-clipboard-check text-primary" aria-hidden="true"></i>
        </div>
      </div>
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(pretestList, 'timestamp'))}
          <div class="stat-number">${stats.totalPretest ?? 0}</div>
          <div class="stat-label">Pretest Terisi</div>
          <i class="bi bi-pencil-square text-primary" aria-hidden="true"></i>
        </div>
      </div>
      <div class="col-6 col-md-4">
        <div class="stat-card">
          ${formatTrend(calculateTrend(posttestList, 'timestamp'))}
          <div class="stat-number">${stats.totalPosttest ?? 0}</div>
          <div class="stat-label">Posttest Terisi</div>
          <i class="bi bi-trophy text-primary" aria-hidden="true"></i>
        </div>
      </div>
    </div>

    <!-- ============ CHART + QUICK ACTIONS ============ -->
    <div class="row g-2 mt-4">
      <div class="col-md-8">
        <div class="stat-card" style="text-align:left;padding:1.2rem;">
          <div class="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <h6 class="fw-bold mb-0">
              <i class="bi bi-graph-up-arrow me-2" aria-hidden="true"></i>Tren Aktivitas 7 Hari Terakhir
            </h6>
            <span class="small text-muted">Skrining, Pretest & Posttest</span>
          </div>
          <div class="chart-container" style="position:relative;height:220px;">
            <canvas id="activityChart" aria-label="Chart tren aktivitas 7 hari"></canvas>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card" style="text-align:left;padding:1.2rem;">
          <h6 class="fw-bold mb-3">
            <i class="bi bi-lightning-charge-fill me-2" aria-hidden="true"></i>Aksi Cepat
          </h6>
          <div class="quick-action-grid">
            <a href="#/admin/peserta" class="quick-btn" title="Setujui Peserta">
              <i class="bi bi-person-check-fill" aria-hidden="true"></i>
              <span>Setujui Peserta</span>
              ${pendingCount > 0 ? `<small class="text-warning fw-bold">${pendingCount} Pending</small>` : ''}
            </a>
            <a href="#/admin/sesi-absen" class="quick-btn" title="Kelola Sesi">
              <i class="bi bi-calendar-check-fill" aria-hidden="true"></i>
              <span>Kelola Sesi</span>
            </a>
            <a href="#/admin/materi" class="quick-btn" title="Upload Materi">
              <i class="bi bi-file-earmark-plus-fill" aria-hidden="true"></i>
              <span>Upload Materi</span>
            </a>
            <a href="#/admin/informasi" class="quick-btn" title="Buat Pengumuman">
              <i class="bi bi-megaphone-fill" aria-hidden="true"></i>
              <span>Buat Pengumuman</span>
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ FEED + TODO ============ -->
    <div class="row g-2 mt-4">
      <div class="col-md-6">
        <div class="stat-card" style="text-align:left;padding:1rem;">
          <h6 class="fw-bold mb-3">
            <i class="bi bi-clock-history me-2" aria-hidden="true"></i>Aktivitas Terbaru
          </h6>
          <ul class="feed-list" id="activityFeed">
            <li class="text-center text-muted small py-3">Memuat aktivitas...</li>
          </ul>
        </div>
      </div>
      <div class="col-md-6">
        <div class="stat-card" style="text-align:left;padding:1rem;">
          <h6 class="fw-bold mb-3">
            <i class="bi bi-list-check me-2" aria-hidden="true"></i>Todo List
          </h6>
          <ul class="todo-list" id="todoListContainer">
            <li class="text-center text-muted small py-3">Memuat tugas...</li>
          </ul>
        </div>
      </div>
    </div>

    <!-- ============ INFO ALERT ============ -->
    <div class="row mt-4">
      <div class="col-12">
        <div class="alert alert-info rounded-4 small mb-0">
          <i class="bi bi-info-circle" aria-hidden="true"></i>
          Data dari cloud, diperbarui otomatis.
          ${stats.lastSync ? `<br><small>Terakhir sinkronisasi: ${new Date(stats.lastSync).toLocaleString('id-ID')}</small>` : ''}
          <br>
          <small>
            <i class="bi bi-check-circle-fill text-success me-1" aria-hidden="true"></i>${approvedCount} Disetujui
            &middot; ${pendingCount} Pending
            &middot; <i class="bi bi-trophy text-warning me-1" aria-hidden="true"></i>${totalAlumni} Alumni
          </small>
        </div>
      </div>
    </div>
  `;

  // Render sub-components after layout ready
  requestAnimationFrame(() => {
    try {
      renderActivityChart(pretestList, posttestList, skriningList);
      renderActivityFeed(pretestList, posttestList, skriningList, allPeserta);
      renderTodoList(allPeserta, sesiList, closedSessions, noMateri);
    } catch (e) {
      console.error('[DashboardView] render sub-component error:', e);
    }
  });

  // Show scan float button
  getEl('scanFloatBtn')?.classList.add('show');
}

// ============================================================
//   TREND HELPER
// ============================================================
function calculateTrend(dataList, dateField) {
  const now = new Date();
  const sevenDaysAgo = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date(now); fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  let currentWeekCount = 0;
  let previousWeekCount = 0;

  (dataList || []).forEach(item => {
    const tsStr = item[dateField] || item.timestamp || item.createdAt;
    if (!tsStr) return;
    const ts = new Date(tsStr);
    if (isNaN(ts.getTime())) return;

    if (ts >= sevenDaysAgo && ts <= now) currentWeekCount++;
    else if (ts >= fourteenDaysAgo && ts < sevenDaysAgo) previousWeekCount++;
  });

  if (previousWeekCount === 0 && currentWeekCount === 0) {
    return { trend: 0, direction: 'flat' };
  }
  if (previousWeekCount === 0) {
    return { trend: 100, direction: 'up' };
  }

  const diff = ((currentWeekCount - previousWeekCount) / previousWeekCount) * 100;
  if (Math.abs(diff) < 0.5) return { trend: 0, direction: 'flat' };
  return { trend: Math.round(diff), direction: diff > 0 ? 'up' : 'down' };
}

function formatTrend(trendObj) {
  if (!trendObj || trendObj.direction === 'flat') {
    return `<span class="stat-trend flat"><i class="bi bi-dash" aria-hidden="true"></i> 0%</span>`;
  }
  const icon = trendObj.direction === 'up' ? 'bi-arrow-up' : 'bi-arrow-down';
  const cls = trendObj.direction === 'up' ? '' : 'down';
  return `<span class="stat-trend ${cls}"><i class="bi ${icon}" aria-hidden="true"></i> ${Math.abs(trendObj.trend)}%</span>`;
}

// ============================================================
//   RENDER: Activity Chart
// ============================================================
function renderActivityChart(pretestData, posttestData, skriningData) {
  const canvas = getEl('activityChart');
  if (!canvas) return;

  if (typeof Chart === 'undefined') {
    console.warn('[DashboardView] Chart.js tidak tersedia');
    return;
  }

  // CRITICAL: Destroy instance sebelumnya
  if (activityChartInstance) {
    try { activityChartInstance.destroy(); } catch (e) { /* silent */ }
    activityChartInstance = null;
  }

  const labels = [];
  const pretestCount = [];
  const posttestCount = [];
  const skriningCount = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    labels.push(date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }));

    const countByDate = (list) => (list || []).filter(d => {
      const ts = d.timestamp || d.createdAt;
      return ts && String(ts).startsWith(dateStr);
    }).length;

    pretestCount.push(countByDate(pretestData));
    posttestCount.push(countByDate(posttestData));
    skriningCount.push(countByDate(skriningData));
  }

  try {
    activityChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Pretest',
            data: pretestCount,
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: 'Posttest',
            data: posttestCount,
            borderColor: '#16a34a',
            backgroundColor: 'rgba(22, 163, 74, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
          {
            label: 'Skrining',
            data: skriningCount,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 10 } },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0 },
          },
        },
      },
    });
  } catch (e) {
    console.error('[DashboardView] Chart render error:', e);
  }
}

// ============================================================
//   RENDER: Activity Feed
// ============================================================
function renderActivityFeed(pretestData, posttestData, skriningData, pesertaData) {
  const feedContainer = getEl('activityFeed');
  if (!feedContainer) return;

  const activities = [];

  const pushIfValid = (arr, type) => {
    (arr || []).forEach(d => {
      const ts = d.timestamp || d.createdAt;
      if (d.nama && ts) {
        activities.push({ type, nama: d.nama, timestamp: ts });
      }
    });
  };

  pushIfValid(pretestData, 'pretest');
  pushIfValid(posttestData, 'posttest');
  pushIfValid(skriningData, 'skrining');

  // Peserta baru (3 hari terakhir)
  (pesertaData || []).forEach(d => {
    const ts = d.timestamp;
    if (d.nama_lengkap && ts) {
      const daysDiff = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff < 3) {
        activities.push({ type: 'daftar', nama: d.nama_lengkap, timestamp: ts });
      }
    }
  });

  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const latest = activities.slice(0, 6);

  if (latest.length === 0) {
    feedContainer.innerHTML = `<li class="text-center text-muted small py-3">Belum ada aktivitas terkini.</li>`;
    return;
  }

  const icons = {
    pretest:  { class: 'bg-primary bg-opacity-10 text-primary', icon: 'bi-pencil-square' },
    posttest: { class: 'bg-success bg-opacity-10 text-success', icon: 'bi-trophy' },
    skrining: { class: 'bg-warning bg-opacity-10 text-warning', icon: 'bi-clipboard-check' },
    daftar:   { class: 'bg-info bg-opacity-10 text-info',       icon: 'bi-person-plus-fill' },
  };
  const labels = {
    pretest: 'Pretest',
    posttest: 'Posttest',
    skrining: 'Skrining',
    daftar: 'Pendaftaran',
  };

  let html = '';
  latest.forEach(item => {
    const icon = icons[item.type] || icons.daftar;
    const label = labels[item.type] || 'Aktivitas';
    html += `
      <li class="feed-item">
        <div class="d-flex align-items-center" style="min-width:0;">
          <div class="icon-box ${icon.class}">
            <i class="bi ${icon.icon}" aria-hidden="true"></i>
          </div>
          <div class="content">
            <span class="name">${escapeHtml(item.nama)}</span>
            <span class="text-muted"> mengirim <strong>${label}</strong></span>
          </div>
        </div>
        <span class="time">${timeSince(new Date(item.timestamp))}</span>
      </li>
    `;
  });
  feedContainer.innerHTML = html;
}

// ============================================================
//   RENDER: Todo List
// ============================================================
function renderTodoList(pesertaList, sesiList, closedSessions, noMateri) {
  const container = getEl('todoListContainer');
  if (!container) return;

  const todos = [];

  const pending = (pesertaList || []).filter(p =>
    String(p.status || '').toLowerCase() === 'pending'
  );
  if (pending.length > 0) {
    todos.push({
      status: 'urgent',
      text: `<strong>${pending.length} peserta</strong> menunggu persetujuan`,
      action: 'Setujui',
      link: '#/admin/peserta',
    });
  }

  if (closedSessions.length > 0) {
    const limited = closedSessions.slice(0, 2);
    limited.forEach(s => {
      todos.push({
        status: 'pending',
        text: `Sesi "<strong>${escapeHtml(s.nama || '')}</strong>" tertutup`,
        action: 'Buka',
        link: '#/admin/sesi-absen',
      });
    });
    if (closedSessions.length > 2) {
      todos.push({
        status: 'pending',
        text: `...dan ${closedSessions.length - 2} sesi lainnya`,
        action: 'Lihat',
        link: '#/admin/sesi-absen',
      });
    }
  }

  if (noMateri) {
    todos.push({
      status: 'pending',
      text: 'Belum ada materi diunggah',
      action: 'Upload',
      link: '#/admin/materi',
    });
  }

  if (todos.length === 0) {
    container.innerHTML = `
      <li class="text-center text-muted small py-3">
        <i class="bi bi-check-circle-fill text-success me-2" aria-hidden="true"></i>
        Semua tugas selesai! 👍
      </li>
    `;
    return;
  }

  let html = '';
  todos.forEach(t => {
    html += `
      <li class="todo-item">
        <span class="status-dot ${t.status}" aria-hidden="true"></span>
        <span class="text">${t.text}</span>
        <a href="${t.link}" class="action">${t.action} →</a>
      </li>
    `;
  });
  container.innerHTML = html;
}

// ============================================================
//   GLOBAL SEARCH
// ============================================================
function handleGlobalSearch(e) {
  clearTimeout(searchDebounceTimer);
  const query = e.target.value.trim();
  searchDebounceTimer = setTimeout(() => performSearch(query), 250);
}

function performSearch(q) {
  const resultsContainer = getEl('globalSearchResults');
  if (!resultsContainer) return;

  if (q.length < 2) {
    resultsContainer.classList.remove('show');
    return;
  }

  const qLower = q.toLowerCase();
  const results = [];

  // Peserta
  (AdminModule.getPesertaList() || []).forEach(p => {
    if (p.nama_lengkap && p.nama_lengkap.toLowerCase().includes(qLower)) {
      results.push({
        icon: 'bi-person-badge',
        label: p.nama_lengkap,
        sub: p.utusan || 'Peserta',
        link: '#/admin/peserta',
      });
    }
  });

  // Materi
  (AdminModule.getMateriList() || []).forEach(m => {
    if (m.judul && m.judul.toLowerCase().includes(qLower)) {
      results.push({
        icon: 'bi-file-earmark-pdf',
        label: m.judul,
        sub: m.deskripsi || 'Materi',
        link: '#/admin/materi',
      });
    }
  });

  // Sesi
  (AdminModule.getSesiList() || []).forEach(s => {
    if (s.nama && s.nama.toLowerCase().includes(qLower)) {
      results.push({
        icon: 'bi-calendar-event',
        label: s.nama,
        sub: 'Sesi Absen',
        link: '#/admin/sesi-absen',
      });
    }
  });

  if (results.length === 0) {
    resultsContainer.innerHTML = `<div class="empty">Tidak ditemukan hasil untuk "<strong>${escapeHtml(q)}</strong>"</div>`;
  } else {
    let html = '';
    results.slice(0, 8).forEach(r => {
      html += `
        <a href="${r.link}" class="result-item">
          <i class="bi ${r.icon}" aria-hidden="true"></i>
          <div>
            <div class="label">${escapeHtml(r.label)}</div>
            <div class="sub">${escapeHtml(r.sub)}</div>
          </div>
        </a>
      `;
    });
    resultsContainer.innerHTML = html;
  }
  resultsContainer.classList.add('show');
}

function handleClickOutsideSearch(e) {
  const wrapper = document.querySelector('.global-search-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    getEl('globalSearchResults')?.classList.remove('show');
  }
}

// ============================================================
//   SCAN QR — INIT MODE
// ============================================================
function initScanModeSafe() {
  const modeOtomatis = getEl('modeOtomatis');
  const modeManual  = getEl('modeManual');
  const containerManual = getEl('manualSessionContainer');
  const manualSelect = getEl('manualSessionSelect');

  if (containerManual) containerManual.style.display = 'none';

  // Bind radio otomatis — guard pakai dataset
  if (modeOtomatis && !modeOtomatis.dataset.bound) {
    modeOtomatis.dataset.bound = '1';
    on(modeOtomatis, 'change', function () {
      if (!this.checked) return;
      currentScanMode = 'otomatis';
      if (containerManual) containerManual.style.display = 'none';
    });
  }

  // Bind radio manual
  if (modeManual && !modeManual.dataset.bound) {
    modeManual.dataset.bound = '1';
    on(modeManual, 'change', function () {
      if (!this.checked) return;
      currentScanMode = 'manual';
      if (containerManual) {
        containerManual.style.display = 'block';
        setTimeout(() => containerManual.classList.add('show'), 10);
      }
      loadManualSesiDropdown();
    });
  }

  // Bind manual select
  if (manualSelect && !manualSelect.dataset.bound) {
    manualSelect.dataset.bound = '1';
    on(manualSelect, 'change', function () {
      console.log('[Scan] Manual sesi dipilih:', this.value);
    });
  }

  // Bind stop scan button
  const stopBtn = getEl('scanStopBtn');
  if (stopBtn && !stopBtn.dataset.bound) {
    stopBtn.dataset.bound = '1';
    on(stopBtn, 'click', () => {
      stopScanner();
      try {
        const modalEl = getEl('scanQrModal');
        if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
      } catch (e) { /* silent */ }
    });
  }
}

async function loadManualSesiDropdown() {
  const select = getEl('manualSessionSelect');
  if (!select) return;

  select.innerHTML = '<option value="">Memuat data sesi...</option>';

  try {
    const sesiRes = await callApi('getSesiAbsen', {}, 'GET');
    let allSesi = [];
    if (sesiRes && sesiRes.success && Array.isArray(sesiRes.data)) allSesi = sesiRes.data;
    else if (Array.isArray(sesiRes)) allSesi = sesiRes;

    if (!allSesi || allSesi.length === 0) {
      select.innerHTML = '<option value="">Tidak ada sesi tersedia</option>';
      return;
    }

    let optionsHtml = '<option value="">-- Pilih Sesi --</option>';
    allSesi.forEach(s => {
      const isOpen = String(s.submission_open).toLowerCase() === 'true';
      const statusLabel = isOpen ? '🟢 Aktif' : '🔴 Tutup';
      optionsHtml += `<option value="${escapeHtml(String(s.id))}">${escapeHtml(s.nama)} (${statusLabel})</option>`;
    });
    select.innerHTML = optionsHtml;
  } catch (err) {
    console.error('[Scan] Gagal load sesi:', err);
    select.innerHTML = '<option value="">Gagal memuat data</option>';
  }
}

// ============================================================
//   OPEN SCANNER
// ============================================================
function openScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Scanner QR tidak tersedia. Cek koneksi Anda.', 'error');
    return;
  }

  const modalEl = getEl('scanQrModal');
  if (!modalEl) return;

  // Reset state
  currentScanMode = 'otomatis';
  const radioOtomatis = getEl('modeOtomatis');
  if (radioOtomatis) radioOtomatis.checked = true;
  const containerManual = getEl('manualSessionContainer');
  if (containerManual) containerManual.style.display = 'none';

  // Show modal
  scanModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
  scanModalInstance.show();

  // Delay untuk modal animate
  setTimeout(() => {
    initScanModeSafe();
    startScanner();
  }, 250);
}

function startScanner() {
  const statusEl = getEl('scannerStatus');
  const videoContainer = getEl('scannerVideoContainer');

  if (!videoContainer || !statusEl) return;

  // Guard: kalau sudah running
  if (isScannerRunning) {
    stopScanner();
    setTimeout(startScanner, 300);
    return;
  }

  const isDesktop = window.innerWidth >= 992;
  const qrboxSize = isDesktop ? 400 : 250;

  statusEl.innerText = 'Mengakses kamera...';

  try {
    scanQrInstance = new Html5Qrcode('scannerVideoContainer');

    const config = {
      fps: 30,
      qrbox: { width: qrboxSize, height: qrboxSize },
      aspectRatio: 1.0,
    };

    scanQrInstance
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText) => onQRDetected(decodedText),
        () => { /* ignore per-frame errors */ }
      )
      .then(() => {
        isScannerRunning = true;
        statusEl.innerText = 'Memindai QR...';
      })
      .catch((err) => {
        statusEl.innerText = 'Gagal mengakses kamera: ' + (err?.message || 'unknown');
        showToast('Gagal mengakses kamera. Mohon izinkan akses kamera.', 'error');
        isScannerRunning = false;
        scanQrInstance = null;
      });
  } catch (err) {
    statusEl.innerText = 'Error: ' + (err?.message || 'unknown');
    showToast('Terjadi kesalahan saat memuat scanner.', 'error');
    isScannerRunning = false;
    scanQrInstance = null;
  }
}

function stopScanner() {
  if (scanQrInstance && isScannerRunning) {
    try {
      scanQrInstance
        .stop()
        .then(() => {
          try { scanQrInstance.clear(); } catch (e) {}
          scanQrInstance = null;
          isScannerRunning = false;
          const videoContainer = getEl('scannerVideoContainer');
          const statusEl = getEl('scannerStatus');
          if (videoContainer) videoContainer.innerHTML = '';
          if (statusEl) statusEl.innerText = '';
        })
        .catch((e) => {
          console.warn('[Scanner] stop error:', e);
          isScannerRunning = false;
          scanQrInstance = null;
        });
    } catch (e) {
      console.warn('[Scanner] stop exception:', e);
      isScannerRunning = false;
      scanQrInstance = null;
    }
  } else {
    const videoContainer = getEl('scannerVideoContainer');
    const statusEl = getEl('scannerStatus');
    if (videoContainer) videoContainer.innerHTML = '';
    if (statusEl) statusEl.innerText = '';
    isScannerRunning = false;
    scanQrInstance = null;
  }
}

// ============================================================
//   ON QR DETECTED
// ============================================================
async function onQRDetected(decodedText) {
  // Stop scanner & close modal
  stopScanner();

  const modalEl = getEl('scanQrModal');
  if (modalEl) {
    try {
      bootstrap.Modal.getInstance(modalEl)?.hide();
    } catch (e) { /* silent */ }
  }

  // ===== Format: sesi (scan dari QR sesi) =====
  const matchSesi = decodedText.match(/sesi_id=([^&]+)/);
  if (matchSesi) {
    const sesiId = matchSesi[1];
    const tokenMatch = decodedText.match(/token=([^&]+)/);
    const token = tokenMatch ? tokenMatch[1] : '';
    window.location.href = `/bisaa/absen.html?sesi_id=${encodeURIComponent(sesiId)}&token=${encodeURIComponent(token)}`;
    return;
  }

  // ===== Format: peserta (scan dari ID card) =====
  const matchPeserta = decodedText.match(/peserta_id=([^&]+)/);
  if (matchPeserta) {
    const pesertaId = matchPeserta[1];
    let peserta = AdminModule.getPesertaById(pesertaId);

    if (!peserta) {
      console.warn('[Scan] Peserta tidak di cache, sync ulang...');
      await AdminModule.loadAllData(true);
      peserta = AdminModule.getPesertaById(pesertaId);
      if (!peserta) {
        showToast('ID Peserta tidak ditemukan. Pastikan QR benar.', 'error');
        return;
      }
    }

    const statusLower = String(peserta.status || '').toLowerCase().trim();
    if (statusLower !== 'approved' && statusLower !== 'active') {
      showToast('Peserta belum disetujui. QR tidak aktif.', 'warning');
      return;
    }

    pendingScanData.pesertaId = pesertaId;
    pendingScanData.nama = peserta.nama_lengkap;

    const nameEl = getEl('resultNamaPeserta');
    const statusEl = getEl('resultStatusPeserta');
    if (nameEl) nameEl.innerText = peserta.nama_lengkap;
    if (statusEl) statusEl.innerHTML = `<span class="badge bg-success">Disetujui / Aktif</span>`;

    showScanResultModal();
    return;
  }

  showToast('Format QR tidak dikenali.', 'warning');
}

function showScanResultModal() {
  const resultModal = getEl('scanResultModal');
  if (!resultModal) return;

  resultModalInstance = bootstrap.Modal.getOrCreateInstance(resultModal);
  resultModalInstance.show();

  // Bind buttons dengan .onclick (tidak accumulate)
  const btnAbsen = getEl('btnAbsenSekarang');
  const btnBuka = getEl('btnBukaSesi');

  if (btnAbsen) {
    btnAbsen.onclick = () => {
      try { resultModalInstance?.hide(); } catch (e) {}
      setTimeout(() => showSignatureModalAndAbsen(pendingScanData.pesertaId, pendingScanData.nama), 300);
    };
  }

  if (btnBuka) {
    btnBuka.onclick = () => {
      try { resultModalInstance?.hide(); } catch (e) {}
      setTimeout(() => { window.location.hash = '#/admin/sesi-absen'; }, 300);
    };
  }
}

// ============================================================
//   SIGNATURE MODAL + SUBMIT ABSEN
// ============================================================
function showSignatureModalAndAbsen(pesertaId, nama) {
  // Remove old modal
  const oldModal = getEl('adminSignatureModal');
  if (oldModal) oldModal.remove();

  const safeNama = escapeHtml(nama);

  const modalHtml = `
    <div class="modal fade" id="adminSignatureModal" tabindex="-1" data-bs-backdrop="static" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow-lg">
          <div class="modal-header bg-primary text-white border-0 rounded-top-4">
            <h5 class="modal-title">
              <i class="bi bi-pencil-square me-2" aria-hidden="true"></i>Tanda Tangan Digital
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal" aria-label="Tutup"></button>
          </div>
          <div class="modal-body p-4 text-center">
            <p class="mb-3">Peserta: <strong>${safeNama}</strong></p>
            <div class="signature-area">
              <canvas id="adminSignatureCanvas" width="300" height="150" aria-label="Area tanda tangan"></canvas>
            </div>
            <div class="mt-2 d-flex gap-2 justify-content-center">
              <button type="button" class="btn btn-outline-secondary btn-sm" id="clearAdminSign">Hapus</button>
              <button type="button" class="btn btn-outline-primary btn-sm" id="undoAdminSign">Undo</button>
            </div>
          </div>
          <div class="modal-footer border-0 justify-content-center">
            <button type="button" class="btn btn-secondary rounded-pill px-4" data-bs-dismiss="modal">Batal</button>
            <button type="button" class="btn btn-success rounded-pill px-4" id="adminSubmitAbsen">
              <i class="bi bi-check-circle-fill me-1" aria-hidden="true"></i>Kirim Absen
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  dynamicSignatureModalEl = getEl('adminSignatureModal');
  if (!dynamicSignatureModalEl) return;

  signatureModalInstance = bootstrap.Modal.getOrCreateInstance(dynamicSignatureModalEl);
  signatureModalInstance.show();

  const canvas = getEl('adminSignatureCanvas');
  if (!canvas) return;

  let sigPad = null;
  let resizeHandler = null;

  const initCanvas = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(rect.width, 260);
    const h = 150;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
  };

  initCanvas();

  if (typeof SignaturePad === 'undefined') {
    showToast('Signature Pad tidak tersedia.', 'error');
    return;
  }

  sigPad = new SignaturePad(canvas, {
    backgroundColor: 'rgb(255,255,255)',
    penColor: '#0f172a',
    minWidth: 1.5,
    maxWidth: 3,
  });

  // Preserve data on resize
  resizeHandler = () => {
    if (!sigPad) return;
    const data = sigPad.toData();
    initCanvas();
    sigPad.clear();
    if (data.length) sigPad.fromData(data);
  };
  window.addEventListener('resize', resizeHandler);

  // Cleanup on modal close
  dynamicSignatureModalEl.addEventListener('hidden.bs.modal', () => {
    if (resizeHandler) {
      window.removeEventListener('resize', resizeHandler);
      resizeHandler = null;
    }
    try { sigPad?.off?.(); } catch (e) {}
    sigPad = null;
    try { dynamicSignatureModalEl?.remove(); } catch (e) {}
    dynamicSignatureModalEl = null;
  }, { once: true });

  // Bind clear / undo
  on(getEl('clearAdminSign'), 'click', () => sigPad?.clear());
  on(getEl('undoAdminSign'), 'click', () => {
    const data = sigPad?.toData();
    if (data && data.length > 0) {
      data.pop();
      sigPad.fromData(data);
    }
  });

  // Bind submit
  on(getEl('adminSubmitAbsen'), 'click', async function () {
    if (!sigPad || sigPad.isEmpty()) {
      showToast('Tanda tangan wajib diisi!', 'warning');
      return;
    }

    const btn = this;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengirim...';

    let selectedSesiId = null;

    if (currentScanMode === 'otomatis') {
      const allSesi = AdminModule.getSesiList() || [];
      const now = new Date();
      const activeSesi = allSesi.filter(s => {
        const open = String(s.submission_open).toLowerCase() === 'true';
        if (!open) return false;
        if (!s.waktu_mulai || !s.waktu_selesai) return true;
        const start = new Date(s.waktu_mulai);
        const end = new Date(s.waktu_selesai);
        return now >= start && now <= end;
      });

      if (activeSesi.length === 0) {
        showToast('Tidak ada sesi aktif saat ini.', 'warning');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Kirim Absen';
        return;
      }
      selectedSesiId = activeSesi[0].id;
    } else if (currentScanMode === 'manual') {
      const manualSelect = getEl('manualSessionSelect');
      if (!manualSelect || !manualSelect.value) {
        showToast('Pilih sesi manual terlebih dahulu.', 'warning');
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Kirim Absen';
        return;
      }
      selectedSesiId = manualSelect.value;
    }

    try {
      const signatureDataURL = sigPad.toDataURL('image/jpeg', 0.2);
      const result = await callApi('submitAbsen', {
        nama: nama,
        sesiId: selectedSesiId,
        tandaTangan: signatureDataURL,
        password: null,
        qrToken: null,
        pesertaId: pesertaId,
      }, 'POST');

      if (result && result.success) {
        showToast(`✅ Absen berhasil untuk ${nama}`, 'success');
        sigPad.clear();
        try { signatureModalInstance?.hide(); } catch (e) {}
        await loadData(true);
      } else {
        throw new Error((result && result.error) || 'Gagal submit absen');
      }
    } catch (err) {
      const msg = err.message || 'Terjadi kesalahan';
      if (msg.includes('Sudah absen')) {
        showToast('⚠️ Peserta sudah absen di sesi ini.', 'warning');
      } else {
        showToast('❌ ' + msg, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-check-circle-fill me-1"></i>Kirim Absen';
    }
  });
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

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  let interval = seconds / 31536000; if (interval > 1) return Math.floor(interval) + ' thn lalu';
  interval = seconds / 2592000; if (interval > 1) return Math.floor(interval) + ' bln lalu';
  interval = seconds / 86400;   if (interval > 1) return Math.floor(interval) + ' hr lalu';
  interval = seconds / 3600;    if (interval > 1) return Math.floor(interval) + ' jam lalu';
  interval = seconds / 60;      if (interval > 1) return Math.floor(interval) + ' mnt lalu';
  return Math.floor(seconds) + ' dtk lalu';
}
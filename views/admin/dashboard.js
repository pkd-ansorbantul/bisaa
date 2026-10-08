// ============================================================
// VIEW: dashboard.js — v27.1.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/dashboard.html
// ============================================================
// CHANGELOG v27.1.0 (dari v26.4.0):
//   ✅ NEW: Instant render dari preload cache (data sudah ada)
//   ✅ NEW: Subscription pattern — auto re-render saat data berubah
//   ✅ NEW: bindRefreshButton() ke global forceSync
//   ✅ REMOVED: Per-view polling — auto-sync global di app.js
//   ✅ FIX: Change detection via cheap hash
//   ✅ FIX: Chart destroy + recreate dengan animation toggle
//   ✅ FIX: Timezone-safe chart labels (getLocalDateOnly)
//   ✅ FIX: Reset pendingScanData + scanModalInstance on unmount
//   ✅ FIX: Signature modal — tracked cleanup + resize debounce
//   ✅ FIX: Scanner race condition — stopScanner safe semua state
//   ✅ FIX: Admin mode absen fallback (BUG-006)
//   ✅ FIX: Global search click-outside pakai event handler (bukan on)
//   ✅ PERF: O(n) chart data lookup via Map
//   ✅ KEEP: 6 stat cards, chart tren, quick actions, feed, todo,
//             global search, scan QR, floating button, admin absen
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import {
  callApi,
  showToast,
  escapeHtml,
  getLocalDateOnly,
  formatDateTimeID,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
import {
  getEl,
  setBtnLoading,
  createViewContext,
  computeListHash,
  setCacheStatus,
  ensureChartJS,
  cleanupBootstrapArtifacts,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const SCAN_MODE_DEFAULT = 'otomatis';
const CHART_ID = 'activityChart';
const SEARCH_DEBOUNCE_MS = 250;

// ============================================================
//   CONTEXT — dengan auto-subscribe ke AdminModule
// ============================================================
const ctx = createViewContext(
  {
    lastHash: '',
    lastChartHash: '',
    scanQrInstance: null,
    isScannerRunning: false,
    currentScanMode: SCAN_MODE_DEFAULT,
    pendingScanData: { pesertaId: null, nama: null },
    isSubmittingAbsen: false,
    dynamicSignatureModalEl: null,
    signatureModalInstance: null,
    resultModalInstance: null,
    scanModalInstance: null,
    activityChartInstance: null,
    resizeListener: null,
    searchDebounceTimer: null,
  },
  {
    // ⚡ Auto-subscribe ke semua perubahan data AdminModule
    watchTypes: ['all', 'multiple', 'manual-refresh'],
    onDataChange: (type, state) => {
      if (!ctx.mounted) return;
      console.log(`[DashboardView] ⚡ Data changed (${type}) → re-render`);
      // Instant re-render tanpa fetch
      try {
        renderDashboard();
        updateCacheStatus('Live');
      } catch (e) {
        console.warn('[DashboardView] Re-render error:', e);
      }
    },
  }
);

let outsideClickListener = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[DashboardView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[DashboardView] mounted');

  const container = getEl('dashboardContent');
  if (!container) {
    console.warn('[DashboardView] #dashboardContent tidak ditemukan');
    ctx.mounted = false;
    return unmount;
  }

  // Reset state
  Object.assign(ctx.state, {
    lastHash: '',
    lastChartHash: '',
    scanQrInstance: null,
    isScannerRunning: false,
    currentScanMode: SCAN_MODE_DEFAULT,
    pendingScanData: { pesertaId: null, nama: null },
    isSubmittingAbsen: false,
    dynamicSignatureModalEl: null,
    signatureModalInstance: null,
    resultModalInstance: null,
    scanModalInstance: null,
    activityChartInstance: null,
    resizeListener: null,
    searchDebounceTimer: null,
  });

  // Lazy load Chart.js (background, non-blocking)
  ensureChartJS().catch(e => {
    console.warn('[DashboardView] Chart.js unavailable:', e.message);
  });

  // Bind events (termasuk refresh button)
  bindEvents();
  initScanModeSafe();

  // ===== ⚡ INSTANT RENDER dari preload cache =====
  const stats = AdminModule.getStats() || {};
  const hasData = (stats.totalPeserta || 0) + (stats.totalSesi || 0) + (stats.totalMateri || 0) > 0;

  if (hasData) {
    console.log('[DashboardView] ⚡ Rendering from preload cache');
    try {
      renderDashboard();
      updateCacheStatus('Live');
    } catch (e) {
      console.error('[DashboardView] Initial render error:', e);
      await loadData(false);
    }
  } else {
    console.log('[DashboardView] ⚠️ No preload data, showing skeleton');
    renderSkeleton();
    await loadData(false);
  }

  // ===== ⚡ SUBSCRIBE ke perubahan data =====
  await ctx.subscribeToData();

  // ===== ⚡ BIND refresh button ke global forceSync =====
  ctx.bindRefreshButton('refreshDataBtn', 'Data disegarkan');

  // ⚡ NO POLLING — auto-sync di app.js sudah handle semua

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[DashboardView] unmounted');

  // Clear search debounce
  if (ctx.state.searchDebounceTimer) {
    clearTimeout(ctx.state.searchDebounceTimer);
    ctx.state.searchDebounceTimer = null;
  }

  // Destroy chart
  if (ctx.state.activityChartInstance) {
    try { ctx.state.activityChartInstance.destroy(); }
    catch (e) { /* silent */ }
    ctx.state.activityChartInstance = null;
  }

  // Stop scanner
  stopScanner();

  // Reset pending data
  ctx.state.pendingScanData = { pesertaId: null, nama: null };
  ctx.state.currentScanMode = SCAN_MODE_DEFAULT;
  ctx.state.isSubmittingAbsen = false;

  // Remove resize listener
  if (ctx.state.resizeListener) {
    window.removeEventListener('resize', ctx.state.resizeListener);
    ctx.state.resizeListener = null;
  }

  // Remove click-outside handler
  if (outsideClickListener) {
    document.removeEventListener('click', outsideClickListener);
    outsideClickListener = null;
  }

  // Remove dynamic signature modal
  if (ctx.state.dynamicSignatureModalEl) {
    try { ctx.state.dynamicSignatureModalEl.remove(); }
    catch (e) { /* silent */ }
    ctx.state.dynamicSignatureModalEl = null;
  }

  // Dispose modals
  ['signatureModalInstance', 'resultModalInstance', 'scanModalInstance'].forEach(key => {
    if (ctx.state[key]) {
      try { ctx.state[key]?.dispose?.(); }
      catch (e) { /* silent */ }
      ctx.state[key] = null;
    }
  });

  // Hide floating scan button
  getEl('scanFloatBtn')?.classList.remove('show');

  // Cleanup context (listeners + modals + subscription)
  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search input
  ctx.on(getEl('globalSearchInput'), 'input', handleGlobalSearch);

  // Scan float button
  ctx.on(getEl('scanFloatBtn'), 'click', openScanner);

  // Click-outside untuk close search results
  outsideClickListener = function (e) {
    const wrapper = document.querySelector('.global-search-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
      getEl('globalSearchResults')?.classList.remove('show');
    }
  };
  document.addEventListener('click', outsideClickListener);

  // Note: refreshDataBtn sudah di-bind via ctx.bindRefreshButton()
}

// ============================================================
//   LOAD DATA (fallback jika preload gagal)
// ============================================================
async function loadData(forceRefresh = false) {
  const container = getEl('dashboardContent');
  if (!container) return;

  updateCacheStatus('Memuat...');

  try {
    if (!forceRefresh && AdminModule.getState().lastSync) {
      try { renderDashboard(); }
      catch (e) { console.warn('Render cache error:', e); }
      updateCacheStatus('Cache');
      return;
    }

    await AdminModule.loadAllData(forceRefresh);
    if (!ctx.mounted) return;

    // Change detection via hash
    const stats = AdminModule.getStats() || {};
    const state = AdminModule.getState() || {};
    const newHash = computeListHash([
      { c: stats.totalPeserta, t: 0 },
      { c: stats.totalSesi, t: 1 },
      { c: stats.totalMateri, t: 2 },
      { c: (state.peserta || []).filter(x =>
        String(x.status || '').toLowerCase() === 'pending'
      ).length, t: 3 },
    ], ['c']);

    if (forceRefresh || newHash !== ctx.state.lastHash) {
      ctx.state.lastHash = newHash;
      renderDashboard();
    }

    updateCacheStatus('Live');
  } catch (e) {
    console.error('[DashboardView] load error:', e);
    updateCacheStatus('Error');

    if (!AdminModule.getState().lastSync) {
      container.innerHTML = `
        <div class="alert alert-danger text-center">
          <i class="bi bi-exclamation-triangle-fill fs-1 d-block mb-3" aria-hidden="true"></i>
          <h5>Gagal Memuat Data</h5>
          <p class="small mb-3">${escapeHtml(e.message || 'Terjadi kesalahan')}</p>
          <button class="btn btn-outline-danger" data-dash-action="reload">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Muat Ulang
          </button>
        </div>
      `;
      container.querySelector('[data-dash-action="reload"]')
        ?.addEventListener('click', () => location.reload());
    }
  }
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeleton() {
  const container = getEl('dashboardContent');
  if (!container) return;

  container.innerHTML = `
    <div class="row g-2 g-sm-3">
      ${Array(6).fill(0).map(() => `
        <div class="col-6 col-md-4">
          <div class="stat-card skeleton">
            <div class="stat-number"></div>
            <div class="stat-label"></div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="row g-2 mt-4">
      <div class="col-md-8">
        <div class="stat-card" style="padding:1.2rem;">
          <div class="skeleton-box" style="height:20px;width:200px;margin-bottom:12px;"></div>
          <div class="skeleton-box" style="height:220px;width:100%;"></div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card" style="padding:1.2rem;">
          <div class="skeleton-box" style="height:20px;width:120px;margin-bottom:12px;"></div>
          <div class="skeleton-box" style="height:80px;width:100%;margin-bottom:8px;"></div>
          <div class="skeleton-box" style="height:80px;width:100%;"></div>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
//   RENDER: DASHBOARD
// ============================================================
function renderDashboard() {
  const container = getEl('dashboardContent');
  if (!container) return;

  const stats = AdminModule.getStats() || {};
  const allPeserta   = AdminModule.getPesertaList()  || [];
  const sesiList     = AdminModule.getSesiList()     || [];
  const materiList   = AdminModule.getMateriList()   || [];
  const skriningList = AdminModule.getSkriningList() || [];
  const pretestList  = AdminModule.getPretestList()  || [];
  const posttestList = AdminModule.getPosttestList() || [];
  const alumniList   = AdminModule.getAlumniList()   || [];

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

  // ====== Render HTML ======
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
            <canvas id="${CHART_ID}" aria-label="Chart tren aktivitas 7 hari"></canvas>
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
          Data dari cloud, diperbarui otomatis setiap 60 detik.
          ${stats.lastSync ? `<br><small>Terakhir sinkronisasi: ${escapeHtml(formatDateTimeID(stats.lastSync))}</small>` : ''}
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

  // Sub-render setelah DOM tersedia
  requestAnimationFrame(() => {
    try {
      renderActivityChart(pretestList, posttestList, skriningList);
      renderActivityFeed(pretestList, posttestList, skriningList, allPeserta);
      renderTodoList(allPeserta, sesiList, closedSessions, noMateri);
    } catch (e) {
      console.error('[DashboardView] render sub-component error:', e);
    }
  });

  getEl('scanFloatBtn')?.classList.add('show');
}

// ============================================================
//   TREND HELPERS
// ============================================================
function calculateTrend(dataList, dateField) {
  const now = new Date();
  const sevenDaysAgo   = new Date(now); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
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
//   ACTIVITY CHART
// ============================================================
async function renderActivityChart(pretestData, posttestData, skriningData) {
  const canvas = getEl(CHART_ID);
  if (!canvas) return;

  // Lazy load Chart.js
  try {
    await ensureChartJS();
  } catch (e) {
    console.warn('[DashboardView] Chart.js tidak tersedia:', e.message);
    return;
  }

  if (typeof Chart === 'undefined') {
    console.warn('[DashboardView] Chart global tidak tersedia');
    return;
  }

  // Destroy existing
  if (ctx.state.activityChartInstance) {
    try { ctx.state.activityChartInstance.destroy(); }
    catch (e) { /* silent */ }
    ctx.state.activityChartInstance = null;
  }

  // ⚡ Build O(n) lookup maps
  const buildLookup = (list) => {
    const map = new Map();
    (list || []).forEach(d => {
      const ts = d.timestamp || d.createdAt;
      if (!ts) return;
      const key = getLocalDateOnly(new Date(ts));
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  };

  const pretestMap  = buildLookup(pretestData);
  const posttestMap = buildLookup(posttestData);
  const skriningMap = buildLookup(skriningData);

  const labels = [];
  const pretestCount = [];
  const posttestCount = [];
  const skriningCount = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = getLocalDateOnly(date);

    labels.push(date.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric' }));
    pretestCount.push(pretestMap.get(dateStr) || 0);
    posttestCount.push(posttestMap.get(dateStr) || 0);
    skriningCount.push(skriningMap.get(dateStr) || 0);
  }

  // ⚡ Chart hash — skip recreate jika data sama
  const chartHash = computeListHash([
    { l: labels.join(','), p: pretestCount.join(','), po: posttestCount.join(','), s: skriningCount.join(',') },
  ], ['l', 'p', 'po', 's']);
  if (chartHash === ctx.state.lastChartHash) return;
  ctx.state.lastChartHash = chartHash;

  try {
    ctx.state.activityChartInstance = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
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
//   ACTIVITY FEED
// ============================================================
function renderActivityFeed(pretestData, posttestData, skriningData, pesertaData) {
  const feedContainer = getEl('activityFeed');
  if (!feedContainer) return;

  const activities = [];

  const pushValid = (arr, type) => {
    (arr || []).forEach(d => {
      const ts = d.timestamp || d.createdAt;
      if (d.nama && ts) activities.push({ type, nama: d.nama, timestamp: ts });
    });
  };

  pushValid(pretestData, 'pretest');
  pushValid(posttestData, 'posttest');
  pushValid(skriningData, 'skrining');

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
//   TODO LIST
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
  if (ctx.state.searchDebounceTimer) {
    clearTimeout(ctx.state.searchDebounceTimer);
  }
  const query = e.target.value.trim();
  ctx.state.searchDebounceTimer = setTimeout(() => performSearch(query), SEARCH_DEBOUNCE_MS);
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

// ============================================================
//   SCAN MODE
// ============================================================
function initScanModeSafe() {
  const modeOtomatis = getEl('modeOtomatis');
  const modeManual   = getEl('modeManual');
  const containerManual = getEl('manualSessionContainer');
  const manualSelect = getEl('manualSessionSelect');

  if (containerManual) containerManual.style.display = 'none';

  if (modeOtomatis && !modeOtomatis.dataset.bound) {
    modeOtomatis.dataset.bound = '1';
    ctx.on(modeOtomatis, 'change', function () {
      if (!this.checked) return;
      ctx.state.currentScanMode = 'otomatis';
      if (containerManual) containerManual.style.display = 'none';
    });
  }

  if (modeManual && !modeManual.dataset.bound) {
    modeManual.dataset.bound = '1';
    ctx.on(modeManual, 'change', function () {
      if (!this.checked) return;
      ctx.state.currentScanMode = 'manual';
      if (containerManual) {
        containerManual.style.display = 'block';
        setTimeout(() => containerManual.classList.add('show'), 10);
      }
      loadManualSesiDropdown();
    });
  }

  if (manualSelect && !manualSelect.dataset.bound) {
    manualSelect.dataset.bound = '1';
    ctx.on(manualSelect, 'change', function () {
      console.log('[Scan] Manual sesi dipilih:', this.value);
    });
  }

  const stopBtn = getEl('scanStopBtn');
  if (stopBtn && !stopBtn.dataset.bound) {
    stopBtn.dataset.bound = '1';
    ctx.on(stopBtn, 'click', () => {
      stopScanner();
      if (ctx.state.scanModalInstance) {
        try { ctx.state.scanModalInstance.hide(); }
        catch (e) { /* silent */ }
      }
    });
  }
}

async function loadManualSesiDropdown() {
  const select = getEl('manualSessionSelect');
  if (!select) return;

  select.innerHTML = '<option value="">Memuat data sesi...</option>';

  try {
    // ✅ Baca dari cache AdminModule
    const allSesi = AdminModule.getSesiList() || [];

    if (!allSesi || allSesi.length === 0) {
      select.innerHTML = '<option value="">Tidak ada sesi tersedia</option>';
      return;
    }

    let optionsHtml = '<option value="">-- Pilih Sesi --</option>';
    allSesi.forEach(s => {
      const isOpen = String(s.submission_open).toLowerCase() === 'true' || s.submission_open === true;
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
//   SCANNER
// ============================================================
function openScanner() {
  if (typeof Html5Qrcode === 'undefined') {
    showToast('Scanner QR tidak tersedia. Cek koneksi Anda.', 'error');
    return;
  }

  const modalEl = getEl('scanQrModal');
  if (!modalEl) return;

  ctx.state.currentScanMode = 'otomatis';
  const radioOtomatis = getEl('modeOtomatis');
  if (radioOtomatis) radioOtomatis.checked = true;
  const containerManual = getEl('manualSessionContainer');
  if (containerManual) containerManual.style.display = 'none';

  ctx.state.scanModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
  ctx.state.scanModalInstance.show();

  setTimeout(() => {
    initScanModeSafe();
    startScanner();
  }, 250);
}

function startScanner() {
  const statusEl = getEl('scannerStatus');
  const videoContainer = getEl('scannerVideoContainer');
  if (!videoContainer || !statusEl) return;

  if (ctx.state.isScannerRunning) {
    stopScanner();
    setTimeout(startScanner, 300);
    return;
  }

  const isDesktop = window.innerWidth >= 992;
  const qrboxSize = isDesktop ? 400 : 250;

  statusEl.innerText = 'Mengakses kamera...';

  try {
    ctx.state.scanQrInstance = new Html5Qrcode('scannerVideoContainer');

    const config = {
      fps: 30,
      qrbox: { width: qrboxSize, height: qrboxSize },
      aspectRatio: 1.0,
    };

    ctx.state.scanQrInstance
      .start(
        { facingMode: 'environment' },
        config,
        (decodedText) => onQRDetected(decodedText),
        () => { /* ignore per-frame errors */ }
      )
      .then(() => {
        ctx.state.isScannerRunning = true;
        statusEl.innerText = 'Memindai QR...';
      })
      .catch((err) => {
        statusEl.innerText = 'Gagal mengakses kamera: ' + (err?.message || 'unknown');
        showToast('Gagal mengakses kamera. Mohon izinkan akses kamera.', 'error');
        ctx.state.isScannerRunning = false;
        ctx.state.scanQrInstance = null;
      });
  } catch (err) {
    statusEl.innerText = 'Error: ' + (err?.message || 'unknown');
    showToast('Terjadi kesalahan saat memuat scanner.', 'error');
    ctx.state.isScannerRunning = false;
    ctx.state.scanQrInstance = null;
  }
}

function stopScanner() {
  const videoContainer = getEl('scannerVideoContainer');
  const statusEl = getEl('scannerStatus');

  if (ctx.state.scanQrInstance && ctx.state.isScannerRunning) {
    try {
      ctx.state.scanQrInstance
        .stop()
        .then(() => {
          try { ctx.state.scanQrInstance?.clear(); }
          catch (e) { /* silent */ }
          ctx.state.scanQrInstance = null;
          ctx.state.isScannerRunning = false;
          if (videoContainer) videoContainer.innerHTML = '';
          if (statusEl) statusEl.innerText = '';
        })
        .catch((e) => {
          console.warn('[Scanner] stop error:', e);
          ctx.state.isScannerRunning = false;
          ctx.state.scanQrInstance = null;
        });
    } catch (e) {
      console.warn('[Scanner] stop exception:', e);
      ctx.state.isScannerRunning = false;
      ctx.state.scanQrInstance = null;
    }
  } else {
    if (videoContainer) videoContainer.innerHTML = '';
    if (statusEl) statusEl.innerText = '';
    ctx.state.isScannerRunning = false;
    ctx.state.scanQrInstance = null;
  }
}

// ============================================================
//   QR DETECTED
// ============================================================
async function onQRDetected(decodedText) {
  stopScanner();

  if (ctx.state.scanModalInstance) {
    try { ctx.state.scanModalInstance.hide(); }
    catch (e) { /* silent */ }
  }

  // ===== Sesi QR =====
  const matchSesi = decodedText.match(/sesi_id=([^&]+)/);
  if (matchSesi) {
    const sesiId = matchSesi[1];
    const tokenMatch = decodedText.match(/token=([^&]+)/);
    const token = tokenMatch ? tokenMatch[1] : '';

    window.location.href = `${BASE_PATH}absen.html?sesi_id=${encodeURIComponent(sesiId)}&token=${encodeURIComponent(token)}`;
    return;
  }

  // ===== Peserta QR =====
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

    ctx.state.pendingScanData.pesertaId = pesertaId;
    ctx.state.pendingScanData.nama = peserta.nama_lengkap;

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

  ctx.state.resultModalInstance = bootstrap.Modal.getOrCreateInstance(resultModal);
  ctx.state.resultModalInstance.show();

  const btnAbsen = getEl('btnAbsenSekarang');
  const btnBuka = getEl('btnBukaSesi');

  if (btnAbsen) {
    btnAbsen.onclick = () => {
      try { ctx.state.resultModalInstance.hide(); } catch (e) {}
      setTimeout(() => {
        showSignatureModalAndAbsen(
          ctx.state.pendingScanData.pesertaId,
          ctx.state.pendingScanData.nama
        );
      }, 300);
    };
  }

  if (btnBuka) {
    btnBuka.onclick = () => {
      try { ctx.state.resultModalInstance.hide(); } catch (e) {}
      setTimeout(() => { window.location.hash = '#/admin/sesi-absen'; }, 300);
    };
  }
}

// ============================================================
//   SIGNATURE MODAL + ABSEN
// ============================================================
function showSignatureModalAndAbsen(pesertaId, nama) {
  // Cleanup old modal
  const oldModal = getEl('adminSignatureModal');
  if (oldModal) {
    try { oldModal.remove(); }
    catch (e) { /* silent */ }
  }

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
              <button type="button" class="btn btn-outline-secondary btn-sm" id="clearAdminSign">
                <i class="bi bi-eraser me-1" aria-hidden="true"></i>Hapus
              </button>
              <button type="button" class="btn btn-outline-primary btn-sm" id="undoAdminSign">
                <i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>Undo
              </button>
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

  ctx.state.dynamicSignatureModalEl = getEl('adminSignatureModal');
  if (!ctx.state.dynamicSignatureModalEl) return;

  ctx.state.signatureModalInstance = bootstrap.Modal.getOrCreateInstance(ctx.state.dynamicSignatureModalEl);
  ctx.state.signatureModalInstance.show();

  const canvas = getEl('adminSignatureCanvas');
  if (!canvas) return;

  if (typeof SignaturePad === 'undefined') {
    showToast('Signature Pad tidak tersedia.', 'error');
    return;
  }

  let sigPad = null;

  const initCanvas = () => {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.parentElement.getBoundingClientRect();
    const w = Math.max(rect.width, 260);
    const h = 150;
    canvas.width = w * ratio;
    canvas.height = h * ratio;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const c = canvas.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.scale(ratio, ratio);
  };

  initCanvas();

  sigPad = new SignaturePad(canvas, {
    backgroundColor: 'rgb(255,255,255)',
    penColor: '#0f172a',
    minWidth: 1.5,
    maxWidth: 3,
  });

  // Resize handler — tracked for cleanup
  let resizeTimer = null;
  ctx.state.resizeListener = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!sigPad) return;
      const data = sigPad.toData();
      initCanvas();
      sigPad.clear();
      if (data.length) sigPad.fromData(data);
    }, 200);
  };
  window.addEventListener('resize', ctx.state.resizeListener);

  // Modal hide — cleanup
  ctx.state.dynamicSignatureModalEl.addEventListener('hidden.bs.modal', () => {
    if (ctx.state.resizeListener) {
      window.removeEventListener('resize', ctx.state.resizeListener);
      ctx.state.resizeListener = null;
    }
    clearTimeout(resizeTimer);
    try { sigPad?.off?.(); }
    catch (e) { /* silent */ }
    sigPad = null;
    try { ctx.state.dynamicSignatureModalEl?.remove(); }
    catch (e) { /* silent */ }
    ctx.state.dynamicSignatureModalEl = null;
    ctx.state.signatureModalInstance = null;
  }, { once: true });

  // Clear/Undo handlers — element scoped, auto-GC
  getEl('clearAdminSign')?.addEventListener('click', () => sigPad?.clear());
  getEl('undoAdminSign')?.addEventListener('click', () => {
    const data = sigPad?.toData();
    if (data && data.length > 0) {
      data.pop();
      sigPad.fromData(data);
    }
  });

  // Submit handler
  getEl('adminSubmitAbsen')?.addEventListener('click', async function () {
    if (ctx.state.isSubmittingAbsen) return;

    if (!sigPad || sigPad.isEmpty()) {
      showToast('Tanda tangan wajib diisi!', 'warning');
      return;
    }

    const btn = this;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Mengirim...';
    ctx.state.isSubmittingAbsen = true;

    try {
      let selectedSesiId = null;

      if (ctx.state.currentScanMode === 'otomatis') {
        const allSesi = AdminModule.getSesiList() || [];
        const now = new Date();
        const activeSesi = allSesi.filter(s => {
          const open = String(s.submission_open).toLowerCase() === 'true' || s.submission_open === true;
          if (!open) return false;
          if (!s.waktu_mulai || !s.waktu_selesai) return true;
          const start = new Date(s.waktu_mulai);
          const end = new Date(s.waktu_selesai);
          return now >= start && now <= end;
        });

        if (activeSesi.length === 0) {
          // FIX BUG-006: Fallback ke sesi terbuka pertama
          const allOpenSesi = allSesi.filter(s =>
            String(s.submission_open).toLowerCase() === 'true' || s.submission_open === true
          );

          if (allOpenSesi.length === 0) {
            showToast('Tidak ada sesi terbuka. Buka sesi dulu di menu Sesi Absen.', 'warning');
            throw new Error('Tidak ada sesi terbuka');
          }

          if (allOpenSesi.length === 1) {
            selectedSesiId = allOpenSesi[0].id;
          } else {
            const optionsText = allOpenSesi.map((s, i) => `${i + 1}. ${s.nama}`).join('\n');
            const choice = prompt(
              'Tidak ada sesi aktif saat ini. Pilih nomor sesi terbuka:\n\n' +
              optionsText + '\n\nMasukkan nomor (1-' + allOpenSesi.length + '):'
            );
            const idx = parseInt(choice);
            if (isNaN(idx) || idx < 1 || idx > allOpenSesi.length) {
              throw new Error('Pilihan sesi tidak valid');
            }
            selectedSesiId = allOpenSesi[idx - 1].id;
          }
        } else {
          selectedSesiId = activeSesi[0].id;
        }
      } else if (ctx.state.currentScanMode === 'manual') {
        const manualSelect = getEl('manualSessionSelect');
        if (!manualSelect || !manualSelect.value) {
          throw new Error('Pilih sesi manual terlebih dahulu');
        }
        selectedSesiId = manualSelect.value;
      }

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
        try { ctx.state.signatureModalInstance?.hide(); }
        catch (e) { /* silent */ }
        // Auto-sync akan re-render dashboard
        await AdminModule.loadAllData(true);
      } else {
        throw new Error((result && result.error) || 'Gagal submit absen');
      }
    } catch (err) {
      const msg = err.message || 'Terjadi kesalahan';
      if (msg.includes('Sudah absen')) {
        showToast('⚠️ Peserta sudah absen di sesi ini.', 'warning');
      } else if (msg.includes('Pilihan sesi tidak valid')) {
        showToast('Pilihan sesi tidak valid.', 'warning');
      } else {
        showToast('❌ ' + msg, 'error');
      }
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      ctx.state.isSubmittingAbsen = false;
    }
  });
}

// ============================================================
//   UTILITY
// ============================================================
function updateCacheStatus(status) {
  setCacheStatus(status);
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

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Dashboard View v27.1.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
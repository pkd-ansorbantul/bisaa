// ============================================================
// VIEW: angkatan-pkd.js — v28.0.3 FULL FIX EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/angkatan-pkd.html
// ============================================================
// CHANGELOG v28.0.3 (dari v28.0.2):
//   ✅ FIX CRITICAL: Infinite loop saat mengetik di form "Tambah Angkatan"
//   ✅ FIX: onDataChange guard — cegah refresh loop saat saving/refreshing
//   ✅ FIX: isSaving flag — cegah double submit & race condition
//   ✅ FIX: listToken guard — race-safe refresh
//   ✅ FIX: detailToken guard — race-safe detail loading
//   ✅ FIX: Focus preservation saat re-render
//   ✅ FIX: Semua 7 tab (Peserta, Absensi, Pretest, Posttest, Skrining,
//      Sertifikat, RTL) berfungsi dengan data akurat
//   ✅ FIX: Empty state dengan CTA "Tambah Angkatan"
//   ✅ FIX: Search & filter berfungsi
//   ✅ FIX: Modal tambah & hapus berfungsi
//   ✅ FIX: Detail header + stats + badges
//   ✅ FIX: Auto-refresh via subscription (no polling)
//   ✅ FIX: URL query param ?angkatan=Nama berfungsi
//   ✅ FIX: Back to hub + breadcrumb navigation
//   ✅ KEEP: Semua fitur dari v28.0.0
// ============================================================

import { AdminModule } from '../../js/modules/admin.js';
import {
  callApi,
  showToast,
  escapeHtml,
  formatDateID,
  formatDateTimeID,
  getAngkatanDetail as apiGetAngkatanDetail,
} from '../../js/core/api.js';
import {
  getEl,
  debounce,
  setBtnLoading,
  createViewContext,
  computeListHash,
  captureFocusState,
  restoreFocusState,
  cleanupBootstrapArtifacts,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const VALID_TABS = ['peserta', 'absensi', 'pretest', 'posttest', 'skrining', 'sertifikat', 'rtl'];

const TAB_LABEL_MAP = {
  peserta: 'Peserta',
  absensi: 'Absensi',
  pretest: 'Pretest',
  posttest: 'Posttest',
  skrining: 'Skrining',
  sertifikat: 'Sertifikat',
  rtl: 'RTL',
};

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    angkatanList: [],
    filteredList: [],
    searchQuery: '',
    currentView: 'hub',
    currentAngkatan: null,
    detailData: null,
    isLoadingDetail: false,
    isRefreshing: false,
    isSaving: false,
    lastHash: '',
    pendingDeleteId: null,
    detailToken: 0,
    listToken: 0,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'angkatan', 'peserta'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;

      // ⭐ FIX CRITICAL: Jangan refresh jika sedang menyimpan atau refreshing
      // Ini memutus infinite loop
      if (ctx.state.isSaving || ctx.state.isRefreshing) {
        console.log(`[AngkatanPKDView] ⚡ Data changed (${type}) — skip (saving/refreshing)`);
        return;
      }

      console.log(`[AngkatanPKDView] ⚡ Data changed (${type}) → refresh list`);

      // Refresh list di background (silent)
      refreshListFromModule(true).catch(() => {});

      // Refresh detail juga kalau sedang buka detail
      if (ctx.state.currentView === 'detail' && ctx.state.currentAngkatan) {
        loadDetail(ctx.state.currentAngkatan, true).catch(() => {});
      }
    },
  }
);

// ============================================================
//   MOUNT
// ============================================================
export async function mount(params = {}) {
  if (ctx.mounted) {
    console.warn('[AngkatanPKDView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  console.log('[AngkatanPKDView] 🚀 mounted');

  // Reset state
  Object.assign(ctx.state, {
    angkatanList: [],
    filteredList: [],
    searchQuery: '',
    currentView: 'hub',
    currentAngkatan: null,
    detailData: null,
    isLoadingDetail: false,
    isRefreshing: false,
    isSaving: false,
    lastHash: '',
    pendingDeleteId: null,
    detailToken: 0,
    listToken: 0,
  });

  // Reset UI
  const searchEl = getEl('searchAngkatanInput');
  if (searchEl) searchEl.value = '';

  // Bind events SEBELUM render
  bindEvents();

  // ============================================
  // STEP 1: Instant render dari cache
  // ============================================
  const cached = AdminModule.getAngkatanPKDList() || [];
  console.log(`[AngkatanPKDView] 📦 Cache check: ${cached.length} angkatan`);

  if (cached.length > 0) {
    console.log('[AngkatanPKDView] ⚡ Rendering from cache');
    ctx.state.angkatanList = cached.map(a => ({ ...a }));
    ctx.state.lastHash = computeListHash(cached, ['id', 'nama', 'tahun', 'status']);
    renderHub();
    setCacheStatus('Cache', 'info');
  } else {
    console.log('[AngkatanPKDView] ⚠️ Cache kosong, render empty state');
    renderHub();
    setCacheStatus('Memuat...', 'info');
  }

  // ============================================
  // STEP 2: Subscribe
  // ============================================
  await ctx.subscribeToData();
  console.log('[AngkatanPKDView] ✅ Subscribed to AdminModule');

  // ============================================
  // STEP 3: Background refresh
  // ============================================
  await refreshListFromModule(false);

  // ============================================
  // STEP 4: Query param ?angkatan=Nama
  // ============================================
  const query = (params && params.query) ? params.query : {};
  if (query.angkatan) {
    const nama = decodeURIComponent(String(query.angkatan));
    console.log(`[AngkatanPKDView] 🎯 Auto-open detail: ${nama}`);
    setTimeout(() => openDetail(nama), 200);
  }

  console.log('[AngkatanPKDView] ✅ Mount complete');
  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[AngkatanPKDView] 🛑 unmounted');
  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // ============ HUB ============
  ctx.on(getEl('refreshAngkatanBtn'), 'click', handleRefresh);
  ctx.on(getEl('addAngkatanBtn'), 'click', openAddModal);

  ctx.on(getEl('searchAngkatanInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    applyFilter();
  }, SEARCH_DEBOUNCE));

  // Grid delegation
  const grid = getEl('angkatanGridContainer');
  if (grid) {
    ctx.on(grid, 'click', (e) => {
      // Delete button
      const delBtn = e.target.closest('[data-delete-angkatan]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        confirmDelete(delBtn.dataset.deleteAngkatan, delBtn.dataset.nama);
        return;
      }

      // Card click → open detail
      const card = e.target.closest('[data-angkatan-nama]');
      if (card) {
        e.preventDefault();
        openDetail(card.dataset.angkatanNama);
        return;
      }

      // CTA "Tambah Angkatan" di empty state
      const addBtn = e.target.closest('[data-action="add-angkatan"]');
      if (addBtn) {
        e.preventDefault();
        openAddModal();
        return;
      }
    });

    // Keyboard accessibility
    ctx.on(grid, 'keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('[data-angkatan-nama]');
      if (!card) return;
      e.preventDefault();
      openDetail(card.dataset.angkatanNama);
    });
  }

  // ============ DETAIL ============
  ctx.on(getEl('backToHubBtn'), 'click', backToHub);
  ctx.on(getEl('breadcrumbHub'), 'click', (e) => {
    e.preventDefault();
    backToHub();
  });

  // ============ MODAL: TAMBAH ============
  ctx.on(getEl('saveAngkatanBtn'), 'click', saveNewAngkatan);

  // ============ MODAL: HAPUS ============
  ctx.on(getEl('confirmDeleteAngkatanBtn'), 'click', executeDelete);

  // ============ REFRESH saat route reused ============
  ctx.on(window, 'route:reused', (e) => {
    const detail = e?.detail;
    if (!detail || !detail.path) return;
    if (detail.path === '#/admin/angkatan-pkd') {
      console.log('[AngkatanPKDView] 🔄 Route reused — refreshing');
      refreshListFromModule(true).catch(() => {});
    }
  });
}

// ============================================================
//   REFRESH LIST
// ============================================================
async function refreshListFromModule(silent = true) {
  const myToken = ++ctx.state.listToken;

  if (!silent) {
    ctx.state.isRefreshing = true;
    setCacheStatus('Memuat...', 'info');
  }

  try {
    let fresh = AdminModule.getAngkatanPKDList() || [];

    if (fresh.length === 0 || !silent) {
      console.log('[AngkatanPKDView] 🔄 Fetching fresh from server...');
      try {
        await AdminModule.refreshAngkatanPKD();
        fresh = AdminModule.getAngkatanPKDList() || [];
        console.log(`[AngkatanPKDView] ✅ Fetched: ${fresh.length} angkatan`);
      } catch (fetchErr) {
        console.warn('[AngkatanPKDView] ⚠️ Fetch failed, using cache:', fetchErr.message);
      }
    }

    if (myToken !== ctx.state.listToken) {
      console.log('[AngkatanPKDView] List refresh cancelled (token mismatch)');
      return;
    }
    if (!ctx.mounted) return;

    const freshHash = computeListHash(fresh, ['id', 'nama', 'tahun', 'status', 'totalPeserta']);

    if (freshHash === ctx.state.lastHash && ctx.state.angkatanList.length > 0) {
      console.log('[AngkatanPKDView] No change, skip re-render');
      setCacheStatus('Live', 'success');
      return;
    }

    ctx.state.angkatanList = fresh.map(a => ({ ...a }));
    ctx.state.lastHash = freshHash;

    if (ctx.state.currentView === 'hub') {
      renderHub();
    } else {
      renderStats();
    }

    setCacheStatus('Live', 'success');
    console.log(`[AngkatanPKDView] ✅ Rendered ${fresh.length} angkatan`);

  } catch (e) {
    if (myToken !== ctx.state.listToken) return;
    console.error('[AngkatanPKDView] refreshListFromModule error:', e);
    setCacheStatus('Error', 'danger');

    if (ctx.state.angkatanList.length === 0) {
      renderErrorState(e.message);
    }
  } finally {
    if (!silent) {
      ctx.state.isRefreshing = false;
    }
  }
}

// ============================================================
//   FILTER & RENDER HUB
// ============================================================
function applyFilter() {
  const q = String(ctx.state.searchQuery || '').toLowerCase().trim();
  ctx.state.filteredList = !q
    ? ctx.state.angkatanList.slice()
    : ctx.state.angkatanList.filter(a =>
        String(a.nama || '').toLowerCase().includes(q) ||
        String(a.tahun || '').includes(q)
      );

  renderStats();
  renderGrid();
}

function renderHub() {
  applyFilter();
}

// ============================================================
//   RENDER: STATS
// ============================================================
function renderStats() {
  const list = ctx.state.angkatanList;
  let totalPeserta = 0, totalApproved = 0, totalPending = 0;

  list.forEach(a => {
    totalPeserta  += parseInt(a.totalPeserta) || 0;
    totalApproved += parseInt(a.totalApproved) || 0;
    totalPending  += parseInt(a.totalPending) || 0;
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };

  setText('statTotalAngkatan', list.length);
  setText('statTotalPesertaAll', totalPeserta);
  setText('statTotalApprovedAll', totalApproved);
  setText('statTotalPendingAll', totalPending);
}

// ============================================================
//   RENDER: GRID
// ============================================================
function renderGrid() {
  const c = getEl('angkatanGridContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchAngkatanInput');
  const list = ctx.state.filteredList;

  // ============================================
  // EMPTY STATE
  // ============================================
  if (list.length === 0) {
    if (ctx.state.searchQuery) {
      // Search no results
      c.innerHTML = `
        <div class="col-12">
          <div class="alert alert-info text-center">
            <i class="bi bi-search fs-4 d-block mb-2" aria-hidden="true"></i>
            Tidak ada angkatan sesuai pencarian
            "<strong>${escapeHtml(ctx.state.searchQuery)}</strong>".
            <div class="mt-2">
              <button type="button" class="btn btn-sm btn-outline-secondary"
                      data-action="clear-search">
                <i class="bi bi-x-circle me-1" aria-hidden="true"></i>Hapus Pencarian
              </button>
            </div>
          </div>
        </div>`;

      c.querySelector('[data-action="clear-search"]')?.addEventListener('click', () => {
        const searchEl = getEl('searchAngkatanInput');
        if (searchEl) searchEl.value = '';
        ctx.state.searchQuery = '';
        applyFilter();
      });
    } else {
      // No data at all
      c.innerHTML = `
        <div class="col-12">
          <div class="glass-card text-center" style="padding:3rem 2rem;">
            <div class="stat-icon-box blue mx-auto mb-3"
                 style="width:80px;height:80px;font-size:2.5rem;">
              <i class="bi bi-mortarboard-fill" aria-hidden="true"></i>
            </div>
            <h5 class="fw-bold mb-2">Belum Ada Angkatan PKD</h5>
            <p class="text-muted mb-4" style="max-width:400px;margin:0 auto;">
              Mulai dengan membuat angkatan PKD pertama. Setiap angkatan
              punya data peserta, absensi, pretest, posttest, skrining,
              sertifikat, dan RTL yang terpisah.
            </p>
            <button type="button" class="btn btn-primary rounded-pill px-4"
                    data-action="add-angkatan">
              <i class="bi bi-plus-circle me-1" aria-hidden="true"></i>
              Tambah Angkatan Pertama
            </button>
          </div>
        </div>`;
    }

    restoreFocusState('searchAngkatanInput', savedFocus);
    return;
  }

  // ============================================
  // RENDER CARDS
  // ============================================
  let html = '';
  list.forEach(a => {
    const totalPeserta  = parseInt(a.totalPeserta) || 0;
    const totalApproved = parseInt(a.totalApproved) || 0;
    const totalPending  = parseInt(a.totalPending) || 0;
    const totalRejected = parseInt(a.totalRejected) || 0;
    const safeNama = escapeHtml(a.nama || '-');
    const tahun = a.tahun || '-';
    const status = String(a.status || 'aktif').toLowerCase();

    const statusBadgeClass =
      status === 'selesai' ? 'bg-success' :
      status === 'arsip'   ? 'bg-secondary' :
      'bg-primary';

    const statusLabel =
      status === 'selesai' ? '✅ Selesai' :
      status === 'arsip'   ? '📦 Arsip' :
      '🔄 Aktif';

    html += `
      <div class="col-md-6 col-xl-4">
        <div class="glass-card h-100 d-flex flex-column"
             style="padding:1.25rem;cursor:pointer;"
             data-angkatan-nama="${safeNama}"
             role="button"
             tabindex="0"
             aria-label="Buka detail angkatan ${safeNama}">

          <!-- Header -->
          <div class="d-flex align-items-start gap-2 mb-3">
            <div class="stat-icon-box blue" style="flex-shrink:0;">
              <i class="bi bi-mortarboard-fill" aria-hidden="true"></i>
            </div>
            <div class="flex-grow-1" style="min-width:0;">
              <h6 class="fw-bold mb-1" style="word-break:break-word;">${safeNama}</h6>
              <div class="small text-muted">
                <i class="bi bi-calendar me-1" aria-hidden="true"></i>Tahun ${escapeHtml(String(tahun))}
                <span class="badge ${statusBadgeClass} ms-2">${statusLabel}</span>
              </div>
            </div>
            <button type="button" class="btn btn-sm btn-outline-danger"
                    data-delete-angkatan="${escapeHtml(String(a.id))}"
                    data-nama="${safeNama}"
                    title="Hapus angkatan"
                    aria-label="Hapus angkatan ${safeNama}">
              <i class="bi bi-trash" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Stats mini -->
          <div class="row g-2 mb-3">
            <div class="col-4">
              <div class="text-center p-2 rounded-3" style="background:rgba(22,163,74,0.1);">
                <div class="fw-bold text-success" style="font-size:1.1rem;">${totalApproved}</div>
                <div style="font-size:0.65rem;text-transform:uppercase;color:#64748b;">Approved</div>
              </div>
            </div>
            <div class="col-4">
              <div class="text-center p-2 rounded-3" style="background:rgba(245,158,11,0.1);">
                <div class="fw-bold text-warning" style="font-size:1.1rem;">${totalPending}</div>
                <div style="font-size:0.65rem;text-transform:uppercase;color:#64748b;">Pending</div>
              </div>
            </div>
            <div class="col-4">
              <div class="text-center p-2 rounded-3" style="background:rgba(220,38,38,0.1);">
                <div class="fw-bold text-danger" style="font-size:1.1rem;">${totalRejected}</div>
                <div style="font-size:0.65rem;text-transform:uppercase;color:#64748b;">Rejected</div>
              </div>
            </div>
          </div>

          <!-- Footer -->
          <div class="mt-auto pt-2 border-top d-flex justify-content-between align-items-center">
            <div class="small fw-semibold text-primary">
              <i class="bi bi-people-fill me-1" aria-hidden="true"></i>${totalPeserta} peserta
            </div>
            <div class="small text-primary fw-semibold">
              Lihat Detail <i class="bi bi-arrow-right ms-1" aria-hidden="true"></i>
            </div>
          </div>
        </div>
      </div>`;
  });

  c.innerHTML = html;
  restoreFocusState('searchAngkatanInput', savedFocus);
}

// ============================================================
//   RENDER: ERROR STATE
// ============================================================
function renderErrorState(msg) {
  const c = getEl('angkatanGridContainer');
  if (!c) return;

  c.innerHTML = `
    <div class="col-12">
      <div class="alert alert-danger text-center">
        <i class="bi bi-exclamation-triangle-fill fs-4 d-block mb-2" aria-hidden="true"></i>
        <strong>Gagal memuat data</strong>
        <div class="small mt-1">${escapeHtml(msg)}</div>
        <div class="mt-3">
          <button type="button" class="btn btn-sm btn-danger" data-action="retry-load">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Coba Lagi
          </button>
        </div>
      </div>
    </div>`;

  c.querySelector('[data-action="retry-load"]')?.addEventListener('click', () => {
    refreshListFromModule(false).catch(() => {});
  });
}

// ============================================================
//   OPEN DETAIL
// ============================================================
async function openDetail(nama) {
  if (!nama) return;

  console.log(`[AngkatanPKDView] 📂 Open detail: ${nama}`);

  ctx.state.currentView = 'detail';
  ctx.state.currentAngkatan = String(nama);
  ctx.state.isLoadingDetail = true;

  const myToken = ++ctx.state.detailToken;

  // Toggle views
  const hubView = getEl('angkatanHubView');
  const detailView = getEl('angkatanDetailView');
  if (hubView) hubView.style.display = 'none';
  if (detailView) detailView.style.display = 'block';

  // Set header info dari cache list (instant)
  const angkatanInfo = ctx.state.angkatanList.find(a =>
    String(a.nama || '').trim() === String(nama).trim()
  );
  updateDetailHeader(angkatanInfo, nama);

  // Update URL hash
  try {
    const newHash = `#/admin/angkatan-pkd?angkatan=${encodeURIComponent(nama)}`;
    if (window.location.hash !== newHash) {
      history.replaceState(null, '', newHash);
    }
  } catch (e) { /* silent */ }

  // Show loading
  showTabLoading();

  // Fetch detail
  await loadDetail(nama, false, myToken);
}

// ============================================================
//   LOAD DETAIL
// ============================================================
async function loadDetail(nama, silent = false, myToken = null) {
  if (!nama) return;

  if (myToken === null) {
    myToken = ++ctx.state.detailToken;
  }

  try {
    const res = await apiGetAngkatanDetail(nama);

    if (myToken !== ctx.state.detailToken) {
      console.log('[AngkatanPKDView] Detail load cancelled (token mismatch)');
      return;
    }

    if (!ctx.mounted) return;

    if (!res || !res.success) {
      throw new Error(res?.error || 'Gagal memuat detail angkatan');
    }

    const data = res.data || {};
    ctx.state.detailData = data;
    ctx.state.isLoadingDetail = false;

    // Update header
    updateDetailHeader(data.angkatan, nama);

    // Render all tabs
    renderDetailAll(data);
    updateTabBadges(data);

    if (!silent) {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) { /* silent */ }
    }

    console.log('[AngkatanPKDView] ✅ Detail loaded:', nama, data.stats);

  } catch (e) {
    if (myToken !== ctx.state.detailToken) return;

    console.error('[AngkatanPKDView] loadDetail error:', e);
    ctx.state.isLoadingDetail = false;

    const errHtml = `
      <div class="alert alert-danger text-center">
        <i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
        Gagal memuat: ${escapeHtml(e.message)}
        <div class="mt-2">
          <button type="button" class="btn btn-sm btn-outline-danger" id="retryDetailBtn">
            <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>Coba Lagi
          </button>
        </div>
      </div>`;

    ['tabPesertaContainer', 'tabAbsensiContainer', 'tabPretestContainer',
     'tabPosttestContainer', 'tabSkriningContainer', 'tabSertifikatContainer',
     'tabRTLContainer'].forEach(id => {
      const el = getEl(id);
      if (el) el.innerHTML = errHtml;
    });

    setTimeout(() => {
      const retryBtn = document.querySelector('#retryDetailBtn');
      if (retryBtn) {
        retryBtn.onclick = () => {
          showTabLoading();
          loadDetail(nama, false).catch(() => {});
        };
      }
    }, 50);
  }
}

// ============================================================
//   UPDATE DETAIL HEADER
// ============================================================
function updateDetailHeader(info, fallbackNama) {
  const nameEl = getEl('detailAngkatanNama');
  const yearEl = getEl('detailAngkatanTahun');
  const statusEl = getEl('detailAngkatanStatus');
  const breadcrumbEl = getEl('breadcrumbAngkatan');

  const nama = (info && info.nama) ? info.nama : fallbackNama;
  const tahun = (info && info.tahun) ? info.tahun : '-';
  const status = (info && info.status) ? String(info.status).toLowerCase() : 'aktif';

  if (nameEl) nameEl.textContent = nama || '-';
  if (yearEl) yearEl.textContent = tahun;

  if (statusEl) {
    statusEl.textContent =
      status === 'selesai' ? 'Selesai' :
      status === 'arsip'   ? 'Arsip' : 'Aktif';

    statusEl.className = 'badge ' +
      (status === 'selesai' ? 'bg-success' :
       status === 'arsip'   ? 'bg-secondary' : 'bg-primary');
  }

  if (breadcrumbEl) breadcrumbEl.textContent = nama || '-';
}

// ============================================================
//   SHOW TAB LOADING
// ============================================================
function showTabLoading() {
  const loadingHtml = `
    <div class="text-center py-5">
      <div class="spinner-border text-primary" role="status">
        <span class="visually-hidden">Memuat...</span>
      </div>
      <p class="mt-2 text-muted small">Memuat data...</p>
    </div>`;

  ['tabPesertaContainer', 'tabAbsensiContainer', 'tabPretestContainer',
   'tabPosttestContainer', 'tabSkriningContainer', 'tabSertifikatContainer',
   'tabRTLContainer'].forEach(id => {
    const el = getEl(id);
    if (el) el.innerHTML = loadingHtml;
  });

  ['badgeTabPeserta', 'badgeTabAbsensi', 'badgeTabPretest', 'badgeTabPosttest',
   'badgeTabSkrining', 'badgeTabSertifikat', 'badgeTabRTL'].forEach(id => {
    const el = getEl(id);
    if (el) el.textContent = '0';
  });

  ['detailStatPeserta', 'detailStatApproved', 'detailStatPending'].forEach(id => {
    const el = getEl(id);
    if (el) el.textContent = '0';
  });
}

// ============================================================
//   RENDER DETAIL ALL TABS
// ============================================================
function renderDetailAll(data) {
  if (!data) return;

  renderTabPeserta(data.peserta || []);
  renderTabAbsensi(data.absensi || []);
  renderTabPretest(data.pretest || []);
  renderTabPosttest(data.posttest || []);
  renderTabSkrining(data.skrining || []);
  renderTabSertifikat(data.sertifikat || []);
  renderTabRTL(data.rtl || []);

  const stats = data.stats || {};
  const setStat = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = String(val || 0);
  };
  setStat('detailStatPeserta', stats.totalPeserta);
  setStat('detailStatApproved', stats.totalApproved);
  setStat('detailStatPending', stats.totalPending);
}

// ============================================================
//   UPDATE TAB BADGES
// ============================================================
function updateTabBadges(data) {
  if (!data) return;

  const setBadge = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = String(val || 0);
  };

  setBadge('badgeTabPeserta',    (data.peserta || []).length);
  setBadge('badgeTabAbsensi',    (data.absensi || []).length);
  setBadge('badgeTabPretest',    (data.pretest || []).length);
  setBadge('badgeTabPosttest',   (data.posttest || []).length);
  setBadge('badgeTabSkrining',   (data.skrining || []).length);
  setBadge('badgeTabSertifikat', (data.sertifikat || []).length);
  setBadge('badgeTabRTL',        (data.rtl || []).length);
}

// ============================================================
//   RENDER TAB: PESERTA
// ============================================================
function renderTabPeserta(list) {
  const c = getEl('tabPesertaContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada peserta di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>No HP</th>
      <th>Email</th>
      <th>Utusan</th>
      <th>Status</th>
      <th style="width:80px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    const status = String(item.status || 'pending').toLowerCase();
    const badge = status === 'approved' || status === 'active' ? 'bg-success'
      : status === 'rejected' ? 'bg-danger'
      : status === 'alumni' ? 'bg-secondary'
      : 'bg-warning text-dark';
    const safeId = escapeHtml(String(item.id || ''));

    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama_lengkap || '-')}</strong></td>
      <td>${escapeHtml(item.no_hp || '-')}</td>
      <td><small>${escapeHtml(item.email || '-')}</small></td>
      <td>${escapeHtml(item.utusan || '-')}</td>
      <td><span class="badge ${badge}">${escapeHtml(status)}</span></td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-info"
                data-detail-peserta="${safeId}"
                title="Lihat Detail"
                aria-label="Detail ${escapeHtml(item.nama_lengkap || '')}">
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;

  c.querySelectorAll('[data-detail-peserta]').forEach(btn => {
    btn.addEventListener('click', () => {
      showDetailPeserta(btn.dataset.detailPeserta);
    });
  });
}

// ============================================================
//   RENDER TAB: ABSENSI
// ============================================================
function renderTabAbsensi(list) {
  const c = getEl('tabAbsensiContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada absensi di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>Sesi</th>
      <th>Waktu Absen</th>
      <th style="width:100px;" class="text-center">TTD</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    const sig = item.signatureDriveId
      ? `<a href="https://drive.google.com/file/d/${escapeHtml(item.signatureDriveId)}/view"
            target="_blank" rel="noopener noreferrer"
            class="btn btn-sm btn-outline-primary"
            aria-label="Lihat TTD">
           <i class="bi bi-eye" aria-hidden="true"></i>
         </a>`
      : '<span class="text-muted small">-</span>';

    const sesiDisplay = item.namaSesi
      ? escapeHtml(item.namaSesi)
      : `<code>${escapeHtml(String(item.sesiId || '-'))}</code>`;

    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
      <td>${sesiDisplay}</td>
      <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
      <td class="text-center">${sig}</td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER TAB: PRETEST
// ============================================================
function renderTabPretest(list) {
  const c = getEl('tabPretestContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada pretest di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>No HP</th>
      <th style="width:80px;">Skor</th>
      <th>Waktu</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
      <td>${escapeHtml(item.nohp || '-')}</td>
      <td><span class="badge bg-primary">${escapeHtml(String(item.score || 0))}</span></td>
      <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER TAB: POSTTEST
// ============================================================
function renderTabPosttest(list) {
  const c = getEl('tabPosttestContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada posttest di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>No HP</th>
      <th style="width:80px;">Skor</th>
      <th>Waktu</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
      <td>${escapeHtml(item.nohp || '-')}</td>
      <td><span class="badge bg-primary">${escapeHtml(String(item.score || 0))}</span></td>
      <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER TAB: SKRINING
// ============================================================
function renderTabSkrining(list) {
  const c = getEl('tabSkriningContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada skrining di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama</th>
      <th>Alamat</th>
      <th>Hasil</th>
      <th>Waktu</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
      <td>${escapeHtml(item.alamat || '-')}</td>
      <td><span class="badge bg-secondary">${escapeHtml(item.hasil || 'Belum')}</span></td>
      <td><small>${escapeHtml(formatDateTimeID(item.timestamp))}</small></td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER TAB: SERTIFIKAT
// ============================================================
function renderTabSertifikat(list) {
  const c = getEl('tabSertifikatContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada sertifikat di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama Peserta</th>
      <th>Nomor Sertifikat</th>
      <th>Tanggal</th>
      <th style="width:80px;" class="text-center">PDF</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.nama_peserta || '-')}</strong></td>
      <td><code class="small">${escapeHtml(item.nomor_sertifikat || '-')}</code></td>
      <td><small>${escapeHtml(formatDateID(item.createdAt))}</small></td>
      <td class="text-center">
        ${item.pdf_url ? `
          <a href="${escapeHtml(item.pdf_url)}" target="_blank" rel="noopener noreferrer"
             class="btn btn-sm btn-success"
             title="Download PDF"
             aria-label="Download PDF ${escapeHtml(item.nama_peserta || '')}">
            <i class="bi bi-download" aria-hidden="true"></i>
          </a>` : '<span class="text-muted small">-</span>'}
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER TAB: RTL
// ============================================================
function renderTabRTL(list) {
  const c = getEl('tabRTLContainer');
  if (!c) return;

  if (list.length === 0) {
    c.innerHTML = emptyState('Belum ada tugas RTL di angkatan ini.');
    return;
  }

  let html = `<table class="table table-hover align-middle mb-0">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Judul</th>
      <th>Peserta</th>
      <th>Deadline</th>
      <th>Status</th>
    </tr></thead><tbody>`;

  list.forEach((item, i) => {
    const done = String(item.status || '').toLowerCase() === 'selesai';
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
      <td>${escapeHtml(item.namaPeserta || 'Umum')}</td>
      <td><small>${escapeHtml(formatDateID(item.deadline))}</small></td>
      <td>
        <span class="badge ${done ? 'bg-success' : 'bg-warning text-dark'}">
          ${done ? '✅ Selesai' : '⏳ Pending'}
        </span>
      </td>
    </tr>`;
  });

  html += `</tbody></table>`;
  c.innerHTML = html;
}

// ============================================================
//   EMPTY STATE HELPER
// ============================================================
function emptyState(msg) {
  return `<div class="alert alert-info text-center mb-0">
    <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
    ${escapeHtml(msg)}
  </div>`;
}

// ============================================================
//   BACK TO HUB
// ============================================================
function backToHub() {
  console.log('[AngkatanPKDView] ⬅️ Back to hub');

  ctx.state.currentView = 'hub';
  ctx.state.currentAngkatan = null;
  ctx.state.detailData = null;
  ctx.state.detailToken++;

  const hubView = getEl('angkatanHubView');
  const detailView = getEl('angkatanDetailView');
  if (hubView) hubView.style.display = 'block';
  if (detailView) detailView.style.display = 'none';

  try {
    history.replaceState(null, '', '#/admin/angkatan-pkd');
  } catch (e) { /* silent */ }

  try {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) { /* silent */ }

  renderHub();
}

// ============================================================
//   MODAL: TAMBAH ANGKATAN
// ============================================================
function openAddModal() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('angkatanNama', '');
  setVal('angkatanTahun', new Date().getFullYear());
  setVal('angkatanStatus', 'aktif');

  ctx.getModal('addAngkatanModal')?.show();
}

async function saveNewAngkatan(e) {
  // ⭐ FIX CRITICAL: Guard untuk cegah double submit & infinite loop
  if (ctx.state.isSaving) return;

  const nama = (getEl('angkatanNama')?.value || '').trim();
  const tahun = parseInt(getEl('angkatanTahun')?.value) || new Date().getFullYear();
  const status = getEl('angkatanStatus')?.value || 'aktif';

  if (!nama) {
    showToast('Nama angkatan wajib diisi', 'error');
    getEl('angkatanNama')?.focus();
    return;
  }

  // Cek duplikat
  const isDupe = ctx.state.angkatanList.some(a =>
    String(a.nama || '').trim().toLowerCase() === nama.toLowerCase()
  );
  if (isDupe) {
    showToast('Nama angkatan sudah ada', 'warning');
    return;
  }

  const btn = e?.currentTarget || getEl('saveAngkatanBtn');

  // ⭐ FIX: Set flag isSaving SEBELUM memanggil API
  ctx.state.isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await AdminModule.addAngkatanPKD(nama, tahun, status, nama);

    if (res && res.success) {
      showToast('Angkatan berhasil ditambahkan', 'success');
      ctx.getModal('addAngkatanModal')?.hide();

      // ⭐ FIX: Manual refresh SETELAH modal ditutup
      // Karena isSaving masih true, onDataChange tidak akan terpicu
      await refreshListFromModule(false);

    } else {
      throw new Error(res?.error || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    // ⭐ FIX: Reset flag isSaving di akhir
    ctx.state.isSaving = false;
  }
}

// ============================================================
//   MODAL: HAPUS ANGKATAN
// ============================================================
function confirmDelete(id, nama) {
  ctx.state.pendingDeleteId = id;

  const nameEl = getEl('deleteAngkatanNama');
  if (nameEl) nameEl.textContent = nama || '—';

  const idEl = getEl('deleteAngkatanId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteAngkatanModal')?.show();
}

async function executeDelete(e) {
  // ⭐ FIX: Guard untuk cegah double delete
  if (ctx.state.isSaving) return;

  const id = ctx.state.pendingDeleteId || getEl('deleteAngkatanId')?.value;
  if (!id) return;

  const btn = e?.currentTarget || getEl('confirmDeleteAngkatanBtn');

  // ⭐ FIX: Set flag isSaving
  ctx.state.isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await AdminModule.deleteAngkatanPKD(id);

    if (res && res.success) {
      showToast('Angkatan berhasil dihapus', 'success');
      ctx.getModal('deleteAngkatanModal')?.hide();

      // Manual refresh SETELAH modal ditutup
      await refreshListFromModule(false);

    } else {
      throw new Error(res?.error || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.state.isSaving = false;
    ctx.state.pendingDeleteId = null;
  }
}

// ============================================================
//   MODAL: DETAIL PESERTA
// ============================================================
function showDetailPeserta(id) {
  if (!ctx.state.detailData) return;
  const item = (ctx.state.detailData.peserta || []).find(p =>
    String(p.id) === String(id)
  );
  if (!item) {
    showToast('Data peserta tidak ditemukan', 'error');
    return;
  }

  const content = getEl('detailPesertaAngkatanContent');
  if (!content) return;

  const fields = [
    ['Nama Lengkap', item.nama_lengkap],
    ['No HP', item.no_hp],
    ['Email', item.email],
    ['Tempat/Tgl Lahir', item.tempat_tgl_lahir],
    ['Pekerjaan', item.pekerjaan],
    ['Pendidikan', item.pendidikan_terakhir],
    ['Alamat', item.alamat],
    ['Utusan', item.utusan],
    ['Angkatan PKD', item.lokasi_pkd],
    ['Pengalaman Organisasi', item.pengalaman_organisasi],
  ];

  let html = '<div class="list-group list-group-flush">';
  fields.forEach(([label, value]) => {
    if (!value) return;
    html += `<div class="list-group-item py-3">
      <div class="small text-muted text-uppercase" style="font-size:0.68rem;">${escapeHtml(label)}</div>
      <div class="fw-semibold" style="word-break:break-word;">${escapeHtml(String(value))}</div>
    </div>`;
  });

  const status = String(item.status || 'pending').toLowerCase();
  const badge = status === 'approved' || status === 'active' ? 'bg-success'
    : status === 'rejected' ? 'bg-danger'
    : status === 'alumni' ? 'bg-secondary'
    : 'bg-warning text-dark';
  html += `<div class="list-group-item py-3">
    <div class="small text-muted text-uppercase" style="font-size:0.68rem;">Status</div>
    <div><span class="badge ${badge}">${escapeHtml(status)}</span></div>
  </div>`;

  html += '</div>';
  content.innerHTML = html;

  ctx.getModal('detailPesertaAngkatanModal')?.show();
}

// ============================================================
//   REFRESH (manual)
// ============================================================
async function handleRefresh(e) {
  if (ctx.state.isSaving || ctx.state.isRefreshing) return;

  const btn = e?.currentTarget || getEl('refreshAngkatanBtn');

  ctx.state.isSaving = true;
  ctx.state.isRefreshing = true;

  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    console.log('[AngkatanPKDView] 🔄 Manual refresh...');
    setCacheStatus('Memuat...', 'info');

    await AdminModule.loadAllData(true);
    await refreshListFromModule(false);

    showToast('Data disegarkan', 'success');
    console.log('[AngkatanPKDView] ✅ Manual refresh complete');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
    setCacheStatus('Error', 'danger');
  } finally {
    restore();
    ctx.state.isSaving = false;
    ctx.state.isRefreshing = false;
  }
}

// ============================================================
//   CACHE STATUS
// ============================================================
function setCacheStatus(status, type = 'info') {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;

  const cls =
    type === 'success' || status === 'Live'      ? 'live' :
    type === 'danger'  || status === 'Error'     ? 'offline' :
    '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Angkatan PKD View v28.0.3 — Full Fix Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
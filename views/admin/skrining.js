// ============================================================
// VIEW: skrining.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/skrining.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 60s
//   ✅ FIX: BUG-002 — Load default dengan backup + rollback
//   ✅ FIX: Progress indicator saat load default
//   ✅ FIX: isSaving guard konsisten di semua async handlers
//   ✅ FIX: Modal dispose otomatis via ctx.cleanup
//   ✅ FIX: isMounted guard di dalam loop loadDefault
//   ✅ FIX: Parallel batch 5 concurrent untuk load default
//   ✅ FIX: Focus preservation saat re-render
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  submitSkrining,
  deleteSkriningResponse,
  deleteSkriningQuestion,
  addSkriningQuestion,
  updateSkriningQuestion,
  getSkriningQuestions,
  formatDateTimeID,
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
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const DEFAULT_QUESTIONS = [
  { teks: 'Nama Lengkap', jenis: 'text', opsi: '', urutan: 1 },
  { teks: 'Alamat', jenis: 'text', opsi: '', urutan: 2 },
  { teks: 'Info rekrutmen (IG/FB/WA/Website/Teman/Saudara/Lainnya)', jenis: 'text', opsi: '', urutan: 3 },
  { teks: 'Pengetahuan tentang Ansor', jenis: 'text', opsi: '', urutan: 4 },
  { teks: 'Doa Qunut?', jenis: 'radio', opsi: 'Ya,Tidak', urutan: 5 },
  { teks: 'Riwayat penyakit', jenis: 'text', opsi: '', urutan: 6 },
  { teks: 'Pernah rekrutmen PKD / diklatsar?', jenis: 'radio', opsi: 'Ya,Tidak', urutan: 7 },
  { teks: 'Alasan tertarik mengikuti PKD', jenis: 'text', opsi: '', urutan: 8 },
  { teks: 'Catatan (opsional)', jenis: 'text', opsi: '', urutan: 9 },
];

const BATCH_SIZE = 5;

// ============================================================
//   LOCAL HELPERS
// ============================================================
function setCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

function getHasilBadge(hasil) {
  if (hasil === 'Layak') return 'bg-success';
  if (hasil === 'Tidak Layak') return 'bg-danger';
  if (hasil === 'Perlu Tindak Lanjut') return 'bg-warning text-dark';
  return 'bg-secondary';
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    skriningList: [],
    filteredList: [],
    questionList: [],
    searchQuery: '',
    hasilFilter: '',
    currentPage: 1,
    itemsPerPage: 15,
    pendingDeleteId: null,
    pendingDeleteRowIndex: null,
    pendingDeleteQuestionId: null,
    lastResponHash: '',
    lastQuestionHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'skrining'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[SkriningView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshResponsesFromCache();
      } catch (e) {
        console.warn('[SkriningView] Re-render error:', e);
      }
    },
  }
);

let responTableCleanup = null;
let questionTableCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[SkriningView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[SkriningView] mounted');

  Object.assign(ctx.state, {
    skriningList: [],
    filteredList: [],
    questionList: [],
    searchQuery: '',
    hasilFilter: '',
    currentPage: 1,
    pendingDeleteId: null,
    pendingDeleteRowIndex: null,
    pendingDeleteQuestionId: null,
    lastResponHash: '',
    lastQuestionHash: '',
  });

  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterHasil');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getSkriningList() || [];
  if (cached.length > 0) {
    console.log('[SkriningView] ⚡ Rendering responses from preload cache');
    ctx.state.skriningList = cached.map(s => ({ ...s }));
    ctx.state.lastResponHash = computeListHash(cached, ['id', 'timestamp', 'nama']);
    applyFiltersAndSort();
    setCacheStatus('Live');
  } else {
    console.log('[SkriningView] ⚠️ No cache, showing skeleton');
    renderSkeletonResponses();
  }
  renderSkeletonQuestions();

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Load questions (tidak di-preload) + fallback responses
  await Promise.allSettled([
    cached.length === 0 ? loadResponses(false) : Promise.resolve(),
    loadQuestions(false),
  ]);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[SkriningView] unmounted');

  if (responTableCleanup) {
    try { responTableCleanup(); } catch (e) { /* silent */ }
    responTableCleanup = null;
  }
  if (questionTableCleanup) {
    try { questionTableCleanup(); } catch (e) { /* silent */ }
    questionTableCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshResponsesFromCache() {
  const fresh = AdminModule.getSkriningList() || [];
  const freshHash = computeListHash(fresh, ['id', 'timestamp', 'nama']);

  if (freshHash === ctx.state.lastResponHash) {
    console.log('[SkriningView] No change, skip re-render');
    return;
  }

  ctx.state.skriningList = fresh.map(s => ({ ...s }));
  ctx.state.lastResponHash = freshHash;
  applyFiltersAndSort();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search + filter
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('filterHasil'), 'change', function (e) {
    ctx.state.hasilFilter = e.target.value;
    ctx.state.currentPage = 1;
    applyFiltersAndSort();
  });

  // Toolbar
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);
  ctx.on(getEl('exportDataBtn'), 'click', exportData);
  ctx.on(getEl('addSkriningBtn'), 'click', openAddModal);
  ctx.on(getEl('saveSkriningBtn'), 'click', saveSkrining);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // Question CRUD
  ctx.on(getEl('addQuestionBtn'), 'click', openAddQuestionModal);
  ctx.on(getEl('saveQuestionBtn'), 'click', saveQuestion);
  ctx.on(getEl('confirmDeleteQuestionBtn'), 'click', executeDeleteQuestion);
  ctx.on(getEl('loadDefaultQuestionsBtn'), 'click', loadDefaultQuestions);

  ctx.on(getEl('questionJenis'), 'change', function () {
    const group = getEl('questionOptionsGroup');
    if (group) group.style.display = this.value === 'radio' ? 'block' : 'none';
  });

  // ✅ DELEGATION — responses table
  const tableContainer = getEl('skriningTableContainer');
  if (tableContainer) {
    responTableCleanup = delegateTableClicks(tableContainer, {
      onSort: null,
      onAction: (action, id) => {
        if (action === 'detail') viewSkrining(id);
        else if (action === 'edit') editSkrining(id);
        else if (action === 'delete') deleteSkrining(id);
      },
      onPage: (page) => goToPage(page),
    });
  }

  // ✅ DELEGATION — questions table
  const qContainer = getEl('questionsTableContainer');
  if (qContainer) {
    questionTableCleanup = delegateTableClicks(qContainer, {
      onAction: (action, id) => {
        if (action === 'edit-q') editQuestion(id);
        else if (action === 'delete-q') deleteQuestion(id);
      },
    });
  }
}

// ============================================================
//   STATS
// ============================================================
function renderStats() {
  const total = ctx.state.skriningList.length;
  const questions = ctx.state.questionList.length;
  const today = getLocalDateOnly(new Date());

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setHours(0, 0, 0, 0);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let todayCount = 0, weekCount = 0;
  ctx.state.skriningList.forEach(item => {
    if (!item.timestamp) return;
    const ts = new Date(item.timestamp);
    if (isNaN(ts.getTime())) return;
    if (getLocalDateOnly(ts) === today) todayCount++;
    if (ts >= sevenDaysAgo) weekCount++;
  });

  const setText = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  setText('statTotal', total);
  setText('statPertanyaan', questions);
  setText('statHariIni', todayCount);
  setText('statMingguIni', weekCount);
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonResponses() {
  const c = getEl('skriningTableContainer');
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

function renderSkeletonQuestions() {
  const c = getEl('questionsTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(4).fill(0).map(() =>
        `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredSkrining() {
  let filtered = ctx.state.skriningList.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama || '').toLowerCase().includes(q) ||
      (item.alamat || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.hasilFilter !== '') {
    filtered = filtered.filter(item => item.hasil === ctx.state.hasilFilter);
  }

  filtered.sort((a, b) => {
    const aT = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bT = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (bT !== aT) return bT - aT;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });

  return filtered;
}

function applyFiltersAndSort() {
  ctx.state.filteredList = getFilteredSkrining();
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;
  renderResponsesTable();
  renderStats();
}

// ============================================================
//   RENDER — RESPONSES TABLE
// ============================================================
function renderResponsesTable() {
  const c = getEl('skriningTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  const totalItems = ctx.state.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filteredList.slice(start, end);

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama Peserta</th>
      <th>Alamat</th>
      <th>Tanggal</th>
      <th>Hasil</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery || ctx.state.hasilFilter;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      Tidak ada data skrining${hasFilter ? ' untuk filter ini' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const badge = getHasilBadge(item.hasil || 'Belum');
      const safeId = escapeHtml(String(item.id || ''));
      const alamat = item.alamat || item.asal || '-';

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td>${escapeHtml(alamat)}</td>
        <td>${escapeHtml(formatDateTimeID(item.timestamp))}</td>
        <td><span class="badge ${badge}">${escapeHtml(item.hasil || 'Belum')}</span></td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}" title="Detail" aria-label="Lihat detail">
            <i class="bi bi-eye" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit (lokal)" aria-label="Edit">
            <i class="bi bi-pencil" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus" aria-label="Hapus">
            <i class="bi bi-trash" aria-hidden="true"></i>
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

  restoreFocusState('searchInput', savedFocus);
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filteredList.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderResponsesTable();
  getEl('skriningTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   RENDER — QUESTIONS TABLE
// ============================================================
function renderQuestionsTable() {
  const c = getEl('questionsTableContainer');
  if (!c) return;

  if (!ctx.state.questionList || ctx.state.questionList.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center mb-0">
      Belum ada pertanyaan skrining. Klik <strong>Tambah Pertanyaan</strong> atau <strong>Muat Default</strong>.
    </div>`;
    return;
  }

  const sorted = ctx.state.questionList.slice().sort((a, b) =>
    (parseInt(a.urutan) || 0) - (parseInt(b.urutan) || 0)
  );

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Pertanyaan</th>
      <th>Jenis</th>
      <th>Opsi</th>
      <th>Urutan</th>
      <th class="text-center" style="width:130px;">Aksi</th>
    </tr></thead><tbody>`;

  sorted.forEach((q, idx) => {
    const badgeClass = q.jenis === 'radio' ? 'bg-primary' : 'bg-secondary';
    const safeId = escapeHtml(String(q.id || ''));
    html += `<tr>
      <td>${idx + 1}</td>
      <td>${escapeHtml(q.teks || '-')}</td>
      <td><span class="badge ${badgeClass}">${escapeHtml(q.jenis || 'text')}</span></td>
      <td><small>${escapeHtml(q.opsi || '-')}</small></td>
      <td>${escapeHtml(String(q.urutan || '-'))}</td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-warning me-1" data-action="edit-q" data-id="${safeId}" title="Edit" aria-label="Edit">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-q" data-id="${safeId}" title="Hapus" aria-label="Hapus">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;
}

// ============================================================
//   LOAD — RESPONSES (fallback)
// ============================================================
async function loadResponses(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshResponsesFromCache();
  } catch (e) {
    console.error('[SkriningView] loadResponses error:', e);
    const c = getEl('skriningTableContainer');
    if (c && ctx.state.skriningList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   LOAD — QUESTIONS
// ============================================================
async function loadQuestions(forceRefresh = false) {
  try {
    const res = await getSkriningQuestions();
    if (!ctx.mounted) return;
    let list = [];
    if (res && res.success && Array.isArray(res.data)) list = res.data;
    else if (Array.isArray(res)) list = res;

    const freshHash = computeListHash(list, ['id', 'teks', 'urutan']);

    if (freshHash !== ctx.state.lastQuestionHash || forceRefresh) {
      ctx.state.questionList = list;
      ctx.state.lastQuestionHash = freshHash;
      renderQuestionsTable();
      renderStats();
    }
  } catch (e) {
    console.warn('[SkriningView] loadQuestions error:', e);
    const c = getEl('questionsTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-info text-center mb-0">Gagal memuat pertanyaan.</div>`;
    }
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  ctx.saving = true;

  try {
    await AdminModule.loadAllData(true);
    refreshResponsesFromCache();
    await loadQuestions(true);
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   DETAIL RESPONS
// ============================================================
function viewSkrining(id) {
  const item = ctx.state.skriningList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const badge = getHasilBadge(item.hasil);
  const excludeFields = ['id', '_rowIndex', 'dataJson'];

  let html = `<div class="list-group list-group-flush border rounded-3">
    <div class="list-group-item py-3 bg-light">
      <strong>🔹 Hasil Skrining:</strong>
      <span class="badge ${badge}">${escapeHtml(item.hasil || 'Belum')}</span>
    </div>`;

  Object.keys(item).forEach(key => {
    if (excludeFields.includes(key)) return;
    if (key === 'hasil') return;
    const val = item[key];
    if (val === undefined || val === null || val === '') return;
    const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const displayVal = key === 'timestamp' ? formatDateTimeID(val) : val;
    html += `<div class="list-group-item py-3">
      <strong>${escapeHtml(label)}:</strong><br>
      ${escapeHtml(String(displayVal))}
    </div>`;
  });

  if (item.dataJson) {
    try {
      const extra = typeof item.dataJson === 'string' ? JSON.parse(item.dataJson) : item.dataJson;
      Object.keys(extra).forEach(key => {
        const val = extra[key];
        if (val === undefined || val === null || val === '') return;
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        html += `<div class="list-group-item py-3">
          <strong>${escapeHtml(label)}:</strong><br>
          ${escapeHtml(String(val))}
        </div>`;
      });
    } catch (e) { /* silent */ }
  }

  html += `</div>`;
  const content = getEl('detailContent');
  if (content) content.innerHTML = html;
  ctx.getModal('detailSkriningModal')?.show();
}

// ============================================================
//   ADD / EDIT RESPONS
// ============================================================
function openAddModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editSkriningId', '');
  setVal('skriningNama', '');
  setVal('skriningAlamat', '');
  setVal('skriningHasil', 'Layak');
  setVal('skriningTanggal', getLocalDateOnly(new Date()));
  setVal('skriningNote', '');

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Tambah Skrining';

  ctx.getModal('skriningFormModal')?.show();
}

function editSkrining(id) {
  const item = ctx.state.skriningList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editSkriningId', id);
  setVal('skriningNama', item.nama || '');
  setVal('skriningAlamat', item.alamat || '');
  setVal('skriningHasil', item.hasil || 'Layak');
  setVal('skriningTanggal', item.timestamp
    ? getLocalDateOnly(item.timestamp)
    : getLocalDateOnly(new Date()));
  setVal('skriningNote', item.catatan || '');

  const titleEl = getEl('formModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Skrining (Lokal)';

  ctx.getModal('skriningFormModal')?.show();
}

async function saveSkrining(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('saveSkriningBtn');
  const id = getEl('editSkriningId').value;
  const nama = getEl('skriningNama').value.trim();
  const alamat = getEl('skriningAlamat').value.trim();
  const hasil = getEl('skriningHasil').value;
  const catatan = getEl('skriningNote').value.trim();

  if (!nama) { showToast('Nama wajib diisi', 'error'); return; }
  if (!alamat) { showToast('Alamat wajib diisi', 'error'); return; }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    if (id) {
      const idx = ctx.state.skriningList.findIndex(x => String(x.id) === String(id));
      if (idx !== -1) {
        ctx.state.skriningList[idx].nama = nama;
        ctx.state.skriningList[idx].alamat = alamat;
        ctx.state.skriningList[idx].hasil = hasil;
        ctx.state.skriningList[idx].catatan = catatan;
      }
      showToast('Data diubah di tampilan lokal. Untuk permanen, edit di Google Sheets.', 'info');
      ctx.getModal('skriningFormModal')?.hide();
      applyFiltersAndSort();
    } else {
      const res = await submitSkrining({ nama, alamat, hasil, catatan });
      if (res && res.success) {
        showToast('Data skrining berhasil ditambahkan', 'success');
        ctx.getModal('skriningFormModal')?.hide();
        await AdminModule.loadAllData(true);
      } else {
        throw new Error((res && res.error) || 'Gagal menambahkan');
      }
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   DELETE RESPONS
// ============================================================
function deleteSkrining(id) {
  const item = ctx.state.skriningList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const rowIndex = item._rowIndex;
  if (rowIndex == null || rowIndex === '' || isNaN(parseInt(rowIndex, 10))) {
    showToast('Tidak bisa hapus: ID baris tidak ditemukan. Refresh data dulu.', 'warning');
    return;
  }

  ctx.state.pendingDeleteId = id;
  ctx.state.pendingDeleteRowIndex = rowIndex;

  const idEl = getEl('deleteSkriningId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('confirmDeleteBtn');
  const id = ctx.state.pendingDeleteId;
  const rowIndex = ctx.state.pendingDeleteRowIndex;

  if (!id) { showToast('Data tidak valid', 'error'); return; }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const payloadId = (rowIndex != null && rowIndex !== '' && !isNaN(parseInt(rowIndex, 10)))
      ? parseInt(rowIndex, 10)
      : parseInt(id, 10);

    const res = await deleteSkriningResponse(payloadId);

    if (res && res.success) {
      showToast('Data skrining berhasil dihapus', 'success');
      ctx.getModal('deleteConfirmModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteId = null;
    ctx.state.pendingDeleteRowIndex = null;
  }
}

// ============================================================
//   QUESTIONS CRUD
// ============================================================
function openAddQuestionModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editQuestionId', '');
  setVal('questionTeks', '');
  setVal('questionJenis', 'text');
  setVal('questionOpsi', '');
  setVal('questionUrutan', ctx.state.questionList.length + 1);

  const titleEl = getEl('questionModalTitle');
  if (titleEl) titleEl.textContent = 'Tambah Pertanyaan';

  const group = getEl('questionOptionsGroup');
  if (group) group.style.display = 'none';

  ctx.getModal('questionFormModal')?.show();
}

function editQuestion(id) {
  const q = ctx.state.questionList.find(item => String(item.id) === String(id));
  if (!q) { showToast('Pertanyaan tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editQuestionId', q.id);
  setVal('questionTeks', q.teks || '');
  setVal('questionJenis', q.jenis || 'text');
  setVal('questionOpsi', q.opsi || '');
  setVal('questionUrutan', q.urutan || 1);

  const titleEl = getEl('questionModalTitle');
  if (titleEl) titleEl.textContent = 'Edit Pertanyaan';

  const group = getEl('questionOptionsGroup');
  if (group) group.style.display = q.jenis === 'radio' ? 'block' : 'none';

  ctx.getModal('questionFormModal')?.show();
}

function deleteQuestion(id) {
  const q = ctx.state.questionList.find(item => String(item.id) === String(id));
  if (!q) { showToast('Pertanyaan tidak ditemukan', 'error'); return; }

  ctx.state.pendingDeleteQuestionId = id;
  const idEl = getEl('deleteQuestionId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteQuestionModal')?.show();
}

async function saveQuestion(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('saveQuestionBtn');
  const id = getEl('editQuestionId').value;
  const teks = getEl('questionTeks').value.trim();
  const jenis = getEl('questionJenis').value;
  const opsi = getEl('questionOpsi').value.trim();
  const urutan = parseInt(getEl('questionUrutan').value) || 1;

  if (!teks) { showToast('Teks pertanyaan wajib diisi', 'error'); return; }
  if (jenis === 'radio' && !opsi) {
    showToast('Opsi wajib diisi untuk jenis Radio', 'error');
    return;
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const params = { teks, jenis, opsi, urutan };
    let res;

    if (id) {
      params.id = id;
      res = await updateSkriningQuestion(params);
    } else {
      res = await addSkriningQuestion(params);
    }

    if (res && res.success) {
      showToast(id ? 'Pertanyaan diperbarui' : 'Pertanyaan ditambahkan', 'success');
      ctx.getModal('questionFormModal')?.hide();
      await loadQuestions(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

async function executeDeleteQuestion(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('confirmDeleteQuestionBtn');
  const id = ctx.state.pendingDeleteQuestionId || getEl('deleteQuestionId')?.value;
  if (!id) return;

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await deleteSkriningQuestion(id);
    if (res && res.success) {
      showToast('Pertanyaan berhasil dihapus', 'success');
      ctx.getModal('deleteQuestionModal')?.hide();
      await loadQuestions(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteQuestionId = null;
  }
}

// ============================================================
//   LOAD DEFAULT QUESTIONS — Backup + Rollback + isMounted guard
// ============================================================
async function loadDefaultQuestions(e) {
  if (ctx.saving) return;

  const confirmed = confirm(
    '⚠️ PERHATIAN\n\n' +
    'Tindakan ini akan:\n' +
    '1. Backup semua pertanyaan yang ada\n' +
    '2. Menghapus SEMUA pertanyaan yang ada\n' +
    '3. Memuat 9 pertanyaan default\n\n' +
    'Data jawaban peserta TIDAK akan terhapus.\n\n' +
    'Lanjutkan?'
  );
  if (!confirmed) return;

  const btn = e.currentTarget || getEl('loadDefaultQuestionsBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  // Backup dulu sebelum delete
  const backup = ctx.state.questionList.map(q => ({
    teks: q.teks,
    jenis: q.jenis,
    opsi: q.opsi,
    urutan: q.urutan,
  }));

  try {
    let deletedCount = 0;
    let addedCount = 0;

    // Phase 1: Delete all (parallel batch 5)
    const deleteList = ctx.state.questionList.slice();
    for (let i = 0; i < deleteList.length; i += BATCH_SIZE) {
      if (!ctx.mounted) break;
      const batch = deleteList.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(q => deleteSkriningQuestion(q.id))
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.success) deletedCount++;
      });
    }

    // Phase 2: Add defaults (parallel batch 5)
    for (let i = 0; i < DEFAULT_QUESTIONS.length; i += BATCH_SIZE) {
      if (!ctx.mounted) break;
      const batch = DEFAULT_QUESTIONS.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(q => addSkriningQuestion(q))
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.success) addedCount++;
      });
    }

    // Rollback kalau TIDAK ADA pertanyaan berhasil ditambahkan
    if (addedCount === 0 && backup.length > 0 && ctx.mounted) {
      console.warn('[SkriningView] Load default gagal, rollback', backup.length, 'pertanyaan...');
      showToast('Load default gagal, memulihkan backup...', 'warning');

      for (let i = 0; i < backup.length; i += BATCH_SIZE) {
        if (!ctx.mounted) break;
        const batch = backup.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(q => addSkriningQuestion(q)));
      }
      throw new Error('Load default gagal. Data lama dikembalikan.');
    }

    showToast(
      `Berhasil: ${deletedCount} dihapus, ${addedCount} ditambahkan`,
      addedCount === DEFAULT_QUESTIONS.length ? 'success' : 'warning'
    );
    await loadQuestions(true);
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = ctx.state.filteredList.length > 0 ? ctx.state.filteredList : ctx.state.skriningList;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const out = data.map(item => {
    const base = {
      id: item.id,
      nama: item.nama,
      alamat: item.alamat,
      timestamp: item.timestamp,
      hasil: item.hasil,
      catatan: item.catatan,
    };
    if (item.dataJson) {
      try {
        const extra = typeof item.dataJson === 'string' ? JSON.parse(item.dataJson) : item.dataJson;
        Object.assign(base, extra);
      } catch (e) { /* silent */ }
    }
    return base;
  });

  const fileName = `skrining_export_${getLocalDateOnly(new Date())}.json`;
  if (downloadJSON(out, fileName)) {
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } else {
    showToast('Gagal ekspor data', 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Skrining View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
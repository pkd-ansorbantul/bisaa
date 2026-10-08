// ============================================================
// VIEW: posttest.js — v27.3.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/posttest.html
// ============================================================
// CHANGELOG v27.3.0 (dari v27.2.3):
//   ✅ NEW: preloadData() — dipanggil app.js saat boot
//   ✅ NEW: Instant render questions dari localStorage cache
//   ✅ NEW: bindRefreshButton() → window.__pkd.forceSync()
//   ✅ NEW: Cache status badge terintegrasi
//   ✅ NEW: Auto-sync background via AdminModule subscription
//   ✅ FIX: Separated refresh handler (questions vs responses)
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Modal dispose + cleanup on unmount
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: All features (CRUD, responses table, CSV export)
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';
import {
  getEl,
  debounce,
  setBtnLoading,
  createViewContext,
  captureFocusState,
  restoreFocusState,
  cleanupBootstrapArtifacts,
  computeListHash,
  setCacheStatus as setCacheStatusHelper,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const KIND = 'posttest';
const TITLE = 'Post-test';
const CACHE_KEY = 'pkd_cache_posttest_questions_v3';
const EXPORT_FILENAME = 'posttest_data';
const QUESTION_CACHE_AGE_MS = 5 * 60 * 1000; // 5 menit

const API = {
  getQuestions: 'getPosttestQuestions',
  addQuestion: 'addPosttestQuestion',
  updateQuestion: 'updatePosttestQuestion',
  deleteQuestion: 'deletePosttestQuestion',
};

const IDS = {
  soalContainer: 'soalContainer',
  dataContainer: 'dataContainer',
  modal: 'posttestModal',
  modalTitle: 'posttestModalTitle',
  editId: 'posttestId',
  teks: 'posttestTeks',
  opsi: 'posttestOpsi',
  optionsContainer: 'posttestOptionsContainer',
  jawaban: 'posttestJawaban',
  urutan: 'posttestUrutan',
  timerEnabled: 'posttestTimerEnabled',
  timerDurationGroup: 'posttestTimerDurationGroup',
  timerDuration: 'posttestTimerDuration',
  saveBtn: 'simpanPosttestBtn',
  detailModal: 'detailModal',
  detailBody: 'detailModalBody',
};

// ============================================================
//   UTILITY
// ============================================================
function formatDateTime(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
}

function getResponses() {
  return AdminModule.getPosttestList() || [];
}

// ============================================================
//   ⚡ PRELOAD API — dipanggil oleh app.js saat boot
// ============================================================
export async function preloadData() {
  const cached = cacheGet();
  if (cached && Array.isArray(cached) && cached.length > 0) {
    console.log(`[${TITLE}Preload] ✅ Cache hit (${cached.length} questions)`);
    return { success: true, source: 'cache', count: cached.length };
  }

  try {
    console.log(`[${TITLE}Preload] ⚡ Fetching questions from server...`);
    const res = await callApi(API.getQuestions, {}, 'GET');
    const list = Array.isArray(res) ? res : (res?.data || []);

    if (list.length > 0) {
      cacheSet(list);
      console.log(`[${TITLE}Preload] ✅ Loaded ${list.length} questions`);
      return { success: true, source: 'network', count: list.length };
    }
    return { success: true, source: 'network', count: 0 };
  } catch (e) {
    console.warn(`[${TITLE}Preload] ⚠️ Failed:`, e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//   CACHE HELPERS (questions — localStorage)
// ============================================================
function cacheGet() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > QUESTION_CACHE_AGE_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

function cacheSet(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch (e) { /* quota exceeded — silent */ }
}

function cacheClear() {
  try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* silent */ }
}

// ============================================================
//   SET CACHE STATUS (konsisten dengan view lain)
// ============================================================
function setCacheStatus(status) {
  setCacheStatusHelper(status, 'cacheStatus');
}

// ============================================================
//   CONTEXT (Subscription ke AdminModule)
// ============================================================
const ctx = createViewContext(
  {
    questions: [],
    responses: [],
    filteredResponses: [],
    selectedAnswerIndex: 0,
    searchQuery: '',
    responseHash: '',
    questionHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'posttest'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[${TITLE}View] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshResponsesFromCache();
      } catch (e) {
        console.warn(`[${TITLE}View] Re-render error:`, e);
      }
    },
  }
);

// ============================================================
//   REFRESH RESPONSES FROM CACHE
// ============================================================
function refreshResponsesFromCache() {
  const fresh = getResponses() || [];
  const hash = computeListHash(fresh);

  if (hash === ctx.state.responseHash) {
    console.log(`[${TITLE}View] No change, skip re-render`);
    return;
  }

  ctx.state.responses = fresh;
  ctx.state.responseHash = hash;
  applyResponseFilters();
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn(`[${TITLE}View] Sudah mounted, skip`);
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log(`[${TITLE}View] mounted`);

  // Reset state
  Object.assign(ctx.state, {
    questions: [],
    responses: [],
    filteredResponses: [],
    selectedAnswerIndex: 0,
    searchQuery: '',
    responseHash: '',
    questionHash: '',
  });

  bindEvents();

  // ===== ⚡ INSTANT RENDER RESPONSES dari AdminModule cache =====
  const cachedResponses = getResponses() || [];
  if (cachedResponses.length > 0) {
    console.log(`[${TITLE}View] ⚡ Rendering responses from preload cache`);
    ctx.state.responses = cachedResponses;
    ctx.state.responseHash = computeListHash(cachedResponses);
    applyResponseFilters();
  } else {
    renderSkeletonData();
  }

  // ===== ⚡ INSTANT RENDER QUESTIONS dari localStorage cache =====
  const cachedQuestions = cacheGet();
  if (cachedQuestions && Array.isArray(cachedQuestions) && cachedQuestions.length > 0) {
    console.log(`[${TITLE}View] ⚡ Rendering questions from cache (${cachedQuestions.length})`);
    ctx.state.questions = cachedQuestions;
    ctx.state.questionHash = computeListHash(cachedQuestions);
    renderSoal();
    setCacheStatus('Cache');
  } else {
    console.log(`[${TITLE}View] ⚠️ No question cache, showing skeleton`);
    renderSkeletonSoal();
    // Lazy load di background
    loadQuestions(false).catch(e =>
      console.warn(`[${TITLE}View] Lazy load questions:`, e)
    );
  }

  // ===== ⚡ Subscribe ke AdminModule =====
  await ctx.subscribeToData();

  // ===== ⚡ Bind refresh button ke global forceSync =====
  ctx.bindRefreshButton('refreshDataBtn', 'Data disegarkan');

  // ⚡ NO POLLING — auto-sync global di app.js (60s interval)

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log(`[${TITLE}View] unmounted`);

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Modal form save
  ctx.on(getEl(IDS.saveBtn), 'click', saveQuestion);

  // Opsi input — re-render option buttons as user types
  ctx.on(getEl(IDS.opsi), 'input', function () {
    renderOptionButtons(this.value, ctx.state.selectedAnswerIndex);
  });

  // Timer toggle
  ctx.on(getEl(IDS.timerEnabled), 'change', function () {
    const group = getEl(IDS.timerDurationGroup);
    if (group) group.style.display = this.checked ? 'block' : 'none';
  });

  // ============ DELEGATION — soal container ============
  const soalContainer = getEl(IDS.soalContainer);
  if (soalContainer) {
    ctx.on(soalContainer, 'click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'edit-q') {
        const q = ctx.state.questions.find(x => String(x.id) === String(id));
        if (q) showModal(q);
      } else if (action === 'delete-q') {
        deleteQuestion(id);
      } else if (action === 'refresh') {
        handleRefreshQuestions(btn);
      } else if (action === 'add') {
        showModal(null);
      }
    });
  }

  // ============ DELEGATION — data container ============
  const dataContainer = getEl(IDS.dataContainer);
  if (dataContainer) {
    ctx.on(dataContainer, 'click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.action;

      if (action === 'refresh') {
        handleRefreshResponses(btn);
      } else if (action === 'export') {
        exportCSV();
      } else if (action === 'detail') {
        const id = btn.dataset.id;
        const row = ctx.state.responses.find(r =>
          String(r.id || r._rowIndex) === String(id)
        );
        if (row) showDetail(row);
        else showToast('Data tidak ditemukan', 'error');
      }
    });

    // Input — search dengan debounce
    ctx.on(dataContainer, 'input', debounce((e) => {
      if (!e.target.matches('#filterDataInput')) return;
      ctx.state.searchQuery = e.target.value;
      applyResponseFilters();
    }, SEARCH_DEBOUNCE));
  }
}

// ============================================================
//   MANUAL REFRESH — QUESTIONS (force re-fetch)
// ============================================================
async function handleRefreshQuestions(btn) {
  if (ctx.saving) return;

  const restore = btn ? setBtnLoading(btn, true, '') : () => {};
  ctx.saving = true;
  setCacheStatus('Memuat...');

  try {
    cacheClear();
    await loadQuestions(true);
    setCacheStatus('Live');
    showToast('Soal disegarkan', 'success');
  } catch (err) {
    setCacheStatus('Error');
    showToast('Gagal menyegarkan soal', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   MANUAL REFRESH — RESPONSES (via AdminModule)
// ============================================================
async function handleRefreshResponses(btn) {
  if (ctx.saving) return;

  const restore = btn ? setBtnLoading(btn, true, '') : () => {};
  ctx.saving = true;
  setCacheStatus('Memuat...');

  try {
    await AdminModule.loadAllData(true);
    refreshResponsesFromCache();
    setCacheStatus('Live');
    showToast('Data disegarkan', 'success');
  } catch (e) {
    setCacheStatus('Error');
    showToast('Gagal menyegarkan: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   LOAD: QUESTIONS
// ============================================================
async function loadQuestions(forceRefresh = false) {
  const container = getEl(IDS.soalContainer);
  if (!container) return;

  // Kalau tidak force, cek cache dulu
  if (!forceRefresh) {
    const cached = cacheGet();
    if (cached && Array.isArray(cached) && cached.length > 0) {
      ctx.state.questions = cached;
      ctx.state.questionHash = computeListHash(cached);
      renderSoal();
      setCacheStatus('Cache');
      return;
    }
  }

  // Skeleton kalau belum ada data
  if (ctx.state.questions.length === 0) {
    renderSkeletonSoal();
  }

  try {
    const res = await callApi(API.getQuestions, {}, 'GET');
    if (!ctx.mounted) return;

    const list = Array.isArray(res) ? res : (res?.data || []);
    if (list.length > 0) {
      ctx.state.questions = list;
      ctx.state.questionHash = computeListHash(list);
      cacheSet(list);
      renderSoal();
      setCacheStatus('Live');
    } else {
      ctx.state.questions = [];
      ctx.state.questionHash = '';
      cacheSet([]);
      container.innerHTML = `<div class="alert alert-info text-center">
        Belum ada soal ${TITLE.toLowerCase()}. Klik <strong>Tambah Soal</strong> untuk memulai.
      </div>`;
      setCacheStatus('Live');
    }
  } catch (e) {
    console.warn(`[${TITLE}View] loadQuestions:`, e);
    if (ctx.state.questions.length === 0) {
      container.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat soal: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   FILTER RESPONSES
// ============================================================
function applyResponseFilters() {
  let list = ctx.state.responses.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    list = list.filter(r =>
      String(r.nama || '').toLowerCase().includes(q) ||
      String(r.nohp || '').toLowerCase().includes(q)
    );
  }

  list.sort((a, b) => {
    const at = new Date(a.timestamp || 0).getTime();
    const bt = new Date(b.timestamp || 0).getTime();
    return (isNaN(bt) ? 0 : bt) - (isNaN(at) ? 0 : at);
  });

  ctx.state.filteredResponses = list;
  renderData();
}

// ============================================================
//   RENDER: DATA TABLE
// ============================================================
function renderData() {
  const container = getEl(IDS.dataContainer);
  if (!container) return;

  const savedFocus = captureFocusState('filterDataInput');
  const data = ctx.state.filteredResponses;

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <div>
        <span class="text-muted small">Total Data: </span>
        <span class="badge bg-primary">${data.length}</span>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm rounded-pill" data-action="refresh" type="button">
          <i class="bi bi-arrow-clockwise me-1"></i> Segarkan
        </button>
        <button class="btn btn-success btn-sm rounded-pill" data-action="export" type="button">
          <i class="bi bi-download me-1"></i> Ekspor CSV
        </button>
      </div>
    </div>
    <div class="mb-3">
      <input type="text" class="form-control" id="filterDataInput"
             placeholder="🔍 Cari nama peserta atau no HP…" autocomplete="off"
             value="${escapeHtml(ctx.state.searchQuery)}"
             aria-label="Cari data">
    </div>
    <div class="table-container">
      <div class="table-responsive" style="max-height:500px;overflow-y:auto;">
        <table class="table table-bordered table-sm table-striped align-middle">
          <thead class="table-light"><tr>
            <th>Waktu</th>
            <th>Nama</th>
            <th>No HP</th>
            <th style="width:60px;">Skor</th>
            <th style="width:90px;">Jawaban</th>
            <th style="width:70px;" class="text-center">Detail</th>
          </tr></thead><tbody>`;

  if (data.length === 0) {
    html += `<tr><td colspan="6" class="text-center py-4 text-muted">
      ${ctx.state.searchQuery ? 'Tidak ada hasil pencarian.' : `Belum ada data ${TITLE.toLowerCase()}.`}
    </td></tr>`;
  } else {
    data.forEach(row => {
      let ringkasan = '-';
      try {
        const raw = row.answers || row.answersJson || '[]';
        const jawaban = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (Array.isArray(jawaban)) {
          const benar = jawaban.filter(a => a && a.correct).length;
          ringkasan = `${benar}/${jawaban.length}`;
        }
      } catch { ringkasan = '—'; }

      const rowId = String(row.id || row._rowIndex || '');

      html += `<tr>
        <td><small>${escapeHtml(formatDateTime(row.timestamp))}</small></td>
        <td><strong>${escapeHtml(row.nama || '-')}</strong></td>
        <td>${escapeHtml(row.nohp || '-')}</td>
        <td><span class="badge bg-primary">${escapeHtml(String(row.score || 0))}</span></td>
        <td>${escapeHtml(ringkasan)}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info"
                  data-action="detail" data-id="${escapeHtml(rowId)}"
                  title="Detail" aria-label="Lihat detail">
            <i class="bi bi-search"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;

  restoreFocusState('filterDataInput', savedFocus);
}

// ============================================================
//   RENDER: SOAL TABLE
// ============================================================
function renderSoal() {
  const c = getEl(IDS.soalContainer);
  if (!c) return;

  const sorted = ctx.state.questions.slice().sort((a, b) =>
    (parseInt(a.urutan) || 0) - (parseInt(b.urutan) || 0)
  );

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <div>
        <span class="text-muted small">Total Soal: </span>
        <span class="badge bg-primary">${sorted.length}</span>
      </div>
      <div class="d-flex gap-2">
        <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill" data-action="refresh">
          <i class="bi bi-arrow-clockwise me-1"></i> Segarkan
        </button>
        <button type="button" class="btn btn-success btn-sm rounded-pill" data-action="add">
          <i class="bi bi-plus-circle me-1"></i> Tambah Soal
        </button>
      </div>
    </div>
    <div class="table-container">
      <div class="table-responsive"><table class="table table-bordered table-sm table-hover">
        <thead class="table-light"><tr>
          <th style="width:50px;">ID</th>
          <th>Teks</th>
          <th>Opsi</th>
          <th style="width:80px;">Jawaban</th>
          <th style="width:80px;">Urutan</th>
          <th style="width:80px;">Timer</th>
          <th style="width:130px;" class="text-center">Aksi</th>
        </tr></thead><tbody>`;

  if (sorted.length === 0) {
    html += `<tr><td colspan="7" class="text-center py-4 text-muted">
      Belum ada soal ${TITLE.toLowerCase()}.
    </td></tr>`;
  } else {
    sorted.forEach(q => {
      const opsiStr = Array.isArray(q.opsi) ? q.opsi.join(', ') : (q.opsi || '');
      const safeId = escapeHtml(String(q.id));
      const timerInfo = q.timer_enabled
        ? `⏱️ ${escapeHtml(String(q.timer_duration || 30))}s`
        : '⛔';

      html += `<tr>
        <td>${escapeHtml(String(q.id))}</td>
        <td><small>${escapeHtml(q.teks || '')}</small></td>
        <td><small>${escapeHtml(opsiStr)}</small></td>
        <td>${escapeHtml(String(q.jawaban))}</td>
        <td>${escapeHtml(String(q.urutan || '-'))}</td>
        <td>${timerInfo}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-warning me-1"
                  data-action="edit-q" data-id="${safeId}" title="Edit" aria-label="Edit soal">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger"
                  data-action="delete-q" data-id="${safeId}" title="Hapus" aria-label="Hapus soal">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div></div>`;
  c.innerHTML = html;
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonSoal() {
  const c = getEl(IDS.soalContainer);
  if (!c) return;
  c.innerHTML = `
    <div class="table-container"><div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead class="table-light"><tr>
          ${Array(7).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
        </tr></thead>
        <tbody>${Array(5).fill(0).map(() =>
          `<tr>${Array(7).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    </div></div>`;
}

function renderSkeletonData() {
  const c = getEl(IDS.dataContainer);
  if (!c) return;
  c.innerHTML = `
    <div class="table-container"><div class="table-responsive">
      <table class="table table-hover align-middle">
        <thead class="table-light"><tr>
          ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
        </tr></thead>
        <tbody>${Array(5).fill(0).map(() =>
          `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table>
    </div></div>`;
}

// ============================================================
//   MODAL: SHOW
// ============================================================
function showModal(soal) {
  const isEdit = !!soal;
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };

  const titleEl = getEl(IDS.modalTitle);
  if (titleEl) {
    titleEl.textContent = isEdit ? `Edit Soal ${TITLE}` : `Tambah Soal ${TITLE}`;
  }

  setVal(IDS.editId, isEdit ? soal.id : '');
  setVal(IDS.teks, isEdit ? (soal.teks || '') : '');
  setVal(IDS.opsi, isEdit
    ? (Array.isArray(soal.opsi) ? soal.opsi.join(',') : (soal.opsi || ''))
    : '');
  setVal(IDS.urutan, isEdit ? (soal.urutan || '') : '');

  const timerEnabledEl = getEl(IDS.timerEnabled);
  if (timerEnabledEl) timerEnabledEl.checked = isEdit ? !!soal.timer_enabled : false;

  setVal(IDS.timerDuration, isEdit ? (soal.timer_duration || 30) : 30);

  const timerGroup = getEl(IDS.timerDurationGroup);
  if (timerGroup) {
    timerGroup.style.display = (isEdit && soal.timer_enabled) ? 'block' : 'none';
  }

  ctx.state.selectedAnswerIndex = (isEdit && soal.jawaban !== undefined)
    ? parseInt(soal.jawaban)
    : 0;

  setVal(IDS.jawaban, ctx.state.selectedAnswerIndex);
  renderOptionButtons(getEl(IDS.opsi)?.value || '', ctx.state.selectedAnswerIndex);

  ctx.getModal(IDS.modal)?.show();
}

// ============================================================
//   MODAL: OPTION BUTTONS
// ============================================================
function renderOptionButtons(opsiString, selectedIndex) {
  const c = getEl(IDS.optionsContainer);
  if (!c) return;

  if (!opsiString || !opsiString.trim()) {
    c.innerHTML = '<span class="text-muted small">Masukkan opsi terlebih dahulu.</span>';
    return;
  }

  const options = opsiString.split(',').map(s => s.trim()).filter(Boolean);
  let html = '';
  options.forEach((opt, idx) => {
    const isCorrect = (idx === selectedIndex);
    html += `<button type="button" class="btn btn-sm ${isCorrect ? 'btn-success' : 'btn-outline-secondary'}"
              data-opt-index="${idx}" aria-label="Pilih ${escapeHtml(opt)} sebagai jawaban benar">
      ${escapeHtml(opt)} ${isCorrect ? '✓' : ''}
    </button>`;
  });
  c.innerHTML = html;

  c.querySelectorAll('[data-opt-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      ctx.state.selectedAnswerIndex = parseInt(btn.dataset.optIndex);
      const hiddenInput = getEl(IDS.jawaban);
      if (hiddenInput) hiddenInput.value = ctx.state.selectedAnswerIndex;
      renderOptionButtons(opsiString, ctx.state.selectedAnswerIndex);
    });
  });
}

// ============================================================
//   SAVE QUESTION
// ============================================================
async function saveQuestion(e) {
  if (ctx.saving) return;

  const id = getEl(IDS.editId)?.value;
  const teks = getEl(IDS.teks)?.value.trim() || '';
  const opsi = getEl(IDS.opsi)?.value.trim() || '';
  const jawaban = parseInt(getEl(IDS.jawaban)?.value) || 0;
  const urutan = parseInt(getEl(IDS.urutan)?.value) || 0;
  const timerEnabled = getEl(IDS.timerEnabled)?.checked || false;
  const timerDuration = parseInt(getEl(IDS.timerDuration)?.value) || 30;

  if (!teks || !opsi) {
    showToast('Teks soal dan opsi wajib diisi', 'error');
    return;
  }

  ctx.saving = true;
  const btn = e?.currentTarget || getEl(IDS.saveBtn);
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const payload = {
      teks, opsi, jawaban, urutan,
      timer_enabled: timerEnabled,
      timer_duration: timerDuration,
    };

    let res;
    if (id) {
      payload.id = id;
      res = await callApi(API.updateQuestion, payload, 'POST');
    } else {
      res = await callApi(API.addQuestion, payload, 'POST');
    }

    if (res && res.success) {
      showToast(id ? 'Soal diperbarui' : 'Soal ditambahkan', 'success');
      ctx.getModal(IDS.modal)?.hide();
      cacheClear();
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

// ============================================================
//   DELETE QUESTION
// ============================================================
async function deleteQuestion(id) {
  const q = ctx.state.questions.find(x => String(x.id) === String(id));
  if (!q) { showToast('Soal tidak ditemukan', 'error'); return; }

  const preview = String(q.teks || '').substring(0, 60);
  const suffix = q.teks && q.teks.length > 60 ? '…' : '';
  if (!confirm(`Hapus soal:\n"${preview}${suffix}"?`)) return;

  try {
    const res = await callApi(API.deleteQuestion, { id }, 'POST');
    if (res && res.success) {
      ctx.state.questions = ctx.state.questions.filter(x => String(x.id) !== String(id));
      cacheClear();
      renderSoal();
      showToast('Soal berhasil dihapus', 'success');
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   SHOW DETAIL
// ============================================================
function showDetail(row) {
  const body = getEl(IDS.detailBody);
  if (!body) return;

  let html = `
    <div class="mb-3 small">
      <div><strong>Nama:</strong> ${escapeHtml(row.nama || '-')}</div>
      <div><strong>No HP:</strong> ${escapeHtml(row.nohp || '-')}</div>
      <div><strong>Waktu:</strong> ${escapeHtml(formatDateTime(row.timestamp))}</div>
      <div><strong>Skor:</strong> <span class="badge bg-primary">${escapeHtml(String(row.score || 0))}</span></div>
    </div>
    <hr>
    <h6 class="fw-bold mb-3">Detail Jawaban</h6>`;

  if (row.answers) {
    try {
      const answers = typeof row.answers === 'string' ? JSON.parse(row.answers) : row.answers;
      if (Array.isArray(answers) && answers.length > 0) {
        html += `<div class="table-responsive"><table class="table table-sm table-bordered">
          <thead class="table-light"><tr>
            <th style="width:50px;">No</th>
            <th>Soal ID</th>
            <th>Pilihan</th>
            <th style="width:80px;" class="text-center">Benar?</th>
          </tr></thead><tbody>`;
        answers.forEach((a, idx) => {
          const selected = (a.selected !== undefined && a.selected !== null) ? a.selected : 'Tidak menjawab';
          html += `<tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(String(a.qid || '-'))}</td>
            <td>${escapeHtml(String(selected))}</td>
            <td class="text-center">${a.correct === true ? '✅' : '❌'}</td>
          </tr>`;
        });
        html += `</tbody></table></div>`;
      } else {
        html += '<p class="text-muted">Tidak ada data jawaban.</p>';
      }
    } catch {
      html += '<p class="text-danger small">Gagal parsing data jawaban.</p>';
    }
  } else {
    html += '<p class="text-muted">Tidak ada data jawaban.</p>';
  }

  body.innerHTML = html;
  ctx.getModal(IDS.detailModal)?.show();
}

// ============================================================
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = ctx.state.filteredResponses.length > 0
    ? ctx.state.filteredResponses
    : ctx.state.responses;

  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const headers = ['Timestamp', 'Nama', 'No HP', 'Skor', 'Jawaban (Soal ID - Pilihan - Benar?)'];
  const rows = data.map(r => {
    let js = '';
    try {
      const raw = r.answers || r.answersJson || '[]';
      const ans = typeof raw === 'string' ? JSON.parse(raw) : raw;
      js = Array.isArray(ans)
        ? ans.map(a => `${a.qid}:${a.selected}${a.correct ? '(✓)' : '✗'}`).join('; ')
        : '';
    } catch { js = 'Error'; }
    return [r.timestamp, r.nama || '', r.nohp || '', r.score || 0, js];
  });

  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  try {
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `${EXPORT_FILENAME}_${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount, preloadData };

console.log(
  '%c Posttest View v27.3.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
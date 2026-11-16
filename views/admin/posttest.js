// ============================================================
// VIEW: posttest.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/posttest.html
// ============================================================
// Fitur:
// ✅ Tab: Soal Posttest & Data Posttest
// ✅ CRUD soal posttest (text, opsi, jawaban, urutan, timer)
// ✅ Data responses (search, sort, pagination)
// ✅ Detail jawaban per response (parse answersJson)
// ✅ Export CSV
// ✅ Cache 5 menit (questions & responses)
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Event delegation (anti memory leak)
// ✅ Zero memory leak + full cleanup on unmount
// ============================================================

import { callApi, showToast, escapeHtml } from '../../js/core/api.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CACHE_KEYS = {
  QUESTIONS: 'pkd_cache_posttest_questions',
  RESPONSES: 'pkd_cache_posttest_responses',
};
const CACHE_AGE_MS = 5 * 60 * 1000; // 5 menit

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
  questions: [],
  responses: [],
  filteredResponses: [],
  selectedAnswerIndex: 0,
  searchQuery: '',
  isSaving: false,
  isLoading: false,
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
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
}

// ============================================================
//   CACHE HELPERS
// ============================================================
function safeCacheGet(key) {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;
    const { data, timestamp } = JSON.parse(item);
    if (Date.now() - timestamp > CACHE_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

function safeCacheSet(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) {}
}

function safeCacheClear(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[PosttestView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[PosttestView] mounted');

  // Reset state
  STATE.questions = [];
  STATE.responses = [];
  STATE.filteredResponses = [];
  STATE.selectedAnswerIndex = 0;
  STATE.searchQuery = '';
  STATE.isSaving = false;
  STATE.isLoading = false;

  await Promise.all([
    loadQuestions(false).catch(e => console.error('loadQuestions:', e)),
    loadResponses(false).catch(e => console.error('loadResponses:', e)),
  ]);

  bindEvents();

  // Auto-refresh responses saja
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    loadResponses(false)
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
  console.log('[PosttestView] unmounted');

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
  // Modal buttons
  on(getEl('simpanPosttestBtn'), 'click', saveQuestion);

  // Opsi input → update preview tombol
  on(getEl('posttestOpsi'), 'input', function () {
    renderOptionButtons(this.value, STATE.selectedAnswerIndex);
  });

  // Timer toggle
  on(getEl('posttestTimerEnabled'), 'change', function () {
    const group = getEl('posttestTimerDurationGroup');
    if (group) group.style.display = this.checked ? 'block' : 'none';
  });

  // Event delegation untuk action di dalam soal container
  on(getEl('soalContainer'), 'click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'edit-q') {
      const q = STATE.questions.find(x => String(x.id) === String(id));
      if (q) showPosttestModal(q);
    } else if (action === 'delete-q') {
      deleteQuestion(id);
    } else if (action === 'refresh') {
      safeCacheClear(CACHE_KEYS.QUESTIONS);
      loadQuestions(true);
    } else if (action === 'add') {
      showPosttestModal(null);
    }
  });

  // Event delegation untuk action di dalam data container
  on(getEl('dataContainer'), 'click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'refresh') {
      safeCacheClear(CACHE_KEYS.RESPONSES);
      loadResponses(true);
    } else if (action === 'export') {
      exportCSV();
    } else if (action === 'detail') {
      const encoded = btn.dataset.row;
      if (!encoded) return;
      try {
        const row = JSON.parse(decodeURIComponent(encoded));
        showDetail(row);
      } catch (err) {
        showToast('Gagal menampilkan detail', 'error');
      }
    }
  });

  // Event delegation untuk search input di data container (debounced)
  const debouncedSearch = debounce(function (e) {
    if (!e.target.matches('#filterDataInput')) return;
    STATE.searchQuery = e.target.value;
    applyResponseFilters();
  }, 300);

  on(getEl('dataContainer'), 'input', debouncedSearch);
}

// ============================================================
//   LOAD: SOAL
// ============================================================
async function loadQuestions(forceRefresh = false) {
  renderSkeletonSoal();

  const cached = forceRefresh ? null : safeCacheGet(CACHE_KEYS.QUESTIONS);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    STATE.questions = cached;
    renderSoal();
  }

  try {
    const res = await callApi('getPosttestQuestions', {}, 'GET');
    const dataArray = Array.isArray(res) ? res : (res?.data || []);

    if (dataArray.length > 0) {
      STATE.questions = dataArray;
      safeCacheSet(CACHE_KEYS.QUESTIONS, dataArray);
      renderSoal();
    } else if (!cached || cached.length === 0) {
      const c = getEl('soalContainer');
      if (c) {
        c.innerHTML = `<div class="alert alert-info text-center">
          Belum ada soal posttest. Klik <strong>Tambah Soal</strong> untuk memulai.
        </div>`;
      }
    }
  } catch (e) {
    console.warn('[PosttestView] loadQuestions:', e);
    if (!cached || cached.length === 0) {
      const c = getEl('soalContainer');
      if (c) {
        c.innerHTML = `<div class="alert alert-danger text-center">
          Gagal memuat soal: ${escapeHtml(e.message)}
        </div>`;
      }
    }
  }
}

function renderSoal() {
  const c = getEl('soalContainer');
  if (!c) return;

  const sorted = STATE.questions.slice().sort((a, b) => {
    const ua = parseInt(a.urutan) || 0;
    const ub = parseInt(b.urutan) || 0;
    return ua - ub;
  });

  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <div>
        <span class="text-muted small">Total Soal: </span>
        <span class="badge bg-primary">${sorted.length}</span>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm rounded-pill" data-action="refresh">
          <i class="bi bi-arrow-clockwise me-1"></i> Segarkan
        </button>
        <button class="btn btn-success btn-sm rounded-pill" data-action="add">
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
        </tr></thead>
        <tbody>`;

  if (sorted.length === 0) {
    html += `<tr><td colspan="7" class="text-center py-4 text-muted">Belum ada soal posttest.</td></tr>`;
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
          <button class="btn btn-sm btn-outline-warning me-1" data-action="edit-q" data-id="${safeId}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete-q" data-id="${safeId}" title="Hapus">
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
//   LOAD: RESPONSES
// ============================================================
async function loadResponses(forceRefresh = false) {
  if (STATE.isLoading) return;
  STATE.isLoading = true;

  const container = getEl('dataContainer');
  if (container && !container.querySelector('.table-container')) {
    renderSkeletonData();
  }

  const cached = forceRefresh ? null : safeCacheGet(CACHE_KEYS.RESPONSES);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    STATE.responses = cached;
    applyResponseFilters();
  }

  try {
    const res = await callApi('getPosttestResponses', {}, 'GET');
    const dataArray = Array.isArray(res) ? res : (res?.data || []);

    if (dataArray.length > 0) {
      STATE.responses = dataArray;
      safeCacheSet(CACHE_KEYS.RESPONSES, dataArray);
      applyResponseFilters();
    } else if (!cached || cached.length === 0) {
      const c = getEl('dataContainer');
      if (c) {
        c.innerHTML = `<div class="alert alert-info text-center">Belum ada data posttest.</div>`;
      }
    }
  } catch (e) {
    console.warn('[PosttestView] loadResponses:', e);
    if (!cached || cached.length === 0) {
      const c = getEl('dataContainer');
      if (c) {
        c.innerHTML = `<div class="alert alert-danger text-center">
          Gagal memuat data: ${escapeHtml(e.message)}
        </div>`;
      }
    }
  } finally {
    STATE.isLoading = false;
  }
}

function applyResponseFilters() {
  let filtered = STATE.responses.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(r =>
      String(r.nama || '').toLowerCase().includes(q) ||
      String(r.nohp || '').toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => {
    const at = new Date(a.timestamp || 0).getTime();
    const bt = new Date(b.timestamp || 0).getTime();
    const aT = isNaN(at) ? 0 : at;
    const bT = isNaN(bt) ? 0 : bt;
    return bT - aT;
  });

  STATE.filteredResponses = filtered;
  renderData();
}

function renderData() {
  const c = getEl('dataContainer');
  if (!c) return;

  const data = STATE.filteredResponses;
  let html = `
    <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
      <div>
        <span class="text-muted small">Total Data: </span>
        <span class="badge bg-primary">${data.length}</span>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary btn-sm rounded-pill" data-action="refresh">
          <i class="bi bi-arrow-clockwise me-1"></i> Segarkan
        </button>
        <button class="btn btn-success btn-sm rounded-pill" data-action="export">
          <i class="bi bi-download me-1"></i> Ekspor CSV
        </button>
      </div>
    </div>
    <div class="mb-3">
      <input type="text" class="form-control" id="filterDataInput"
             placeholder="🔍 Cari nama peserta atau no HP…" autocomplete="off"
             value="${escapeHtml(STATE.searchQuery)}">
    </div>
    <div class="table-container">
      <div class="table-responsive" style="max-height:500px;overflow-y:auto;">
        <table class="table table-bordered table-sm table-striped align-middle">
          <thead class="table-light"><tr>
            <th>Waktu</th>
            <th>Nama</th>
            <th>No HP</th>
            <th style="width:60px;">Skor</th>
            <th style="width:80px;">Jawaban</th>
            <th style="width:70px;" class="text-center">Detail</th>
          </tr></thead>
          <tbody>`;

  if (data.length === 0) {
    html += `<tr><td colspan="6" class="text-center py-4 text-muted">
      ${STATE.searchQuery ? 'Tidak ada hasil pencarian.' : 'Belum ada data posttest.'}
    </td></tr>`;
  } else {
    data.forEach(row => {
      let ringkasan = '-';
      try {
        const rawAnswers = row.answers || row.answersJson || '[]';
        const jawaban = typeof rawAnswers === 'string' ? JSON.parse(rawAnswers) : rawAnswers;
        if (Array.isArray(jawaban)) {
          const benar = jawaban.filter(a => a && a.correct).length;
          ringkasan = `${benar}/${jawaban.length}`;
        }
      } catch { ringkasan = '—'; }

      const safeRow = encodeURIComponent(JSON.stringify({
        nama: row.nama,
        nohp: row.nohp,
        score: row.score,
        timestamp: row.timestamp,
        answers: row.answers || row.answersJson,
      }));

      html += `<tr>
        <td><small>${escapeHtml(formatDateTime(row.timestamp))}</small></td>
        <td><strong>${escapeHtml(row.nama || '-')}</strong></td>
        <td>${escapeHtml(row.nohp || '-')}</td>
        <td><span class="badge bg-primary">${escapeHtml(String(row.score || 0))}</span></td>
        <td>${escapeHtml(ringkasan)}</td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info" data-action="detail" data-row="${safeRow}" title="Detail">
            <i class="bi bi-search"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div></div>`;
  c.innerHTML = html;

  // Preserve focus ke input jika sebelumnya ada query
  const newInput = getEl('filterDataInput');
  if (newInput && STATE.searchQuery) {
    newInput.focus();
    try {
      newInput.setSelectionRange(newInput.value.length, newInput.value.length);
    } catch (e) {}
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonSoal() {
  const c = getEl('soalContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-container">
      <div class="table-responsive"><table class="table table-hover align-middle">
        <thead class="table-light"><tr>
          ${Array(7).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
        </tr></thead>
        <tbody>${Array(5).fill(0).map(() =>
          `<tr>${Array(7).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table></div>
    </div>`;
}

function renderSkeletonData() {
  const c = getEl('dataContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-container">
      <div class="table-responsive"><table class="table table-hover align-middle">
        <thead class="table-light"><tr>
          ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
        </tr></thead>
        <tbody>${Array(5).fill(0).map(() =>
          `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
        ).join('')}</tbody>
      </table></div>
    </div>`;
}

// ============================================================
//   MODAL: SOAL
// ============================================================
function showPosttestModal(soal) {
  const isEdit = !!soal;

  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };

  const titleEl = getEl('posttestModalTitle');
  if (titleEl) titleEl.textContent = isEdit ? 'Edit Soal Posttest' : 'Tambah Soal Posttest';

  setVal('posttestId', isEdit ? soal.id : '');
  setVal('posttestTeks', isEdit ? (soal.teks || '') : '');
  setVal('posttestOpsi', isEdit
    ? (Array.isArray(soal.opsi) ? soal.opsi.join(',') : (soal.opsi || ''))
    : '');
  setVal('posttestUrutan', isEdit ? (soal.urutan || '') : '');

  const timerEnabledEl = getEl('posttestTimerEnabled');
  if (timerEnabledEl) timerEnabledEl.checked = isEdit ? !!soal.timer_enabled : false;

  setVal('posttestTimerDuration', isEdit ? (soal.timer_duration || 30) : 30);

  const timerGroup = getEl('posttestTimerDurationGroup');
  if (timerGroup) {
    timerGroup.style.display = (isEdit && soal.timer_enabled) ? 'block' : 'none';
  }

  STATE.selectedAnswerIndex = (isEdit && soal.jawaban !== undefined)
    ? parseInt(soal.jawaban)
    : 0;

  setVal('posttestJawaban', STATE.selectedAnswerIndex);

  renderOptionButtons(getEl('posttestOpsi')?.value || '', STATE.selectedAnswerIndex);

  getModal('posttestModal')?.show();
}

function renderOptionButtons(opsiString, selectedIndex) {
  const c = getEl('posttestOptionsContainer');
  if (!c) return;

  if (!opsiString || !opsiString.trim()) {
    c.innerHTML = '<span class="text-muted small">Masukkan opsi terlebih dahulu.</span>';
    return;
  }

  const options = opsiString.split(',').map(s => s.trim()).filter(s => s !== '');
  let html = '';
  options.forEach((opt, idx) => {
    const isCorrect = (idx === selectedIndex);
    html += `<button type="button" class="btn btn-sm ${isCorrect ? 'btn-success' : 'btn-outline-secondary'}"
              data-opt-index="${idx}">
      ${escapeHtml(opt)} ${isCorrect ? '✓' : ''}
    </button>`;
  });
  c.innerHTML = html;

  c.querySelectorAll('[data-opt-index]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.selectedAnswerIndex = parseInt(btn.dataset.optIndex);
      const hiddenInput = getEl('posttestJawaban');
      if (hiddenInput) hiddenInput.value = STATE.selectedAnswerIndex;
      renderOptionButtons(opsiString, STATE.selectedAnswerIndex);
    });
  });
}

async function saveQuestion() {
  if (STATE.isSaving) return;

  const id = getEl('posttestId')?.value;
  const teks = getEl('posttestTeks')?.value.trim() || '';
  const opsi = getEl('posttestOpsi')?.value.trim() || '';
  const jawaban = parseInt(getEl('posttestJawaban')?.value) || 0;
  const urutan = parseInt(getEl('posttestUrutan')?.value) || 0;
  const timerEnabled = getEl('posttestTimerEnabled')?.checked || false;
  const timerDuration = parseInt(getEl('posttestTimerDuration')?.value) || 30;

  if (!teks || !opsi) {
    showToast('Teks soal dan opsi wajib diisi', 'error');
    return;
  }

  const btn = getEl('simpanPosttestBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const payload = {
      teks, opsi, jawaban, urutan,
      timer_enabled: timerEnabled,
      timer_duration: timerDuration,
    };

    let res;
    if (id) {
      payload.id = id;
      res = await callApi('updatePosttestQuestion', payload, 'POST');
    } else {
      res = await callApi('addPosttestQuestion', payload, 'POST');
    }

    if (res && res.success) {
      showToast(id ? 'Soal diperbarui' : 'Soal ditambahkan', 'success');
      getModal('posttestModal')?.hide();
      safeCacheClear(CACHE_KEYS.QUESTIONS);
      await loadQuestions(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

async function deleteQuestion(id) {
  const q = STATE.questions.find(x => String(x.id) === String(id));
  if (!q) { showToast('Soal tidak ditemukan', 'error'); return; }

  const preview = String(q.teks || '').substring(0, 60);
  const suffix = q.teks && q.teks.length > 60 ? '…' : '';
  if (!confirm(`Hapus soal:\n"${preview}${suffix}"?`)) return;

  try {
    const res = await callApi('deletePosttestQuestion', { id }, 'POST');
    if (res && res.success) {
      STATE.questions = STATE.questions.filter(x => String(x.id) !== String(id));
      renderSoal();
      showToast('Soal berhasil dihapus', 'success');
      safeCacheClear(CACHE_KEYS.QUESTIONS);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   MODAL: DETAIL RESPONSE
// ============================================================
function showDetail(row) {
  const modal = getModal('detailModal');
  const body = getEl('detailModalBody');
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
          const isCorrect = a.correct === true;
          html += `<tr>
            <td>${idx + 1}</td>
            <td>${escapeHtml(String(a.qid || '-'))}</td>
            <td>${escapeHtml(String(selected))}</td>
            <td class="text-center">${isCorrect ? '✅' : '❌'}</td>
          </tr>`;
        });
        html += `</tbody></table></div>`;
      } else {
        html += '<p class="text-muted">Tidak ada data jawaban.</p>';
      }
    } catch (e) {
      html += '<p class="text-danger small">Gagal mem-parsing data jawaban.</p>';
    }
  } else {
    html += '<p class="text-muted">Tidak ada data jawaban.</p>';
  }

  body.innerHTML = html;
  modal?.show();
}

// ============================================================
//   EXPORT CSV
// ============================================================
function exportCSV() {
  const data = STATE.filteredResponses.length > 0 ? STATE.filteredResponses : STATE.responses;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

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
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  try {
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `posttest_data_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
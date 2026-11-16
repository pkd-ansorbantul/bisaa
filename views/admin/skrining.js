// ============================================================
// VIEW: skrining.js — Full Fix v26.1.2 Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/skrining.html
// ============================================================
// Fitur:
// ✅ Stats: total, pertanyaan, hari ini, minggu ini
// ✅ Responses: list + search + filter hasil + pagination
// ✅ Detail respons (dengan dataJson parsing)
// ✅ Delete respons — FIXED off-by-one row index
// ✅ Questions: CRUD (text + radio) + load default
// ✅ Export JSON
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
//
// v26.1.2 FIXES:
// ✅ BUG-002: Timezone inconsistency — pakai local date (bukan UTC)
// ✅ BUG-DELETE: Kirim `_rowIndex` ke backend (bukan `id`)
// ✅ Edit respons: clear messaging "hanya lokal"
// ✅ Add respons: pakai API `submitSkrining` (persist)
// ✅ Better error handling di semua handler
// ✅ Loading state pada semua tombol
// ✅ Fix stale state setelah add/delete (auto-reload)
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
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

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

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;
let isSaving = false;

const STATE = {
  skriningList: [],
  filteredList: [],
  questionList: [],
  searchQuery: '',
  hasilFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
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
    try {
      STATE.modals[id] = new bootstrap.Modal(el);
    } catch (e) {
      console.warn('[SkriningView] Gagal init modal:', id, e);
      return null;
    }
  }
  return STATE.modals[id];
}

function disposeAllModals() {
  Object.keys(STATE.modals).forEach(id => {
    try { STATE.modals[id]?.dispose?.(); } catch (e) { /* silent */ }
  });
  STATE.modals = {};
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

function formatTimestamp(ts) {
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

// ✅ FIX BUG-002: Local date helper (bukan UTC)
function getLocalDateOnly(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getHasilBadge(hasil) {
  if (hasil === 'Layak') return 'bg-success';
  if (hasil === 'Tidak Layak') return 'bg-danger';
  if (hasil === 'Perlu Tindak Lanjut') return 'bg-warning text-dark';
  return 'bg-secondary';
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[SkriningView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[SkriningView] mounted');

  // Reset state
  STATE.skriningList = [];
  STATE.filteredList = [];
  STATE.questionList = [];
  STATE.searchQuery = '';
  STATE.hasilFilter = '';
  STATE.currentPage = 1;
  isSaving = false;

  // Reset form
  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterHasil');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  renderSkeletonResponses();
  renderSkeletonQuestions();

  // Load data paralel
  await Promise.allSettled([
    loadResponses(true).catch(e => console.error('[SkriningView] loadResponses:', e)),
    loadQuestions(true).catch(e => console.error('[SkriningView] loadQuestions:', e)),
  ]);

  bindEvents();

  // Auto-refresh 30s
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
  console.log('[SkriningView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) { /* silent */ }
  });
  listeners.length = 0;

  disposeAllModals();

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
function bindEvents() {
  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterHasil');

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFiltersAndSort();
  }, 300));

  on(filterEl, 'change', function (e) {
    STATE.hasilFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(getEl('refreshDataBtn'), 'click', handleRefresh);
  on(getEl('exportDataBtn'), 'click', exportData);
  on(getEl('addSkriningBtn'), 'click', openAddModal);
  on(getEl('saveSkriningBtn'), 'click', saveSkrining);
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // Question management
  on(getEl('addQuestionBtn'), 'click', openAddQuestionModal);
  on(getEl('saveQuestionBtn'), 'click', saveQuestion);
  on(getEl('confirmDeleteQuestionBtn'), 'click', executeDeleteQuestion);
  on(getEl('loadDefaultQuestionsBtn'), 'click', loadDefaultQuestions);

  // Question type toggle
  on(getEl('questionJenis'), 'change', function () {
    const group = getEl('questionOptionsGroup');
    if (group) group.style.display = this.value === 'radio' ? 'block' : 'none';
  });
}

// ============================================================
//   STATS — FIXED timezone
// ============================================================
function renderStats() {
  const total = STATE.skriningList.length;
  const questions = STATE.questionList.length;

  // ✅ FIX: pakai local date, bukan UTC
  const today = getLocalDateOnly(new Date());

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setHours(0, 0, 0, 0);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let todayCount = 0, weekCount = 0;
  STATE.skriningList.forEach(item => {
    if (!item.timestamp) return;
    const ts = new Date(item.timestamp);
    if (isNaN(ts.getTime())) return;

    // ✅ FIX: bandingkan dengan local date
    if (getLocalDateOnly(ts) === today) todayCount++;

    if (ts >= sevenDaysAgo) weekCount++;
  });

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotal', total);
  setText('statPertanyaan', questions);
  setText('statHariIni', todayCount);
  setText('statMingguIni', weekCount);
}

// ============================================================
//   SKELETON RENDER
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
//   FILTER & SORT RESPONSES
// ============================================================
function getFilteredSkrining() {
  let filtered = STATE.skriningList.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama || '').toLowerCase().includes(q) ||
      (item.alamat || '').toLowerCase().includes(q)
    );
  }

  if (STATE.hasilFilter !== '') {
    filtered = filtered.filter(item => item.hasil === STATE.hasilFilter);
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
  STATE.filteredList = getFilteredSkrining();
  STATE.currentPage = 1;
  renderResponsesTable();
  renderStats();
}

// ============================================================
//   RENDER RESPONSES TABLE
// ============================================================
function renderResponsesTable() {
  const c = getEl('skriningTableContainer');
  if (!c) return;

  const totalItems = STATE.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;

  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = STATE.filteredList.slice(start, end);

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
    const hasFilter = STATE.searchQuery || STATE.hasilFilter;
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
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
        <td>${escapeHtml(formatTimestamp(item.timestamp))}</td>
        <td><span class="badge ${badge}">${escapeHtml(item.hasil || 'Belum')}</span></td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info me-1" data-action="detail" data-id="${safeId}" title="Lihat Detail">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit (lokal)">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus">
            <i class="bi bi-trash"></i>
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

  // Bind action buttons
  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleResponseAction);
  });
}

function handleResponseAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id;
  const page = parseInt(e.currentTarget.dataset.page);

  if (action === 'detail') viewSkrining(id);
  else if (action === 'edit') editSkrining(id);
  else if (action === 'delete') deleteSkrining(id);
  else if (action === 'goto') goToPage(page);
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderResponsesTable();
  getEl('skriningTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   RENDER QUESTIONS TABLE
// ============================================================
function renderQuestionsTable() {
  const c = getEl('questionsTableContainer');
  if (!c) return;

  if (!STATE.questionList || STATE.questionList.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center mb-0">
      Belum ada pertanyaan skrining. Klik <strong>Tambah Pertanyaan</strong> atau <strong>Muat Default</strong>.
    </div>`;
    return;
  }

  const sorted = STATE.questionList.slice().sort((a, b) =>
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
        <button class="btn btn-sm btn-outline-warning me-1" data-action="edit-q" data-id="${safeId}">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete-q" data-id="${safeId}">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;

  c.querySelectorAll('[data-action="edit-q"]').forEach(btn => {
    btn.addEventListener('click', () => editQuestion(btn.dataset.id));
  });
  c.querySelectorAll('[data-action="delete-q"]').forEach(btn => {
    btn.addEventListener('click', () => deleteQuestion(btn.dataset.id));
  });
}

// ============================================================
//   LOAD RESPONSES
// ============================================================
async function loadResponses(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    STATE.skriningList = AdminModule.getSkriningList() || [];
    applyFiltersAndSort();

    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[SkriningView] loadResponses error:', e);
    const c = getEl('skriningTableContainer');
    if (c && STATE.skriningList.length === 0) {
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

// ============================================================
//   LOAD QUESTIONS
// ============================================================
async function loadQuestions(forceRefresh = false) {
  try {
    const res = await getSkriningQuestions();
    let list = [];
    if (res && res.success && Array.isArray(res.data)) list = res.data;
    else if (Array.isArray(res)) list = res;

    STATE.questionList = list;
    renderQuestionsTable();
    renderStats();
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
  if (isSaving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    await Promise.allSettled([
      loadResponses(true),
      loadQuestions(true),
    ]);
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   DETAIL RESPONS
// ============================================================
function viewSkrining(id) {
  const item = STATE.skriningList.find(x => String(x.id) === String(id));
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
    const displayVal = key === 'timestamp' ? formatTimestamp(val) : val;
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
  getModal('detailSkriningModal')?.show();
}

// ============================================================
//   ADD / EDIT RESPONS
// ============================================================
function openAddModal() {
  getEl('editSkriningId').value = '';
  getEl('skriningNama').value = '';
  getEl('skriningAlamat').value = '';
  getEl('skriningHasil').value = 'Layak';
  getEl('skriningTanggal').value = getLocalDateOnly(new Date());
  getEl('skriningNote').value = '';
  getEl('formModalTitle').textContent = 'Tambah Skrining';
  getModal('skriningFormModal')?.show();
}

function editSkrining(id) {
  const item = STATE.skriningList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  getEl('editSkriningId').value = id;
  getEl('skriningNama').value = item.nama || '';
  getEl('skriningAlamat').value = item.alamat || '';
  getEl('skriningHasil').value = item.hasil || 'Layak';
  getEl('skriningTanggal').value = item.timestamp
    ? getLocalDateOnly(item.timestamp) : getLocalDateOnly(new Date());
  getEl('skriningNote').value = item.catatan || '';
  getEl('formModalTitle').textContent = 'Edit Skrining (Lokal)';
  getModal('skriningFormModal')?.show();
}

async function saveSkrining(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('saveSkriningBtn');
  const id = getEl('editSkriningId').value;
  const nama = getEl('skriningNama').value.trim();
  const alamat = getEl('skriningAlamat').value.trim();
  const hasil = getEl('skriningHasil').value;
  const catatan = getEl('skriningNote').value.trim();

  // Validasi
  if (!nama) { showToast('Nama wajib diisi', 'error'); return; }
  if (!alamat) { showToast('Alamat wajib diisi', 'error'); return; }

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    if (id) {
      // ✅ EDIT: lokal only (tidak ada endpoint update di backend)
      const idx = STATE.skriningList.findIndex(x => String(x.id) === String(id));
      if (idx !== -1) {
        STATE.skriningList[idx].nama = nama;
        STATE.skriningList[idx].alamat = alamat;
        STATE.skriningList[idx].hasil = hasil;
        STATE.skriningList[idx].catatan = catatan;
      }
      showToast('Data diubah di tampilan lokal. Untuk permanen, edit di Google Sheets.', 'info');
      getModal('skriningFormModal')?.hide();
      applyFiltersAndSort();
    } else {
      // ✅ ADD: pakai API submitSkrining agar persist ke backend
      const res = await submitSkrining({
        nama,
        alamat,
        hasil,
        catatan,
        // Note: timestamp akan di-set oleh backend ke waktu saat ini
      });

      if (res && res.success) {
        showToast('Data skrining berhasil ditambahkan', 'success');
        getModal('skriningFormModal')?.hide();
        // Force reload untuk dapat data baru dari backend
        await loadResponses(true);
      } else {
        throw new Error((res && res.error) || 'Gagal menambahkan');
      }
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   DELETE RESPONS — FIXED off-by-one rowIndex
// ============================================================
function deleteSkrining(id) {
  const item = STATE.skriningList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  // Simpan rowIndex untuk delete
  const rowIndex = item._rowIndex;
  if (!rowIndex) {
    showToast('Tidak bisa hapus: ID baris tidak ditemukan. Refresh data dulu.', 'warning');
    return;
  }

  getEl('deleteSkriningId').value = id;
  getEl('deleteSkriningRowIndex').value = String(rowIndex);
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('confirmDeleteBtn');
  const id = getEl('deleteSkriningId').value;
  const rowIndex = getEl('deleteSkriningRowIndex')?.value;

  if (!id) {
    showToast('Data tidak valid', 'error');
    return;
  }

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    // ✅ FIX: kirim rowIndex (bukan id) — backend expects `id` as row number
    const payloadId = rowIndex ? parseInt(rowIndex) : parseInt(id);

    const res = await deleteSkriningResponse({ id: payloadId });

    if (res && res.success) {
      showToast('Data skrining berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();

      // Remove dari state lokal
      STATE.skriningList = STATE.skriningList.filter(x => String(x.id) !== String(id));
      applyFiltersAndSort();

      // Sync ulang dari backend
      setTimeout(() => loadResponses(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   QUESTIONS CRUD
// ============================================================
function openAddQuestionModal() {
  getEl('editQuestionId').value = '';
  getEl('questionTeks').value = '';
  getEl('questionJenis').value = 'text';
  getEl('questionOpsi').value = '';
  getEl('questionUrutan').value = STATE.questionList.length + 1;
  getEl('questionModalTitle').textContent = 'Tambah Pertanyaan';
  getEl('questionOptionsGroup').style.display = 'none';
  getModal('questionFormModal')?.show();
}

function editQuestion(id) {
  const q = STATE.questionList.find(item => String(item.id) === String(id));
  if (!q) { showToast('Pertanyaan tidak ditemukan', 'error'); return; }

  getEl('editQuestionId').value = q.id;
  getEl('questionTeks').value = q.teks || '';
  getEl('questionJenis').value = q.jenis || 'text';
  getEl('questionOpsi').value = q.opsi || '';
  getEl('questionUrutan').value = q.urutan || 1;
  getEl('questionModalTitle').textContent = 'Edit Pertanyaan';
  getEl('questionOptionsGroup').style.display = q.jenis === 'radio' ? 'block' : 'none';
  getModal('questionFormModal')?.show();
}

function deleteQuestion(id) {
  const q = STATE.questionList.find(item => String(item.id) === String(id));
  if (!q) { showToast('Pertanyaan tidak ditemukan', 'error'); return; }

  getEl('deleteQuestionId').value = id;
  getModal('deleteQuestionModal')?.show();
}

async function saveQuestion(e) {
  if (isSaving) return;

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

  isSaving = true;
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
      getModal('questionFormModal')?.hide();
      await loadQuestions(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

async function executeDeleteQuestion(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('confirmDeleteQuestionBtn');
  const id = getEl('deleteQuestionId').value;
  if (!id) return;

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await deleteSkriningQuestion(id);
    if (res && res.success) {
      showToast('Pertanyaan berhasil dihapus', 'success');
      getModal('deleteQuestionModal')?.hide();
      await loadQuestions(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   LOAD DEFAULT QUESTIONS
// ============================================================
async function loadDefaultQuestions(e) {
  if (isSaving) return;

  const confirmed = confirm(
    '⚠️ PERHATIAN\n\n' +
    'Tindakan ini akan:\n' +
    '1. Menghapus SEMUA pertanyaan yang ada\n' +
    '2. Memuat 9 pertanyaan default\n\n' +
    'Data jawaban peserta TIDAK akan terhapus.\n\n' +
    'Lanjutkan?'
  );
  if (!confirmed) return;

  const btn = e.currentTarget || getEl('loadDefaultQuestionsBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memproses...');

  try {
    let deletedCount = 0;
    let addedCount = 0;
    const errors = [];

    // Hapus semua pertanyaan
    for (const q of STATE.questionList) {
      try {
        const res = await deleteSkriningQuestion(q.id);
        if (res && res.success) deletedCount++;
      } catch (err) {
        errors.push(`Delete ${q.id}: ${err.message}`);
      }
    }

    // Tambah pertanyaan default
    for (const q of DEFAULT_QUESTIONS) {
      try {
        const res = await addSkriningQuestion(q);
        if (res && res.success) addedCount++;
      } catch (err) {
        errors.push(`Add: ${err.message}`);
      }
    }

    if (errors.length > 0) {
      showToast(`Selesai dengan ${errors.length} error. Cek console.`, 'warning');
      console.warn('[SkriningView] loadDefaultQuestions errors:', errors);
    } else {
      showToast(`Berhasil: ${deletedCount} dihapus, ${addedCount} ditambahkan`, 'success');
    }

    await loadQuestions(true);
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = STATE.filteredList.length > 0 ? STATE.filteredList : STATE.skriningList;
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

  try {
    const json = JSON.stringify(out, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `skrining_export_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
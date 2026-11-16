// ============================================================
// VIEW: sesi-absen.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/sesi-absen.html
// ============================================================
// Fitur:
// ✅ CRUD sesi (create/edit/delete)
// ✅ Generate QR code per sesi (dengan token unik)
// ✅ Regenerate QR token (invalidasi token lama)
// ✅ Toggle buka/tutup sesi
// ✅ Set password sesi opsional
// ✅ Lihat daftar hadir per sesi
// ✅ Search & sort
// ✅ Pagination
// ✅ Export JSON
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + cleanup on unmount
// ============================================================

import { showToast, escapeHtml, callApi } from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let qrCanvasRef = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
  sesiList: [],
  filteredList: [],
  searchQuery: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: null,
  sortDirection: 'asc',
  pendingDeleteId: null,
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
    try { STATE.modals[id]?.dispose?.(); } catch (e) { /* silent */ }
  });
  STATE.modals = {};
}

function generateQrToken() {
  return 'qr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function formatDateTime(dateStr) {
  if (!dateStr || dateStr === '') return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleString('id-ID', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return String(dateStr); }
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[SesiAbsenView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[SesiAbsenView] mounted');

  // Reset state
  STATE.sesiList = [];
  STATE.filteredList = [];
  STATE.searchQuery = '';
  STATE.currentPage = 1;
  STATE.sortColumn = null;
  STATE.sortDirection = 'asc';
  STATE.pendingDeleteId = null;
  qrCanvasRef = null;

  renderSkeleton();

  // Load data
  await loadSesiAbsen(false);

  // Bind events
  bindAllEvents();

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    refreshDataSilently().finally(() => { isRefreshing = false; });
  }, 30000);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[SesiAbsenView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  // Listeners
  listeners.forEach(({ el, ev, handler, options }) => {
    try { el.removeEventListener(ev, handler, options); } catch (e) {}
  });
  listeners.length = 0;

  // Modals
  disposeAllModals();

  // QR canvas ref
  qrCanvasRef = null;

  // Bootstrap artifact cleanup
  try {
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  } catch (e) {}
}

// ============================================================
//   BIND ALL EVENTS
// ============================================================
function bindAllEvents() {
  const searchEl = getEl('searchInput');
  const debouncedSearch = debounce(function () {
    STATE.searchQuery = searchEl ? searchEl.value : '';
    applyFiltersAndSort();
  }, 300);

  on(searchEl, 'input', debouncedSearch);

  on(getEl('addSesiAbsenBtn'), 'click', openAddModal);
  on(getEl('exportDataBtn'), 'click', exportData);
  on(getEl('refreshDataBtn'), 'click', handleRefreshClick);
  on(getEl('saveSesiAbsenBtn'), 'click', saveSesiAbsen);
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);
  on(getEl('downloadQRSesiBtn'), 'click', downloadQrPng);

  // Password visibility toggle (delegation)
  on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });
}

// ============================================================
//   REFRESH HANDLER
// ============================================================
async function handleRefreshClick() {
  const btn = getEl('refreshDataBtn');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
  }
  try {
    await loadSesiAbsen(true);
    showToast('Data disegarkan', 'success');
  } catch (e) {
    showToast('Gagal menyegarkan: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

async function refreshDataSilently() {
  try {
    await AdminModule.loadAllData(false);
    const fresh = AdminModule.getSesiList() || [];
    const cleaned = normalizeSesiList(fresh);
    if (JSON.stringify(STATE.sesiList) !== JSON.stringify(cleaned)) {
      STATE.sesiList = cleaned;
      applyFiltersAndSort();
    }
  } catch (e) {
    // silent
  }
}

// ============================================================
//   LOAD DATA
// ============================================================
function normalizeSesiList(freshData) {
  return (freshData || []).map(item => {
    let isOpen = false;
    const v = item.submission_open;
    if (typeof v === 'boolean') isOpen = v;
    else if (typeof v === 'string') isOpen = v.trim().toLowerCase() === 'true';

    // Fallback ke 'aktif' jika submission_open kosong
    if (!isOpen && item.aktif !== undefined && item.aktif !== null) {
      let isAktif = false;
      if (typeof item.aktif === 'boolean') isAktif = item.aktif;
      else if (typeof item.aktif === 'string') isAktif = item.aktif.trim().toLowerCase() === 'true';
      if (isAktif) isOpen = true;
    }
    return { ...item, submission_open: isOpen };
  });
}

async function loadSesiAbsen(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    let freshData = AdminModule.getSesiList() || [];
    STATE.sesiList = normalizeSesiList(freshData);

    STATE.searchQuery = '';
    const searchEl = getEl('searchInput');
    if (searchEl) searchEl.value = '';

    applyFiltersAndSort();

    if (cacheEl) { cacheEl.textContent = 'Live'; cacheEl.className = 'cache-status live'; }
  } catch (e) {
    console.error('[SesiAbsenView] load error:', e);
    if (STATE.sesiList.length > 0) {
      applyFiltersAndSort();
      showToast('Error: ' + e.message + ' — menampilkan data lama', 'warning');
    } else {
      const c = getEl('sesiAbsenTableContainer');
      if (c) c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    if (cacheEl) { cacheEl.textContent = 'Error'; cacheEl.className = 'cache-status offline'; }
  }
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('sesiAbsenTableContainer');
  if (!c) return;
  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>`;
  for (let i = 0; i < 7; i++) {
    html += `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`;
  }
  html += `</tr></thead><tbody>`;
  for (let r = 0; r < 5; r++) {
    html += '<tr>';
    for (let i = 0; i < 7; i++) {
      html += `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`;
    }
    html += '</tr>';
  }
  html += `</tbody></table></div>`;
  c.innerHTML = html;
}

// ============================================================
//   RENDER: TABLE
// ============================================================
function renderTable() {
  const c = getEl('sesiAbsenTableContainer');
  if (!c) return;

  const data = STATE.filteredList;
  const totalItems = data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;

  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = data.slice(start, end);

  const arrow = (col) => {
    if (STATE.sortColumn !== col) return '↕';
    return STATE.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th data-sort="nama" style="cursor:pointer;">Nama Sesi ${arrow('nama')}</th>
      <th data-sort="waktu_mulai" style="cursor:pointer;">Waktu Mulai ${arrow('waktu_mulai')}</th>
      <th data-sort="waktu_selesai" style="cursor:pointer;">Waktu Selesai ${arrow('waktu_selesai')}</th>
      <th data-sort="submission_open" style="cursor:pointer;">Status ${arrow('submission_open')}</th>
      <th style="width:180px;">QR Sesi</th>
      <th style="width:290px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    html += `<tr><td colspan="7" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      ${STATE.searchQuery ? 'Tidak ada hasil pencarian.' : 'Tidak ada data sesi absen.'}
    </td></tr>`;
  } else {
    pageData.forEach((item, index) => {
      const globalIdx = start + index + 1;
      const isOpen = item.submission_open === true;
      const statusBadge = isOpen ? 'bg-success' : 'bg-danger';
      const statusLabel = isOpen ? 'Buka' : 'Tutup';
      const safeId = escapeHtml(String(item.id));

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
        <td>${escapeHtml(formatDateTime(item.waktu_mulai))}</td>
        <td>${escapeHtml(formatDateTime(item.waktu_selesai))}</td>
        <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td>
          <button class="btn btn-sm btn-outline-dark" data-action="qr" data-id="${safeId}" title="Tampilkan QR">
            <i class="bi bi-qr-code"></i> QR
          </button>
          <button class="btn btn-sm btn-outline-secondary ms-1" data-action="regen" data-id="${safeId}" title="Regenerate Token">
            <i class="bi bi-arrow-repeat"></i>
          </button>
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-info" data-action="view" data-id="${safeId}" title="Detail">
            <i class="bi bi-eye"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning" data-action="edit" data-id="${safeId}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-success" data-action="attendance" data-id="${safeId}" title="Daftar Hadir">
            <i class="bi bi-people"></i>
          </button>
          <button class="btn btn-sm btn-outline-${isOpen ? 'warning' : 'success'}" data-action="toggle" data-id="${safeId}" title="Toggle Status">
            ${isOpen ? 'Tutup' : 'Buka'}
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
    <div class="small text-muted">
      Menampilkan ${data.length > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data
    </div>
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
    html += `<button class="btn btn-sm ${i === STATE.currentPage ? 'btn-primary' : 'btn-outline-secondary'}" data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += `<button class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    html += `<button class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

  // Event delegation
  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTableAction);
  });
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

// ============================================================
//   TABLE ACTIONS
// ============================================================
function handleTableAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id;
  const page = e.currentTarget.dataset.page;

  switch (action) {
    case 'qr':          return generateQRSesi(id);
    case 'regen':       return regenerateQRSesi(id);
    case 'view':        return viewSesiAbsen(id);
    case 'edit':        return editSesiAbsen(id);
    case 'attendance':  return viewAttendance(id);
    case 'toggle':      return toggleSesi(id);
    case 'delete':      return deleteSesiAbsen(id);
    case 'goto':        return goToPage(parseInt(page));
  }
}

function handleSort(col) {
  if (STATE.sortColumn === col) {
    STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortColumn = col;
    STATE.sortDirection = 'asc';
  }
  STATE.currentPage = 1;
  applyFiltersAndSort();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
}

// ============================================================
//   FILTER & SORT
// ============================================================
function applyFiltersAndSort() {
  let filtered = STATE.sesiList;

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      (item.nama || '').toLowerCase().includes(q)
    );
  }

  if (STATE.sortColumn) {
    filtered = filtered.slice().sort((a, b) => {
      let va = a[STATE.sortColumn];
      let vb = b[STATE.sortColumn];
      if (typeof va === 'boolean') va = va ? 1 : 0;
      if (typeof vb === 'boolean') vb = vb ? 1 : 0;
      va = (va ?? '').toString().toLowerCase();
      vb = (vb ?? '').toString().toLowerCase();
      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  STATE.filteredList = filtered;
  STATE.currentPage = 1;
  renderTable();
}

// ============================================================
//   CRUD
// ============================================================
function openAddModal() {
  getEl('editSesiAbsenId').value = '';
  getEl('sesiNama').value = '';
  getEl('sesiWaktuMulai').value = '';
  getEl('sesiWaktuSelesai').value = '';
  getEl('sesiPassword').value = '';
  getEl('sesiAktif').checked = true;
  getEl('formModalTitle').textContent = 'Tambah Sesi Absen';
  getModal('sesiAbsenFormModal')?.show();
}

function editSesiAbsen(id) {
  const item = STATE.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const toLocal = (dateStr) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  };

  getEl('editSesiAbsenId').value = id;
  getEl('sesiNama').value = item.nama || '';
  getEl('sesiWaktuMulai').value = toLocal(item.waktu_mulai);
  getEl('sesiWaktuSelesai').value = toLocal(item.waktu_selesai);
  getEl('sesiPassword').value = '';
  getEl('sesiAktif').checked = item.submission_open === true;
  getEl('formModalTitle').textContent = 'Edit Sesi Absen';
  getModal('sesiAbsenFormModal')?.show();
}

function viewSesiAbsen(id) {
  const item = STATE.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const content = getEl('detailContent');
  if (!content) return;
  content.innerHTML = `
    <div class="list-group list-group-flush">
      <div class="list-group-item py-3"><strong>Nama Sesi:</strong> ${escapeHtml(item.nama || '-')}</div>
      <div class="list-group-item py-3"><strong>Waktu Mulai:</strong> ${escapeHtml(formatDateTime(item.waktu_mulai))}</div>
      <div class="list-group-item py-3"><strong>Waktu Selesai:</strong> ${escapeHtml(formatDateTime(item.waktu_selesai))}</div>
      <div class="list-group-item py-3"><strong>Status:</strong> ${item.submission_open ? '✅ Buka' : '❌ Tutup'}</div>
      <div class="list-group-item py-3"><strong>Password:</strong> ${item.password || item.passwordHash ? '🔒 Terproteksi' : '🔓 Tanpa password'}</div>
      <div class="list-group-item py-3"><strong>Token QR:</strong> <code style="word-break:break-all; font-size:0.8rem;">${escapeHtml(item.qrToken || 'Belum ada')}</code></div>
    </div>`;
  getModal('detailSesiAbsenModal')?.show();
}

function deleteSesiAbsen(id) {
  STATE.pendingDeleteId = id;
  const item = STATE.sesiList.find(i => String(i.id) === String(id));
  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = item ? (item.nama || '-') : '—';
  getEl('deleteSesiAbsenId').value = id;
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const id = getEl('deleteSesiAbsenId').value;
  if (!id) return;

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await AdminModule.deleteSesiAbsen(id);
    if (res.success) {
      STATE.sesiList = STATE.sesiList.filter(i => String(i.id) !== String(id));
      applyFiltersAndSort();
      showToast('Sesi absen berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();
    } else {
      throw new Error(res.error || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.pendingDeleteId = null;
  }
}

async function saveSesiAbsen() {
  const id = getEl('editSesiAbsenId').value;
  const nama = getEl('sesiNama').value.trim();
  const waktuMulai = getEl('sesiWaktuMulai').value;
  const waktuSelesai = getEl('sesiWaktuSelesai').value;
  const password = getEl('sesiPassword').value;
  const aktif = getEl('sesiAktif').checked;

  if (!nama) { showToast('Nama sesi wajib diisi', 'error'); return; }

  const btn = getEl('saveSesiAbsenBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    let res;
    if (id) {
      res = await AdminModule.updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password);
    } else {
      res = await AdminModule.addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password);
    }

    if (res.success) {
      showToast(id ? 'Sesi berhasil diperbarui' : 'Sesi berhasil ditambahkan', 'success');
      getModal('sesiAbsenFormModal')?.hide();
      await loadSesiAbsen(true);
    } else {
      throw new Error(res.error || 'Gagal menyimpan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function toggleSesi(id) {
  const item = STATE.sesiList.find(i => String(i.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const newState = !(item.submission_open === true);
  if (!confirm(`Ubah status sesi "${item.nama}" menjadi ${newState ? 'BUKA' : 'TUTUP'}?`)) return;

  try {
    const res = await AdminModule.toggleAttendanceSession(id, newState);
    if (res.success) {
      item.submission_open = newState;
      applyFiltersAndSort();
      showToast(`Sesi ${newState ? 'dibuka' : 'ditutup'}`, 'success');
    } else {
      throw new Error(res.error || 'Gagal mengubah status');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   QR GENERATION
// ============================================================
async function generateQRSesi(sesiId) {
  const item = STATE.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  // Ensure token
  if (!item.qrToken) {
    try {
      const res = await AdminModule.regenerateQRSesi(sesiId);
      if (res.success) item.qrToken = res.qrToken;
      else item.qrToken = generateQrToken();
    } catch {
      item.qrToken = generateQrToken();
    }
  }

  if (typeof qrcode !== 'function') {
    showToast('Library QR tidak tersedia', 'error');
    return;
  }

  try {
    const absenUrl = `${window.location.origin}/bisaa/absen.html?sesi_id=${encodeURIComponent(sesiId)}&token=${encodeURIComponent(item.qrToken)}`;
    const qr = qrcode(0, 'M');
    qr.addData(absenUrl);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = 8;
    const margin = 16;
    const size = moduleCount * cellSize + margin * 2;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < moduleCount; row++) {
      for (let col = 0; col < moduleCount; col++) {
        if (qr.isDark(row, col)) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
        }
      }
    }

    const container = getEl('qrSesiCanvasContainer');
    if (!container) return;
    container.innerHTML = '';

    canvas.style.border = '2px solid #e2e8f0';
    canvas.style.borderRadius = '16px';
    canvas.style.padding = '12px';
    canvas.style.background = 'white';
    canvas.style.maxWidth = '280px';
    container.appendChild(canvas);
    qrCanvasRef = canvas;

    const dataText = getEl('qrSesiDataText');
    if (dataText) {
      dataText.innerHTML = `
        <strong>Sesi:</strong> ${escapeHtml(item.nama)}<br>
        <strong>ID Sesi:</strong> ${escapeHtml(String(sesiId))}<br>
        <span class="text-success">✨ Scan QR ini untuk absen tanpa password</span><br>
        <span class="text-muted small">Token: <code>${escapeHtml(item.qrToken)}</code></span>
      `;
    }

    getModal('qrSesiModal')?.show();
  } catch (e) {
    showToast('Gagal generate QR: ' + e.message, 'error');
  }
}

async function regenerateQRSesi(sesiId) {
  const item = STATE.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (!confirm(`Regenerate QR untuk sesi "${item.nama}"? QR lama tidak akan berlaku lagi.`)) return;

  try {
    const res = await AdminModule.regenerateQRSesi(sesiId);
    if (res.success) {
      item.qrToken = res.qrToken;
      applyFiltersAndSort();
      showToast('QR berhasil diregenerasi', 'success');
    } else {
      throw new Error(res.error || 'Gagal regenerate');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

function downloadQrPng() {
  if (!qrCanvasRef) { showToast('QR belum tersedia', 'warning'); return; }
  try {
    const link = document.createElement('a');
    link.download = `QR_Sesi_${Date.now()}.png`;
    link.href = qrCanvasRef.toDataURL('image/png');
    link.click();
    showToast('QR berhasil diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh QR', 'error');
  }
}

// ============================================================
//   ATTENDANCE LIST
// ============================================================
async function viewAttendance(sesiId) {
  const item = STATE.sesiList.find(i => String(i.id) === String(sesiId));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const label = getEl('attendanceModalLabel');
  if (label) {
    label.innerHTML = `<i class="bi bi-people me-2"></i>Daftar Hadir — ${escapeHtml(item.nama)}`;
  }
  const body = getEl('attendanceModalBody');
  if (body) {
    body.innerHTML = `<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>`;
  }

  getModal('attendanceModal')?.show();

  try {
    const res = await callApi('getAttendanceBySesi', { sesiId }, 'GET');
    const attendees = (res && res.success && Array.isArray(res.data)) ? res.data : [];

    const bodyEl = getEl('attendanceModalBody');
    if (!bodyEl) return;

    if (attendees.length === 0) {
      bodyEl.innerHTML = `<div class="alert alert-info text-center mb-0">
        <i class="bi bi-info-circle me-1"></i>Belum ada peserta yang hadir di sesi ini.
      </div>`;
      return;
    }

    let html = `<div class="mb-2 small text-muted">Total <strong>${attendees.length}</strong> peserta hadir</div>
      <div class="list-group">`;
    attendees.forEach((a, i) => {
      const ts = a.timestamp ? new Date(a.timestamp).toLocaleString('id-ID') : '-';
      html += `<div class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <strong>${i + 1}. ${escapeHtml(a.nama || '-')}</strong>
          ${a.pesertaId ? `<span class="badge bg-secondary ms-2">ID: ${escapeHtml(String(a.pesertaId))}</span>` : ''}
          <div class="small text-muted mt-1"><i class="bi bi-clock me-1"></i>${escapeHtml(ts)}</div>
        </div>
        ${a.signatureDriveId
          ? `<a href="https://drive.google.com/file/d/${a.signatureDriveId}/view" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary">
              <i class="bi bi-eye"></i> TTD
            </a>`
          : ''}
      </div>`;
    });
    html += `</div>`;
    bodyEl.innerHTML = html;
  } catch (e) {
    const bodyEl = getEl('attendanceModalBody');
    if (bodyEl) {
      bodyEl.innerHTML = `<div class="alert alert-danger mb-0">Gagal memuat: ${escapeHtml(e.message)}</div>`;
    }
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = STATE.filteredList.length > 0 ? STATE.filteredList : STATE.sesiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const exportArr = data.map(item => ({
    id: item.id,
    nama: item.nama,
    waktu_mulai: item.waktu_mulai,
    waktu_selesai: item.waktu_selesai,
    aktif: item.submission_open,
    qrToken: item.qrToken,
  }));

  try {
    const json = JSON.stringify(exportArr, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sesi_absen_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
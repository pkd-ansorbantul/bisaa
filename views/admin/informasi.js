// ============================================================
// VIEW: informasi.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/informasi.html
// ============================================================
// Fitur:
// ✅ CRUD informasi/flyer (add/edit/delete)
// ✅ Search debounced
// ✅ Filter jenis (timeline/flyer)
// ✅ Filter status (aktif/selesai)
// ✅ Sort (jenis, judul, tanggal, urutan, status)
// ✅ Pagination
// ✅ Toggle status (aktif ↔ selesai)
// ✅ Export JSON
// ✅ Usulan PAC (approve/reject) dengan modal konfirmasi
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup
// ============================================================

import { callApi, showToast, escapeHtml } from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
  informasiList: [],
  filteredList: [],
  usulanList: [],
  searchQuery: '',
  jenisFilter: '',
  statusFilter: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: 'createdAt',
  sortDirection: 'desc',
  isEditing: false,
  isSaving: false,
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
    try { STATE.modals[id]?.dispose?.(); } catch (e) {}
  });
  STATE.modals = {};
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  try {
    const s = String(dateStr);
    const d = s.length === 10 ? new Date(s + 'T00:00:00') : new Date(s);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '-'; }
}

function getStatusBadge(status) {
  return String(status || 'aktif').toLowerCase() === 'selesai' ? 'bg-success' : 'bg-primary';
}

function getStatusLabel(status) {
  return String(status || 'aktif').toLowerCase() === 'selesai' ? '✅ Selesai' : '🔄 Aktif';
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[InformasiView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[InformasiView] mounted');

  // Reset state
  STATE.informasiList = [];
  STATE.filteredList = [];
  STATE.usulanList = [];
  STATE.searchQuery = '';
  STATE.jenisFilter = '';
  STATE.statusFilter = '';
  STATE.currentPage = 1;
  STATE.sortColumn = 'createdAt';
  STATE.sortDirection = 'desc';
  STATE.isEditing = false;
  STATE.isSaving = false;
  STATE.pendingDeleteId = null;

  resetForm();

  // Reset filter form
  const searchEl = getEl('searchInput');
  const jenisEl = getEl('filterJenis');
  const statusEl = getEl('filterStatus');
  if (searchEl) searchEl.value = '';
  if (jenisEl) jenisEl.value = '';
  if (statusEl) statusEl.value = '';

  renderSkeletonTable();
  renderSkeletonUsulan();

  await Promise.all([
    loadInformasi(true).catch(e => console.error('loadInformasi:', e)),
    loadUsulan().catch(e => console.error('loadUsulan:', e)),
  ]);

  bindEvents();

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    Promise.all([
      loadInformasi(false).catch(() => {}),
      loadUsulan().catch(() => {}),
    ]).finally(() => { isRefreshing = false; });
  }, 30000);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[InformasiView] unmounted');

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
  const searchEl = getEl('searchInput');
  const jenisEl = getEl('filterJenis');
  const statusEl = getEl('filterStatus');

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFiltersAndSort();
  }, 300));

  on(jenisEl, 'change', function (e) {
    STATE.jenisFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(statusEl, 'change', function (e) {
    STATE.statusFilter = e.target.value;
    applyFiltersAndSort();
  });

  on(getEl('infoForm'), 'submit', submitInfoForm);
  on(getEl('cancelEditBtn'), 'click', resetForm);

  on(getEl('exportDataBtn'), 'click', exportData);

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await Promise.all([loadInformasi(true), loadUsulan()]);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  on(getEl('refreshUsulanBtn'), 'click', function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    loadUsulan().finally(() => {
      btn.disabled = false;
      btn.innerHTML = original;
    });
  });

  on(getEl('confirmDeleteBtn'), 'click', executeDelete);
  on(getEl('usulanActionBtn'), 'click', executeUsulanAction);
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonTable() {
  const c = getEl('informasiTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(9).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(5).fill(0).map(() =>
        `<tr>${Array(9).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

function renderSkeletonUsulan() {
  const c = getEl('usulanTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-sm align-middle">
      <thead class="table-light"><tr>
        ${Array(6).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(3).fill(0).map(() =>
        `<tr>${Array(6).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFilteredInformasi() {
  let arr = STATE.informasiList.slice();

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    arr = arr.filter(item =>
      String(item.judul || '').toLowerCase().includes(q) ||
      String(item.deskripsi || '').toLowerCase().includes(q)
    );
  }

  if (STATE.jenisFilter !== '') {
    arr = arr.filter(item => String(item.jenis || '').toLowerCase() === STATE.jenisFilter);
  }

  if (STATE.statusFilter !== '') {
    arr = arr.filter(item => String(item.status || 'aktif').toLowerCase() === STATE.statusFilter);
  }

  if (STATE.sortColumn) {
    arr.sort((a, b) => {
      let va = a[STATE.sortColumn];
      let vb = b[STATE.sortColumn];

      if (STATE.sortColumn === 'createdAt' || STATE.sortColumn === 'timestamp') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else if (STATE.sortColumn === 'urutan') {
        va = parseInt(va) || 0;
        vb = parseInt(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }

      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  return arr;
}

function applyFiltersAndSort() {
  STATE.filteredList = getFilteredInformasi();
  STATE.currentPage = 1;
  renderTable();
}

// ============================================================
//   RENDER TABLE INFORMASI
// ============================================================
function renderTable() {
  const c = getEl('informasiTableContainer');
  if (!c) return;

  const totalItems = STATE.filteredList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;

  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = STATE.filteredList.slice(start, end);

  const arrow = (col) => {
    if (STATE.sortColumn !== col) return '↕';
    return STATE.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th style="cursor:pointer;" data-sort="jenis">Jenis ${arrow('jenis')}</th>
      <th style="cursor:pointer;" data-sort="judul">Judul ${arrow('judul')}</th>
      <th>Deskripsi</th>
      <th style="cursor:pointer;" data-sort="tanggal_mulai">Tanggal & Lokasi ${arrow('tanggal_mulai')}</th>
      <th>Gambar</th>
      <th style="cursor:pointer;" data-sort="urutan">Urutan ${arrow('urutan')}</th>
      <th style="cursor:pointer;" data-sort="status">Status ${arrow('status')}</th>
      <th style="width:200px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = STATE.searchQuery || STATE.jenisFilter || STATE.statusFilter;
    html += `<tr><td colspan="9" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      Tidak ada data informasi${hasFilter ? ' sesuai filter' : ''}.
    </td></tr>`;
  } else {
    pageData.forEach((item, idx) => {
      const globalIdx = start + idx + 1;
      const isFlyer = String(item.jenis || '').toLowerCase() === 'flyer';
      const safeId = escapeHtml(String(item.id || ''));

      let tanggal = item.tanggal_mulai ? formatDate(item.tanggal_mulai) : '';
      if (item.tanggal_akhir) tanggal += ' - ' + formatDate(item.tanggal_akhir);
      const lokasi = item.lokasi
        ? `<br><small class="text-muted"><i class="bi bi-geo-alt"></i> ${escapeHtml(item.lokasi)}</small>`
        : '';

      let preview = '-';
      if (isFlyer && item.url) {
        const thumbUrl = `https://lh3.googleusercontent.com/d/${escapeHtml(item.url)}=w100`;
        const fullUrl = `https://drive.google.com/file/d/${escapeHtml(item.url)}/view`;
        preview = `<a href="${fullUrl}" target="_blank" rel="noopener">
          <img src="${thumbUrl}" alt="flyer" class="border rounded"
               style="max-width:80px;max-height:60px;object-fit:cover;cursor:pointer;"
               onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';">
          <i class="bi bi-image" style="display:none;font-size:1.5rem;color:#94a3b8;"></i>
        </a>`;
      }

      const badge = getStatusBadge(item.status);
      const statusLabel = getStatusLabel(item.status);
      const isSelesai = String(item.status || '').toLowerCase() === 'selesai';

      html += `<tr>
        <td>${globalIdx}</td>
        <td><span class="badge ${isFlyer ? 'bg-info text-dark' : 'bg-primary'}">${isFlyer ? 'Flyer' : 'Timeline'}</span></td>
        <td><strong>${escapeHtml(item.judul || '-')}</strong></td>
        <td><small>${escapeHtml(item.deskripsi || '-')}</small></td>
        <td>${tanggal || '-'}${lokasi}</td>
        <td>${preview}</td>
        <td>${escapeHtml(String(item.urutan || ''))}</td>
        <td><span class="badge ${badge}">${statusLabel}</span></td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-warning me-1" data-action="edit" data-id="${safeId}" title="Edit">
            <i class="bi bi-pencil"></i>
          </button>
          <button class="btn btn-sm btn-outline-${isSelesai ? 'success' : 'secondary'} me-1"
                  data-action="toggle" data-id="${safeId}" title="${isSelesai ? 'Aktifkan' : 'Tandai Selesai'}">
            <i class="bi ${isSelesai ? 'bi-arrow-counterclockwise' : 'bi-check-circle'}"></i>
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

  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTableAction);
  });
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

function handleTableAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id;
  const page = parseInt(e.currentTarget.dataset.page);

  switch (action) {
    case 'edit':    return editInfo(id);
    case 'toggle':  return toggleStatus(id);
    case 'delete':  return confirmDelete(id);
    case 'goto':    return goToPage(page);
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
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredList.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
}

// ============================================================
//   RENDER TABLE USULAN
// ============================================================
function renderUsulanTable() {
  const c = getEl('usulanTableContainer');
  if (!c) return;

  if (!STATE.usulanList || STATE.usulanList.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center mb-0 small">
      Tidak ada usulan pending saat ini.
    </div>`;
    return;
  }

  let html = `<div class="table-responsive"><table class="table table-sm table-hover align-middle">
    <thead class="table-light"><tr>
      <th>Nama</th>
      <th>Usulan (PAC)</th>
      <th>Tanggal</th>
      <th>Lokasi</th>
      <th>No HP</th>
      <th style="width:160px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  STATE.usulanList.forEach(u => {
    let tgl = u.tanggal_mulai ? formatDate(u.tanggal_mulai) : '';
    if (u.tanggal_akhir) tgl += ' - ' + formatDate(u.tanggal_akhir);
    const safeId = escapeHtml(String(u.id || ''));
    html += `<tr>
      <td>${escapeHtml(u.nama || '-')}</td>
      <td>${escapeHtml(u.usulan || '-')}</td>
      <td><small>${tgl || '-'}</small></td>
      <td>${escapeHtml(u.lokasi || '-')}</td>
      <td>${escapeHtml(u.no_hp || '-')}</td>
      <td class="text-center">
        <button class="btn btn-sm btn-success me-1" data-usulan-action="approve" data-id="${safeId}" title="Setujui">
          <i class="bi bi-check-circle"></i> ACC
        </button>
        <button class="btn btn-sm btn-danger" data-usulan-action="reject" data-id="${safeId}" title="Tolak">
          <i class="bi bi-x-circle"></i> Tolak
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;

  c.querySelectorAll('[data-usulan-action]').forEach(btn => {
    btn.addEventListener('click', () => openUsulanActionModal(btn.dataset.id, btn.dataset.usulanAction));
  });
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadInformasi(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    STATE.informasiList = AdminModule.getInformasiList() || [];
    applyFiltersAndSort();
    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[InformasiView] loadInformasi error:', e);
    const c = getEl('informasiTableContainer');
    if (c) {
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

async function loadUsulan() {
  try {
    const res = await callApi('getUsulanList', {}, 'GET');
    const list = Array.isArray(res) ? res : (res?.data || []);
    STATE.usulanList = list.filter(u => String(u.status || '').toLowerCase() === 'pending');
    renderUsulanTable();
  } catch (e) {
    console.warn('[InformasiView] loadUsulan error:', e);
    const c = getEl('usulanTableContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-info text-center mb-0 small">Gagal memuat usulan.</div>`;
    }
  }
}

// ============================================================
//   FORM SUBMIT
// ============================================================
function resetForm() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('editId', '');
  setVal('judulItem', '');
  setVal('deskripsiItem', '');
  setVal('urutanItem', '0');
  setVal('tanggalMulaiItem', '');
  setVal('tanggalAkhirItem', '');
  setVal('lokasiItem', '');
  setVal('fileItem', '');

  const titleEl = getEl('formTitle');
  if (titleEl) titleEl.textContent = 'Tambah Jadwal / Flyer';

  const msgEl = getEl('formMessage');
  if (msgEl) msgEl.innerHTML = '';

  const preview = getEl('fileEditPreview');
  if (preview) preview.style.display = 'none';

  STATE.isEditing = false;
}

function editInfo(id) {
  const item = STATE.informasiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('editId', id);
  setVal('judulItem', item.judul || '');
  setVal('deskripsiItem', item.deskripsi || '');
  setVal('urutanItem', item.urutan || 0);
  setVal('tanggalMulaiItem', item.tanggal_mulai || '');
  setVal('tanggalAkhirItem', item.tanggal_akhir || '');
  setVal('lokasiItem', item.lokasi || '');
  setVal('fileItem', '');

  const titleEl = getEl('formTitle');
  if (titleEl) titleEl.textContent = 'Edit Jadwal / Flyer';

  const msgEl = getEl('formMessage');
  if (msgEl) msgEl.innerHTML = '';

  const preview = getEl('fileEditPreview');
  const previewName = getEl('fileEditPreviewName');
  if (item.url && String(item.jenis).toLowerCase() === 'flyer') {
    if (preview) preview.style.display = 'block';
    if (previewName) {
      previewName.innerHTML = `<a href="https://drive.google.com/file/d/${escapeHtml(item.url)}/view" target="_blank" rel="noopener">Lihat flyer</a>`;
    }
  } else {
    if (preview) preview.style.display = 'none';
  }

  STATE.isEditing = true;
  getEl('infoForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function submitInfoForm(e) {
  e.preventDefault();
  if (STATE.isSaving) return;

  const id = getEl('editId').value;
  const judul = getEl('judulItem').value.trim();
  const deskripsi = getEl('deskripsiItem').value.trim();
  const urutan = parseInt(getEl('urutanItem').value) || 0;
  const tanggalMulai = getEl('tanggalMulaiItem').value;
  const tanggalAkhir = getEl('tanggalAkhirItem').value;
  const lokasi = getEl('lokasiItem').value.trim();
  const fileInput = getEl('fileItem');
  const msgEl = getEl('formMessage');

  if (!judul || !tanggalMulai) {
    if (msgEl) msgEl.innerHTML = '<div class="alert alert-danger mb-0">Judul dan tanggal mulai wajib diisi.</div>';
    return;
  }

  let fileData = null;
  let fileName = null;
  if (fileInput && fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.size > 2 * 1024 * 1024) {
      if (msgEl) msgEl.innerHTML = '<div class="alert alert-danger mb-0">Ukuran file maksimal 2 MB.</div>';
      return;
    }
    try {
      fileData = await fileToBase64(file);
      fileName = file.name;
    } catch (err) {
      if (msgEl) msgEl.innerHTML = `<div class="alert alert-danger mb-0">Gagal membaca file: ${escapeHtml(err.message)}</div>`;
      return;
    }
  }

  const btn = getEl('saveBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const payload = {
      judul, deskripsi, urutan,
      tanggal_mulai: tanggalMulai,
      tanggal_akhir: tanggalAkhir,
      lokasi,
      jenis: fileData ? 'flyer' : 'timeline',
    };
    if (fileData) {
      payload.fileData = fileData;
      payload.fileName = fileName;
    }

    let res;
    if (id) {
      payload.id = id;
      res = await callApi('updateInfo', payload, 'POST');
    } else {
      res = await callApi('addInfo', payload, 'POST');
    }

    if (res && res.success) {
      showToast(id ? 'Informasi diperbarui' : 'Informasi ditambahkan', 'success');
      resetForm();
      await loadInformasi(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
    if (msgEl) msgEl.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

// ============================================================
//   TOGGLE STATUS
// ============================================================
async function toggleStatus(id) {
  const item = STATE.informasiList.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  if (!confirm(`Ubah status informasi "${item.judul}"?`)) return;

  try {
    const res = await callApi('toggleInfoStatus', { id }, 'POST');
    if (res && res.success) {
      item.status = (String(item.status).toLowerCase() === 'selesai') ? 'aktif' : 'selesai';
      applyFiltersAndSort();
      showToast('Status berhasil diubah', 'success');
      setTimeout(() => loadInformasi(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah status');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

// ============================================================
//   DELETE
// ============================================================
function confirmDelete(id) {
  STATE.pendingDeleteId = id;
  getEl('deleteInformasiId').value = id;
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const id = getEl('deleteInformasiId').value;
  if (!id) return;

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteInfo', { id }, 'POST');
    if (res && res.success) {
      STATE.informasiList = STATE.informasiList.filter(x => String(x.id) !== String(id));
      applyFiltersAndSort();
      showToast('Informasi berhasil dihapus', 'success');
      getModal('deleteConfirmModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.pendingDeleteId = null;
  }
}

// ============================================================
//   USULAN ACTIONS
// ============================================================
function openUsulanActionModal(id, type) {
  const item = STATE.usulanList.find(u => String(u.id) === String(id));
  if (!item) { showToast('Usulan tidak ditemukan', 'error'); return; }

  const isApprove = type === 'approve';
  getEl('usulanActionId').value = id;
  getEl('usulanActionType').value = type;

  const titleEl = getEl('usulanActionTitle');
  if (titleEl) {
    titleEl.innerHTML = isApprove
      ? '<i class="bi bi-check-circle me-2"></i>Setujui Usulan'
      : '<i class="bi bi-x-circle me-2"></i>Tolak Usulan';
  }

  const msgEl = getEl('usulanActionMessage');
  if (msgEl) {
    msgEl.innerHTML = isApprove
      ? `Setujui usulan dari <strong>${escapeHtml(item.nama || '-')}</strong>?<br>
         <small class="text-muted">Usulan akan otomatis dipublikasikan sebagai informasi.</small>`
      : `Tolak usulan dari <strong>${escapeHtml(item.nama || '-')}</strong>?<br>
         <small class="text-muted">Usulan tidak akan dipublikasikan.</small>`;
  }

  const btn = getEl('usulanActionBtn');
  btn.className = `btn ${isApprove ? 'btn-success' : 'btn-danger'} rounded-pill px-4`;
  btn.innerHTML = isApprove
    ? '<i class="bi bi-check-circle me-1"></i> Ya, Setujui'
    : '<i class="bi bi-x-circle me-1"></i> Ya, Tolak';

  getModal('usulanActionModal')?.show();
}

async function executeUsulanAction() {
  const id = getEl('usulanActionId').value;
  const type = getEl('usulanActionType').value;
  if (!id || !type) return;

  const btn = getEl('usulanActionBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memproses...';

  const status = type === 'approve' ? 'approved' : 'rejected';

  try {
    const res = await callApi('updateUsulanStatus', { id, status }, 'POST');
    if (res && res.success) {
      showToast(`Usulan berhasil di-${type === 'approve' ? 'setujui' : 'tolak'}`, 'success');
      getModal('usulanActionModal')?.hide();
      await Promise.all([loadUsulan(), loadInformasi(true)]);
    } else {
      throw new Error((res && res.error) || 'Gagal memproses');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// ============================================================
//   EXPORT
// ============================================================
function exportData() {
  const data = STATE.filteredList.length > 0 ? STATE.filteredList : STATE.informasiList;
  if (data.length === 0) { showToast('Tidak ada data untuk diekspor', 'info'); return; }

  const exportArr = data.map(item => ({
    id: item.id, jenis: item.jenis, judul: item.judul, deskripsi: item.deskripsi,
    url: item.url, urutan: item.urutan, tanggal_mulai: item.tanggal_mulai,
    tanggal_akhir: item.tanggal_akhir, lokasi: item.lokasi, status: item.status,
    createdAt: item.createdAt,
  }));

  try {
    const json = JSON.stringify(exportArr, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `informasi_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (e) {
    showToast('Gagal ekspor: ' + e.message, 'error');
  }
}
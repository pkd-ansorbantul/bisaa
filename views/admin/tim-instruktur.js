// ============================================================
// VIEW: tim-instruktur.js
// CRUD Tim Instruktur PKD GP Ansor Bantul
// Versi: 26.1.6
// Dimuat oleh: js/router.js
// HTML: views/admin/tim-instruktur.html
// ============================================================
// Fitur:
// ✅ CRUD anggota tim (add/edit/delete/view detail)
// ✅ Upload foto (preview instan + auto-delete foto lama)
// ✅ Reorder via tombol naik/turun
// ✅ Search debounced (nama, jabatan, deskripsi)
// ✅ Sort by urutan (default)
// ✅ Export JSON
// ✅ Kontak WhatsApp (wa.me link) + Email (mailto)
// ✅ Stats: total, berfoto, jabatan unik, punya kontak
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Modal cache + dispose (zero memory leak)
// ✅ Listener registry (auto-cleanup)
// ✅ Optimistic UI untuk reorder
// ============================================================

import {
  showToast,
  escapeHtml,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;
let isSaving = false;

const STATE = {
  list: [],
  filtered: [],
  searchQuery: '',
  pendingDeleteId: null,
  // Foto editing state
  editingFotoBase64: null,   // base64 baru (belum disimpan)
  editingFotoCleared: false, // flag user mau hapus foto
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
      console.warn('[TimInstrukturView] Gagal init modal:', id, e);
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

function setBtnLoading(btn, loading, text) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${text || 'Memuat...'}`;
  }
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('File kosong'));
    if (file.size === 0) return reject(new Error('File kosong (0 byte)'));
    const reader = new FileReader();
    reader.onload = () => {
      if (!reader.result || typeof reader.result !== 'string') {
        reject(new Error('Hasil baca file tidak valid'));
        return;
      }
      resolve(reader.result);
    };
    reader.onerror = () => reject(new Error('Gagal membaca file'));
    reader.readAsDataURL(file);
  });
}

function getDriveThumb(driveId, size) {
  if (!driveId) return '';
  const clean = String(driveId).trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) return '';
  return `https://drive.google.com/thumbnail?id=${clean}&sz=w${size || 200}`;
}

function normalizeWaNumber(wa) {
  if (!wa) return '';
  const digits = String(wa).replace(/\D/g, '');
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

function updateCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  el.className = 'cache-status ' + (
    status === 'Live' ? 'live'
    : status === 'Offline' || status === 'Error' ? 'offline'
    : ''
  );
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[TimInstrukturView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[TimInstrukturView] mounted');

  // Reset state
  STATE.list = [];
  STATE.filtered = [];
  STATE.searchQuery = '';
  STATE.pendingDeleteId = null;
  STATE.editingFotoBase64 = null;
  STATE.editingFotoCleared = false;
  isSaving = false;

  const searchEl = getEl('searchTimInput');
  if (searchEl) searchEl.value = '';

  // Initial skeleton
  renderSkeleton();

  // Bind events SEBELUM load (agar siap saat user interaksi)
  bindEvents();

  // Load data
  await loadData(true);

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    loadData(false)
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
  console.log('[TimInstrukturView] unmounted');

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
  const searchEl = getEl('searchTimInput');
  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    applyFilter();
  }, 300));

  on(getEl('addTimBtn'), 'click', openAddModal);
  on(getEl('saveTimBtn'), 'click', saveTim);
  on(getEl('confirmDeleteTimBtn'), 'click', executeDelete);
  on(getEl('clearTimFotoBtn'), 'click', clearFoto);
  on(getEl('exportTimBtn'), 'click', exportData);

  // Refresh
  on(getEl('refreshTimBtn'), 'click', async function () {
    if (isSaving) return;
    const btn = this;
    const restore = setBtnLoading(btn, true, 'Memuat...');
    try {
      await loadData(true);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan', 'error');
    } finally {
      restore();
    }
  });

  // Foto preview saat pilih file
  on(getEl('timFotoInput'), 'change', async function () {
    const file = this.files && this.files[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      showToast('Ukuran foto maksimal 2 MB', 'error');
      this.value = '';
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (file.type && allowedTypes.indexOf(file.type) === -1) {
      showToast('Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.', 'error');
      this.value = '';
      return;
    }

    try {
      const b64 = await fileToBase64(file);
      STATE.editingFotoBase64 = b64;
      STATE.editingFotoCleared = false;
      showFotoPreview(b64);
    } catch (e) {
      showToast('Gagal membaca foto: ' + e.message, 'error');
      this.value = '';
    }
  });
}

// ============================================================
//   FOTO PREVIEW
// ============================================================
function showFotoPreview(src) {
  const img = getEl('timFotoPreview');
  const placeholder = getEl('timFotoPlaceholder');
  if (!img) return;
  if (src) {
    img.src = src;
    img.style.display = 'block';
    if (placeholder) placeholder.style.display = 'none';
  } else {
    img.src = '';
    img.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
  }
}

function clearFoto() {
  STATE.editingFotoBase64 = null;
  STATE.editingFotoCleared = true;
  const input = getEl('timFotoInput');
  if (input) input.value = '';
  showFotoPreview(null);
  showToast('Foto akan dihapus saat disimpan', 'info');
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  updateCacheStatus('Memuat…');

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }

    STATE.list = AdminModule.getTimInstruktur() || [];

    applyFilter();
    updateCacheStatus('Live');
  } catch (e) {
    console.error('[TimInstrukturView] loadData:', e);
    const c = getEl('timTableContainer');
    if (c && STATE.list.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        <i class="bi bi-exclamation-triangle-fill me-2"></i>
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    updateCacheStatus('Error');
  }
}

function applyFilter() {
  const q = STATE.searchQuery.trim().toLowerCase();
  STATE.filtered = !q
    ? STATE.list.slice()
    : STATE.list.filter(item =>
        (item.nama || '').toLowerCase().includes(q) ||
        (item.jabatan || '').toLowerCase().includes(q) ||
        (item.deskripsi || '').toLowerCase().includes(q)
      );

  renderStats();
  renderTable();
}

// ============================================================
//   RENDER: SKELETON
// ============================================================
function renderSkeleton() {
  const c = getEl('timTableContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table align-middle">
      <thead class="table-light"><tr>
        ${Array(7).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>
        ${Array(4).fill(0).map(() =>
          `<tr>${Array(7).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
        ).join('')}
      </tbody>
    </table></div>`;
}

// ============================================================
//   RENDER: STATS
// ============================================================
function renderStats() {
  const list = STATE.list;
  const total = list.length;
  const adaFoto = list.filter(x => x.foto_driveId).length;
  const jabatanSet = new Set(
    list.map(x => (x.jabatan || '').toLowerCase().trim()).filter(Boolean)
  );
  const punyaKontak = list.filter(x => x.kontak_wa || x.kontak_email).length;

  const setText = (id, val) => {
    const el = getEl(id);
    if (el) el.textContent = val;
  };
  setText('statTotalAnggota', total);
  setText('statAdaFoto', adaFoto);
  setText('statJabatan', jabatanSet.size);
  setText('statKontak', punyaKontak);
}

// ============================================================
//   RENDER: TABLE
// ============================================================
function renderTable() {
  const c = getEl('timTableContainer');
  if (!c) return;

  if (STATE.filtered.length === 0) {
    c.innerHTML = `
      <div class="alert alert-info text-center mb-0">
        <i class="bi bi-info-circle me-1"></i>
        ${STATE.searchQuery
          ? `Tidak ada hasil pencarian untuk "<strong>${escapeHtml(STATE.searchQuery)}</strong>".`
          : 'Belum ada anggota tim. Klik <strong>Tambah Anggota</strong> untuk memulai.'}
      </div>`;
    return;
  }

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">Urut</th>
      <th style="width:70px;">Foto</th>
      <th>Nama</th>
      <th>Jabatan</th>
      <th style="width:120px;">Kontak</th>
      <th style="width:100px;" class="text-center">Reorder</th>
      <th style="width:180px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  STATE.filtered.forEach((item, idx) => {
    const safeId = escapeHtml(String(item.id));
    const thumb = item.foto_driveId ? getDriveThumb(item.foto_driveId, 80) : '';

    const fotoHtml = thumb
      ? `<img src="${thumb}" alt="Foto ${escapeHtml(item.nama)}"
              style="width:44px;height:44px;object-fit:cover;border-radius:12px;border:1px solid #e2e8f0;"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div style="display:none;width:44px;height:44px;border-radius:12px;background:#e2e8f0;align-items:center;justify-content:center;">
           <i class="bi bi-person-fill text-muted"></i>
         </div>`
      : `<div style="width:44px;height:44px;border-radius:12px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">
           <i class="bi bi-person-fill text-muted"></i>
         </div>`;

    const waNumber = normalizeWaNumber(item.kontak_wa);
    const waHtml = waNumber
      ? `<a href="https://wa.me/${escapeHtml(waNumber)}" target="_blank" rel="noopener"
            class="btn btn-sm btn-outline-success me-1" title="WhatsApp">
           <i class="bi bi-whatsapp"></i>
         </a>`
      : '';
    const emailHtml = item.kontak_email
      ? `<a href="mailto:${escapeHtml(item.kontak_email)}"
            class="btn btn-sm btn-outline-secondary" title="Email">
           <i class="bi bi-envelope"></i>
         </a>`
      : '';

    const kontakHtml = (waHtml || emailHtml)
      ? waHtml + emailHtml
      : '<span class="text-muted small">—</span>';

    // Reorder: tombol naik/turun berdasarkan urutan di STATE.filtered
    // Tombol disabled kalau pencarian aktif (karena urutan filter tidak sama dengan global)
    const searchActive = STATE.searchQuery.trim() !== '';
    const isFirst = idx === 0;
    const isLast = idx === STATE.filtered.length - 1;

    const upDisabled = searchActive || isFirst;
    const downDisabled = searchActive || isLast;

    const reorderHtml = `
      <div class="btn-group" role="group">
        <button type="button" class="btn btn-sm btn-outline-secondary"
                data-action="up" data-id="${safeId}"
                ${upDisabled ? 'disabled' : ''} title="Naikkan">
          <i class="bi bi-arrow-up"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary"
                data-action="down" data-id="${safeId}"
                ${downDisabled ? 'disabled' : ''} title="Turunkan">
          <i class="bi bi-arrow-down"></i>
        </button>
      </div>`;

    html += `<tr>
      <td><span class="badge bg-secondary">${escapeHtml(String(item.urutan || '-'))}</span></td>
      <td>${fotoHtml}</td>
      <td><strong>${escapeHtml(item.nama || '-')}</strong></td>
      <td>
        <div class="fw-semibold text-primary small">${escapeHtml(item.jabatan || '-')}</div>
        ${item.deskripsi ? `<div class="text-muted small text-truncate" style="max-width:240px;" title="${escapeHtml(item.deskripsi)}">${escapeHtml(item.deskripsi)}</div>` : ''}
      </td>
      <td>${kontakHtml}</td>
      <td class="text-center">${reorderHtml}</td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-info me-1"
                data-action="detail" data-id="${safeId}" title="Detail">
          <i class="bi bi-eye"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-warning me-1"
                data-action="edit" data-id="${safeId}" title="Edit">
          <i class="bi bi-pencil"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger"
                data-action="delete" data-id="${safeId}" title="Hapus">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;

  // Bind action buttons
  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTableAction);
  });
}

function handleTableAction(e) {
  const action = e.currentTarget.dataset.action;
  const id = e.currentTarget.dataset.id;

  switch (action) {
    case 'detail':  return viewTim(id);
    case 'edit':    return editTim(id);
    case 'delete':  return confirmDelete(id);
    case 'up':      return moveUp(id);
    case 'down':    return moveDown(id);
  }
}

// ============================================================
//   REORDER (up/down)
// ============================================================
async function moveUp(id) {
  const idx = STATE.list.findIndex(x => String(x.id) === String(id));
  if (idx <= 0) return;

  // Tukar posisi di STATE.list
  const tmp = STATE.list[idx];
  STATE.list[idx] = STATE.list[idx - 1];
  STATE.list[idx - 1] = tmp;

  // Reassign urutan berurutan
  reassignUrutan();

  // Re-render instan (optimistic)
  applyFilter();

  // Kirim ke server
  await syncUrutan();
}

async function moveDown(id) {
  const idx = STATE.list.findIndex(x => String(x.id) === String(id));
  if (idx === -1 || idx >= STATE.list.length - 1) return;

  // Tukar posisi di STATE.list
  const tmp = STATE.list[idx];
  STATE.list[idx] = STATE.list[idx + 1];
  STATE.list[idx + 1] = tmp;

  reassignUrutan();
  applyFilter();
  await syncUrutan();
}

function reassignUrutan() {
  STATE.list.forEach((item, i) => {
    item.urutan = i + 1;
  });
}

async function syncUrutan() {
  const orders = STATE.list.map((item, i) => ({
    id: item.id,
    urutan: i + 1,
  }));

  try {
    const res = await AdminModule.reorderTimInstruktur(orders);
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Gagal menyimpan urutan');
    }
  } catch (e) {
    showToast('Gagal menyimpan urutan: ' + e.message, 'error');
    // Reload dari server untuk sinkronisasi
    await loadData(true).catch(() => {});
  }
}

// ============================================================
//   CRUD: OPEN MODALS
// ============================================================
function openAddModal() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };

  setVal('editTimId', '');
  setVal('timNama', '');
  setVal('timJabatan', '');
  setVal('timUrutan', STATE.list.length + 1);
  setVal('timDeskripsi', '');
  setVal('timKontakWa', '');
  setVal('timKontakEmail', '');
  setVal('timFotoInput', '');

  STATE.editingFotoBase64 = null;
  STATE.editingFotoCleared = false;
  showFotoPreview(null);

  const title = getEl('timFormTitle');
  if (title) title.textContent = 'Tambah Anggota Tim';

  getModal('timFormModal')?.show();
}

function editTim(id) {
  const item = STATE.list.find(x => String(x.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };

  setVal('editTimId', id);
  setVal('timNama', item.nama || '');
  setVal('timJabatan', item.jabatan || '');
  setVal('timUrutan', item.urutan || '');
  setVal('timDeskripsi', item.deskripsi || '');
  setVal('timKontakWa', item.kontak_wa || '');
  setVal('timKontakEmail', item.kontak_email || '');
  setVal('timFotoInput', '');

  STATE.editingFotoBase64 = null;
  STATE.editingFotoCleared = false;

  // Preview foto existing (via Drive thumbnail)
  if (item.foto_driveId) {
    showFotoPreview(getDriveThumb(item.foto_driveId, 300));
  } else {
    showFotoPreview(null);
  }

  const title = getEl('timFormTitle');
  if (title) title.textContent = 'Edit Anggota Tim';

  getModal('timFormModal')?.show();
}

// ============================================================
//   VIEW DETAIL
// ============================================================
function viewTim(id) {
  const item = STATE.list.find(x => String(x.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  const thumb = item.foto_driveId ? getDriveThumb(item.foto_driveId, 400) : '';
  const content = getEl('detailTimContent');
  if (!content) return;

  const waNumber = normalizeWaNumber(item.kontak_wa);

  content.innerHTML = `
    <div class="row g-3">
      <div class="col-md-4 text-center">
        ${thumb
          ? `<img src="${thumb}" alt="${escapeHtml(item.nama)}"
                  style="width:100%;max-width:200px;aspect-ratio:1;object-fit:cover;border-radius:20px;border:1px solid #e2e8f0;"
                  onerror="this.style.display='none';this.nextElementSibling.style.display='inline-flex';">
             <div style="display:none;width:100%;max-width:200px;aspect-ratio:1;border-radius:20px;background:#f1f5f9;align-items:center;justify-content:center;font-size:3rem;color:#94a3b8;">
               <i class="bi bi-person-fill"></i>
             </div>`
          : `<div style="width:100%;max-width:200px;aspect-ratio:1;border-radius:20px;background:#f1f5f9;display:inline-flex;align-items:center;justify-content:center;font-size:3rem;color:#94a3b8;">
               <i class="bi bi-person-fill"></i>
             </div>`}
      </div>
      <div class="col-md-8">
        <h4 class="fw-bold mb-1">${escapeHtml(item.nama || '-')}</h4>
        <p class="text-primary fw-semibold mb-3">${escapeHtml(item.jabatan || '-')}</p>

        <div class="list-group list-group-flush">
          <div class="list-group-item py-2 px-0 border-0">
            <strong>Urutan Tampil:</strong> <span class="badge bg-secondary">${escapeHtml(String(item.urutan || '-'))}</span>
          </div>
          ${item.deskripsi ? `
            <div class="list-group-item py-2 px-0 border-0">
              <strong>Deskripsi / Tugas:</strong><br>
              <span class="text-muted">${escapeHtml(item.deskripsi)}</span>
            </div>` : ''}
          ${waNumber ? `
            <div class="list-group-item py-2 px-0 border-0">
              <strong>WhatsApp:</strong>
              <a href="https://wa.me/${escapeHtml(waNumber)}" target="_blank" rel="noopener" class="ms-2">
                <i class="bi bi-whatsapp text-success"></i> ${escapeHtml(item.kontak_wa)}
              </a>
            </div>` : ''}
          ${item.kontak_email ? `
            <div class="list-group-item py-2 px-0 border-0">
              <strong>Email:</strong>
              <a href="mailto:${escapeHtml(item.kontak_email)}" class="ms-2">
                <i class="bi bi-envelope text-primary"></i> ${escapeHtml(item.kontak_email)}
              </a>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  getModal('detailTimModal')?.show();
}

// ============================================================
//   SAVE (ADD / EDIT)
// ============================================================
async function saveTim(e) {
  if (isSaving) return;

  const btn = (e && e.currentTarget) || getEl('saveTimBtn');
  const id = (getEl('editTimId') || {}).value || '';
  const nama = ((getEl('timNama') || {}).value || '').trim();
  const jabatan = ((getEl('timJabatan') || {}).value || '').trim();
  const urutanRaw = (getEl('timUrutan') || {}).value;
  const deskripsi = ((getEl('timDeskripsi') || {}).value || '').trim();
  const kontak_wa = ((getEl('timKontakWa') || {}).value || '').trim();
  const kontak_email = ((getEl('timKontakEmail') || {}).value || '').trim();

  // Validasi
  if (!nama) {
    showToast('Nama wajib diisi', 'error');
    (getEl('timNama') || {}).focus?.();
    return;
  }
  if (!jabatan) {
    showToast('Jabatan wajib diisi', 'error');
    (getEl('timJabatan') || {}).focus?.();
    return;
  }
  if (kontak_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontak_email)) {
    showToast('Format email tidak valid', 'error');
    (getEl('timKontakEmail') || {}).focus?.();
    return;
  }

  const urutan = parseInt(urutanRaw);
  const payload = {
    nama,
    jabatan,
    urutan: isNaN(urutan) ? 999 : urutan,
    deskripsi,
    kontak_wa,
    kontak_email,
  };

  // Foto: prioritas base64 baru > flag clear
  if (STATE.editingFotoBase64) {
    payload.foto = STATE.editingFotoBase64;
  } else if (STATE.editingFotoCleared) {
    payload.clear_foto = true;
  }

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    let res;
    if (id) {
      payload.id = id;
      res = await AdminModule.updateTimInstruktur(payload);
    } else {
      res = await AdminModule.addTimInstruktur(payload);
    }

    if (res && res.success) {
      showToast(id ? 'Data diperbarui' : 'Anggota tim ditambahkan', 'success');
      getModal('timFormModal')?.hide();

      // Reset state foto
      STATE.editingFotoBase64 = null;
      STATE.editingFotoCleared = false;

      // Reload data (AdminModule sudah reload, tinggal refresh dari state)
      STATE.list = AdminModule.getTimInstruktur() || [];
      applyFilter();
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

// ============================================================
//   DELETE
// ============================================================
function confirmDelete(id) {
  const item = STATE.list.find(x => String(x.id) === String(id));
  if (!item) {
    showToast('Data tidak ditemukan', 'error');
    return;
  }

  STATE.pendingDeleteId = id;

  const nameEl = getEl('deleteTimName');
  if (nameEl) nameEl.textContent = item.nama || '—';

  const idEl = getEl('deleteTimId');
  if (idEl) idEl.value = id;

  getModal('deleteTimModal')?.show();
}

async function executeDelete(e) {
  if (isSaving) return;

  const btn = (e && e.currentTarget) || getEl('confirmDeleteTimBtn');
  const idEl = getEl('deleteTimId');
  const id = idEl ? idEl.value : '';
  if (!id) return;

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await AdminModule.deleteTimInstruktur(id);
    if (res && res.success) {
      showToast('Anggota tim dihapus', 'success');
      getModal('deleteTimModal')?.hide();

      // Reload data
      STATE.list = AdminModule.getTimInstruktur() || [];
      applyFilter();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
    STATE.pendingDeleteId = null;
  }
}

// ============================================================
//   EXPORT JSON
// ============================================================
function exportData() {
  const data = STATE.filtered.length ? STATE.filtered : STATE.list;
  if (data.length === 0) {
    showToast('Tidak ada data untuk diekspor', 'info');
    return;
  }

  const out = data.map(item => ({
    id: item.id,
    nama: item.nama,
    jabatan: item.jabatan,
    urutan: item.urutan,
    deskripsi: item.deskripsi,
    kontak_wa: item.kontak_wa,
    kontak_email: item.kontak_email,
    foto_driveId: item.foto_driveId || '',
  }));

  try {
    const json = JSON.stringify(out, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tim_instruktur_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (err) {
    showToast('Gagal ekspor: ' + err.message, 'error');
  }
}
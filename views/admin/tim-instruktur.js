// ============================================================
// VIEW: tim-instruktur.js — v27.2.0 PRELOAD + SUBSCRIPTION
// Dimuat oleh: js/router.js
// HTML: views/admin/tim-instruktur.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 90s
//   ✅ FIX BUG-003: Clone array SEBELUM swap (hindari mutasi cache)
//   ✅ FIX: Reorder rollback pakai snapshot lokal (bukan full reload)
//   ✅ FIX: Reset editing foto state saat modal ditutup
//   ✅ FIX: Modal dispose via ctx.cleanup
//   ✅ FIX: Null-safe element access — zero crash
//   ✅ FIX: Focus preservation saat re-render
//   ✅ Zero memory leak
// ============================================================

import {
  showToast,
  escapeHtml,
  fileToBase64,
  getLocalDateOnly,
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
const MAX_FOTO_SIZE_MB = 2;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

// ============================================================
//   LOCAL HELPERS
// ============================================================
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

function cloneList(list) {
  return (list || []).map(x => ({ ...x }));
}

function setCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    list: [],
    filtered: [],
    searchQuery: '',
    editingFotoBase64: null,
    editingFotoCleared: false,
    pendingDeleteId: null,
    lastHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'timInstruktur'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[TimInstrukturView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[TimInstrukturView] Re-render error:', e);
      }
    },
  }
);

let tableCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[TimInstrukturView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[TimInstrukturView] mounted');

  Object.assign(ctx.state, {
    list: [],
    filtered: [],
    searchQuery: '',
    editingFotoBase64: null,
    editingFotoCleared: false,
    pendingDeleteId: null,
    lastHash: '',
  });

  const searchEl = getEl('searchTimInput');
  if (searchEl) searchEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = cloneList(AdminModule.getTimInstruktur() || []);
  if (cached.length > 0) {
    console.log('[TimInstrukturView] ⚡ Rendering from preload cache');
    ctx.state.list = cached;
    ctx.state.lastHash = computeListHash(cached);
    applyFilter();
    setCacheStatus('Live');
  } else {
    console.log('[TimInstrukturView] ⚠️ No cache, showing skeleton');
    renderSkeleton();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cached.length === 0) {
    await loadData(false);
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[TimInstrukturView] unmounted');

  if (tableCleanup) {
    try { tableCleanup(); } catch (e) { /* silent */ }
    tableCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = cloneList(AdminModule.getTimInstruktur() || []);
  const freshHash = computeListHash(fresh);

  if (freshHash === ctx.state.lastHash) {
    console.log('[TimInstrukturView] No change, skip re-render');
    return;
  }

  ctx.state.list = fresh;
  ctx.state.lastHash = freshHash;
  applyFilter();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search
  ctx.on(getEl('searchTimInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    applyFilter();
  }, SEARCH_DEBOUNCE));

  // Toolbar
  ctx.on(getEl('addTimBtn'), 'click', openAddModal);
  ctx.on(getEl('saveTimBtn'), 'click', saveTim);
  ctx.on(getEl('confirmDeleteTimBtn'), 'click', executeDelete);
  ctx.on(getEl('clearTimFotoBtn'), 'click', clearFoto);
  ctx.on(getEl('exportTimBtn'), 'click', exportData);

  ctx.on(getEl('refreshTimBtn'), 'click', async function (e) {
    if (ctx.saving) return;
    ctx.saving = true;
    const restore = setBtnLoading(this, true, 'Memuat...');
    try {
      await AdminModule.loadAllData(true);
      refreshFromCache();
      showToast('Data disegarkan', 'success');
    } catch (err) {
      showToast('Gagal menyegarkan', 'error');
    } finally {
      restore();
      ctx.saving = false;
    }
  });

  // Foto preview
  ctx.on(getEl('timFotoInput'), 'change', async function () {
    const file = this.files && this.files[0];
    if (!file) return;

    if (file.size > MAX_FOTO_SIZE_MB * 1024 * 1024) {
      showToast(`Ukuran foto maksimal ${MAX_FOTO_SIZE_MB} MB`, 'error');
      this.value = '';
      return;
    }

    if (file.type && ALLOWED_IMAGE_TYPES.indexOf(file.type) === -1) {
      showToast('Format foto tidak didukung. Gunakan JPG, PNG, atau WEBP.', 'error');
      this.value = '';
      return;
    }

    try {
      const b64 = await fileToBase64(file);
      if (!ctx.mounted) return;
      ctx.state.editingFotoBase64 = b64;
      ctx.state.editingFotoCleared = false;
      showFotoPreview(b64);
    } catch (e) {
      showToast('Gagal membaca foto: ' + e.message, 'error');
      this.value = '';
    }
  });

  // Reset foto state saat modal ditutup
  const formModal = getEl('timFormModal');
  if (formModal) {
    ctx.on(formModal, 'hidden.bs.modal', () => {
      ctx.state.editingFotoBase64 = null;
      ctx.state.editingFotoCleared = false;
      const input = getEl('timFotoInput');
      if (input) input.value = '';
      showFotoPreview(null);
    });
  }

  // ✅ Delegation — table actions
  const tableContainer = getEl('timTableContainer');
  if (tableContainer) {
    tableCleanup = delegateTableClicks(tableContainer, {
      onAction: (action, id) => {
        switch (action) {
          case 'detail':  return viewTim(id);
          case 'edit':    return editTim(id);
          case 'delete':  return confirmDelete(id);
          case 'up':      return moveUp(id);
          case 'down':    return moveDown(id);
        }
      },
    });
  }
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
  ctx.state.editingFotoBase64 = null;
  ctx.state.editingFotoCleared = true;
  const input = getEl('timFotoInput');
  if (input) input.value = '';
  showFotoPreview(null);
  showToast('Foto akan dihapus saat disimpan', 'info');
}

// ============================================================
//   LOAD DATA (fallback)
// ============================================================
async function loadData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[TimInstrukturView] loadData:', e);
    const c = getEl('timTableContainer');
    if (c && ctx.state.list.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        <i class="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

function applyFilter() {
  const q = ctx.state.searchQuery.trim().toLowerCase();
  ctx.state.filtered = !q
    ? ctx.state.list.slice()
    : ctx.state.list.filter(item =>
        (item.nama || '').toLowerCase().includes(q) ||
        (item.jabatan || '').toLowerCase().includes(q) ||
        (item.deskripsi || '').toLowerCase().includes(q)
      );

  renderStats();
  renderTable();
}

// ============================================================
//   RENDER — SKELETON
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
//   RENDER — STATS
// ============================================================
function renderStats() {
  const list = ctx.state.list;
  const total = list.length;
  const adaFoto = list.filter(x => x.foto_driveId).length;
  const jabatanSet = new Set(
    list.map(x => (x.jabatan || '').toLowerCase().trim()).filter(Boolean)
  );
  const punyaKontak = list.filter(x => x.kontak_wa || x.kontak_email).length;

  const setText = (id, val) => { const el = getEl(id); if (el) el.textContent = val; };
  setText('statTotalAnggota', total);
  setText('statAdaFoto', adaFoto);
  setText('statJabatan', jabatanSet.size);
  setText('statKontak', punyaKontak);
}

// ============================================================
//   RENDER — TABLE
// ============================================================
function renderTable() {
  const c = getEl('timTableContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchTimInput');

  if (ctx.state.filtered.length === 0) {
    c.innerHTML = `
      <div class="alert alert-info text-center mb-0">
        <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
        ${ctx.state.searchQuery
          ? `Tidak ada hasil pencarian untuk "<strong>${escapeHtml(ctx.state.searchQuery)}</strong>".`
          : 'Belum ada anggota tim. Klik <strong>Tambah Anggota</strong> untuk memulai.'}
      </div>`;
    restoreFocusState('searchTimInput', savedFocus);
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

  const searchActive = ctx.state.searchQuery.trim() !== '';

  ctx.state.filtered.forEach((item, idx) => {
    const safeId = escapeHtml(String(item.id));
    const thumb = item.foto_driveId ? getDriveThumb(item.foto_driveId, 80) : '';

    const fotoHtml = thumb
      ? `<img src="${thumb}" alt="Foto ${escapeHtml(item.nama)}"
              style="width:44px;height:44px;object-fit:cover;border-radius:12px;border:1px solid #e2e8f0;"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
         <div style="display:none;width:44px;height:44px;border-radius:12px;background:#e2e8f0;align-items:center;justify-content:center;">
           <i class="bi bi-person-fill text-muted" aria-hidden="true"></i>
         </div>`
      : `<div style="width:44px;height:44px;border-radius:12px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">
           <i class="bi bi-person-fill text-muted" aria-hidden="true"></i>
         </div>`;

    const waNumber = normalizeWaNumber(item.kontak_wa);
    const waHtml = waNumber
      ? `<a href="https://wa.me/${escapeHtml(waNumber)}" target="_blank" rel="noopener"
            class="btn btn-sm btn-outline-success me-1" title="WhatsApp" aria-label="WhatsApp">
           <i class="bi bi-whatsapp" aria-hidden="true"></i>
         </a>`
      : '';
    const emailHtml = item.kontak_email
      ? `<a href="mailto:${escapeHtml(item.kontak_email)}"
            class="btn btn-sm btn-outline-secondary" title="Email" aria-label="Email">
           <i class="bi bi-envelope" aria-hidden="true"></i>
         </a>`
      : '';
    const kontakHtml = (waHtml || emailHtml) ? waHtml + emailHtml : '<span class="text-muted small">—</span>';

    const upDisabled = searchActive || idx === 0;
    const downDisabled = searchActive || idx === ctx.state.filtered.length - 1;

    const reorderHtml = `
      <div class="btn-group" role="group">
        <button type="button" class="btn btn-sm btn-outline-secondary"
                data-action="up" data-id="${safeId}"
                ${upDisabled ? 'disabled' : ''} title="Naikkan" aria-label="Naikkan">
          <i class="bi bi-arrow-up" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-secondary"
                data-action="down" data-id="${safeId}"
                ${downDisabled ? 'disabled' : ''} title="Turunkan" aria-label="Turunkan">
          <i class="bi bi-arrow-down" aria-hidden="true"></i>
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
                data-action="detail" data-id="${safeId}" title="Detail" aria-label="Detail">
          <i class="bi bi-eye" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-warning me-1"
                data-action="edit" data-id="${safeId}" title="Edit" aria-label="Edit">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger"
                data-action="delete" data-id="${safeId}" title="Hapus" aria-label="Hapus">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;

  restoreFocusState('searchTimInput', savedFocus);
}

// ============================================================
//   REORDER — Optimistic UI + Local Snapshot Rollback
// ============================================================
async function moveUp(id) {
  ctx.state.list = cloneList(ctx.state.list);

  const idx = ctx.state.list.findIndex(x => String(x.id) === String(id));
  if (idx <= 0) return;

  const snapshot = ctx.state.list.map(x => ({ id: x.id, urutan: x.urutan }));

  const tmp = ctx.state.list[idx];
  ctx.state.list[idx] = ctx.state.list[idx - 1];
  ctx.state.list[idx - 1] = tmp;

  reassignUrutan();
  applyFilter();

  await syncUrutanSilent(snapshot);
}

async function moveDown(id) {
  ctx.state.list = cloneList(ctx.state.list);

  const idx = ctx.state.list.findIndex(x => String(x.id) === String(id));
  if (idx === -1 || idx >= ctx.state.list.length - 1) return;

  const snapshot = ctx.state.list.map(x => ({ id: x.id, urutan: x.urutan }));

  const tmp = ctx.state.list[idx];
  ctx.state.list[idx] = ctx.state.list[idx + 1];
  ctx.state.list[idx + 1] = tmp;

  reassignUrutan();
  applyFilter();

  await syncUrutanSilent(snapshot);
}

function reassignUrutan() {
  ctx.state.list.forEach((item, i) => { item.urutan = i + 1; });
}

async function syncUrutanSilent(snapshot) {
  const orders = ctx.state.list.map((item, i) => ({ id: item.id, urutan: i + 1 }));
  try {
    const res = await AdminModule.reorderTimInstruktur(orders);
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Gagal menyimpan urutan');
    }
    ctx.state.lastHash = computeListHash(ctx.state.list);
  } catch (e) {
    showToast('Gagal sync urutan: ' + e.message, 'error');

    // Rollback pakai snapshot lokal
    if (snapshot && snapshot.length > 0) {
      snapshot.forEach(snap => {
        const item = ctx.state.list.find(x => String(x.id) === String(snap.id));
        if (item) item.urutan = snap.urutan;
      });
      ctx.state.list.sort((a, b) => (a.urutan || 999) - (b.urutan || 999));
      applyFilter();
    } else {
      await AdminModule.loadAllData(true).catch(() => {});
    }
  }
}

// ============================================================
//   CRUD — OPEN MODALS
// ============================================================
function openAddModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editTimId', '');
  setVal('timNama', '');
  setVal('timJabatan', '');
  setVal('timUrutan', ctx.state.list.length + 1);
  setVal('timDeskripsi', '');
  setVal('timKontakWa', '');
  setVal('timKontakEmail', '');
  setVal('timFotoInput', '');

  ctx.state.editingFotoBase64 = null;
  ctx.state.editingFotoCleared = false;
  showFotoPreview(null);

  const title = getEl('timFormTitle');
  if (title) title.textContent = 'Tambah Anggota Tim';

  ctx.getModal('timFormModal')?.show();
}

function editTim(id) {
  const item = ctx.state.list.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editTimId', id);
  setVal('timNama', item.nama || '');
  setVal('timJabatan', item.jabatan || '');
  setVal('timUrutan', item.urutan || '');
  setVal('timDeskripsi', item.deskripsi || '');
  setVal('timKontakWa', item.kontak_wa || '');
  setVal('timKontakEmail', item.kontak_email || '');
  setVal('timFotoInput', '');

  ctx.state.editingFotoBase64 = null;
  ctx.state.editingFotoCleared = false;

  if (item.foto_driveId) {
    showFotoPreview(getDriveThumb(item.foto_driveId, 300));
  } else {
    showFotoPreview(null);
  }

  const title = getEl('timFormTitle');
  if (title) title.textContent = 'Edit Anggota Tim';

  ctx.getModal('timFormModal')?.show();
}

// ============================================================
//   VIEW DETAIL
// ============================================================
function viewTim(id) {
  const item = ctx.state.list.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

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
               <i class="bi bi-person-fill" aria-hidden="true"></i>
             </div>`
          : `<div style="width:100%;max-width:200px;aspect-ratio:1;border-radius:20px;background:#f1f5f9;display:inline-flex;align-items:center;justify-content:center;font-size:3rem;color:#94a3b8;">
               <i class="bi bi-person-fill" aria-hidden="true"></i>
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
                <i class="bi bi-whatsapp text-success" aria-hidden="true"></i> ${escapeHtml(item.kontak_wa)}
              </a>
            </div>` : ''}
          ${item.kontak_email ? `
            <div class="list-group-item py-2 px-0 border-0">
              <strong>Email:</strong>
              <a href="mailto:${escapeHtml(item.kontak_email)}" class="ms-2">
                <i class="bi bi-envelope text-primary" aria-hidden="true"></i> ${escapeHtml(item.kontak_email)}
              </a>
            </div>` : ''}
        </div>
      </div>
    </div>`;

  ctx.getModal('detailTimModal')?.show();
}

// ============================================================
//   SAVE (ADD / EDIT)
// ============================================================
async function saveTim(e) {
  if (ctx.saving) return;

  const btn = e?.currentTarget || getEl('saveTimBtn');
  const id = (getEl('editTimId') || {}).value || '';
  const nama = ((getEl('timNama') || {}).value || '').trim();
  const jabatan = ((getEl('timJabatan') || {}).value || '').trim();
  const urutanRaw = (getEl('timUrutan') || {}).value;
  const deskripsi = ((getEl('timDeskripsi') || {}).value || '').trim();
  const kontak_wa = ((getEl('timKontakWa') || {}).value || '').trim();
  const kontak_email = ((getEl('timKontakEmail') || {}).value || '').trim();

  if (!nama) {
    showToast('Nama wajib diisi', 'error');
    getEl('timNama')?.focus?.();
    return;
  }
  if (!jabatan) {
    showToast('Jabatan wajib diisi', 'error');
    getEl('timJabatan')?.focus?.();
    return;
  }
  if (kontak_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(kontak_email)) {
    showToast('Format email tidak valid', 'error');
    getEl('timKontakEmail')?.focus?.();
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

  if (ctx.state.editingFotoBase64) {
    payload.foto = ctx.state.editingFotoBase64;
  } else if (ctx.state.editingFotoCleared) {
    payload.clear_foto = true;
  }

  ctx.saving = true;
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
      ctx.getModal('timFormModal')?.hide();

      ctx.state.editingFotoBase64 = null;
      ctx.state.editingFotoCleared = false;

      await AdminModule.loadAllData(true);
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
//   DELETE
// ============================================================
function confirmDelete(id) {
  const item = ctx.state.list.find(x => String(x.id) === String(id));
  if (!item) { showToast('Data tidak ditemukan', 'error'); return; }

  ctx.state.pendingDeleteId = id;
  const nameEl = getEl('deleteTimName');
  if (nameEl) nameEl.textContent = item.nama || '—';

  const idEl = getEl('deleteTimId');
  if (idEl) idEl.value = id;

  ctx.getModal('deleteTimModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const btn = (e && e.currentTarget) || getEl('confirmDeleteTimBtn');
  const id = ctx.state.pendingDeleteId || (getEl('deleteTimId') || {}).value;
  if (!id) return;

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await AdminModule.deleteTimInstruktur(id);
    if (res && res.success) {
      showToast('Anggota tim dihapus', 'success');
      ctx.getModal('deleteTimModal')?.hide();
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
  }
}

// ============================================================
//   EXPORT JSON
// ============================================================
function exportData() {
  const data = ctx.state.filtered.length ? ctx.state.filtered : ctx.state.list;
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
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    a.href = url;
    a.download = `tim_instruktur_${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Berhasil mengekspor ${data.length} data`, 'success');
  } catch (err) {
    showToast('Gagal ekspor: ' + err.message, 'error');
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Tim Instruktur View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// VIEW: tanda-tangan.js — v28.1.0 ADMIN QUEUE EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/tanda-tangan.html
// ============================================================
// CHANGELOG v28.1.0 (dari v28.0.0):
//   ✅ NEW: Panel "Pilih Peserta untuk TTD" (Admin → Queue)
//   ✅ NEW: Queue chips + candidate checkbox + bulk add
//   ✅ NEW: Clear queue + remove per chip
//   ✅ NEW: Refresh queue button
//   ✅ NEW: Search candidate (debounced)
//   ✅ FIX: Group by peserta — keep LATEST per role
//   ✅ FIX: Password save — loading state per role + rollback
//   ✅ FIX: QR generation — escape URL + safe fallback
//   ✅ FIX: Delete — konfirmasi + reload
//   ✅ FIX: Sort per kolom (peserta_nama) dengan arrow indicator
//   ✅ FIX: Pagination responsive (max 7 buttons)
//   ✅ FIX: Filter role — cek driveId tidak kosong
//   ✅ FIX: Modal cleanup on hide (zero leak)
//   ✅ FIX: Event delegation untuk table + pagination + password
//   ✅ FIX: isProcessing guard putus infinite loop
//   ✅ FIX: Null-safe semua element access
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Semua fitur v28.0.0 (password CRUD, delete all TTD)
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  formatDateTimeID,
  addBulkToSignatureQueue,
  getSignatureQueue,
  removeFromSignatureQueue,
  clearSignatureQueue,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
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
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const ROLE_LABELS = {
  ketua_pc: 'Ketua PC',
  sekretaris: 'Sekretaris',
  instruktur: 'Instruktur',
};

const ROLE_ORDER = ['ketua_pc', 'sekretaris', 'instruktur'];

const ROLE_INPUT_MAP = {
  ketua_pc: 'passKetua',
  sekretaris: 'passSekretaris',
  instruktur: 'passInstruktur',
};

const ROLE_STATUS_MAP = {
  ketua_pc: 'statusKetua',
  sekretaris: 'statusSekretaris',
  instruktur: 'statusInstruktur',
};

const MIN_PASSWORD_LENGTH = 6;

// ============================================================
//   LOCAL HELPERS
// ============================================================
function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function groupApprovals(rawList) {
  const map = {};

  (rawList || []).forEach(row => {
    const peserta = String(row.peserta_nama || '').trim();
    if (!peserta) return;

    if (!map[peserta]) {
      map[peserta] = {
        peserta_nama: peserta,
        ketua_pc_nama: '', ketua_pc_driveId: '', ketua_pc_timestamp: '',
        sekretaris_nama: '', sekretaris_driveId: '', sekretaris_timestamp: '',
        instruktur_nama: '', instruktur_driveId: '', instruktur_timestamp: '',
      };
    }

    const role = String(row.role || '').toLowerCase().trim();
    if (ROLE_ORDER.indexOf(role) === -1) return;

    const nama = row.nama || '';
    const driveId = row.driveId || '';
    const timestamp = row.timestamp || '';

    // Keep LATEST per role
    const existingTs = map[peserta][`${role}_timestamp`];
    const existingDriveId = map[peserta][`${role}_driveId`];

    if (!existingDriveId || !existingTs) {
      map[peserta][`${role}_nama`] = nama;
      map[peserta][`${role}_driveId`] = driveId;
      map[peserta][`${role}_timestamp`] = timestamp;
    } else {
      const newTs = new Date(timestamp).getTime();
      const oldTs = new Date(existingTs).getTime();
      if (!isNaN(newTs) && !isNaN(oldTs) && newTs > oldTs) {
        map[peserta][`${role}_nama`] = nama;
        map[peserta][`${role}_driveId`] = driveId;
        map[peserta][`${role}_timestamp`] = timestamp;
      }
    }
  });

  return Object.values(map);
}

function renderTTDColumn(nama, driveId, timestamp) {
  if (!driveId) {
    return '<span class="text-muted small">—</span>';
  }

  const safeNama = escapeHtml(nama || '-');
  const safeId = escapeHtml(driveId);
  const thumbUrl = `https://drive.google.com/thumbnail?id=${safeId}&sz=w150`;
  const viewUrl = `https://drive.google.com/file/d/${safeId}/view`;
  const dateStr = timestamp ? formatDateTimeID(timestamp) : '';

  return `
    <div class="d-flex flex-column align-items-center gap-1">
      <span class="fw-semibold small text-center">${safeNama}</span>
      <img src="${thumbUrl}"
           alt="TTD ${safeNama}"
           class="border rounded"
           style="max-height:40px;max-width:100px;object-fit:contain;background:#fff;padding:2px;cursor:zoom-in;"
           data-preview-ttd="${safeId}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';">
      <code class="small text-muted" style="display:none;font-size:0.6rem;word-break:break-all;">${safeId}</code>
      ${dateStr ? `<span class="text-muted" style="font-size:0.65rem;">${escapeHtml(dateStr)}</span>` : ''}
      <a href="${viewUrl}" target="_blank" rel="noopener noreferrer"
         class="btn btn-sm btn-outline-secondary py-0 px-1" style="font-size:0.65rem;"
         aria-label="Buka TTD ${safeNama} di tab baru">
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
      </a>
    </div>`;
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

function getPasswordStrength(pwd) {
  if (!pwd) return { level: 0, label: '', class: '' };
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 2) return { level: score * 20, label: 'Lemah', class: 'text-danger' };
  if (score <= 3) return { level: score * 20, label: 'Sedang', class: 'text-warning' };
  return { level: Math.min(score * 20, 100), label: 'Kuat', class: 'text-success' };
}

// ============================================================
//   CONTEXT — subscription ke AdminModule
// ============================================================
const ctx = createViewContext(
  {
    // Tabel rekap TTD
    grouped: [],
    filtered: [],
    searchQuery: '',
    filterRole: '',
    sortColumn: 'peserta_nama',
    sortDirection: 'asc',
    currentPage: 1,
    itemsPerPage: 20,
    deleteTarget: null,
    qrCanvasRef: null,
    lastHash: '',

    // Queue panel
    queueList: [],
    candidateList: [],
    selectedQueueCandidateIds: new Set(),
    isQueueProcessing: false,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'ttd'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;

      if (ctx.state.isProcessing) {
        console.log(`[TandaTanganView] ⚡ Data changed (${type}) — skip (processing)`);
        return;
      }

      console.log(`[TandaTanganView] ⚡ Data changed (${type}) → refresh`);
      try {
        refreshFromCache();
        loadSignatureQueue().catch(() => {});
      } catch (e) {
        console.warn('[TandaTanganView] Re-render error:', e);
      }
    },
  }
);

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[TandaTanganView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  ctx.state.isProcessing = false;
  ctx.state.isQueueProcessing = false;
  console.log('[TandaTanganView] 🚀 mounted');

  // Reset state
  Object.assign(ctx.state, {
    grouped: [],
    filtered: [],
    searchQuery: '',
    filterRole: '',
    sortColumn: 'peserta_nama',
    sortDirection: 'asc',
    currentPage: 1,
    deleteTarget: null,
    qrCanvasRef: null,
    lastHash: '',
    queueList: [],
    candidateList: [],
    selectedQueueCandidateIds: new Set(),
    isQueueProcessing: false,
  });

  // Reset UI
  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterRole');
  const queueSearchEl = getEl('adminQueueSearchInput');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';
  if (queueSearchEl) queueSearchEl.value = '';

  // Reset password inputs
  Object.values(ROLE_INPUT_MAP).forEach(id => {
    const el = getEl(id);
    if (el) el.value = '';
  });
  Object.values(ROLE_STATUS_MAP).forEach(id => {
    const el = getEl(id);
    if (el) {
      el.textContent = '—';
      el.className = 'text-muted ms-2';
    }
  });

  // ⚡ Instant render dari preload cache
  const cachedApprovals = AdminModule.getDigitalApprovals() || [];

  if (cachedApprovals.length > 0) {
    console.log('[TandaTanganView] ⚡ Rendering from preload cache');
    ctx.state.grouped = groupApprovals(cachedApprovals);
    ctx.state.lastHash = computeListHash(ctx.state.grouped);
    renderTable();
    setCacheStatus('Live');
  } else {
    console.log('[TandaTanganView] ⚠️ No cache, showing skeleton');
    renderSkeletonTable();
    setCacheStatus('Memuat…');
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Load queue + password status (paralel)
  await Promise.allSettled([
    loadSignatureQueue(),
    loadPasswordStatus(),
  ]);

  // Fallback: kalau cache kosong
  if (cachedApprovals.length === 0) {
    await loadData(false);
  }

  console.log('[TandaTanganView] ✅ Mount complete');
  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[TandaTanganView] 🛑 unmounted');

  ctx.state.qrCanvasRef = null;
  ctx.state.queueList = [];
  ctx.state.candidateList = [];
  ctx.state.selectedQueueCandidateIds.clear();

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const raw = AdminModule.getDigitalApprovals() || [];
  const freshGrouped = groupApprovals(raw);
  const freshHash = computeListHash(freshGrouped);

  if (freshHash === ctx.state.lastHash) {
    console.log('[TandaTanganView] No change, skip re-render');
    return;
  }

  ctx.state.grouped = freshGrouped;
  ctx.state.lastHash = freshHash;
  renderTable();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // ===== REKAP TTD =====
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    renderTable();
  }, SEARCH_DEBOUNCE));

  ctx.on(getEl('filterRole'), 'change', function (e) {
    ctx.state.filterRole = e.target.value;
    ctx.state.currentPage = 1;
    renderTable();
  });

  ctx.on(getEl('refreshBtn'), 'click', handleRefresh);
  ctx.on(getEl('downloadQrBtn'), 'click', downloadQR);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // Sort header
  ctx.on(document.querySelector('#signatureTable th[data-sort]'), 'click', function () {
    handleSort(this.dataset.sort);
  });

  // ===== QUEUE PANEL =====
  ctx.on(getEl('adminClearQueueBtn'), 'click', handleClearQueue);
  ctx.on(getEl('adminSelectAllCandidatesBtn'), 'click', handleSelectAllCandidates);
  ctx.on(getEl('adminRefreshQueueBtn'), 'click', handleRefreshQueue);
  ctx.on(getEl('adminAddSelectedToQueueBtn'), 'click', handleAddSelectedToQueue);

  // Search candidate (debounced)
  ctx.on(getEl('adminQueueSearchInput'), 'input', debounce(function (e) {
    renderAdminCandidateList(e.target.value.trim().toLowerCase());
  }, SEARCH_DEBOUNCE));

  // Candidate checkbox (delegation)
  const candidateContainer = getEl('adminCandidateList');
  if (candidateContainer) {
    ctx.on(candidateContainer, 'change', (e) => {
      const cb = e.target.closest('.queue-candidate-checkbox');
      if (!cb) return;
      const id = String(cb.dataset.pesertaId || '');
      if (!id) return;
      if (cb.checked) ctx.state.selectedQueueCandidateIds.add(id);
      else ctx.state.selectedQueueCandidateIds.delete(id);
      updateAdminSelectedCount();
    });
  }

  // Queue remove chip (delegation)
  const queueListEl = getEl('adminQueueList');
  if (queueListEl) {
    ctx.on(queueListEl, 'click', async (e) => {
      const btn = e.target.closest('[data-remove-queue]');
      if (!btn) return;
      e.preventDefault();
      const nama = btn.dataset.removeQueue;
      if (!nama) return;
      if (!confirm(`Hapus "${nama}" dari queue TTD?`)) return;

      try {
        await removeFromSignatureQueue(nama);
        showToast(`"${nama}" dihapus dari queue`, 'info');
        await loadSignatureQueue();
      } catch (err) {
        showToast('Gagal: ' + err.message, 'error');
      }
    });
  }

  // ===== DELEGATION: Password toggle + save + table actions =====
  ctx.on(document, 'click', function (e) {
    // Password toggle
    const toggleBtn = e.target.closest('[data-toggle-pass]');
    if (toggleBtn) {
      const input = getEl(toggleBtn.dataset.togglePass);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      const i = toggleBtn.querySelector('i');
      if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
      return;
    }

    // Password save
    const saveBtn = e.target.closest('[data-save-role]');
    if (saveBtn) {
      savePassword(saveBtn.dataset.saveRole, saveBtn);
    }
  });

  // ===== DELEGATION: Table body =====
  const tableBody = getEl('tableBody');
  if (tableBody) {
    ctx.on(tableBody, 'click', (e) => {
      // TTD preview
      const img = e.target.closest('[data-preview-ttd]');
      if (img) {
        e.preventDefault();
        window.open(
          `https://drive.google.com/file/d/${img.dataset.previewTtd}/view`,
          '_blank',
          'noopener,noreferrer'
        );
        return;
      }

      // Action button (qr / delete)
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.preventDefault();
        const action = actionBtn.dataset.action;
        const nama = actionBtn.dataset.nama;

        if (action === 'qr') showQRGroup(nama);
        else if (action === 'delete') confirmDelete(nama);
      }
    });
  }

  // ===== DELEGATION: Pagination =====
  const pag = getEl('paginationControls');
  if (pag) {
    ctx.on(pag, 'click', (e) => {
      const pageEl = e.target.closest('[data-page]');
      if (!pageEl) return;
      e.preventDefault();
      const page = parseInt(pageEl.dataset.page, 10);
      if (!isNaN(page)) goToPage(page);
    });
  }

  // ===== Password input → strength indicator =====
  Object.entries(ROLE_INPUT_MAP).forEach(([role, inputId]) => {
    const input = getEl(inputId);
    if (!input) return;

    const wrapper = input.closest('.input-group');
    if (!wrapper) return;

    let bar = wrapper.parentElement.querySelector('.pass-strength-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'pass-strength-bar small mt-1';
      wrapper.parentElement.appendChild(bar);
    }

    ctx.on(input, 'input', function () {
      const strength = getPasswordStrength(this.value);
      if (!this.value) {
        bar.innerHTML = '';
        return;
      }
      bar.innerHTML = `<span class="${strength.class}">${strength.label}</span>`;
    });
  });

  // ===== Modal cleanup =====
  const qrModal = getEl('qrModal');
  if (qrModal) {
    ctx.on(qrModal, 'hidden.bs.modal', () => {
      ctx.state.qrCanvasRef = null;
      const container = getEl('qrContainer');
      if (container) container.innerHTML = '';
      const info = getEl('qrInfo');
      if (info) info.innerHTML = '';
    });
  }
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonTable() {
  const tbody = getEl('tableBody');
  if (!tbody) return;

  let html = '';
  for (let r = 0; r < 5; r++) {
    html += '<tr>';
    for (let c = 0; c < 6; c++) {
      html += `<td><div class="skeleton-box" style="height:20px;width:${c === 0 ? 30 : 80}px;"></div></td>`;
    }
    html += '</tr>';
  }
  tbody.innerHTML = html;
}

// ============================================================
//   QUEUE — LOAD
// ============================================================
async function loadSignatureQueue() {
  try {
    const [queueRes, allPeserta] = await Promise.all([
      getSignatureQueue(),
      Promise.resolve(AdminModule.getPesertaList() || []),
    ]);

    const queueList = (queueRes && queueRes.success && Array.isArray(queueRes.data))
      ? queueRes.data
      : [];
    ctx.state.queueList = queueList;

    // Build set untuk lookup cepat
    const queueSet = new Set(
      queueList.map(q => normalizeKey(q.peserta_nama)).filter(Boolean)
    );

    // Kandidat = peserta approved/active yang BELUM di queue
    const candidates = allPeserta.filter(p => {
      const status = String(p.status || '').toLowerCase();
      if (status !== 'approved' && status !== 'active') return false;
      const key = normalizeKey(p.nama_lengkap || '');
      return key && !queueSet.has(key);
    });

    ctx.state.candidateList = candidates;

    renderAdminQueueList();
    renderAdminCandidateList(
      (getEl('adminQueueSearchInput')?.value || '').trim().toLowerCase()
    );
    updateAdminQueueCount();
  } catch (e) {
    console.warn('[TandaTanganView] loadSignatureQueue error:', e);
    const queueListEl = getEl('adminQueueList');
    if (queueListEl) {
      queueListEl.innerHTML = `<div class="alert alert-warning small mb-0">
        Gagal memuat queue: ${escapeHtml(e.message)}
      </div>`;
    }
  }
}

// ============================================================
//   QUEUE — RENDER CHIPS
// ============================================================
function renderAdminQueueList() {
  const el = getEl('adminQueueList');
  if (!el) return;

  const queue = ctx.state.queueList || [];

  if (queue.length === 0) {
    el.innerHTML = `<div class="alert alert-info small mb-0">
      <i class="bi bi-inbox me-1" aria-hidden="true"></i>
      Belum ada peserta di queue. Pilih dari daftar di bawah.
    </div>`;
    return;
  }

  let html = `
    <div class="small text-muted text-uppercase fw-bold mb-2"
         style="letter-spacing:0.04em;font-size:0.7rem;">
      Peserta di Queue (${queue.length})
    </div>
    <div class="d-flex flex-wrap gap-2">
  `;

  queue.forEach(q => {
    const safeNama = escapeHtml(q.peserta_nama || '-');
    const selectedBy = q.selected_by || 'admin';
    const tooltip = `Dipilih oleh: ${selectedBy}`;

    html += `
      <span class="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-2 px-3 py-2"
            style="font-size:0.78rem;"
            title="${escapeHtml(tooltip)}">
        ${safeNama}
        <button type="button" class="btn-close btn-close-sm"
                style="font-size:0.55rem;"
                data-remove-queue="${safeNama}"
                aria-label="Hapus ${safeNama} dari queue"></button>
      </span>
    `;
  });

  html += `</div>`;
  el.innerHTML = html;
}

// ============================================================
//   QUEUE — RENDER CANDIDATE LIST
// ============================================================
function renderAdminCandidateList(searchQuery = '') {
  const el = getEl('adminCandidateList');
  const countEl = getEl('adminCandidateCount');
  if (!el) return;

  let candidates = ctx.state.candidateList || [];

  if (searchQuery) {
    candidates = candidates.filter(p =>
      String(p.nama_lengkap || '').toLowerCase().includes(searchQuery)
    );
  }

  if (countEl) countEl.textContent = String(candidates.length);

  if (candidates.length === 0) {
    el.innerHTML = `<div class="col-12">
      <div class="alert alert-info small mb-0">
        <i class="bi bi-info-circle me-1" aria-hidden="true"></i>
        ${searchQuery
          ? 'Tidak ada kandidat sesuai pencarian.'
          : 'Semua peserta approved sudah ada di queue atau belum ada peserta approved.'}
      </div>
    </div>`;
    return;
  }

  let html = '';
  candidates.forEach(p => {
    const safeId = escapeHtml(String(p.id || ''));
    const safeNama = escapeHtml(p.nama_lengkap || '-');
    const safePac = escapeHtml(p.utusan || '-');
    const isChecked = ctx.state.selectedQueueCandidateIds.has(String(p.id));

    html += `
      <div class="col-md-6 col-lg-4">
        <label class="d-flex align-items-center gap-2 p-2 rounded-3"
               style="background:#f8fafc;border:1px solid #e2e8f0;cursor:pointer;">
          <input type="checkbox" class="form-check-input queue-candidate-checkbox"
                 value="${safeNama}"
                 data-peserta-id="${safeId}"
                 ${isChecked ? 'checked' : ''}
                 aria-label="Pilih ${safeNama}">
          <div style="min-width:0;flex:1;">
            <div class="fw-semibold small text-truncate" title="${safeNama}">${safeNama}</div>
            <div class="text-muted" style="font-size:0.7rem;">${safePac}</div>
          </div>
        </label>
      </div>
    `;
  });

  el.innerHTML = html;
  updateAdminSelectedCount();
}

// ============================================================
//   QUEUE — UPDATE COUNTS
// ============================================================
function updateAdminQueueCount() {
  const el = getEl('adminQueueCount');
  if (el) el.textContent = `${(ctx.state.queueList || []).length} di queue`;

  const clearBtn = getEl('adminClearQueueBtn');
  if (clearBtn) clearBtn.disabled = (ctx.state.queueList || []).length === 0;
}

function updateAdminSelectedCount() {
  const count = ctx.state.selectedQueueCandidateIds.size;
  const badge = getEl('adminSelectedCountBadge');
  const btn = getEl('adminAddSelectedToQueueBtn');
  if (badge) badge.textContent = String(count);
  if (btn) btn.disabled = count === 0;
}

// ============================================================
//   QUEUE — HANDLERS
// ============================================================
async function handleAddSelectedToQueue(e) {
  if (ctx.state.isQueueProcessing) return;

  const selectedIds = Array.from(ctx.state.selectedQueueCandidateIds);
  if (selectedIds.length === 0) return;

  const items = selectedIds
    .map(id => {
      const p = ctx.state.candidateList.find(x => String(x.id) === String(id));
      if (!p) return null;
      return {
        peserta_nama: p.nama_lengkap || '',
        peserta_id: id,
      };
    })
    .filter(x => x && x.peserta_nama);

  if (items.length === 0) {
    showToast('Tidak ada peserta valid untuk ditambahkan', 'warning');
    return;
  }

  const btn = e?.currentTarget || getEl('adminAddSelectedToQueueBtn');
  const original = btn ? btn.innerHTML : '';
  ctx.state.isQueueProcessing = true;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menambah…';
  }

  try {
    // ⭐ selected_by = 'admin'
    const res = await addBulkToSignatureQueue(items, 'admin');

    if (res && res.success) {
      const addedCount = res.added || items.length;
      const skipped = res.skipped || 0;
      showToast(
        `${addedCount} peserta ditambahkan ke queue` +
        (skipped ? ` (${skipped} duplikat dilewati)` : ''),
        'success'
      );
      ctx.state.selectedQueueCandidateIds.clear();
      await loadSignatureQueue();
    } else {
      throw new Error((res && res.error) || 'Gagal menambah');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  } finally {
    ctx.state.isQueueProcessing = false;
  }
}

async function handleClearQueue() {
  const count = (ctx.state.queueList || []).length;
  if (count === 0) return;

  if (!confirm(`Kosongkan seluruh queue (${count} peserta)?\n\nPeserta yang sudah di-TTD tidak akan terpengaruh.`)) return;

  const btn = getEl('adminClearQueueBtn');
  const original = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus…';
  }

  try {
    const res = await clearSignatureQueue();
    if (res && res.success) {
      showToast('Queue dikosongkan', 'success');
      await loadSignatureQueue();
    } else {
      throw new Error((res && res.error) || 'Gagal mengosongkan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  }
}

function handleSelectAllCandidates() {
  const candidates = ctx.state.candidateList || [];
  if (candidates.length === 0) return;

  const allSelected = candidates.every(p =>
    ctx.state.selectedQueueCandidateIds.has(String(p.id))
  );

  if (allSelected) {
    ctx.state.selectedQueueCandidateIds.clear();
  } else {
    candidates.forEach(p => ctx.state.selectedQueueCandidateIds.add(String(p.id)));
  }

  renderAdminCandidateList(
    (getEl('adminQueueSearchInput')?.value || '').trim().toLowerCase()
  );
}

async function handleRefreshQueue(e) {
  const btn = e?.currentTarget || getEl('adminRefreshQueueBtn');
  const restore = btn ? setBtnLoading(btn, true, '') : () => {};
  try {
    await loadSignatureQueue();
    showToast('Queue disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
  }
}

// ============================================================
//   FILTER & SORT (Tabel rekap)
// ============================================================
function getFiltered() {
  let arr = ctx.state.grouped.slice();

  if (ctx.state.filterRole) {
    arr = arr.filter(g => {
      const role = ctx.state.filterRole;
      return g[`${role}_driveId`] && String(g[`${role}_driveId`]).trim() !== '';
    });
  }

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    arr = arr.filter(g =>
      String(g.peserta_nama || '').toLowerCase().includes(q) ||
      String(g.ketua_pc_nama || '').toLowerCase().includes(q) ||
      String(g.sekretaris_nama || '').toLowerCase().includes(q) ||
      String(g.instruktur_nama || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.sortColumn) {
    arr.sort((a, b) => {
      const va = String(a[ctx.state.sortColumn] || '').toLowerCase();
      const vb = String(b[ctx.state.sortColumn] || '').toLowerCase();
      if (va < vb) return ctx.state.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return ctx.state.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return arr;
}

// ============================================================
//   RENDER TABLE (Rekap TTD)
// ============================================================
function renderTable() {
  const tbody = getEl('tableBody');
  const recordCount = getEl('recordCount');
  const pag = getEl('paginationControls');
  const sortIndicator = getEl('sortIndicator');
  if (!tbody) return;

  const savedFocus = captureFocusState('searchInput');

  ctx.state.filtered = getFiltered();
  const totalItems = ctx.state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filtered.slice(start, end);

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery || ctx.state.filterRole;
    tbody.innerHTML = `<tr>
      <td colspan="6" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
        Tidak ada data TTD${hasFilter ? ' sesuai filter' : ''}.
      </td>
    </tr>`;
  } else {
    let html = '';
    pageData.forEach((g, idx) => {
      const globalIdx = start + idx + 1;
      const safeNama = escapeHtml(g.peserta_nama);

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${safeNama}</strong></td>
        <td>${renderTTDColumn(g.ketua_pc_nama, g.ketua_pc_driveId, g.ketua_pc_timestamp)}</td>
        <td>${renderTTDColumn(g.sekretaris_nama, g.sekretaris_driveId, g.sekretaris_timestamp)}</td>
        <td>${renderTTDColumn(g.instruktur_nama, g.instruktur_driveId, g.instruktur_timestamp)}</td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-info me-1"
                  data-action="qr" data-nama="${safeNama}"
                  title="QR Verifikasi" aria-label="QR Verifikasi ${safeNama}">
            <i class="bi bi-qr-code" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger"
                  data-action="delete" data-nama="${safeNama}"
                  title="Hapus Semua TTD" aria-label="Hapus Semua TTD ${safeNama}">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
    tbody.innerHTML = html;
  }

  // Sort indicator
  if (sortIndicator) {
    sortIndicator.textContent = ctx.state.sortDirection === 'asc' ? '↑' : '↓';
  }

  // Record count
  if (recordCount) {
    recordCount.textContent = totalItems > 0
      ? `Menampilkan ${start + 1} - ${end} dari ${totalItems} data`
      : 'Tidak ada data';
  }

  // Pagination
  if (pag) {
    if (totalPages <= 1) {
      pag.innerHTML = '';
    } else {
      const maxButtons = 7;
      let s = Math.max(1, ctx.state.currentPage - Math.floor(maxButtons / 2));
      let e = Math.min(totalPages, s + maxButtons - 1);
      if (e - s + 1 < maxButtons) s = Math.max(1, e - maxButtons + 1);

      let html = '<ul class="pagination pagination-sm mb-0">';

      html += `<li class="page-item ${ctx.state.currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${ctx.state.currentPage - 1}" aria-label="Sebelumnya">«</a></li>`;

      if (s > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>`;
        if (s > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      }

      for (let i = s; i <= e; i++) {
        html += `<li class="page-item ${i === ctx.state.currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
      }

      if (e < totalPages) {
        if (e < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" data-page="${totalPages}">${totalPages}</a></li>`;
      }

      html += `<li class="page-item ${ctx.state.currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-page="${ctx.state.currentPage + 1}" aria-label="Selanjutnya">»</a></li>`;

      html += '</ul>';
      pag.innerHTML = html;
    }
  }

  restoreFocusState('searchInput', savedFocus);
}

function handleSort(col) {
  if (ctx.state.sortColumn === col) {
    ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    ctx.state.sortColumn = col;
    ctx.state.sortDirection = 'asc';
  }
  ctx.state.currentPage = 1;
  renderTable();
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(ctx.state.filtered.length / ctx.state.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderTable();
  getEl('signatureTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    console.error('[TandaTanganView] loadData:', e);
    if (ctx.state.grouped.length === 0) {
      const tbody = getEl('tableBody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">
          Gagal memuat data: ${escapeHtml(e.message)}
        </td></tr>`;
      }
    }
    setCacheStatus('Error');
  }
}

// ============================================================
//   REFRESH (manual)
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving || ctx.state.isProcessing) return;

  const btn = e.currentTarget || getEl('refreshBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');
  ctx.saving = true;
  ctx.state.isProcessing = true;

  try {
    await AdminModule.loadAllData(true);
    refreshFromCache();
    await Promise.allSettled([
      loadPasswordStatus(),
      loadSignatureQueue(),
    ]);
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.isProcessing = false;
  }
}

// ============================================================
//   QR VERIFIKASI PER PESERTA
// ============================================================
async function showQRGroup(pesertaNama) {
  if (typeof qrcode !== 'function') {
    showToast('Library QR tidak tersedia', 'error');
    return;
  }

  if (!pesertaNama) {
    showToast('Nama peserta tidak valid', 'error');
    return;
  }

  const baseUrl = window.location.origin + BASE_PATH;
  let verifyUrl = '';
  let displayNomor = '-';

  const certList = AdminModule.getSertifikatList() || [];
  const found = certList.find(c =>
    String(c.nama_peserta || '').toLowerCase() === String(pesertaNama).toLowerCase()
  );

  if (found && found.nomor_sertifikat) {
    displayNomor = found.nomor_sertifikat;
    verifyUrl = `${baseUrl}verifikasi_qr.html?nomor=${encodeURIComponent(found.nomor_sertifikat)}`;
  } else {
    verifyUrl = `${baseUrl}verifikasi_qr.html?nama=${encodeURIComponent(pesertaNama)}`;
    displayNomor = '(Sertifikat belum digenerate)';
  }

  try {
    const qr = qrcode(0, 'M');
    qr.addData(verifyUrl);
    qr.make();

    const moduleCount = qr.getModuleCount();
    const cellSize = 6;
    const margin = 12;
    const size = moduleCount * cellSize + margin * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c2d = canvas.getContext('2d');
    c2d.fillStyle = '#ffffff';
    c2d.fillRect(0, 0, size, size);
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          c2d.fillStyle = '#000000';
          c2d.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
        }
      }
    }

    const container = getEl('qrContainer');
    if (!container) return;
    container.innerHTML = '';

    canvas.style.border = '1px solid #e2e8f0';
    canvas.style.borderRadius = '8px';
    canvas.style.padding = '10px';
    canvas.style.background = '#fff';
    canvas.style.maxWidth = '260px';
    container.appendChild(canvas);
    ctx.state.qrCanvasRef = canvas;

    const infoEl = getEl('qrInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <strong>Peserta:</strong> ${escapeHtml(pesertaNama)}<br>
        <strong>Nomor Sertifikat:</strong> <code>${escapeHtml(displayNomor)}</code><br>
        <a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary mt-2">
          <i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i>Buka Link Verifikasi
        </a>
      `;
    }

    ctx.getModal('qrModal')?.show();
  } catch (e) {
    showToast('Gagal generate QR: ' + e.message, 'error');
  }
}

function downloadQR() {
  const canvas = ctx.state.qrCanvasRef;
  if (!canvas) {
    showToast('QR belum tersedia', 'warning');
    return;
  }
  try {
    const link = document.createElement('a');
    link.download = `QR_TTD_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('QR berhasil diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh QR', 'error');
  }
}

// ============================================================
//   DELETE ALL TTD PER PESERTA
// ============================================================
function confirmDelete(pesertaNama) {
  if (!pesertaNama) return;

  ctx.state.deleteTarget = pesertaNama;
  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = pesertaNama;

  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving || ctx.state.isProcessing) return;

  const nama = ctx.state.deleteTarget;
  if (!nama) return;

  const btn = e.currentTarget || getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');
  ctx.saving = true;
  ctx.state.isProcessing = true;

  try {
    const res = await callApi('deleteDigitalApprovalByPeserta', { peserta_nama: nama }, 'POST');
    if (res && res.success) {
      showToast(`Semua TTD untuk "${nama}" berhasil dihapus`, 'success');
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
    ctx.state.isProcessing = false;
    ctx.state.deleteTarget = null;
  }
}

// ============================================================
//   PASSWORD PER ROLE
// ============================================================
async function loadPasswordStatus() {
  try {
    const res = await callApi('getSignPasswords', {}, 'GET');
    if (!ctx.mounted) return;

    if (res && res.success && res.data) {
      Object.keys(ROLE_STATUS_MAP).forEach(role => {
        const el = getEl(ROLE_STATUS_MAP[role]);
        if (!el) return;
        const has = !!res.data[role];
        el.textContent = has ? '✅ Tersimpan' : '⚠ Belum diset';
        el.className = has ? 'text-success ms-2' : 'text-warning ms-2';
      });
    }
  } catch (e) {
    console.warn('[TandaTanganView] loadPasswordStatus:', e);
  }
}

async function savePassword(role, triggerBtn) {
  if (ctx.saving) return;

  const inputId = ROLE_INPUT_MAP[role];
  const statusId = ROLE_STATUS_MAP[role];
  const input = getEl(inputId);
  const statusEl = getEl(statusId);
  const newPass = input?.value.trim() || '';

  if (!newPass || newPass.length < MIN_PASSWORD_LENGTH) {
    if (statusEl) {
      statusEl.textContent = `⚠ Minimal ${MIN_PASSWORD_LENGTH} karakter`;
      statusEl.className = 'text-danger ms-2';
    }
    showToast(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`, 'warning');
    return;
  }

  if (!confirm(`Ubah password untuk role "${ROLE_LABELS[role]}"?`)) return;

  const restore = setBtnLoading(triggerBtn, true, 'Menyimpan...');
  ctx.saving = true;

  try {
    const res = await callApi('updateSignPassword', { role, newPassword: newPass }, 'POST');
    if (res && res.success) {
      showToast(`Password ${ROLE_LABELS[role]} berhasil diubah`, 'success');
      if (input) input.value = '';
      if (statusEl) {
        statusEl.textContent = '✅ Tersimpan';
        statusEl.className = 'text-success ms-2';
      }
      const bar = input?.parentElement?.querySelector('.pass-strength-bar');
      if (bar) bar.innerHTML = '';
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah password');
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ ' + e.message;
      statusEl.className = 'text-danger ms-2';
    }
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Tanda Tangan View v28.1.0 — Admin Queue Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
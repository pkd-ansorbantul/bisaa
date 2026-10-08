// ============================================================
// VIEW: tanda-tangan.js — v27.2.0 PRELOAD + SUBSCRIPTION
// Dimuat oleh: js/router.js
// HTML: views/admin/tanda-tangan.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 90s
//   ✅ FIX: Password save loading state per-role + rollback on error
//   ✅ FIX: Modal cleanup via ctx.cleanup (zero leak)
//   ✅ FIX: Null-safe element access — zero crash
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: All 3 roles password management, QR verify, delete
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  formatDateTimeID,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
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
const ROLE_LABELS = {
  ketua_pc: 'Ketua PC',
  sekretaris: 'Sekretaris',
  instruktur: 'Instruktur',
};

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

// ============================================================
//   LOCAL HELPERS
// ============================================================
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

    const role = String(row.role || '').toLowerCase();
    const nama = row.nama || '';
    const driveId = row.driveId || '';
    const timestamp = row.timestamp || '';

    if (role === 'ketua_pc') {
      map[peserta].ketua_pc_nama = nama;
      map[peserta].ketua_pc_driveId = driveId;
      map[peserta].ketua_pc_timestamp = timestamp;
    } else if (role === 'sekretaris') {
      map[peserta].sekretaris_nama = nama;
      map[peserta].sekretaris_driveId = driveId;
      map[peserta].sekretaris_timestamp = timestamp;
    } else if (role === 'instruktur') {
      map[peserta].instruktur_nama = nama;
      map[peserta].instruktur_driveId = driveId;
      map[peserta].instruktur_timestamp = timestamp;
    }
  });
  return Object.values(map);
}

function renderTTDColumn(nama, driveId, timestamp) {
  if (!driveId) return '<span class="text-muted small">—</span>';
  const safeNama = escapeHtml(nama || '-');
  const safeId = escapeHtml(driveId);
  const thumbUrl = `https://drive.google.com/thumbnail?id=${safeId}&sz=w150`;
  const viewUrl = `https://drive.google.com/file/d/${safeId}/view`;
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
      <span class="text-muted" style="font-size:0.65rem;">${escapeHtml(formatDateTimeID(timestamp))}</span>
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

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
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
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'ttd'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[TandaTanganView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[TandaTanganView] Re-render error:', e);
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
    console.warn('[TandaTanganView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[TandaTanganView] mounted');

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
  });

  // Reset UI
  const searchEl = getEl('searchInput');
  const filterEl = getEl('filterRole');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  ['passKetua', 'passSekretaris', 'passInstruktur'].forEach(id => {
    const el = getEl(id);
    if (el) el.value = '';
  });
  ['statusKetua', 'statusSekretaris', 'statusInstruktur'].forEach(id => {
    const el = getEl(id);
    if (el) { el.textContent = '—'; el.className = 'text-muted ms-2'; }
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
    setCacheStatus('Memuat…');
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Load password status (tidak di-preload, perlu fresh)
  await loadPasswordStatus();
  
  // Fallback: kalau cache kosong
  if (cachedApprovals.length === 0) {
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
  console.log('[TandaTanganView] unmounted');

  if (tableCleanup) {
    try { tableCleanup(); } catch (e) { /* silent */ }
    tableCleanup = null;
  }

  ctx.state.qrCanvasRef = null;
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
  // Search + filter
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

  // Sort headers
  document.querySelectorAll('#signatureTable th[data-sort]').forEach(th => {
    ctx.on(th, 'click', () => {
      const col = th.dataset.sort;
      if (ctx.state.sortColumn === col) {
        ctx.state.sortDirection = ctx.state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        ctx.state.sortColumn = col;
        ctx.state.sortDirection = 'asc';
      }
      ctx.state.currentPage = 1;
      renderTable();
    });
  });

  // Toolbar
  ctx.on(getEl('refreshBtn'), 'click', handleRefresh);
  ctx.on(getEl('downloadQrBtn'), 'click', downloadQR);
  ctx.on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // ✅ Delegation — password toggle + save per role
  ctx.on(document, 'click', function (e) {
    const toggleBtn = e.target.closest('[data-toggle-pass]');
    if (toggleBtn) {
      const input = getEl(toggleBtn.dataset.togglePass);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
      const i = toggleBtn.querySelector('i');
      if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
      return;
    }

    const saveBtn = e.target.closest('[data-save-role]');
    if (saveBtn) {
      savePassword(saveBtn.dataset.saveRole, saveBtn);
    }
  });

  // ✅ Delegation — table body (actions)
  const tableBody = getEl('tableBody');
  if (tableBody) {
    tableCleanup = delegateTableClicks(tableBody, {
      onAction: (action, _id, el) => {
        const nama = el.dataset.nama;
        if (action === 'qr') showQRGroup(nama);
        else if (action === 'delete') confirmDelete(nama);
      },
    });

    // Preview TTD image
    ctx.on(tableBody, 'click', (e) => {
      const img = e.target.closest('[data-preview-ttd]');
      if (!img) return;
      e.preventDefault();
      window.open(
        `https://drive.google.com/file/d/${img.dataset.previewTtd}/view`,
        '_blank',
        'noopener,noreferrer'
      );
    });
  }

  // Pagination — delegation
  const pag = getEl('paginationControls');
  if (pag) {
    ctx.on(pag, 'click', (e) => {
      const pageEl = e.target.closest('[data-action="goto"]');
      if (!pageEl) return;
      e.preventDefault();
      const page = parseInt(pageEl.dataset.page, 10);
      if (!isNaN(page)) goToPage(page);
    });
  }
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = ctx.state.grouped.slice();

  if (ctx.state.filterRole) {
    arr = arr.filter(g => {
      if (ctx.state.filterRole === 'ketua_pc') return !!g.ketua_pc_driveId;
      if (ctx.state.filterRole === 'sekretaris') return !!g.sekretaris_driveId;
      if (ctx.state.filterRole === 'instruktur') return !!g.instruktur_driveId;
      return true;
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
//   RENDER — TABLE
// ============================================================
function renderTable() {
  const tbody = getEl('tableBody');
  const recordCount = getEl('recordCount');
  const pag = getEl('paginationControls');
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
                  title="QR Verifikasi" aria-label="QR Verifikasi">
            <i class="bi bi-qr-code" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger"
                  data-action="delete" data-nama="${safeNama}"
                  title="Hapus Semua TTD" aria-label="Hapus Semua TTD">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
    tbody.innerHTML = html;
  }

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
      let html = '<ul class="pagination pagination-sm mb-0">';
      html += `<li class="page-item ${ctx.state.currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-action="goto" data-page="${ctx.state.currentPage - 1}" aria-label="Sebelumnya">«</a></li>`;

      const maxButtons = 7;
      let s = Math.max(1, ctx.state.currentPage - Math.floor(maxButtons / 2));
      let e = Math.min(totalPages, s + maxButtons - 1);
      if (e - s + 1 < maxButtons) s = Math.max(1, e - maxButtons + 1);

      if (s > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-action="goto" data-page="1">1</a></li>`;
        if (s > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      }
      for (let i = s; i <= e; i++) {
        html += `<li class="page-item ${i === ctx.state.currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-action="goto" data-page="${i}">${i}</a></li>`;
      }
      if (e < totalPages) {
        if (e < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" data-action="goto" data-page="${totalPages}">${totalPages}</a></li>`;
      }
      html += `<li class="page-item ${ctx.state.currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-action="goto" data-page="${ctx.state.currentPage + 1}" aria-label="Selanjutnya">»</a></li>`;
      html += '</ul>';
      pag.innerHTML = html;
    }
  }

  restoreFocusState('searchInput', savedFocus);
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
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;
  ctx.saving = true;

  const btn = e.currentTarget || getEl('refreshBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    await AdminModule.loadAllData(true);
    refreshFromCache();
    await loadPasswordStatus();
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
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

  const baseUrl = window.location.origin + BASE_PATH;
  let verifyUrl = '';
  let displayNomor = '-';

  // Baca dari AdminModule cache — tidak fetch API
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
    link.click();
    showToast('QR berhasil diunduh', 'success');
  } catch (e) {
    showToast('Gagal unduh QR', 'error');
  }
}

// ============================================================
//   DELETE ALL TTD FOR PESERTA
// ============================================================
function confirmDelete(pesertaNama) {
  ctx.state.deleteTarget = pesertaNama;
  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = pesertaNama;
  ctx.getModal('deleteConfirmModal')?.show();
}

async function executeDelete(e) {
  if (ctx.saving) return;

  const nama = ctx.state.deleteTarget;
  if (!nama) return;

  ctx.saving = true;
  const btn = e.currentTarget || getEl('confirmDeleteBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

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
  const inputId = ROLE_INPUT_MAP[role];
  const statusId = ROLE_STATUS_MAP[role];
  const input = getEl(inputId);
  const statusEl = getEl(statusId);
  const newPass = input?.value.trim() || '';

  if (!newPass || newPass.length < 6) {
    if (statusEl) {
      statusEl.textContent = '⚠ Minimal 6 karakter';
      statusEl.className = 'text-danger ms-2';
    }
    showToast('Password minimal 6 karakter', 'warning');
    return;
  }

  if (!confirm(`Ubah password untuk role "${ROLE_LABELS[role]}"?`)) return;

  const restore = setBtnLoading(triggerBtn, true, 'Menyimpan...');

  try {
    const res = await callApi('updateSignPassword', { role, newPassword: newPass }, 'POST');
    if (res && res.success) {
      showToast(`Password ${ROLE_LABELS[role]} berhasil diubah`, 'success');
      if (input) input.value = '';
      if (statusEl) {
        statusEl.textContent = '✅ Tersimpan';
        statusEl.className = 'text-success ms-2';
      }
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
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Tanda Tangan View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
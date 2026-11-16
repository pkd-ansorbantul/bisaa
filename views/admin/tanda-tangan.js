// ============================================================
// VIEW: tanda-tangan.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/tanda-tangan.html
// ============================================================
// Fitur:
// ✅ Group TTD per peserta (Ketua PC, Sekretaris, Instruktur)
// ✅ Filter role, search, sort, pagination
// ✅ QR verifikasi per peserta (dengan nomor sertifikat lookup)
// ✅ Preview TTD image (open in new tab)
// ✅ Atur password per role
// ✅ Hapus batch TTD per peserta
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
// ============================================================

import { callApi, showToast, escapeHtml } from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

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
//   MODULE STATE
// ============================================================
let pollInterval = null;
let searchDebounceTimer = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
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

function formatDate(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
}

// ============================================================
//   GROUP APPROVALS BY PESERTA
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

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[TandaTanganView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[TandaTanganView] mounted');

  // Reset state
  STATE.grouped = [];
  STATE.filtered = [];
  STATE.searchQuery = '';
  STATE.filterRole = '';
  STATE.sortColumn = 'peserta_nama';
  STATE.sortDirection = 'asc';
  STATE.currentPage = 1;
  STATE.deleteTarget = null;
  STATE.qrCanvasRef = null;
  STATE.isLoading = false;

  // Reset form
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
    if (el) {
      el.textContent = '—';
      el.className = 'text-muted ms-2';
    }
  });

  await loadData(true);
  await loadPasswordStatus();

  bindEvents();

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
  console.log('[TandaTanganView] unmounted');

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
  STATE.qrCanvasRef = null;

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
  const filterEl = getEl('filterRole');

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    STATE.currentPage = 1;
    renderTable();
  }, 300));

  on(filterEl, 'change', function (e) {
    STATE.filterRole = e.target.value;
    STATE.currentPage = 1;
    renderTable();
  });

  // Sort headers
  document.querySelectorAll('#signatureTable th[data-sort]').forEach(th => {
    on(th, 'click', () => {
      const col = th.dataset.sort;
      if (STATE.sortColumn === col) {
        STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        STATE.sortColumn = col;
        STATE.sortDirection = 'asc';
      }
      STATE.currentPage = 1;
      renderTable();
    });
  });

  // Refresh button
  on(getEl('refreshBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await loadData(true);
      await loadPasswordStatus();
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  // QR download
  on(getEl('downloadQrBtn'), 'click', downloadQR);

  // Confirm delete
  on(getEl('confirmDeleteBtn'), 'click', executeDelete);

  // Toggle password visibility
  on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });

  // Save password (delegation)
  on(document, 'click', function (e) {
    const t = e.target.closest('[data-save-role]');
    if (!t) return;
    savePassword(t.dataset.saveRole);
  });
}

// ============================================================
//   FILTER & SORT
// ============================================================
function getFiltered() {
  let arr = STATE.grouped.slice();

  if (STATE.filterRole) {
    arr = arr.filter(g => {
      if (STATE.filterRole === 'ketua_pc') return !!g.ketua_pc_driveId;
      if (STATE.filterRole === 'sekretaris') return !!g.sekretaris_driveId;
      if (STATE.filterRole === 'instruktur') return !!g.instruktur_driveId;
      return true;
    });
  }

  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    arr = arr.filter(g =>
      String(g.peserta_nama || '').toLowerCase().includes(q) ||
      String(g.ketua_pc_nama || '').toLowerCase().includes(q) ||
      String(g.sekretaris_nama || '').toLowerCase().includes(q) ||
      String(g.instruktur_nama || '').toLowerCase().includes(q)
    );
  }

  if (STATE.sortColumn) {
    arr.sort((a, b) => {
      const va = String(a[STATE.sortColumn] || '').toLowerCase();
      const vb = String(b[STATE.sortColumn] || '').toLowerCase();
      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  return arr;
}

// ============================================================
//   RENDER
// ============================================================
function renderTTDColumn(nama, driveId, timestamp) {
  if (!driveId) return '<span class="text-muted small">—</span>';
  const safeNama = escapeHtml(nama || '-');
  const safeId = escapeHtml(driveId);
  return `
    <div class="d-flex flex-column align-items-center gap-1">
      <span class="fw-semibold small text-center">${safeNama}</span>
      <img src="https://drive.google.com/thumbnail?id=${safeId}&sz=w150"
           alt="TTD ${safeNama}"
           class="border rounded"
           style="max-height:40px;max-width:100px;object-fit:contain;background:#fff;padding:2px;cursor:zoom-in;"
           data-preview-ttd="${safeId}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';">
      <code class="small text-muted" style="display:none;font-size:0.6rem;word-break:break-all;">${safeId}</code>
      <span class="text-muted" style="font-size:0.65rem;">${escapeHtml(formatDate(timestamp))}</span>
    </div>`;
}

function renderTable() {
  const tbody = getEl('tableBody');
  const recordCount = getEl('recordCount');
  const pag = getEl('paginationControls');
  if (!tbody) return;

  STATE.filtered = getFiltered();
  const totalItems = STATE.filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;

  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = STATE.filtered.slice(start, end);

  if (pageData.length === 0) {
    const hasFilter = STATE.searchQuery || STATE.filterRole;
    tbody.innerHTML = `<tr>
      <td colspan="6" class="text-center py-5 text-muted">
        <i class="bi bi-inbox fs-4 d-block mb-2"></i>
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
          <button class="btn btn-sm btn-outline-info me-1" data-action="qr" data-nama="${safeNama}" title="QR Verifikasi">
            <i class="bi bi-qr-code"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger" data-action="delete" data-nama="${safeNama}" title="Hapus Semua TTD">
            <i class="bi bi-trash"></i>
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

  if (pag) {
    if (totalPages <= 1) {
      pag.innerHTML = '';
    } else {
      let html = '<ul class="pagination pagination-sm mb-0">';
      html += `<li class="page-item ${STATE.currentPage === 1 ? 'disabled' : ''}">
        <a class="page-link" href="#" data-action="goto" data-page="${STATE.currentPage - 1}">«</a></li>`;

      const maxButtons = 7;
      let s = Math.max(1, STATE.currentPage - Math.floor(maxButtons / 2));
      let e = Math.min(totalPages, s + maxButtons - 1);
      if (e - s + 1 < maxButtons) s = Math.max(1, e - maxButtons + 1);

      if (s > 1) {
        html += `<li class="page-item"><a class="page-link" href="#" data-action="goto" data-page="1">1</a></li>`;
        if (s > 2) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
      }
      for (let i = s; i <= e; i++) {
        html += `<li class="page-item ${i === STATE.currentPage ? 'active' : ''}">
          <a class="page-link" href="#" data-action="goto" data-page="${i}">${i}</a></li>`;
      }
      if (e < totalPages) {
        if (e < totalPages - 1) html += `<li class="page-item disabled"><span class="page-link">…</span></li>`;
        html += `<li class="page-item"><a class="page-link" href="#" data-action="goto" data-page="${totalPages}">${totalPages}</a></li>`;
      }
      html += `<li class="page-item ${STATE.currentPage === totalPages ? 'disabled' : ''}">
        <a class="page-link" href="#" data-action="goto" data-page="${STATE.currentPage + 1}">»</a></li>`;
      html += '</ul>';
      pag.innerHTML = html;
    }
  }

  // Bind table actions
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', handleTableAction);
  });
  tbody.querySelectorAll('[data-preview-ttd]').forEach(img => {
    img.addEventListener('click', () => {
      window.open(`https://drive.google.com/file/d/${img.dataset.previewTtd}/view`, '_blank', 'noopener,noreferrer');
    });
  });
  pag?.querySelectorAll('[data-action="goto"]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      goToPage(parseInt(btn.dataset.page));
    });
  });
}

function handleTableAction(e) {
  const action = e.currentTarget.dataset.action;
  const nama = e.currentTarget.dataset.nama;
  if (action === 'qr') showQRGroup(nama);
  else if (action === 'delete') confirmDelete(nama);
}

function goToPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filtered.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderTable();
  getEl('signatureTable')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadData(forceRefresh = false) {
  if (STATE.isLoading) return;
  STATE.isLoading = true;

  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    const raw = AdminModule.getDigitalApprovals() || [];
    STATE.grouped = groupApprovals(raw);
    renderTable();

    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[TandaTanganView] loadData:', e);
    const tbody = getEl('tableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">
        Gagal memuat data: ${escapeHtml(e.message)}
      </td></tr>`;
    }
    if (cacheEl) {
      cacheEl.textContent = 'Error';
      cacheEl.className = 'cache-status offline';
    }
  } finally {
    STATE.isLoading = false;
  }
}

// ============================================================
//   QR VERIFIKASI
// ============================================================
async function showQRGroup(pesertaNama) {
  if (typeof qrcode !== 'function') {
    showToast('Library QR tidak tersedia', 'error');
    return;
  }

  const baseUrl = window.location.origin + '/bisaa/';
  let verifyUrl = '';
  let displayNomor = '-';

  try {
    const certRes = await callApi('getUploadedCertificates', {}, 'GET');
    const certList = Array.isArray(certRes) ? certRes : (certRes?.data || []);
    const found = certList.find(c =>
      String(c.nama_peserta || '').toLowerCase() === String(pesertaNama).toLowerCase()
    );
    if (found && found.nomor_sertifikat) {
      displayNomor = found.nomor_sertifikat;
      verifyUrl = `${baseUrl}verifikasi_qr.html?nomor=${encodeURIComponent(found.nomor_sertifikat)}`;
    }
  } catch (e) { /* silent */ }

  if (!verifyUrl) {
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
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillStyle = '#000000';
          ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
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
    STATE.qrCanvasRef = canvas;

    const infoEl = getEl('qrInfo');
    if (infoEl) {
      infoEl.innerHTML = `
        <strong>Peserta:</strong> ${escapeHtml(pesertaNama)}<br>
        <strong>Nomor Sertifikat:</strong> <code>${escapeHtml(displayNomor)}</code><br>
        <a href="${escapeHtml(verifyUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary mt-2">
          <i class="bi bi-box-arrow-up-right me-1"></i>Buka Link Verifikasi
        </a>
      `;
    }

    getModal('qrModal')?.show();
  } catch (e) {
    showToast('Gagal generate QR: ' + e.message, 'error');
  }
}

function downloadQR() {
  if (!STATE.qrCanvasRef) { showToast('QR belum tersedia', 'warning'); return; }
  try {
    const link = document.createElement('a');
    link.download = `QR_TTD_${Date.now()}.png`;
    link.href = STATE.qrCanvasRef.toDataURL('image/png');
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
  STATE.deleteTarget = pesertaNama;
  const nameEl = getEl('deleteTargetName');
  if (nameEl) nameEl.textContent = pesertaNama;
  getModal('deleteConfirmModal')?.show();
}

async function executeDelete() {
  const nama = STATE.deleteTarget;
  if (!nama) return;

  const btn = getEl('confirmDeleteBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteDigitalApprovalByPeserta', { peserta_nama: nama }, 'POST');
    if (res && res.success) {
      showToast(`Semua TTD untuk "${nama}" berhasil dihapus`, 'success');
      getModal('deleteConfirmModal')?.hide();
      STATE.grouped = STATE.grouped.filter(g => g.peserta_nama !== nama);
      renderTable();
      setTimeout(() => loadData(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.deleteTarget = null;
  }
}

// ============================================================
//   PASSWORD PER ROLE
// ============================================================
async function loadPasswordStatus() {
  try {
    const res = await callApi('getSignPasswords', {}, 'GET');
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

async function savePassword(role) {
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
  }
}
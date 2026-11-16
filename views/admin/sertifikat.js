// ============================================================
// VIEW: sertifikat.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/sertifikat.html
// ============================================================
// Fitur:
// ✅ Daftar sertifikat (search, sort, pagination)
// ✅ Download PDF
// ✅ Delete sertifikat
// ✅ Generate single & batch (dengan eligibility check)
// ✅ Progress bar generate
// ✅ CRUD template
// ✅ Tab: Daftar & Template
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup on unmount
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
  certificates: [],
  templates: [],
  participants: [],
  rtlData: [],
  approvals: [],
  filteredCertificates: [],
  searchQuery: '',
  currentPage: 1,
  itemsPerPage: 15,
  sortColumn: 'createdAt',
  sortDirection: 'desc',
  pendingDeleteCertId: null,
  pendingDeleteTemplateId: null,
  isGenerating: false,
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
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '-'; }
}

function normalizeResult(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (res.data && Array.isArray(res.data)) return res.data;
  return [];
}

// ============================================================
//   ELIGIBILITY CHECK
// ============================================================
function isParticipantEligible(p) {
  const status = String(p.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'active') {
    return { eligible: false, reason: 'Status belum disetujui' };
  }

  // RTL check
  const tasks = STATE.rtlData.filter(t => String(t.pesertaId) === String(p.id));
  if (tasks.length > 0 && !tasks.every(t => String(t.status).toLowerCase() === 'selesai')) {
    return { eligible: false, reason: 'RTL belum selesai' };
  }

  // TTD check
  const nama = p.nama_lengkap;
  const filtered = STATE.approvals.filter(a =>
    String(a.peserta_nama || '').toLowerCase() === String(nama || '').toLowerCase()
  );
  const hasKetua = filtered.some(a => a.role === 'ketua_pc');
  const hasSekretaris = filtered.some(a => a.role === 'sekretaris');
  const hasInstruktur = filtered.some(a => a.role === 'instruktur');
  if (!hasKetua || !hasSekretaris || !hasInstruktur) {
    return { eligible: false, reason: 'TTD digital belum lengkap' };
  }

  return { eligible: true };
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[SertifikatView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[SertifikatView] mounted');

  // Reset state
  STATE.certificates = [];
  STATE.templates = [];
  STATE.participants = [];
  STATE.rtlData = [];
  STATE.approvals = [];
  STATE.filteredCertificates = [];
  STATE.searchQuery = '';
  STATE.currentPage = 1;
  STATE.sortColumn = 'createdAt';
  STATE.sortDirection = 'desc';
  STATE.pendingDeleteCertId = null;
  STATE.pendingDeleteTemplateId = null;
  STATE.isGenerating = false;

  const searchEl = getEl('searchInput');
  if (searchEl) searchEl.value = '';

  renderSkeletonCerts();
  renderSkeletonTemplates();

  await Promise.all([
    loadCertificates(true).catch(e => console.error('loadCertificates:', e)),
    loadTemplates().catch(e => console.error('loadTemplates:', e)),
  ]);

  bindEvents();

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    loadCertificates(false)
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
  console.log('[SertifikatView] unmounted');

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

  on(searchEl, 'input', debounce(function (e) {
    STATE.searchQuery = e.target.value;
    STATE.currentPage = 1;
    renderCertTable();
  }, 300));

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await Promise.all([loadCertificates(true), loadTemplates()]);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  on(getEl('generateCertBtn'), 'click', () => openGenerateModal());
  on(getEl('genPesertaSelect'), 'change', updateGenValidation);
  on(getEl('genSubmitBtn'), 'click', executeGenerate);

  on(getEl('addTemplateBtn'), 'click', addTemplate);
  on(getEl('saveTemplateBtn'), 'click', saveTemplate);
  on(getEl('confirmDeleteTemplateBtn'), 'click', executeDeleteTemplate);
  on(getEl('confirmDeleteCertBtn'), 'click', executeDeleteCert);
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonCerts() {
  const c = getEl('certListContainer');
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

function renderSkeletonTemplates() {
  const c = getEl('templateContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(4).fill(0).map(() => `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`).join('')}
      </tr></thead>
      <tbody>${Array(4).fill(0).map(() =>
        `<tr>${Array(4).fill(0).map(() => `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   CERTIFICATES TABLE
// ============================================================
function getFilteredCertificates() {
  let filtered = STATE.certificates.slice();
  if (STATE.searchQuery.trim() !== '') {
    const q = STATE.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      String(item.nama_peserta || '').toLowerCase().includes(q) ||
      String(item.nomor_sertifikat || '').toLowerCase().includes(q)
    );
  }
  if (STATE.sortColumn) {
    filtered.sort((a, b) => {
      let va = a[STATE.sortColumn];
      let vb = b[STATE.sortColumn];
      if (STATE.sortColumn === 'createdAt') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
        if (isNaN(va)) va = 0;
        if (isNaN(vb)) vb = 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      if (va < vb) return STATE.sortDirection === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDirection === 'asc' ? 1 : -1;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }
  return filtered;
}

function renderCertTable() {
  const c = getEl('certListContainer');
  if (!c) return;

  STATE.filteredCertificates = getFilteredCertificates();
  const totalItems = STATE.filteredCertificates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / STATE.itemsPerPage));
  if (STATE.currentPage > totalPages) STATE.currentPage = totalPages;
  if (STATE.currentPage < 1) STATE.currentPage = 1;
  const start = (STATE.currentPage - 1) * STATE.itemsPerPage;
  const end = Math.min(start + STATE.itemsPerPage, totalItems);
  const pageData = STATE.filteredCertificates.slice(start, end);

  const arrow = (col) => {
    if (STATE.sortColumn !== col) return '↕';
    return STATE.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th style="cursor:pointer;" data-sort="nama_peserta">Nama Peserta ${arrow('nama_peserta')}</th>
      <th style="cursor:pointer;" data-sort="nomor_sertifikat">Nomor Sertifikat ${arrow('nomor_sertifikat')}</th>
      <th style="cursor:pointer;" data-sort="createdAt">Tanggal Terbit ${arrow('createdAt')}</th>
      <th style="width:150px;" class="text-center">PDF</th>
      <th style="width:110px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2"></i>
      ${STATE.searchQuery ? 'Tidak ada sertifikat sesuai pencarian.' : 'Belum ada sertifikat yang digenerate.'}
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const safeId = escapeHtml(String(item.id || ''));
      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama_peserta || '-')}</strong></td>
        <td><code>${escapeHtml(item.nomor_sertifikat || '-')}</code></td>
        <td>${escapeHtml(formatDate(item.createdAt))}</td>
        <td class="text-center">
          ${item.pdf_url
            ? `<a href="${escapeHtml(item.pdf_url)}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-success">
                 <i class="bi bi-download me-1"></i> Unduh
               </a>`
            : '<span class="text-muted small">-</span>'}
        </td>
        <td class="text-center">
          <button class="btn btn-sm btn-outline-danger" data-action="delete-cert" data-id="${safeId}" title="Hapus">
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

  c.querySelectorAll('[data-action="delete-cert"]').forEach(btn => {
    btn.addEventListener('click', () => confirmDeleteCert(btn.dataset.id));
  });
  c.querySelectorAll('[data-action="goto"]').forEach(btn => {
    btn.addEventListener('click', () => goToCertPage(parseInt(btn.dataset.page)));
  });
  c.querySelectorAll('[data-sort]').forEach(th => {
    th.addEventListener('click', () => handleSort(th.dataset.sort));
  });
}

function handleSort(col) {
  if (STATE.sortColumn === col) {
    STATE.sortDirection = STATE.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    STATE.sortColumn = col;
    STATE.sortDirection = 'asc';
  }
  STATE.currentPage = 1;
  renderCertTable();
}

function goToCertPage(page) {
  const totalPages = Math.max(1, Math.ceil(STATE.filteredCertificates.length / STATE.itemsPerPage));
  if (page < 1 || page > totalPages) return;
  STATE.currentPage = page;
  renderCertTable();
}

// ============================================================
//   TEMPLATES TABLE
// ============================================================
function renderTemplateTable() {
  const c = getEl('templateContainer');
  if (!c) return;

  if (!STATE.templates || STATE.templates.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center mb-0">
      Belum ada template. Klik <strong>Tambah Template</strong> untuk menambahkan.
    </div>`;
    return;
  }

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th>Nama Template</th>
      <th>ID Google Docs</th>
      <th style="width:150px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  STATE.templates.forEach((t, idx) => {
    const safeId = escapeHtml(String(t.id || ''));
    html += `<tr>
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(t.nama_template || '-')}</strong></td>
      <td><code class="small" style="word-break:break-all;">${escapeHtml(t.doc_template_id || '-')}</code></td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-warning me-1" data-action="edit-template" data-id="${safeId}" title="Edit">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete-template" data-id="${safeId}" title="Hapus">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;

  c.querySelectorAll('[data-action="edit-template"]').forEach(btn => {
    btn.addEventListener('click', () => editTemplate(btn.dataset.id));
  });
  c.querySelectorAll('[data-action="delete-template"]').forEach(btn => {
    btn.addEventListener('click', () => deleteTemplate(btn.dataset.id));
  });
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadCertificates(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    STATE.certificates = AdminModule.getSertifikatList() || [];
    STATE.participants = AdminModule.getPesertaList() || [];
    STATE.rtlData = AdminModule.getRTLList() || [];
    STATE.approvals = AdminModule.getDigitalApprovals() || [];

    renderCertTable();
    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[SertifikatView] loadCertificates:', e);
    const c = getEl('certListContainer');
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

async function loadTemplates() {
  try {
    const res = await callApi('getCertificateTemplates', {}, 'GET');
    STATE.templates = normalizeResult(res);
    renderTemplateTable();
  } catch (e) {
    console.warn('[SertifikatView] loadTemplates:', e);
    const c = getEl('templateContainer');
    if (c) {
      c.innerHTML = `<div class="alert alert-info text-center mb-0">Gagal memuat template.</div>`;
    }
  }
}

// ============================================================
//   GENERATE CERTIFICATE
// ============================================================
async function openGenerateModal(preSelectedIds = []) {
  const templateSelect = getEl('genTemplateSelect');
  if (!templateSelect) return;

  if (STATE.templates.length === 0) {
    await loadTemplates();
  }

  templateSelect.innerHTML = '<option value="">-- Pilih Template --</option>' +
    STATE.templates.map(t =>
      `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.nama_template)}</option>`
    ).join('');

  const pesertaSelect = getEl('genPesertaSelect');
  if (!pesertaSelect) return;
  const eligibleList = STATE.participants.filter(p => {
    const status = String(p.status || '').toLowerCase();
    return status === 'approved' || status === 'active';
  });

  if (eligibleList.length === 0) {
    pesertaSelect.innerHTML = '<option disabled>Tidak ada peserta approved/active</option>';
  } else {
    pesertaSelect.innerHTML = eligibleList.map(p => {
      const check = isParticipantEligible(p);
      const selected = preSelectedIds.map(String).includes(String(p.id)) ? 'selected' : '';
      const label = `${escapeHtml(p.nama_lengkap)} ${check.eligible ? '✅' : '❌ (' + check.reason + ')'}`;
      return `<option value="${escapeHtml(String(p.id))}" ${check.eligible ? '' : 'disabled'} ${selected}>${label}</option>`;
    }).join('');
  }

  updateGenValidation();

  const progress = getEl('genProgress');
  if (progress) progress.style.display = 'none';
  const progressBar = document.querySelector('#genProgress .progress-bar');
  if (progressBar) progressBar.style.width = '0%';
  const resultArea = getEl('genResultArea');
  if (resultArea) resultArea.innerHTML = '';

  getModal('generateCertModal')?.show();
}

function updateGenValidation() {
  const select = getEl('genPesertaSelect');
  if (!select) return;
  const selectedOptions = Array.from(select.selectedOptions);
  const valid = selectedOptions.filter(o => !o.disabled);

  const statusDiv = getEl('genValidationStatus');
  const submitBtn = getEl('genSubmitBtn');

  if (selectedOptions.length === 0) {
    if (statusDiv) {
      statusDiv.innerHTML = 'Belum ada peserta dipilih.';
      statusDiv.className = 'small text-muted mt-2';
    }
    if (submitBtn) submitBtn.disabled = false;
  } else if (valid.length === selectedOptions.length) {
    if (statusDiv) {
      statusDiv.innerHTML = `✅ ${valid.length} peserta memenuhi syarat.`;
      statusDiv.className = 'small text-success mt-2';
    }
    if (submitBtn) submitBtn.disabled = false;
  } else {
    if (statusDiv) {
      statusDiv.innerHTML = `⚠️ ${selectedOptions.length - valid.length} peserta tidak eligible (status/RTL/TTD).`;
      statusDiv.className = 'small text-warning mt-2';
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function executeGenerate() {
  if (STATE.isGenerating) return;

  const templateId = getEl('genTemplateSelect')?.value;
  const select = getEl('genPesertaSelect');
  if (!select) return;
  const selectedIds = Array.from(select.selectedOptions).map(o => o.value);

  if (!templateId) { showToast('Pilih template terlebih dahulu', 'warning'); return; }
  if (selectedIds.length === 0) { showToast('Pilih minimal satu peserta', 'warning'); return; }

  const eligible = STATE.participants.filter(p =>
    selectedIds.map(String).includes(String(p.id)) && isParticipantEligible(p).eligible
  );

  if (eligible.length === 0) {
    showToast('Tidak ada peserta yang memenuhi syarat', 'warning');
    return;
  }

  STATE.isGenerating = true;
  const btn = getEl('genSubmitBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memproses...';

  const progress = getEl('genProgress');
  const progressBar = document.querySelector('#genProgress .progress-bar');
  const progressText = getEl('genProgressText');
  const resultArea = getEl('genResultArea');

  if (progress) progress.style.display = 'block';
  if (resultArea) resultArea.innerHTML = '';

  const results = [], errors = [];

  for (let i = 0; i < eligible.length; i++) {
    const p = eligible[i];
    if (progressText) progressText.textContent = `Memproses ${i + 1}/${eligible.length}: ${p.nama_lengkap}`;
    if (progressBar) progressBar.style.width = ((i + 1) / eligible.length * 100) + '%';

    try {
      const res = await callApi('generateCertificateForParticipant', {
        templateId,
        pesertaId: p.id,
      }, 'POST');

      if (res && res.success) {
        results.push({
          nama: p.nama_lengkap,
          nomor: res.nomorSertifikat || '-',
          url: res.pdfUrl || '',
        });
      } else {
        errors.push({ nama: p.nama_lengkap, error: (res && res.error) || 'Gagal' });
      }
    } catch (e) {
      errors.push({ nama: p.nama_lengkap, error: e.message });
    }
  }

  // Render hasil
  let html = '';
  if (results.length > 0) {
    html += `<div class="alert alert-success">
      ✅ Berhasil: <strong>${results.length}</strong> sertifikat digenerate.
    </div>
    <div class="table-responsive"><table class="table table-sm align-middle">
      <thead class="table-light"><tr><th>Nama</th><th>Nomor</th><th style="width:100px;">PDF</th></tr></thead>
      <tbody>`;
    results.forEach(r => {
      html += `<tr>
        <td>${escapeHtml(r.nama)}</td>
        <td><code class="small">${escapeHtml(r.nomor)}</code></td>
        <td>${r.url
          ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="btn btn-sm btn-success">
               <i class="bi bi-download"></i>
             </a>` : '-'}</td>
      </tr>`;
    });
    html += `</tbody></table></div>`;
  }
  if (errors.length > 0) {
    html += `<div class="alert alert-danger mt-2">
      <strong>Gagal (${errors.length}):</strong>
      <ul class="mb-0 small mt-2">`;
    errors.forEach(e => {
      html += `<li>${escapeHtml(e.nama)}: ${escapeHtml(e.error)}</li>`;
    });
    html += `</ul></div>`;
  }
  if (resultArea) resultArea.innerHTML = html;

  showToast(
    `Selesai: ${results.length} berhasil, ${errors.length} gagal`,
    results.length > 0 ? 'success' : 'error'
  );

  STATE.isGenerating = false;
  btn.disabled = false;
  btn.innerHTML = original;

  await loadCertificates(true);
}

// ============================================================
//   CRUD TEMPLATE
// ============================================================
function addTemplate() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('editTemplateId', '');
  setVal('templateNama', '');
  setVal('templateDocId', '');
  setVal('templateConfig', '');
  const titleEl = getEl('templateFormTitle');
  if (titleEl) titleEl.textContent = 'Tambah Template';
  getModal('templateFormModal')?.show();
}

function editTemplate(id) {
  const t = STATE.templates.find(item => String(item.id) === String(id));
  if (!t) { showToast('Template tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('editTemplateId', id);
  setVal('templateNama', t.nama_template || '');
  setVal('templateDocId', t.doc_template_id || '');
  setVal('templateConfig', t.config ? JSON.stringify(t.config) : '');
  const titleEl = getEl('templateFormTitle');
  if (titleEl) titleEl.textContent = 'Edit Template';
  getModal('templateFormModal')?.show();
}

async function saveTemplate() {
  const id = getEl('editTemplateId')?.value;
  const nama = getEl('templateNama')?.value.trim();
  const docId = getEl('templateDocId')?.value.trim();
  const configRaw = getEl('templateConfig')?.value.trim();

  if (!nama) { showToast('Nama template wajib diisi', 'error'); return; }

  let config = {};
  if (configRaw) {
    try { config = JSON.parse(configRaw); }
    catch (e) { showToast('Konfigurasi JSON tidak valid', 'error'); return; }
  }

  const btn = getEl('saveTemplateBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const payload = {
      nama_template: nama,
      doc_template_id: docId,
      config: JSON.stringify(config),
    };
    const action = id ? 'updateCertificateTemplate' : 'addCertificateTemplateManual';
    if (id) payload.id = id;

    const res = await callApi(action, payload, 'POST');
    if (res && res.success) {
      showToast(id ? 'Template diperbarui' : 'Template ditambahkan', 'success');
      getModal('templateFormModal')?.hide();
      await loadTemplates();
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

function deleteTemplate(id) {
  STATE.pendingDeleteTemplateId = id;
  getEl('deleteTemplateId').value = id;
  getModal('deleteTemplateModal')?.show();
}

async function executeDeleteTemplate() {
  const id = getEl('deleteTemplateId')?.value;
  if (!id) return;

  const btn = getEl('confirmDeleteTemplateBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteCertificateTemplate', { id }, 'POST');
    if (res && res.success) {
      showToast('Template dihapus', 'success');
      getModal('deleteTemplateModal')?.hide();
      await loadTemplates();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.pendingDeleteTemplateId = null;
  }
}

// ============================================================
//   DELETE CERTIFICATE
// ============================================================
function confirmDeleteCert(id) {
  STATE.pendingDeleteCertId = id;
  getEl('deleteCertId').value = id;
  getModal('deleteCertModal')?.show();
}

async function executeDeleteCert() {
  const id = getEl('deleteCertId')?.value;
  if (!id) return;

  const btn = getEl('confirmDeleteCertBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteCertificate', { id }, 'POST');
    if (res && res.success) {
      showToast('Sertifikat berhasil dihapus', 'success');
      getModal('deleteCertModal')?.hide();
      STATE.certificates = STATE.certificates.filter(c => String(c.id) !== String(id));
      renderCertTable();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.pendingDeleteCertId = null;
  }
}
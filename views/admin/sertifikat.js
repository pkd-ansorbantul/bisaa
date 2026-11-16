// ============================================================
// VIEW: sertifikat.js — v27.2.0 PRELOAD + SUBSCRIPTION
// Dimuat oleh: js/router.js
// HTML: views/admin/sertifikat.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 90s
//   ✅ FIX: Guard ctx.mounted di dalam loop generate
//   ✅ FIX: Parallel generate 5 concurrent
//   ✅ FIX: Modal dispose via ctx.cleanup
//   ✅ FIX: Cancel-safe progress bar
//   ✅ FIX: Focus preservation saat re-render
//   ✅ KEEP: Template CRUD, generate, delete, verify
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  formatDateID,
  normalizeResult,
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
const GENERATE_CONCURRENCY = 5;

// ============================================================
//   LOCAL HELPERS
// ============================================================
function setCacheStatus(status) {
  const el = getEl('cacheStatus');
  if (!el) return;
  el.textContent = status;
  const cls = status === 'Live' ? 'live'
    : (status === 'Offline' || status === 'Error') ? 'offline'
    : '';
  el.className = 'cache-status' + (cls ? ' ' + cls : '');
}

function getParticipantById(id) {
  return ctx.state.participants.find(p => String(p.id) === String(id)) || null;
}

// ============================================================
//   ELIGIBILITY CHECK
// ============================================================
function isParticipantEligible(p) {
  if (!p) return { eligible: false, reason: 'Data tidak ditemukan' };

  const status = String(p.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'active') {
    return { eligible: false, reason: 'Status belum disetujui' };
  }

  const tasks = ctx.state.rtlData.filter(t => String(t.pesertaId) === String(p.id));
  if (tasks.length > 0 && !tasks.every(t => String(t.status).toLowerCase() === 'selesai')) {
    return { eligible: false, reason: 'RTL belum selesai' };
  }

  const nama = String(p.nama_lengkap || '').toLowerCase().trim();
  if (!nama) return { eligible: false, reason: 'Nama tidak valid' };

  const filtered = ctx.state.approvals.filter(a =>
    String(a.peserta_nama || '').toLowerCase().trim() === nama
  );

  const hasKetua      = filtered.some(a => a.role === 'ketua_pc');
  const hasSekretaris = filtered.some(a => a.role === 'sekretaris');
  const hasInstruktur = filtered.some(a => a.role === 'instruktur');

  if (!hasKetua || !hasSekretaris || !hasInstruktur) {
    return { eligible: false, reason: 'TTD digital belum lengkap' };
  }

  return { eligible: true };
}

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
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
    lastCertHash: '',
    lastTemplateHash: '',
    isGenerating: false,
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'sertifikat'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[SertifikatView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[SertifikatView] Re-render error:', e);
      }
    },
  }
);

let certTableCleanup = null;

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[SertifikatView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  ctx.state.isGenerating = false;
  console.log('[SertifikatView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    certificates: [],
    templates: [],
    participants: [],
    rtlData: [],
    approvals: [],
    filteredCertificates: [],
    searchQuery: '',
    currentPage: 1,
    sortColumn: 'createdAt',
    sortDirection: 'desc',
    pendingDeleteCertId: null,
    pendingDeleteTemplateId: null,
    lastCertHash: '',
    lastTemplateHash: '',
    isGenerating: false,
  });

  const searchEl = getEl('searchInput');
  if (searchEl) searchEl.value = '';

  // ⚡ Instant render dari preload cache
  const cached = AdminModule.getSertifikatList() || [];
  if (cached.length > 0) {
    console.log('[SertifikatView] ⚡ Rendering from preload cache');
    ctx.state.certificates = cached.map(c => ({ ...c }));
    ctx.state.participants = AdminModule.getPesertaList() || [];
    ctx.state.rtlData = AdminModule.getRTLList() || [];
    ctx.state.approvals = AdminModule.getDigitalApprovals() || [];
    ctx.state.lastCertHash = computeListHash(cached);
    renderCertTable();
    setCacheStatus('Live');
  } else {
    console.log('[SertifikatView] ⚠️ No cache, showing skeleton');
    renderSkeletonCerts();
    setCacheStatus('Memuat...');
  }
  renderSkeletonTemplates();

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Load templates (tidak di-preload)
  await loadTemplates();

  // Fallback: kalau cache kosong
  if (cached.length === 0) {
    await loadCertificates(false);
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[SertifikatView] unmounted');

  if (certTableCleanup) {
    try { certTableCleanup(); } catch (e) { /* silent */ }
    certTableCleanup = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const fresh = AdminModule.getSertifikatList() || [];
  const freshHash = computeListHash(fresh);

  // Update references always
  ctx.state.participants = AdminModule.getPesertaList() || [];
  ctx.state.rtlData = AdminModule.getRTLList() || [];
  ctx.state.approvals = AdminModule.getDigitalApprovals() || [];

  if (freshHash === ctx.state.lastCertHash) {
    console.log('[SertifikatView] No change, skip re-render');
    return;
  }

  ctx.state.certificates = fresh.map(c => ({ ...c }));
  ctx.state.lastCertHash = freshHash;
  renderCertTable();
  setCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Search
  ctx.on(getEl('searchInput'), 'input', debounce(function (e) {
    ctx.state.searchQuery = e.target.value;
    ctx.state.currentPage = 1;
    renderCertTable();
  }, SEARCH_DEBOUNCE));

  // Refresh
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);

  // Generate
  ctx.on(getEl('generateCertBtn'), 'click', () => openGenerateModal());
  ctx.on(getEl('genPesertaSelect'), 'change', updateGenValidation);
  ctx.on(getEl('genSubmitBtn'), 'click', executeGenerate);

  // Template CRUD
  ctx.on(getEl('addTemplateBtn'), 'click', addTemplate);
  ctx.on(getEl('saveTemplateBtn'), 'click', saveTemplate);
  ctx.on(getEl('confirmDeleteTemplateBtn'), 'click', executeDeleteTemplate);
  ctx.on(getEl('confirmDeleteCertBtn'), 'click', executeDeleteCert);

  // ✅ DELEGATION — cert table
  const certContainer = getEl('certListContainer');
  if (certContainer) {
    certTableCleanup = delegateTableClicks(certContainer, {
      onSort: (col) => handleSort(col),
      onAction: (action, id) => {
        if (action === 'delete-cert') confirmDeleteCert(id);
      },
      onPage: (page) => goToCertPage(page),
    });
  }

  // ✅ DELEGATION — template table
  const templateContainer = getEl('templateContainer');
  if (templateContainer) {
    ctx.on(templateContainer, 'click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.preventDefault();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit-template') editTemplate(id);
      else if (action === 'delete-template') deleteTemplate(id);
    });
  }
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  ctx.saving = true;
  const btn = e.currentTarget || getEl('refreshDataBtn');
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    await AdminModule.loadAllData(true);
    refreshFromCache();
    await loadTemplates();
    showToast('Data disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan', 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
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
        ${Array(6).fill(0).map(() =>
          `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`
        ).join('')}
      </tr></thead>
      <tbody>${Array(5).fill(0).map(() =>
        `<tr>${Array(6).fill(0).map(() =>
          `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`
        ).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

function renderSkeletonTemplates() {
  const c = getEl('templateContainer');
  if (!c) return;
  c.innerHTML = `
    <div class="table-responsive"><table class="table table-hover align-middle">
      <thead class="table-light"><tr>
        ${Array(4).fill(0).map(() =>
          `<th><div class="skeleton-box" style="height:20px;width:70px;"></div></th>`
        ).join('')}
      </tr></thead>
      <tbody>${Array(4).fill(0).map(() =>
        `<tr>${Array(4).fill(0).map(() =>
          `<td><div class="skeleton-box" style="height:20px;width:90px;"></div></td>`
        ).join('')}</tr>`
      ).join('')}</tbody>
    </table></div>`;
}

// ============================================================
//   CERTIFICATES TABLE
// ============================================================
function getFilteredCertificates() {
  let filtered = ctx.state.certificates.slice();

  if (ctx.state.searchQuery.trim() !== '') {
    const q = ctx.state.searchQuery.toLowerCase().trim();
    filtered = filtered.filter(item =>
      String(item.nama_peserta || '').toLowerCase().includes(q) ||
      String(item.nomor_sertifikat || '').toLowerCase().includes(q)
    );
  }

  if (ctx.state.sortColumn) {
    const col = ctx.state.sortColumn;
    const dir = ctx.state.sortDirection === 'asc' ? 1 : -1;

    filtered.sort((a, b) => {
      let va = a[col];
      let vb = b[col];

      if (col === 'createdAt') {
        va = new Date(va || 0).getTime() || 0;
        vb = new Date(vb || 0).getTime() || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }

      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  return filtered;
}

function renderCertTable() {
  const c = getEl('certListContainer');
  if (!c) return;

  const savedFocus = captureFocusState('searchInput');

  ctx.state.filteredCertificates = getFilteredCertificates();
  const totalItems = ctx.state.filteredCertificates.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ctx.state.itemsPerPage));
  if (ctx.state.currentPage > totalPages) ctx.state.currentPage = totalPages;
  if (ctx.state.currentPage < 1) ctx.state.currentPage = 1;

  const start = (ctx.state.currentPage - 1) * ctx.state.itemsPerPage;
  const end = Math.min(start + ctx.state.itemsPerPage, totalItems);
  const pageData = ctx.state.filteredCertificates.slice(start, end);

  const arrow = (col) => {
    if (ctx.state.sortColumn !== col) return '↕';
    return ctx.state.sortDirection === 'asc' ? '↑' : '↓';
  };

  let html = `<div class="table-responsive"><table class="table table-hover align-middle">
    <thead class="table-light"><tr>
      <th style="width:50px;">#</th>
      <th data-sort="nama_peserta" style="cursor:pointer;">Nama Peserta ${arrow('nama_peserta')}</th>
      <th data-sort="nomor_sertifikat" style="cursor:pointer;">Nomor Sertifikat ${arrow('nomor_sertifikat')}</th>
      <th data-sort="createdAt" style="cursor:pointer;">Tanggal Terbit ${arrow('createdAt')}</th>
      <th style="width:150px;" class="text-center">PDF</th>
      <th style="width:110px;" class="text-center">Aksi</th>
    </tr></thead><tbody>`;

  if (pageData.length === 0) {
    const hasFilter = ctx.state.searchQuery.trim() !== '';
    html += `<tr><td colspan="6" class="text-center py-5 text-muted">
      <i class="bi bi-inbox fs-4 d-block mb-2" aria-hidden="true"></i>
      ${hasFilter ? 'Tidak ada sertifikat sesuai pencarian.' : 'Belum ada sertifikat yang digenerate.'}
    </td></tr>`;
  } else {
    pageData.forEach((item, i) => {
      const globalIdx = start + i + 1;
      const safeId = escapeHtml(String(item.id || ''));

      html += `<tr>
        <td>${globalIdx}</td>
        <td><strong>${escapeHtml(item.nama_peserta || '-')}</strong></td>
        <td><code class="small">${escapeHtml(item.nomor_sertifikat || '-')}</code></td>
        <td>${escapeHtml(formatDateID(item.createdAt))}</td>
        <td class="text-center">
          ${item.pdf_url
            ? `<a href="${escapeHtml(item.pdf_url)}" target="_blank" rel="noopener noreferrer"
                  class="btn btn-sm btn-outline-success"
                  aria-label="Unduh PDF ${escapeHtml(item.nama_peserta || '')}">
                 <i class="bi bi-download me-1" aria-hidden="true"></i> Unduh
               </a>`
            : '<span class="text-muted small">-</span>'}
        </td>
        <td class="text-center">
          <button type="button" class="btn btn-sm btn-outline-danger"
                  data-action="delete-cert" data-id="${safeId}"
                  title="Hapus" aria-label="Hapus sertifikat ${escapeHtml(item.nama_peserta || '')}">
            <i class="bi bi-trash" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
    });
  }

  html += `</tbody></table></div>`;

  html += `<div class="d-flex justify-content-between align-items-center mt-3 flex-wrap gap-2">
    <div class="small text-muted">
      Menampilkan ${pageData.length > 0 ? start + 1 : 0} - ${end} dari ${totalItems} data
    </div>
    <div class="btn-group">`;

  const maxButtons = 7;
  let startPage = Math.max(1, ctx.state.currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  if (endPage - startPage + 1 < maxButtons) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="1">1</button>`;
    if (startPage > 2) html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
  }
  for (let i = startPage; i <= endPage; i++) {
    html += `<button type="button" class="btn btn-sm ${i === ctx.state.currentPage ? 'btn-primary' : 'btn-outline-secondary'}"
              data-action="goto" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      html += `<button type="button" class="btn btn-sm btn-outline-secondary" disabled>…</button>`;
    }
    html += `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="goto" data-page="${totalPages}">${totalPages}</button>`;
  }
  html += `</div></div>`;

  c.innerHTML = html;

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
  renderCertTable();
}

function goToCertPage(page) {
  const totalPages = Math.max(1, Math.ceil(
    ctx.state.filteredCertificates.length / ctx.state.itemsPerPage
  ));
  if (page < 1 || page > totalPages) return;
  ctx.state.currentPage = page;
  renderCertTable();
  getEl('certListContainer')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//   TEMPLATES TABLE
// ============================================================
function renderTemplateTable() {
  const c = getEl('templateContainer');
  if (!c) return;

  if (!ctx.state.templates || ctx.state.templates.length === 0) {
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

  ctx.state.templates.forEach((t, idx) => {
    const safeId = escapeHtml(String(t.id || ''));
    html += `<tr>
      <td>${idx + 1}</td>
      <td><strong>${escapeHtml(t.nama_template || '-')}</strong></td>
      <td><code class="small" style="word-break:break-all;">${escapeHtml(t.doc_template_id || '-')}</code></td>
      <td class="text-center">
        <button type="button" class="btn btn-sm btn-outline-warning me-1"
                data-action="edit-template" data-id="${safeId}"
                title="Edit" aria-label="Edit template">
          <i class="bi bi-pencil" aria-hidden="true"></i>
        </button>
        <button type="button" class="btn btn-sm btn-outline-danger"
                data-action="delete-template" data-id="${safeId}"
                title="Hapus" aria-label="Hapus template">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  c.innerHTML = html;
}

// ============================================================
//   LOAD DATA (fallback)
// ============================================================
async function loadCertificates(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[SertifikatView] loadCertificates:', e);
    const c = getEl('certListContainer');
    if (c && ctx.state.certificates.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    setCacheStatus('Error');
  }
}

async function loadTemplates() {
  try {
    const res = await callApi('getCertificateTemplates', {}, 'GET');
    if (!ctx.mounted) return;

    const list = normalizeResult(res);
    const freshHash = computeListHash(list, ['id', 'nama_template', 'doc_template_id']);

    if (freshHash !== ctx.state.lastTemplateHash) {
      ctx.state.templates = list;
      ctx.state.lastTemplateHash = freshHash;
      renderTemplateTable();
    }
  } catch (e) {
    console.warn('[SertifikatView] loadTemplates:', e);
    const c = getEl('templateContainer');
    if (c && (!ctx.state.templates || ctx.state.templates.length === 0)) {
      c.innerHTML = `<div class="alert alert-info text-center mb-0">Gagal memuat template.</div>`;
    }
  }
}

// ============================================================
//   GENERATE MODAL
// ============================================================
async function openGenerateModal(preSelectedIds = []) {
  const templateSelect = getEl('genTemplateSelect');
  if (!templateSelect) return;

  if (ctx.state.templates.length === 0) {
    await loadTemplates();
  }

  if (ctx.state.templates.length === 0) {
    showToast('Belum ada template. Buat template terlebih dahulu di tab Template.', 'warning');
    return;
  }

  templateSelect.innerHTML = '<option value="">-- Pilih Template --</option>' +
    ctx.state.templates.map(t =>
      `<option value="${escapeHtml(String(t.id))}">${escapeHtml(t.nama_template)}</option>`
    ).join('');

  const pesertaSelect = getEl('genPesertaSelect');
  if (!pesertaSelect) return;

  const eligibleList = ctx.state.participants.filter(p => {
    const status = String(p.status || '').toLowerCase();
    return status === 'approved' || status === 'active';
  });

  if (eligibleList.length === 0) {
    pesertaSelect.innerHTML = '<option disabled>Tidak ada peserta approved/active</option>';
  } else {
    const preSet = new Set(preSelectedIds.map(String));
    pesertaSelect.innerHTML = eligibleList.map(p => {
      const check = isParticipantEligible(p);
      const selected = preSet.has(String(p.id)) ? 'selected' : '';
      const label = `${escapeHtml(p.nama_lengkap)} ${check.eligible ? '✅' : '❌ (' + check.reason + ')'}`;
      return `<option value="${escapeHtml(String(p.id))}"
              ${check.eligible ? '' : 'disabled'}
              ${selected}>${label}</option>`;
    }).join('');
  }

  updateGenValidation();

  const progress = getEl('genProgress');
  if (progress) progress.style.display = 'none';
  const progressBar = document.querySelector('#genProgress .progress-bar');
  if (progressBar) progressBar.style.width = '0%';
  const resultArea = getEl('genResultArea');
  if (resultArea) resultArea.innerHTML = '';

  ctx.getModal('generateCertModal')?.show();
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
    if (submitBtn) submitBtn.disabled = valid.length === 0;
  }
}

// ============================================================
//   EXECUTE GENERATE — PARALLEL BATCH 5 CONCURRENT
// ============================================================
async function executeGenerate() {
  if (ctx.state.isGenerating || ctx.saving) return;

  const templateId = getEl('genTemplateSelect')?.value;
  const select = getEl('genPesertaSelect');
  if (!select) return;

  const selectedIds = Array.from(select.selectedOptions).map(o => o.value);

  if (!templateId) {
    showToast('Pilih template terlebih dahulu', 'warning');
    return;
  }
  if (selectedIds.length === 0) {
    showToast('Pilih minimal satu peserta', 'warning');
    return;
  }

  const eligible = ctx.state.participants.filter(p =>
    selectedIds.map(String).includes(String(p.id)) && isParticipantEligible(p).eligible
  );

  if (eligible.length === 0) {
    showToast('Tidak ada peserta yang memenuhi syarat', 'warning');
    return;
  }

  ctx.state.isGenerating = true;
  ctx.saving = true;

  const btn = getEl('genSubmitBtn');
  const restore = setBtnLoading(btn, true, 'Memproses...');

  const progress = getEl('genProgress');
  const progressBar = document.querySelector('#genProgress .progress-bar');
  const progressText = getEl('genProgressText');
  const resultArea = getEl('genResultArea');

  if (progress) progress.style.display = 'block';
  if (resultArea) resultArea.innerHTML = '';

  const results = [];
  const errors = [];
  let completed = 0;

  const updateProgress = (nama) => {
    completed++;
    if (progressText) {
      progressText.textContent = `Memproses ${completed}/${eligible.length}: ${nama}`;
    }
    if (progressBar) {
      progressBar.style.width = ((completed / eligible.length) * 100) + '%';
    }
  };

  try {
    // ✅ PARALLEL batch CONCURRENCY=5
    for (let i = 0; i < eligible.length; i += GENERATE_CONCURRENCY) {
      if (!ctx.mounted) {
        errors.push({ nama: '(aborted)', error: 'Halaman ditutup sebelum selesai' });
        break;
      }

      const batch = eligible.slice(i, i + GENERATE_CONCURRENCY);

      const batchResults = await Promise.allSettled(
        batch.map(p => callApi(
          'generateCertificateForParticipant',
          { templateId, pesertaId: p.id },
          'POST'
        ))
      );

      batchResults.forEach((r, idx) => {
        const p = batch[idx];
        if (r.status === 'fulfilled' && r.value && r.value.success) {
          results.push({
            nama: p.nama_lengkap,
            nomor: r.value.nomorSertifikat || '-',
            url: r.value.pdfUrl || '',
          });
        } else {
          const errMsg = (r.status === 'fulfilled' && r.value && r.value.error)
            ? r.value.error
            : (r.reason?.message || 'Gagal');
          errors.push({ nama: p.nama_lengkap, error: errMsg });
        }
        updateProgress(p.nama_lengkap);
      });
    }

    let html = '';

    if (results.length > 0) {
      html += `<div class="alert alert-success">
        ✅ Berhasil: <strong>${results.length}</strong> sertifikat digenerate.
      </div>
      <div class="table-responsive"><table class="table table-sm align-middle">
        <thead class="table-light"><tr>
          <th>Nama</th>
          <th>Nomor</th>
          <th style="width:100px;">PDF</th>
        </tr></thead>
        <tbody>`;
      results.forEach(r => {
        html += `<tr>
          <td>${escapeHtml(r.nama)}</td>
          <td><code class="small">${escapeHtml(r.nomor)}</code></td>
          <td>${r.url
            ? `<a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer"
                  class="btn btn-sm btn-success"
                  aria-label="Unduh PDF ${escapeHtml(r.nama)}">
                 <i class="bi bi-download" aria-hidden="true"></i>
               </a>`
            : '-'}</td>
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

    await AdminModule.loadAllData(true);
  } catch (err) {
    console.error('[SertifikatView] executeGenerate error:', err);
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  } finally {
    ctx.state.isGenerating = false;
    ctx.saving = false;
    restore();
  }
}

// ============================================================
//   TEMPLATE CRUD
// ============================================================
function addTemplate() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('editTemplateId', '');
  setVal('templateNama', '');
  setVal('templateDocId', '');
  setVal('templateConfig', '');

  const titleEl = getEl('templateFormTitle');
  if (titleEl) titleEl.textContent = 'Tambah Template';

  ctx.getModal('templateFormModal')?.show();
}

function editTemplate(id) {
  const t = ctx.state.templates.find(item => String(item.id) === String(id));
  if (!t) { showToast('Template tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editTemplateId', id);
  setVal('templateNama', t.nama_template || '');
  setVal('templateDocId', t.doc_template_id || '');
  setVal('templateConfig', t.config ? JSON.stringify(t.config) : '');

  const titleEl = getEl('templateFormTitle');
  if (titleEl) titleEl.textContent = 'Edit Template';

  ctx.getModal('templateFormModal')?.show();
}

async function saveTemplate() {
  if (ctx.saving) return;

  const id = getEl('editTemplateId')?.value;
  const nama = getEl('templateNama')?.value.trim();
  const docId = getEl('templateDocId')?.value.trim() || '';
  const configRaw = getEl('templateConfig')?.value.trim() || '';

  if (!nama) {
    showToast('Nama template wajib diisi', 'error');
    getEl('templateNama')?.focus();
    return;
  }

  let config = {};
  if (configRaw) {
    try { config = JSON.parse(configRaw); }
    catch (e) {
      showToast('Konfigurasi JSON tidak valid', 'error');
      return;
    }
  }

  ctx.saving = true;
  const btn = getEl('saveTemplateBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const payload = {
      nama_template: nama,
      doc_template_id: docId,
      config: JSON.stringify(config),
    };
    if (id) payload.id = id;

    const action = id ? 'updateCertificateTemplate' : 'addCertificateTemplateManual';
    const res = await callApi(action, payload, 'POST');

    if (res && res.success) {
      showToast(id ? 'Template diperbarui' : 'Template ditambahkan', 'success');
      ctx.getModal('templateFormModal')?.hide();
      await loadTemplates();
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

function deleteTemplate(id) {
  ctx.state.pendingDeleteTemplateId = id;
  const el = getEl('deleteTemplateId');
  if (el) el.value = id;
  ctx.getModal('deleteTemplateModal')?.show();
}

async function executeDeleteTemplate(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteTemplateId || getEl('deleteTemplateId')?.value;
  if (!id) return;

  ctx.saving = true;
  const btn = e?.currentTarget || getEl('confirmDeleteTemplateBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await callApi('deleteCertificateTemplate', { id }, 'POST');
    if (res && res.success) {
      ctx.state.templates = ctx.state.templates.filter(t => String(t.id) !== String(id));
      ctx.state.lastTemplateHash = computeListHash(
        ctx.state.templates,
        ['id', 'nama_template', 'doc_template_id']
      );
      renderTemplateTable();

      showToast('Template dihapus', 'success');
      ctx.getModal('deleteTemplateModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteTemplateId = null;
  }
}

// ============================================================
//   DELETE CERTIFICATE
// ============================================================
function confirmDeleteCert(id) {
  ctx.state.pendingDeleteCertId = id;
  const el = getEl('deleteCertId');
  if (el) el.value = id;
  ctx.getModal('deleteCertModal')?.show();
}

async function executeDeleteCert(e) {
  if (ctx.saving) return;

  const id = ctx.state.pendingDeleteCertId || getEl('deleteCertId')?.value;
  if (!id) return;

  ctx.saving = true;
  const btn = e?.currentTarget || getEl('confirmDeleteCertBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await callApi('deleteCertificate', { id }, 'POST');
    if (res && res.success) {
      ctx.state.certificates = ctx.state.certificates.filter(c => String(c.id) !== String(id));
      ctx.state.lastCertHash = computeListHash(ctx.state.certificates);
      renderCertTable();

      showToast('Sertifikat berhasil dihapus', 'success');
      ctx.getModal('deleteCertModal')?.hide();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
    ctx.state.pendingDeleteCertId = null;
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Sertifikat View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
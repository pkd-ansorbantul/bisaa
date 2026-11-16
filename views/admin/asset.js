// ============================================================
// VIEW: asset.js — Full Fix Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/asset.html
// ============================================================
// Fitur:
// ✅ Upload multi-file (XHR progress)
// ✅ Folder CRUD (nested) + publikasi + password
// ✅ Asset CRUD (edit metadata, delete)
// ✅ Bulk move & delete
// ✅ Preview modal (image, video, audio, PDF) + autoplay playlist
// ✅ Search + filter jenis
// ✅ Share/copy link/WhatsApp
// ✅ Public config (global enable + password)
// ✅ Auto-refresh 30s (visibility-aware + re-entrance guard)
// ✅ Zero memory leak + full cleanup
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  getDriveToken,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let isMounted = false;
let isRefreshing = false;

const STATE = {
  assetList: [],
  folderList: [],
  currentFolderId: '',
  selectedAssets: [],
  selectedFiles: [],
  editingAssetId: null,
  // Preview modal
  playlistItems: [],
  currentPlaylistIndex: 0,
  autoplayTimeoutId: null,
  isAutoplayActive: false,
  isModalOpen: false,
  // Flags
  isUploading: false,
  isSaving: false,
  isMoving: false,
  // Modals cache
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

function cleanDriveId(id) {
  if (!id || typeof id !== 'string') return '';
  return id.trim().replace(/[\x00-\x1F\x7F]+/g, '').replace(/[^a-zA-Z0-9_-]+/g, '');
}

function isValidDriveId(id) {
  return cleanDriveId(id).length >= 15;
}

function formatDate(ts) {
  if (!ts) return '-';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return '-'; }
}

function getFileTypeFromName(fileName) {
  if (!fileName) return 'gambar';
  const ext = String(fileName).split('.').pop().toLowerCase();
  const map = {
    jpg: 'gambar', jpeg: 'gambar', png: 'gambar', gif: 'gambar', webp: 'gambar',
    svg: 'gambar', bmp: 'gambar', ico: 'gambar', tiff: 'gambar', heic: 'gambar',
    mp4: 'video', webm: 'video', avi: 'video', mov: 'video', mkv: 'video',
    mp3: 'audio', wav: 'audio', ogg: 'audio', aac: 'audio', m4a: 'audio',
    pdf: 'dokumen', doc: 'dokumen', docx: 'dokumen', xls: 'dokumen', xlsx: 'dokumen',
  };
  return map[ext] || 'gambar';
}

function getAssetById(id) {
  return STATE.assetList.find(a => String(a.id) === String(id));
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[AssetView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[AssetView] mounted');

  // Reset state
  STATE.assetList = [];
  STATE.folderList = [];
  STATE.currentFolderId = '';
  STATE.selectedAssets = [];
  STATE.selectedFiles = [];
  STATE.editingAssetId = null;
  STATE.playlistItems = [];
  STATE.currentPlaylistIndex = 0;
  STATE.autoplayTimeoutId = null;
  STATE.isAutoplayActive = false;
  STATE.isModalOpen = false;
  STATE.isUploading = false;
  STATE.isSaving = false;
  STATE.isMoving = false;

  const searchEl = getEl('searchAssetInput');
  const filterEl = getEl('filterTypeAsset');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  renderSkeletonAssets();
  await loadAllData(true);
  bindEvents();

  // Auto-refresh 30s
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    if (isRefreshing) return;
    isRefreshing = true;
    loadAllData(false)
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
  console.log('[AssetView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  if (STATE.autoplayTimeoutId) {
    clearTimeout(STATE.autoplayTimeoutId);
    STATE.autoplayTimeoutId = null;
  }

  // Close preview modal
  closePreview();

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
  const searchEl = getEl('searchAssetInput');
  const filterEl = getEl('filterTypeAsset');

  on(searchEl, 'input', debounce(() => renderAssets(), 300));
  on(filterEl, 'change', () => renderAssets());

  // Toolbar
  on(getEl('uploadAssetBtn'), 'click', openUploadModal);
  on(getEl('addFolderBtn'), 'click', openFolderModal);
  on(getEl('moveSelectedBtn'), 'click', openMoveModal);
  on(getEl('deleteSelectedBtn'), 'click', deleteSelectedAssets);
  on(getEl('publicConfigBtn'), 'click', openPublicConfig);

  on(getEl('refreshDataBtn'), 'click', async function () {
    const btn = this;
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memuat...';
    try {
      await loadAllData(true);
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = original;
    }
  });

  // Upload modal
  on(getEl('assetFile'), 'change', function (e) {
    handleFilesSelected(e.target.files);
    this.value = '';
  });
  on(getEl('submitUploadBtn'), 'click', submitUpload);

  // Edit modal
  on(getEl('saveEditBtn'), 'click', saveEdit);

  // Folder modal
  on(getEl('saveFolderBtn'), 'click', saveFolder);

  // Folder settings
  on(getEl('folderSettingPublic'), 'change', function () {
    const id = getEl('folderSettingsId').value;
    if (id) toggleFolderPublic(id, this.checked);
  });
  on(getEl('folderSettingHide'), 'change', function () {
    const id = getEl('folderSettingsId').value;
    if (id) toggleFolderHide(id, this.checked);
  });
  on(getEl('folderSavePasswordBtn'), 'click', saveFolderPassword);
  on(getEl('folderClearPasswordBtn'), 'click', clearFolderPassword);
  on(getEl('deleteFolderBtn'), 'click', deleteFolderHandler);

  // Move modal
  on(getEl('executeMoveBtn'), 'click', executeMove);

  // Public config
  on(getEl('enablePublicGallery'), 'change', function () {
    const isChecked = this.checked;
    const passGroup = getEl('publicPasswordGroup');
    const linkArea = getEl('publicLinkArea');
    if (passGroup) passGroup.style.display = isChecked ? 'block' : 'none';
    if (linkArea) linkArea.style.display = isChecked ? 'block' : 'none';
    if (isChecked) {
      const urlEl = getEl('publicGalleryUrl');
      if (urlEl) urlEl.value = window.location.origin + '/bisaa/public_assets.html';
    }
  });
  on(getEl('savePublicConfigBtn'), 'click', savePublicConfig);
  on(getEl('copyPublicUrlBtn'), 'click', function () {
    const url = getEl('publicGalleryUrl')?.value;
    if (url) copyToClipboard(url);
  });

  // Preview
  on(getEl('closePreviewBtn'), 'click', closePreview);
  on(getEl('navPrev'), 'click', navPrevPreview);
  on(getEl('navNext'), 'click', navNextPreview);
  on(getEl('autoplayToggleBtn'), 'click', toggleAutoplay);

  on(getEl('customPreviewModal'), 'click', function (e) {
    if (e.target === this) closePreview();
  });

  // Toggle password visibility (delegation)
  on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });

  // ESC close preview
  on(document, 'keydown', function (e) {
    if (e.key === 'Escape' && STATE.isModalOpen) closePreview();
  });
}

// ============================================================
//   SKELETON
// ============================================================
function renderSkeletonAssets() {
  const c = getEl('assetContainer');
  if (!c) return;
  let html = '<div class="asset-grid">';
  for (let i = 0; i < 8; i++) {
    html += `<div class="asset-card skeleton">
      <div class="skeleton-box skeleton-img"></div>
      <div class="card-body">
        <div class="skeleton-box skeleton-title"></div>
        <div class="skeleton-box skeleton-desc"></div>
      </div>
    </div>`;
  }
  html += '</div>';
  c.innerHTML = html;
}

// ============================================================
//   LOAD DATA
// ============================================================
async function loadAllData(forceRefresh = false) {
  const cacheEl = getEl('cacheStatus');
  if (cacheEl) cacheEl.textContent = 'Memuat…';

  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    STATE.assetList = AdminModule.getAssetList() || [];
    STATE.folderList = AdminModule.getFolders() || [];

    render();
    if (cacheEl) {
      cacheEl.textContent = 'Live';
      cacheEl.className = 'cache-status live';
    }
  } catch (e) {
    console.error('[AssetView] loadAllData:', e);
    if (cacheEl) {
      cacheEl.textContent = 'Error';
      cacheEl.className = 'cache-status offline';
    }
    const c = getEl('assetContainer');
    if (c) c.innerHTML = `<div class="alert alert-danger text-center">
      Gagal memuat data: ${escapeHtml(e.message)}
    </div>`;
  }
}

// ============================================================
//   RENDER
// ============================================================
function render() {
  renderFolderList();
  renderBreadcrumb();
  renderAssets();
}

function renderFolderList() {
  const c = getEl('folderList');
  if (!c) return;

  let html = `<div class="folder-item ${STATE.currentFolderId === '' ? 'active' : ''}"
                    data-folder-id="" style="cursor:pointer;">
    <i class="bi bi-house-door"></i> Root
  </div>`;

  STATE.folderList.forEach(f => {
    const isActive = String(STATE.currentFolderId) === String(f.id);
    const safeId = escapeHtml(String(f.id));
    html += `<div class="folder-item ${isActive ? 'active' : ''}" data-folder-id="${safeId}">
      <div class="d-flex justify-content-between align-items-center w-100">
        <span style="flex:1;min-width:0;">
          <i class="bi bi-folder-fill"></i>
          <span style="word-break:break-word;">${escapeHtml(f.nama || '-')}</span>
        </span>
        <button class="btn btn-sm btn-outline-secondary p-0"
                data-folder-settings="${safeId}" title="Pengaturan"
                style="width:26px;height:26px;border-radius:50%;">
          <i class="bi bi-gear" style="font-size:0.8rem;"></i>
        </button>
      </div>
    </div>`;
  });

  c.innerHTML = html;

  c.querySelectorAll('[data-folder-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-folder-settings]')) return;
      navigateFolder(el.dataset.folderId);
    });
  });

  c.querySelectorAll('[data-folder-settings]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderSettings(btn.dataset.folderSettings);
    });
  });
}

function renderBreadcrumb() {
  const c = getEl('breadcrumb');
  if (!c) return;

  if (STATE.currentFolderId === '') {
    c.innerHTML = `<li class="breadcrumb-item active">Semua Aset</li>`;
    return;
  }

  const folder = STATE.folderList.find(f => String(f.id) === String(STATE.currentFolderId));
  if (!folder) {
    c.innerHTML = `<li class="breadcrumb-item active">Semua Aset</li>`;
    return;
  }

  const isPublic = folder.isPublic === true || folder.isPublic === 'true';
  const publicUrl = `${window.location.origin}/bisaa/public_assets.html?folderId=${STATE.currentFolderId}`;

  c.innerHTML = `
    <li class="breadcrumb-item"><a href="#" data-goto-root>Semua Aset</a></li>
    <li class="breadcrumb-item active">${escapeHtml(folder.nama || '')}</li>
    ${isPublic ? `<li class="ms-2">
      <button class="btn btn-outline-success btn-sm rounded-pill" data-copy-public>
        <i class="bi bi-link-45deg me-1"></i> Salin Link Publik
      </button>
    </li>` : ''}
  `;

  c.querySelector('[data-goto-root]')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigateFolder('');
  });

  const copyBtn = c.querySelector('[data-copy-public]');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => copyToClipboard(publicUrl));
  }
}

function renderAssets() {
  const c = getEl('assetContainer');
  if (!c) return;

  const searchVal = (getEl('searchAssetInput')?.value || '').toLowerCase().trim();
  const typeVal = getEl('filterTypeAsset')?.value || '';

  let filtered = STATE.assetList.filter(item =>
    String(item.folderId || '') === String(STATE.currentFolderId || '')
  );

  if (searchVal) {
    filtered = filtered.filter(item =>
      String(item.judul || '').toLowerCase().includes(searchVal)
    );
  }
  if (typeVal) {
    filtered = filtered.filter(item => String(item.jenis || '') === typeVal);
  }

  filtered.sort((a, b) => String(a.judul || '').localeCompare(String(b.judul || '')));

  if (filtered.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center">
      <i class="bi bi-image fs-4 d-block mb-2"></i>
      Tidak ada aset di folder ini${searchVal ? ' yang cocok dengan pencarian' : ''}.
    </div>`;
    return;
  }

  let html = '<div class="asset-grid">';
  filtered.forEach((item, index) => {
    const cleanedDriveId = cleanDriveId(item.driveId);
    const isIdValid = isValidDriveId(cleanedDriveId);
    const imgUrl = isIdValid ? `https://drive.google.com/thumbnail?id=${cleanedDriveId}&sz=w400` : '';

    const jenis = String(item.jenis || '').toLowerCase();
    const mime = String(item.mimeType || '');
    const isVideo = jenis === 'video' || mime.startsWith('video/');
    const isPdf = jenis === 'dokumen' || mime === 'application/pdf';
    const isAudio = jenis === 'audio' || mime.startsWith('audio/');

    let previewContent = '';
    if (isIdValid) {
      if (isVideo) {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}">
          <img src="${imgUrl}" alt="${escapeHtml(item.judul)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="fallback" style="display:none;">
            <i class="bi bi-play-circle-fill" style="font-size:2.5rem;color:#64748b;"></i>
            <div class="small text-muted mt-2">Video</div>
          </div>
        </div>`;
      } else if (isPdf) {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}">
          <div class="fallback" style="display:flex;">
            <i class="bi bi-file-earmark-pdf-fill text-danger" style="font-size:2.5rem;"></i>
            <div class="small text-muted mt-2">PDF</div>
          </div>
        </div>`;
      } else if (isAudio) {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}"
                               style="background:#dbeafe;">
          <div class="fallback" style="background:transparent;">
            <i class="bi bi-music-note-beamed text-primary" style="font-size:3rem;"></i>
            <div class="small text-muted mt-2">Audio</div>
          </div>
        </div>`;
      } else {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}">
          <img src="${imgUrl}" alt="${escapeHtml(item.judul)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="fallback" style="display:none;">
            <i class="bi bi-file-earmark-fill" style="font-size:2.5rem;color:#64748b;"></i>
            <div class="small text-muted mt-2">Thumbnail gagal</div>
          </div>
        </div>`;
      }
    } else {
      previewContent = `<div class="thumbnail-container" style="background:#f8fafc;">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;">
          <i class="bi bi-file-earmark-fill" style="font-size:2.5rem;color:#94a3b8;"></i>
          <div class="small text-muted mt-2">ID rusak</div>
        </div>
      </div>`;
    }

    const safeId = escapeHtml(String(item.id));
    html += `<div class="asset-card" data-asset-index="${index}">
      ${previewContent}
      <div class="form-check asset-checkbox">
        <input class="form-check-input asset-checkbox-input" type="checkbox"
               value="${safeId}" data-asset-id="${safeId}">
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.judul || '')}</div>
        <div class="card-text">${escapeHtml(item.deskripsi || '')}</div>
        <div class="card-actions">
          <span class="text-muted small">${escapeHtml(formatDate(item.timestamp))}</span>
          <div class="btn-group">
            <button class="btn btn-sm btn-outline-warning" data-action="edit" data-id="${safeId}" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            <button class="btn btn-sm btn-outline-primary" data-action="share" data-id="${safeId}" title="Bagikan">
              <i class="bi bi-share"></i>
            </button>
            <button class="btn btn-sm btn-success" data-action="whatsapp" data-id="${safeId}" title="WhatsApp">
              <i class="bi bi-whatsapp"></i>
            </button>
            <button class="btn btn-sm btn-outline-dark" data-action="copy" data-id="${safeId}" title="Salin Link">
              <i class="bi bi-link-45deg"></i>
            </button>
            <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';

  c.innerHTML = html;

  // Bind checkboxes
  c.querySelectorAll('.asset-checkbox-input').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.assetId;
      if (cb.checked) {
        if (!STATE.selectedAssets.includes(id)) STATE.selectedAssets.push(id);
      } else {
        STATE.selectedAssets = STATE.selectedAssets.filter(x => x !== id);
      }
    });
  });

  // Bind thumbnail preview
  c.querySelectorAll('[data-preview-index]').forEach(el => {
    el.addEventListener('click', () => {
      openPreviewWithPlaylist(filtered, parseInt(el.dataset.previewIndex));
    });
  });

  // Bind action buttons
  c.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === 'edit') editAsset(id);
      else if (action === 'share') shareAsset(id);
      else if (action === 'whatsapp') shareWhatsApp(id);
      else if (action === 'copy') copyAssetLink(id);
      else if (action === 'delete') confirmDelete(id);
    });
  });
}

// ============================================================
//   NAVIGASI
// ============================================================
function navigateFolder(folderId) {
  STATE.currentFolderId = folderId || '';
  STATE.selectedAssets = [];
  render();
}

// ============================================================
//   CLIPBOARD
// ============================================================
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Link berhasil disalin!', 'success'))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const input = document.createElement('textarea');
  input.value = text;
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  try {
    document.execCommand('copy');
    showToast('Link berhasil disalin!', 'success');
  } catch (e) {
    showToast('Gagal menyalin link', 'error');
  }
  document.body.removeChild(input);
}

function copyAssetLink(id) {
  const item = getAssetById(id);
  if (!item) return;
  const cleaned = cleanDriveId(item.driveId);
  if (!isValidDriveId(cleaned)) { showToast('ID file tidak valid', 'error'); return; }
  copyToClipboard(`https://drive.google.com/file/d/${cleaned}/view`);
}

function shareAsset(id) {
  const item = getAssetById(id);
  if (!item) return;
  const cleaned = cleanDriveId(item.driveId);
  if (!isValidDriveId(cleaned)) { showToast('ID file tidak valid', 'error'); return; }

  const url = `https://drive.google.com/file/d/${cleaned}/view`;
  if (navigator.share) {
    navigator.share({ title: item.judul || 'Aset', url }).catch(() => {});
  } else {
    copyToClipboard(url);
  }
}

function shareWhatsApp(id) {
  const item = getAssetById(id);
  if (!item) return;
  const cleaned = cleanDriveId(item.driveId);
  if (!isValidDriveId(cleaned)) { showToast('ID file tidak valid', 'error'); return; }
  const url = `https://drive.google.com/file/d/${cleaned}/view`;
  const text = encodeURIComponent(`Halo, saya ingin berbagi aset digital PKD GP Ansor:\n${item.judul}\n${url}`);
  window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
}

// ============================================================
//   UPLOAD
// ============================================================
function openUploadModal() {
  resetUploadForm();
  getModal('uploadAssetModal')?.show();
}

function resetUploadForm() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('assetJudul', '');
  setVal('assetDeskripsi', '');
  setVal('assetJenis', 'gambar');
  setVal('assetFile', '');

  const preview = getEl('filePreview');
  if (preview) preview.style.display = 'none';
  const progress = getEl('uploadProgressContainer');
  if (progress) progress.style.display = 'none';

  STATE.selectedFiles = [];

  const folderSel = getEl('assetFolder');
  if (folderSel) {
    folderSel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      STATE.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
    if (STATE.currentFolderId) folderSel.value = STATE.currentFolderId;
  }

  const badge = getEl('uploadCountBadge');
  if (badge) badge.textContent = '0';
}

function handleFilesSelected(files) {
  if (!files || files.length === 0) return;

  for (const file of files) {
    const exists = STATE.selectedFiles.some(f => f.name === file.name && f.size === file.size);
    if (!exists) STATE.selectedFiles.push(file);
  }
  renderUploadFileList();
}

function renderUploadFileList() {
  const previewContainer = getEl('filePreview');
  const fileNameDisplay = getEl('fileNameDisplay');
  const judulInput = getEl('assetJudul');
  const jenisInput = getEl('assetJenis');
  const badge = getEl('uploadCountBadge');

  if (badge) badge.textContent = STATE.selectedFiles.length;

  if (STATE.selectedFiles.length === 0) {
    if (previewContainer) previewContainer.style.display = 'none';
    return;
  }

  if (previewContainer) previewContainer.style.display = 'block';
  let html = '';
  STATE.selectedFiles.forEach((file, idx) => {
    const sizeKB = (file.size / 1024).toFixed(1);
    const autoTitle = file.name.replace(/\.[^/.]+$/, '');
    html += `<div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2 small">
      <div style="min-width:0;flex:1;">
        <strong>${escapeHtml(file.name)}</strong>
        <span class="text-muted ms-1">(${sizeKB} KB)</span>
        <div class="text-muted" style="font-size:0.75rem;">Judul: ${escapeHtml(autoTitle)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-remove-file="${idx}">&times;</button>
    </div>`;
  });
  if (fileNameDisplay) fileNameDisplay.innerHTML = html;

  fileNameDisplay?.querySelectorAll('[data-remove-file]').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.selectedFiles.splice(parseInt(btn.dataset.removeFile), 1);
      renderUploadFileList();
    });
  });

  if (STATE.selectedFiles.length === 1) {
    const file = STATE.selectedFiles[0];
    if (judulInput) judulInput.value = file.name.replace(/\.[^/.]+$/, '');
    if (jenisInput) jenisInput.value = getFileTypeFromName(file.name);
  } else {
    if (judulInput) judulInput.value = '';
    if (jenisInput) jenisInput.value = 'gambar';
  }
}

async function submitUpload() {
  if (STATE.isUploading) return;

  const judul = getEl('assetJudul')?.value.trim() || '';
  const deskripsi = getEl('assetDeskripsi')?.value.trim() || '';
  const folderId = getEl('assetFolder')?.value || '';

  if (STATE.selectedFiles.length === 0) {
    showToast('Pilih minimal satu file', 'error');
    return;
  }
  if (STATE.selectedFiles.length === 1 && !judul) {
    showToast('Judul wajib diisi', 'error');
    return;
  }

  const btn = getEl('submitUploadBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isUploading = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Mengupload...';

  const progressContainer = getEl('uploadProgressContainer');
  const progressBar = getEl('uploadProgressBar');
  const progressText = getEl('uploadProgressText');
  if (progressContainer) progressContainer.style.display = 'block';
  if (progressBar) progressBar.style.width = '0%';
  if (progressText) progressText.textContent = '0%';

  try {
    const tokenRes = await getDriveToken();
    if (!tokenRes || !tokenRes.success || !tokenRes.token) {
      throw new Error('Gagal mendapatkan token Drive');
    }
    const token = tokenRes.token;

    let successCount = 0;
    const totalFiles = STATE.selectedFiles.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = STATE.selectedFiles[i];
      const autoTitle = file.name.replace(/\.[^/.]+$/, '');
      const fileJudul = (totalFiles === 1 && judul) ? judul : autoTitle;
      const fileJenis = getFileTypeFromName(file.name);

      if (progressBar) progressBar.style.width = Math.round((i / totalFiles) * 100) + '%';
      if (progressText) progressText.textContent = `Upload ${i + 1}/${totalFiles}: ${file.name}`;

      const formData = new FormData();
      formData.append('metadata', new Blob([JSON.stringify({ name: file.name })], { type: 'application/json' }));
      formData.append('file', file);

      const driveData = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try { resolve(JSON.parse(xhr.responseText)); }
            catch (e) { reject(new Error('Gagal parsing respons Drive')); }
          } else {
            reject(new Error(`Upload ke Drive gagal (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error saat upload'));
        xhr.send(formData);
      });

      const driveId = driveData.id;
      if (!driveId) throw new Error('Drive tidak mengembalikan file ID');

      const result = await callApi('addAsset', {
        judul: fileJudul,
        deskripsi,
        folderId,
        jenis: fileJenis,
        fileData: driveId,
        fileName: file.name,
        mimeType: driveData.mimeType || file.type,
      }, 'POST');

      if (result && result.success) successCount++;
    }

    if (progressBar) progressBar.style.width = '100%';
    if (progressText) progressText.textContent = 'Selesai!';

    if (successCount > 0) {
      showToast(`Berhasil upload ${successCount}/${totalFiles} file`, 'success');
      getModal('uploadAssetModal')?.hide();
      STATE.selectedFiles = [];
      await loadAllData(true);
    } else {
      throw new Error('Tidak ada file yang berhasil diupload');
    }
  } catch (e) {
    showToast('Gagal upload: ' + e.message, 'error');
  } finally {
    setTimeout(() => {
      if (progressContainer) progressContainer.style.display = 'none';
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = '0%';
    }, 1500);
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isUploading = false;
  }
}

// ============================================================
//   EDIT ASSET
// ============================================================
function editAsset(id) {
  const item = getAssetById(id);
  if (!item) { showToast('Aset tidak ditemukan', 'error'); return; }

  STATE.editingAssetId = id;
  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('editAssetId', id);
  setVal('assetJudulEdit', item.judul || '');
  setVal('assetDeskripsiEdit', item.deskripsi || '');
  setVal('assetJenisEdit', item.jenis || 'gambar');

  const folderSel = getEl('assetFolderEdit');
  if (folderSel) {
    folderSel.innerHTML = '<option value="">Root</option>' +
      STATE.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
    folderSel.value = item.folderId || '';
  }

  getModal('editAssetModal')?.show();
}

async function saveEdit() {
  if (STATE.isSaving) return;

  const id = getEl('editAssetId')?.value;
  const judul = getEl('assetJudulEdit')?.value.trim() || '';
  if (!judul) { showToast('Judul wajib diisi', 'error'); return; }

  const btn = getEl('saveEditBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const res = await callApi('updateAsset', {
      id,
      judul,
      deskripsi: getEl('assetDeskripsiEdit')?.value.trim() || '',
      folderId: getEl('assetFolderEdit')?.value || '',
      jenis: getEl('assetJenisEdit')?.value || 'gambar',
    }, 'POST');

    if (res && res.success) {
      showToast('Aset berhasil diperbarui', 'success');
      getModal('editAssetModal')?.hide();
      await loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal memperbarui');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

// ============================================================
//   DELETE ASSET
// ============================================================
async function confirmDelete(id) {
  const item = getAssetById(id);
  if (!item) return;
  if (!confirm(`Hapus aset "${item.judul}"?`)) return;

  try {
    const res = await callApi('deleteAsset', { id }, 'POST');
    if (res && res.success) {
      STATE.assetList = STATE.assetList.filter(a => String(a.id) !== String(id));
      render();
      showToast('Aset berhasil dihapus', 'success');
      setTimeout(() => loadAllData(true).catch(() => {}), 500);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    await loadAllData(true).catch(() => {});
  }
}

async function deleteSelectedAssets() {
  const ids = STATE.selectedAssets.slice();
  if (ids.length === 0) {
    showToast('Pilih minimal satu aset', 'warning');
    return;
  }
  if (!confirm(`Hapus ${ids.length} aset terpilih?`)) return;

  const btn = getEl('deleteSelectedBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    let successCount = 0;
    for (const id of ids) {
      try {
        const res = await callApi('deleteAsset', { id }, 'POST');
        if (res && res.success) successCount++;
      } catch (e) { /* continue */ }
    }

    STATE.assetList = STATE.assetList.filter(a => !ids.includes(String(a.id)));
    STATE.selectedAssets = [];
    render();
    showToast(`Berhasil menghapus ${successCount}/${ids.length} aset`, 'success');
    setTimeout(() => loadAllData(true).catch(() => {}), 500);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    await loadAllData(true).catch(() => {});
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// ============================================================
//   FOLDER CRUD
// ============================================================
function openFolderModal() {
  const setVal = (id, val) => {
    const el = getEl(id);
    if (el) el.value = val;
  };
  setVal('folderNama', '');

  const parentSel = getEl('folderParent');
  if (parentSel) {
    parentSel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      STATE.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
  }
  getModal('folderModal')?.show();
}

async function saveFolder() {
  if (STATE.isSaving) return;

  const nama = getEl('folderNama')?.value.trim() || '';
  const parentId = getEl('folderParent')?.value || '';
  if (!nama) { showToast('Nama folder wajib diisi', 'error'); return; }

  const btn = getEl('saveFolderBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const res = await callApi('addFolder', { nama, parentId }, 'POST');
    if (res && res.success) {
      showToast('Folder berhasil dibuat', 'success');
      getModal('folderModal')?.hide();
      await loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal membuat folder');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

function openFolderSettings(id) {
  const folder = STATE.folderList.find(f => String(f.id) === String(id));
  if (!folder) { showToast('Folder tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => {
    const el = getEl(elId);
    if (el) el.value = val;
  };
  setVal('folderSettingsId', id);

  const titleEl = getEl('folderSettingsTitle');
  if (titleEl) titleEl.textContent = `Pengaturan: ${folder.nama || ''}`;

  const pubEl = getEl('folderSettingPublic');
  if (pubEl) pubEl.checked = folder.isPublic === true || folder.isPublic === 'true';

  const hideEl = getEl('folderSettingHide');
  if (hideEl) hideEl.checked = folder.hideFromGallery === true || folder.hideFromGallery === 'true';

  const hasPass = folder.hasPassword === true || folder.hasPassword === 'true';
  const passEl = getEl('folderSettingPassStatus');
  if (passEl) {
    passEl.textContent = hasPass ? '🔒 Terproteksi' : '🔓 Tidak ada';
    passEl.className = hasPass ? 'badge bg-warning text-dark' : 'badge bg-secondary';
  }

  setVal('folderSettingPassword', '');
  const statusEl = getEl('folderSettingsStatus');
  if (statusEl) statusEl.innerHTML = '';

  getModal('folderSettingsModal')?.show();
}

async function toggleFolderPublic(id, isPublic) {
  try {
    const res = await callApi('toggleFolderPublic', { id, isPublic }, 'POST');
    if (res && res.success) {
      showToast(`Folder ${isPublic ? 'dipublikasikan' : 'ditarik'}`, 'success');
      await loadAllData(true);
      openFolderSettings(id);
    } else throw new Error((res && res.error) || 'Gagal');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    await loadAllData(true).catch(() => {});
  }
}

async function toggleFolderHide(id, isHidden) {
  try {
    const res = await callApi('toggleFolderHideFromGallery', { id, isHidden }, 'POST');
    if (res && res.success) {
      showToast(`Folder ${isHidden ? 'disembunyikan' : 'ditampilkan'}`, 'success');
      await loadAllData(true);
      openFolderSettings(id);
    } else throw new Error((res && res.error) || 'Gagal');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    await loadAllData(true).catch(() => {});
  }
}

async function saveFolderPassword() {
  const id = getEl('folderSettingsId')?.value;
  const password = getEl('folderSettingPassword')?.value.trim() || '';
  const statusDiv = getEl('folderSettingsStatus');

  if (!password || password.length < 6) {
    if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-danger p-2 small mb-0">Password minimal 6 karakter.</div>';
    return;
  }

  const btn = getEl('folderSavePasswordBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const res = await callApi('setFolderPassword', { id, password }, 'POST');
    if (res && res.success) {
      if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success p-2 small mb-0">Password berhasil disimpan.</div>';
      await loadAllData(true);
      openFolderSettings(id);
    } else throw new Error((res && res.error) || 'Gagal menyimpan');
  } catch (e) {
    if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger p-2 small mb-0">Gagal: ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function clearFolderPassword() {
  const id = getEl('folderSettingsId')?.value;
  if (!confirm('Yakin ingin menghapus password folder ini?')) return;

  const statusDiv = getEl('folderSettingsStatus');
  const btn = getEl('folderClearPasswordBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

  try {
    const res = await callApi('clearFolderPassword', { id }, 'POST');
    if (res && res.success) {
      if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success p-2 small mb-0">Password dihapus.</div>';
      await loadAllData(true);
      openFolderSettings(id);
    } else throw new Error((res && res.error) || 'Gagal menghapus');
  } catch (e) {
    if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger p-2 small mb-0">Gagal: ${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function deleteFolderHandler() {
  const id = getEl('folderSettingsId')?.value;
  const folder = STATE.folderList.find(f => String(f.id) === String(id));
  if (!folder) return;

  if (!confirm(`Hapus folder "${folder.nama}" beserta semua aset di dalamnya?`)) return;

  const btn = getEl('deleteFolderBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menghapus...';

  try {
    const res = await callApi('deleteFolder', { id }, 'POST');
    if (res && res.success) {
      getModal('folderSettingsModal')?.hide();
      showToast('Folder berhasil dihapus', 'success');
      if (String(STATE.currentFolderId) === String(id)) STATE.currentFolderId = '';
      await loadAllData(true);
    } else throw new Error((res && res.error) || 'Gagal menghapus');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

// ============================================================
//   MOVE ASSETS
// ============================================================
function openMoveModal() {
  const ids = STATE.selectedAssets;
  if (ids.length === 0) {
    showToast('Pilih minimal satu aset', 'warning');
    return;
  }

  const countEl = getEl('moveCountLabel');
  if (countEl) countEl.textContent = ids.length;

  const sel = getEl('moveToFolderSelect');
  if (sel) {
    sel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      STATE.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
  }

  getModal('moveAssetModal')?.show();
}

async function executeMove() {
  if (STATE.isMoving) return;

  const targetFolderId = getEl('moveToFolderSelect')?.value || '';
  const ids = STATE.selectedAssets.slice();
  if (ids.length === 0) return;

  const btn = getEl('executeMoveBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isMoving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memindahkan...';

  try {
    let successCount = 0;
    for (const id of ids) {
      try {
        const item = getAssetById(id);
        if (!item) continue;
        const res = await callApi('updateAsset', {
          id,
          folderId: targetFolderId,
          judul: item.judul,
          deskripsi: item.deskripsi,
          jenis: item.jenis,
        }, 'POST');
        if (res && res.success) successCount++;
      } catch (e) { /* continue */ }
    }

    showToast(`Berhasil memindahkan ${successCount}/${ids.length} aset`, 'success');
    getModal('moveAssetModal')?.hide();
    STATE.selectedAssets = [];
    await loadAllData(true);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isMoving = false;
  }
}

// ============================================================
//   PUBLIC CONFIG
// ============================================================
async function openPublicConfig() {
  try {
    const res = await callApi('getAssetPublicConfig', {}, 'GET');
    const enabled = res?.enabled || false;

    const enEl = getEl('enablePublicGallery');
    if (enEl) enEl.checked = enabled;
    const passGroup = getEl('publicPasswordGroup');
    const linkArea = getEl('publicLinkArea');
    if (passGroup) passGroup.style.display = enabled ? 'block' : 'none';
    if (linkArea) linkArea.style.display = enabled ? 'block' : 'none';

    if (enabled) {
      const urlEl = getEl('publicGalleryUrl');
      if (urlEl) urlEl.value = window.location.origin + '/bisaa/public_assets.html';
    }
    const passEl = getEl('publicAssetPassword');
    if (passEl) passEl.value = '';

    getModal('publicConfigModal')?.show();
  } catch (e) {
    showToast('Gagal memuat konfigurasi: ' + e.message, 'error');
  }
}

async function savePublicConfig() {
  if (STATE.isSaving) return;

  const enabled = getEl('enablePublicGallery')?.checked || false;
  const password = getEl('publicAssetPassword')?.value.trim() || '';

  const btn = getEl('savePublicConfigBtn');
  const original = btn.innerHTML;
  btn.disabled = true;
  STATE.isSaving = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menyimpan...';

  try {
    const res = await callApi('setAssetPublicPassword', { enabled, password }, 'POST');
    if (res && res.success) {
      showToast('Pengaturan publik berhasil disimpan', 'success');
      getModal('publicConfigModal')?.hide();
    } else throw new Error((res && res.error) || 'Gagal menyimpan');
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
    STATE.isSaving = false;
  }
}

// ============================================================
//   PREVIEW MODAL
// ============================================================
function openPreviewWithPlaylist(items, startIndex) {
  if (!items || items.length === 0) return;

  STATE.playlistItems = items;
  STATE.currentPlaylistIndex = startIndex;
  STATE.isModalOpen = true;
  STATE.isAutoplayActive = false;

  const modal = getEl('customPreviewModal');
  if (modal) modal.style.display = 'flex';

  const autoBtn = getEl('autoplayToggleBtn');
  if (autoBtn) {
    autoBtn.innerHTML = '<i class="bi bi-play-circle-fill" style="font-size:1.2rem;"></i>';
    autoBtn.title = 'Putar Otomatis';
  }

  updatePreview(items[startIndex]);
}

function updatePreview(item) {
  if (!item || !STATE.isModalOpen) return;

  const iframe = getEl('previewContent');
  const spinner = getEl('customPreviewSpinner');
  const errorDiv = getEl('customPreviewError');
  const titleEl = getEl('previewModalTitle');
  const metaEl = getEl('previewMetaInfo');

  const cleaned = cleanDriveId(item.driveId);
  if (!isValidDriveId(cleaned)) {
    showToast('ID file tidak valid', 'warning');
    return;
  }

  if (STATE.autoplayTimeoutId) {
    clearTimeout(STATE.autoplayTimeoutId);
    STATE.autoplayTimeoutId = null;
  }

  if (titleEl) titleEl.innerHTML = `<i class="bi bi-eye me-2"></i>${escapeHtml(item.judul || 'Pratinjau')}`;
  if (metaEl) {
    metaEl.innerHTML = `${item.fileName ? `📄 ${escapeHtml(item.fileName)}` : ''} ${item.mimeType ? `<span class="badge bg-secondary ms-2">${escapeHtml(item.mimeType)}</span>` : ''}`;
  }

  if (spinner) spinner.style.display = 'flex';
  if (errorDiv) errorDiv.style.display = 'none';
  if (iframe) {
    iframe.style.display = 'block';
    iframe.classList.remove('show');
    iframe.src = '';
  }

  setTimeout(() => {
    if (!iframe) return;
    iframe.src = `https://drive.google.com/file/d/${cleaned}/preview`;
    iframe.onload = () => {
      if (spinner) spinner.style.display = 'none';
      iframe.classList.add('show');
      iframe.onload = null;
      scheduleNextPlay();
    };
    setTimeout(() => {
      if (spinner && spinner.style.display !== 'none') {
        spinner.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'block';
      }
    }, 15000);
  }, 300);

  const prevBtn = getEl('navPrev');
  const nextBtn = getEl('navNext');
  if (prevBtn) prevBtn.classList.toggle('disabled', STATE.currentPlaylistIndex <= 0);
  if (nextBtn) nextBtn.classList.toggle('disabled', STATE.currentPlaylistIndex >= STATE.playlistItems.length - 1);
}

function scheduleNextPlay() {
  if (STATE.autoplayTimeoutId) clearTimeout(STATE.autoplayTimeoutId);
  if (!STATE.isAutoplayActive || !STATE.isModalOpen) return;

  const currentItem = STATE.playlistItems[STATE.currentPlaylistIndex];
  const isVideo = String(currentItem?.jenis || '').toLowerCase() === 'video' ||
                  String(currentItem?.mimeType || '').startsWith('video/');
  const delay = isVideo ? 60000 : 5000;

  STATE.autoplayTimeoutId = setTimeout(() => {
    if (!STATE.isModalOpen) return;
    if (STATE.currentPlaylistIndex >= STATE.playlistItems.length - 1) {
      STATE.currentPlaylistIndex = 0;
    } else {
      STATE.currentPlaylistIndex++;
    }
    updatePreview(STATE.playlistItems[STATE.currentPlaylistIndex]);
  }, delay);
}

function toggleAutoplay() {
  if (!STATE.isModalOpen) return;
  const btn = getEl('autoplayToggleBtn');

  if (STATE.isAutoplayActive) {
    STATE.isAutoplayActive = false;
    if (STATE.autoplayTimeoutId) {
      clearTimeout(STATE.autoplayTimeoutId);
      STATE.autoplayTimeoutId = null;
    }
    if (btn) {
      btn.innerHTML = '<i class="bi bi-play-circle-fill" style="font-size:1.2rem;"></i>';
      btn.title = 'Putar Otomatis';
    }
  } else {
    STATE.isAutoplayActive = true;
    if (btn) {
      btn.innerHTML = '<i class="bi bi-pause-circle-fill" style="font-size:1.2rem;"></i>';
      btn.title = 'Jeda Putar Otomatis';
    }
    scheduleNextPlay();
  }
}

function closePreview() {
  STATE.isModalOpen = false;
  STATE.isAutoplayActive = false;
  if (STATE.autoplayTimeoutId) {
    clearTimeout(STATE.autoplayTimeoutId);
    STATE.autoplayTimeoutId = null;
  }

  const modal = getEl('customPreviewModal');
  if (modal) modal.style.display = 'none';
  const iframe = getEl('previewContent');
  if (iframe) {
    iframe.src = '';
    iframe.classList.remove('show');
  }
}

function navPrevPreview() {
  if (!STATE.isModalOpen) return;
  if (STATE.isAutoplayActive) toggleAutoplay();
  if (STATE.currentPlaylistIndex > 0) {
    STATE.currentPlaylistIndex--;
    updatePreview(STATE.playlistItems[STATE.currentPlaylistIndex]);
  }
}

function navNextPreview() {
  if (!STATE.isModalOpen) return;
  if (STATE.isAutoplayActive) toggleAutoplay();
  if (STATE.currentPlaylistIndex < STATE.playlistItems.length - 1) {
    STATE.currentPlaylistIndex++;
    updatePreview(STATE.playlistItems[STATE.currentPlaylistIndex]);
  }
}
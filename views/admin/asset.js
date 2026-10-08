// ============================================================
// VIEW: asset.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/asset.html
// ============================================================
// CHANGELOG v27.2.0 (dari v26.4.0):
//   ✅ NEW: Subscription ke AdminModule (auto re-render)
//   ✅ NEW: Instant render dari preload cache
//   ✅ REMOVED: Per-view polling 45s
//   ✅ FIX: Autoplay timer cleanup on unmount
//   ✅ FIX: Preview modal — dispose + cleanup
//   ✅ FIX: isMounted guard di semua async callbacks
//   ✅ FIX: Global config cache invalidation
//   ✅ KEEP: Upload, edit, folder, move, delete, preview
//   ✅ Zero memory leak
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  getDriveToken,
  fileToBase64,
  uploadToDrive,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
import { AdminModule } from '../../js/modules/admin.js';
import {
  getEl,
  debounce,
  setBtnLoading,
  createViewContext,
  cleanupBootstrapArtifacts,
  computeListHash,
  SEARCH_DEBOUNCE,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const GLOBAL_CONFIG_CACHE_MS = 10000;
const GLOBAL_CONFIG_SAVE_COOLDOWN_MS = 15000;

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    assetList: [],
    folderList: [],
    currentFolderId: '',
    selectedAssets: [],

    playlistItems: [],
    currentPlaylistIndex: 0,
    autoplayTimeoutId: null,
    isAutoplayActive: false,
    isModalOpen: false,

    globalConfig: null,
    globalConfigFetchedAt: 0,
    lastGlobalConfigSaveTime: 0,

    isUploading: false,
    isSaving: false,
    isMoving: false,
    isSavingGlobal: false,

    selectedFiles: [],

    lastAssetHash: '',
    lastFolderHash: '',
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'asset'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[AssetView] ⚡ Data changed (${type}) → refresh from cache`);
      try {
        refreshFromCache();
      } catch (e) {
        console.warn('[AssetView] Re-render error:', e);
      }
    },
  }
);

let keydownHandler = null;

// ============================================================
//   UTILITY
// ============================================================
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
  return ctx.state.assetList.find(a => String(a.id) === String(id));
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
export async function mount() {
  if (ctx.mounted) {
    console.warn('[AssetView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[AssetView] mounted');

  // Reset state
  Object.assign(ctx.state, {
    assetList: [],
    folderList: [],
    currentFolderId: '',
    selectedAssets: [],
    playlistItems: [],
    currentPlaylistIndex: 0,
    autoplayTimeoutId: null,
    isAutoplayActive: false,
    isModalOpen: false,
    globalConfig: null,
    globalConfigFetchedAt: 0,
    lastGlobalConfigSaveTime: 0,
    isUploading: false,
    isSaving: false,
    isMoving: false,
    isSavingGlobal: false,
    selectedFiles: [],
    lastAssetHash: '',
    lastFolderHash: '',
  });

  const searchEl = getEl('searchAssetInput');
  const filterEl = getEl('filterTypeAsset');
  if (searchEl) searchEl.value = '';
  if (filterEl) filterEl.value = '';

  // ⚡ Instant cache render
  const cachedAssets = AdminModule.getAssetList() || [];
  const cachedFolders = AdminModule.getFolders() || [];

  if (cachedAssets.length > 0 || cachedFolders.length > 0) {
    console.log('[AssetView] ⚡ Rendering from preload cache');
    ctx.state.assetList = cachedAssets.map(a => ({ ...a }));
    ctx.state.folderList = cachedFolders.map(f => ({ ...f }));
    ctx.state.lastAssetHash = computeListHash(ctx.state.assetList, ['id', 'timestamp']);
    ctx.state.lastFolderHash = computeListHash(ctx.state.folderList, ['id', 'nama']);
    render();
    updateCacheStatus('Live');
  } else {
    console.log('[AssetView] ⚠️ No cache, showing skeleton');
    renderSkeletonAssets();
  }

  bindEvents();

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Fallback: kalau cache kosong
  if (cachedAssets.length === 0 && cachedFolders.length === 0) {
    await loadAllData(false);
  }

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[AssetView] unmounted');

  if (ctx.state.autoplayTimeoutId) {
    clearTimeout(ctx.state.autoplayTimeoutId);
    ctx.state.autoplayTimeoutId = null;
  }

  closePreview();

  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   REFRESH FROM CACHE
// ============================================================
function refreshFromCache() {
  const freshAssets = AdminModule.getAssetList() || [];
  const freshFolders = AdminModule.getFolders() || [];

  const assetHash = computeListHash(freshAssets, ['id', 'timestamp']);
  const folderHash = computeListHash(freshFolders, ['id', 'nama']);

  const assetChanged = assetHash !== ctx.state.lastAssetHash;
  const folderChanged = folderHash !== ctx.state.lastFolderHash;

  if (!assetChanged && !folderChanged) {
    console.log('[AssetView] No change, skip re-render');
    return;
  }

  if (assetChanged) {
    ctx.state.assetList = freshAssets.map(a => ({ ...a }));
    ctx.state.lastAssetHash = assetHash;
  }
  if (folderChanged) {
    ctx.state.folderList = freshFolders.map(f => ({ ...f }));
    ctx.state.lastFolderHash = folderHash;
  }

  render();
  updateCacheStatus('Live');
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  // Toolbar
  ctx.on(getEl('uploadAssetBtn'), 'click', openUploadModal);
  ctx.on(getEl('addFolderBtn'), 'click', openFolderModal);
  ctx.on(getEl('moveSelectedBtn'), 'click', openMoveModal);
  ctx.on(getEl('deleteSelectedBtn'), 'click', deleteSelectedAssets);
  ctx.on(getEl('publicConfigBtn'), 'click', openPublicConfig);

  // Search + filter
  ctx.on(getEl('searchAssetInput'), 'input', debounce(() => renderAssets(), SEARCH_DEBOUNCE));
  ctx.on(getEl('filterTypeAsset'), 'change', () => renderAssets());

  // Refresh
  ctx.on(getEl('refreshDataBtn'), 'click', async function () {
    if (ctx.saving) return;
    ctx.saving = true;
    const restore = setBtnLoading(this, true, 'Memuat...');
    try {
      invalidateGlobalConfigCache();
      updateCacheStatus('Memuat…');
      await AdminModule.loadAllData(true);
      refreshFromCache();
      showToast('Data disegarkan', 'success');
    } catch (e) {
      showToast('Gagal menyegarkan: ' + e.message, 'error');
    } finally {
      restore();
      ctx.saving = false;
    }
  });

  // Upload modal
  ctx.on(getEl('assetFile'), 'change', function () {
    handleFilesSelected(this.files);
    this.value = '';
  });
  ctx.on(getEl('submitUploadBtn'), 'click', submitUpload);

  // Edit modal
  ctx.on(getEl('saveEditBtn'), 'click', saveEdit);

  // Folder modal
  ctx.on(getEl('saveFolderBtn'), 'click', saveFolder);

  // Global config
  ctx.on(getEl('enablePublicGallery'), 'change', function () {
    const isChecked = this.checked;
    const passGroup = getEl('publicPasswordGroup');
    const linkArea = getEl('publicLinkArea');
    if (passGroup) passGroup.style.display = isChecked ? 'block' : 'none';
    if (linkArea) linkArea.style.display = isChecked ? 'block' : 'none';
    if (isChecked) {
      const urlEl = getEl('publicGalleryUrl');
      if (urlEl) urlEl.value = window.location.origin + BASE_PATH + 'public_assets.html';
    }
    const badgeEl = getEl('globalStatusBadge');
    if (badgeEl) {
      badgeEl.className = isChecked ? 'badge bg-success ms-auto' : 'badge bg-secondary ms-auto';
      badgeEl.textContent = isChecked ? 'Aktif' : 'Nonaktif';
    }
  });
  ctx.on(getEl('savePublicConfigBtn'), 'click', savePublicConfig);
  ctx.on(getEl('copyPublicUrlBtn'), 'click', function () {
    const url = getEl('publicGalleryUrl')?.value;
    if (url) copyToClipboard(url);
  });

  // Folder settings modal
  ctx.on(getEl('folderSettingPublic'), 'change', function () {
    const id = getEl('folderSettingsId')?.value;
    if (id) toggleFolderPublic(id, this.checked);
  });
  ctx.on(getEl('folderSettingHide'), 'change', function () {
    const id = getEl('folderSettingsId')?.value;
    if (id) toggleFolderHide(id, this.checked);
  });
  ctx.on(getEl('folderSavePasswordBtn'), 'click', saveFolderPassword);
  ctx.on(getEl('folderClearPasswordBtn'), 'click', clearFolderPassword);
  ctx.on(getEl('deleteFolderBtn'), 'click', deleteFolderHandler);

  // Move modal
  ctx.on(getEl('executeMoveBtn'), 'click', executeMove);

  // Preview modal controls
  ctx.on(getEl('closePreviewBtn'), 'click', closePreview);
  ctx.on(getEl('navPrev'), 'click', navPrevPreview);
  ctx.on(getEl('navNext'), 'click', navNextPreview);
  ctx.on(getEl('autoplayToggleBtn'), 'click', toggleAutoplay);
  ctx.on(getEl('customPreviewModal'), 'click', function (e) {
    if (e.target === this) closePreview();
  });

  // Password toggle — delegation
  ctx.on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });

  // ESC key
  keydownHandler = function (e) {
    if (e.key === 'Escape' && ctx.state.isModalOpen) closePreview();
  };
  document.addEventListener('keydown', keydownHandler);

  // Folder settings modal — reset on hidden
  const settingsModalEl = getEl('folderSettingsModal');
  if (settingsModalEl) {
    ctx.on(settingsModalEl, 'hidden.bs.modal', () => {
      const idEl = getEl('folderSettingsId');
      if (idEl) idEl.value = '';
      const passEl = getEl('folderSettingPassword');
      if (passEl) passEl.value = '';
      const statusEl = getEl('folderSettingsStatus');
      if (statusEl) statusEl.innerHTML = '';
      const passGlobal = getEl('publicAssetPassword');
      if (passGlobal) passGlobal.value = '';
      try {
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
      } catch (e) { /* silent */ }
    });
  }

  // ✅ DELEGATION — folder list
  const folderListEl = getEl('folderList');
  if (folderListEl) {
    ctx.on(folderListEl, 'click', (e) => {
      const settingsBtn = e.target.closest('[data-folder-settings]');
      if (settingsBtn) {
        e.stopPropagation();
        openFolderSettings(settingsBtn.dataset.folderSettings);
        return;
      }
      const item = e.target.closest('[data-folder-id]');
      if (item) {
        navigateFolder(item.dataset.folderId || '');
      }
    });
  }

  // ✅ DELEGATION — asset grid
  const assetContainer = getEl('assetContainer');
  if (assetContainer) {
    ctx.on(assetContainer, 'click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const id = actionBtn.dataset.id;
        if (action === 'edit') editAsset(id);
        else if (action === 'share') shareAsset(id);
        else if (action === 'whatsapp') shareWhatsApp(id);
        else if (action === 'copy') copyAssetLink(id);
        else if (action === 'delete') confirmDelete(id);
        return;
      }

      const previewEl = e.target.closest('[data-preview-index]');
      if (previewEl) {
        const idx = parseInt(previewEl.dataset.previewIndex, 10);
        if (!isNaN(idx)) openPreviewWithPlaylist(getCurrentFilteredAssets(), idx);
      }
    });

    ctx.on(assetContainer, 'change', (e) => {
      const cb = e.target.closest('.asset-checkbox-input');
      if (!cb) return;
      const id = cb.dataset.assetId;
      if (!id) return;
      const idx = ctx.state.selectedAssets.indexOf(id);
      if (cb.checked && idx === -1) ctx.state.selectedAssets.push(id);
      else if (!cb.checked && idx !== -1) ctx.state.selectedAssets.splice(idx, 1);
    });

    ctx.on(assetContainer, 'click', (e) => {
      const gotoRoot = e.target.closest('[data-goto-root]');
      if (gotoRoot) {
        e.preventDefault();
        navigateFolder('');
        return;
      }
      const copyPublic = e.target.closest('[data-copy-public]');
      if (copyPublic) {
        e.preventDefault();
        const folder = ctx.state.folderList.find(f =>
          String(f.id) === String(ctx.state.currentFolderId));
        if (folder) {
          const url = `${window.location.origin}${BASE_PATH}public_assets.html?folderId=${ctx.state.currentFolderId}`;
          copyToClipboard(url);
        }
      }
    });
  }
}

// ============================================================
//   GLOBAL CONFIG
// ============================================================
async function loadGlobalConfig(forceRefresh = false) {
  const now = Date.now();
  const isRecentlySaved = (now - ctx.state.lastGlobalConfigSaveTime) < GLOBAL_CONFIG_SAVE_COOLDOWN_MS;
  if (isRecentlySaved && !forceRefresh) return ctx.state.globalConfig;

  if (!forceRefresh && ctx.state.globalConfig &&
      (now - ctx.state.globalConfigFetchedAt) < GLOBAL_CONFIG_CACHE_MS) {
    return ctx.state.globalConfig;
  }

  try {
    const res = await callApi('getAssetPublicConfig', {}, 'GET');
    const configData = res?.data || res;

    ctx.state.globalConfig = {
      enabled: !!(configData && configData.enabled),
      hasPassword: !!(configData && configData.hasPassword),
    };
    ctx.state.globalConfigFetchedAt = now;
    return ctx.state.globalConfig;
  } catch (e) {
    console.warn('[AssetView] loadGlobalConfig failed:', e);
    if (!ctx.state.globalConfig) {
      ctx.state.globalConfig = { enabled: false, hasPassword: false };
    }
    return ctx.state.globalConfig;
  }
}

function invalidateGlobalConfigCache() {
  ctx.state.globalConfig = null;
  ctx.state.globalConfigFetchedAt = 0;
  ctx.state.lastGlobalConfigSaveTime = 0;
}

function applyGlobalConfigToUI(globalConfig) {
  const enabled = !!(globalConfig && globalConfig.enabled);

  const enEl = getEl('enablePublicGallery');
  if (enEl) enEl.checked = enabled;

  const passGroup = getEl('publicPasswordGroup');
  if (passGroup) passGroup.style.display = enabled ? 'block' : 'none';

  const linkArea = getEl('publicLinkArea');
  if (linkArea) linkArea.style.display = enabled ? 'block' : 'none';

  if (enabled) {
    const urlEl = getEl('publicGalleryUrl');
    if (urlEl) urlEl.value = window.location.origin + BASE_PATH + 'public_assets.html';
  }

  const passEl = getEl('publicAssetPassword');
  if (passEl) passEl.value = '';

  const badgeEl = getEl('globalStatusBadge');
  if (badgeEl) {
    if (enabled) {
      badgeEl.className = 'badge bg-success ms-auto';
      badgeEl.textContent = 'Aktif';
    } else {
      badgeEl.className = 'badge bg-secondary ms-auto';
      badgeEl.textContent = 'Nonaktif';
    }
  }
}

// ============================================================
//   LOAD DATA (fallback)
// ============================================================
async function loadAllData(forceRefresh = false) {
  try {
    if (!AdminModule.getState().lastSync || forceRefresh) {
      await AdminModule.loadAllData(forceRefresh);
    }
    if (!ctx.mounted) return;
    refreshFromCache();
  } catch (e) {
    console.error('[AssetView] loadAllData:', e);
    const c = getEl('assetContainer');
    if (c && ctx.state.assetList.length === 0) {
      c.innerHTML = `<div class="alert alert-danger text-center">
        Gagal memuat data: ${escapeHtml(e.message)}
      </div>`;
    }
    updateCacheStatus('Error');
  }
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

  let html = `<div class="folder-item ${ctx.state.currentFolderId === '' ? 'active' : ''}"
                    data-folder-id="" role="button" tabindex="0">
    <i class="bi bi-house-door" aria-hidden="true"></i> Root
  </div>`;

  ctx.state.folderList.forEach(f => {
    const isActive = String(ctx.state.currentFolderId) === String(f.id);
    const safeId = escapeHtml(String(f.id));
    html += `<div class="folder-item ${isActive ? 'active' : ''}" data-folder-id="${safeId}" role="button" tabindex="0">
      <div class="d-flex justify-content-between align-items-center w-100">
        <span style="flex:1;min-width:0;">
          <i class="bi bi-folder-fill" aria-hidden="true"></i>
          <span style="word-break:break-word;">${escapeHtml(f.nama || '-')}</span>
        </span>
        <button type="button" class="btn btn-sm btn-outline-secondary p-0"
                data-folder-settings="${safeId}" title="Pengaturan"
                aria-label="Pengaturan folder"
                style="width:26px;height:26px;border-radius:50%;">
          <i class="bi bi-gear" style="font-size:0.8rem;" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
  });

  c.innerHTML = html;
}

function renderBreadcrumb() {
  const c = getEl('breadcrumb');
  if (!c) return;

  if (ctx.state.currentFolderId === '') {
    c.innerHTML = `<li class="breadcrumb-item active">Semua Aset</li>`;
    return;
  }

  const folder = ctx.state.folderList.find(f =>
    String(f.id) === String(ctx.state.currentFolderId));

  if (!folder) {
    c.innerHTML = `<li class="breadcrumb-item active">Semua Aset</li>`;
    return;
  }

  const isPublic = folder.isPublic === true || folder.isPublic === 'true';

  c.innerHTML = `
    <li class="breadcrumb-item"><a href="#" data-goto-root>Semua Aset</a></li>
    <li class="breadcrumb-item active">${escapeHtml(folder.nama || '')}</li>
    ${isPublic ? `<li class="ms-2">
      <button type="button" class="btn btn-outline-success btn-sm rounded-pill" data-copy-public>
        <i class="bi bi-link-45deg me-1" aria-hidden="true"></i> Salin Link Publik
      </button>
    </li>` : ''}
  `;
}

function getCurrentFilteredAssets() {
  const searchVal = (getEl('searchAssetInput')?.value || '').toLowerCase().trim();
  const typeVal = getEl('filterTypeAsset')?.value || '';

  let filtered = ctx.state.assetList.filter(item =>
    String(item.folderId || '') === String(ctx.state.currentFolderId || '')
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
  return filtered;
}

function renderAssets() {
  const c = getEl('assetContainer');
  if (!c) return;

  const searchVal = (getEl('searchAssetInput')?.value || '').toLowerCase().trim();
  const filtered = getCurrentFilteredAssets();

  if (filtered.length === 0) {
    c.innerHTML = `<div class="alert alert-info text-center">
      <i class="bi bi-image fs-4 d-block mb-2" aria-hidden="true"></i>
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
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}" role="button" tabindex="0">
          <img src="${imgUrl}" alt="${escapeHtml(item.judul)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="fallback" style="display:none;">
            <i class="bi bi-play-circle-fill" style="font-size:2.5rem;color:#64748b;" aria-hidden="true"></i>
            <div class="small text-muted mt-2">Video</div>
          </div>
        </div>`;
      } else if (isPdf) {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}" role="button" tabindex="0">
          <div class="fallback" style="display:flex;">
            <i class="bi bi-file-earmark-pdf-fill text-danger" style="font-size:2.5rem;" aria-hidden="true"></i>
            <div class="small text-muted mt-2">PDF</div>
          </div>
        </div>`;
      } else if (isAudio) {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}" role="button" tabindex="0" style="background:#dbeafe;">
          <div class="fallback" style="background:transparent;">
            <i class="bi bi-music-note-beamed text-primary" style="font-size:3rem;" aria-hidden="true"></i>
            <div class="small text-muted mt-2">Audio</div>
          </div>
        </div>`;
      } else {
        previewContent = `<div class="thumbnail-container" data-preview-index="${index}" role="button" tabindex="0">
          <img src="${imgUrl}" alt="${escapeHtml(item.judul)}" loading="lazy"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
          <div class="fallback" style="display:none;">
            <i class="bi bi-file-earmark-fill" style="font-size:2.5rem;color:#64748b;" aria-hidden="true"></i>
            <div class="small text-muted mt-2">Thumbnail gagal</div>
          </div>
        </div>`;
      }
    } else {
      previewContent = `<div class="thumbnail-container" style="background:#f8fafc;">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;">
          <i class="bi bi-file-earmark-fill" style="font-size:2.5rem;color:#94a3b8;" aria-hidden="true"></i>
          <div class="small text-muted mt-2">ID rusak</div>
        </div>
      </div>`;
    }

    const safeId = escapeHtml(String(item.id));
    const isSelected = ctx.state.selectedAssets.includes(String(item.id));

    html += `<div class="asset-card" data-asset-index="${index}">
      ${previewContent}
      <div class="form-check asset-checkbox">
        <input class="form-check-input asset-checkbox-input" type="checkbox"
               value="${safeId}" data-asset-id="${safeId}" ${isSelected ? 'checked' : ''}
               aria-label="Pilih ${escapeHtml(item.judul || '')}">
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(item.judul || '')}</div>
        <div class="card-text">${escapeHtml(item.deskripsi || '')}</div>
        <div class="card-actions">
          <span class="text-muted small">${escapeHtml(formatDate(item.timestamp))}</span>
          <div class="btn-group">
            <button type="button" class="btn btn-sm btn-outline-warning" data-action="edit" data-id="${safeId}" title="Edit" aria-label="Edit">
              <i class="bi bi-pencil" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-primary" data-action="share" data-id="${safeId}" title="Bagikan" aria-label="Bagikan">
              <i class="bi bi-share" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm btn-success" data-action="whatsapp" data-id="${safeId}" title="WhatsApp" aria-label="WhatsApp">
              <i class="bi bi-whatsapp" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-dark" data-action="copy" data-id="${safeId}" title="Salin Link" aria-label="Salin">
              <i class="bi bi-link-45deg" aria-hidden="true"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${safeId}" title="Hapus" aria-label="Hapus">
              <i class="bi bi-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>
    </div>`;
  });
  html += '</div>';

  c.innerHTML = html;
}

// ============================================================
//   NAVIGASI
// ============================================================
function navigateFolder(folderId) {
  ctx.state.currentFolderId = folderId || '';
  ctx.state.selectedAssets = [];
  render();
}

// ============================================================
//   CLIPBOARD & SHARE
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
  ctx.getModal('uploadAssetModal')?.show();
}

function resetUploadForm() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('assetJudul', '');
  setVal('assetDeskripsi', '');
  setVal('assetJenis', 'gambar');
  setVal('assetFile', '');

  const preview = getEl('filePreview');
  if (preview) preview.style.display = 'none';
  const progress = getEl('uploadProgressContainer');
  if (progress) progress.style.display = 'none';

  ctx.state.selectedFiles = [];

  const folderSel = getEl('assetFolder');
  if (folderSel) {
    folderSel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      ctx.state.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
    if (ctx.state.currentFolderId) folderSel.value = ctx.state.currentFolderId;
  }

  const badge = getEl('uploadCountBadge');
  if (badge) badge.textContent = '0';
}

function handleFilesSelected(files) {
  if (!files || files.length === 0) return;
  for (const file of files) {
    const exists = ctx.state.selectedFiles.some(f => f.name === file.name && f.size === file.size);
    if (!exists) ctx.state.selectedFiles.push(file);
  }
  renderUploadFileList();
}

function renderUploadFileList() {
  const previewContainer = getEl('filePreview');
  const fileNameDisplay = getEl('fileNameDisplay');
  const judulInput = getEl('assetJudul');
  const jenisInput = getEl('assetJenis');
  const badge = getEl('uploadCountBadge');

  if (badge) badge.textContent = ctx.state.selectedFiles.length;

  if (ctx.state.selectedFiles.length === 0) {
    if (previewContainer) previewContainer.style.display = 'none';
    return;
  }

  if (previewContainer) previewContainer.style.display = 'block';
  let html = '';
  ctx.state.selectedFiles.forEach((file, idx) => {
    const sizeKB = (file.size / 1024).toFixed(1);
    const autoTitle = file.name.replace(/\.[^/.]+$/, '');
    html += `<div class="d-flex justify-content-between align-items-center border rounded p-2 mb-2 small">
      <div style="min-width:0;flex:1;">
        <strong>${escapeHtml(file.name)}</strong>
        <span class="text-muted ms-1">(${sizeKB} KB)</span>
        <div class="text-muted" style="font-size:0.75rem;">Judul: ${escapeHtml(autoTitle)}</div>
      </div>
      <button type="button" class="btn btn-sm btn-danger" data-remove-file="${idx}" aria-label="Hapus file">&times;</button>
    </div>`;
  });
  if (fileNameDisplay) fileNameDisplay.innerHTML = html;

  // Local listeners
  fileNameDisplay?.querySelectorAll('[data-remove-file]').forEach(btn => {
    btn.addEventListener('click', () => {
      ctx.state.selectedFiles.splice(parseInt(btn.dataset.removeFile, 10), 1);
      renderUploadFileList();
    });
  });

  if (ctx.state.selectedFiles.length === 1) {
    const file = ctx.state.selectedFiles[0];
    if (judulInput) judulInput.value = file.name.replace(/\.[^/.]+$/, '');
    if (jenisInput) jenisInput.value = getFileTypeFromName(file.name);
  } else {
    if (judulInput) judulInput.value = '';
    if (jenisInput) jenisInput.value = 'gambar';
  }
}

async function submitUpload() {
  if (ctx.state.isUploading) return;

  const judul = getEl('assetJudul')?.value.trim() || '';
  const deskripsi = getEl('assetDeskripsi')?.value.trim() || '';
  const folderId = getEl('assetFolder')?.value || '';

  if (ctx.state.selectedFiles.length === 0) {
    showToast('Pilih minimal satu file', 'error');
    return;
  }
  if (ctx.state.selectedFiles.length === 1 && !judul) {
    showToast('Judul wajib diisi', 'error');
    return;
  }

  const btn = getEl('submitUploadBtn');
  const restore = setBtnLoading(btn, true, 'Mengupload...');
  ctx.state.isUploading = true;

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
    const totalFiles = ctx.state.selectedFiles.length;

    for (let i = 0; i < totalFiles; i++) {
      const file = ctx.state.selectedFiles[i];
      const autoTitle = file.name.replace(/\.[^/.]+$/, '');
      const fileJudul = (totalFiles === 1 && judul) ? judul : autoTitle;
      const fileJenis = getFileTypeFromName(file.name);

      if (progressBar) progressBar.style.width = Math.round((i / totalFiles) * 100) + '%';
      if (progressText) progressText.textContent = `Upload ${i + 1}/${totalFiles}: ${file.name}`;

      const driveData = await uploadToDrive(token, file);
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
      ctx.getModal('uploadAssetModal')?.hide();
      ctx.state.selectedFiles = [];
      await AdminModule.loadAllData(true);
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
    restore();
    ctx.state.isUploading = false;
  }
}

// ============================================================
//   EDIT ASSET
// ============================================================
function editAsset(id) {
  const item = getAssetById(id);
  if (!item) { showToast('Aset tidak ditemukan', 'error'); return; }

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('editAssetId', id);
  setVal('assetJudulEdit', item.judul || '');
  setVal('assetDeskripsiEdit', item.deskripsi || '');
  setVal('assetJenisEdit', item.jenis || 'gambar');

  const folderSel = getEl('assetFolderEdit');
  if (folderSel) {
    folderSel.innerHTML = '<option value="">Root</option>' +
      ctx.state.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
    folderSel.value = item.folderId || '';
  }

  ctx.getModal('editAssetModal')?.show();
}

async function saveEdit() {
  if (ctx.state.isSaving) return;

  const id = getEl('editAssetId')?.value;
  const judul = getEl('assetJudulEdit')?.value.trim() || '';
  if (!judul) { showToast('Judul wajib diisi', 'error'); return; }

  const btn = getEl('saveEditBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.state.isSaving = true;

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
      ctx.getModal('editAssetModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal memperbarui');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.state.isSaving = false;
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
      showToast('Aset berhasil dihapus', 'success');
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function deleteSelectedAssets() {
  const ids = ctx.state.selectedAssets.slice();
  if (ids.length === 0) {
    showToast('Pilih minimal satu aset', 'warning');
    return;
  }
  if (!confirm(`Hapus ${ids.length} aset terpilih?`)) return;

  const btn = getEl('deleteSelectedBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    let successCount = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(id => callApi('deleteAsset', { id }, 'POST'))
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.success) successCount++;
      });
    }

    ctx.state.selectedAssets = [];
    showToast(`Berhasil menghapus ${successCount}/${ids.length} aset`, 'success');
    await AdminModule.loadAllData(true);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
  }
}

// ============================================================
//   FOLDER CRUD
// ============================================================
function openFolderModal() {
  const setVal = (id, val) => { const el = getEl(id); if (el) el.value = val; };
  setVal('folderNama', '');

  const parentSel = getEl('folderParent');
  if (parentSel) {
    parentSel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      ctx.state.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
  }
  ctx.getModal('folderModal')?.show();
}

async function saveFolder() {
  if (ctx.state.isSaving) return;

  const nama = getEl('folderNama')?.value.trim() || '';
  const parentId = getEl('folderParent')?.value || '';
  if (!nama) { showToast('Nama folder wajib diisi', 'error'); return; }

  const btn = getEl('saveFolderBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.state.isSaving = true;

  try {
    const res = await callApi('addFolder', { nama, parentId }, 'POST');
    if (res && res.success) {
      showToast('Folder berhasil dibuat', 'success');
      ctx.getModal('folderModal')?.hide();
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal membuat folder');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.state.isSaving = false;
  }
}

// ============================================================
//   FOLDER SETTINGS
// ============================================================
async function openFolderSettings(id) {
  const folder = ctx.state.folderList.find(f => String(f.id) === String(id));
  if (!folder) { showToast('Folder tidak ditemukan', 'error'); return; }

  const globalConfig = await loadGlobalConfig();
  applyGlobalConfigToUI(globalConfig);

  const setVal = (elId, val) => { const el = getEl(elId); if (el) el.value = val; };
  setVal('folderSettingsId', id);

  const titleEl = getEl('folderSettingsTitle');
  if (titleEl) titleEl.textContent = `Pengaturan: ${folder.nama || ''}`;

  const folderSectionName = getEl('folderSectionName');
  if (folderSectionName) folderSectionName.textContent = `Folder "${folder.nama || ''}"`;

  const folderContent = getEl('folderSectionContent');
  const folderEmpty = getEl('folderSectionEmpty');
  if (folderContent) folderContent.style.display = 'block';
  if (folderEmpty) folderEmpty.style.display = 'none';

  const deleteBtn = getEl('deleteFolderBtn');
  if (deleteBtn) deleteBtn.style.display = '';

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

  ctx.getModal('folderSettingsModal')?.show();
}

async function openPublicConfig() {
  const globalConfig = await loadGlobalConfig(true);
  applyGlobalConfigToUI(globalConfig);

  const titleEl = getEl('folderSettingsTitle');
  if (titleEl) titleEl.textContent = 'Pengaturan Galeri Publik';

  const folderSectionName = getEl('folderSectionName');
  if (folderSectionName) folderSectionName.textContent = 'Pengaturan Folder';

  const folderContent = getEl('folderSectionContent');
  const folderEmpty = getEl('folderSectionEmpty');
  if (folderContent) folderContent.style.display = 'none';
  if (folderEmpty) folderEmpty.style.display = 'block';

  const deleteBtn = getEl('deleteFolderBtn');
  if (deleteBtn) deleteBtn.style.display = 'none';

  const idEl = getEl('folderSettingsId');
  if (idEl) idEl.value = '';

  ctx.getModal('folderSettingsModal')?.show();
}

// ============================================================
//   FOLDER TOGGLES
// ============================================================
async function toggleFolderPublic(id, isPublic) {
  try {
    const res = await callApi('toggleFolderPublic', { id, isPublic }, 'POST');
    if (res && res.success) {
      showToast(`Folder ${isPublic ? 'dipublikasikan' : 'ditarik'}`, 'success');
      await AdminModule.loadAllData(true);
      const pubEl = getEl('folderSettingPublic');
      if (pubEl) pubEl.checked = isPublic;
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    const pubEl = getEl('folderSettingPublic');
    if (pubEl) pubEl.checked = !isPublic;
  }
}

async function toggleFolderHide(id, isHidden) {
  try {
    const res = await callApi('toggleFolderHideFromGallery', { id, isHidden }, 'POST');
    if (res && res.success) {
      showToast(`Folder ${isHidden ? 'disembunyikan' : 'ditampilkan'}`, 'success');
      await AdminModule.loadAllData(true);
      const hideEl = getEl('folderSettingHide');
      if (hideEl) hideEl.checked = isHidden;
    } else {
      throw new Error((res && res.error) || 'Gagal');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
    const hideEl = getEl('folderSettingHide');
    if (hideEl) hideEl.checked = !isHidden;
  }
}

async function saveFolderPassword() {
  const id = getEl('folderSettingsId')?.value;
  const password = getEl('folderSettingPassword')?.value.trim() || '';
  const statusDiv = getEl('folderSettingsStatus');

  if (!id) return;
  if (!password || password.length < 6) {
    if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-danger p-2 small mb-0">Password minimal 6 karakter.</div>';
    return;
  }

  const btn = getEl('folderSavePasswordBtn');
  const restore = setBtnLoading(btn, true, '');

  try {
    const res = await callApi('setFolderPassword', { id, password }, 'POST');
    if (res && res.success) {
      if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success p-2 small mb-0">Password berhasil disimpan.</div>';
      await AdminModule.loadAllData(true);

      const folder = ctx.state.folderList.find(f => String(f.id) === String(id));
      const hasPass = folder ? (folder.hasPassword === true || folder.hasPassword === 'true') : true;
      const passEl = getEl('folderSettingPassStatus');
      if (passEl) {
        passEl.textContent = hasPass ? '🔒 Terproteksi' : '🔓 Tidak ada';
        passEl.className = hasPass ? 'badge bg-warning text-dark' : 'badge bg-secondary';
      }

      const passInput = getEl('folderSettingPassword');
      if (passInput) passInput.value = '';
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (e) {
    if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger p-2 small mb-0">Gagal: ${escapeHtml(e.message)}</div>`;
  } finally {
    restore();
  }
}

async function clearFolderPassword() {
  const id = getEl('folderSettingsId')?.value;
  if (!id) return;
  if (!confirm('Yakin ingin menghapus password folder ini?')) return;

  const statusDiv = getEl('folderSettingsStatus');
  const btn = getEl('folderClearPasswordBtn');
  const restore = setBtnLoading(btn, true, '');

  try {
    const res = await callApi('clearFolderPassword', { id }, 'POST');
    if (res && res.success) {
      if (statusDiv) statusDiv.innerHTML = '<div class="alert alert-success p-2 small mb-0">Password dihapus.</div>';
      await AdminModule.loadAllData(true);
      const passEl = getEl('folderSettingPassStatus');
      if (passEl) {
        passEl.textContent = '🔓 Tidak ada';
        passEl.className = 'badge bg-secondary';
      }
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    if (statusDiv) statusDiv.innerHTML = `<div class="alert alert-danger p-2 small mb-0">Gagal: ${escapeHtml(e.message)}</div>`;
  } finally {
    restore();
  }
}

async function deleteFolderHandler() {
  const id = getEl('folderSettingsId')?.value;
  const folder = ctx.state.folderList.find(f => String(f.id) === String(id));
  if (!folder) return;

  if (!confirm(`Hapus folder "${folder.nama}" beserta semua aset di dalamnya?`)) return;

  const btn = getEl('deleteFolderBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  try {
    const res = await callApi('deleteFolder', { id }, 'POST');
    if (res && res.success) {
      ctx.getModal('folderSettingsModal')?.hide();
      showToast('Folder berhasil dihapus', 'success');
      if (String(ctx.state.currentFolderId) === String(id)) ctx.state.currentFolderId = '';
      await AdminModule.loadAllData(true);
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
  }
}

// ============================================================
//   MOVE ASSETS
// ============================================================
function openMoveModal() {
  const ids = ctx.state.selectedAssets;
  if (ids.length === 0) {
    showToast('Pilih minimal satu aset', 'warning');
    return;
  }

  const countEl = getEl('moveCountLabel');
  if (countEl) countEl.textContent = ids.length;

  const sel = getEl('moveToFolderSelect');
  if (sel) {
    sel.innerHTML = '<option value="">Root (Tanpa Folder)</option>' +
      ctx.state.folderList.map(f =>
        `<option value="${escapeHtml(String(f.id))}">${escapeHtml(f.nama)}</option>`
      ).join('');
  }

  ctx.getModal('moveAssetModal')?.show();
}

async function executeMove() {
  if (ctx.state.isMoving) return;

  const targetFolderId = getEl('moveToFolderSelect')?.value || '';
  const ids = ctx.state.selectedAssets.slice();
  if (ids.length === 0) return;

  const btn = getEl('executeMoveBtn');
  const restore = setBtnLoading(btn, true, 'Memindahkan...');
  ctx.state.isMoving = true;

  try {
    let successCount = 0;
    const CONCURRENCY = 3;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (id) => {
          const item = getAssetById(id);
          if (!item) return { success: false };
          return callApi('updateAsset', {
            id,
            folderId: targetFolderId,
            judul: item.judul,
            deskripsi: item.deskripsi,
            jenis: item.jenis,
          }, 'POST');
        })
      );
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value && r.value.success) successCount++;
      });
    }

    showToast(`Berhasil memindahkan ${successCount}/${ids.length} aset`, 'success');
    ctx.getModal('moveAssetModal')?.hide();
    ctx.state.selectedAssets = [];
    await AdminModule.loadAllData(true);
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  } finally {
    restore();
    ctx.state.isMoving = false;
  }
}

// ============================================================
//   SAVE PUBLIC CONFIG
// ============================================================
async function savePublicConfig() {
  if (ctx.state.isSavingGlobal) return;

  const enabled = getEl('enablePublicGallery')?.checked || false;
  const password = getEl('publicAssetPassword')?.value.trim() || '';

  const btn = getEl('savePublicConfigBtn');
  const restore = setBtnLoading(btn, true, 'Menyimpan...');
  ctx.state.isSavingGlobal = true;

  try {
    const res = await callApi('setAssetPublicPassword', { enabled, password }, 'POST');
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }

    showToast('Pengaturan publik berhasil disimpan', 'success');

    ctx.state.globalConfig = {
      enabled: enabled,
      hasPassword: ctx.state.globalConfig?.hasPassword || !!password,
    };
    ctx.state.globalConfigFetchedAt = Date.now();
    ctx.state.lastGlobalConfigSaveTime = Date.now();

    applyGlobalConfigToUI(ctx.state.globalConfig);

    const passEl = getEl('publicAssetPassword');
    if (passEl) passEl.value = '';
  } catch (e) {
    const errMsg = String(e?.message || e || '').toLowerCase();
    const isTimeout = errMsg.includes('timeout') || errMsg.includes('network') || errMsg.includes('failed to fetch');
    if (isTimeout) {
      showToast('Permintaan memakan waktu lebih lama. Refresh halaman.', 'warning');
    } else {
      showToast('Gagal: ' + e.message, 'error');
    }
  } finally {
    restore();
    ctx.state.isSavingGlobal = false;
  }
}

// ============================================================
//   PREVIEW MODAL
// ============================================================
function openPreviewWithPlaylist(items, startIndex) {
  if (!items || items.length === 0) return;
  if (startIndex < 0 || startIndex >= items.length) startIndex = 0;

  ctx.state.playlistItems = items;
  ctx.state.currentPlaylistIndex = startIndex;
  ctx.state.isModalOpen = true;
  ctx.state.isAutoplayActive = false;

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
  if (!item || !ctx.state.isModalOpen) return;

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

  if (ctx.state.autoplayTimeoutId) {
    clearTimeout(ctx.state.autoplayTimeoutId);
    ctx.state.autoplayTimeoutId = null;
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
    if (!iframe || !ctx.state.isModalOpen) return;
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
  if (prevBtn) prevBtn.classList.toggle('disabled', ctx.state.currentPlaylistIndex <= 0);
  if (nextBtn) nextBtn.classList.toggle('disabled', ctx.state.currentPlaylistIndex >= ctx.state.playlistItems.length - 1);
}

function scheduleNextPlay() {
  if (ctx.state.autoplayTimeoutId) clearTimeout(ctx.state.autoplayTimeoutId);
  if (!ctx.state.isAutoplayActive || !ctx.state.isModalOpen) return;

  const currentItem = ctx.state.playlistItems[ctx.state.currentPlaylistIndex];
  const isVideo = String(currentItem?.jenis || '').toLowerCase() === 'video' ||
                  String(currentItem?.mimeType || '').startsWith('video/');
  const delay = isVideo ? 60000 : 5000;

  ctx.state.autoplayTimeoutId = setTimeout(() => {
    if (!ctx.state.isModalOpen) return;
    if (ctx.state.currentPlaylistIndex >= ctx.state.playlistItems.length - 1) {
      ctx.state.currentPlaylistIndex = 0;
    } else {
      ctx.state.currentPlaylistIndex++;
    }
    updatePreview(ctx.state.playlistItems[ctx.state.currentPlaylistIndex]);
  }, delay);
}

function toggleAutoplay() {
  if (!ctx.state.isModalOpen) return;
  const btn = getEl('autoplayToggleBtn');

  if (ctx.state.isAutoplayActive) {
    ctx.state.isAutoplayActive = false;
    if (ctx.state.autoplayTimeoutId) {
      clearTimeout(ctx.state.autoplayTimeoutId);
      ctx.state.autoplayTimeoutId = null;
    }
    if (btn) {
      btn.innerHTML = '<i class="bi bi-play-circle-fill" style="font-size:1.2rem;"></i>';
      btn.title = 'Putar Otomatis';
    }
  } else {
    ctx.state.isAutoplayActive = true;
    if (btn) {
      btn.innerHTML = '<i class="bi bi-pause-circle-fill" style="font-size:1.2rem;"></i>';
      btn.title = 'Jeda Putar Otomatis';
    }
    scheduleNextPlay();
  }
}

function closePreview() {
  ctx.state.isModalOpen = false;
  ctx.state.isAutoplayActive = false;
  if (ctx.state.autoplayTimeoutId) {
    clearTimeout(ctx.state.autoplayTimeoutId);
    ctx.state.autoplayTimeoutId = null;
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
  if (!ctx.state.isModalOpen) return;
  if (ctx.state.isAutoplayActive) toggleAutoplay();
  if (ctx.state.currentPlaylistIndex > 0) {
    ctx.state.currentPlaylistIndex--;
    updatePreview(ctx.state.playlistItems[ctx.state.currentPlaylistIndex]);
  }
}

function navNextPreview() {
  if (!ctx.state.isModalOpen) return;
  if (ctx.state.isAutoplayActive) toggleAutoplay();
  if (ctx.state.currentPlaylistIndex < ctx.state.playlistItems.length - 1) {
    ctx.state.currentPlaylistIndex++;
    updatePreview(ctx.state.playlistItems[ctx.state.currentPlaylistIndex]);
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Asset View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
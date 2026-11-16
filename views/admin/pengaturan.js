// ============================================================
// VIEW: pengaturan.js — v27.2.0 PRELOAD + SUBSCRIPTION EDITION
// Dimuat oleh: js/router.js
// HTML: views/admin/pengaturan.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ NEW: Instant render dari AdminModule preload cache
//   ✅ NEW: Subscription ke perubahan data
//   ✅ REMOVED: Poll interval — auto-sync global handle
//   ✅ FIX: safeLocalStorage wrapper (quota safe)
//   ✅ FIX: Race condition lock (isSavingGlobal guard)
//   ✅ FIX: Null-safe element access
//   ✅ FIX: Parallel load semua async sections
//   ✅ FIX: Robust logout via dynamic import
//   ✅ KEEP: Confirm reset ganda (checkbox + ketik "RESET")
//   ✅ KEEP: Semua fitur (general, lokasi, login mode, visibilitas,
//             form viewer, keamanan, backup, reset, info)
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  getUserData,
  getLokasiPKDList,
  addLokasiPKD,
  deleteLokasiPKD,
  getPKDLokasi,
  setPKDLokasi,
  getLoginMode,
  setLoginMode,
  getPublicVisibility,
  setPublicVisibility,
  getFormSettings,
  updateAdminPassword,
  downloadJSON,
} from '../../js/core/api.js';
import { BASE_PATH } from '../../js/core/config.js';
import { AdminModule } from '../../js/modules/admin.js';
import {
  getEl,
  setBtnLoading,
  createViewContext,
  cleanupBootstrapArtifacts,
} from '../../js/core/view-helpers.js';

// ============================================================
//   CONSTANTS
// ============================================================
const LS_KEYS = {
  APP_SETTINGS: 'pkd_app_settings',
  LOGIN_MODE_CACHE: 'pkd_cache_loginMode',
  VISIBILITY_CACHE: 'pkd_cache_publicVisibility',
};

const MENU_LABELS = {
  pretest: 'Pre-test',
  posttest: 'Post-test',
  absen: 'Absen Digital',
  skrining: 'Skrining',
  peserta: 'Peserta',
  materi: 'Materi',
  informasi: 'Informasi',
  asset: 'Aset Digital',
  verifikasi: 'Verifikasi Sertifikat',
  kader: 'Kader',
};

const FIELD_TYPE_LABELS = {
  text: 'Text',
  textarea: 'Textarea',
  radio: 'Radio',
  select: 'Select',
  file: 'File',
};

const MIN_PASSWORD_LENGTH = 6;
const CACHE_TTL_MS = 30000;
const RESET_PHRASE = 'RESET';

// ============================================================
//   CONTEXT
// ============================================================
const ctx = createViewContext(
  {
    lokasiPKDList: [],
    formFields: [],
  },
  {
    watchTypes: ['all', 'multiple', 'manual-refresh', 'settings'],
    onDataChange: (type) => {
      if (!ctx.mounted) return;
      console.log(`[PengaturanView] ⚡ Settings changed (${type})`);
      try {
        loadLokasiPKD();
        updateSystemInfo();
      } catch (e) {
        console.warn('[PengaturanView] Re-render error:', e);
      }
    },
  }
);

// ============================================================
//   SAFE STORAGE
// ============================================================
function safeLocalGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeLocalSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
function safeLocalRemove(key) {
  try { localStorage.removeItem(key); return true; } catch (e) { return false; }
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount() {
  if (ctx.mounted) {
    console.warn('[PengaturanView] Sudah mounted, skip');
    return unmount;
  }
  ctx.mounted = true;
  ctx.saving = false;
  ctx.refreshing = false;
  console.log('[PengaturanView] mounted');

  ctx.state.lokasiPKDList = [];
  ctx.state.formFields = [];

  // Sync sections (instant dari cache)
  loadAdminUsername();
  loadGeneralSettings();
  bindEvents();

  // ⚡ Instant render dari cache AdminModule
  const cachedLoginMode = AdminModule.getLoginMode();
  const cachedVisibility = AdminModule.getPublicVisibility();
  const cachedFormSettings = AdminModule.getFormSettings();

  // Apply cache dulu (instant)
  if (typeof cachedLoginMode === 'boolean') {
    const toggleEl = getEl('loginModeToggle');
    if (toggleEl) toggleEl.checked = cachedLoginMode;
    updateLoginModeStatus(cachedLoginMode);
  }
  if (cachedVisibility && Object.keys(cachedVisibility).length > 0) {
    renderVisibilityToggles(cachedVisibility);
  }
  if (Array.isArray(cachedFormSettings) && cachedFormSettings.length > 0) {
    ctx.state.formFields = cachedFormSettings;
    renderFormFields();
  }

  // ⚡ Subscribe ke perubahan data
  await ctx.subscribeToData();

  // Load async sections (paralel) — untuk refresh detail
  await Promise.allSettled([
    loadLokasiPKD(),
    loadLoginMode(),
    loadVisibility(),
    loadFormFields(),
  ]);

  updateSystemInfo();

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!ctx.mounted) return;
  ctx.mounted = false;
  console.log('[PengaturanView] unmounted');

  ctx.cleanup();
  cleanupBootstrapArtifacts();
}

// ============================================================
//   BIND EVENTS
// ============================================================
function bindEvents() {
  ctx.on(getEl('saveGeneralSettings'), 'click', saveGeneralSettings);
  ctx.on(getEl('addLokasiBtn'), 'click', addLokasiHandler);
  ctx.on(getEl('savePkdLokasiBtn'), 'click', savePkdLokasiHandler);
  ctx.on(getEl('saveLoginModeBtn'), 'click', saveLoginModeHandler);
  ctx.on(getEl('saveVisibilityBtn'), 'click', saveVisibilityHandler);
  ctx.on(getEl('changePasswordBtn'), 'click', changePasswordHandler);
  ctx.on(getEl('backupDataBtn'), 'click', backupDataHandler);
  ctx.on(getEl('resetDataBtn'), 'click', openResetConfirm);
  ctx.on(getEl('confirmResetCheck'), 'change', updateResetButtonState);
  ctx.on(getEl('confirmResetPhrase'), 'input', updateResetButtonState);
  ctx.on(getEl('confirmResetBtn'), 'click', executeResetCache);
  ctx.on(getEl('refreshDataBtn'), 'click', handleRefresh);

  // Password strength indicator
  ctx.on(getEl('newPassword'), 'input', function () {
    const strength = getPasswordStrength(this.value);
    const bar = getEl('passwordStrengthBar');
    const label = getEl('passwordStrengthLabel');
    if (bar) {
      bar.style.width = strength.level + '%';
      bar.className = 'progress-bar ' + strength.class;
    }
    if (label) {
      label.textContent = this.value ? strength.label : '';
      label.className = 'small mt-1 text-' + strength.class.replace('bg-', '');
    }
  });

  // Delegation — password toggle
  ctx.on(document, 'click', function (e) {
    const t = e.target.closest('[data-toggle-pass]');
    if (!t) return;
    const input = getEl(t.dataset.togglePass);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    const i = t.querySelector('i');
    if (i) i.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });
}

// ============================================================
//   PASSWORD STRENGTH
// ============================================================
function getPasswordStrength(pwd) {
  if (!pwd) return { level: 0, label: 'Kosong', class: 'bg-secondary' };
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score <= 2) return { level: score * 20, label: 'Lemah', class: 'bg-danger' };
  if (score <= 3) return { level: score * 20, label: 'Sedang', class: 'bg-warning' };
  return { level: Math.min(score * 20, 100), label: 'Kuat', class: 'bg-success' };
}

// ============================================================
//   1. PENGATURAN UMUM
// ============================================================
function loadAdminUsername() {
  const userData = getUserData() || {};
  const el = getEl('currentUsername');
  if (el) el.value = userData.username || userData.nama || 'admin';
}

function loadGeneralSettings() {
  const defaults = {
    appName: 'PKD GP Ansor Kabupaten Bantul',
    appDesc: 'Platform Pelatihan Kader Dasar GP Ansor',
  };
  let settings = { ...defaults };

  const saved = safeLocalGet(LS_KEYS.APP_SETTINGS);
  if (saved) {
    try { settings = { ...defaults, ...JSON.parse(saved) }; }
    catch (e) { /* silent */ }
  }

  const appNameEl = getEl('appName');
  const appDescEl = getEl('appDescription');
  if (appNameEl) appNameEl.value = settings.appName || '';
  if (appDescEl) appDescEl.value = settings.appDesc || '';
}

function saveGeneralSettings(e) {
  const btn = e.currentTarget || getEl('saveGeneralSettings');
  const appName = (getEl('appName')?.value || '').trim();
  const appDesc = (getEl('appDescription')?.value || '').trim();
  const logoFile = getEl('logoUpload')?.files?.[0];

  if (!appName) {
    showToast('Nama aplikasi tidak boleh kosong', 'error');
    return;
  }

  const settings = { appName, appDesc };
  safeLocalSet(LS_KEYS.APP_SETTINGS, JSON.stringify(settings));

  if (logoFile) {
    if (logoFile.size > 2 * 1024 * 1024) {
      showToast('Logo maksimal 2 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = getEl('logoPreview');
      if (preview) preview.src = ev.target.result;
    };
    reader.readAsDataURL(logoFile);
  }

  showToast('Pengaturan umum berhasil disimpan', 'success');
  if (btn) {
    const restore = setBtnLoading(btn, true, 'Menyimpan...');
    setTimeout(restore, 400);
  }
}

// ============================================================
//   2. LOKASI PKD
// ============================================================
async function loadLokasiPKD() {
  try {
    const res = await getLokasiPKDList();
    if (!ctx.mounted) return;
    ctx.state.lokasiPKDList = Array.isArray(res) ? res : (res?.data || []);
    renderLokasiPKDList();
    await loadPkdLokasiSetting();
  } catch (e) {
    console.warn('[PengaturanView] loadLokasiPKD:', e);
    ctx.state.lokasiPKDList = [];
    renderLokasiPKDList();
  }
}

function renderLokasiPKDList() {
  const c = getEl('lokasiPKDListContainer');
  if (!c) return;

  if (ctx.state.lokasiPKDList.length === 0) {
    c.innerHTML = '<p class="text-muted small mb-0">Belum ada lokasi PKD.</p>';
  } else {
    c.innerHTML = ctx.state.lokasiPKDList.map(item => `
      <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
        <span><span class="badge bg-primary">${escapeHtml(item.nama || '-')}</span></span>
        <button class="btn btn-sm btn-outline-danger" data-delete-lokasi="${escapeHtml(String(item.id))}" title="Hapus" aria-label="Hapus lokasi">
          <i class="bi bi-trash" aria-hidden="true"></i>
        </button>
      </div>
    `).join('');

    c.querySelectorAll('[data-delete-lokasi]').forEach(btn => {
      btn.addEventListener('click', () => deleteLokasiHandler(btn.dataset.deleteLokasi));
    });
  }

  const sel = getEl('pkdLokasiSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Semua Lokasi --</option>' +
      ctx.state.lokasiPKDList.map(l =>
        `<option value="${escapeHtml(l.nama || '')}">${escapeHtml(l.nama || '')}</option>`
      ).join('');
    if (cur) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === cur) { sel.selectedIndex = i; break; }
      }
    }
  }
}

async function addLokasiHandler(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('addLokasiBtn');
  const input = getEl('newLokasiInput');
  const nama = input?.value.trim() || '';
  if (!nama) {
    showToast('Nama lokasi wajib diisi', 'error');
    input?.focus();
    return;
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, '');

  try {
    const res = await addLokasiPKD(nama);
    if (res && res.success) {
      showToast('Lokasi berhasil ditambahkan', 'success');
      if (input) input.value = '';
      await loadLokasiPKD();
    } else {
      throw new Error((res && res.error) || 'Gagal menambahkan');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

async function deleteLokasiHandler(id) {
  const item = ctx.state.lokasiPKDList.find(l => String(l.id) === String(id));
  if (!item) {
    showToast('Lokasi tidak ditemukan', 'error');
    return;
  }
  if (!confirm(`Hapus lokasi "${item.nama}"?`)) return;

  try {
    const res = await deleteLokasiPKD(id);
    if (res && res.success) {
      showToast('Lokasi berhasil dihapus', 'success');
      await loadLokasiPKD();
    } else {
      throw new Error((res && res.error) || 'Gagal menghapus');
    }
  } catch (e) {
    showToast('Gagal: ' + e.message, 'error');
  }
}

async function loadPkdLokasiSetting() {
  try {
    const res = await getPKDLokasi();
    if (!ctx.mounted) return;
    const current = res?.data || '';
    const sel = getEl('pkdLokasiSelect');
    if (sel && current) {
      for (let i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === current) { sel.selectedIndex = i; break; }
      }
    }
    const statusEl = getEl('pkdLokasiStatus');
    if (statusEl) {
      statusEl.innerHTML = `<i class="bi bi-info-circle me-1"></i> Filter saat ini: <strong>${escapeHtml(current || 'Semua Lokasi')}</strong>`;
    }
  } catch (e) { /* silent */ }
}

async function savePkdLokasiHandler(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('savePkdLokasiBtn');
  const lokasi = getEl('pkdLokasiSelect')?.value || '';
  const statusEl = getEl('pkdLokasiStatus');

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await setPKDLokasi(lokasi);
    if (res && res.success) {
      if (statusEl) {
        statusEl.innerHTML = `✅ <i class="bi bi-check-circle me-1"></i> Filter disimpan: <strong>${escapeHtml(lokasi || 'Semua Lokasi')}</strong>`;
      }
      showToast('Filter lokasi berhasil diperbarui', 'success');
    } else {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `❌ Gagal: ${escapeHtml(err.message)}`;
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   3. LOGIN MODE
// ============================================================
async function loadLoginMode() {
  const toggleEl = getEl('loginModeToggle');
  if (toggleEl) toggleEl.checked = false;
  updateLoginModeStatus(false);

  const cached = safeLocalGet(LS_KEYS.LOGIN_MODE_CACHE);
  if (cached) {
    try {
      const { enabled, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL_MS) {
        if (toggleEl) toggleEl.checked = !!enabled;
        updateLoginModeStatus(!!enabled);
        return;
      }
    } catch (e) { /* silent */ }
  }

  try {
    const res = await getLoginMode();
    const enabled = res?.success ? !!res.enabled : false;
    safeLocalSet(LS_KEYS.LOGIN_MODE_CACHE, JSON.stringify({ enabled, timestamp: Date.now() }));
    if (toggleEl) toggleEl.checked = enabled;
    updateLoginModeStatus(enabled);
  } catch (e) {
    console.warn('[PengaturanView] loadLoginMode:', e);
    safeLocalRemove(LS_KEYS.LOGIN_MODE_CACHE);
    updateLoginModeStatus(false);
  }
}

function updateLoginModeStatus(enabled) {
  const el = getEl('loginModeStatus');
  if (!el) return;
  if (enabled) {
    el.className = 'login-mode-status on';
    el.innerHTML = '<i class="bi bi-lock-fill me-1"></i> Mode <strong>Wajib Login</strong> AKTIF — Semua halaman publik memerlukan login.';
  } else {
    el.className = 'login-mode-status off';
    el.innerHTML = '<i class="bi bi-unlock-fill me-1"></i> Mode <strong>Guest</strong> AKTIF — Semua halaman publik dapat diakses tanpa login.';
  }
}

async function saveLoginModeHandler(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('saveLoginModeBtn');
  const toggleEl = getEl('loginModeToggle');
  if (!toggleEl) return;

  const requestedEnabled = toggleEl.checked;

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await setLoginMode(requestedEnabled);
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }

    safeLocalRemove(LS_KEYS.LOGIN_MODE_CACHE);

    let finalEnabled = requestedEnabled;
    try {
      const fresh = await getLoginMode();
      if (fresh && fresh.success) finalEnabled = !!fresh.enabled;
    } catch (err) {
      console.warn('[PengaturanView] Verify login mode gagal:', err);
    }

    toggleEl.checked = finalEnabled;
    updateLoginModeStatus(finalEnabled);

    safeLocalSet(LS_KEYS.LOGIN_MODE_CACHE, JSON.stringify({ enabled: finalEnabled, timestamp: Date.now() }));
    showToast(`Mode login: ${finalEnabled ? 'Wajib Login' : 'Guest'}`, 'success');
  } catch (err) {
    // Rollback
    try {
      const fresh = await getLoginMode();
      if (fresh?.success) {
        toggleEl.checked = !!fresh.enabled;
        updateLoginModeStatus(!!fresh.enabled);
      } else {
        toggleEl.checked = !requestedEnabled;
        updateLoginModeStatus(!requestedEnabled);
      }
    } catch (e) {
      toggleEl.checked = !requestedEnabled;
      updateLoginModeStatus(!requestedEnabled);
    }
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   4. VISIBILITAS MENU
// ============================================================
async function loadVisibility() {
  renderVisibilityToggles({});

  const cached = safeLocalGet(LS_KEYS.VISIBILITY_CACHE);
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_TTL_MS) {
        renderVisibilityToggles(data || {});
        return;
      }
    } catch (e) { /* silent */ }
  }

  try {
    const res = await getPublicVisibility();
    if (res?.success && res.data) {
      safeLocalSet(LS_KEYS.VISIBILITY_CACHE, JSON.stringify({ data: res.data, timestamp: Date.now() }));
      renderVisibilityToggles(res.data);
    }
  } catch (e) {
    console.warn('[PengaturanView] loadVisibility:', e);
  }
}

function renderVisibilityToggles(visibility) {
  const c = getEl('menuVisibilityContainer');
  if (!c) return;

  let html = '';
  Object.keys(MENU_LABELS).forEach(key => {
    const label = MENU_LABELS[key];
    const isEnabled = visibility[key] !== false;
    html += `
      <div class="col-md-6 col-lg-4">
        <div class="form-check form-switch">
          <input class="form-check-input visibility-toggle" type="checkbox"
                 id="vis_${key}" data-key="${key}" ${isEnabled ? 'checked' : ''}>
          <label class="form-check-label fw-semibold" for="vis_${key}">${escapeHtml(label)}</label>
        </div>
      </div>`;
  });
  c.innerHTML = html;
}

async function saveVisibilityHandler(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('saveVisibilityBtn');
  const toggles = document.querySelectorAll('.visibility-toggle');
  const data = {};
  toggles.forEach(t => { data[t.dataset.key] = t.checked; });

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await setPublicVisibility(data);
    if (res && res.success) {
      safeLocalRemove(LS_KEYS.VISIBILITY_CACHE);
      showToast('Visibilitas menu berhasil disimpan', 'success');
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
//   5. FORM FIELDS (read-only viewer)
// ============================================================
async function loadFormFields() {
  const c = getEl('formFieldsContainer');
  if (!c) return;
  c.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-primary"></div></div>';

  try {
    const res = await getFormSettings();
    let fields = [];
    if (res?.success && Array.isArray(res.data)) fields = res.data;
    else if (Array.isArray(res)) fields = res;

    // Handle nested array
    if (fields.length > 0 && Array.isArray(fields[0])) fields = fields[0];

    ctx.state.formFields = fields;
    renderFormFields();
  } catch (e) {
    console.warn('[PengaturanView] loadFormFields:', e);
    c.innerHTML = '<div class="alert alert-info text-center mb-0 small">Gagal memuat konfigurasi form.</div>';
  }
}

function renderFormFields() {
  const c = getEl('formFieldsContainer');
  if (!c) return;

  if (ctx.state.formFields.length === 0) {
    c.innerHTML = '<div class="alert alert-info text-center mb-0 small">Belum ada konfigurasi field.</div>';
    return;
  }

  let html = '<div class="table-responsive"><table class="table table-hover table-sm align-middle mb-0">';
  html += `<thead class="table-light"><tr>
    <th style="width:50px;">#</th>
    <th>Label</th>
    <th>Tipe</th>
    <th style="width:100px;">Wajib</th>
    <th style="width:100px;">Core</th>
  </tr></thead><tbody>`;

  ctx.state.formFields.forEach((f, i) => {
    const typeLabel = FIELD_TYPE_LABELS[f.type] || f.type || 'text';
    html += `<tr>
      <td>${i + 1}</td>
      <td><strong>${escapeHtml(f.label || '-')}</strong></td>
      <td><span class="badge bg-secondary">${escapeHtml(typeLabel)}</span></td>
      <td>${f.required ? '<span class="badge bg-warning text-dark">Ya</span>' : '<span class="text-muted small">Tidak</span>'}</td>
      <td>${f.isCore ? '<span class="badge bg-primary"><i class="bi bi-lock-fill"></i></span>' : '<span class="text-muted small">—</span>'}</td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  html += `<p class="text-muted small mt-2 mb-0">
    <i class="bi bi-info-circle me-1"></i>
    Untuk mengubah struktur field, buka menu <strong>Peserta</strong> → <strong>Form Builder</strong>.
  </p>`;

  c.innerHTML = html;
}

// ============================================================
//   6. KEAMANAN AKUN ADMIN
// ============================================================
async function changePasswordHandler(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('changePasswordBtn');
  const newPass = getEl('newPassword')?.value || '';
  const confirmPass = getEl('confirmPassword')?.value || '';
  const userData = getUserData() || {};
  const username = userData.username || userData.nama || 'admin';

  if (!newPass && !confirmPass) {
    showToast('Masukkan password baru untuk mengubah', 'info');
    return;
  }
  if (newPass !== confirmPass) {
    showToast('Konfirmasi password tidak cocok', 'error');
    getEl('confirmPassword')?.focus();
    return;
  }
  if (newPass.length < MIN_PASSWORD_LENGTH) {
    showToast(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`, 'error');
    getEl('newPassword')?.focus();
    return;
  }

  if (!confirm(`Ubah password untuk akun "${username}"?\n\nSetelah berhasil, Anda akan otomatis logout dan harus login ulang.`)) {
    return;
  }

  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await updateAdminPassword(username, newPass);

    if (res && res.success) {
      showToast('✅ Password berhasil diubah. Auto-logout dalam 2 detik…', 'success');

      const newEl = getEl('newPassword');
      const confEl = getEl('confirmPassword');
      if (newEl) newEl.value = '';
      if (confEl) confEl.value = '';

      const bar = getEl('passwordStrengthBar');
      const label = getEl('passwordStrengthLabel');
      if (bar) { bar.style.width = '0%'; bar.className = 'progress-bar'; }
      if (label) { label.textContent = ''; }

      setTimeout(() => {
        import('../../js/core/api.js')
          .then(mod => {
            if (typeof mod.logout === 'function') mod.logout();
            else window.location.href = BASE_PATH + 'login.html';
          })
          .catch(() => {
            window.location.href = BASE_PATH + 'login.html';
          });
      }, 2000);
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah password');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   7. BACKUP & RESET
// ============================================================
function backupDataHandler() {
  const state = AdminModule.getState();
  if (!state || Object.keys(state).length === 0) {
    showToast('Tidak ada data untuk dibackup', 'info');
    return;
  }

  const sanitized = {};
  Object.keys(state).forEach(key => {
    if (key === 'isLoading' || key === 'lastError') return;
    try {
      JSON.stringify(state[key]);
      sanitized[key] = state[key];
    } catch (e) { /* skip circular */ }
  });

  const exportObj = {
    exportedAt: new Date().toISOString(),
    version: '27.2.0',
    platform: 'PKD GP Ansor Kabupaten Bantul',
    data: sanitized,
  };

  const today = new Date();
  const pad = n => String(n).padStart(2, '0');
  const localDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

  if (downloadJSON(exportObj, `backup_pkd_${localDate}.json`)) {
    showToast('Backup data berhasil diunduh', 'success');
  } else {
    showToast('Gagal membuat backup', 'error');
  }
}

function openResetConfirm() {
  const checkEl = getEl('confirmResetCheck');
  const phraseEl = getEl('confirmResetPhrase');
  const btnEl = getEl('confirmResetBtn');
  if (checkEl) checkEl.checked = false;
  if (phraseEl) phraseEl.value = '';
  if (btnEl) btnEl.disabled = true;
  ctx.getModal('resetConfirmModal')?.show();
}

function updateResetButtonState() {
  const checkEl = getEl('confirmResetCheck');
  const phraseEl = getEl('confirmResetPhrase');
  const btnEl = getEl('confirmResetBtn');
  if (!btnEl) return;

  const isChecked = !!checkEl?.checked;
  const isPhraseCorrect =
    (phraseEl?.value || '').trim().toUpperCase() === RESET_PHRASE;

  btnEl.disabled = !(isChecked && isPhraseCorrect);
}

function executeResetCache(e) {
  const btn = e.currentTarget || getEl('confirmResetBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  let cleared = 0;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('pkd_cache_') || key.startsWith('pkd_member_cache_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      try { localStorage.removeItem(k); cleared++; } catch (e) { /* silent */ }
    });
  } catch (e) { /* silent */ }

  try { AdminModule.clearState(); } catch (e) { /* silent */ }

  showToast(`Cache lokal dibersihkan (${cleared} entri)`, 'success');
  ctx.getModal('resetConfirmModal')?.hide();

  setTimeout(() => {
    restore();
    window.location.reload();
  }, 800);
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (ctx.saving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  ctx.saving = true;
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    safeLocalRemove(LS_KEYS.LOGIN_MODE_CACHE);
    safeLocalRemove(LS_KEYS.VISIBILITY_CACHE);

    await Promise.allSettled([
      loadLoginMode(),
      loadVisibility(),
      loadLokasiPKD(),
      loadFormFields(),
    ]);

    updateSystemInfo();
    showToast('Pengaturan berhasil disegarkan', 'success');
  } catch (err) {
    showToast('Gagal menyegarkan: ' + err.message, 'error');
  } finally {
    restore();
    ctx.saving = false;
  }
}

// ============================================================
//   INFO SISTEM
// ============================================================
function updateSystemInfo() {
  try {
    const stats = AdminModule.getStats() || {};
    const state = AdminModule.getState() || {};

    let totalData = 0;
    ['peserta', 'sesi', 'materi', 'skrining', 'pretest', 'posttest',
     'alumni', 'kader', 'informasi', 'absensi', 'sertifikat',
     'timInstruktur'].forEach(k => {
      if (Array.isArray(state[k])) totalData += state[k].length;
    });

    const totalEl = getEl('totalDataInfo');
    const lastUpdateEl = getEl('lastUpdateInfo');

    if (totalEl) totalEl.textContent = `${totalData} entri`;
    if (lastUpdateEl) {
      lastUpdateEl.textContent = stats.lastSync
        ? new Date(stats.lastSync).toLocaleString('id-ID')
        : '-';
    }
  } catch (e) {
    console.warn('[PengaturanView] updateSystemInfo:', e);
  }
}

// ============================================================
//   EXPORT DEFAULT
// ============================================================
export default { mount, unmount };

console.log(
  '%c Pengaturan View v27.2.0 — Preload + Subscription Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
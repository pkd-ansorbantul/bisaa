// ============================================================
// VIEW: pengaturan.js — Full Fix v26.1.2 Production Ready
// Dimuat oleh: js/router.js
// HTML: views/admin/pengaturan.html
// ============================================================
// Fitur:
// ✅ Pengaturan umum (app name, desc, logo preview)
// ✅ Lokasi PKD (CRUD + filter aktif)
// ✅ Mode login publik (wajib login vs guest) — FIXED race condition
// ✅ Visibilitas menu publik (per halaman)
// ✅ Form Builder viewer (read-only)
// ✅ Keamanan akun admin (ganti password) — FIXED pakai endpoint
// ✅ Backup data (JSON download)
// ✅ Reset cache lokal (dengan konfirmasi ganda)
// ✅ Info sistem (total data + last update)
// ✅ Zero memory leak + full cleanup
//
// v26.1.2 FIXES:
// ✅ BUG-001: Toast login mode sync dengan state UI (race condition)
// ✅ BUG-005: Ganti password admin pakai endpoint resetMemberPassword
// ✅ Hapus dependency ke endpoint yang tidak ada
// ✅ Better error handling di semua handler
// ✅ Loading state pada semua tombol
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
  resetMemberPassword,
} from '../../js/core/api.js';
import { AdminModule } from '../../js/modules/admin.js';

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

// ============================================================
//   MODULE STATE
// ============================================================
let pollInterval = null;
let isMounted = false;
let isSaving = false;

const STATE = {
  lokasiPKDList: [],
  formFields: [],
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
      console.warn('[PengaturanView] Gagal init modal:', id, e);
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

function safeLS(fn) {
  try { return fn(); } catch (e) { return null; }
}

function setBtnLoading(btn, loading, loadingText) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span>${loadingText || 'Memuat...'}`;
  } else {
    btn.disabled = false;
    btn.innerHTML = original;
  }
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}

// ============================================================
//   MOUNT
// ============================================================
export async function mount({ path, query, outlet }) {
  if (isMounted) {
    console.warn('[PengaturanView] Sudah mounted, skip');
    return unmount;
  }
  isMounted = true;
  console.log('[PengaturanView] mounted');

  // Reset state
  STATE.lokasiPKDList = [];
  STATE.formFields = [];
  isSaving = false;

  // Load sync sections first (localStorage-based)
  loadAdminUsername();
  loadGeneralSettings();

  // Load async sections paralel (tapi tidak saling block)
  await Promise.allSettled([
    loadLokasiPKD().catch(e => console.error('[PengaturanView] loadLokasiPKD:', e)),
    loadLoginMode().catch(e => console.error('[PengaturanView] loadLoginMode:', e)),
    loadVisibility().catch(e => console.error('[PengaturanView] loadVisibility:', e)),
    loadFormFields().catch(e => console.error('[PengaturanView] loadFormFields:', e)),
  ]);

  updateSystemInfo();
  bindEvents();

  // Poll system info setiap 60 detik
  pollInterval = setInterval(() => {
    if (document.hidden) return;
    if (!isMounted) return;
    updateSystemInfo();
  }, 60000);

  return unmount;
}

// ============================================================
//   UNMOUNT
// ============================================================
export function unmount() {
  if (!isMounted) return;
  isMounted = false;
  console.log('[PengaturanView] unmounted');

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
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
  on(getEl('saveGeneralSettings'), 'click', saveGeneralSettings);
  on(getEl('addLokasiBtn'), 'click', addLokasiHandler);
  on(getEl('savePkdLokasiBtn'), 'click', savePkdLokasiHandler);
  on(getEl('saveLoginModeBtn'), 'click', saveLoginModeHandler);
  on(getEl('saveVisibilityBtn'), 'click', saveVisibilityHandler);
  on(getEl('changePasswordBtn'), 'click', changePasswordHandler);
  on(getEl('backupDataBtn'), 'click', backupDataHandler);
  on(getEl('resetDataBtn'), 'click', openResetConfirm);
  on(getEl('confirmResetCheck'), 'change', handleResetCheckChange);
  on(getEl('confirmResetBtn'), 'click', executeResetCache);
  on(getEl('refreshDataBtn'), 'click', handleRefresh);

  // Delegation: toggle password visibility
  on(document, 'click', function (e) {
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
//   PENGATURAN UMUM
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

  const saved = safeLS(() => localStorage.getItem(LS_KEYS.APP_SETTINGS));
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

  if (logoFile) {
    if (logoFile.size > 2 * 1024 * 1024) {
      showToast('Logo maksimal 2 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const preview = getEl('logoPreview');
      if (preview) preview.src = ev.target.result;
      showToast('Pengaturan umum disimpan (logo diperbarui)', 'success');
    };
    reader.onerror = () => showToast('Gagal membaca file logo', 'error');
    reader.readAsDataURL(logoFile);
  } else {
    showToast('Pengaturan umum berhasil disimpan', 'success');
  }

  safeLS(() => localStorage.setItem(LS_KEYS.APP_SETTINGS, JSON.stringify(settings)));

  if (btn) {
    const restore = setBtnLoading(btn, true, 'Menyimpan...');
    setTimeout(restore, 400);
  }
}

// ============================================================
//   LOKASI PKD
// ============================================================
async function loadLokasiPKD() {
  try {
    const res = await getLokasiPKDList();
    STATE.lokasiPKDList = Array.isArray(res) ? res : (res?.data || []);
    renderLokasiPKDList();
    await loadPkdLokasiSetting();
  } catch (e) {
    console.warn('[PengaturanView] loadLokasiPKD:', e);
    STATE.lokasiPKDList = [];
    renderLokasiPKDList();
  }
}

function renderLokasiPKDList() {
  const c = getEl('lokasiPKDListContainer');
  if (!c) return;

  if (STATE.lokasiPKDList.length === 0) {
    c.innerHTML = '<p class="text-muted small mb-0">Belum ada lokasi PKD.</p>';
  } else {
    c.innerHTML = STATE.lokasiPKDList.map(item => `
      <div class="d-flex justify-content-between align-items-center py-2 border-bottom">
        <span><span class="badge bg-primary">${escapeHtml(item.nama || '-')}</span></span>
        <button class="btn btn-sm btn-outline-danger" data-delete-lokasi="${escapeHtml(String(item.id))}" title="Hapus">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `).join('');
  }

  // Re-bind delete buttons
  c.querySelectorAll('[data-delete-lokasi]').forEach(btn => {
    btn.addEventListener('click', () => deleteLokasiHandler(btn.dataset.deleteLokasi));
  });

  // Sync select dropdown
  const sel = getEl('pkdLokasiSelect');
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">-- Semua Lokasi --</option>' +
      STATE.lokasiPKDList.map(l =>
        `<option value="${escapeHtml(l.nama || '')}">${escapeHtml(l.nama || '')}</option>`
      ).join('');
    if (cur) {
      for (const opt of sel.options) {
        if (opt.value === cur) { opt.selected = true; break; }
      }
    }
  }
}

async function addLokasiHandler(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('addLokasiBtn');
  const input = getEl('newLokasiInput');
  const nama = input?.value.trim() || '';
  if (!nama) {
    showToast('Nama lokasi wajib diisi', 'error');
    input?.focus();
    return;
  }

  isSaving = true;
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
    isSaving = false;
  }
}

async function deleteLokasiHandler(id) {
  const item = STATE.lokasiPKDList.find(l => String(l.id) === String(id));
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
    const current = res?.data || '';
    const sel = getEl('pkdLokasiSelect');
    if (sel && current) {
      for (const opt of sel.options) {
        if (opt.value === current) { opt.selected = true; break; }
      }
    }
    const statusEl = getEl('pkdLokasiStatus');
    if (statusEl) {
      statusEl.innerHTML = `<i class="bi bi-info-circle me-1"></i> Filter saat ini: <strong>${escapeHtml(current || 'Semua Lokasi')}</strong>`;
    }
  } catch (e) { /* silent */ }
}

async function savePkdLokasiHandler(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('savePkdLokasiBtn');
  const lokasi = getEl('pkdLokasiSelect')?.value || '';
  const statusEl = getEl('pkdLokasiStatus');

  isSaving = true;
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
    isSaving = false;
  }
}

// ============================================================
//   LOGIN MODE — FIXED race condition
// ============================================================
async function loadLoginMode() {
  const toggleEl = getEl('loginModeToggle');
  if (toggleEl) toggleEl.checked = false;
  updateLoginModeStatus(false);

  // Check cache (30 detik)
  const cached = safeLS(() => localStorage.getItem(LS_KEYS.LOGIN_MODE_CACHE));
  if (cached) {
    try {
      const { enabled, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < 30000) {
        if (toggleEl) toggleEl.checked = !!enabled;
        updateLoginModeStatus(!!enabled);
        return;
      }
    } catch (e) { /* silent */ }
  }

  try {
    const res = await getLoginMode();
    const enabled = res?.success ? !!res.enabled : false;
    safeLS(() => localStorage.setItem(
      LS_KEYS.LOGIN_MODE_CACHE,
      JSON.stringify({ enabled, timestamp: Date.now() })
    ));
    if (toggleEl) toggleEl.checked = enabled;
    updateLoginModeStatus(enabled);
  } catch (e) {
    console.warn('[PengaturanView] loadLoginMode:', e);
    safeLS(() => localStorage.removeItem(LS_KEYS.LOGIN_MODE_CACHE));
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

// ✅ FIXED: Toast sync dengan state final, bukan state pre-API
async function saveLoginModeHandler(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('saveLoginModeBtn');
  const toggleEl = getEl('loginModeToggle');
  if (!toggleEl) return;

  const requestedEnabled = toggleEl.checked;

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await setLoginMode(requestedEnabled);
    if (!res || !res.success) {
      throw new Error((res && res.error) || 'Gagal menyimpan');
    }

    // Clear cache
    safeLS(() => localStorage.removeItem(LS_KEYS.LOGIN_MODE_CACHE));

    // ✅ Re-verify dari server untuk dapat nilai final
    let finalEnabled = requestedEnabled;
    try {
      const fresh = await getLoginMode();
      if (fresh && fresh.success) {
        finalEnabled = !!fresh.enabled;
      }
    } catch (err) {
      console.warn('[PengaturanView] Verify login mode gagal:', err);
    }

    // ✅ Sync UI dengan nilai FINAL
    toggleEl.checked = finalEnabled;
    updateLoginModeStatus(finalEnabled);

    // Update cache
    safeLS(() => localStorage.setItem(
      LS_KEYS.LOGIN_MODE_CACHE,
      JSON.stringify({ enabled: finalEnabled, timestamp: Date.now() })
    ));

    // ✅ Toast pakai nilai FINAL (bukan requested)
    showToast(
      `Mode login: ${finalEnabled ? 'Wajib Login' : 'Guest'}`,
      'success'
    );
  } catch (err) {
    // Rollback UI ke state sebenarnya (fetch ulang)
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
    isSaving = false;
  }
}

// ============================================================
//   VISIBILITAS MENU
// ============================================================
async function loadVisibility() {
  renderVisibilityToggles({});

  const cached = safeLS(() => localStorage.getItem(LS_KEYS.VISIBILITY_CACHE));
  if (cached) {
    try {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < 30000) {
        renderVisibilityToggles(data || {});
        return;
      }
    } catch (e) { /* silent */ }
  }

  try {
    const res = await getPublicVisibility();
    if (res?.success && res.data) {
      safeLS(() => localStorage.setItem(
        LS_KEYS.VISIBILITY_CACHE,
        JSON.stringify({ data: res.data, timestamp: Date.now() })
      ));
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
  if (isSaving) return;

  const btn = e.currentTarget || getEl('saveVisibilityBtn');
  const toggles = document.querySelectorAll('.visibility-toggle');
  const data = {};
  toggles.forEach(t => { data[t.dataset.key] = t.checked; });

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    const res = await setPublicVisibility(data);
    if (res && res.success) {
      safeLS(() => localStorage.removeItem(LS_KEYS.VISIBILITY_CACHE));
      showToast('Visibilitas menu berhasil disimpan', 'success');
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
//   FORM FIELDS (read-only viewer)
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

    // Handle nested array (form struktur dari backend kadang nested)
    if (fields.length > 0 && Array.isArray(fields[0])) {
      fields = fields[0];
    }

    STATE.formFields = fields;
    renderFormFields();
  } catch (e) {
    console.warn('[PengaturanView] loadFormFields:', e);
    c.innerHTML = '<div class="alert alert-info text-center mb-0 small">Gagal memuat konfigurasi form.</div>';
  }
}

function renderFormFields() {
  const c = getEl('formFieldsContainer');
  if (!c) return;

  if (STATE.formFields.length === 0) {
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

  STATE.formFields.forEach((f, i) => {
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
//   KEAMANAN AKUN ADMIN — FIXED pakai endpoint yang ada
// ============================================================
async function changePasswordHandler(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('changePasswordBtn');
  const newPass = getEl('newPassword')?.value || '';
  const confirmPass = getEl('confirmPassword')?.value || '';
  const userData = getUserData() || {};
  const username = userData.username || userData.nama || 'admin';

  // Validasi
  if (!newPass && !confirmPass) {
    showToast('Masukkan password baru untuk mengubah', 'info');
    return;
  }
  if (newPass !== confirmPass) {
    showToast('Konfirmasi password tidak cocok', 'error');
    return;
  }
  if (newPass.length < MIN_PASSWORD_LENGTH) {
    showToast(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`, 'error');
    return;
  }

  if (!confirm(`Ubah password untuk akun "${username}"?`)) return;

  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Menyimpan...');

  try {
    // ✅ Pakai endpoint resetMemberPassword (bekerja untuk semua role)
    const res = await resetMemberPassword({ username, newPassword: newPass });

    if (res && res.success) {
      showToast('Password berhasil diubah. Silakan login ulang.', 'success');
      const newEl = getEl('newPassword');
      const confEl = getEl('confirmPassword');
      if (newEl) newEl.value = '';
      if (confEl) confEl.value = '';
    } else {
      throw new Error((res && res.error) || 'Gagal mengubah password');
    }
  } catch (err) {
    showToast('Gagal: ' + err.message, 'error');
  } finally {
    restore();
    isSaving = false;
  }
}

// ============================================================
//   BACKUP & RESET
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
    version: '26.1.2',
    platform: 'PKD GP Ansor Kabupaten Bantul',
    data: sanitized,
  };

  try {
    const json = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_pkd_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup data berhasil diunduh', 'success');
  } catch (e) {
    showToast('Gagal membuat backup: ' + e.message, 'error');
  }
}

function openResetConfirm() {
  const checkEl = getEl('confirmResetCheck');
  const btnEl = getEl('confirmResetBtn');
  if (checkEl) checkEl.checked = false;
  if (btnEl) btnEl.disabled = true;
  getModal('resetConfirmModal')?.show();
}

function handleResetCheckChange(e) {
  const btn = getEl('confirmResetBtn');
  if (btn) btn.disabled = !e.target.checked;
}

function executeResetCache(e) {
  const btn = e.currentTarget || getEl('confirmResetBtn');
  const restore = setBtnLoading(btn, true, 'Menghapus...');

  let cleared = 0;
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('pkd_cache_') || key.startsWith('pkd_member_cache_')) {
        localStorage.removeItem(key);
        cleared++;
      }
    });
  } catch (e) { /* silent */ }

  try { AdminModule.clearState(); } catch (e) { /* silent */ }

  showToast(`Cache lokal dibersihkan (${cleared} entri)`, 'success');
  getModal('resetConfirmModal')?.hide();

  setTimeout(() => {
    restore();
    window.location.reload();
  }, 800);
}

// ============================================================
//   REFRESH
// ============================================================
async function handleRefresh(e) {
  if (isSaving) return;

  const btn = e.currentTarget || getEl('refreshDataBtn');
  isSaving = true;
  const restore = setBtnLoading(btn, true, 'Memuat...');

  try {
    // Clear cache
    safeLS(() => {
      localStorage.removeItem(LS_KEYS.LOGIN_MODE_CACHE);
      localStorage.removeItem(LS_KEYS.VISIBILITY_CACHE);
    });

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
    isSaving = false;
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
     'alumni', 'kader', 'informasi', 'absensi', 'sertifikat'].forEach(k => {
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
// ============================================================
// js/components/sign-page.js — v26.4.0 PRODUCTION FULL FIX
// Shared logic untuk 3 halaman tanda tangan digital
// ============================================================
// CHANGELOG v26.4.0:
//   ✅ FIX CRITICAL BUG-03: Instruktur wajib cek Ketua PC DAN Sekretaris
//     (sebelumnya hanya cek Sekretaris → bypass urutan)
//   ✅ FIX: Race condition password verify — token guard lebih robust
//   ✅ FIX: Submit bypass debounce — verify langsung saat klik
//   ✅ FIX: Signature pad resize preserve data (debounced)
//   ✅ FIX: Bulk confirmation enhanced untuk >50 peserta
//   ✅ FIX: Empty eligible state dengan hint per role
//   ✅ FIX: PAC group selalu tampil (meski 1 PAC)
//   ✅ FIX: Signature resize handler cleanup on destroy
//   ✅ FIX: Welcome banner dynamic dari config
//   ✅ FIX: Password toggle null-safe
//   ✅ PERF: Debounced verify 600ms (hindari spam GAS)
//   ✅ PERF: Bulk sign optimization
//   ✅ CLEANUP: on destroy — semua listener + timer
// ============================================================

import {
  showToast,
  escapeHtml,
  getUserRole,
  getUserData,
  loadAuthState,
  getPesertaList,
  submitDigitalSignature,
  bulkSignForRole,
  getSignatureOrderStatus,
  verifySignPassword,
} from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const PASSWORD_VERIFY_DEBOUNCE_MS = 600;
const RESIZE_DEBOUNCE_MS = 200;
const SIGNATURE_CANVAS_HEIGHT = 200;
const BULK_CONFIRM_THRESHOLD = 50;

const ALLOWED_ROLES = ['ketua_pc', 'sekretaris', 'instruktur'];

/**
 * ✅ FIX BUG-03: Role sebelumnya yang HARUS sudah TTD dulu.
 * Ketua PC → tidak butuh (start).
 * Sekretaris → butuh Ketua PC.
 * Instruktur → butuh Ketua PC DAN Sekretaris.
 */
const REQUIRED_ROLES = {
  ketua_pc:   [],
  sekretaris: ['ketua_pc'],
  instruktur: ['ketua_pc', 'sekretaris'],
};

// ============================================================
//   MAIN INIT
// ============================================================
export function initSignPage(config) {
  // ===== Validate config =====
  if (!config || !config.role) {
    console.error('[SignPage] Config.role wajib diisi');
    return null;
  }
  if (ALLOWED_ROLES.indexOf(config.role) === -1) {
    console.error('[SignPage] Role tidak valid:', config.role);
    return null;
  }

  const ROLE = config.role;
  const ROLE_LABEL = config.roleLabel || ROLE;
  const WELCOME_NAME = config.welcomeName || '';
  const WELCOME_EMOJI = config.welcomeEmoji || '🎉';

  // ===== DOM refs =====
  const el = {
    pageLoading: document.getElementById('pageLoading'),
    form: document.getElementById('signForm'),
    pesertaSelect: document.getElementById('pesertaSelect'),
    pesertaHint: document.getElementById('pesertaHint'),
    namaInput: document.getElementById('namaInput'),
    passwordInput: document.getElementById('passwordInput'),
    togglePassBtn: document.getElementById('togglePassBtn'),
    signatureArea: document.getElementById('signatureArea'),
    sigCanvas: document.getElementById('sigCanvas'),
    clearSign: document.getElementById('clearSign'),
    undoSign: document.getElementById('undoSign'),
    submitBtn: document.getElementById('submitBtn'),
    submitText: document.getElementById('submitText'),
    resultMsg: document.getElementById('resultMsg'),
    userInfo: document.getElementById('signPageUserInfo'),
    welcomeBanner: document.getElementById('welcomeBanner'),
    passLiveHint: document.getElementById('passLiveHint'),
  };

  // ===== State =====
  const state = {
    sigPad: null,
    isSubmitting: false,
    eligibleList: [],
    pacGroups: {},
    passwordVerified: false,
    passwordCheckTimer: null,
    passwordCheckToken: 0,
    resizeHandler: null,
    resizeTimer: null,
    listeners: [],
    mounted: false,
    destroyed: false,
  };

  // ============================================================
  //   UTILITY
  // ============================================================
  function on(element, ev, handler, options) {
    if (!element) return null;
    element.addEventListener(ev, handler, options);
    state.listeners.push({ el: element, ev, handler, options });
    return handler;
  }

  function showPage() {
    if (el.pageLoading) el.pageLoading.classList.add('hidden');
    setTimeout(() => {
      try { el.pageLoading?.remove(); }
      catch (e) { /* silent */ }
    }, 400);
  }

  function showResult(message, type = 'info') {
    if (!el.resultMsg) return;
    const icons = {
      success: 'bi-check-circle-fill',
      danger:  'bi-x-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
      info:    'bi-info-circle-fill',
    };
    const icon = icons[type] || icons.info;
    el.resultMsg.innerHTML = `
      <div class="alert-custom ${type}">
        <i class="bi ${icon}" aria-hidden="true"></i>
        <div>${message}</div>
      </div>
    `;
  }

  function clearResult() {
    if (el.resultMsg) el.resultMsg.innerHTML = '';
  }

  // ============================================================
  //   USER INFO
  // ============================================================
  function renderUserInfo() {
    if (!el.userInfo) return;
    try {
      loadAuthState();
      const role = getUserRole();
      const userData = getUserData() || {};

      if (role === 'admin' || role === 'ketua_pac') {
        el.userInfo.className = 'user-info-badge logged';
        el.userInfo.innerHTML = `
          <i class="bi bi-person-check-fill" aria-hidden="true"></i>
          <span>Login: <strong>${escapeHtml(userData.nama || role)}</strong></span>
        `;
      } else {
        el.userInfo.className = 'user-info-badge locked';
        el.userInfo.innerHTML = `
          <i class="bi bi-shield-lock-fill" aria-hidden="true"></i>
          <span>Mode <strong>Password TTD</strong></span>
        `;
      }
    } catch (e) {
      el.userInfo.className = 'user-info-badge locked';
      el.userInfo.innerHTML = `
        <i class="bi bi-shield-lock-fill" aria-hidden="true"></i>
        <span>Mode <strong>Password TTD</strong></span>
      `;
    }
  }

  // ============================================================
  //   WELCOME BANNER
  // ============================================================
  function renderWelcomeBanner() {
    if (!el.welcomeBanner) return;
    const safeName = (WELCOME_NAME || '').trim();
    const text = safeName
      ? `Sudah siap ${escapeHtml(ROLE_LABEL)} GP Ansor Kabupaten Bantul Sahabat <strong>"${escapeHtml(safeName)}"</strong>,`
      : `Sudah siap ${escapeHtml(ROLE_LABEL)} GP Ansor Kabupaten Bantul,`;

    el.welcomeBanner.innerHTML = `
      <div class="welcome-icon">
        <i class="bi bi-stars" aria-hidden="true"></i>
      </div>
      <div class="welcome-text">
        <strong>${text}</strong><br>
        Selamat datang dan Semoga Selalu dilimpahkan keberkahan. Aamiin ${escapeHtml(WELCOME_EMOJI)}
      </div>
    `;
  }

  // ============================================================
  //   SIGNATURE PAD
  // ============================================================
  function initSignaturePad() {
    if (!el.sigCanvas || !el.signatureArea) return;

    if (typeof SignaturePad === 'undefined') {
      showResult('Library tanda tangan tidak tersedia. Cek koneksi.', 'danger');
      return;
    }

    // Cleanup previous
    if (state.sigPad) {
      try { state.sigPad.off(); }
      catch (e) { /* silent */ }
      state.sigPad = null;
    }

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = el.sigCanvas.getBoundingClientRect();
    const w = Math.max(rect.width, 300);
    const h = SIGNATURE_CANVAS_HEIGHT;

    el.sigCanvas.width = w * ratio;
    el.sigCanvas.height = h * ratio;
    el.sigCanvas.style.width = w + 'px';
    el.sigCanvas.style.height = h + 'px';

    const ctx2d = el.sigCanvas.getContext('2d');
    ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    ctx2d.scale(ratio, ratio);

    state.sigPad = new SignaturePad(el.sigCanvas, {
      backgroundColor: 'rgb(255, 255, 255)',
      penColor: '#0f172a',
      minWidth: 1.5,
      maxWidth: 3,
      throttle: 16,
    });

    state.sigPad.addEventListener('beginStroke', () => {
      el.signatureArea.classList.add('drawing');
    });

    // Resize handler — debounced, preserve data
    state.resizeHandler = () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        if (!state.sigPad || state.destroyed) return;
        const data = state.sigPad.toData();
        const isEmpty = state.sigPad.isEmpty();

        const newRatio = Math.max(window.devicePixelRatio || 1, 1);
        const newRect = el.sigCanvas.getBoundingClientRect();
        const newW = Math.max(newRect.width, 300);

        el.sigCanvas.width = newW * newRatio;
        el.sigCanvas.height = h * newRatio;
        el.sigCanvas.style.width = newW + 'px';
        el.sigCanvas.style.height = h + 'px';

        const newCtx = el.sigCanvas.getContext('2d');
        newCtx.setTransform(1, 0, 0, 1, 0, 0);
        newCtx.scale(newRatio, newRatio);

        state.sigPad.clear();
        if (!isEmpty && data.length) {
          try { state.sigPad.fromData(data); }
          catch (e) { /* silent */ }
        }
      }, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener('resize', state.resizeHandler);
  }

  // ============================================================
  //   LOAD PESERTA
  // ============================================================
  async function loadPeserta() {
    if (!el.pesertaSelect) return;

    el.pesertaSelect.disabled = true;
    el.pesertaSelect.innerHTML = '<option value="">Memuat daftar peserta…</option>';

    try {
      const [pesertaRes, statusRes] = await Promise.all([
        getPesertaList({ status: 'approved' }),
        getSignatureOrderStatus(),
      ]);

      const list = (pesertaRes && pesertaRes.data)
        ? pesertaRes.data
        : (Array.isArray(pesertaRes) ? pesertaRes : []);

      const statusMap = (statusRes && statusRes.success && statusRes.data)
        ? statusRes.data
        : {};

      // ✅ FIX BUG-03: Use REQUIRED_ROLES (bukan PREV_ROLES single)
      const requiredRoles = REQUIRED_ROLES[ROLE] || [];

      state.eligibleList = list.filter(p => {
        const st = String(p.status || '').toLowerCase();
        if (st !== 'approved' && st !== 'active') return false;

        const key = String(p.nama_lengkap || '').toLowerCase().trim();
        const row = statusMap[key] || {};

        // Skip jika sudah TTD oleh role ini
        if (row[ROLE]) return false;

        // ✅ Wajib SEMUA role yang dibutuhkan sudah TTD
        return requiredRoles.every(r => row[r]);
      });

      // Build PAC groups
      state.pacGroups = {};
      state.eligibleList.forEach(p => {
        const pac = String(p.utusan || 'Tidak diketahui').trim() || 'Tidak diketahui';
        if (!state.pacGroups[pac]) state.pacGroups[pac] = [];
        state.pacGroups[pac].push(p);
      });

      renderPesertaDropdown();
      el.pesertaSelect.disabled = false;
    } catch (e) {
      console.error('[SignPage] loadPeserta error:', e);
      el.pesertaSelect.innerHTML = '<option value="">Gagal memuat peserta</option>';
      el.pesertaSelect.disabled = false;

      if (el.pesertaHint) {
        el.pesertaHint.innerHTML = '<i class="bi bi-exclamation-triangle text-danger" aria-hidden="true"></i> Gagal memuat data. Coba refresh halaman.';
      }
    }
  }

  function renderPesertaDropdown() {
    if (!el.pesertaSelect) return;

    // Empty state
    if (state.eligibleList.length === 0) {
      const empties = {
        ketua_pc:   '✅ Semua peserta sudah Anda tandatangani',
        sekretaris: '⏳ Menunggu Ketua PC / sudah selesai',
        instruktur: '⏳ Menunggu Ketua PC & Sekretaris',
      };
      el.pesertaSelect.innerHTML = `<option value="">${empties[ROLE] || 'Tidak ada peserta eligible'}</option>`;

      if (el.pesertaHint) {
        const hints = {
          ketua_pc:   '<i class="bi bi-check-circle text-success" aria-hidden="true"></i> Tidak ada peserta yang perlu TTD.',
          sekretaris: '<i class="bi bi-hourglass-split text-warning" aria-hidden="true"></i> Belum ada peserta siap Anda TTD. Pastikan <strong>Ketua PC</strong> sudah menandatangani.',
          instruktur: '<i class="bi bi-hourglass-split text-warning" aria-hidden="true"></i> Belum ada peserta siap Anda TTD. Pastikan <strong>Ketua PC &amp; Sekretaris</strong> sudah menandatangani.',
        };
        el.pesertaHint.innerHTML = hints[ROLE] || 'Tidak ada peserta eligible.';
      }
      return;
    }

    // Build options
    let html = '<option value="">-- Pilih Peserta --</option>';
    html += `<option value="__ALL__">📋 SEMUA PESERTA (${state.eligibleList.length} orang)</option>`;

    const pacNames = Object.keys(state.pacGroups).sort();

    // Always show PAC group (even 1 PAC)
    if (pacNames.length > 0) {
      html += '<optgroup label="📁 Bulk per PAC">';
      pacNames.forEach(pac => {
        html += `<option value="__PAC__:${escapeHtml(pac)}">📁 ${escapeHtml(pac)} (${state.pacGroups[pac].length} orang)</option>`;
      });
      html += '</optgroup>';
    }

    html += '<optgroup label="👤 Peserta Individual">';
    const sorted = state.eligibleList.slice().sort((a, b) =>
      String(a.nama_lengkap || '').localeCompare(String(b.nama_lengkap || ''))
    );
    sorted.forEach(p => {
      html += `<option value="${escapeHtml(p.nama_lengkap)}">${escapeHtml(p.nama_lengkap)} — ${escapeHtml(p.utusan || '-')}</option>`;
    });
    html += '</optgroup>';

    el.pesertaSelect.innerHTML = html;

    if (el.pesertaHint) {
      const hints = {
        ketua_pc:   `Tersedia <strong>${state.eligibleList.length} peserta</strong> untuk TTD. Pilih <strong>📋 SEMUA</strong> untuk bulk, per PAC, atau individual.`,
        sekretaris: `Tersedia <strong>${state.eligibleList.length} peserta</strong> (sudah di-TTD Ketua PC). Pilih <strong>📋 SEMUA</strong> untuk bulk, per PAC, atau individual.`,
        instruktur: `Tersedia <strong>${state.eligibleList.length} peserta</strong> (sudah di-TTD Ketua PC &amp; Sekretaris). Pilih <strong>📋 SEMUA</strong> untuk bulk, per PAC, atau individual.`,
      };
      el.pesertaHint.innerHTML = hints[ROLE] || `Tersedia ${state.eligibleList.length} peserta.`;
    }
  }

  // ============================================================
  //   PASSWORD VERIFY (debounced + token guard)
  // ============================================================
  function handlePasswordInput() {
    if (!el.passwordInput) return;

    clearTimeout(state.passwordCheckTimer);
    const pwd = el.passwordInput.value;

    // Reset verified state
    state.passwordVerified = false;
    el.welcomeBanner?.classList.remove('show');
    el.signatureArea?.classList.add('locked');
    el.submitBtn?.classList.add('locked');
    if (el.submitBtn) el.submitBtn.disabled = true;

    if (el.passLiveHint) {
      el.passLiveHint.className = 'password-hint-live';
      el.passLiveHint.innerHTML = '';
    }

    if (!pwd) return;

    // Loading state
    if (el.passLiveHint) {
      el.passLiveHint.className = 'password-hint-live loading show';
      el.passLiveHint.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Memeriksa password…';
    }

    // Token guard untuk cegah race
    const myToken = ++state.passwordCheckToken;

    state.passwordCheckTimer = setTimeout(async () => {
      try {
        const res = await verifySignPassword(ROLE, pwd);

        // Cek apakah token masih valid
        if (myToken !== state.passwordCheckToken) return;

        if (res && res.success) {
          state.passwordVerified = true;
          el.welcomeBanner?.classList.add('show');
          el.signatureArea?.classList.remove('locked');
          el.submitBtn?.classList.remove('locked');
          if (el.submitBtn) el.submitBtn.disabled = false;

          if (el.passLiveHint) {
            el.passLiveHint.className = 'password-hint-live success show';
            el.passLiveHint.innerHTML = '<i class="bi bi-check-circle-fill" aria-hidden="true"></i> Password benar — silakan tanda tangan.';
          }

          el.welcomeBanner?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
          state.passwordVerified = false;
          if (el.passLiveHint) {
            el.passLiveHint.className = 'password-hint-live error show';
            el.passLiveHint.innerHTML = '<i class="bi bi-x-circle-fill" aria-hidden="true"></i> Password salah — silakan coba lagi.';
          }
        }
      } catch (e) {
        if (myToken !== state.passwordCheckToken) return;
        if (el.passLiveHint) {
          el.passLiveHint.className = 'password-hint-live error show';
          el.passLiveHint.innerHTML = '<i class="bi bi-exclamation-triangle-fill" aria-hidden="true"></i> Gagal verifikasi: ' + escapeHtml(e.message);
        }
      }
    }, PASSWORD_VERIFY_DEBOUNCE_MS);
  }

  // ============================================================
  //   SUBMIT HANDLER
  // ============================================================
  async function handleSubmit(e) {
    e.preventDefault();
    if (state.isSubmitting) return;
    clearResult();

    const pesertaVal = (el.pesertaSelect?.value || '').trim();
    const nama = (el.namaInput?.value || '').trim();
    const password = (el.passwordInput?.value || '');

    // Validation
    if (!pesertaVal) {
      showResult('Pilih peserta terlebih dahulu.', 'warning');
      el.pesertaSelect?.focus();
      return;
    }
    if (!nama) {
      showResult('Nama penanda tangan wajib diisi.', 'warning');
      el.namaInput?.focus();
      return;
    }
    if (!password) {
      showResult('Password TTD wajib diisi.', 'warning');
      el.passwordInput?.focus();
      return;
    }
    if (!state.sigPad || state.sigPad.isEmpty()) {
      showResult('Tanda tangan wajib diisi.', 'warning');
      el.signatureArea?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    // ✅ Bypass debounce race — verify langsung jika belum verified
    if (!state.passwordVerified) {
      const originalText = el.submitText?.textContent || 'Simpan';
      if (el.submitText) el.submitText.textContent = 'Memverifikasi…';

      try {
        const vRes = await verifySignPassword(ROLE, password);
        if (!vRes || !vRes.success) {
          showResult('Password TTD salah. Periksa kembali.', 'danger');
          if (el.submitText) el.submitText.textContent = originalText;
          return;
        }
        state.passwordVerified = true;
      } catch (err) {
        showResult('Gagal verifikasi password: ' + escapeHtml(err.message), 'danger');
        if (el.submitText) el.submitText.textContent = originalText;
        return;
      }
    }

    // Determine mode
    let mode = 'single';
    let targetLabel = pesertaVal;
    let filterPac = null;

    if (pesertaVal === '__ALL__') {
      mode = 'bulk';
      targetLabel = `SEMUA PESERTA (${state.eligibleList.length} orang)`;
    } else if (pesertaVal.indexOf('__PAC__:') === 0) {
      mode = 'bulk';
      filterPac = pesertaVal.slice('__PAC__:'.length);
      const cnt = (state.pacGroups[filterPac] || []).length;
      targetLabel = `SEMUA PESERTA ${filterPac} (${cnt} orang)`;

      if (cnt === 0) {
        showResult('PAC tidak ditemukan di daftar eligible. Refresh halaman.', 'warning');
        return;
      }
    }

    // Confirmation
    if (mode === 'bulk') {
      const count = filterPac
        ? (state.pacGroups[filterPac] || []).length
        : state.eligibleList.length;

      let confirmMsg = `⚠️ KONFIRMASI BULK SIGN\n\n`;
      confirmMsg += `Anda akan menandatangani:\n${targetLabel}\n\n`;
      confirmMsg += `Tanda tangan & password Anda akan dipakai untuk semua peserta tersebut.`;

      if (count >= BULK_CONFIRM_THRESHOLD) {
        confirmMsg += `\n\n⚠️ PERHATIAN: ${count} peserta sekaligus. Pastikan data sudah benar.`;
      }

      if (!confirm(confirmMsg)) return;
    }

    // Submit
    state.isSubmitting = true;
    el.submitBtn.disabled = true;
    const originalText = el.submitText?.textContent || 'Simpan';
    if (el.submitText) {
      el.submitText.textContent = mode === 'bulk' ? 'Memproses bulk…' : 'Menyimpan…';
    }

    try {
      let signatureDataURL;
      try {
        signatureDataURL = state.sigPad.toDataURL('image/jpeg', 0.3);
      } catch (err) {
        signatureDataURL = state.sigPad.toDataURL('image/png');
      }
      if (!signatureDataURL || signatureDataURL.indexOf('data:image/') !== 0) {
        throw new Error('Gagal memproses tanda tangan.');
      }

      let res;
      if (mode === 'bulk') {
        res = await bulkSignForRole(
          ROLE, nama, signatureDataURL, password,
          filterPac, 'Verifikasi sertifikat PKD'
        );
      } else {
        res = await submitDigitalSignature(
          ROLE, nama, signatureDataURL, password,
          pesertaVal, 'Verifikasi sertifikat PKD'
        );
      }

      if (res && res.success) {
        if (mode === 'bulk') {
          showResult(
            `✅ <strong>Berhasil!</strong> TTD Anda tersimpan untuk <strong>${res.count} peserta</strong>.<br>` +
            `<small>🎉 Sertifikat <strong>${res.count} peserta</strong> siap digenerate.</small>`,
            'success'
          );
          showToast(`Berhasil TTD ${res.count} peserta`, 'success');
        } else {
          showResult(
            `✅ Tanda tangan <strong>${ROLE_LABEL}</strong> berhasil disimpan untuk "<strong>${escapeHtml(pesertaVal)}</strong>".<br>` +
            `<small>🎉 Sertifikat peserta ini siap digenerate.</small>`,
            'success'
          );
          showToast(`Tanda tangan ${ROLE_LABEL} berhasil`, 'success');
        }

        // Reset form
        state.sigPad.clear();
        el.signatureArea.classList.remove('drawing');
        state.passwordVerified = false;
        el.welcomeBanner?.classList.remove('show');
        el.signatureArea?.classList.add('locked');
        el.submitBtn?.classList.add('locked');
        el.submitBtn.disabled = true;

        if (el.passLiveHint) {
          el.passLiveHint.className = 'password-hint-live';
          el.passLiveHint.innerHTML = '';
        }
        clearTimeout(state.passwordCheckTimer);

        if (el.passwordInput) el.passwordInput.value = '';
        if (el.pesertaSelect) el.pesertaSelect.value = '';

        window.scrollTo({ top: 0, behavior: 'smooth' });

        await loadPeserta();
      } else {
        throw new Error((res && res.error) || 'Gagal menyimpan tanda tangan.');
      }
    } catch (err) {
      console.error('[SignPage] Submit error:', err);
      const msg = err.message || 'Terjadi kesalahan.';
      const low = msg.toLowerCase();

      if (low.includes('password')) {
        showResult('Password TTD salah. Periksa kembali password Anda.', 'danger');
      } else if (
        low.includes('tunggu') ||
        low.includes('ketua') ||
        low.includes('sekretaris') ||
        low.includes('sudah')
      ) {
        showResult(escapeHtml(msg), 'warning');
      } else {
        showResult('Gagal: ' + escapeHtml(msg), 'danger');
      }
      showToast('Gagal menyimpan tanda tangan', 'error');
    } finally {
      state.isSubmitting = false;
      if (el.submitBtn) el.submitBtn.disabled = !state.passwordVerified;
      if (el.submitText) el.submitText.textContent = originalText;
    }
  }

  // ============================================================
  //   BIND EVENTS
  // ============================================================
  function bindEvents() {
    // Toggle password visibility
    on(el.togglePassBtn, 'click', () => {
      if (!el.passwordInput) return;
      const isPassword = el.passwordInput.type === 'password';
      el.passwordInput.type = isPassword ? 'text' : 'password';
      const icon = el.togglePassBtn.querySelector('i');
      if (icon) icon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
      el.togglePassBtn.setAttribute('aria-label', isPassword ? 'Sembunyikan password' : 'Tampilkan password');
    });

    // Signature clear/undo
    on(el.clearSign, 'click', () => {
      state.sigPad?.clear();
      el.signatureArea?.classList.remove('drawing');
    });

    on(el.undoSign, 'click', () => {
      if (!state.sigPad) return;
      const data = state.sigPad.toData();
      if (data && data.length > 0) {
        data.pop();
        state.sigPad.fromData(data);
        if (data.length === 0) el.signatureArea?.classList.remove('drawing');
      }
    });

    // Password input
    on(el.passwordInput, 'input', handlePasswordInput);

    // Form submit
    on(el.form, 'submit', handleSubmit);
  }

  // ============================================================
  //   DESTROY
  // ============================================================
  function destroy() {
    if (state.destroyed) return;
    state.destroyed = true;

    clearTimeout(state.passwordCheckTimer);
    clearTimeout(state.resizeTimer);

    if (state.resizeHandler) {
      window.removeEventListener('resize', state.resizeHandler);
      state.resizeHandler = null;
    }

    if (state.sigPad) {
      try { state.sigPad.off(); }
      catch (e) { /* silent */ }
      state.sigPad = null;
    }

    state.listeners.forEach(({ el: element, ev, handler, options }) => {
      try { element.removeEventListener(ev, handler, options); }
      catch (e) { /* silent */ }
    });
    state.listeners.length = 0;
  }

  // ============================================================
  //   BOOT
  // ============================================================
  (async function boot() {
    if (state.mounted) return;
    state.mounted = true;

    renderUserInfo();
    renderWelcomeBanner();

    // Prefill nama dari user data
    try {
      const userData = getUserData() || {};
      if (userData.nama && el.namaInput) {
        el.namaInput.value = userData.nama;
      }
    } catch (e) { /* silent */ }

    initSignaturePad();
    bindEvents();
    await loadPeserta();
    showPage();

    // Cleanup on unload
    window.addEventListener('beforeunload', destroy, { once: true });
  })();

  return { destroy };
}

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Sign Page Shared v26.4.0 — Production Full Fix ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
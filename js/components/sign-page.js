// ============================================================
// js/components/sign-page.js — v28.3.0 FULL FIX + QUEUE EDITION
// Shared logic untuk 3 halaman tanda tangan digital
// ============================================================
// CHANGELOG v28.3.0 (dari v26.4.0):
//   ✅ FIX CRITICAL: Sekretaris langsung bisa TTD setelah Ketua TTD
//     → Cek normalized key (lowercase + trim + collapse whitespace)
//   ✅ FIX CRITICAL: Instruktur wajib cek Ketua PC DAN Sekretaris
//   ✅ NEW: Signature Queue integration
//     → Ketua: pilih peserta → tambah ke queue
//     → Sekretaris/Instruktur: dropdown auto-populate dari queue
//   ✅ NEW: UI untuk Ketua pilih peserta (multi-select + bulk queue)
//   ✅ FIX: Race condition password verify — token guard robust
//   ✅ FIX: Submit bypass debounce — verify langsung saat klik
//   ✅ FIX: Signature pad resize preserve data (debounced)
//   ✅ FIX: Bulk confirmation enhanced untuk >50 peserta
//   ✅ FIX: Empty eligible state dengan hint per role
//   ✅ FIX: Debug log untuk troubleshooting
//   ✅ FIX: Normalize nama konsisten di semua fungsi
//   ✅ PERF: Debounced verify 600ms (hindari spam GAS)
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
  // ⭐ v28.3.0: Queue API
  addToSignatureQueue,
  addBulkToSignatureQueue,
  getSignatureQueue,
  removeFromSignatureQueue,
  clearSignatureQueue,
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
 * Required roles sebelumnya yang HARUS sudah TTD dulu.
 * Ketua PC → tidak butuh (start).
 * Sekretaris → butuh Ketua PC.
 * Instruktur → butuh Ketua PC DAN Sekretaris.
 */
const REQUIRED_ROLES_BEFORE = {
  ketua_pc:   [],
  sekretaris: ['ketua_pc'],
  instruktur: ['ketua_pc', 'sekretaris'],
};

// ============================================================
//   NORMALIZE KEY — konsisten dengan backend
// ============================================================
function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

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
  const IS_KETUA = (ROLE === 'ketua_pc');

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
    queueList: [],
    statusMap: {},          // normalized key → { ketua_pc, sekretaris, instruktur, _inQueue }
    pacGroups: {},
    passwordVerified: false,
    passwordCheckTimer: null,
    passwordCheckToken: 0,
    resizeHandler: null,
    resizeTimer: null,
    listeners: [],
    mounted: false,
    destroyed: false,
    showQueueMode: false,   // untuk Ketua: tampilkan panel pilih peserta
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
  //   LOAD PESERTA + STATUS + QUEUE
  // ============================================================
  async function loadPeserta() {
    if (!el.pesertaSelect) return;

    el.pesertaSelect.disabled = true;
    el.pesertaSelect.innerHTML = '<option value="">Memuat daftar peserta…</option>';

    try {
      const [pesertaRes, statusRes, queueRes] = await Promise.all([
        getPesertaList({ status: 'approved' }),
        getSignatureOrderStatus(),
        getSignatureQueue(),
      ]);

      const list = (pesertaRes && pesertaRes.data)
        ? pesertaRes.data
        : (Array.isArray(pesertaRes) ? pesertaRes : []);

      // ✅ FIX: normalize statusMap keys
      const rawStatusMap = (statusRes && statusRes.success && statusRes.data)
        ? statusRes.data
        : {};
      const statusMap = {};
      Object.keys(rawStatusMap).forEach(k => {
        const nk = normalizeKey(k);
        if (nk) statusMap[nk] = rawStatusMap[k];
      });
      state.statusMap = statusMap;

      // ✅ Queue list
      const queueList = (queueRes && queueRes.success && Array.isArray(queueRes.data))
        ? queueRes.data
        : [];
      state.queueList = queueList;

      // Build queue set
      const queueSet = {};
      queueList.forEach(q => {
        const qn = normalizeKey(q.peserta_nama);
        if (qn) queueSet[qn] = true;
      });

      const requiredRoles = REQUIRED_ROLES_BEFORE[ROLE] || [];

      // ✅ DEBUG LOG
      console.group(`[SignPage/${ROLE}] Filter Debug`);
      console.log('Total peserta approved:', list.length);
      console.log('Queue items:', queueList.length);
      console.log('Status map keys:', Object.keys(statusMap).length);

      // ✅ Filter eligible
      if (IS_KETUA) {
        // Ketua: eligible = approved + belum TTD ketua_pc
        state.eligibleList = list.filter(p => {
          const st = String(p.status || '').toLowerCase();
          if (st !== 'approved' && st !== 'active') return false;
          const key = normalizeKey(p.nama_lengkap);
          const row = statusMap[key] || {};
          return row[ROLE] !== true;
        });
      } else {
        // Sekretaris/Instruktur: eligible = in queue + prerequisite TTD + belum TTD role ini
        state.eligibleList = list.filter(p => {
          const st = String(p.status || '').toLowerCase();
          if (st !== 'approved' && st !== 'active') return false;

          const key = normalizeKey(p.nama_lengkap);
          const row = statusMap[key] || {};

          // HARUS di queue (kalau queue kosong, fallback ke _inQueue flag dari statusMap)
          const inQueue = row._inQueue === true || queueSet[key] === true;
          if (!inQueue) return false;

          // Sudah TTD role ini? skip
          if (row[ROLE] === true) return false;

          // HARUS sudah TTD semua prerequisite
          return requiredRoles.every(r => row[r] === true);
        });
      }

      console.log(`Eligible untuk ${ROLE}:`, state.eligibleList.length);
      console.log('Sample eligible:', state.eligibleList.slice(0, 3).map(p => p.nama_lengkap));
      console.groupEnd();

      // Build PAC groups
      state.pacGroups = {};
      state.eligibleList.forEach(p => {
        const pac = String(p.utusan || 'Tidak diketahui').trim() || 'Tidak diketahui';
        if (!state.pacGroups[pac]) state.pacGroups[pac] = [];
        state.pacGroups[pac].push(p);
      });

      renderPesertaDropdown();
      el.pesertaSelect.disabled = false;

      // ✅ Render queue panel untuk Ketua
      if (IS_KETUA) {
        renderKetuaQueuePanel(list, statusMap);
      }
    } catch (e) {
      console.error('[SignPage] loadPeserta error:', e);
      el.pesertaSelect.innerHTML = '<option value="">Gagal memuat peserta</option>';
      el.pesertaSelect.disabled = false;

      if (el.pesertaHint) {
        el.pesertaHint.innerHTML = '<i class="bi bi-exclamation-triangle text-danger" aria-hidden="true"></i> Gagal memuat data. Coba refresh halaman.';
      }
    }
  }

  // ============================================================
  //   RENDER PESERTA DROPDOWN
  // ============================================================
  function renderPesertaDropdown() {
    if (!el.pesertaSelect) return;

    // Empty state
    if (state.eligibleList.length === 0) {
      const empties = {
        ketua_pc:   '✅ Semua peserta sudah Anda tandatangani',
        sekretaris: '⏳ Menunggu Ketua PC memilih peserta / sudah selesai',
        instruktur: '⏳ Menunggu Ketua PC & Sekretaris',
      };
      el.pesertaSelect.innerHTML = `<option value="">${empties[ROLE] || 'Tidak ada peserta eligible'}</option>`;

      if (el.pesertaHint) {
        const hints = {
          ketua_pc:   '<i class="bi bi-check-circle text-success" aria-hidden="true"></i> Tidak ada peserta yang perlu TTD.',
          sekretaris: '<i class="bi bi-hourglass-split text-warning" aria-hidden="true"></i> Belum ada peserta siap Anda TTD. Pastikan <strong>Ketua PC</strong> sudah memilih peserta & menandatangani.',
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

    if (pacNames.length > 1) {
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
        sekretaris: `Tersedia <strong>${state.eligibleList.length} peserta</strong> (sudah dipilih & di-TTD Ketua PC). Pilih untuk TTD.`,
        instruktur: `Tersedia <strong>${state.eligibleList.length} peserta</strong> (sudah di-TTD Ketua PC &amp; Sekretaris). Pilih untuk TTD.`,
      };
      el.pesertaHint.innerHTML = hints[ROLE] || `Tersedia ${state.eligibleList.length} peserta.`;
    }
  }

  // ============================================================
  //   ⭐ RENDER KETUA QUEUE PANEL — v28.3.0 NEW
  //   Panel untuk Ketua pilih peserta → masukkan ke queue
  // ============================================================
  function renderKetuaQueuePanel(allPeserta, statusMap) {
    if (!IS_KETUA) return;

    // Cari container atau buat baru
    let panelEl = document.getElementById('ketuaQueuePanel');
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'ketuaQueuePanel';
      panelEl.className = 'glass-card mb-4';
      panelEl.style.cssText = 'padding:1.25rem;background:#fff;border-radius:16px;border:1px solid #e2e8f0;';

      // Insert setelah info-banner
      const infoBanner = document.querySelector('.info-banner');
      if (infoBanner && infoBanner.parentNode) {
        infoBanner.parentNode.insertBefore(panelEl, infoBanner.nextSibling);
      } else {
        // Fallback: prepend ke form parent
        const form = document.getElementById('signForm');
        if (form && form.parentNode) {
          form.parentNode.insertBefore(panelEl, form);
        }
      }
    }

    // Filter peserta yang belum di queue & belum TTD ketua
    const queueSet = {};
    state.queueList.forEach(q => {
      const qn = normalizeKey(q.peserta_nama);
      if (qn) queueSet[qn] = true;
    });

    const candidates = allPeserta.filter(p => {
      const st = String(p.status || '').toLowerCase();
      if (st !== 'approved' && st !== 'active') return false;
      const key = normalizeKey(p.nama_lengkap);
      const row = statusMap[key] || {};
      // Belum TTD ketua & belum di queue
      return row.ketua_pc !== true && queueSet[key] !== true;
    });

    const queueCount = state.queueList.length;

    let html = `
      <div class="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <h6 class="fw-bold mb-0" style="font-size:0.95rem;">
          <i class="bi bi-list-check text-primary me-2" aria-hidden="true"></i>
          Pilih Peserta untuk TTD
          <span class="badge bg-primary ms-2">${queueCount} di queue</span>
        </h6>
        <div class="d-flex gap-2">
          ${queueCount > 0 ? `
            <button type="button" class="btn btn-outline-danger btn-sm rounded-pill px-3" id="clearQueueBtn">
              <i class="bi bi-trash me-1"></i> Kosongkan Queue
            </button>
          ` : ''}
        </div>
      </div>
      <p class="small text-muted mb-3">
        Pilih peserta yang akan ditandatangani <strong>SEMUA role</strong> (Ketua PC → Sekretaris → Instruktur).
        Peserta yang dipilih akan muncul di dropdown Sekretaris & Instruktur.
      </p>
    `;

    // Queue list
    if (queueCount > 0) {
      html += `
        <div class="mb-3">
          <div class="small text-muted mb-2 text-uppercase fw-bold" style="letter-spacing:0.04em;font-size:0.7rem;">
            Peserta di Queue (${queueCount})
          </div>
          <div class="d-flex flex-wrap gap-2">
      `;
      state.queueList.slice(0, 20).forEach(q => {
        const safeNama = escapeHtml(q.peserta_nama || '-');
        html += `
          <span class="badge bg-primary-subtle text-primary d-inline-flex align-items-center gap-2 px-3 py-2" style="font-size:0.78rem;">
            ${safeNama}
            <button type="button" class="btn-close btn-close-sm" style="font-size:0.55rem;"
                    data-remove-queue="${safeNama}" aria-label="Hapus dari queue"></button>
          </span>
        `;
      });
      if (queueCount > 20) {
        html += `<span class="badge bg-secondary">+${queueCount - 20} lainnya</span>`;
      }
      html += `</div></div>`;
    }

    // Candidates list (multi-select)
    if (candidates.length === 0) {
      html += `
        <div class="alert alert-info small mb-0">
          <i class="bi bi-check-circle me-1" aria-hidden="true"></i>
          Semua peserta yang eligible sudah ada di queue / sudah Anda TTD.
        </div>
      `;
    } else {
      html += `
        <div class="mb-2 small text-muted text-uppercase fw-bold" style="letter-spacing:0.04em;font-size:0.7rem;">
          Peserta Tersedia (${candidates.length})
        </div>
        <div class="row g-2 mb-3" style="max-height:280px;overflow-y:auto;">
      `;
      candidates.forEach(p => {
        const safeNama = escapeHtml(p.nama_lengkap || '-');
        const safePac = escapeHtml(p.utusan || '-');
        html += `
          <div class="col-md-6 col-lg-4">
            <label class="d-flex align-items-center gap-2 p-2 rounded-3"
                   style="background:#f8fafc;border:1px solid #e2e8f0;cursor:pointer;">
              <input type="checkbox" class="form-check-input queue-candidate-checkbox"
                     value="${safeNama}" data-peserta-id="${escapeHtml(String(p.id || ''))}">
              <div style="min-width:0;flex:1;">
                <div class="fw-semibold small text-truncate" title="${safeNama}">${safeNama}</div>
                <div class="text-muted" style="font-size:0.7rem;">${safePac}</div>
              </div>
            </label>
          </div>
        `;
      });
      html += `</div>`;

      html += `
        <div class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn btn-success btn-sm rounded-pill px-4" id="addSelectedToQueueBtn" disabled>
            <i class="bi bi-plus-circle me-1"></i> Tambah ke Queue
            <span class="badge bg-white text-success ms-1" id="selectedCountBadge">0</span>
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill px-3" id="selectAllQueueBtn">
            <i class="bi bi-check-all me-1"></i> Pilih Semua
          </button>
        </div>
      `;
    }

    panelEl.innerHTML = html;

    // Bind: checkbox change → update badge
    const checkboxes = panelEl.querySelectorAll('.queue-candidate-checkbox');
    const badge = panelEl.querySelector('#selectedCountBadge');
    const addBtn = panelEl.querySelector('#addSelectedToQueueBtn');

    function updateSelectedCount() {
      const count = panelEl.querySelectorAll('.queue-candidate-checkbox:checked').length;
      if (badge) badge.textContent = String(count);
      if (addBtn) addBtn.disabled = count === 0;
    }

    checkboxes.forEach(cb => {
      cb.addEventListener('change', updateSelectedCount);
    });

    // Bind: tambah ke queue
    addBtn?.addEventListener('click', async () => {
      const selected = Array.from(panelEl.querySelectorAll('.queue-candidate-checkbox:checked'))
        .map(cb => ({
          peserta_nama: cb.value,
          peserta_id: cb.dataset.pesertaId || '',
        }));

      if (selected.length === 0) return;

      const btn = addBtn;
      const original = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Menambah...';

      try {
        const res = await addBulkToSignatureQueue(selected, ROLE);
        if (res && res.success) {
          showToast(`${res.added || selected.length} peserta ditambahkan ke queue`, 'success');
          await loadPeserta(); // reload
        } else {
          throw new Error((res && res.error) || 'Gagal menambah');
        }
      } catch (e) {
        showToast('Gagal: ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = original;
      }
    });

    // Bind: pilih semua
    panelEl.querySelector('#selectAllQueueBtn')?.addEventListener('click', () => {
      const all = panelEl.querySelectorAll('.queue-candidate-checkbox');
      const allChecked = Array.from(all).every(cb => cb.checked);
      all.forEach(cb => { cb.checked = !allChecked; });
      updateSelectedCount();
    });

    // Bind: hapus dari queue
    panelEl.querySelectorAll('[data-remove-queue]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        const nama = btn.dataset.removeQueue;
        try {
          await removeFromSignatureQueue(nama);
          showToast(`"${nama}" dihapus dari queue`, 'info');
          await loadPeserta();
        } catch (err) {
          showToast('Gagal: ' + err.message, 'error');
        }
      });
    });

    // Bind: kosongkan queue
    panelEl.querySelector('#clearQueueBtn')?.addEventListener('click', async () => {
      if (!confirm('Kosongkan seluruh queue?\n\nPeserta yang sudah di-TTD tidak akan terpengaruh.')) return;
      try {
        await clearSignatureQueue();
        showToast('Queue dikosongkan', 'success');
        await loadPeserta();
      } catch (e) {
        showToast('Gagal: ' + e.message, 'error');
      }
    });
  }

  // ============================================================
  //   PASSWORD VERIFY (debounced + token guard)
  // ============================================================
  function handlePasswordInput() {
    if (!el.passwordInput) return;

    clearTimeout(state.passwordCheckTimer);
    const pwd = el.passwordInput.value;

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

    if (el.passLiveHint) {
      el.passLiveHint.className = 'password-hint-live loading show';
      el.passLiveHint.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Memeriksa password…';
    }

    const myToken = ++state.passwordCheckToken;

    state.passwordCheckTimer = setTimeout(async () => {
      try {
        const res = await verifySignPassword(ROLE, pwd);

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

    // Bypass debounce race — verify langsung
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
  '%c Sign Page Shared v28.3.0 — Full Fix + Queue Edition ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
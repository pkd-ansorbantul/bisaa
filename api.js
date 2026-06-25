// api.js - Modul Terpadu Komunikasi Backend (PKD GP Ansor Bantul)
// Versi: 2.2.0 - Final Fix untuk subfolder /bisaa/
// =============================================================================

(function (global) {
  'use strict';

  // ======================== KONFIGURASI ========================
  // Ganti dengan URL Apps Script Anda yang benar
  // Anda bisa menimpa nilai ini dengan variabel global PKD_SCRIPT_URL
  const SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbxGeNBJzfTtRpr4fZty_Cm5wIbI7ax8ekFml0VarBHNZEvmGgSX96bdBrX3nkpleFQdyA/exec';
  const SCRIPT_URL = global.PKD_SCRIPT_URL || SCRIPT_URL_DEFAULT;

  // ======================== STATE ========================
  let userRole = null;
  let userData = {};

  // ======================== FUNGSI BANTU ========================
  function escapeHtml(unsafe) {
    if (unsafe == null) return '';
    return String(unsafe)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // ======================== TOAST NOTIFIKASI ========================
  function showToast(message, type = 'success') {
    let toastEl = document.getElementById('apiToast');
    if (!toastEl) {
      const container = document.createElement('div');
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.id = 'apiToastContainer';
      container.innerHTML = `
        <div id="apiToast" class="toast border-0 shadow-lg" role="alert" data-bs-delay="3000">
          <div class="toast-header bg-white border-0">
            <i class="bi me-2" id="apiToastIcon"></i>
            <strong class="me-auto" id="apiToastTitle">Berhasil</strong>
            <button type="button" class="btn-close" data-bs-dismiss="toast"></button>
          </div>
          <div class="toast-body" id="apiToastMessage"></div>
        </div>`;
      document.body.appendChild(container);
      toastEl = document.getElementById('apiToast');
    }

    document.getElementById('apiToastMessage').innerText = message;
    if (type === 'success') {
      toastEl.classList.add('border-success');
      toastEl.classList.remove('border-danger');
      document.getElementById('apiToastIcon').className = 'bi bi-check-circle-fill me-2 text-success';
      document.getElementById('apiToastTitle').innerText = 'Berhasil';
    } else {
      toastEl.classList.add('border-danger');
      toastEl.classList.remove('border-success');
      document.getElementById('apiToastIcon').className = 'bi bi-x-circle-fill me-2 text-danger';
      document.getElementById('apiToastTitle').innerText = 'Gagal';
    }
    if (typeof bootstrap !== 'undefined') {
      new bootstrap.Toast(toastEl).show();
    }
  }

  // ======================== PANGGILAN API (GET/POST) ========================
  function callApi(action, params = {}, method = 'GET', timeout = 30000) {
    const finalParams = { action, ...params };

    return new Promise(async (resolve, reject) => {
      if (method === 'GET') {
        try {
          const queryString = new URLSearchParams(finalParams).toString();
          const response = await fetch(`${SCRIPT_URL}?${queryString}`, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' }
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          return resolve(data);
        } catch (fetchError) {
          console.warn('Fetch GET gagal, fallback JSONP:', fetchError);
          // Fallback JSONP
          const callbackName = 'jsonp_cb_' + Date.now() + '_' + Math.random().toString(36).substring(7);
          const script = document.createElement('script');
          let isResolved = false;
          const timer = setTimeout(() => {
            if (!isResolved) {
              isResolved = true;
              if (document.head.contains(script)) document.head.removeChild(script);
              delete global[callbackName];
              reject(new Error('Timeout: Server tidak merespon JSONP'));
            }
          }, timeout);

          global[callbackName] = function (data) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              resolve(data || {});
            }
            delete global[callbackName];
            if (document.head.contains(script)) document.head.removeChild(script);
          };

          script.onerror = () => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              delete global[callbackName];
              if (document.head.contains(script)) document.head.removeChild(script);
              reject(new Error('Gagal memuat script JSONP'));
            }
          };

          const cleanParams = { ...finalParams };
          delete cleanParams.tandaTangan;
          delete cleanParams.signature;
          const qs = new URLSearchParams({ ...cleanParams, callback: callbackName }).toString();
          script.src = `${SCRIPT_URL}?${qs}`;
          document.head.appendChild(script);
        }
      } else {
        // POST
        try {
          const body = new URLSearchParams(finalParams);
          const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body
          });
          return resolve({ success: true, message: 'Request sent (no-cors)' });
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  // ======================== CACHE UTILS ========================
  function getCached(key, maxAge = 3600000) {
    try {
      const data = sessionStorage.getItem(key + '_data');
      const time = sessionStorage.getItem(key + '_time');
      if (data && time && (Date.now() - parseInt(time)) < maxAge) {
        return JSON.parse(data);
      }
    } catch (e) {}
    return null;
  }

  function saveCached(key, data) {
    try {
      sessionStorage.setItem(key + '_data', JSON.stringify(data));
      sessionStorage.setItem(key + '_time', Date.now().toString());
    } catch (e) {}
  }

  // ======================== AUTH ========================
  function persistAuthState() {
    const state = { role: userRole, data: userData };
    sessionStorage.setItem('pkd_auth', JSON.stringify(state));
    localStorage.setItem('pkd_auth', JSON.stringify(state));
  }

  function loadAuthState() {
    let serialized = sessionStorage.getItem('pkd_auth');
    if (!serialized) serialized = localStorage.getItem('pkd_auth');
    if (serialized) {
      try {
        const state = JSON.parse(serialized);
        userRole = state.role || null;
        userData = state.data || {};
      } catch (e) {}
    }
    updateNavbarMenu();
  }

  function logout() {
    userRole = null;
    userData = {};
    sessionStorage.removeItem('pkd_auth');
    localStorage.removeItem('pkd_auth');
    // Redirect ke halaman utama dengan prefix /bisaa/
    window.location.href = '/bisaa/index.html';
  }

  async function verifyAdmin(username, password) {
    const res = await callApi('verifyAdmin', { username, password }, 'GET');
    return res;
  }

  async function verifyKetuaPAC(username, password) {
    const res = await callApi('verifyKetuaPAC', { username, password }, 'GET');
    return res;
  }

  async function verifyMember(username, password) {
    const res = await callApi('verifyMember', { username, password }, 'GET');
    return res;
  }

  function updateNavbarMenu() {
    const menu = document.getElementById('navbarUserMenu');
    if (!menu) return;
    if (userRole === 'admin') {
      menu.innerHTML = `
        <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
          <i class="bi bi-shield-fill me-1"></i>Admin
        </span>
        <div class="dropdown">
          <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
            <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Admin')}
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="/bisaa/admin/dashboard_admin.html"><i class="bi bi-gear-wide me-2"></i>Dashboard</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="apiLogoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
          </ul>
        </div>`;
    } else if (userRole === 'ketua_pac') {
      menu.innerHTML = `
        <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
          <i class="bi bi-person-badge me-1"></i>Ketua PAC
        </span>
        <div class="dropdown">
          <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
            <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Ketua PAC')}
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="/bisaa/ketua_pac.html"><i class="bi bi-house-door me-2"></i>Dashboard Ketua PAC</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="apiLogoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
          </ul>
        </div>`;
    } else if (userRole === 'member') {
      menu.innerHTML = `
        <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
          <i class="bi bi-person-fill me-1"></i>Member
        </span>
        <div class="dropdown">
          <button class="btn btn-outline-primary rounded-pill px-4 dropdown-toggle" type="button" data-bs-toggle="dropdown">
            <i class="bi bi-person-circle me-1"></i> ${escapeHtml(userData.nama || 'Member')}
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li><a class="dropdown-item" href="/bisaa/member.html"><i class="bi bi-person-badge me-2"></i>Profil Saya</a></li>
            <li><hr class="dropdown-divider"></li>
            <li><button class="dropdown-item" id="apiLogoutBtn"><i class="bi bi-box-arrow-right me-2"></i>Logout</button></li>
          </ul>
        </div>`;
    } else {
      menu.innerHTML = `
        <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
          <i class="bi bi-person-circle me-1"></i>Guest
        </span>
        <button class="btn btn-outline-primary rounded-pill px-4" id="apiLoginBtn">Login</button>`;
    }

    document.getElementById('apiLogoutBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
    document.getElementById('apiLoginBtn')?.addEventListener('click', () => {
      window.location.href = '/bisaa/login.html';
    });
  }

  // ======================== DOMAIN FUNCTIONS (Tidak berubah) ========================
  // --- Peserta ---
  async function getPesertaList(forceRefresh = false) {
    const cacheKey = 'pesertaList';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getPesertaList', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function submitPeserta(formData) {
    return await callApi('submitPeserta', formData, 'POST');
  }

  async function deletePeserta(id) {
    return await callApi('deletePeserta', { id }, 'POST');
  }

  async function updatePeserta(formData) {
    return await callApi('updatePeserta', formData, 'POST');
  }

  async function exportPesertaCSV() {
    return await callApi('exportPesertaCSV', {}, 'GET');
  }

  async function importPesertaCSV(csvData, fileName) {
    return await callApi('importPesertaCSV', { csvData, fileName }, 'POST');
  }

  async function getTotalPeserta() {
    return await callApi('getTotalPeserta', {}, 'GET');
  }

  // --- Alumni ---
  async function getAlumniList(forceRefresh = false) {
    const cacheKey = 'alumniList';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getAlumniList', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function moveToAlumni(id) {
    return await callApi('moveToAlumni', { id }, 'POST');
  }

  async function moveMultipleToAlumni(ids) {
    return await callApi('moveMultipleToAlumni', { ids: JSON.stringify(ids) }, 'POST');
  }

  async function moveBackToActive(id) {
    return await callApi('moveBackToActive', { id }, 'POST');
  }

  // --- Sesi Absen ---
  async function getSesiAbsen(forceRefresh = false) {
    const cacheKey = 'sesiAbsen';
    if (!forceRefresh) {
      const c = getCached(cacheKey);
      if (c && Array.isArray(c) && c.length > 0) return c;
    }
    const res = await callApi('getSesiAbsen', {}, 'GET');
    const data = res.data || [];
    if (Array.isArray(data) && data.length > 0) {
      saveCached(cacheKey, data);
    }
    return data;
  }

  async function addSesiAbsen(nama, waktu, aktif, password) {
    return await callApi('addSesiAbsen', { nama, waktu, aktif, password }, 'POST');
  }

  async function updateSesiAbsen(id, nama, waktu, aktif, password) {
    return await callApi('updateSesiAbsen', { id, nama, waktu, aktif, password }, 'POST');
  }

  async function deleteSesiAbsen(id) {
    return await callApi('deleteSesiAbsen', { id }, 'POST');
  }

  async function regenerateQRSesi(id) {
    return await callApi('regenerateQRSesi', { id }, 'POST');
  }

  // --- Absensi ---
  async function submitAbsen(nama, sesiId, tandaTangan, password, qrToken) {
    return await callApi('submitAbsen', { nama, sesiId, tandaTangan, password, qrToken }, 'POST');
  }

  async function getAbsensiResponses(forceRefresh = false) {
    const cacheKey = 'absensiResponses';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getAbsensiResponses', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function getAttendanceBySesi(sesiId) {
    return await callApi('getAttendanceBySesi', { sesiId }, 'GET');
  }

  async function getAttendanceMatrix(forceRefresh = false) {
    const cacheKey = 'rekapAbsensi';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getAttendanceMatrix', {}, 'GET');
    const data = { peserta: res.peserta || [], sesi: res.sesi || [], hadirSet: new Set(res.hadirSet || []) };
    saveCached(cacheKey, data);
    return data;
  }

  async function exportAttendanceMatrixCSV() {
    return await callApi('exportAttendanceMatrixCSV', {}, 'GET');
  }

  // --- Skrining ---
  async function getSkriningQuestions(forceRefresh = false) {
    const cacheKey = 'skriningQuestions';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getSkriningQuestions', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addSkriningQuestion(teks, jenis, opsi, urutan) {
    return await callApi('addSkriningQuestion', { teks, jenis, opsi, urutan }, 'POST');
  }

  async function updateSkriningQuestion(id, teks, jenis, opsi, urutan) {
    return await callApi('updateSkriningQuestion', { id, teks, jenis, opsi, urutan }, 'POST');
  }

  async function deleteSkriningQuestion(id) {
    return await callApi('deleteSkriningQuestion', { id }, 'POST');
  }

  async function getSkriningResponses(forceRefresh = false) {
    const cacheKey = 'skriningResponses';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getSkriningResponses', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function submitSkrining(formData) {
    return await callApi('submitSkrining', formData, 'POST');
  }

  // --- Pretest ---
  async function getPretestQuestions(forceRefresh = false) {
    const cacheKey = 'pretestSoal';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getPretestQuestions', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addPretestQuestion(teks, opsi, jawaban, urutan, timer_enabled = false, timer_duration = 30) {
    return await callApi('addPretestQuestion', { teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST');
  }

  async function updatePretestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return await callApi('updatePretestQuestion', { id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST');
  }

  async function deletePretestQuestion(id) {
    return await callApi('deletePretestQuestion', { id }, 'POST');
  }

  async function getPretestResponses(forceRefresh = false) {
    const cacheKey = 'pretestResponses';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getPretestResponses', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function submitPretest(nama, nohp, alamat, answers, score) {
    return await callApi('submitPretest', { nama, nohp, alamat, answers, score }, 'POST');
  }

  // --- Posttest ---
  async function getPosttestQuestions(forceRefresh = false) {
    const cacheKey = 'posttestSoal';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getPosttestQuestions', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addPosttestQuestion(teks, opsi, jawaban, urutan, timer_enabled = false, timer_duration = 30) {
    return await callApi('addPosttestQuestion', { teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST');
  }

  async function updatePosttestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return await callApi('updatePosttestQuestion', { id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST');
  }

  async function deletePosttestQuestion(id) {
    return await callApi('deletePosttestQuestion', { id }, 'POST');
  }

  async function getPosttestResponses(forceRefresh = false) {
    const cacheKey = 'posttestResponses';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getPosttestResponses', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function submitPosttest(nama, nohp, alamat, answers, score) {
    return await callApi('submitPosttest', { nama, nohp, alamat, answers, score }, 'POST');
  }

  // --- Materi ---
  async function getMateriList(forceRefresh = false) {
    const cacheKey = 'materiList';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getMateriList', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addMateri(judul, deskripsi, fileData, fileName, uploadBy) {
    return await callApi('addMateri', { judul, deskripsi, fileData, fileName, uploadBy }, 'POST');
  }

  async function deleteMateri(id, fileId) {
    return await callApi('deleteMateri', { id, fileId }, 'POST');
  }

  // --- Informasi ---
  async function getInfoList(forceRefresh = false) {
    const cacheKey = 'adminInfoCache';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getInfoList', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addInfo(jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName) {
    return await callApi('addInfo', { jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName }, 'POST');
  }

  async function updateInfo(id, jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName) {
    return await callApi('updateInfo', { id, jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName }, 'POST');
  }

  async function deleteInfo(id) {
    return await callApi('deleteInfo', { id }, 'POST');
  }

  async function toggleInfoStatus(id) {
    return await callApi('toggleInfoStatus', { id }, 'POST');
  }

  // --- Usulan ---
  async function getUsulanList() {
    return await callApi('getUsulanList', {}, 'GET');
  }

  async function updateUsulanStatus(id, status, adminName) {
    return await callApi('updateUsulanStatus', { id, status, adminName }, 'POST');
  }

  async function submitUsulan(formData) {
    return await callApi('submitUsulan', formData, 'POST');
  }

  // --- Sertifikat ---
  async function getCertificateTemplates(forceRefresh = false) {
    const cacheKey = 'certTemplates';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getCertificateTemplates', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function getCertPresets(forceRefresh = false) {
    const cacheKey = 'certPresets';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getCertPresets', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function addCertPreset(name, config) {
    return await callApi('addCertPreset', { name, config }, 'POST');
  }

  async function updateCertPreset(id, name, config) {
    return await callApi('updateCertPreset', { id, name, config }, 'POST');
  }

  async function deleteCertPreset(id) {
    return await callApi('deleteCertPreset', { id }, 'POST');
  }

  async function addCertificateTemplateManual(nama_template, doc_template_id, config) {
    return await callApi('addCertificateTemplateManual', { nama_template, doc_template_id, config }, 'POST');
  }

  async function updateCertificateTemplate(id, nama_template, doc_template_id, config) {
    return await callApi('updateCertificateTemplate', { id, nama_template, doc_template_id, config }, 'POST');
  }

  async function deleteCertificateTemplate(id) {
    return await callApi('deleteCertificateTemplate', { id }, 'POST');
  }

  async function generateCertificates(templateId, presetId, participants, startNumber, customData = {}) {
    return await callApi('generateCertificates', {
      templateId,
      presetId,
      participants: JSON.stringify(participants),
      startNumber,
      customData: JSON.stringify(customData)
    }, 'POST');
  }

  async function getUploadedCertificates(forceRefresh = false) {
    const cacheKey = 'uploadedCerts';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getUploadedCertificates', {}, 'GET');
    const data = res.data || [];
    saveCached(cacheKey, data);
    return data;
  }

  async function uploadManualCertificate(pesertaId, nomorSertifikat, fileData) {
    return await callApi('uploadManualCertificate', { pesertaId, nomorSertifikat, fileData }, 'POST');
  }

  async function verifyCertificate(nomor) {
    return await callApi('verifyCertificate', { nomor }, 'GET');
  }

  // --- Tanda Tangan Digital ---
  async function submitDigitalSignature(role, nama, signature, password) {
    return await callApi('submitDigitalSignature', { role, nama, signature, password }, 'POST');
  }

  async function getDigitalApproval(role) {
    return await callApi('getDigitalApproval', { role }, 'GET');
  }

  async function getAllDigitalApprovals() {
    return await callApi('getAllDigitalApprovals', {}, 'GET');
  }

  // --- Pengaturan ---
  async function getQuizSettings(forceRefresh = false) {
    const cacheKey = 'quizSettings';
    if (!forceRefresh) { const c = getCached(cacheKey); if (c) return c; }
    const res = await callApi('getQuizSettings', {}, 'GET');
    const data = res.data || {};
    saveCached(cacheKey, data);
    return data;
  }

  async function getLoginMode() {
    const cacheKey = 'loginMode';
    const c = getCached(cacheKey, 300000);
    if (c) return c;
    const res = await callApi('getLoginMode', {}, 'GET');
    saveCached(cacheKey, res);
    return res;
  }

  async function setLoginMode(enabled) {
    return await callApi('setLoginMode', { enabled }, 'POST');
  }

  async function getDashboardStats() {
    return await callApi('getDashboardStats', {}, 'GET');
  }

  async function getRealtimeSetting() {
    return await callApi('getRealtimeSetting', {}, 'GET');
  }

  async function setRealtimeSetting(enabled) {
    return await callApi('setRealtimeSetting', { enabled }, 'POST');
  }

  // --- Member ---
  async function getMemberData(username) {
    return await callApi('getMemberData', { username }, 'GET');
  }

  async function getMemberSkrining(nama) {
    return await callApi('getMemberSkrining', { nama }, 'GET');
  }

  async function getMemberAbsensi(nama) {
    return await callApi('getMemberAbsensi', { nama }, 'GET');
  }

  async function getMemberSertifikat(nama) {
    return await callApi('getMemberSertifikat', { nama }, 'GET');
  }

  async function updateMemberProfile(username, nama_lengkap, email, nohp, password, foto) {
    return await callApi('updateMemberProfile', {
      username,
      nama_lengkap,
      email,
      no_hp: nohp,
      password,
      foto
    }, 'POST');
  }

  // --- Kontak ---
  async function submitKontak(nama, email, pesan, username, role, ip) {
    return await callApi('submitKontak', { nama, email, pesan, username, role, ip }, 'GET');
  }

  // ======================== SIDEBAR HANDLER ========================
  function initSidebar() {
    const toggleBtn = document.getElementById('toggleSidebarBtn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        const row = document.querySelector('.row.g-4');
        if (row) row.classList.toggle('sidebar-minimized');
        const icon = this.querySelector('i');
        if (icon) {
          icon.classList.toggle('bi-arrow-left-right');
          icon.classList.toggle('bi-arrow-right-left');
        }
      });
    }

    const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
    if (sidebarLogoutBtn) {
      sidebarLogoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
      });
    }
  }

  // ======================== CHECK LOGIN MODE ========================
  async function checkLoginModeAndRedirect() {
    try {
      const res = await getLoginMode();
      const requireLogin = res.success ? res.enabled : false;
      if (requireLogin) {
        const auth = localStorage.getItem('pkd_auth') || sessionStorage.getItem('pkd_auth');
        if (!auth && !userRole) {
          window.location.href = '/bisaa/login.html';
          return;
        }
      }
    } catch (e) {
      console.warn('Gagal cek login mode, lanjutkan', e);
    }
  }

  // ======================== NAVBAR COLLAPSE ========================
  function initNavbarCollapse() {
    document.addEventListener('click', function (e) {
      const navbar = document.getElementById('navbarMain');
      const toggler = document.querySelector('.navbar-toggler');
      if (navbar && toggler && !navbar.contains(e.target) && !toggler.contains(e.target) && navbar.classList.contains('show')) {
        if (typeof bootstrap !== 'undefined') {
          bootstrap.Collapse.getInstance(navbar)?.hide();
        }
      }
    });
  }

  // ======================== EKSPOR MODUL ========================
  global.PKD = {
    // Config
    SCRIPT_URL,

    // State
    getUserRole: () => userRole,
    getUserData: () => userData,
    setUserRole: (role) => { userRole = role; },
    setUserData: (data) => { userData = data; },

    // Utils
    escapeHtml,
    showToast,
    callApi,

    // Cache
    getCached,
    saveCached,

    // Auth
    persistAuthState,
    loadAuthState,
    logout,
    verifyAdmin,
    verifyKetuaPAC,
    verifyMember,
    updateNavbarMenu,

    // Peserta
    getPesertaList,
    submitPeserta,
    deletePeserta,
    updatePeserta,
    exportPesertaCSV,
    importPesertaCSV,
    getTotalPeserta,

    // Alumni
    alumni: {
      getList: getAlumniList,
      moveToAlumni: moveToAlumni,
      moveMultipleToAlumni: moveMultipleToAlumni,
      moveBackToActive: moveBackToActive
    },

    // Sesi Absen
    getSesiAbsen,
    addSesiAbsen,
    updateSesiAbsen,
    deleteSesiAbsen,
    regenerateQRSesi,

    // Absensi
    submitAbsen,
    getAbsensiResponses,
    getAttendanceBySesi,
    getAttendanceMatrix,
    exportAttendanceMatrixCSV,

    // Skrining
    getSkriningQuestions,
    addSkriningQuestion,
    updateSkriningQuestion,
    deleteSkriningQuestion,
    getSkriningResponses,
    submitSkrining,

    // Pretest
    getPretestQuestions,
    addPretestQuestion,
    updatePretestQuestion,
    deletePretestQuestion,
    getPretestResponses,
    submitPretest,

    // Posttest
    getPosttestQuestions,
    addPosttestQuestion,
    updatePosttestQuestion,
    deletePosttestQuestion,
    getPosttestResponses,
    submitPosttest,

    // Materi
    getMateriList,
    addMateri,
    deleteMateri,

    // Info
    getInfoList,
    addInfo,
    updateInfo,
    deleteInfo,
    toggleInfoStatus,
    getUsulanList,
    updateUsulanStatus,
    submitUsulan,

    // Sertifikat
    getCertificateTemplates,
    getCertPresets,
    addCertPreset,
    updateCertPreset,
    deleteCertPreset,
    addCertificateTemplateManual,
    updateCertificateTemplate,
    deleteCertificateTemplate,
    generateCertificates,
    getUploadedCertificates,
    uploadManualCertificate,
    verifyCertificate,

    // Tanda Tangan Digital
    submitDigitalSignature,
    getDigitalApproval,
    getAllDigitalApprovals,

    // Pengaturan
    getQuizSettings,
    getLoginMode,
    setLoginMode,
    getDashboardStats,
    getRealtimeSetting,
    setRealtimeSetting,

    // Member
    getMemberData,
    getMemberSkrining,
    getMemberAbsensi,
    getMemberSertifikat,
    updateMemberProfile,

    // Kontak
    submitKontak,

    // UI Helpers
    initSidebar,
    initNavbarCollapse,
    checkLoginModeAndRedirect
  };

  // ======================== AUTO INIT ========================
  document.addEventListener('DOMContentLoaded', () => {
    loadAuthState();
    initSidebar();
    initNavbarCollapse();
    checkLoginModeAndRedirect();
  });

})(window);
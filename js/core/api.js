// js/core/api.js
// Modul API Terpadu untuk PKD GP Ansor Bantul (ES Module)
// Versi: 9.0.3 - Fix submitAbsen with needSignature support
// ============================================================

import { SCRIPT_URL, DEFAULT_CACHE_AGE, APP_NAME, BASE_PATH } from './config.js';

// =============================== AUTH STATE ===============================
let userRole = null;
let userData = {};

// =============================== UTILITY ===============================
export function escapeHtml(unsafe) {
  if (unsafe == null) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function showToast(message, type = 'success') {
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
  const icon = document.getElementById('apiToastIcon');
  const title = document.getElementById('apiToastTitle');
  if (type === 'success') {
    icon.className = 'bi bi-check-circle-fill text-success';
    title.innerText = 'Berhasil';
  } else if (type === 'error') {
    icon.className = 'bi bi-x-circle-fill text-danger';
    title.innerText = 'Gagal';
  } else {
    icon.className = 'bi bi-info-circle-fill text-primary';
    title.innerText = 'Info';
  }
  if (typeof bootstrap !== 'undefined') {
    new bootstrap.Toast(toastEl).show();
  }
}

export function getUserRole() { return userRole; }
export function getUserData() { return userData; }
export function setUserRole(role) { userRole = role; }
export function setUserData(data) { userData = data; }

export function persistAuthState() {
  const state = { role: userRole, data: userData };
  try {
    sessionStorage.setItem('pkd_auth', JSON.stringify(state));
    localStorage.setItem('pkd_auth', JSON.stringify(state));
  } catch (e) {}
}

export function loadAuthState() {
  const serialized = sessionStorage.getItem('pkd_auth') || localStorage.getItem('pkd_auth');
  if (serialized) {
    try {
      const state = JSON.parse(serialized);
      userRole = state.role || null;
      userData = state.data || {};
    } catch (e) {}
  }
  updateNavbarMenu();
}

export function logout() {
  userRole = null;
  userData = {};
  sessionStorage.removeItem('pkd_auth');
  localStorage.removeItem('pkd_auth');
  window.location.href = BASE_PATH + 'index.html';
}

export function updateNavbarMenu() {
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
          <li><a class="dropdown-item" href="${BASE_PATH}admin/dashboard_admin.html"><i class="bi bi-gear-wide me-2"></i>Dashboard</a></li>
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
          <li><a class="dropdown-item" href="${BASE_PATH}ketua_pac.html"><i class="bi bi-house-door me-2"></i>Dashboard Ketua PAC</a></li>
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
          <li><a class="dropdown-item" href="${BASE_PATH}member.html"><i class="bi bi-person-badge me-2"></i>Profil Saya</a></li>
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

  document.getElementById('apiLogoutBtn')?.addEventListener('click', function (e) {
    e.preventDefault();
    logout();
  });
  document.getElementById('apiLoginBtn')?.addEventListener('click', function () {
    window.location.href = BASE_PATH + 'login.html';
  });
}

// =============================== CACHE ===============================
export function getCache(key, maxAgeMinutes = DEFAULT_CACHE_AGE) {
  try {
    const item = localStorage.getItem('pkd_cache_' + key);
    if (!item) return null;
    const { data, timestamp } = JSON.parse(item);
    if ((Date.now() - timestamp) > maxAgeMinutes * 60 * 1000) {
      localStorage.removeItem('pkd_cache_' + key);
      return null;
    }
    return data;
  } catch (e) { return null; }
}

export function setCache(key, data) {
  try {
    localStorage.setItem('pkd_cache_' + key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch (e) { /* ignore */ }
}

export function clearCache(key = null) {
  try {
    if (key) {
      localStorage.removeItem('pkd_cache_' + key);
    } else {
      Object.keys(localStorage)
        .filter(k => k.startsWith('pkd_cache_'))
        .forEach(k => localStorage.removeItem(k));
    }
  } catch (e) { /* ignore */ }
}

export async function fetchWithCache(action, params = {}, cacheKey, maxAgeMinutes = DEFAULT_CACHE_AGE, forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCache(cacheKey, maxAgeMinutes);
    if (cached) return cached;
  }
  const result = await callApi(action, params, 'GET');
  if (result && result.success === true && result.data !== undefined) {
    setCache(cacheKey, result.data);
    return result.data;
  } else if (Array.isArray(result)) {
    setCache(cacheKey, result);
    return result;
  }
  return null;
}

// =============================== CORE API ===============================
export function callApi(action, params = {}, method = 'GET', timeout = 30000) {
  params = params || {};
  method = method || 'GET';
  timeout = timeout || 30000;
  const finalParams = { action: action, ...params };

  return new Promise(function (resolve, reject) {
    try {
      let url = SCRIPT_URL;
      
      if (method === 'GET') {
        const qs = new URLSearchParams(finalParams).toString();
        url += '?' + qs;
        fetch(url, {
          method: 'GET',
          mode: 'cors',
          headers: { 'Accept': 'application/json' }
        })
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(data => resolve(data))
        .catch(fetchError => {
          console.error('Fetch GET gagal, fallback ke JSONP:', fetchError);
          let callbackName = 'jsonp_cb_' + Date.now();
          let script = document.createElement('script');
          let isResolved = false;
          let timer = setTimeout(function () {
            if (!isResolved) {
              isResolved = true;
              if (document.head.contains(script)) document.head.removeChild(script);
              delete window[callbackName];
              reject(new Error('Timeout: Server tidak merespon JSONP'));
            }
          }, timeout);

          window[callbackName] = function (data) {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              resolve(data || {});
            }
            delete window[callbackName];
            if (document.head.contains(script)) document.head.removeChild(script);
          };

          script.onerror = function () {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timer);
              delete window[callbackName];
              if (document.head.contains(script)) document.head.removeChild(script);
              reject(new Error('Gagal memuat script JSONP'));
            }
          };

          let cleanParams = { action: action };
          for (let k in params) {
            if (k !== 'tandaTangan' && k !== 'signature' && k !== 'fileData' && params.hasOwnProperty(k)) {
              cleanParams[k] = params[k];
            }
          }
          let qs = new URLSearchParams({ callback: callbackName });
          for (let kk in cleanParams) {
            if (cleanParams.hasOwnProperty(kk)) qs.append(kk, cleanParams[kk]);
          }
          script.src = SCRIPT_URL + '?' + qs.toString();
          document.head.appendChild(script);
        });
      } else if (method === 'POST') {
        const formData = new FormData();
        for (let key in finalParams) {
          formData.append(key, finalParams[key]);
        }
        fetch(url, {
          method: 'POST',
          body: formData
        })
        .then(response => {
          if (!response.ok) throw new Error('HTTP ' + response.status);
          return response.json();
        })
        .then(data => resolve(data))
        .catch(err => {
          console.error('Fetch POST gagal:', err);
          reject(err);
        });
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function guardPublicAccess() {
  try {
    const loginModeRes = await callApi('getLoginMode', {}, 'GET');
    const requireLogin = loginModeRes.success ? loginModeRes.enabled : false;
    if (requireLogin) {
      const role = getUserRole();
      if (!role || role === 'guest' || role === null) {
        const currentPage = window.location.pathname.split('/').pop();
        window.location.href = BASE_PATH + 'login.html?redirect=' + encodeURIComponent(currentPage);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('Gagal mengecek login mode, fallback ke akses publik:', e);
    return true;
  }
}

// =============================== WRAPPER FUNCTIONS ===============================

// --- Autentikasi ---
export function verifyAdmin(username, password) { return callApi('verifyAdmin', { username, password }, 'GET'); }
export function verifyKetuaPAC(username, password) { return callApi('verifyKetuaPAC', { username, password }, 'GET'); }
export function verifyMember(username, password) { return callApi('verifyMember', { username, password }, 'GET'); }

// --- Peserta ---
export function getPesertaList(status) { const params = {}; if (status !== undefined) params.status = status; return callApi('getPesertaList', params, 'GET'); }
export function submitPeserta(formData) { return callApi('submitPeserta', formData, 'POST'); }
export function deletePeserta(id) { return callApi('deletePeserta', { id }, 'POST'); }
export function updatePeserta(formData) { return callApi('updatePeserta', formData, 'POST'); }
export function approvePeserta(id) { return callApi('approvePeserta', { id }, 'POST'); }
export function rejectPeserta(id) { return callApi('rejectPeserta', { id }, 'POST'); }
export function getPesertaById(id) { return callApi('getPesertaById', { id }, 'GET'); }
export function getPesertaCredentials(id) { return callApi('getPesertaCredentials', { id }, 'GET'); }
export function getTotalPeserta() { return callApi('getTotalPeserta', {}, 'GET'); }
export function getAlumniList() { return callApi('getAlumniList', {}, 'GET'); }
export function moveToAlumni(id) { return callApi('moveToAlumni', { id }, 'POST'); }
export function moveMultipleToAlumni(ids) { return callApi('moveMultipleToAlumni', { ids }, 'POST'); }
export function moveBackToActive(id) { return callApi('moveBackToActive', { id }, 'POST'); }

// --- Absensi ---
export function getSesiAbsen() { return callApi('getSesiAbsen', {}, 'GET'); }
export function addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) { return callApi('addSesiAbsen', { nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password }, 'POST'); }
export function updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) { return callApi('updateSesiAbsen', { id, nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password }, 'POST'); }
export function deleteSesiAbsen(id) { return callApi('deleteSesiAbsen', { id }, 'POST'); }
export function regenerateQRSesi(id) { return callApi('regenerateQRSesi', { id }, 'POST'); }
export function toggleAttendanceSession(id, open) { return callApi('toggleAttendanceSession', { id, open }, 'POST'); }
export function getAttendanceSessionStatus(id) { return callApi('getAttendanceSessionStatus', { id }, 'GET'); }

// 🔥 submitAbsen – pastikan parameter tandaTangan dikirim
export function submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
  return callApi('submitAbsen', { nama, sesiId, tandaTangan, password, qrToken, pesertaId }, 'POST');
}

export function getAbsensiResponses() { return callApi('getAbsensiResponses', {}, 'GET'); }
export function getAttendanceBySesi(sesiId) { return callApi('getAttendanceBySesi', { sesiId }, 'GET'); }
export function getAttendanceMatrix() { return callApi('getAttendanceMatrix', {}, 'GET'); }

// --- Skrining ---
export function getSkriningQuestions() { return callApi('getSkriningQuestions', {}, 'GET'); }
export function addSkriningQuestion(teks, jenis, opsi, urutan) { return callApi('addSkriningQuestion', { teks, jenis, opsi, urutan }, 'POST'); }
export function updateSkriningQuestion(id, teks, jenis, opsi, urutan) { return callApi('updateSkriningQuestion', { id, teks, jenis, opsi, urutan }, 'POST'); }
export function deleteSkriningQuestion(id) { return callApi('deleteSkriningQuestion', { id }, 'POST'); }
export function submitSkrining(formData) { return callApi('submitSkrining', formData, 'POST'); }
export function getSkriningResponses() { return callApi('getSkriningResponses', {}, 'GET'); }

// --- Pretest ---
export function getPretestQuestions() { return callApi('getPretestQuestions', {}, 'GET'); }
export function addPretestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) { return callApi('addPretestQuestion', { teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST'); }
export function updatePretestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) { return callApi('updatePretestQuestion', { id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST'); }
export function deletePretestQuestion(id) { return callApi('deletePretestQuestion', { id }, 'POST'); }
export function submitPretest(nama, nohp, alamat, answers, score) { return callApi('submitPretest', { nama, nohp, alamat, answers, score }, 'POST'); }
export function getPretestResponses() { return callApi('getPretestResponses', {}, 'GET'); }

// --- Posttest ---
export function getPosttestQuestions() { return callApi('getPosttestQuestions', {}, 'GET'); }
export function addPosttestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) { return callApi('addPosttestQuestion', { teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST'); }
export function updatePosttestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) { return callApi('updatePosttestQuestion', { id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration }, 'POST'); }
export function deletePosttestQuestion(id) { return callApi('deletePosttestQuestion', { id }, 'POST'); }
export function submitPosttest(nama, nohp, alamat, answers, score) { return callApi('submitPosttest', { nama, nohp, alamat, answers, score }, 'POST'); }
export function getPosttestResponses() { return callApi('getPosttestResponses', {}, 'GET'); }

// --- Materi ---
export function getMateriList() { return callApi('getMateriList', {}, 'GET'); }
export function addMateri(judul, deskripsi, fileData, fileName, uploadBy) { return callApi('addMateri', { judul, deskripsi, fileData, fileName, uploadBy }, 'POST'); }
export function deleteMateri(id, fileId) { return callApi('deleteMateri', { id, fileId }, 'POST'); }

// --- Informasi ---
export function getInfoList() { return callApi('getInfoList', {}, 'GET'); }
export function addInfo(params) { return callApi('addInfo', params, 'POST'); }
export function updateInfo(params) { return callApi('updateInfo', params, 'POST'); }
export function deleteInfo(id) { return callApi('deleteInfo', { id }, 'POST'); }
export function toggleInfoStatus(id) { return callApi('toggleInfoStatus', { id }, 'POST'); }

// --- Usulan ---
export function getUsulanList() { return callApi('getUsulanList', {}, 'GET'); }
export function submitUsulan(formData) { return callApi('submitUsulan', formData, 'POST'); }
export function updateUsulanStatus(id, status) { return callApi('updateUsulanStatus', { id, status }, 'POST'); }

// --- Sertifikat ---
export function getCertificateTemplates() { return callApi('getCertificateTemplates', {}, 'GET'); }
export function getCertPresets() { return callApi('getCertPresets', {}, 'GET'); }
export function addCertPreset(name, config) { return callApi('addCertPreset', { name, config }, 'POST'); }
export function updateCertPreset(id, name, config) { return callApi('updateCertPreset', { id, name, config }, 'POST'); }
export function deleteCertPreset(id) { return callApi('deleteCertPreset', { id }, 'POST'); }
export function addCertificateTemplateManual(nama_template, doc_template_id, config) { return callApi('addCertificateTemplateManual', { nama_template, doc_template_id, config }, 'POST'); }
export function updateCertificateTemplate(id, nama_template, doc_template_id, config) { return callApi('updateCertificateTemplate', { id, nama_template, doc_template_id, config }, 'POST'); }
export function deleteCertificateTemplate(id) { return callApi('deleteCertificateTemplate', { id }, 'POST'); }
export function generateCertificates(templateId, presetId, participants, startNumber, customData) { return callApi('generateCertificates', { templateId, presetId, participants: JSON.stringify(participants), startNumber, customData: JSON.stringify(customData || {}) }, 'POST'); }
export function getUploadedCertificates() { return callApi('getUploadedCertificates', {}, 'GET'); }
export function uploadManualCertificate(pesertaId, nomorSertifikat, fileData) { return callApi('uploadManualCertificate', { pesertaId, nomorSertifikat, fileData }, 'POST'); }
export function verifyCertificate(nomor) { return callApi('verifyCertificate', { nomor }, 'GET'); }
export function getNextCertificateNumber() { return callApi('getNextCertificateNumber', {}, 'GET'); }
export function saveCertificateLayout(nama, data_json, id) { return callApi('saveCertificateLayout', { nama, data_json, id }, 'POST'); }
export function getCertificateLayout(identifier) { return callApi('getCertificateLayout', { id: identifier, nama: identifier }, 'GET'); }
export function listCertificateLayouts() { return callApi('listCertificateLayouts', {}, 'GET'); }

// --- Tanda Tangan Digital ---
export function submitDigitalSignature(role, nama, signature, password) { return callApi('submitDigitalSignature', { role, nama, signature, password }, 'POST'); }
export function getDigitalApproval(role) { return callApi('getDigitalApproval', { role }, 'GET'); }
export function getAllDigitalApprovals() { return callApi('getAllDigitalApprovals', {}, 'GET'); }
export function updateSignPassword(role, newPassword) { return callApi('updateSignPassword', { role, newPassword }, 'POST'); }
export function getSignPasswords() { return callApi('getSignPasswords', {}, 'GET'); }

// --- RTL ---
export function getRTLTasks(pesertaId) { return callApi('getRTLTasks', { pesertaId }, 'GET'); }
export function addRTLTask(params) { return callApi('addRTLTask', params, 'POST'); }
export function updateRTLTask(params) { return callApi('updateRTLTask', params, 'POST'); }
export function deleteRTLTask(id) { return callApi('deleteRTLTask', { id }, 'POST'); }
export function submitRTLAttachment(taskId, fileData, fileName) { return callApi('submitRTLAttachment', { taskId, fileData, fileName }, 'POST'); }
export function getRTLAttachments(taskId) { return callApi('getRTLAttachments', { taskId }, 'GET'); }
export function approveRTLTask(id) { return callApi('approveRTLTask', { id }, 'POST'); }
export function approveAllRTL(pesertaId) { return callApi('approveAllRTL', { pesertaId }, 'POST'); }
export function getRTLStatus(pesertaId) { return callApi('getRTLStatus', { pesertaId }, 'GET'); }

// --- Kader ---
export function getKaderList() { return callApi('getKaderList', {}, 'GET'); }
export function addKader(params) { return callApi('addKader', params, 'POST'); }
export function updateKader(params) { return callApi('updateKader', params, 'POST'); }
export function deleteKader(id) { return callApi('deleteKader', { id }, 'POST'); }

// --- Pengaturan ---
export function getQuizSettings() { return callApi('getQuizSettings', {}, 'GET'); }
export function setQuizSettings(params) { return callApi('setQuizSettings', params, 'POST'); }
export function getLoginMode() { return callApi('getLoginMode', {}, 'GET'); }
export function setLoginMode(enabled) { return callApi('setLoginMode', { enabled }, 'POST'); }
export function getPublicVisibility() { return callApi('getPublicVisibility', {}, 'GET'); }
export function setPublicVisibility(data) { return callApi('setPublicVisibility', { data: JSON.stringify(data) }, 'POST'); }
export function getDashboardStats() { return callApi('getDashboardStats', {}, 'GET'); }
export function getRealtimeSetting() { return callApi('getRealtimeSetting', {}, 'GET'); }
export function setRealtimeSetting(enabled) { return callApi('setRealtimeSetting', { enabled }, 'POST'); }
export function getFormSettings() { return callApi('getFormSettings', {}, 'GET'); }
export function setFormSettings(fields) { return callApi('setFormSettings', { fields: JSON.stringify(fields) }, 'POST'); }
export function getPKDLokasi() { return callApi('getPKDLokasi', {}, 'GET'); }
export function setPKDLokasi(lokasi) { return callApi('setPKDLokasi', { lokasi }, 'POST'); }

// --- Member ---
export function getMemberData(username) { return callApi('getMemberData', { username }, 'GET'); }
export function updateMemberProfile(username, data) { return callApi('updateMemberProfile', { username, ...data }, 'POST'); }
export function getMemberSkrining(nama) { return callApi('getMemberSkrining', { nama }, 'GET'); }
export function getMemberAbsensi(nama) { return callApi('getMemberAbsensi', { nama }, 'GET'); }
export function getMemberSertifikat(nama) { return callApi('getMemberSertifikat', { nama }, 'GET'); }
export function getMemberUsername(params) { return callApi('getMemberUsername', params, 'GET'); }
export function verifyMemberForgot(params) { return callApi('verifyMemberForgot', params, 'GET'); }
export function resetMemberPassword(params) { return callApi('resetMemberPassword', params, 'POST'); }

// --- Aset Digital ---
export function getAssetList() { return callApi('getAssetList', {}, 'GET'); }
export function addAsset(params) { return callApi('addAsset', params, 'POST'); }
export function deleteAsset(id) { return callApi('deleteAsset', { id }, 'POST'); }
export function getFolders() { return callApi('getFolders', {}, 'GET'); }
export function addFolder(nama, parentId) { return callApi('addFolder', { nama, parentId }, 'POST'); }
export function deleteFolder(id) { return callApi('deleteFolder', { id }, 'POST'); }

// --- Generate Sertifikat per Peserta ---
export function generateCertificateForParticipant(templateId, pesertaId) {
  return callApi('generateCertificateForParticipant', { templateId, pesertaId }, 'POST');
}

// --- Kontak ---
export function submitKontak(nama, email, pesan, username, role, ip) {
  return callApi('submitKontak', { nama, email, pesan, username, role, ip }, 'GET');
}

// =============================== INIT ===============================
if (typeof document !== 'undefined') {
  loadAuthState();
}
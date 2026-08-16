// js/core/api.js
// Core API untuk PKD GP Ansor Bantul - ES Module
// Versi: 13.0.2 - FULL FIX: Semua ekspor fungsi tersedia, Clean Parameters robust
// ============================================================

import { SCRIPT_URL, BASE_PATH } from './config.js';

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
  let html = '';
  if (userRole === 'admin') {
    html = `
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
  } else {
    html = `
      <span class="badge bg-light text-dark px-3 py-2 rounded-pill me-2">
        <i class="bi bi-person-circle me-1"></i>Guest
      </span>
      <button class="btn btn-outline-primary rounded-pill px-4" id="apiLoginBtn">Login</button>`;
  }
  menu.innerHTML = html;
  document.getElementById('apiLogoutBtn')?.addEventListener('click', function (e) { e.preventDefault(); logout(); });
  document.getElementById('apiLoginBtn')?.addEventListener('click', function () { window.location.href = BASE_PATH + 'login.html'; });
}

// =============================== CORE API ===============================
export function callApi(action, params = {}, method = 'GET', timeout = 30000) {
  return new Promise(function (resolve) {
    try {
      let url = SCRIPT_URL;
      const doFetch = (fetchUrl, fetchOptions) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        fetch(fetchUrl, { ...fetchOptions, signal: controller.signal })
          .then(response => {
            clearTimeout(timeoutId);
            if (!response.ok) {
              return response.text().then(text => {
                resolve({ success: false, error: `Server Error (${response.status}): ${text.substring(0, 200)}` });
              });
            }
            return response.json().then(data => {
              if (typeof data === 'object' && data !== null) {
                if (data.success === undefined) {
                  resolve({ success: true, data: data });
                } else {
                  resolve(data);
                }
              } else {
                resolve({ success: true, data: data });
              }
            });
          })
          .catch(err => {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
              resolve({ success: false, error: 'Request timeout' });
            } else {
              resolve({ success: false, error: err.message || 'Network error' });
            }
          });
      };

      // 🔥 PERBAIKAN PENTING: Bersihkan parameter undefined/null
      const cleanParams = {};
      Object.keys(params || {}).forEach(key => {
        const val = params[key];
        if (val !== undefined && val !== null) cleanParams[key] = val;
      });

      if (method === 'GET') {
        const qs = new URLSearchParams({ action: action, ...cleanParams }).toString();
        url += '?' + qs;
        doFetch(url, { method: 'GET', mode: 'cors', headers: { 'Accept': 'application/json' } });
      } else {
        const urlEncoded = new URLSearchParams({ action: action, ...cleanParams }).toString();
        doFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: urlEncoded });
      }
    } catch (e) {
      resolve({ success: false, error: e.message });
    }
  });
}

// =============================== FETCH WITH CACHE ===============================
export async function fetchWithCache(action, params = {}, cacheKey, cacheAgeMinutes = 30, forceRefresh = false) {
  if (!cacheKey) return await callApi(action, params, 'GET');
  const CACHE_PREFIX = 'pkd_cache_';
  const fullKey = CACHE_PREFIX + cacheKey;
  const now = Date.now();
  let cached = null;
  try {
    const item = localStorage.getItem(fullKey);
    if (item) {
      const parsed = JSON.parse(item);
      if (now - parsed.timestamp < cacheAgeMinutes * 60 * 1000) cached = parsed.data;
    }
  } catch (e) {}
  if (!forceRefresh && cached !== null) return cached;
  try {
    const res = await callApi(action, params, 'GET');
    let data = res?.data || res;
    try { localStorage.setItem(fullKey, JSON.stringify({ data, timestamp: now })); } catch (e) {}
    return data;
  } catch (e) {
    if (cached !== null) return cached;
    throw e;
  }
}

// =============================== GUARD PUBLIC ACCESS ===============================
export async function guardPublicAccess() {
  const role = getUserRole();
  if (role) return true;
  try {
    const modeRes = await getLoginMode();
    if (modeRes.success && modeRes.enabled) {
      const redirect = window.location.pathname;
      window.location.href = BASE_PATH + 'login.html?redirect=' + encodeURIComponent(redirect);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('Gagal memeriksa login mode, mengizinkan akses publik.');
    return true;
  }
}

// =============================== DEFAULT FORM FIELDS ===============================
export function getDefaultFormFields() {
  return [
    { id: 'nama_lengkap', label: 'Nama Lengkap', type: 'text', options: '', required: true, isCore: true },
    { id: 'tempat_tgl_lahir', label: 'Tempat & Tanggal Lahir', type: 'text', options: '', required: true, isCore: true },
    { id: 'pekerjaan', label: 'Pekerjaan', type: 'text', options: '', required: true, isCore: true },
    { id: 'pendidikan_terakhir', label: 'Pendidikan Terakhir', type: 'text', options: '', required: true, isCore: true },
    { id: 'alamat', label: 'Alamat', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'no_hp', label: 'No HP', type: 'text', options: '', required: true, isCore: true },
    { id: 'email', label: 'Email', type: 'text', options: '', required: true, isCore: true },
    { id: 'utusan', label: 'Utusan (PAC)', type: 'select', options: 'PAC Bantul,PAC Banguntapan,PAC Sewon,PAC Kasihan,PAC Pajangan,PAC Sedayu,PAC Pandak,PAC Piyungan,PAC Pleret,PAC Jetis,PAC Imogiri,PAC Dlingo,PAC Bambanglipuro,PAC Sanden,PAC Kretek,PAC Pundong,PAC Srandakan,Lainnya', required: true, isCore: true },
    { id: 'pengalaman_organisasi', label: 'Pengalaman Organisasi', type: 'textarea', options: '', required: true, isCore: true },
    { id: 'foto', label: 'Foto', type: 'file', options: '', required: true, isCore: true },
    { id: 'surat_rekomendasi', label: 'Surat Rekomendasi', type: 'file', options: '', required: false, isCore: true }
  ];
}

// =============================== EXPORTED API FUNCTIONS ===============================

// --- Autentikasi ---
export function verifyAdmin(username, password) { return callApi('verifyAdmin', { username, password }, 'GET'); }
export function verifyKetuaPAC(username, password) { return callApi('verifyKetuaPAC', { username, password }, 'GET'); }
export function verifyMember(username, password) { return callApi('verifyMember', { username, password }, 'GET'); }

// --- Peserta ---
export function getPesertaList(status) { return callApi('getPesertaList', status ? { status } : {}, 'GET'); }
export function submitPeserta(data) { return callApi('submitPeserta', data, 'POST'); }
export function deletePeserta(id) { return callApi('deletePeserta', { id }, 'POST'); }
export function updatePeserta(data) { return callApi('updatePeserta', data, 'POST'); }
export function approvePeserta(id) { return callApi('approvePeserta', { id }, 'POST'); }
export function rejectPeserta(id) { return callApi('rejectPeserta', { id }, 'POST'); }
export function getPesertaById(id) { return callApi('getPesertaById', { id }, 'GET'); }
export function getTotalPeserta() { return callApi('getTotalPeserta', {}, 'GET'); }
export function getAlumniList() { return callApi('getAlumniList', {}, 'GET'); }
export function moveToAlumni(id) { return callApi('moveToAlumni', { id }, 'POST'); }
export function moveMultipleToAlumni(ids) { return callApi('moveMultipleToAlumni', { ids }, 'POST'); }
export function moveBackToActive(id) { return callApi('moveBackToActive', { id }, 'POST'); }
export function getPesertaCredentials(id) { return callApi('getPesertaCredentials', { id }, 'GET'); }

// --- Sesi Absen ---
export function getSesiAbsen() { return callApi('getSesiAbsen', {}, 'GET'); }
export function addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) { return callApi('addSesiAbsen', { nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password }, 'POST'); }
export function updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) { return callApi('updateSesiAbsen', { id, nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai, aktif, password }, 'POST'); }
export function deleteSesiAbsen(id) { return callApi('deleteSesiAbsen', { id }, 'POST'); }
export function regenerateQRSesi(id) { return callApi('regenerateQRSesi', { id }, 'POST'); }
export function toggleAttendanceSession(id, open) { return callApi('toggleAttendanceSession', { id, open }, 'POST'); }
export function getAttendanceSessionStatus(id) { return callApi('getAttendanceSessionStatus', { id }, 'GET'); }

// 🔥 PERBAIKAN PENTING: Ekspor submitAbsen agar halaman absen.html bisa berjalan
export function submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
    return callApi('submitAbsen', { nama, sesiId, tandaTangan, password, qrToken, pesertaId }, 'POST');
}

// --- Materi ---
export function getMateriList() { return callApi('getMateriList', {}, 'GET'); }
export function addMateri(judul, deskripsi, file, fileName, uploadBy) { return callApi('addMateri', { judul, deskripsi, file, fileName, uploadBy }, 'POST'); }
export function deleteMateri(id, fileId) { return callApi('deleteMateri', { id, fileId }, 'POST'); }

// --- Skrining & Quiz ---
export function getSkriningResponses() { return callApi('getSkriningResponses', {}, 'GET'); }
export function getPretestResponses() { return callApi('getPretestResponses', {}, 'GET'); }
export function getPosttestResponses() { return callApi('getPosttestResponses', {}, 'GET'); }
export function getAbsensiResponses() { return callApi('getAbsensiResponses', {}, 'GET'); }

// --- Kader ---
export function getKaderList() { return callApi('getKaderList', {}, 'GET'); }
export function addKader(params) { return callApi('addKader', params, 'POST'); }
export function updateKader(params) { return callApi('updateKader', params, 'POST'); }
export function deleteKader(id) { return callApi('deleteKader', { id }, 'POST'); }

// --- Informasi & Usulan ---
export function getInfoList() { return callApi('getInfoList', {}, 'GET'); }
export function addInfo(params) { return callApi('addInfo', params, 'POST'); }
export function updateInfo(params) { return callApi('updateInfo', params, 'POST'); }
export function deleteInfo(id) { return callApi('deleteInfo', { id }, 'POST'); }
export function toggleInfoStatus(id) { return callApi('toggleInfoStatus', { id }, 'POST'); }
export function getUsulanList() { return callApi('getUsulanList', {}, 'GET'); }
export function updateUsulanStatus(id, status) { return callApi('updateUsulanStatus', { id, status }, 'POST'); }

// --- Asset & Folders ---
export function getAssetList() { return callApi('getAssetList', {}, 'GET'); }
export function addAsset(params) { return callApi('addAsset', params, 'POST'); }
export function updateAsset(params) { return callApi('updateAsset', params, 'POST'); }
export function deleteAsset(id) { return callApi('deleteAsset', { id }, 'POST'); }
export function getFolders() { return callApi('getFolders', {}, 'GET'); }
export function addFolder(nama, parentId) { return callApi('addFolder', { nama, parentId }, 'POST'); }
export function deleteFolder(id) { return callApi('deleteFolder', { id }, 'POST'); }

export function toggleFolderPublic(params) { return callApi('toggleFolderPublic', params, 'POST'); }
export function toggleFolderHideFromGallery(params) { return callApi('toggleFolderHideFromGallery', params, 'POST'); }
export function setFolderPassword(params) { return callApi('setFolderPassword', params, 'POST'); }
export function clearFolderPassword(params) { return callApi('clearFolderPassword', params, 'POST'); }

// --- RTL & Tugas ---
export function getRTLTasks(pesertaId) { return callApi('getRTLTasks', { pesertaId }, 'GET'); }
export function addRTLTask(params) { return callApi('addRTLTask', params, 'POST'); }
export function updateRTLTask(params) { return callApi('updateRTLTask', params, 'POST'); }
export function deleteRTLTask(id) { return callApi('deleteRTLTask', { id }, 'POST'); }
export function approveRTLTask(id) { return callApi('approveRTLTask', { id }, 'POST'); }
export function approveAllRTL(pesertaId) { return callApi('approveAllRTL', { pesertaId }, 'POST'); }
export function getRTLStatus(pesertaId) { return callApi('getRTLStatus', { pesertaId }, 'GET'); }
export function submitRTLAttachment(taskId, fileData, fileName) { return callApi('submitRTLAttachment', { taskId, fileData, fileName }, 'POST'); }

// --- Sertifikat ---
export function getUploadedCertificates() { return callApi('getUploadedCertificates', {}, 'GET'); }
export function getCertificateTemplates() { return callApi('getCertificateTemplates', {}, 'GET'); }
export function addCertificateTemplateManual(params) { return callApi('addCertificateTemplateManual', params, 'POST'); }
export function updateCertificateTemplate(params) { return callApi('updateCertificateTemplate', params, 'POST'); }
export function deleteCertificateTemplate(id) { return callApi('deleteCertificateTemplate', { id }, 'POST'); }
export function generateCertificateForParticipant(templateId, pesertaId) { return callApi('generateCertificateForParticipant', { templateId, pesertaId }, 'POST'); }
export function getCertPresets() { return callApi('getCertPresets', {}, 'GET'); }
export function listCertificateLayouts() { return callApi('listCertificateLayouts', {}, 'GET'); }
export function saveCertificateLayout(nama, data_json, id) { return callApi('saveCertificateLayout', { nama, data_json, id }, 'POST'); }

// --- Tanda Tangan Digital ---
export function getAllDigitalApprovals() { return callApi('getAllDigitalApprovals', {}, 'GET'); }
export function bulkGenerateTTD(params) { return callApi('bulkGenerateTTD', params, 'POST'); }
export function submitDigitalSignature(role, nama, signature, password, peserta_nama, kegunaan) { return callApi('submitDigitalSignature', { role, nama, signature, password, peserta_nama, kegunaan }, 'POST'); }

// --- 🔥 LOKASI PKD DINAMIS ---
export function getLokasiPKDList() { return callApi('getLokasiPKDList', {}, 'GET'); }
export function addLokasiPKD(nama) { return callApi('addLokasiPKD', { nama }, 'POST'); }
export function deleteLokasiPKD(id) { return callApi('deleteLokasiPKD', { id }, 'POST'); }

// --- Pengaturan ---
export function getQuizSettings() { return callApi('getQuizSettings', {}, 'GET'); }
export function setQuizSettings(params) { return callApi('setQuizSettings', params, 'POST'); }
export function getLoginMode() { return callApi('getLoginMode', {}, 'GET'); }
export function setLoginMode(enabled) { return callApi('setLoginMode', { enabled }, 'POST'); }
export function getPublicVisibility() { return callApi('getPublicVisibility', {}, 'GET'); }
export function setPublicVisibility(data) { return callApi('setPublicVisibility', { data: JSON.stringify(data) }, 'POST'); }
export function getPKDLokasi() { return callApi('getPKDLokasi', {}, 'GET'); }
export function setPKDLokasi(lokasi) { return callApi('setPKDLokasi', { lokasi }, 'POST'); }
export function getFormSettings() { return callApi('getFormSettings', {}, 'GET'); }
export function setFormSettings(fields) { return callApi('setFormSettings', { fields: JSON.stringify(fields) }, 'POST'); }
export function getRealtimeSetting() { return callApi('getRealtimeSetting', {}, 'GET'); }
export function setRealtimeSetting(enabled) { return callApi('setRealtimeSetting', { enabled }, 'POST'); }

// --- Kontak ---
export function submitKontak(nama, email, pesan, username, role, ip) { return callApi('submitKontak', { nama, email, pesan, username, role, ip }, 'GET'); }

// =============================== INIT ===============================
if (typeof document !== 'undefined') {
  loadAuthState();
}
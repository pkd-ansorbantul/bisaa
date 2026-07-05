// api.js - Modul Terpadu Final (Compatible with No-CORS & V8)
// Versi: 3.3.1 - Perbaikan Cache: Selalu menyimpan data dari API ke cache
// =============================================================================

(function (global) {
  'use strict';

  // ======================== KONFIGURASI ========================
  var SCRIPT_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbwkGY5SkaiV1GclMKE26Sl5KY9SxhG7JdeJf_uYZFzhRBUcfqt1592kHp_iIjD6ofQGfw/exec';
  var SCRIPT_URL = global.PKD_SCRIPT_URL || SCRIPT_URL_DEFAULT;

  // ======================== STATE ========================
  var userRole = null;
  var userData = {};

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

  function showToast(message, type) {
    var toastEl = document.getElementById('apiToast');
    if (!toastEl) {
      var container = document.createElement('div');
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

  // ======================== PANGGILAN API ========================
  function callApi(action, params, method, timeout) {
    params = params || {};
    method = method || 'GET';
    timeout = timeout || 30000;
    var finalParams = { action: action };
    for (var key in params) {
      if (params.hasOwnProperty(key)) {
        finalParams[key] = params[key];
      }
    }

    return new Promise(function(resolve, reject) {
      if (method === 'GET') {
        try {
          var queryString = new URLSearchParams(finalParams).toString();
          fetch(SCRIPT_URL + '?' + queryString, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' }
          })
            .then(function(response) {
              if (!response.ok) throw new Error('HTTP ' + response.status);
              return response.json();
            })
            .then(function(data) { resolve(data); })
            .catch(function(fetchError) {
              console.warn('Fetch GET gagal, fallback ke JSONP:', fetchError);
              // JSONP fallback
              var callbackName = 'jsonp_cb_' + Date.now();
              var script = document.createElement('script');
              var isResolved = false;
              var timer = setTimeout(function() {
                if (!isResolved) {
                  isResolved = true;
                  if (document.head.contains(script)) document.head.removeChild(script);
                  delete global[callbackName];
                  reject(new Error('Timeout: Server tidak merespon JSONP'));
                }
              }, timeout);

              global[callbackName] = function(data) {
                if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timer);
                  resolve(data || {});
                }
                delete global[callbackName];
                if (document.head.contains(script)) document.head.removeChild(script);
              };

              script.onerror = function() {
                if (!isResolved) {
                  isResolved = true;
                  clearTimeout(timer);
                  delete global[callbackName];
                  if (document.head.contains(script)) document.head.removeChild(script);
                  reject(new Error('Gagal memuat script JSONP'));
                }
              };

              var cleanParams = { action: action };
              for (var k in params) {
                if (k !== 'tandaTangan' && k !== 'signature' && params.hasOwnProperty(k)) {
                  cleanParams[k] = params[k];
                }
              }
              var qs = new URLSearchParams({ callback: callbackName });
              for (var kk in cleanParams) {
                if (cleanParams.hasOwnProperty(kk)) qs.append(kk, cleanParams[kk]);
              }
              script.src = SCRIPT_URL + '?' + qs.toString();
              document.head.appendChild(script);
            });
        } catch (e) {
          reject(e);
        }
      } else {
        // POST - Gunakan 'no-cors' karena Apps Script Web App tidak mengirim header CORS manual
        try {
          var body = new URLSearchParams(finalParams);
          fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
          })
            .then(function() {
              // Karena mode 'no-cors', response tidak bisa dibaca (opaque).
              // Anggap sukses jika tidak ada error jaringan.
              resolve({ success: true });
            })
            .catch(function(e) {
              reject(e);
            });
        } catch (e) {
          reject(e);
        }
      }
    });
  }

  // ======================== CACHE UTILS (DIPERBAIKI) ========================
  function getCached(key, maxAge) {
    maxAge = maxAge || 3600000;
    try {
      var data = sessionStorage.getItem(key + '_data');
      var time = sessionStorage.getItem(key + '_time');
      if (data && time && (Date.now() - parseInt(time)) < maxAge) {
        return JSON.parse(data);
      }
    } catch (e) {
      // Jika sessionStorage tidak dapat diakses (misal karena pemblokiran browser)
      console.warn('getCached: SessionStorage tidak dapat diakses. Melewati cache.', e.message);
    }
    return null;
  }

  function saveCached(key, data) {
    try {
      sessionStorage.setItem(key + '_data', JSON.stringify(data));
      sessionStorage.setItem(key + '_time', Date.now().toString());
    } catch (e) {
      // Jika sessionStorage tidak dapat diakses, lewati penyimpanan cache
      console.warn('saveCached: SessionStorage tidak dapat diakses. Cache tidak disimpan.', e.message);
    }
  }

  // ======================== AUTH ========================
  function persistAuthState() {
    var state = { role: userRole, data: userData };
    try { sessionStorage.setItem('pkd_auth', JSON.stringify(state)); } catch (e) {}
    try { localStorage.setItem('pkd_auth', JSON.stringify(state)); } catch (e) {}
  }

  function loadAuthState() {
    var serialized = sessionStorage.getItem('pkd_auth') || localStorage.getItem('pkd_auth');
    if (serialized) {
      try {
        var state = JSON.parse(serialized);
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
    window.location.href = '/bisaa/index.html';
  }

  function updateNavbarMenu() {
    var menu = document.getElementById('navbarUserMenu');
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

    document.getElementById('apiLogoutBtn')?.addEventListener('click', function(e) {
      e.preventDefault();
      logout();
    });
    document.getElementById('apiLoginBtn')?.addEventListener('click', function() {
      window.location.href = '/bisaa/login.html';
    });
  }

  // ======================== DOMAIN FUNCTIONS ========================

  // --- Auth verification ---
  function verifyAdmin(username, password) {
    return callApi('verifyAdmin', { username: username, password: password }, 'GET');
  }
  function verifyKetuaPAC(username, password) {
    return callApi('verifyKetuaPAC', { username: username, password: password }, 'GET');
  }
  function verifyMember(username, password) {
    return callApi('verifyMember', { username: username, password: password }, 'GET');
  }

  // --- Peserta ---
  function getPesertaList(status, forceRefresh) {
    var cacheKey = 'pesertaList';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return Promise.resolve(c);
    }
    return callApi('getPesertaList', { status: status }, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function submitPeserta(formData) {
    return callApi('submitPeserta', formData, 'POST');
  }
  function deletePeserta(id) {
    return callApi('deletePeserta', { id: id }, 'POST');
  }
  function updatePeserta(formData) {
    return callApi('updatePeserta', formData, 'POST');
  }
  function exportPesertaCSV() {
    return callApi('exportPesertaCSV', {}, 'GET');
  }
  function importPesertaCSV(csvData, fileName) {
    return callApi('importPesertaCSV', { csvData: csvData, fileName: fileName }, 'POST');
  }
  function getTotalPeserta() {
    return callApi('getTotalPeserta', {}, 'GET');
  }
  function approvePeserta(id) {
    return callApi('approvePeserta', { id: id }, 'POST');
  }
  function rejectPeserta(id) {
    return callApi('rejectPeserta', { id: id }, 'POST');
  }
  function getPesertaById(id) {
    return callApi('getPesertaById', { id: id }, 'GET');
  }
  function getPesertaCredentials(id) {
    return callApi('getPesertaCredentials', { id: id }, 'GET');
  }

  // --- Form Settings ---
  function getFormSettings() {
    return callApi('getFormSettings', {}, 'GET');
  }
  function setFormSettings(fields) {
    return callApi('setFormSettings', { fields: JSON.stringify(fields) }, 'POST');
  }

  // --- Alumni ---
  function getAlumniList(forceRefresh) {
    var cacheKey = 'alumniList';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getAlumniList', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function moveToAlumni(id) {
    return callApi('moveToAlumni', { id: id }, 'POST');
  }
  function moveMultipleToAlumni(ids) {
    return callApi('moveMultipleToAlumni', { ids: JSON.stringify(ids) }, 'POST');
  }
  function moveBackToActive(id) {
    return callApi('moveBackToActive', { id: id }, 'POST');
  }

  // --- Sesi Absen ---
  function getSesiAbsen(forceRefresh) {
    var cacheKey = 'sesiAbsen';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c && Array.isArray(c) && c.length > 0) return c;
    }
    return callApi('getSesiAbsen', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache (baik ada data atau kosong)
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addSesiAbsen(nama, waktu, aktif, password) {
    return callApi('addSesiAbsen', { nama: nama, waktu: waktu, aktif: aktif, password: password }, 'POST');
  }
  function updateSesiAbsen(id, nama, waktu, aktif, password) {
    return callApi('updateSesiAbsen', { id: id, nama: nama, waktu: waktu, aktif: aktif, password: password }, 'POST');
  }
  function deleteSesiAbsen(id) {
    return callApi('deleteSesiAbsen', { id: id }, 'POST');
  }
  function regenerateQRSesi(id) {
    return callApi('regenerateQRSesi', { id: id }, 'POST');
  }
  function toggleAttendanceSession(id, open) {
    return callApi('toggleAttendanceSession', { id: id, open: open }, 'POST');
  }
  function getAttendanceSessionStatus(id) {
    return callApi('getAttendanceSessionStatus', { id: id }, 'GET');
  }

  // --- Absensi ---
  function submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
    return callApi('submitAbsen', {
      nama: nama,
      sesiId: sesiId,
      tandaTangan: tandaTangan,
      password: password,
      qrToken: qrToken,
      pesertaId: pesertaId
    }, 'POST');
  }
  function getAbsensiResponses(forceRefresh) {
    var cacheKey = 'absensiResponses';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getAbsensiResponses', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function getAttendanceBySesi(sesiId) {
    return callApi('getAttendanceBySesi', { sesiId: sesiId }, 'GET');
  }
  function getAttendanceMatrix(forceRefresh) {
    var cacheKey = 'rekapAbsensi';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getAttendanceMatrix', {}, 'GET').then(function(res) {
      var data = { peserta: res.peserta || [], sesi: res.sesi || [], hadirSet: new Set(res.hadirSet || []) };
      // 🟢 PERBAIKAN: Selalu simpan ke cache (meskipun data berbentuk objek)
      saveCached(cacheKey, data);
      return data;
    });
  }
  function exportAttendanceMatrixCSV() {
    return callApi('exportAttendanceMatrixCSV', {}, 'GET');
  }

  // --- Skrining ---
  function getSkriningQuestions(forceRefresh) {
    var cacheKey = 'skriningQuestions';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getSkriningQuestions', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addSkriningQuestion(teks, jenis, opsi, urutan) {
    return callApi('addSkriningQuestion', { teks: teks, jenis: jenis, opsi: opsi, urutan: urutan }, 'POST');
  }
  function updateSkriningQuestion(id, teks, jenis, opsi, urutan) {
    return callApi('updateSkriningQuestion', { id: id, teks: teks, jenis: jenis, opsi: opsi, urutan: urutan }, 'POST');
  }
  function deleteSkriningQuestion(id) {
    return callApi('deleteSkriningQuestion', { id: id }, 'POST');
  }
  function getSkriningResponses(forceRefresh) {
    var cacheKey = 'skriningResponses';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getSkriningResponses', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function submitSkrining(formData) {
    return callApi('submitSkrining', formData, 'POST');
  }

  // --- Pretest ---
  function getPretestQuestions(forceRefresh) {
    var cacheKey = 'pretestSoal';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getPretestQuestions', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addPretestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return callApi('addPretestQuestion', {
      teks: teks,
      opsi: opsi,
      jawaban: jawaban,
      urutan: urutan,
      timer_enabled: timer_enabled,
      timer_duration: timer_duration
    }, 'POST');
  }
  function updatePretestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return callApi('updatePretestQuestion', {
      id: id,
      teks: teks,
      opsi: opsi,
      jawaban: jawaban,
      urutan: urutan,
      timer_enabled: timer_enabled,
      timer_duration: timer_duration
    }, 'POST');
  }
  function deletePretestQuestion(id) {
    return callApi('deletePretestQuestion', { id: id }, 'POST');
  }
  function getPretestResponses(forceRefresh) {
    var cacheKey = 'pretestResponses';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getPretestResponses', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function submitPretest(nama, nohp, alamat, answers, score) {
    return callApi('submitPretest', { nama: nama, nohp: nohp, alamat: alamat, answers: answers, score: score }, 'POST');
  }

  // --- Posttest ---
  function getPosttestQuestions(forceRefresh) {
    var cacheKey = 'posttestSoal';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getPosttestQuestions', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addPosttestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return callApi('addPosttestQuestion', {
      teks: teks,
      opsi: opsi,
      jawaban: jawaban,
      urutan: urutan,
      timer_enabled: timer_enabled,
      timer_duration: timer_duration
    }, 'POST');
  }
  function updatePosttestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    return callApi('updatePosttestQuestion', {
      id: id,
      teks: teks,
      opsi: opsi,
      jawaban: jawaban,
      urutan: urutan,
      timer_enabled: timer_enabled,
      timer_duration: timer_duration
    }, 'POST');
  }
  function deletePosttestQuestion(id) {
    return callApi('deletePosttestQuestion', { id: id }, 'POST');
  }
  function getPosttestResponses(forceRefresh) {
    var cacheKey = 'posttestResponses';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getPosttestResponses', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function submitPosttest(nama, nohp, alamat, answers, score) {
    return callApi('submitPosttest', { nama: nama, nohp: nohp, alamat: alamat, answers: answers, score: score }, 'POST');
  }

  // --- Materi ---
  function getMateriList(forceRefresh) {
    var cacheKey = 'materiList';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getMateriList', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addMateri(judul, deskripsi, fileData, fileName, uploadBy) {
    return callApi('addMateri', {
      judul: judul,
      deskripsi: deskripsi,
      fileData: fileData,
      fileName: fileName,
      uploadBy: uploadBy
    }, 'POST');
  }
  function deleteMateri(id, fileId) {
    return callApi('deleteMateri', { id: id, fileId: fileId }, 'POST');
  }

  // --- Informasi ---
  function getInfoList(forceRefresh) {
    var cacheKey = 'adminInfoCache';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getInfoList', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addInfo(jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName) {
    return callApi('addInfo', {
      jenis: jenis,
      judul: judul,
      deskripsi: deskripsi,
      urutan: urutan,
      tanggal_mulai: tanggal_mulai,
      tanggal_akhir: tanggal_akhir,
      lokasi: lokasi,
      fileData: fileData,
      fileName: fileName
    }, 'POST');
  }
  function updateInfo(id, jenis, judul, deskripsi, urutan, tanggal_mulai, tanggal_akhir, lokasi, fileData, fileName) {
    return callApi('updateInfo', {
      id: id,
      jenis: jenis,
      judul: judul,
      deskripsi: deskripsi,
      urutan: urutan,
      tanggal_mulai: tanggal_mulai,
      tanggal_akhir: tanggal_akhir,
      lokasi: lokasi,
      fileData: fileData,
      fileName: fileName
    }, 'POST');
  }
  function deleteInfo(id) {
    return callApi('deleteInfo', { id: id }, 'POST');
  }
  function toggleInfoStatus(id) {
    return callApi('toggleInfoStatus', { id: id }, 'POST');
  }

  // --- Usulan ---
  function getUsulanList() {
    return callApi('getUsulanList', {}, 'GET');
  }
  function updateUsulanStatus(id, status, adminName) {
    return callApi('updateUsulanStatus', { id: id, status: status, adminName: adminName }, 'POST');
  }
  function submitUsulan(formData) {
    return callApi('submitUsulan', formData, 'POST');
  }

  // --- Sertifikat ---
  function getCertificateTemplates(forceRefresh) {
    var cacheKey = 'certTemplates';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getCertificateTemplates', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function getCertPresets(forceRefresh) {
    var cacheKey = 'certPresets';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getCertPresets', {}, 'GET').then(function(res) {
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function addCertPreset(name, config) {
    return callApi('addCertPreset', { name: name, config: config }, 'POST');
  }
  function updateCertPreset(id, name, config) {
    return callApi('updateCertPreset', { id: id, name: name, config: config }, 'POST');
  }
  function deleteCertPreset(id) {
    return callApi('deleteCertPreset', { id: id }, 'POST');
  }
  function addCertificateTemplateManual(nama_template, doc_template_id, config) {
    return callApi('addCertificateTemplateManual', { nama_template: nama_template, doc_template_id: doc_template_id, config: config }, 'POST');
  }
  function updateCertificateTemplate(id, nama_template, doc_template_id, config) {
    return callApi('updateCertificateTemplate', { id: id, nama_template: nama_template, doc_template_id: doc_template_id, config: config }, 'POST');
  }
  function deleteCertificateTemplate(id) {
    return callApi('deleteCertificateTemplate', { id: id }, 'POST');
  }
  function generateCertificates(templateId, presetId, participants, startNumber, customData) {
    return callApi('generateCertificates', {
      templateId: templateId,
      presetId: presetId,
      participants: JSON.stringify(participants),
      startNumber: startNumber,
      customData: JSON.stringify(customData || {})
    }, 'POST');
  }
  function getUploadedCertificates(forceRefresh) {
    var cacheKey = 'uploadedCerts';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return Promise.resolve(c);
    }
    return callApi('getUploadedCertificates', {}, 'GET').then(function(res) {
      // 🛠️ PERBAIKAN PARSING: Handle array langsung atau {data: [...]}
      var data = Array.isArray(res) ? res : (res.data || []);
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  function uploadManualCertificate(pesertaId, nomorSertifikat, fileData) {
    return callApi('uploadManualCertificate', { pesertaId: pesertaId, nomorSertifikat: nomorSertifikat, fileData: fileData }, 'POST');
  }
  function verifyCertificate(nomor) {
    return callApi('verifyCertificate', { nomor: nomor }, 'GET');
  }
  function getNextCertificateNumber() {
    return callApi('getNextCertificateNumber', {}, 'GET');
  }

  // --- Layout Sertifikat ---
  function saveCertificateLayout(nama, data_json, id) {
    return callApi('saveCertificateLayout', { nama: nama, data_json: data_json, id: id }, 'POST');
  }
  function getCertificateLayout(identifier) {
    return callApi('getCertificateLayout', { id: identifier, nama: identifier }, 'GET');
  }
  function listCertificateLayouts() {
    return callApi('listCertificateLayouts', {}, 'GET');
  }

  // --- Tanda Tangan Digital ---
  function submitDigitalSignature(role, nama, signature, password) {
    return callApi('submitDigitalSignature', { role: role, nama: nama, signature: signature, password: password }, 'POST');
  }
  function getDigitalApproval(role) {
    return callApi('getDigitalApproval', { role: role }, 'GET');
  }
  function getAllDigitalApprovals() {
    return callApi('getAllDigitalApprovals', {}, 'GET');
  }
  function updateSignPassword(role, newPassword) {
    return callApi('updateSignPassword', { role: role, newPassword: newPassword }, 'POST');
  }
  function getSignPasswords() {
    return callApi('getSignPasswords', {}, 'GET');
  }

  // --- RTL ---
  function getRTLTasks(pesertaId) {
    return callApi('getRTLTasks', { pesertaId: pesertaId }, 'GET');
  }
  function addRTLTask(judul, deskripsi, deadline, status, pesertaId, fileDriveId, catatan) {
    return callApi('addRTLTask', {
      judul: judul,
      deskripsi: deskripsi,
      deadline: deadline,
      status: status,
      pesertaId: pesertaId,
      fileDriveId: fileDriveId,
      catatan: catatan
    }, 'POST');
  }
  function updateRTLTask(id, judul, deskripsi, deadline, status, pesertaId, fileDriveId, catatan) {
    return callApi('updateRTLTask', {
      id: id,
      judul: judul,
      deskripsi: deskripsi,
      deadline: deadline,
      status: status,
      pesertaId: pesertaId,
      fileDriveId: fileDriveId,
      catatan: catatan
    }, 'POST');
  }
  function deleteRTLTask(id) {
    return callApi('deleteRTLTask', { id: id }, 'POST');
  }
  function submitRTLAttachment(taskId, fileData, fileName) {
    return callApi('submitRTLAttachment', { taskId: taskId, fileData: fileData, fileName: fileName }, 'POST');
  }
  function getRTLAttachments(taskId) {
    return callApi('getRTLAttachments', { taskId: taskId }, 'GET');
  }

  // --- Kader ---
  function getKaderList() {
    return callApi('getKaderList', {}, 'GET');
  }
  function addKader(p) {
    return callApi('addKader', p, 'POST');
  }
  function updateKader(p) {
    return callApi('updateKader', p, 'POST');
  }
  function deleteKader(p) {
    return callApi('deleteKader', p, 'POST');
  }

  // --- Pengaturan ---
  function getQuizSettings(forceRefresh) {
    var cacheKey = 'quizSettings';
    if (!forceRefresh) {
      var c = getCached(cacheKey);
      if (c) return c;
    }
    return callApi('getQuizSettings', {}, 'GET').then(function(res) {
      var data = res.data || {};
      // 🟢 PERBAIKAN: Selalu simpan ke cache
      saveCached(cacheKey, data);
      return data;
    });
  }
  
  function getLoginMode() {
    return callApi('getLoginMode', {}, 'GET');
  }

  function setLoginMode(enabled) {
    return callApi('setLoginMode', { enabled: enabled }, 'POST');
  }
  function getDashboardStats() {
    return callApi('getDashboardStats', {}, 'GET');
  }
  function getRealtimeSetting() {
    return callApi('getRealtimeSetting', {}, 'GET');
  }
  function setRealtimeSetting(enabled) {
    return callApi('setRealtimeSetting', { enabled: enabled }, 'POST');
  }

  // --- Member ---
  function getMemberData(username) {
    return callApi('getMemberData', { username: username }, 'GET');
  }
  function getMemberSkrining(nama) {
    return callApi('getMemberSkrining', { nama: nama }, 'GET');
  }
  function getMemberAbsensi(nama) {
    return callApi('getMemberAbsensi', { nama: nama }, 'GET');
  }
  function getMemberSertifikat(nama) {
    return callApi('getMemberSertifikat', { nama: nama }, 'GET');
  }
  function updateMemberProfile(username, data) {
    return callApi('updateMemberProfile', { username: username, ...data }, 'POST');
  }

  // --- Lupa Akun ---
  function getMemberUsername(params) {
    return callApi('getMemberUsername', params, 'GET');
  }
  function verifyMemberForgot(params) {
    return callApi('verifyMemberForgot', params, 'GET');
  }
  function resetMemberPassword(params) {
    return callApi('resetMemberPassword', params, 'POST');
  }

  // --- Kontak ---
  function submitKontak(nama, email, pesan, username, role, ip) {
    return callApi('submitKontak', { nama: nama, email: email, pesan: pesan, username: username, role: role, ip: ip }, 'GET');
  }

  // --- VISIBILITAS PER MENU ---
  function getPublicVisibility() {
    return callApi('getPublicVisibility', {}, 'GET');
  }
  function setPublicVisibility(data) {
    return callApi('setPublicVisibility', { data: JSON.stringify(data) }, 'POST');
  }

  // ======================== EKSPOR MODUL ========================
  global.PKD = {
    SCRIPT_URL: SCRIPT_URL,
    getUserRole: function() { return userRole; },
    getUserData: function() { return userData; },
    setUserRole: function(role) { userRole = role; },
    setUserData: function(data) { userData = data; },
    escapeHtml: escapeHtml,
    showToast: showToast,
    callApi: callApi,
    getCached: getCached,
    saveCached: saveCached,
    persistAuthState: persistAuthState,
    loadAuthState: loadAuthState,
    logout: logout,
    updateNavbarMenu: updateNavbarMenu,
    verifyAdmin: verifyAdmin,
    verifyKetuaPAC: verifyKetuaPAC,
    verifyMember: verifyMember,
    // Peserta
    getPesertaList: getPesertaList,
    submitPeserta: submitPeserta,
    deletePeserta: deletePeserta,
    updatePeserta: updatePeserta,
    exportPesertaCSV: exportPesertaCSV,
    importPesertaCSV: importPesertaCSV,
    getTotalPeserta: getTotalPeserta,
    approvePeserta: approvePeserta,
    rejectPeserta: rejectPeserta,
    getPesertaById: getPesertaById,
    getPesertaCredentials: getPesertaCredentials,
    // Form Settings
    getFormSettings: getFormSettings,
    setFormSettings: setFormSettings,
    // Alumni
    alumni: {
      getList: getAlumniList,
      moveToAlumni: moveToAlumni,
      moveMultipleToAlumni: moveMultipleToAlumni,
      moveBackToActive: moveBackToActive
    },
    // Sesi Absen
    getSesiAbsen: getSesiAbsen,
    addSesiAbsen: addSesiAbsen,
    updateSesiAbsen: updateSesiAbsen,
    deleteSesiAbsen: deleteSesiAbsen,
    regenerateQRSesi: regenerateQRSesi,
    toggleAttendanceSession: toggleAttendanceSession,
    getAttendanceSessionStatus: getAttendanceSessionStatus,
    // Absensi
    submitAbsen: submitAbsen,
    getAbsensiResponses: getAbsensiResponses,
    getAttendanceBySesi: getAttendanceBySesi,
    getAttendanceMatrix: getAttendanceMatrix,
    exportAttendanceMatrixCSV: exportAttendanceMatrixCSV,
    // Skrining
    getSkriningQuestions: getSkriningQuestions,
    addSkriningQuestion: addSkriningQuestion,
    updateSkriningQuestion: updateSkriningQuestion,
    deleteSkriningQuestion: deleteSkriningQuestion,
    getSkriningResponses: getSkriningResponses,
    submitSkrining: submitSkrining,
    // Pretest
    getPretestQuestions: getPretestQuestions,
    addPretestQuestion: addPretestQuestion,
    updatePretestQuestion: updatePretestQuestion,
    deletePretestQuestion: deletePretestQuestion,
    getPretestResponses: getPretestResponses,
    submitPretest: submitPretest,
    // Posttest
    getPosttestQuestions: getPosttestQuestions,
    addPosttestQuestion: addPosttestQuestion,
    updatePosttestQuestion: updatePosttestQuestion,
    deletePosttestQuestion: deletePosttestQuestion,
    getPosttestResponses: getPosttestResponses,
    submitPosttest: submitPosttest,
    // Materi
    getMateriList: getMateriList,
    addMateri: addMateri,
    deleteMateri: deleteMateri,
    // Info
    getInfoList: getInfoList,
    addInfo: addInfo,
    updateInfo: updateInfo,
    deleteInfo: deleteInfo,
    toggleInfoStatus: toggleInfoStatus,
    // Usulan
    getUsulanList: getUsulanList,
    updateUsulanStatus: updateUsulanStatus,
    submitUsulan: submitUsulan,
    // Sertifikat
    getCertificateTemplates: getCertificateTemplates,
    getCertPresets: getCertPresets,
    addCertPreset: addCertPreset,
    updateCertPreset: updateCertPreset,
    deleteCertPreset: deleteCertPreset,
    addCertificateTemplateManual: addCertificateTemplateManual,
    updateCertificateTemplate: updateCertificateTemplate,
    deleteCertificateTemplate: deleteCertificateTemplate,
    generateCertificates: generateCertificates,
    getUploadedCertificates: getUploadedCertificates, // 🛠️ Sudah diperbaiki
    uploadManualCertificate: uploadManualCertificate,
    verifyCertificate: verifyCertificate,
    getNextCertificateNumber: getNextCertificateNumber,
    // Layout
    saveCertificateLayout: saveCertificateLayout,
    getCertificateLayout: getCertificateLayout,
    listCertificateLayouts: listCertificateLayouts,
    // Tanda Tangan
    submitDigitalSignature: submitDigitalSignature,
    getDigitalApproval: getDigitalApproval,
    getAllDigitalApprovals: getAllDigitalApprovals,
    updateSignPassword: updateSignPassword,
    getSignPasswords: getSignPasswords,
    // RTL
    getRTLTasks: getRTLTasks,
    addRTLTask: addRTLTask,
    updateRTLTask: updateRTLTask,
    deleteRTLTask: deleteRTLTask,
    submitRTLAttachment: submitRTLAttachment,
    getRTLAttachments: getRTLAttachments,
    // Pengaturan
    getQuizSettings: getQuizSettings,
    getLoginMode: getLoginMode,
    setLoginMode: setLoginMode,
    getDashboardStats: getDashboardStats,
    getRealtimeSetting: getRealtimeSetting,
    setRealtimeSetting: setRealtimeSetting,
    // Member
    getMemberData: getMemberData,
    getMemberSkrining: getMemberSkrining,
    getMemberAbsensi: getMemberAbsensi,
    getMemberSertifikat: getMemberSertifikat,
    updateMemberProfile: updateMemberProfile,
    // Lupa Akun
    getMemberUsername: getMemberUsername,
    verifyMemberForgot: verifyMemberForgot,
    resetMemberPassword: resetMemberPassword,
    // Kontak
    submitKontak: submitKontak,
    // Visibilitas
    getPublicVisibility: getPublicVisibility,
    setPublicVisibility: setPublicVisibility
  };

  // ======================== AUTO INIT ========================
  document.addEventListener('DOMContentLoaded', function() {
    loadAuthState();
  });

})(window);
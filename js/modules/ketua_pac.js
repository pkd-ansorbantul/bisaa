// js/modules/ketua_pac.js — Full Fix Ketua PAC Module (Final)
// Modul state untuk halaman Ketua PAC (dashboard kapanewon).
// Fitur:
// - Filter data by kapanewon (dari userData.kapanewon)
// - Cache data terfilter (peserta, skrining, pretest, posttest, absensi, sertifikat, RTL)
// - CRUD RTL terbatas ke kapanewon
// - Approve RTL
// - Submit absen manual via QR scan
// - Custom event untuk sinkronisasi view
// - Lifecycle mount/unmount

import {
  callApi,
  showToast,
  getUserData,
  getPesertaList as apiGetPesertaList,
  getSesiAbsen as apiGetSesiAbsen,
  getSkriningResponses as apiGetSkriningResponses,
  getPretestResponses as apiGetPretestResponses,
  getPosttestResponses as apiGetPosttestResponses,
  getAbsensiResponses as apiGetAbsensiResponses,
  getUploadedCertificates as apiGetUploadedCertificates,
  getRTLTasks as apiGetRTLTasks,
  getInfoList as apiGetInfoList,
  addRTLTask as apiAddRTLTask,
  updateRTLTask as apiUpdateRTLTask,
  deleteRTLTask as apiDeleteRTLTask,
  approveRTLTask as apiApproveRTLTask,
  submitAbsen as apiSubmitAbsen,
} from '../core/api.js';

// ============================================================
//   STATE
// ============================================================
const STATE = {
  // Raw data (semua kapanewon)
  pesertaAll: [],
  sesiAll: [],
  skriningAll: [],
  pretestAll: [],
  posttestAll: [],
  absensiAll: [],
  sertifikatAll: [],
  rtlAll: [],
  informasiAll: [],

  // Filtered data (hanya kapanewon ini)
  peserta: [],
  skrining: [],
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  rtl: [],

  // Meta
  kapanewon: '',
  isLoading: false,
  lastSync: null,
  lastError: null,
};

// Track subscribers untuk notifikasi ringan
const subscribers = new Set();

// ============================================================
//   UTILITY
// ============================================================
function normalizeData(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && data.success && Array.isArray(data.data)) return data.data;
  return [];
}

function safeString(s) {
  return String(s || '').trim();
}

function normalizeForCompare(s) {
  return safeString(s).toLowerCase().replace(/\s+/g, ' ');
}

function getKapanewonFromUser() {
  try {
    const userData = getUserData() || {};
    return safeString(userData.kapanewon || '');
  } catch (e) {
    return '';
  }
}

function notifySubscribers(type) {
  subscribers.forEach(fn => {
    try { fn(type, getPublicState()); } catch (e) {
      console.warn('[KetuaPACModule] Subscriber error:', e);
    }
  });

  window.dispatchEvent(new CustomEvent('pacDataUpdated', {
    detail: { type, state: getPublicState() },
  }));
}

function getPublicState() {
  return {
    kapanewon: STATE.kapanewon,
    peserta: STATE.peserta.slice(),
    skrining: STATE.skrining.slice(),
    pretest: STATE.pretest.slice(),
    posttest: STATE.posttest.slice(),
    absensi: STATE.absensi.slice(),
    sertifikat: STATE.sertifikat.slice(),
    rtl: STATE.rtl.slice(),
    informasi: STATE.informasiAll.slice(),
    sesi: STATE.sesiAll.slice(),
    isLoading: STATE.isLoading,
    lastSync: STATE.lastSync,
    lastError: STATE.lastError,
  };
}

// ============================================================
//   FILTER LOGIC
// ============================================================
function filterByKapanewon(data, field = 'utusan') {
  const kap = STATE.kapanewon;
  if (!kap) return data;

  const kapLower = normalizeForCompare(kap);
  return data.filter(item => {
    const value = normalizeForCompare(item[field] || '');
    return value.includes(kapLower);
  });
}

function filterByNameSet(data, namaSet, field = 'nama') {
  if (!namaSet || namaSet.size === 0) return [];
  return data.filter(d => namaSet.has(normalizeForCompare(d[field] || '')));
}

// ============================================================
//   EXPORTED MODULE
// ============================================================
export const KetuaPACModule = {

  // ==========================================================
  //   STATE ACCESSORS
  // ==========================================================
  getState() {
    return getPublicState();
  },

  getKapanewon() {
    return STATE.kapanewon || getKapanewonFromUser();
  },

  getStats() {
    return {
      kapanewon: STATE.kapanewon,
      totalPeserta: STATE.peserta.length,
      totalSkrining: STATE.skrining.length,
      totalPretest: STATE.pretest.length,
      totalPosttest: STATE.posttest.length,
      totalAbsensi: STATE.absensi.length,
      totalSertifikat: STATE.sertifikat.length,
      totalRTL: STATE.rtl.length,
      lastSync: STATE.lastSync,
    };
  },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  // ==========================================================
  //   GETTERS
  // ==========================================================
  getFilteredPeserta() { return STATE.peserta; },
  getFilteredSkrining() { return STATE.skrining; },
  getFilteredPretest() { return STATE.pretest; },
  getFilteredPosttest() { return STATE.posttest; },
  getFilteredAbsensi() { return STATE.absensi; },
  getFilteredSertifikat() { return STATE.sertifikat; },
  getFilteredRTL() { return STATE.rtl; },

  getAllSesi() { return STATE.sesiAll; },
  getAllInformasi() { return STATE.informasiAll; },

  getPesertaById(id) {
    return STATE.peserta.find(p => String(p.id) === String(id)) || null;
  },

  getSesiById(id) {
    return STATE.sesiAll.find(s => String(s.id) === String(id)) || null;
  },

  // ==========================================================
  //   LOAD DATA
  // ==========================================================
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) {
      return { success: true, skipped: true };
    }

    STATE.isLoading = true;
    STATE.lastError = null;
    STATE.kapanewon = getKapanewonFromUser();

    try {
      // Fetch semua paralel
      const [
        pesertaRaw, sesiRaw, skriningRaw, pretestRaw, posttestRaw,
        absensiRaw, sertifikatRaw, rtlRaw, infoRaw,
      ] = await Promise.all([
        apiGetPesertaList().catch(e => ({ error: e.message })),
        apiGetSesiAbsen().catch(e => ({ error: e.message })),
        apiGetSkriningResponses().catch(e => ({ error: e.message })),
        apiGetPretestResponses().catch(e => ({ error: e.message })),
        apiGetPosttestResponses().catch(e => ({ error: e.message })),
        apiGetAbsensiResponses().catch(e => ({ error: e.message })),
        apiGetUploadedCertificates().catch(e => ({ error: e.message })),
        apiGetRTLTasks().catch(e => ({ error: e.message })),
        apiGetInfoList().catch(e => ({ error: e.message })),
      ]);

      STATE.pesertaAll = normalizeData(pesertaRaw);
      STATE.sesiAll = normalizeData(sesiRaw);
      STATE.skriningAll = normalizeData(skriningRaw);
      STATE.pretestAll = normalizeData(pretestRaw);
      STATE.posttestAll = normalizeData(posttestRaw);
      STATE.absensiAll = normalizeData(absensiRaw);
      STATE.sertifikatAll = normalizeData(sertifikatRaw);
      STATE.rtlAll = normalizeData(rtlRaw);
      STATE.informasiAll = normalizeData(infoRaw);

      // Filter peserta by kapanewon
      STATE.peserta = filterByKapanewon(STATE.pesertaAll);

      // Build nama set dari peserta (untuk filter responses)
      const namaSet = new Set(
        STATE.peserta.map(p => normalizeForCompare(p.nama_lengkap || ''))
      );

      // Filter responses by nama set
      STATE.skrining = filterByNameSet(STATE.skriningAll, namaSet, 'nama');
      STATE.pretest = filterByNameSet(STATE.pretestAll, namaSet, 'nama');
      STATE.posttest = filterByNameSet(STATE.posttestAll, namaSet, 'nama');
      STATE.absensi = filterByNameSet(STATE.absensiAll, namaSet, 'nama');
      STATE.sertifikat = filterByNameSet(STATE.sertifikatAll, namaSet, 'nama_peserta');

      // Filter RTL by pesertaId
      const pesertaIdSet = new Set(
        STATE.peserta.map(p => String(p.id))
      );
      STATE.rtl = STATE.rtlAll.filter(item => {
        if (!item.pesertaId) return true; // tugas umum
        return pesertaIdSet.has(String(item.pesertaId));
      });

      STATE.lastSync = new Date().toISOString();
      STATE.isLoading = false;

      notifySubscribers('all');

      console.log('✅ [KetuaPACModule] Data loaded for kapanewon:', STATE.kapanewon, {
        peserta: STATE.peserta.length,
        skrining: STATE.skrining.length,
        pretest: STATE.pretest.length,
        posttest: STATE.posttest.length,
        absensi: STATE.absensi.length,
        sertifikat: STATE.sertifikat.length,
        rtl: STATE.rtl.length,
      });

      return { success: true };
    } catch (e) {
      STATE.isLoading = false;
      STATE.lastError = e.message;
      console.error('❌ [KetuaPACModule] loadAllData error:', e);
      showToast('Gagal memuat data: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   RTL CRUD
  // ==========================================================
  async addRTLTask(params) {
    try {
      // Pastikan pesertaId valid & milik kapanewon ini
      if (params.pesertaId) {
        const found = STATE.peserta.find(p => String(p.id) === String(params.pesertaId));
        if (!found) {
          throw new Error('Peserta tidak ditemukan di kapanewon Anda');
        }
      }

      const res = await apiAddRTLTask(params);
      if (res && res.success) {
        showToast('Tugas RTL berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateRTLTask(params) {
    try {
      const res = await apiUpdateRTLTask(params);
      if (res && res.success) {
        showToast('Tugas RTL berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteRTLTask(id) {
    try {
      const res = await apiDeleteRTLTask({ id });
      if (res && res.success) {
        showToast('Tugas RTL berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async approveRTLTask(id) {
    try {
      const res = await apiApproveRTLTask({ id });
      if (res && res.success) {
        showToast('Tugas RTL disetujui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyetujui');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   SUBMIT ABSEN (manual via QR)
  // ==========================================================
  async submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
    try {
      // Validasi peserta milik kapanewon ini
      if (pesertaId) {
        const found = STATE.peserta.find(p => String(p.id) === String(pesertaId));
        if (!found) {
          throw new Error('Peserta tidak ditemukan di kapanewon Anda');
        }
      }

      const res = await apiSubmitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId);
      if (res && res.success) {
        showToast('Absen berhasil tercatat', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal submit absen');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   UTILITY
  // ==========================================================
  triggerRender(type = 'all') {
    notifySubscribers(type);
  },

  clearState() {
    STATE.pesertaAll = [];
    STATE.sesiAll = [];
    STATE.skriningAll = [];
    STATE.pretestAll = [];
    STATE.posttestAll = [];
    STATE.absensiAll = [];
    STATE.sertifikatAll = [];
    STATE.rtlAll = [];
    STATE.informasiAll = [];

    STATE.peserta = [];
    STATE.skrining = [];
    STATE.pretest = [];
    STATE.posttest = [];
    STATE.absensi = [];
    STATE.sertifikat = [];
    STATE.rtl = [];

    STATE.kapanewon = '';
    STATE.lastSync = null;
    STATE.lastError = null;
    STATE.isLoading = false;

    notifySubscribers('cleared');
    console.log('[KetuaPACModule] State cleared');
  },

  // Helper: get kapanewon list for filter
  getAllKapanewonList() {
    const list = new Set();
    STATE.pesertaAll.forEach(p => {
      const u = safeString(p.utusan);
      if (u) list.add(u);
    });
    return Array.from(list).sort();
  },
};

// ============================================================
//   DEFAULT EXPORT
// ============================================================
export default KetuaPACModule;
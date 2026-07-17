// js/modules/ketua_pac.js
// Modul State Ketua PAC untuk PKD GP Ansor Bantul (ES Module)
// Versi: 2.0.0 - Full ES Module

import {
  callApi,
  showToast,
  escapeHtml,
  getUserData,
  // Fungsi API yang dibutuhkan
  getPesertaList as apiGetPesertaList,
  getSesiAbsen as apiGetSesiAbsen,
  getSkriningResponses as apiGetSkriningResponses,
  getPretestResponses as apiGetPretestResponses,
  getPosttestResponses as apiGetPosttestResponses,
  getAbsensiResponses as apiGetAbsensiResponses,
  getUploadedCertificates as apiGetUploadedCertificates,
  getRTLTasks as apiGetRTLTasks,
  getInfoList as apiGetInfoList,
  // CRUD RTL
  addRTLTask as apiAddRTLTask,
  updateRTLTask as apiUpdateRTLTask,
  deleteRTLTask as apiDeleteRTLTask,
  // Absen
  submitAbsen as apiSubmitAbsen
} from '../core/api.js';

// =============================== STATE ===============================
const STATE = {
  // Data arrays (akan difilter sesuai kapanewon)
  peserta: [],
  sesi: [],
  skrining: [],
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  rtl: [],
  informasi: [],
  // Additional data
  kapanewon: null,
  isLoading: false,
  lastSync: null
};

// =============================== PRIVATE HELPERS ===============================
function getKapanewonFromUser() {
  const userData = getUserData() || {};
  return userData.kapanewon || '';
}

function filterByKapanewon(data, field = 'utusan') {
  const kap = STATE.kapanewon || getKapanewonFromUser();
  if (!kap) return data;
  const lowerKap = kap.toLowerCase();
  return data.filter(item => {
    const value = (item[field] || '').toLowerCase();
    return value.includes(lowerKap);
  });
}

function escapeHtmlLocal(str) {
  return escapeHtml(str);
}

// =============================== EXPORTED MODULE ===============================
export const KetuaPACModule = {

  // --- STATE ACCESSORS ---
  getState() {
    return { ...STATE };
  },

  getKapanewon() {
    return STATE.kapanewon || getKapanewonFromUser();
  },

  // --- LOAD DATA ---
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) return;
    STATE.isLoading = true;

    STATE.kapanewon = getKapanewonFromUser();

    try {
      // Load semua data yang diperlukan oleh Ketua PAC
      const [
        pesertaData,
        sesiData,
        skriningData,
        pretestData,
        posttestData,
        absensiData,
        sertifikatData,
        rtlData,
        informasiData
      ] = await Promise.all([
        apiGetPesertaList({ status: 'approved' }),
        apiGetSesiAbsen(),
        apiGetSkriningResponses(),
        apiGetPretestResponses(),
        apiGetPosttestResponses(),
        apiGetAbsensiResponses(),
        apiGetUploadedCertificates(),
        apiGetRTLTasks(),
        apiGetInfoList()
      ]);

      STATE.peserta = Array.isArray(pesertaData) ? pesertaData : (pesertaData?.data || []);
      STATE.sesi = Array.isArray(sesiData) ? sesiData : (sesiData?.data || []);
      STATE.skrining = Array.isArray(skriningData) ? skriningData : (skriningData?.data || []);
      STATE.pretest = Array.isArray(pretestData) ? pretestData : (pretestData?.data || []);
      STATE.posttest = Array.isArray(posttestData) ? posttestData : (posttestData?.data || []);
      STATE.absensi = Array.isArray(absensiData) ? absensiData : (absensiData?.data || []);
      STATE.sertifikat = Array.isArray(sertifikatData) ? sertifikatData : (sertifikatData?.data || []);
      STATE.rtl = Array.isArray(rtlData) ? rtlData : (rtlData?.data || []);
      STATE.informasi = Array.isArray(informasiData) ? informasiData : (informasiData?.data || []);

      STATE.lastSync = new Date().toISOString();

      // Broadcast event
      window.dispatchEvent(new CustomEvent('pacDataLoaded', {
        detail: { state: STATE, kapanewon: STATE.kapanewon }
      }));

      console.log('✅ KetuaPACModule: Data dimuat untuk kapanewon:', STATE.kapanewon);

    } catch (error) {
      console.error('❌ KetuaPACModule: Gagal memuat data:', error);
      showToast('Gagal memuat data: ' + error.message, 'error');
    } finally {
      STATE.isLoading = false;
    }
  },

  // --- GETTERS (FILTERED) ---
  getFilteredPeserta() {
    return filterByKapanewon(STATE.peserta);
  },

  getFilteredSkrining() {
    const filteredPeserta = this.getFilteredPeserta();
    const namaSet = new Set(filteredPeserta.map(p => (p.nama_lengkap || '').trim().toLowerCase()));
    return STATE.skrining.filter(d => namaSet.has((d.nama || '').trim().toLowerCase()));
  },

  getFilteredPretest() {
    const filteredPeserta = this.getFilteredPeserta();
    const namaSet = new Set(filteredPeserta.map(p => (p.nama_lengkap || '').trim().toLowerCase()));
    return STATE.pretest.filter(d => namaSet.has((d.nama || '').trim().toLowerCase()));
  },

  getFilteredPosttest() {
    const filteredPeserta = this.getFilteredPeserta();
    const namaSet = new Set(filteredPeserta.map(p => (p.nama_lengkap || '').trim().toLowerCase()));
    return STATE.posttest.filter(d => namaSet.has((d.nama || '').trim().toLowerCase()));
  },

  getFilteredAbsensi() {
    const filteredPeserta = this.getFilteredPeserta();
    const namaSet = new Set(filteredPeserta.map(p => (p.nama_lengkap || '').trim().toLowerCase()));
    return STATE.absensi.filter(d => namaSet.has((d.nama || '').trim().toLowerCase()));
  },

  getFilteredSertifikat() {
    const filteredPeserta = this.getFilteredPeserta();
    const namaSet = new Set(filteredPeserta.map(p => (p.nama_lengkap || '').trim().toLowerCase()));
    return STATE.sertifikat.filter(d => namaSet.has((d.nama_peserta || '').trim().toLowerCase()));
  },

  getFilteredRTL() {
    const filteredPeserta = this.getFilteredPeserta();
    const pesertaIds = new Set(filteredPeserta.map(p => p.id));
    return STATE.rtl.filter(item => !item.pesertaId || pesertaIds.has(item.pesertaId));
  },

  // --- NON-FILTERED GETTERS ---
  getAllSesi() {
    return STATE.sesi;
  },

  getAllInformasi() {
    return STATE.informasi;
  },

  // --- STATS ---
  getStats() {
    const peserta = this.getFilteredPeserta();
    return {
      totalPeserta: peserta.length,
      totalSkrining: this.getFilteredSkrining().length,
      totalPretest: this.getFilteredPretest().length,
      totalPosttest: this.getFilteredPosttest().length,
      totalAbsensi: this.getFilteredAbsensi().length,
      totalSertifikat: this.getFilteredSertifikat().length,
      kapanewon: this.getKapanewon(),
      lastSync: STATE.lastSync
    };
  },

  // ====================================================================
  //   CRUD RTL (Rencana Tindak Lanjut)
  // ====================================================================
  async addRTLTask(params) {
    const result = await apiAddRTLTask(params);
    if (result.success) {
      await this.loadAllData(true);
    }
    return result;
  },

  async updateRTLTask(params) {
    const result = await apiUpdateRTLTask(params);
    if (result.success) {
      await this.loadAllData(true);
    }
    return result;
  },

  async deleteRTLTask(id) {
    const result = await apiDeleteRTLTask({ id });
    if (result.success) {
      await this.loadAllData(true);
    }
    return result;
  },

  // ====================================================================
  //   ABSEN (untuk scan QR / absen manual)
  // ====================================================================
  async submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
    const result = await apiSubmitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId);
    if (result.success) {
      await this.loadAllData(true);
    }
    return result;
  },

  // ====================================================================
  //   UTILITY
  // ====================================================================
  clearState() {
    Object.keys(STATE).forEach(key => {
      if (Array.isArray(STATE[key])) {
        STATE[key] = [];
      } else if (typeof STATE[key] === 'object' && STATE[key] !== null) {
        STATE[key] = null;
      }
    });
    STATE.lastSync = null;
    STATE.isLoading = false;
    window.dispatchEvent(new CustomEvent('pacDataCleared'));
  },

  escapeHtml: escapeHtmlLocal,
  showToast: showToast
};
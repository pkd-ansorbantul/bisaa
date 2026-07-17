// js/modules/member.js
// Modul State Member untuk PKD GP Ansor Bantul (ES Module)
// Versi: 2.0.0 - Full ES Module

import {
  callApi,
  showToast,
  escapeHtml,
  getUserData,
  // Fungsi API yang dibutuhkan
  getMemberData as apiGetMemberData,
  updateMemberProfile as apiUpdateMemberProfile,
  getMemberSkrining as apiGetMemberSkrining,
  getMemberAbsensi as apiGetMemberAbsensi,
  getMemberSertifikat as apiGetMemberSertifikat,
  getMateriList as apiGetMateriList,
  getInfoList as apiGetInfoList,
  getPretestResponses as apiGetPretestResponses,
  getPosttestResponses as apiGetPosttestResponses
} from '../core/api.js';

// =============================== STATE ===============================
const STATE = {
  // Data member
  memberData: null,
  pesertaData: null,
  // Data terkait
  skrining: null,
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  informasi: [],
  materi: [],
  // State flags
  isLoading: false,
  lastSync: null
};

// =============================== PRIVATE HELPERS ===============================
function escapeHtmlLocal(str) {
  return escapeHtml(str);
}

// =============================== EXPORTED MODULE ===============================
export const MemberModule = {

  // --- STATE ACCESSORS ---
  getState() {
    return { ...STATE };
  },

  getMemberData() {
    return STATE.memberData;
  },

  getPesertaData() {
    return STATE.pesertaData;
  },

  getSkrining() {
    return STATE.skrining;
  },

  getPretest() {
    return STATE.pretest;
  },

  getPosttest() {
    return STATE.posttest;
  },

  getAbsensi() {
    return STATE.absensi;
  },

  getSertifikat() {
    return STATE.sertifikat;
  },

  getMateri() {
    return STATE.materi;
  },

  getInformasi() {
    return STATE.informasi;
  },

  getStats() {
    return {
      hasSkrining: !!STATE.skrining,
      pretestCount: STATE.pretest.length,
      posttestCount: STATE.posttest.length,
      absenCount: STATE.absensi.length,
      sertifikatCount: STATE.sertifikat.length,
      lastSync: STATE.lastSync
    };
  },

  // --- LOAD DATA (Semua data member) ---
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) return;
    STATE.isLoading = true;

    try {
      const userData = getUserData();
      const username = userData?.username;

      if (!username) {
        showToast('User tidak ditemukan', 'error');
        return;
      }

      // Ambil data member dan peserta
      const memberRes = await apiGetMemberData(username);
      if (memberRes.success) {
        STATE.memberData = memberRes.member || null;
        STATE.pesertaData = memberRes.peserta || null;
      }

      // Ambil skrining
      const skriningRes = await apiGetMemberSkrining({ nama: STATE.memberData?.nama_lengkap || '' });
      STATE.skrining = skriningRes.success ? skriningRes.data : null;

      // Ambil pretest & posttest (filter berdasarkan nama)
      const pretestRes = await apiGetPretestResponses();
      const allPretest = Array.isArray(pretestRes) ? pretestRes : (pretestRes?.data || []);
      STATE.pretest = allPretest.filter(d => 
        (d.nama || '').toLowerCase() === (STATE.memberData?.nama_lengkap || '').toLowerCase()
      );

      const posttestRes = await apiGetPosttestResponses();
      const allPosttest = Array.isArray(posttestRes) ? posttestRes : (posttestRes?.data || []);
      STATE.posttest = allPosttest.filter(d => 
        (d.nama || '').toLowerCase() === (STATE.memberData?.nama_lengkap || '').toLowerCase()
      );

      // Ambil absensi
      const absenRes = await apiGetMemberAbsensi({ nama: STATE.memberData?.nama_lengkap || '' });
      STATE.absensi = absenRes.success ? absenRes.data : [];

      // Ambil sertifikat
      const sertifikatRes = await apiGetMemberSertifikat({ nama: STATE.memberData?.nama_lengkap || '' });
      STATE.sertifikat = sertifikatRes.success ? sertifikatRes.data : [];

      // Ambil materi dan informasi (publik)
      const materiRes = await apiGetMateriList();
      STATE.materi = Array.isArray(materiRes) ? materiRes : (materiRes?.data || []);

      const infoRes = await apiGetInfoList();
      STATE.informasi = Array.isArray(infoRes) ? infoRes : (infoRes?.data || []);

      STATE.lastSync = new Date().toISOString();

      // Broadcast event ke halaman
      window.dispatchEvent(new CustomEvent('memberDataLoaded', {
        detail: { state: STATE }
      }));

      console.log('✅ MemberModule: Data dimuat untuk:', STATE.memberData?.nama_lengkap);

    } catch (error) {
      console.error('❌ MemberModule: Gagal memuat data:', error);
      showToast('Gagal memuat data: ' + error.message, 'error');
    } finally {
      STATE.isLoading = false;
    }
  },

  // --- UPDATE PROFIL ---
  async updateMemberProfile(data) {
    const userData = getUserData();
    const username = userData?.username;

    if (!username) {
      showToast('User tidak ditemukan', 'error');
      return { success: false };
    }

    // Siapkan parameter (username ditambahkan di dalam api)
    const result = await apiUpdateMemberProfile(username, data);
    if (result.success) {
      await this.loadAllData(true);
      showToast('Profil berhasil diperbarui', 'success');
    } else {
      showToast('Gagal memperbarui profil: ' + (result.error || 'Unknown error'), 'error');
    }
    return result;
  },

  // --- UTILITY ---
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
    window.dispatchEvent(new CustomEvent('memberDataCleared'));
  },

  // Ekspor fungsi utilitas untuk digunakan di halaman
  escapeHtml: escapeHtmlLocal,
  showToast: showToast
};
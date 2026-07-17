// js/modules/admin.js
// Modul State Admin untuk PKD GP Ansor Bantul (ES Module)
// Versi: 3.5.0 - Full Integration with Fixed moveMultipleToAlumni
// ============================================================

import {
  callApi,
  showToast,
  escapeHtml,
  // Fungsi API yang dibutuhkan
  getPesertaList,
  submitPeserta,
  updatePeserta,
  deletePeserta as apiDeletePeserta,
  approvePeserta as apiApprovePeserta,
  rejectPeserta as apiRejectPeserta,
  moveToAlumni as apiMoveToAlumni,
  moveMultipleToAlumni as apiMoveMultipleToAlumni,
  getSesiAbsen,
  addSesiAbsen as apiAddSesiAbsen,
  updateSesiAbsen as apiUpdateSesiAbsen,
  deleteSesiAbsen as apiDeleteSesiAbsen,
  regenerateQRSesi as apiRegenerateQRSesi,
  toggleAttendanceSession as apiToggleAttendance,
  getMateriList,
  addMateri as apiAddMateri,
  deleteMateri as apiDeleteMateri,
  getSkriningResponses,
  addSkriningQuestion as apiAddSkriningQ,
  updateSkriningQuestion as apiUpdateSkriningQ,
  deleteSkriningQuestion as apiDeleteSkriningQ,
  getPretestResponses,
  addPretestQuestion as apiAddPretest,
  updatePretestQuestion as apiUpdatePretest,
  deletePretestQuestion as apiDeletePretest,
  getPosttestResponses,
  addPosttestQuestion as apiAddPosttest,
  updatePosttestQuestion as apiUpdatePosttest,
  deletePosttestQuestion as apiDeletePosttest,
  getAlumniList,
  getKaderList,
  getInfoList,
  getAbsensiResponses,
  getUploadedCertificates,
  getAllDigitalApprovals,
  getAssetList,
  getFolders,
  getUsulanList,
  getRTLTasks,
  getQuizSettings,
  getLoginMode,
  getPublicVisibility,
  getPKDLokasi,
  getFormSettings,
  setLoginMode as apiSetLoginMode,
  setPublicVisibility as apiSetPublicVisibility,
  setPKDLokasi as apiSetPKDLokasi,
  setFormSettings as apiSetFormSettings,
  addInfo as apiAddInfo,
  updateInfo as apiUpdateInfo,
  deleteInfo as apiDeleteInfo,
  toggleInfoStatus as apiToggleInfo,
  addAsset as apiAddAsset,
  deleteAsset as apiDeleteAsset,
  addFolder as apiAddFolder,
  deleteFolder as apiDeleteFolder,
  addKader as apiAddKader,
  updateKader as apiUpdateKader,
  deleteKader as apiDeleteKader,
  addRTLTask as apiAddRTL,
  updateRTLTask as apiUpdateRTL,
  deleteRTLTask as apiDeleteRTL,
  // FUNGSI BARU
  getCertificateTemplates as apiGetCertificateTemplates,
  addCertificateTemplateManual as apiAddCertificateTemplateManual,
  updateCertificateTemplate as apiUpdateCertificateTemplate,
  deleteCertificateTemplate as apiDeleteCertificateTemplate,
  generateCertificateForParticipant as apiGenerateCertificateForParticipant,
  approveRTLTask as apiApproveRTLTask,
  approveAllRTL as apiApproveAllRTL,
  getRTLStatus as apiGetRTLStatus,
  saveCertificateLayout as apiSaveCertificateLayout,
  getCertificateLayout as apiGetCertificateLayout,
  listCertificateLayouts as apiListCertificateLayouts
} from '../core/api.js';

// =============================== STATE ===============================
const STATE = {
  // Data arrays
  peserta: [],
  sesi: [],
  materi: [],
  skrining: [],
  pretest: [],
  posttest: [],
  alumni: [],
  kader: [],
  informasi: [],
  absensi: [],
  sertifikat: [],
  digitalApprovals: [],
  asset: [],
  folders: [],
  usulan: [],
  rtl: [],
  // Additional data for settings
  quizSettings: {},
  loginMode: false,
  publicVisibility: {},
  pkdLokasi: '',
  formSettings: [],
  // State flags
  isLoading: false,
  lastSync: null
};

// =============================== PRIVATE HELPERS ===============================
function generateId() {
  return 'tmp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
}

// Helper untuk mendapatkan Field Default Form
function getDefaultFormFields() {
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
    { id: 'surat_rekomendasi', label: 'Surat Rekomendasi', type: 'file', options: '', required: true, isCore: true }
  ];
}

// =============================== EXPORTED MODULE ===============================
export const AdminModule = {

  // --- STATE ACCESSORS ---
  getState() {
    return { ...STATE };
  },

  getStats() {
    return {
      totalPeserta: STATE.peserta.length,
      totalSesi: STATE.sesi.length,
      totalMateri: STATE.materi.length,
      totalSkrining: STATE.skrining.length,
      totalPretest: STATE.pretest.length,
      totalPosttest: STATE.posttest.length,
      totalAlumni: STATE.alumni.length,
      totalKader: STATE.kader.length,
      totalAbsensi: STATE.absensi.length,
      totalSertifikat: STATE.sertifikat.length,
      lastSync: STATE.lastSync
    };
  },

  // --- DATA GETTERS ---
  getPesertaList(status = null) {
    if (status) return STATE.peserta.filter(p => p.status === status);
    return STATE.peserta;
  },

  getPesertaById(id) {
    return STATE.peserta.find(p => String(p.id) === String(id));
  },

  getSesiList() {
    return STATE.sesi;
  },

  getSesiById(id) {
    return STATE.sesi.find(s => String(s.id) === String(id));
  },

  getMateriList() {
    return STATE.materi;
  },

  getSkriningList() {
    return STATE.skrining;
  },

  getPretestList() {
    return STATE.pretest;
  },

  getPosttestList() {
    return STATE.posttest;
  },

  getAlumniList() {
    return STATE.alumni;
  },

  getKaderList() {
    return STATE.kader;
  },

  getInformasiList() {
    return STATE.informasi;
  },

  getAbsensiList() {
    return STATE.absensi;
  },

  getSertifikatList() {
    return STATE.sertifikat;
  },

  getDigitalApprovals() {
    return STATE.digitalApprovals;
  },

  getAssetList() {
    return STATE.asset;
  },

  getFolders() {
    return STATE.folders;
  },

  getUsulanList() {
    return STATE.usulan;
  },

  getRTLList() {
    return STATE.rtl;
  },

  getQuizSettings() {
    return STATE.quizSettings;
  },

  getLoginMode() {
    return STATE.loginMode;
  },

  getPublicVisibility() {
    return STATE.publicVisibility;
  },

  getPKDLokasi() {
    return STATE.pkdlokasi;
  },

  getFormSettings() {
    if (!STATE.formSettings || STATE.formSettings.length === 0) {
      return getDefaultFormFields();
    }
    return STATE.formSettings;
  },

  // --- NEW GETTERS FOR TEMPLATES & LAYOUTS ---
  async getCertificateTemplates() {
    return await apiGetCertificateTemplates();
  },

  async getCertificateLayouts() {
    return await apiListCertificateLayouts();
  },

  // --- NEW RTL UTILITIES ---
  async getRTLStatus(pesertaId) {
    return await apiGetRTLStatus({ pesertaId });
  },

  // --- LOAD DATA (Single Source of Truth) ---
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) return;
    STATE.isLoading = true;

    try {
      const [
        pesertaData,
        sesiData,
        materiData,
        skriningData,
        pretestData,
        posttestData,
        alumniData,
        kaderData,
        informasiData,
        absensiData,
        sertifikatData,
        approvalsData,
        assetData,
        foldersData,
        usulanData,
        rtlData,
        quizSettingsData,
        loginModeData,
        visibilityData,
        pkdLokasiData,
        formSettingsData
      ] = await Promise.all([
        getPesertaList(),
        getSesiAbsen(),
        getMateriList(),
        getSkriningResponses(),
        getPretestResponses(),
        getPosttestResponses(),
        getAlumniList(),
        getKaderList(),
        getInfoList(),
        getAbsensiResponses(),
        getUploadedCertificates(),
        getAllDigitalApprovals(),
        getAssetList(),
        getFolders(),
        getUsulanList(),
        getRTLTasks(),
        getQuizSettings(),
        getLoginMode(),
        getPublicVisibility(),
        getPKDLokasi(),
        getFormSettings()
      ]);

      STATE.peserta = Array.isArray(pesertaData) ? pesertaData : (pesertaData?.data || []);
      STATE.sesi = Array.isArray(sesiData) ? sesiData : (sesiData?.data || []);
      STATE.materi = Array.isArray(materiData) ? materiData : (materiData?.data || []);
      STATE.skrining = Array.isArray(skriningData) ? skriningData : (skriningData?.data || []);
      STATE.pretest = Array.isArray(pretestData) ? pretestData : (pretestData?.data || []);
      STATE.posttest = Array.isArray(posttestData) ? posttestData : (posttestData?.data || []);
      STATE.alumni = Array.isArray(alumniData) ? alumniData : (alumniData?.data || []);
      STATE.kader = Array.isArray(kaderData) ? kaderData : (kaderData?.data || []);
      STATE.informasi = Array.isArray(informasiData) ? informasiData : (informasiData?.data || []);
      STATE.absensi = Array.isArray(absensiData) ? absensiData : (absensiData?.data || []);
      STATE.sertifikat = Array.isArray(sertifikatData) ? sertifikatData : (sertifikatData?.data || []);
      STATE.digitalApprovals = Array.isArray(approvalsData) ? approvalsData : (approvalsData?.data || []);
      STATE.asset = Array.isArray(assetData) ? assetData : (assetData?.data || []);
      STATE.folders = Array.isArray(foldersData) ? foldersData : (foldersData?.data || []);
      STATE.usulan = Array.isArray(usulanData) ? usulanData : (usulanData?.data || []);
      STATE.rtl = Array.isArray(rtlData) ? rtlData : (rtlData?.data || []);

      STATE.quizSettings = quizSettingsData?.data || {};
      STATE.loginMode = loginModeData?.enabled || false;
      STATE.publicVisibility = visibilityData?.data || {};
      STATE.pkdlokasi = pkdLokasiData?.data || 'Kabupaten Bantul';

      let rawFormSettings = Array.isArray(formSettingsData?.data) ? formSettingsData.data : [];
      STATE.formSettings = (rawFormSettings.length > 0) ? rawFormSettings : getDefaultFormFields();

      STATE.lastSync = new Date().toISOString();

      // Broadcast event ke halaman
      window.dispatchEvent(new CustomEvent('adminDataUpdated', {
        detail: { state: STATE }
      }));
      console.log('✅ AdminModule: Semua data dimuat.');

    } catch (error) {
      console.error('❌ AdminModule: Gagal memuat data:', error);
      showToast('Gagal memuat data: ' + error.message, 'error');
    } finally {
      STATE.isLoading = false;
    }
  },

  // --- TRIGGER RENDER ---
  triggerRender(type = 'all') {
    window.dispatchEvent(new CustomEvent('adminDataUpdated', {
      detail: { type, state: STATE }
    }));
    if (type === 'peserta' && typeof window.updatePesertaTable === 'function') {
      window.updatePesertaTable();
    } else if (type === 'sesi' && typeof window.updateSesiTable === 'function') {
      window.updateSesiTable();
    } else if (type === 'materi' && typeof window.updateMateriTable === 'function') {
      window.updateMateriTable();
    }
  },

  // ==================================================================
  //   CRUD PESERTA (Dengan Optimistic UI)
  // ==================================================================
  async addPeserta(data) {
    const tempId = generateId();
    const newItem = { id: tempId, ...data, status: 'pending' };
    STATE.peserta.unshift(newItem);
    this.triggerRender('peserta');
    showToast('Mengirim data...', 'info');

    try {
      const result = await submitPeserta(data);
      if (result.success) {
        const index = STATE.peserta.findIndex(p => p.id === tempId);
        if (index !== -1) {
          STATE.peserta[index].id = result.id;
        }
        showToast('Peserta berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      STATE.peserta = STATE.peserta.filter(p => p.id !== tempId);
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updatePeserta(data) {
    const id = data.id;
    const original = STATE.peserta.find(p => String(p.id) === String(id));
    if (!original) return { success: false, error: 'Data tidak ditemukan' };
    const backup = { ...original };
    const index = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (index !== -1) {
      STATE.peserta[index] = { ...STATE.peserta[index], ...data };
      this.triggerRender('peserta');
    }
    showToast('Memperbarui data...', 'info');

    try {
      const result = await updatePeserta(data);
      if (result.success) {
        showToast('Peserta berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      if (index !== -1) {
        STATE.peserta[index] = backup;
        this.triggerRender('peserta');
      }
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deletePeserta(id) {
    const index = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (index === -1) return { success: false, error: 'Data tidak ditemukan' };
    const backup = STATE.peserta[index];
    STATE.peserta.splice(index, 1);
    this.triggerRender('peserta');
    showToast('Menghapus...', 'info');

    try {
      const result = await apiDeletePeserta(id);
      if (result.success) {
        showToast('Peserta berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      STATE.peserta.splice(index, 0, backup);
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async approvePeserta(id) {
    const index = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (index === -1) return { success: false };
    const backup = { ...STATE.peserta[index] };
    STATE.peserta[index].status = 'approved';
    this.triggerRender('peserta');
    showToast('Menyetujui...', 'info');

    try {
      const result = await apiApprovePeserta(id);
      if (result.success) {
        showToast('Peserta disetujui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menyetujui');
      }
    } catch (e) {
      STATE.peserta[index] = backup;
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async rejectPeserta(id) {
    const index = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (index === -1) return { success: false };
    const backup = { ...STATE.peserta[index] };
    STATE.peserta[index].status = 'rejected';
    this.triggerRender('peserta');
    showToast('Menolak...', 'info');

    try {
      const result = await apiRejectPeserta(id);
      if (result.success) {
        showToast('Peserta ditolak!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menolak');
      }
    } catch (e) {
      STATE.peserta[index] = backup;
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async moveToAlumni(id) {
    const index = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (index === -1) return { success: false };
    const backup = STATE.peserta[index];
    STATE.peserta.splice(index, 1);
    this.triggerRender('peserta');
    showToast('Memindahkan ke alumni...', 'info');

    try {
      const result = await apiMoveToAlumni(id);
      if (result.success) {
        showToast('Berhasil dipindahkan ke alumni!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memindahkan');
      }
    } catch (e) {
      STATE.peserta.splice(index, 0, backup);
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   PERBAIKAN PENTING: moveMultipleToAlumni dengan pembersihan ID
  // ==================================================================
  async moveMultipleToAlumni(ids) {
    // === 1. Bersihkan ID ===
    const cleanedIds = ids
      .map(id => String(id).trim())
      .filter(id => id !== '');

    if (cleanedIds.length === 0) {
      return { success: false, error: 'Tidak ada ID valid untuk dipindahkan' };
    }

    // === 2. Optimistic UI: hapus dari state lokal ===
    const itemsToRemove = [];
    cleanedIds.forEach(id => {
      const idx = STATE.peserta.findIndex(p => String(p.id).trim() === id);
      if (idx !== -1) {
        itemsToRemove.push({ index: idx, data: STATE.peserta[idx] });
      }
    });
    const removed = [];
    itemsToRemove.sort((a, b) => b.index - a.index);
    itemsToRemove.forEach(item => {
      removed.push(STATE.peserta.splice(item.index, 1)[0]);
    });
    this.triggerRender('peserta');
    showToast('Memindahkan ' + cleanedIds.length + ' peserta...', 'info');

    // === 3. Kirim ke API ===
    try {
      // cleanedIds dikirim sebagai array (api.js akan handle serialisasi)
      const result = await apiMoveMultipleToAlumni(cleanedIds);
      if (result.success) {
        showToast('Berhasil memindahkan ' + (result.moved || cleanedIds.length) + ' peserta!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memindahkan');
      }
    } catch (e) {
      // === 4. Rollback jika gagal ===
      itemsToRemove.sort((a, b) => a.index - b.index);
      itemsToRemove.forEach(item => {
        STATE.peserta.splice(item.index, 0, item.data);
      });
      this.triggerRender('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==================================================================
  //   CRUD SESI ABSEN
  // ==================================================================
  async addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) {
    const tempId = generateId();
    const newItem = { 
      id: tempId, 
      nama, 
      waktu_mulai: waktuMulai, 
      waktu_selesai: waktuSelesai, 
      submission_open: aktif !== false 
    };
    STATE.sesi.unshift(newItem);
    this.triggerRender('sesi');
    showToast('Menambahkan sesi...', 'info');

    try {
      const result = await apiAddSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password);
      if (result.success) {
        const index = STATE.sesi.findIndex(s => s.id === tempId);
        if (index !== -1) {
          STATE.sesi[index].id = result.id;
          STATE.sesi[index].qrToken = result.qrToken;
        }
        showToast('Sesi absen berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      STATE.sesi = STATE.sesi.filter(s => s.id !== tempId);
      this.triggerRender('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) {
    const index = STATE.sesi.findIndex(s => String(s.id) === String(id));
    if (index === -1) return { success: false };
    const backup = { ...STATE.sesi[index] };
    STATE.sesi[index].nama = nama;
    STATE.sesi[index].waktu_mulai = waktuMulai;
    STATE.sesi[index].waktu_selesai = waktuSelesai;
    STATE.sesi[index].submission_open = aktif !== false;
    this.triggerRender('sesi');
    showToast('Memperbarui sesi...', 'info');

    try {
      const result = await apiUpdateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password);
      if (result.success) {
        showToast('Sesi absen berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      STATE.sesi[index] = backup;
      this.triggerRender('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteSesiAbsen(id) {
    const index = STATE.sesi.findIndex(s => String(s.id) === String(id));
    if (index === -1) return { success: false };
    const backup = STATE.sesi[index];
    STATE.sesi.splice(index, 1);
    this.triggerRender('sesi');
    showToast('Menghapus sesi...', 'info');

    try {
      const result = await apiDeleteSesiAbsen(id);
      if (result.success) {
        showToast('Sesi absen berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      STATE.sesi.splice(index, 0, backup);
      this.triggerRender('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async regenerateQRSesi(id) {
    try {
      const result = await apiRegenerateQRSesi(id);
      if (result.success) {
        const index = STATE.sesi.findIndex(s => String(s.id) === String(id));
        if (index !== -1) {
          STATE.sesi[index].qrToken = result.qrToken;
        }
        showToast('QR berhasil diregenerasi!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal meregenerasi');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async toggleAttendanceSession(id, open) {
    try {
      const result = await apiToggleAttendance(id, open);
      if (result.success) {
        const index = STATE.sesi.findIndex(s => String(s.id) === String(id));
        if (index !== -1) {
          STATE.sesi[index].submission_open = open;
        }
        this.triggerRender('sesi');
        showToast('Status sesi berhasil diubah!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal mengubah status');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD MATERI
  // ==================================================================
  async addMateri(judul, deskripsi, fileData, fileName, uploadBy) {
    const tempId = generateId();
    const newItem = {
      id: tempId,
      judul,
      deskripsi,
      fileId: 'uploading',
      tipe: fileName.split('.').pop(),
      kategori: 'Umum',
      tanggal: new Date().toISOString().slice(0, 10),
      uploadBy
    };
    STATE.materi.unshift(newItem);
    this.triggerRender('materi');
    showToast('Mengunggah materi...', 'info');

    try {
      const result = await apiAddMateri(judul, deskripsi, fileData, fileName, uploadBy);
      if (result.success) {
        const index = STATE.materi.findIndex(m => m.id === tempId);
        if (index !== -1) {
          STATE.materi[index].id = result.id;
          STATE.materi[index].fileId = result.fileId;
        }
        showToast('Materi berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      STATE.materi = STATE.materi.filter(m => m.id !== tempId);
      this.triggerRender('materi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteMateri(id, fileId) {
    const index = STATE.materi.findIndex(m => String(m.id) === String(id));
    if (index === -1) return { success: false };
    const backup = STATE.materi[index];
    STATE.materi.splice(index, 1);
    this.triggerRender('materi');
    showToast('Menghapus materi...', 'info');

    try {
      const result = await apiDeleteMateri(id, fileId);
      if (result.success) {
        showToast('Materi berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      STATE.materi.splice(index, 0, backup);
      this.triggerRender('materi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD SKRINING & PERTANYAAN
  // ==================================================================
  async addSkriningQuestion(teks, jenis, opsi, urutan) {
    try {
      const result = await apiAddSkriningQ(teks, jenis, opsi, urutan);
      if (result.success) {
        showToast('Pertanyaan berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updateSkriningQuestion(id, teks, jenis, opsi, urutan) {
    try {
      const result = await apiUpdateSkriningQ(id, teks, jenis, opsi, urutan);
      if (result.success) {
        showToast('Pertanyaan berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteSkriningQuestion(id) {
    try {
      const result = await apiDeleteSkriningQ(id);
      if (result.success) {
        showToast('Pertanyaan berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD PRETEST & POSTTEST
  // ==================================================================
  async addPretestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    try {
      const result = await apiAddPretest(teks, opsi, jawaban, urutan, timer_enabled, timer_duration);
      if (result.success) {
        showToast('Soal pretest berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updatePretestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    try {
      const result = await apiUpdatePretest(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration);
      if (result.success) {
        showToast('Soal pretest berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deletePretestQuestion(id) {
    try {
      const result = await apiDeletePretest(id);
      if (result.success) {
        showToast('Soal pretest berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async addPosttestQuestion(teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    try {
      const result = await apiAddPosttest(teks, opsi, jawaban, urutan, timer_enabled, timer_duration);
      if (result.success) {
        showToast('Soal posttest berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updatePosttestQuestion(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration) {
    try {
      const result = await apiUpdatePosttest(id, teks, opsi, jawaban, urutan, timer_enabled, timer_duration);
      if (result.success) {
        showToast('Soal posttest berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deletePosttestQuestion(id) {
    try {
      const result = await apiDeletePosttest(id);
      if (result.success) {
        showToast('Soal posttest berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD INFORMASI
  // ==================================================================
  async addInfo(params) {
    try {
      const result = await apiAddInfo(params);
      if (result.success) {
        showToast('Informasi berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updateInfo(params) {
    try {
      const result = await apiUpdateInfo(params);
      if (result.success) {
        showToast('Informasi berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteInfo(id) {
    try {
      const result = await apiDeleteInfo(id);
      if (result.success) {
        showToast('Informasi berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async toggleInfoStatus(id) {
    try {
      const result = await apiToggleInfo(id);
      if (result.success) {
        showToast('Status informasi berhasil diubah!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal mengubah status');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD ASET & FOLDER
  // ==================================================================
  async addAsset(params) {
    try {
      const result = await apiAddAsset(params);
      if (result.success) {
        showToast('Aset berhasil diupload!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal upload');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteAsset(id) {
    try {
      const result = await apiDeleteAsset(id);
      if (result.success) {
        showToast('Aset berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async addFolder(nama, parentId) {
    try {
      const result = await apiAddFolder(nama, parentId);
      if (result.success) {
        showToast('Folder berhasil dibuat!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal membuat folder');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteFolder(id) {
    try {
      const result = await apiDeleteFolder(id);
      if (result.success) {
        showToast('Folder berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus folder');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD KADER
  // ==================================================================
  async addKader(params) {
    try {
      const result = await apiAddKader(params);
      if (result.success) {
        showToast('Kader berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updateKader(params) {
    try {
      const result = await apiUpdateKader(params);
      if (result.success) {
        showToast('Kader berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteKader(id) {
    try {
      const result = await apiDeleteKader(id);
      if (result.success) {
        showToast('Kader berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   CRUD RTL
  // ==================================================================
  async addRTLTask(params) {
    try {
      const result = await apiAddRTL(params);
      if (result.success) {
        showToast('Tugas RTL berhasil ditambahkan!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menambahkan');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async updateRTLTask(params) {
    try {
      const result = await apiUpdateRTL(params);
      if (result.success) {
        showToast('Tugas RTL berhasil diperbarui!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal memperbarui');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async deleteRTLTask(id) {
    try {
      const result = await apiDeleteRTL({ id });
      if (result.success) {
        showToast('Tugas RTL berhasil dihapus!', 'success');
        await this.loadAllData(true);
        return result;
      } else {
        throw new Error(result.error || 'Gagal menghapus');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // --- NEW RTL ACTIONS ---
  async approveRTLTask(id) {
    return await apiApproveRTLTask({ id });
  },

  async approveAllRTL(pesertaId) {
    return await apiApproveAllRTL({ pesertaId });
  },

  // ==================================================================
  //   CRUD TEMPLATE SERTIFIKAT
  // ==================================================================
  async addCertificateTemplate(params) {
    return await apiAddCertificateTemplateManual(params);
  },

  async updateCertificateTemplate(params) {
    return await apiUpdateCertificateTemplate(params);
  },

  async deleteCertificateTemplate(id) {
    return await apiDeleteCertificateTemplate({ id });
  },

  // ==================================================================
  //   GENERATE SERTIFIKAT PER PESERTA
  // ==================================================================
  async generateCertificateForParticipant(templateId, pesertaId) {
    return await apiGenerateCertificateForParticipant({ templateId, pesertaId });
  },

  // ==================================================================
  //   PENGATURAN (SETTINGS)
  // ==================================================================
  async setLoginMode(enabled) {
    try {
      const result = await apiSetLoginMode(enabled);
      if (result.success) {
        STATE.loginMode = enabled;
        await this.loadAllData(true);
        showToast('Mode login berhasil diubah!', 'success');
        return result;
      } else {
        throw new Error(result.error || 'Gagal mengubah mode');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async setPublicVisibility(data) {
    try {
      const result = await apiSetPublicVisibility(data);
      if (result.success) {
        STATE.publicVisibility = data;
        await this.loadAllData(true);
        showToast('Visibilitas berhasil diubah!', 'success');
        return result;
      } else {
        throw new Error(result.error || 'Gagal mengubah visibilitas');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async setPKDLokasi(lokasi) {
    try {
      const result = await apiSetPKDLokasi(lokasi);
      if (result.success) {
        STATE.pkdlokasi = lokasi;
        await this.loadAllData(true);
        showToast('Lokasi PKD berhasil diubah!', 'success');
        return result;
      } else {
        throw new Error(result.error || 'Gagal mengubah lokasi');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  async setFormSettings(fields) {
    try {
      const result = await apiSetFormSettings(fields);
      if (result.success) {
        STATE.formSettings = fields;
        await this.loadAllData(true);
        showToast('Struktur form berhasil disimpan!', 'success');
        return result;
      } else {
        throw new Error(result.error || 'Gagal menyimpan struktur');
      }
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false };
    }
  },

  // ==================================================================
  //   UTILITY
  // ==================================================================
  clearState() {
    Object.keys(STATE).forEach(key => {
      if (Array.isArray(STATE[key])) {
        STATE[key] = [];
      } else if (typeof STATE[key] === 'object' && STATE[key] !== null && key !== 'pkdLokasi') {
        STATE[key] = {};
      }
    });
    STATE.lastSync = null;
    STATE.isLoading = false;
    window.dispatchEvent(new CustomEvent('adminDataUpdated'));
  }
};
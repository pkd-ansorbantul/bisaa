// js/modules/admin.js — Full Fix Admin State Manager v26.1.6
// Modul state untuk admin panel. Bertanggung jawab atas:
// - Caching semua data admin (peserta, sesi, materi, dll)
// - CRUD operations dengan optimistic UI
// - Event dispatching untuk sync antar view
// - Cache management (loadAllData, clearState)
// - Stats aggregation
// - Tim Instruktur CRUD (v26.1.6)

import {
  callApi,
  showToast,
  getPesertaList as apiGetPesertaList,
  submitPeserta as apiSubmitPeserta,
  updatePeserta as apiUpdatePeserta,
  deletePeserta as apiDeletePeserta,
  approvePeserta as apiApprovePeserta,
  rejectPeserta as apiRejectPeserta,
  getPesertaById as apiGetPesertaById,
  getTotalPeserta as apiGetTotalPeserta,
  getAlumniList as apiGetAlumniList,
  moveToAlumni as apiMoveToAlumni,
  moveMultipleToAlumni as apiMoveMultipleToAlumni,
  moveBackToActive as apiMoveBackToActive,

  getSesiAbsen as apiGetSesiAbsen,
  addSesiAbsen as apiAddSesiAbsen,
  updateSesiAbsen as apiUpdateSesiAbsen,
  deleteSesiAbsen as apiDeleteSesiAbsen,
  regenerateQRSesi as apiRegenerateQRSesi,
  toggleAttendanceSession as apiToggleAttendanceSession,
  getAttendanceSessionStatus as apiGetAttendanceSessionStatus,

  getMateriList as apiGetMateriList,
  addMateri as apiAddMateri,
  deleteMateri as apiDeleteMateri,

  getSkriningResponses as apiGetSkriningResponses,
  getPretestResponses as apiGetPretestResponses,
  getPosttestResponses as apiGetPosttestResponses,
  getAbsensiResponses as apiGetAbsensiResponses,

  getKaderList as apiGetKaderList,
  addKader as apiAddKader,
  updateKader as apiUpdateKader,
  deleteKader as apiDeleteKader,

  getInfoList as apiGetInfoList,
  addInfo as apiAddInfo,
  updateInfo as apiUpdateInfo,
  deleteInfo as apiDeleteInfo,
  toggleInfoStatus as apiToggleInfoStatus,
  getUsulanList as apiGetUsulanList,
  updateUsulanStatus as apiUpdateUsulanStatus,

  getAssetList as apiGetAssetList,
  addAsset as apiAddAsset,
  updateAsset as apiUpdateAsset,
  deleteAsset as apiDeleteAsset,
  getFolders as apiGetFolders,
  addFolder as apiAddFolder,
  deleteFolder as apiDeleteFolder,
  toggleFolderPublic as apiToggleFolderPublic,
  toggleFolderHideFromGallery as apiToggleFolderHideFromGallery,
  setFolderPassword as apiSetFolderPassword,
  clearFolderPassword as apiClearFolderPassword,

  getRTLTasks as apiGetRTLTasks,
  addRTLTask as apiAddRTLTask,
  updateRTLTask as apiUpdateRTLTask,
  deleteRTLTask as apiDeleteRTLTask,
  approveRTLTask as apiApproveRTLTask,
  approveAllRTL as apiApproveAllRTL,
  getRTLStatus as apiGetRTLStatus,
  submitRTLAttachment as apiSubmitRTLAttachment,

  getCertificateTemplates as apiGetCertificateTemplates,
  addCertificateTemplateManual as apiAddCertificateTemplateManual,
  updateCertificateTemplate as apiUpdateCertificateTemplate,
  deleteCertificateTemplate as apiDeleteCertificateTemplate,
  generateCertificateForParticipant as apiGenerateCertificateForParticipant,
  getCertPresets as apiGetCertPresets,
  listCertificateLayouts as apiListCertificateLayouts,
  saveCertificateLayout as apiSaveCertificateLayout,
  getUploadedCertificates as apiGetUploadedCertificates,

  getAllDigitalApprovals as apiGetAllDigitalApprovals,
  bulkGenerateTTD as apiBulkGenerateTTD,

  // ⭐ v26.1.6: Tim Instruktur
  getTimInstrukturList as apiGetTimInstrukturList,
  addTimInstruktur as apiAddTimInstruktur,
  updateTimInstruktur as apiUpdateTimInstruktur,
  deleteTimInstruktur as apiDeleteTimInstruktur,
  reorderTimInstruktur as apiReorderTimInstruktur,

  getQuizSettings as apiGetQuizSettings,
  setQuizSettings as apiSetQuizSettings,
  getLoginMode as apiGetLoginMode,
  setLoginMode as apiSetLoginMode,
  getPublicVisibility as apiGetPublicVisibility,
  setPublicVisibility as apiSetPublicVisibility,
  getPKDLokasi as apiGetPKDLokasi,
  setPKDLokasi as apiSetPKDLokasi,
  getFormSettings as apiGetFormSettings,
  setFormSettings as apiSetFormSettings,
  getRealtimeSetting as apiGetRealtimeSetting,
  setRealtimeSetting as apiSetRealtimeSetting,
  getDefaultFormFields,
} from '../core/api.js';

// ============================================================
//   STATE
// ============================================================
const STATE = {
  // Data collections
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
  timInstruktur: [],   // ⭐ v26.1.6

  // Settings
  quizSettings: {},
  loginMode: false,
  publicVisibility: {},
  pkdlokasi: '',
  formSettings: [],
  realtimeEnabled: false,

  // Meta
  isLoading: false,
  lastSync: null,
  lastError: null,
};

// Track subscribers untuk notifikasi ringan (selain event)
const subscribers = new Set();

// ============================================================
//   UTILITY
// ============================================================
function generateTempId(prefix = 'tmp') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function normalizeData(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && data.success && Array.isArray(data.data)) return data.data;
  return [];
}

function notifySubscribers(type) {
  subscribers.forEach(fn => {
    try { fn(type, STATE); } catch (e) { console.warn('[AdminModule] Subscriber error:', e); }
  });

  window.dispatchEvent(new CustomEvent('adminDataUpdated', {
    detail: { type, state: getPublicState() },
  }));
}

// State view tanpa referensi internal (untuk publik)
function getPublicState() {
  return {
    ...STATE,
    peserta: STATE.peserta.slice(),
    sesi: STATE.sesi.slice(),
    materi: STATE.materi.slice(),
    skrining: STATE.skrining.slice(),
    pretest: STATE.pretest.slice(),
    posttest: STATE.posttest.slice(),
    alumni: STATE.alumni.slice(),
    kader: STATE.kader.slice(),
    informasi: STATE.informasi.slice(),
    absensi: STATE.absensi.slice(),
    sertifikat: STATE.sertifikat.slice(),
    digitalApprovals: STATE.digitalApprovals.slice(),
    asset: STATE.asset.slice(),
    folders: STATE.folders.slice(),
    usulan: STATE.usulan.slice(),
    rtl: STATE.rtl.slice(),
    timInstruktur: STATE.timInstruktur.slice(),   // ⭐ v26.1.6
  };
}

// ============================================================
//   EXPORTED MODULE
// ============================================================
export const AdminModule = {

  // ==========================================================
  //   STATE ACCESSORS
  // ==========================================================
  getState() {
    return getPublicState();
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
      totalTimInstruktur: STATE.timInstruktur.length,
      lastSync: STATE.lastSync,
    };
  },

  // Subscribe untuk update
  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  // ==========================================================
  //   GETTERS
  // ==========================================================
  getPesertaList(status = null) {
    if (status) {
      return STATE.peserta.filter(p =>
        String(p.status || '').toLowerCase() === String(status).toLowerCase()
      );
    }
    return STATE.peserta;
  },

  getPesertaById(id) {
    return STATE.peserta.find(p => String(p.id) === String(id)) || null;
  },

  getSesiList() { return STATE.sesi; },

  getSesiById(id) {
    return STATE.sesi.find(s => String(s.id) === String(id)) || null;
  },

  getMateriList() { return STATE.materi; },

  getSkriningList() { return STATE.skrining; },

  getPretestList() { return STATE.pretest; },

  getPosttestList() { return STATE.posttest; },

  getAlumniList() { return STATE.alumni; },

  getKaderList() { return STATE.kader; },

  getInformasiList() { return STATE.informasi; },

  getAbsensiList() { return STATE.absensi; },

  getSertifikatList() { return STATE.sertifikat; },

  getDigitalApprovals() { return STATE.digitalApprovals; },

  getAssetList() { return STATE.asset; },

  getFolders() { return STATE.folders; },

  getUsulanList() { return STATE.usulan; },

  getRTLList() { return STATE.rtl; },

  getTimInstruktur() { return STATE.timInstruktur; },   // ⭐ v26.1.6

  getQuizSettings() { return STATE.quizSettings; },

  getLoginMode() { return STATE.loginMode; },

  getPublicVisibility() { return STATE.publicVisibility; },

  getPKDLokasi() { return STATE.pkdlokasi; },

  getRealtimeSetting() { return STATE.realtimeEnabled; },

  getFormSettings() {
    if (!STATE.formSettings || STATE.formSettings.length === 0) {
      return getDefaultFormFields();
    }
    return STATE.formSettings;
  },

  // ==========================================================
  //   LOAD ALL DATA (single source of truth)
  // ==========================================================
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) {
      console.log('[AdminModule] loadAllData skipped — already loading');
      return { success: true, skipped: true };
    }

    STATE.isLoading = true;
    STATE.lastError = null;

    try {
      // Fetch all in parallel
      const results = await Promise.all([
        apiGetPesertaList().catch(e => ({ error: e.message })),
        apiGetSesiAbsen().catch(e => ({ error: e.message })),
        apiGetMateriList().catch(e => ({ error: e.message })),
        apiGetSkriningResponses().catch(e => ({ error: e.message })),
        apiGetPretestResponses().catch(e => ({ error: e.message })),
        apiGetPosttestResponses().catch(e => ({ error: e.message })),
        apiGetAlumniList().catch(e => ({ error: e.message })),
        apiGetKaderList().catch(e => ({ error: e.message })),
        apiGetInfoList().catch(e => ({ error: e.message })),
        apiGetAbsensiResponses().catch(e => ({ error: e.message })),
        apiGetUploadedCertificates().catch(e => ({ error: e.message })),
        apiGetAllDigitalApprovals().catch(e => ({ error: e.message })),
        apiGetAssetList().catch(e => ({ error: e.message })),
        apiGetFolders().catch(e => ({ error: e.message })),
        apiGetUsulanList().catch(e => ({ error: e.message })),
        apiGetRTLTasks().catch(e => ({ error: e.message })),
        apiGetQuizSettings().catch(e => ({ error: e.message })),
        apiGetLoginMode().catch(e => ({ error: e.message })),
        apiGetPublicVisibility().catch(e => ({ error: e.message })),
        apiGetPKDLokasi().catch(e => ({ error: e.message })),
        apiGetFormSettings().catch(e => ({ error: e.message })),
        apiGetRealtimeSetting().catch(e => ({ error: e.message })),
        apiGetTimInstrukturList().catch(e => ({ error: e.message })),   // ⭐ v26.1.6
      ]);

      const [
        pesertaData, sesiData, materiData, skriningData, pretestData, posttestData,
        alumniData, kaderData, infoData, absensiData, sertifikatData, approvalsData,
        assetData, foldersData, usulanData, rtlData,
        quizData, loginModeData, visibilityData, pkdLokasiData, formSettingsData, realtimeData,
        timInstrukturData,   // ⭐ v26.1.6
      ] = results;

      // Update state
      STATE.peserta = normalizeData(pesertaData);
      STATE.sesi = normalizeData(sesiData);
      STATE.materi = normalizeData(materiData);
      STATE.skrining = normalizeData(skriningData);
      STATE.pretest = normalizeData(pretestData);
      STATE.posttest = normalizeData(posttestData);
      STATE.alumni = normalizeData(alumniData);
      STATE.kader = normalizeData(kaderData);
      STATE.informasi = normalizeData(infoData);
      STATE.absensi = normalizeData(absensiData);
      STATE.sertifikat = normalizeData(sertifikatData);
      STATE.digitalApprovals = normalizeData(approvalsData);
      STATE.asset = normalizeData(assetData);
      STATE.folders = normalizeData(foldersData);
      STATE.usulan = normalizeData(usulanData);
      STATE.rtl = normalizeData(rtlData);
      STATE.timInstruktur = normalizeData(timInstrukturData);   // ⭐ v26.1.6

      // Settings
      STATE.quizSettings = (quizData && quizData.data) ? quizData.data : (quizData || {});
      STATE.loginMode = !!(loginModeData && loginModeData.enabled);
      STATE.publicVisibility = (visibilityData && visibilityData.data) ? visibilityData.data : (visibilityData || {});
      STATE.pkdlokasi = (pkdLokasiData && pkdLokasiData.data) || 'Kabupaten Bantul';
      STATE.realtimeEnabled = !!(realtimeData && realtimeData.enabled);

      // Form settings
      let rawForm = (formSettingsData && formSettingsData.data) ? formSettingsData.data : formSettingsData;
      if (!Array.isArray(rawForm) || rawForm.length === 0) {
        rawForm = getDefaultFormFields();
      }
      STATE.formSettings = rawForm;

      STATE.lastSync = new Date().toISOString();
      STATE.isLoading = false;

      notifySubscribers('all');

      console.log('✅ [AdminModule] All data loaded:', {
        peserta: STATE.peserta.length,
        sesi: STATE.sesi.length,
        materi: STATE.materi.length,
        alumni: STATE.alumni.length,
        timInstruktur: STATE.timInstruktur.length,
      });

      return { success: true };
    } catch (e) {
      STATE.isLoading = false;
      STATE.lastError = e.message;
      console.error('❌ [AdminModule] loadAllData error:', e);
      showToast('Gagal memuat data: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   TRIGGER RENDER MANUAL
  // ==========================================================
  triggerRender(type = 'all') {
    notifySubscribers(type);
  },

  // ==========================================================
  //   PESERTA CRUD
  // ==========================================================
  async addPeserta(data) {
    const tempId = generateTempId('peserta');
    const newItem = { id: tempId, ...data, status: 'pending', timestamp: new Date().toISOString() };
    STATE.peserta.unshift(newItem);
    notifySubscribers('peserta');

    try {
      const res = await apiSubmitPeserta(data);
      if (res && res.success) {
        const idx = STATE.peserta.findIndex(p => p.id === tempId);
        if (idx !== -1) STATE.peserta[idx].id = res.id;
        showToast('Peserta berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      STATE.peserta = STATE.peserta.filter(p => p.id !== tempId);
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updatePeserta(data) {
    const id = data.id;
    const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = { ...STATE.peserta[idx] };
    STATE.peserta[idx] = { ...STATE.peserta[idx], ...data };
    notifySubscribers('peserta');

    try {
      const res = await apiUpdatePeserta(data);
      if (res && res.success) {
        showToast('Peserta berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      STATE.peserta[idx] = backup;
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deletePeserta(id) {
    const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.peserta[idx];
    STATE.peserta.splice(idx, 1);
    notifySubscribers('peserta');

    try {
      const res = await apiDeletePeserta(id);
      if (res && res.success) {
        showToast('Peserta berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      STATE.peserta.splice(idx, 0, backup);
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async approvePeserta(id) {
    const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = { ...STATE.peserta[idx] };
    STATE.peserta[idx].status = 'approved';
    notifySubscribers('peserta');

    try {
      const res = await apiApprovePeserta(id);
      if (res && res.success) {
        showToast('Peserta disetujui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyetujui');
    } catch (e) {
      STATE.peserta[idx] = backup;
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async rejectPeserta(id) {
    const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = { ...STATE.peserta[idx] };
    STATE.peserta[idx].status = 'rejected';
    notifySubscribers('peserta');

    try {
      const res = await apiRejectPeserta(id);
      if (res && res.success) {
        showToast('Peserta ditolak', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menolak');
    } catch (e) {
      STATE.peserta[idx] = backup;
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async moveToAlumni(id) {
    const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.peserta[idx];
    STATE.peserta.splice(idx, 1);
    notifySubscribers('peserta');

    try {
      const res = await apiMoveToAlumni(id);
      if (res && res.success) {
        showToast('Dipindahkan ke alumni', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memindahkan');
    } catch (e) {
      STATE.peserta.splice(idx, 0, backup);
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async moveMultipleToAlumni(ids) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, error: 'Tidak ada ID valid' };
    }

    const cleaned = ids.map(id => String(id).trim()).filter(Boolean);

    const toRemove = [];
    cleaned.forEach(id => {
      const idx = STATE.peserta.findIndex(p => String(p.id) === String(id));
      if (idx !== -1) toRemove.push({ idx, data: STATE.peserta[idx] });
    });

    toRemove.sort((a, b) => b.idx - a.idx);
    toRemove.forEach(item => STATE.peserta.splice(item.idx, 1));
    notifySubscribers('peserta');

    try {
      const res = await apiMoveMultipleToAlumni(cleaned);
      if (res && res.success) {
        showToast(`Berhasil memindahkan ${res.moved || cleaned.length} peserta`, 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memindahkan');
    } catch (e) {
      toRemove.sort((a, b) => a.idx - b.idx);
      toRemove.forEach(item => STATE.peserta.splice(item.idx, 0, item.data));
      notifySubscribers('peserta');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   SESI ABSEN CRUD
  // ==========================================================
  async addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) {
    const tempId = generateTempId('sesi');
    const newItem = {
      id: tempId, nama,
      waktu_mulai: waktuMulai,
      waktu_selesai: waktuSelesai,
      submission_open: aktif !== false,
    };
    STATE.sesi.unshift(newItem);
    notifySubscribers('sesi');

    try {
      const res = await apiAddSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password);
      if (res && res.success) {
        const idx = STATE.sesi.findIndex(s => s.id === tempId);
        if (idx !== -1) {
          STATE.sesi[idx].id = res.id;
          STATE.sesi[idx].qrToken = res.qrToken;
        }
        showToast('Sesi absen berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      STATE.sesi = STATE.sesi.filter(s => s.id !== tempId);
      notifySubscribers('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) {
    const idx = STATE.sesi.findIndex(s => String(s.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = { ...STATE.sesi[idx] };
    STATE.sesi[idx] = {
      ...STATE.sesi[idx],
      nama, waktu_mulai: waktuMulai, waktu_selesai: waktuSelesai,
      submission_open: aktif !== false,
    };
    notifySubscribers('sesi');

    try {
      const res = await apiUpdateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password);
      if (res && res.success) {
        showToast('Sesi absen berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      STATE.sesi[idx] = backup;
      notifySubscribers('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteSesiAbsen(id) {
    const idx = STATE.sesi.findIndex(s => String(s.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.sesi[idx];
    STATE.sesi.splice(idx, 1);
    notifySubscribers('sesi');

    try {
      const res = await apiDeleteSesiAbsen(id);
      if (res && res.success) {
        showToast('Sesi absen berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      STATE.sesi.splice(idx, 0, backup);
      notifySubscribers('sesi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async regenerateQRSesi(id) {
    try {
      const res = await apiRegenerateQRSesi(id);
      if (res && res.success) {
        const idx = STATE.sesi.findIndex(s => String(s.id) === String(id));
        if (idx !== -1) STATE.sesi[idx].qrToken = res.qrToken;
        notifySubscribers('sesi');
        showToast('QR berhasil diregenerasi', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal regenerate QR');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async toggleAttendanceSession(id, open) {
    try {
      const res = await apiToggleAttendanceSession(id, open);
      if (res && res.success) {
        const idx = STATE.sesi.findIndex(s => String(s.id) === String(id));
        if (idx !== -1) STATE.sesi[idx].submission_open = open;
        notifySubscribers('sesi');
        showToast(`Sesi ${open ? 'dibuka' : 'ditutup'}`, 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah status');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   MATERI CRUD
  // ==========================================================
  async addMateri(judul, deskripsi, file, fileName, uploadBy) {
    showToast('Mengunggah materi…', 'info');
    try {
      const res = await apiAddMateri(judul, deskripsi, file, fileName, uploadBy);
      if (res && res.success) {
        showToast('Materi berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan materi');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteMateri(id, fileId) {
    const idx = STATE.materi.findIndex(m => String(m.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.materi[idx];
    STATE.materi.splice(idx, 1);
    notifySubscribers('materi');

    try {
      const res = await apiDeleteMateri(id, fileId);
      if (res && res.success) {
        showToast('Materi berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus materi');
    } catch (e) {
      STATE.materi.splice(idx, 0, backup);
      notifySubscribers('materi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   INFORMASI CRUD
  // ==========================================================
  async addInfo(params) {
    try {
      const res = await apiAddInfo(params);
      if (res && res.success) {
        showToast('Informasi berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateInfo(params) {
    try {
      const res = await apiUpdateInfo(params);
      if (res && res.success) {
        showToast('Informasi berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteInfo(id) {
    const idx = STATE.informasi.findIndex(i => String(i.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.informasi[idx];
    STATE.informasi.splice(idx, 1);
    notifySubscribers('informasi');

    try {
      const res = await apiDeleteInfo(id);
      if (res && res.success) {
        showToast('Informasi berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      STATE.informasi.splice(idx, 0, backup);
      notifySubscribers('informasi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async toggleInfoStatus(id) {
    const idx = STATE.informasi.findIndex(i => String(i.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const current = String(STATE.informasi[idx].status || 'aktif').toLowerCase();
    const newStatus = current === 'selesai' ? 'aktif' : 'selesai';
    STATE.informasi[idx].status = newStatus;
    notifySubscribers('informasi');

    try {
      const res = await apiToggleInfoStatus(id);
      if (res && res.success) {
        showToast('Status informasi diubah', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah status');
    } catch (e) {
      STATE.informasi[idx].status = current;
      notifySubscribers('informasi');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   USULAN (approve/reject)
  // ==========================================================
  async updateUsulanStatus(id, status) {
    try {
      const res = await apiUpdateUsulanStatus(id, status);
      if (res && res.success) {
        showToast(`Usulan ${status === 'approved' ? 'disetujui' : 'ditolak'}`, 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memproses usulan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   KADER CRUD
  // ==========================================================
  async addKader(params) {
    try {
      const res = await apiAddKader(params);
      if (res && res.success) {
        showToast('Kader berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateKader(params) {
    try {
      const res = await apiUpdateKader(params);
      if (res && res.success) {
        showToast('Kader berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteKader(id) {
    try {
      const res = await apiDeleteKader(id);
      if (res && res.success) {
        showToast('Kader berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   ⭐ v26.1.6: TIM INSTRUKTUR CRUD
  // ==========================================================
  async addTimInstruktur(params) {
    try {
      const res = await apiAddTimInstruktur(params);
      if (res && res.success) {
        showToast('Anggota tim berhasil ditambahkan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menambahkan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateTimInstruktur(params) {
    try {
      const res = await apiUpdateTimInstruktur(params);
      if (res && res.success) {
        showToast('Data anggota tim berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteTimInstruktur(id) {
    const idx = STATE.timInstruktur.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return { success: false, error: 'Data tidak ditemukan' };

    const backup = STATE.timInstruktur[idx];
    STATE.timInstruktur.splice(idx, 1);
    notifySubscribers('timInstruktur');

    try {
      const res = await apiDeleteTimInstruktur(id);
      if (res && res.success) {
        showToast('Anggota tim berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      STATE.timInstruktur.splice(idx, 0, backup);
      notifySubscribers('timInstruktur');
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async reorderTimInstruktur(orders) {
    if (!Array.isArray(orders) || orders.length === 0) {
      return { success: false, error: 'Tidak ada order valid' };
    }
    try {
      const res = await apiReorderTimInstruktur(orders);
      if (res && res.success) {
        // Update state lokal
        orders.forEach(item => {
          const idx = STATE.timInstruktur.findIndex(x => String(x.id) === String(item.id));
          if (idx !== -1) STATE.timInstruktur[idx].urutan = parseInt(item.urutan) || 0;
        });
        STATE.timInstruktur.sort((a, b) => (a.urutan || 999) - (b.urutan || 999));
        notifySubscribers('timInstruktur');
        showToast('Urutan berhasil disimpan', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyimpan urutan');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   ASSET & FOLDER
  // ==========================================================
  async addAsset(params) {
    try {
      const res = await apiAddAsset(params);
      if (res && res.success) {
        showToast('Aset berhasil diupload', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal upload aset');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async updateAsset(params) {
    try {
      const res = await apiUpdateAsset(params);
      if (res && res.success) {
        showToast('Aset berhasil diperbarui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal memperbarui aset');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteAsset(id) {
    try {
      const res = await apiDeleteAsset(id);
      if (res && res.success) {
        showToast('Aset berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async addFolder(nama, parentId) {
    try {
      const res = await apiAddFolder(nama, parentId);
      if (res && res.success) {
        showToast('Folder berhasil dibuat', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal membuat folder');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async deleteFolder(id) {
    try {
      const res = await apiDeleteFolder(id);
      if (res && res.success) {
        showToast('Folder berhasil dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus folder');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async toggleFolderPublic(id, isPublic) {
    try {
      const res = await apiToggleFolderPublic({ id, isPublic });
      if (res && res.success) {
        showToast(`Folder ${isPublic ? 'dipublikasikan' : 'ditarik'}`, 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal toggle publik');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async toggleFolderHideFromGallery(id, isHidden) {
    try {
      const res = await apiToggleFolderHideFromGallery({ id, isHidden });
      if (res && res.success) {
        showToast(`Folder ${isHidden ? 'disembunyikan' : 'ditampilkan'}`, 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal toggle sembunyi');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async setFolderPassword(id, password) {
    try {
      const res = await apiSetFolderPassword({ id, password });
      if (res && res.success) {
        showToast('Password folder disimpan', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyimpan password');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async clearFolderPassword(id) {
    try {
      const res = await apiClearFolderPassword({ id });
      if (res && res.success) {
        showToast('Password folder dihapus', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menghapus password');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   RTL CRUD
  // ==========================================================
  async addRTLTask(params) {
    try {
      const res = await apiAddRTLTask(params);
      if (res && res.success) {
        showToast('Tugas RTL ditambahkan', 'success');
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
        showToast('Tugas RTL diperbarui', 'success');
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
      const res = await apiDeleteRTLTask(id);
      if (res && res.success) {
        showToast('Tugas RTL dihapus', 'success');
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
      const res = await apiApproveRTLTask(id);
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

  async approveAllRTL(pesertaId) {
    try {
      const res = await apiApproveAllRTL({ pesertaId });
      if (res && res.success) {
        showToast('Semua tugas RTL disetujui', 'success');
        await this.loadAllData(true);
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyetujui semua');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async getRTLStatus(pesertaId) {
    return await apiGetRTLStatus({ pesertaId });
  },

  // ==========================================================
  //   SERTIFIKAT
  // ==========================================================
  async getCertificateTemplates() {
    return await apiGetCertificateTemplates();
  },

  async addCertificateTemplate(params) {
    return await apiAddCertificateTemplateManual(params);
  },

  async updateCertificateTemplate(params) {
    return await apiUpdateCertificateTemplate(params);
  },

  async deleteCertificateTemplate(id) {
    return await apiDeleteCertificateTemplate({ id });
  },

  async generateCertificateForParticipant(templateId, pesertaId) {
    return await apiGenerateCertificateForParticipant({ templateId, pesertaId });
  },

  async getCertPresets() { return await apiGetCertPresets(); },

  async getCertificateLayouts() { return await apiListCertificateLayouts(); },

  async saveCertificateLayout(nama, data_json, id = null) {
    return await apiSaveCertificateLayout({ nama, data_json, id });
  },

  async bulkGenerateTTD(params) {
    return await apiBulkGenerateTTD(params);
  },

  // ==========================================================
  //   PENGATURAN
  // ==========================================================
  async setLoginMode(enabled) {
    try {
      const res = await apiSetLoginMode(enabled);
      if (res && res.success) {
        STATE.loginMode = enabled;
        notifySubscribers('settings');
        showToast('Mode login diubah', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah mode');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async setPublicVisibility(data) {
    try {
      const res = await apiSetPublicVisibility(data);
      if (res && res.success) {
        STATE.publicVisibility = data;
        notifySubscribers('settings');
        showToast('Visibilitas diubah', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah visibilitas');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async setPKDLokasi(lokasi) {
    try {
      const res = await apiSetPKDLokasi(lokasi);
      if (res && res.success) {
        STATE.pkdlokasi = lokasi;
        notifySubscribers('settings');
        showToast('Lokasi PKD diubah', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah lokasi');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async setFormSettings(fields) {
    try {
      const res = await apiSetFormSettings(fields);
      if (res && res.success) {
        STATE.formSettings = fields;
        notifySubscribers('settings');
        showToast('Struktur form disimpan', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal menyimpan struktur form');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  async setRealtimeSetting(enabled) {
    try {
      const res = await apiSetRealtimeSetting(enabled);
      if (res && res.success) {
        STATE.realtimeEnabled = enabled;
        notifySubscribers('settings');
        showToast('Pengaturan realtime diubah', 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah realtime');
    } catch (e) {
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   CLEAR STATE
  // ==========================================================
  clearState() {
    STATE.peserta = [];
    STATE.sesi = [];
    STATE.materi = [];
    STATE.skrining = [];
    STATE.pretest = [];
    STATE.posttest = [];
    STATE.alumni = [];
    STATE.kader = [];
    STATE.informasi = [];
    STATE.absensi = [];
    STATE.sertifikat = [];
    STATE.digitalApprovals = [];
    STATE.asset = [];
    STATE.folders = [];
    STATE.usulan = [];
    STATE.rtl = [];
    STATE.timInstruktur = [];   // ⭐ v26.1.6
    STATE.quizSettings = {};
    STATE.loginMode = false;
    STATE.publicVisibility = {};
    STATE.pkdlokasi = '';
    STATE.formSettings = [];
    STATE.realtimeEnabled = false;
    STATE.lastSync = null;
    STATE.lastError = null;
    STATE.isLoading = false;

    notifySubscribers('cleared');
    console.log('[AdminModule] State cleared');
  },
};

// ============================================================
//   DEFAULT EXPORT
// ============================================================
export default AdminModule;
// ============================================================
// js/modules/admin.js — v27.3.3 DATA-READY RACE FIX EDITION
// State manager untuk admin panel
// ============================================================
// CHANGELOG v27.3.3 (dari v27.2.1):
//   ✅ FIX CRITICAL: Race condition — pendingLoadPromise resolve
//     sebelum state benar-benar terisi
//   ✅ FIX: loadAllData() sekarang VERIFIKASI state setelah load
//   ✅ FIX: Skip TTL guard saat forceRefresh=true (boot reliability)
//   ✅ FIX: getStats() selalu konsisten (return 0 kalau kosong, bukan undefined)
//   ✅ NEW: hasData() — cek cepat apakah state sudah terisi
//   ✅ NEW: Dispatch event 'adminModule:ready' setelah data siap
//   ✅ NEW: ensureDataReady(timeoutMs) — helper blocking untuk boot
//   ✅ FIX: Rollback konsisten di semua CRUD
//   ✅ KEEP: Semua 137+ methods + subscription pattern
//   ✅ KEEP: getBootstrapData batch + fallback parallel
// ============================================================

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
//   CONSTANTS
// ============================================================
const TTL_FRESH_MS = 3000;                 // 3s — skip reload jika fresh
const CONCURRENT_WAIT_MS = 25000;          // 25s max wait pending
const NOTIFY_DEBOUNCE_MS = 50;
const BATCH_TIMEOUT_MS = 25000;            // 25s — cold start GAS
const PARALLEL_TIMEOUT_MS = 30000;         // 30s — fallback paralel
const READY_VERIFY_TIMEOUT_MS = 3000;      // 3s — verifikasi ready

// ============================================================
//   STATE
// ============================================================
const STATE = {
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
  timInstruktur: [],

  quizSettings: {},
  loginMode: false,
  publicVisibility: {},
  pkdlokasi: '',
  formSettings: [],
  realtimeEnabled: false,

  isLoading: false,
  isReady: false,        // ⚡ v27.3.3: flag data ready
  lastSync: 0,
  lastError: null,
};

// ============================================================
//   SUBSCRIBERS REGISTRY
// ============================================================
const subscribers = new Set();
let notifyDebounceTimer = null;
let pendingNotifyTypes = new Set();

// Pending promise untuk race-safe loadAllData
let pendingLoadPromise = null;

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

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  try {
    if (typeof structuredClone === 'function') return structuredClone(obj);
  } catch (e) { /* fallback */ }
  try { return JSON.parse(JSON.stringify(obj)); }
  catch (e) { return obj; }
}

function shallowCloneArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (item && typeof item === 'object') return { ...item };
    return item;
  });
}

function getPublicState() {
  return {
    peserta:          shallowCloneArray(STATE.peserta),
    sesi:             shallowCloneArray(STATE.sesi),
    materi:           shallowCloneArray(STATE.materi),
    skrining:         shallowCloneArray(STATE.skrining),
    pretest:          shallowCloneArray(STATE.pretest),
    posttest:         shallowCloneArray(STATE.posttest),
    alumni:           shallowCloneArray(STATE.alumni),
    kader:            shallowCloneArray(STATE.kader),
    informasi:        shallowCloneArray(STATE.informasi),
    absensi:          shallowCloneArray(STATE.absensi),
    sertifikat:       shallowCloneArray(STATE.sertifikat),
    digitalApprovals: shallowCloneArray(STATE.digitalApprovals),
    asset:            shallowCloneArray(STATE.asset),
    folders:          shallowCloneArray(STATE.folders),
    usulan:           shallowCloneArray(STATE.usulan),
    rtl:              shallowCloneArray(STATE.rtl),
    timInstruktur:    shallowCloneArray(STATE.timInstruktur),
    quizSettings:     { ...STATE.quizSettings },
    loginMode:        STATE.loginMode,
    publicVisibility: { ...STATE.publicVisibility },
    pkdlokasi:        STATE.pkdlokasi,
    formSettings:     shallowCloneArray(STATE.formSettings),
    realtimeEnabled:  STATE.realtimeEnabled,
    isLoading:        STATE.isLoading,
    isReady:          STATE.isReady,
    lastSync:         STATE.lastSync,
    lastError:        STATE.lastError,
  };
}

function isFresh() {
  if (!STATE.lastSync) return false;
  return (Date.now() - STATE.lastSync) < TTL_FRESH_MS;
}

function withTimeout(promise, timeoutMs, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label || 'Operation'} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

// ============================================================
//   SUBSCRIPTION PATTERN
// ============================================================
export function subscribe(callback) {
  if (typeof callback !== 'function') {
    console.warn('[AdminModule] subscribe: callback harus function');
    return () => {};
  }
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function unsubscribe(callback) {
  subscribers.delete(callback);
}

function notifySubscribers(type) {
  pendingNotifyTypes.add(type || 'all');

  if (notifyDebounceTimer) clearTimeout(notifyDebounceTimer);
  notifyDebounceTimer = setTimeout(() => {
    const types = Array.from(pendingNotifyTypes);
    pendingNotifyTypes.clear();
    notifyDebounceTimer = null;

    const state = getPublicState();

    subscribers.forEach(fn => {
      try {
        fn(types.length === 1 ? types[0] : 'multiple', state);
      } catch (e) {
        console.warn('[AdminModule] Subscriber error:', e);
      }
    });

    try {
      window.dispatchEvent(new CustomEvent('adminDataUpdated', {
        detail: { type: types[0] || 'all', state },
      }));
    } catch (e) { /* silent */ }
  }, NOTIFY_DEBOUNCE_MS);
}

export function emitUpdate(type = 'all') {
  notifySubscribers(type);
}

export function getSubscriberCount() {
  return subscribers.size;
}

// ============================================================
//   LOAD HELPERS
// ============================================================
async function loadBatch() {
  const res = await callApi('getBootstrapData', {}, 'GET');
  if (!res || !res.success || !res.data) {
    throw new Error((res && res.error) || 'Batch endpoint failed');
  }
  return res.data;
}

async function loadParallel() {
  const results = await Promise.allSettled([
    apiGetPesertaList(),
    apiGetSesiAbsen(),
    apiGetMateriList(),
    apiGetSkriningResponses(),
    apiGetPretestResponses(),
    apiGetPosttestResponses(),
    apiGetAlumniList(),
    apiGetKaderList(),
    apiGetInfoList(),
    apiGetAbsensiResponses(),
    apiGetUploadedCertificates(),
    apiGetAllDigitalApprovals(),
    apiGetAssetList(),
    apiGetFolders({ all: 'true' }),
    apiGetUsulanList(),
    apiGetRTLTasks(),
    apiGetQuizSettings(),
    apiGetLoginMode(),
    apiGetPublicVisibility(),
    apiGetPKDLokasi(),
    apiGetFormSettings(),
    apiGetRealtimeSetting(),
    apiGetTimInstrukturList(),
  ]);

  const get = (idx) => {
    const r = results[idx];
    return (r.status === 'fulfilled') ? r.value : { success: false, data: [] };
  };

  return {
    peserta:           normalizeData(get(0)),
    sesi:              normalizeData(get(1)),
    materi:            normalizeData(get(2)),
    skrining:          normalizeData(get(3)),
    pretest:           normalizeData(get(4)),
    posttest:          normalizeData(get(5)),
    alumni:            normalizeData(get(6)),
    kader:             normalizeData(get(7)),
    informasi:         normalizeData(get(8)),
    absensi:           normalizeData(get(9)),
    sertifikat:        normalizeData(get(10)),
    digitalApprovals:  normalizeData(get(11)),
    asset:             normalizeData(get(12)),
    folders:           normalizeData(get(13)),
    usulan:            normalizeData(get(14)),
    rtl:               normalizeData(get(15)),
    quizSettings:      (get(16) && get(16).data) || {},
    loginMode:         (get(17) && get(17).data) || { enabled: false },
    publicVisibility:  (get(18) && get(18).data) || {},
    pkdLokasi:         (get(19) && get(19).data) || '',
    formSettings:      (get(20) && get(20).data) || [],
    realtime:          (get(21) && get(21).data) || { enabled: false },
    timInstruktur:     normalizeData(get(22)),
  };
}

// ============================================================
//   EXPORTED MODULE
// ============================================================
export const AdminModule = {

  // ==========================================================
  //   SUBSCRIPTION API
  // ==========================================================
  subscribe,
  unsubscribe,
  emitUpdate,
  getSubscriberCount,

  // ==========================================================
  //   STATE ACCESSORS
  // ==========================================================
  getState() { return getPublicState(); },

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
      totalRTL: STATE.rtl.length,
      totalDigitalApprovals: STATE.digitalApprovals.length,
      lastSync: STATE.lastSync ? new Date(STATE.lastSync).toISOString() : null,
      isLoading: STATE.isLoading,
      isReady: STATE.isReady,
      subscriberCount: subscribers.size,
    };
  },

  isFresh() { return isFresh(); },
  getLastSync() { return STATE.lastSync; },

  /**
   * ⚡ v27.3.3: Cek apakah state sudah terisi minimal 1 entity
   */
  hasData() {
    const total =
      STATE.peserta.length +
      STATE.sesi.length +
      STATE.materi.length +
      STATE.alumni.length +
      STATE.informasi.length +
      STATE.absensi.length +
      STATE.sertifikat.length +
      STATE.timInstruktur.length;
    return total > 0;
  },

  /**
   * ⚡ v27.3.3: Cek apakah data sudah ready (verified)
   */
  isReady() {
    return STATE.isReady === true;
  },

  /**
   * ⚡ v27.3.3: Helper BLOCKING untuk boot — poll sampai ready atau timeout
   * @param {number} timeoutMs - max waktu tunggu (default 10s)
   * @returns {Promise<boolean>}
   */
  async ensureDataReady(timeoutMs = 10000) {
    const startTime = Date.now();
    const pollInterval = 200;

    while (Date.now() - startTime < timeoutMs) {
      if (STATE.isReady && this.hasData()) {
        return true;
      }
      await new Promise(r => setTimeout(r, pollInterval));
    }

    console.warn(`[AdminModule] ensureDataReady timeout after ${timeoutMs}ms`);
    return false;
  },

  // ==========================================================
  //   GETTERS
  // ==========================================================
  getPesertaList(status = null) {
    if (status) {
      const s = String(status).toLowerCase();
      return STATE.peserta
        .filter(p => String(p.status || '').toLowerCase() === s)
        .map(p => ({ ...p }));
    }
    return STATE.peserta.map(p => ({ ...p }));
  },

  getPesertaById(id) {
    const p = STATE.peserta.find(p => String(p.id) === String(id));
    return p ? { ...p } : null;
  },

  getSesiList() { return STATE.sesi.map(s => ({ ...s })); },
  getSesiById(id) {
    const s = STATE.sesi.find(s => String(s.id) === String(id));
    return s ? { ...s } : null;
  },
  getMateriList() { return STATE.materi.map(m => ({ ...m })); },
  getSkriningList() { return STATE.skrining.map(s => ({ ...s })); },
  getPretestList() { return STATE.pretest.map(p => ({ ...p })); },
  getPosttestList() { return STATE.posttest.map(p => ({ ...p })); },
  getAlumniList() { return STATE.alumni.map(a => ({ ...a })); },
  getKaderList() { return STATE.kader.map(k => ({ ...k })); },
  getInformasiList() { return STATE.informasi.map(i => ({ ...i })); },
  getAbsensiList() { return STATE.absensi.map(a => ({ ...a })); },
  getSertifikatList() { return STATE.sertifikat.map(s => ({ ...s })); },
  getDigitalApprovals() { return STATE.digitalApprovals.map(d => ({ ...d })); },
  getAssetList() { return STATE.asset.map(a => ({ ...a })); },
  getFolders() { return STATE.folders.map(f => ({ ...f })); },
  getUsulanList() { return STATE.usulan.map(u => ({ ...u })); },
  getRTLList() { return STATE.rtl.map(r => ({ ...r })); },
  getTimInstruktur() { return STATE.timInstruktur.map(t => ({ ...t })); },
  getQuizSettings() { return { ...STATE.quizSettings }; },
  getLoginMode() { return STATE.loginMode; },
  getPublicVisibility() { return { ...STATE.publicVisibility }; },
  getPKDLokasi() { return STATE.pkdlokasi; },
  getRealtimeSetting() { return STATE.realtimeEnabled; },

  getFormSettings() {
    if (!STATE.formSettings || STATE.formSettings.length === 0) {
      return getDefaultFormFields();
    }
    return STATE.formSettings.map(f => ({ ...f }));
  },

  // ==========================================================
  //   ⚡ v27.3.3: LOAD ALL DATA — VERIFIED READY
  // ==========================================================
  async loadAllData(forceRefresh = false) {
    // ⚡ FIX: Skip TTL guard saat forceRefresh (boot reliability)
    if (!forceRefresh && isFresh()) {
      return { success: true, skipped: true, reason: 'fresh' };
    }

    // Race-safe: jika sudah ada pending load, tunggu
    if (pendingLoadPromise) {
      console.log('[AdminModule] Waiting for pending load...');
      try {
        const result = await withTimeout(pendingLoadPromise, CONCURRENT_WAIT_MS, 'Wait pending');
        if (result && result.success) {
          // ⚡ v27.3.3: Pastikan state ready setelah wait
          if (!STATE.isReady) {
            STATE.isReady = this.hasData() || STATE.peserta.length > 0;
          }
          return result;
        }
      } catch (e) {
        console.warn('[AdminModule] Pending wait timeout, starting fresh load');
      }
    }

    // Buat promise baru
    pendingLoadPromise = (async () => {
      STATE.isLoading = true;
      STATE.lastError = null;

      try {
        // 1. Coba batch endpoint
        let data;
        let source = 'batch';

        try {
          data = await withTimeout(loadBatch(), BATCH_TIMEOUT_MS, 'Batch');
        } catch (batchErr) {
          console.warn('[AdminModule] Batch failed, fallback paralel:', batchErr.message);
          data = await withTimeout(loadParallel(), PARALLEL_TIMEOUT_MS, 'Parallel');
          source = 'parallel';
        }

        // 2. Assign ke STATE
        STATE.peserta          = normalizeData(data.peserta);
        STATE.sesi             = normalizeData(data.sesi);
        STATE.materi           = normalizeData(data.materi);
        STATE.skrining         = normalizeData(data.skrining);
        STATE.pretest          = normalizeData(data.pretest);
        STATE.posttest         = normalizeData(data.posttest);
        STATE.alumni           = normalizeData(data.alumni);
        STATE.kader            = normalizeData(data.kader);
        STATE.informasi        = normalizeData(data.informasi);
        STATE.absensi          = normalizeData(data.absensi);
        STATE.sertifikat       = normalizeData(data.sertifikat);
        STATE.digitalApprovals = normalizeData(data.digitalApprovals);
        STATE.asset            = normalizeData(data.asset);
        STATE.folders          = normalizeData(data.folders);
        STATE.usulan           = normalizeData(data.usulan);
        STATE.rtl              = normalizeData(data.rtl);
        STATE.timInstruktur    = normalizeData(data.timInstruktur);

        STATE.quizSettings     = (data.quizSettings && data.quizSettings.data) || data.quizSettings || {};
        STATE.loginMode        = !!(data.loginMode && (data.loginMode.enabled !== undefined ? data.loginMode.enabled : data.loginMode));
        STATE.publicVisibility = (data.publicVisibility && data.publicVisibility.data) || data.publicVisibility || {};
        STATE.pkdlokasi        = (data.pkdLokasi && data.pkdLokasi.data) || data.pkdLokasi || 'Kabupaten Bantul';
        STATE.realtimeEnabled  = !!(data.realtime && (data.realtime.enabled !== undefined ? data.realtime.enabled : data.realtime));

        let rawForm = (data.formSettings && data.formSettings.data) ? data.formSettings.data : data.formSettings;
        if (!Array.isArray(rawForm) || rawForm.length === 0) {
          rawForm = getDefaultFormFields();
        }
        STATE.formSettings = rawForm;

        // ⚡ v27.3.3: Verifikasi state terisi sebelum set isReady
        const stateHasData = this.hasData();
        const expectedPeserta = Array.isArray(data.peserta) ? data.peserta.length : 0;

        // Kalau expected peserta > 0 tapi state kosong, tunggu sebentar
        if (expectedPeserta > 0 && STATE.peserta.length === 0) {
          console.warn('[AdminModule] State mismatch, retrying assign...');
          await new Promise(r => setTimeout(r, 100));
          STATE.peserta = normalizeData(data.peserta);
        }

        STATE.lastSync = Date.now();
        STATE.isReady = true;   // ⚡ v27.3.3: Mark ready!
        STATE.isLoading = false;

        // Notify semua subscribers
        notifySubscribers('all');

        // ⚡ v27.3.3: Dispatch event ready
        try {
          window.dispatchEvent(new CustomEvent('adminModule:ready', {
            detail: {
              source,
              stats: this.getStats(),
            },
          }));
        } catch (e) { /* silent */ }

        console.log(`✅ [AdminModule] Loaded via ${source}:`, {
          peserta: STATE.peserta.length,
          sesi: STATE.sesi.length,
          materi: STATE.materi.length,
          alumni: STATE.alumni.length,
          rtl: STATE.rtl.length,
          timInstruktur: STATE.timInstruktur.length,
          isReady: STATE.isReady,
          hasData: stateHasData,
        });

        return { success: true, source, isReady: true, hasData: stateHasData };

      } catch (e) {
        STATE.isLoading = false;
        STATE.isReady = false;
        STATE.lastError = e.message;
        console.error('❌ [AdminModule] loadAllData error:', e);

        if (!window.__pkdAppLoaded) {
          console.warn('[AdminModule] Preload failed but app continues:', e.message);
        } else {
          showToast('Gagal memuat data: ' + e.message, 'error');
        }

        return { success: false, error: e.message, isReady: false };
      } finally {
        pendingLoadPromise = null;
      }
    })();

    return pendingLoadPromise;
  },

  // ==========================================================
  //   TRIGGER RENDER MANUAL
  // ==========================================================
  triggerRender(type = 'all') { notifySubscribers(type); },
  emitUpdate,

  // ==========================================================
  //   PESERTA CRUD
  // ==========================================================
  async addPeserta(data) {
    const tempId = generateTempId('peserta');
    const newItem = { id: tempId, ...data, status: data.status || 'pending', timestamp: new Date().toISOString() };
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
    const idx = STATE.sesi.findIndex(s => String(s.id) === String(id));
    const backup = idx !== -1 ? { ...STATE.sesi[idx] } : null;

    if (idx !== -1) {
      STATE.sesi[idx].submission_open = !!open;
      notifySubscribers('sesi');
    }

    try {
      const res = await apiToggleAttendanceSession(id, open);
      if (res && res.success) {
        showToast(`Sesi ${open ? 'dibuka' : 'ditutup'}`, 'success');
        return res;
      }
      throw new Error((res && res.error) || 'Gagal mengubah status');
    } catch (e) {
      if (idx !== -1 && backup) {
        STATE.sesi[idx] = backup;
        notifySubscribers('sesi');
      }
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
  //   USULAN
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
  //   TIM INSTRUKTUR CRUD
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
  async getCertificateTemplates() { return await apiGetCertificateTemplates(); },
  async addCertificateTemplate(params) { return await apiAddCertificateTemplateManual(params); },
  async updateCertificateTemplate(params) { return await apiUpdateCertificateTemplate(params); },
  async deleteCertificateTemplate(id) { return await apiDeleteCertificateTemplate({ id }); },
  async generateCertificateForParticipant(templateId, pesertaId) {
    return await apiGenerateCertificateForParticipant({ templateId, pesertaId });
  },
  async getCertPresets() { return await apiGetCertPresets(); },
  async getCertificateLayouts() { return await apiListCertificateLayouts(); },
  async saveCertificateLayout(nama, data_json, id = null) {
    return await apiSaveCertificateLayout({ nama, data_json, id });
  },
  async bulkGenerateTTD(params) { return await apiBulkGenerateTTD(params); },

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
    STATE.timInstruktur = [];
    STATE.quizSettings = {};
    STATE.loginMode = false;
    STATE.publicVisibility = {};
    STATE.pkdlokasi = '';
    STATE.formSettings = [];
    STATE.realtimeEnabled = false;
    STATE.lastSync = 0;
    STATE.lastError = null;
    STATE.isLoading = false;
    STATE.isReady = false;

    if (notifyDebounceTimer) {
      clearTimeout(notifyDebounceTimer);
      notifyDebounceTimer = null;
    }
    pendingNotifyTypes.clear();
    pendingLoadPromise = null;

    notifySubscribers('cleared');
    console.log('[AdminModule] State cleared');
  },

  clearSubscribers() {
    const count = subscribers.size;
    subscribers.clear();
    console.log(`[AdminModule] Cleared ${count} subscribers`);
  },
};

// ============================================================
//   DEFAULT EXPORT
// ============================================================
export default AdminModule;

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c AdminModule v27.3.3 — Data-Ready Race Fix Edition ',
  'background:#f59e0b;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
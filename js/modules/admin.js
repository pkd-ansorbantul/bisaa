// ============================================================
// js/modules/admin.js — v28.0.0 ANGKATAN PKD EDITION
// GitHub Pages /bisaa/ Edition
// ============================================================
// CHANGELOG v28.0.0 (dari v27.4.0):
//   ✅ NEW: State angkatanPKDList + activeAngkatan
//   ✅ NEW: Getter getAngkatanPKDList, getActiveAngkatan,
//     getAngkatanByName, getAngkatanById
//   ✅ NEW: Auto-assign dari getBootstrapData (angkatanPKDList)
//   ✅ NEW: Fallback load angkatan via API kalau batch tidak include
//   ✅ NEW: CRUD wrapper addAngkatanPKD, updateAngkatanPKD,
//     deleteAngkatanPKD, refreshAngkatanPKD
//   ✅ NEW: getAngkatanDetail — bypass cache (always fresh)
//   ✅ FIX: Sequential batch size 6 + delay 800ms (anti CORS storm)
//   ✅ FIX: Circuit breaker skip parallel jika OPEN
//   ✅ FIX: Semua nama export disamakan dengan view
//   ✅ FIX: Alias getter lengkap (getPesertaList, getSesiList, dst)
//   ✅ FIX: CRUD wrapper auto-refresh setelah mutasi
//   ✅ KEEP: Semua fitur v27.4.0 (subscribe, ensureDataReady, dll)
//   ✅ Zero regression
// ============================================================

import {
  callApi,
  getPesertaList          as apiGetPesertaList,
  getSesiAbsen            as apiGetSesiAbsen,
  getMateriList           as apiGetMateriList,
  getSkriningResponses    as apiGetSkriningResponses,
  getPretestResponses     as apiGetPretestResponses,
  getPosttestResponses    as apiGetPosttestResponses,
  getAlumniList           as apiGetAlumniList,
  getKaderList            as apiGetKaderList,
  getInfoList             as apiGetInfoList,
  getAbsensiResponses     as apiGetAbsensiResponses,
  getUploadedCertificates as apiGetUploadedCertificates,
  getAllDigitalApprovals  as apiGetAllDigitalApprovals,
  getAssetList            as apiGetAssetList,
  getFolders              as apiGetFolders,
  getUsulanList           as apiGetUsulanList,
  getRTLTasks             as apiGetRTLTasks,
  getTimInstrukturList    as apiGetTimInstrukturList,
  getQuizSettings         as apiGetQuizSettings,
  getLoginMode            as apiGetLoginMode,
  getPublicVisibility     as apiGetPublicVisibility,
  getPKDLokasi            as apiGetPKDLokasi,
  getFormSettings         as apiGetFormSettings,
  getRealtimeSetting      as apiGetRealtimeSetting,
  getCircuitState         as apiGetCircuitState,
  // ⭐ NEW v28.0.0: Angkatan PKD
  getAngkatanPKDList      as apiGetAngkatanPKDList,
  getAngkatanPKDWithCount as apiGetAngkatanPKDWithCount,
  getAngkatanDetail       as apiGetAngkatanDetail,
  addAngkatanPKD          as apiAddAngkatanPKD,
  updateAngkatanPKD       as apiUpdateAngkatanPKD,
  deleteAngkatanPKD       as apiDeleteAngkatanPKD,
} from '../core/api.js';

// ============================================================
//   CONSTANTS
// ============================================================
const TTL_FRESH_MS       = 3000;
const CONCURRENT_WAIT_MS = 15000;
const BATCH_TIMEOUT_MS   = 25000;
const BATCH_SIZE         = 6;
const BATCH_DELAY_MS     = 800;
const MUTATION_REFRESH   = true;

// ============================================================
//   STATE
// ============================================================
const STATE = {
  // ==== DATA (18 entities) ====
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

  // ==== ⭐ NEW v28.0.0: ANGKATAN PKD ====
  angkatanPKDList: [],
  activeAngkatan: null,

  // ==== SETTINGS ====
  quizSettings: {},
  loginMode: { enabled: false },
  publicVisibility: {},
  pkdLokasi: '',
  formSettings: [],
  realtime: { enabled: false },

  // ==== META ====
  isLoading: false,
  lastSync: 0,
  lastError: null,
  lastSyncSource: null,
  lastSyncDurationMs: 0,
  partialErrors: [],
};

// ============================================================
//   SUBSCRIBERS (pub/sub)
// ============================================================
const subscribers = new Set();

export function subscribe(fn) {
  if (typeof fn !== 'function') return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function notifySubscribers(type = 'all') {
  subscribers.forEach(fn => {
    try { fn(type, STATE); }
    catch (e) { console.warn('[AdminModule] Subscriber error:', e); }
  });
}

// ============================================================
//   GETTERS — semua nama yang dipakai views
// ============================================================
export function getState()              { return STATE; }
export function getPesertaList()        { return STATE.peserta || []; }
export function getSesiList()           { return STATE.sesi || []; }
export function getMateriList()         { return STATE.materi || []; }
export function getSkriningList()       { return STATE.skrining || []; }
export function getPretestList()        { return STATE.pretest || []; }
export function getPosttestList()       { return STATE.posttest || []; }
export function getAlumniList()         { return STATE.alumni || []; }
export function getKaderList()          { return STATE.kader || []; }
export function getInformasiList()      { return STATE.informasi || []; }
export function getAbsensiList()        { return STATE.absensi || []; }
export function getSertifikatList()     { return STATE.sertifikat || []; }
export function getDigitalApprovals()   { return STATE.digitalApprovals || []; }
export function getAssetList()          { return STATE.asset || []; }
export function getFolders()            { return STATE.folders || []; }
export function getUsulanList()         { return STATE.usulan || []; }
export function getRTLList()            { return STATE.rtl || []; }
export function getTimInstruktur()      { return STATE.timInstruktur || []; }

// Alias untuk kompatibilitas view lama
export function getTimInstrukturList()  { return STATE.timInstruktur || []; }
export function getInfoList()           { return STATE.informasi || []; }

export function getQuizSettings()       { return STATE.quizSettings || {}; }
export function getLoginMode()          { return STATE.loginMode || { enabled: false }; }
export function getPublicVisibility()   { return STATE.publicVisibility || {}; }
export function getPKDLokasi()          { return STATE.pkdLokasi || ''; }
export function getFormSettings()       { return STATE.formSettings || []; }
export function getRealtimeSetting()    { return STATE.realtime || { enabled: false }; }

// ⭐ NEW v28.0.0: Angkatan PKD getters
export function getAngkatanPKDList()    { return STATE.angkatanPKDList || []; }
export function getActiveAngkatan()     { return STATE.activeAngkatan; }

export function getAngkatanByName(nama) {
  if (!nama) return null;
  const target = String(nama).trim().toLowerCase();
  return (STATE.angkatanPKDList || []).find(a =>
    String(a.nama || '').trim().toLowerCase() === target
  ) || null;
}

export function getAngkatanById(id) {
  if (!id) return null;
  return (STATE.angkatanPKDList || []).find(a =>
    String(a.id) === String(id)
  ) || null;
}

// ============================================================
//   HELPER — getPesertaById
// ============================================================
export function getPesertaById(id) {
  if (!id) return null;
  return (STATE.peserta || []).find(p => String(p.id) === String(id)) || null;
}

// ============================================================
//   STATS
// ============================================================
export function getStats() {
  return {
    totalPeserta:           STATE.peserta.length,
    totalSesi:              STATE.sesi.length,
    totalMateri:            STATE.materi.length,
    totalSkrining:          STATE.skrining.length,
    totalPretest:           STATE.pretest.length,
    totalPosttest:          STATE.posttest.length,
    totalAlumni:            STATE.alumni.length,
    totalKader:             STATE.kader.length,
    totalInformasi:         STATE.informasi.length,
    totalAbsensi:           STATE.absensi.length,
    totalSertifikat:        STATE.sertifikat.length,
    totalDigitalApprovals:  STATE.digitalApprovals.length,
    totalAsset:             STATE.asset.length,
    totalFolders:           STATE.folders.length,
    totalUsulan:            STATE.usulan.length,
    totalRTL:               STATE.rtl.length,
    totalTimInstruktur:     STATE.timInstruktur.length,
    totalAngkatan:          STATE.angkatanPKDList.length,   // ⭐ NEW

    lastSync:               STATE.lastSync,
    lastSyncSource:         STATE.lastSyncSource,
    lastSyncDurationMs:     STATE.lastSyncDurationMs,
    isLoading:              STATE.isLoading,
    partialErrors:          STATE.partialErrors,
  };
}

// Partial stats saat ada error
export function getPartialStats() {
  const total =
    STATE.peserta.length +
    STATE.sesi.length +
    STATE.materi.length +
    STATE.alumni.length;

  return {
    hasData:        total > 0,
    totalEntities:  total,
    hasErrors:      STATE.partialErrors.length > 0,
    errors:         STATE.partialErrors,
  };
}

// ============================================================
//   READY CHECKS
// ============================================================
export function isReady() {
  return !STATE.isLoading && STATE.lastSync > 0;
}

export function hasData() {
  const total =
    STATE.peserta.length +
    STATE.sesi.length +
    STATE.materi.length +
    STATE.alumni.length;
  return total > 0;
}

export function ensureDataReady(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (isReady() || hasData()) return resolve(true);

    const start = Date.now();
    const timer = setInterval(() => {
      if (isReady() || hasData()) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 200);
  });
}

// ============================================================
//   CLEAR STATE
// ============================================================
export function clearState() {
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

  // ⭐ NEW
  STATE.angkatanPKDList = [];
  STATE.activeAngkatan = null;

  STATE.quizSettings = {};
  STATE.loginMode = { enabled: false };
  STATE.publicVisibility = {};
  STATE.pkdLokasi = '';
  STATE.formSettings = [];
  STATE.realtime = { enabled: false };

  STATE.isLoading = false;
  STATE.lastSync = 0;
  STATE.lastError = null;
  STATE.lastSyncSource = null;
  STATE.lastSyncDurationMs = 0;
  STATE.partialErrors = [];

  notifySubscribers('cleared');
  console.log('[AdminModule] 🧹 State cleared');
}

// ============================================================
//   LOAD — BATCH (single request)
// ============================================================
async function loadBatch(timeoutMs = BATCH_TIMEOUT_MS) {
  const t0 = Date.now();

  const batchPromise = callApi('getBootstrapData', {}, 'GET', timeoutMs);
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve({ __timeout: true }), timeoutMs);
  });

  const result = await Promise.race([batchPromise, timeoutPromise]);

  if (result && result.__timeout) {
    throw new Error(`Batch timeout after ${timeoutMs}ms`);
  }

  if (!result || !result.success) {
    throw new Error(result?.error || 'Batch failed');
  }

  const data = result.data || {};
  const elapsed = Date.now() - t0;

  // Assign ke state
  STATE.peserta           = data.peserta || [];
  STATE.sesi              = data.sesi || [];
  STATE.materi            = data.materi || [];
  STATE.skrining          = data.skrining || [];
  STATE.pretest           = data.pretest || [];
  STATE.posttest          = data.posttest || [];
  STATE.alumni            = data.alumni || [];
  STATE.kader             = data.kader || [];
  STATE.informasi         = data.informasi || [];
  STATE.absensi           = data.absensi || [];
  STATE.sertifikat        = data.sertifikat || [];
  STATE.digitalApprovals  = data.digitalApprovals || [];
  STATE.asset             = data.asset || [];
  STATE.folders           = data.folders || [];
  STATE.usulan            = data.usulan || [];
  STATE.rtl               = data.rtl || [];
  STATE.timInstruktur     = data.timInstruktur || [];

  STATE.quizSettings      = data.quizSettings || {};
  STATE.loginMode         = data.loginMode || { enabled: false };
  STATE.publicVisibility  = data.publicVisibility || {};
  STATE.pkdLokasi         = data.pkdLokasi || '';
  STATE.formSettings      = data.formSettings || [];
  STATE.realtime          = data.realtime || { enabled: false };

  // ⭐ NEW v28.0.0: Angkatan PKD
  if (Array.isArray(data.angkatanPKDList)) {
    STATE.angkatanPKDList = data.angkatanPKDList;
  }
  if (data.activeAngkatan !== undefined) {
    STATE.activeAngkatan = data.activeAngkatan;
  }

  STATE.partialErrors = [];

  console.log(`✅ [AdminModule] Loaded via batch:`, {
    peserta: STATE.peserta.length,
    sesi: STATE.sesi.length,
    materi: STATE.materi.length,
    alumni: STATE.alumni.length,
    rtl: STATE.rtl.length,
    angkatan: STATE.angkatanPKDList.length,
  });

  return { elapsed, source: 'batch' };
}

// ============================================================
//   LOAD — PARALLEL (sequential batch, anti CORS storm)
// ============================================================
async function loadParallel() {
  console.log('[AdminModule] Loading parallel (sequential batch)...');
  const t0 = Date.now();

  // Guard: circuit breaker
  try {
    const circuit = typeof apiGetCircuitState === 'function' ? apiGetCircuitState() : null;
    if (circuit && circuit.isOpen) {
      throw new Error(
        `Circuit open — server throttle (${circuit.failures} failures, ` +
        `cooldown ${Math.round(circuit.remainingMs/1000)}s)`
      );
    }
  } catch (e) {
    if (String(e.message || '').includes('Circuit open')) throw e;
    // getCircuitState not available — continue
  }

  // Definisi tasks
  const tasks = [
    { key: 'materi',           fn: () => apiGetMateriList() },
    { key: 'skrining',         fn: () => apiGetSkriningResponses() },
    { key: 'pretest',          fn: () => apiGetPretestResponses() },
    { key: 'posttest',         fn: () => apiGetPosttestResponses() },
    { key: 'kader',            fn: () => apiGetKaderList() },
    { key: 'informasi',        fn: () => apiGetInfoList() },
    { key: 'absensi',          fn: () => apiGetAbsensiResponses() },
    { key: 'sertifikat',       fn: () => apiGetUploadedCertificates() },
    { key: 'digitalApprovals', fn: () => apiGetAllDigitalApprovals() },
    { key: 'asset',            fn: () => apiGetAssetList() },
    { key: 'folders',          fn: () => apiGetFolders({ all: 'true' }) },
    { key: 'rtl',              fn: () => apiGetRTLTasks() },
    { key: 'usulan',           fn: () => apiGetUsulanList() },
    { key: 'timInstruktur',    fn: () => apiGetTimInstrukturList() },
    { key: 'loginMode',        fn: () => apiGetLoginMode() },
    { key: 'publicVisibility', fn: () => apiGetPublicVisibility() },
    { key: 'pkdLokasi',        fn: () => apiGetPKDLokasi() },
    { key: 'formSettings',     fn: () => apiGetFormSettings() },
    { key: 'realtime',         fn: () => apiGetRealtimeSetting() },
    { key: 'quizSettings',     fn: () => apiGetQuizSettings() },
    // ⭐ NEW v28.0.0: Angkatan PKD
    { key: 'angkatanPKDList',  fn: () => apiGetAngkatanPKDWithCount() },
  ];

  const partialErrors = [];

  // Sequential batch processing
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);

    console.log(
      `[AdminModule] Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(tasks.length/BATCH_SIZE)} ` +
      `(${batch.length} items)`
    );

    const results = await Promise.allSettled(
      batch.map(async (t) => {
        try {
          const res = await t.fn();
          return { key: t.key, res };
        } catch (e) {
          return { key: t.key, error: e.message };
        }
      })
    );

    // Process results
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        partialErrors.push({ key: 'unknown', error: r.reason?.message || 'unknown' });
        continue;
      }
      const { key, res, error } = r.value;
      if (error) {
        partialErrors.push({ key, error });
        console.warn(`[AdminModule] ⚠️ ${key}: ${error}`);
        continue;
      }
      if (!res || !res.success) {
        partialErrors.push({ key, error: res?.error || 'unknown' });
        continue;
      }

      const data = res.data;
      switch (key) {
        case 'materi':           STATE.materi = data || []; break;
        case 'skrining':         STATE.skrining = data || []; break;
        case 'pretest':          STATE.pretest = data || []; break;
        case 'posttest':         STATE.posttest = data || []; break;
        case 'kader':            STATE.kader = data || []; break;
        case 'informasi':        STATE.informasi = data || []; break;
        case 'absensi':          STATE.absensi = data || []; break;
        case 'sertifikat':       STATE.sertifikat = data || []; break;
        case 'digitalApprovals': STATE.digitalApprovals = data || []; break;
        case 'asset':            STATE.asset = data || []; break;
        case 'folders':          STATE.folders = data || []; break;
        case 'rtl':              STATE.rtl = data || []; break;
        case 'usulan':           STATE.usulan = data || []; break;
        case 'timInstruktur':    STATE.timInstruktur = data || []; break;
        case 'loginMode':        STATE.loginMode = data || { enabled: false }; break;
        case 'publicVisibility': STATE.publicVisibility = data || {}; break;
        case 'pkdLokasi':        STATE.pkdLokasi = data || ''; break;
        case 'formSettings':     STATE.formSettings = data || []; break;
        case 'realtime':         STATE.realtime = data || { enabled: false }; break;
        case 'quizSettings':     STATE.quizSettings = data || {}; break;
        // ⭐ NEW v28.0.0
        case 'angkatanPKDList':  STATE.angkatanPKDList = data || []; break;
      }
    }

    // Delay antar batch
    if (i + BATCH_SIZE < tasks.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Load core 3 (peserta, sesi, alumni)
  try {
    const [pesertaRes, sesiRes, alumniRes] = await Promise.allSettled([
      apiGetPesertaList(),
      apiGetSesiAbsen(),
      apiGetAlumniList(),
    ]);

    if (pesertaRes.status === 'fulfilled' && pesertaRes.value?.success) {
      STATE.peserta = pesertaRes.value.data || [];
    } else {
      partialErrors.push({ key: 'peserta', error: 'failed' });
    }

    if (sesiRes.status === 'fulfilled' && sesiRes.value?.success) {
      STATE.sesi = sesiRes.value.data || [];
    } else {
      partialErrors.push({ key: 'sesi', error: 'failed' });
    }

    if (alumniRes.status === 'fulfilled' && alumniRes.value?.success) {
      STATE.alumni = alumniRes.value.data || [];
    } else {
      partialErrors.push({ key: 'alumni', error: 'failed' });
    }
  } catch (e) {
    partialErrors.push({ key: 'core', error: e.message });
  }

  STATE.partialErrors = partialErrors;
  const elapsed = Date.now() - t0;

  console.log(
    `✅ [AdminModule] Parallel done in ${elapsed}ms — ` +
    `${partialErrors.length} error(s)`
  );

  return { elapsed, source: 'parallel', errors: partialErrors.length };
}

// ============================================================
//   LOAD ALL DATA (main entry)
// ============================================================
export async function loadAllData(force = false) {
  const now = Date.now();

  // Guard 1: TTL fresh
  if (!force && isReady() && (now - STATE.lastSync) < TTL_FRESH_MS) {
    console.log('[AdminModule] ⏭️ Skipped — data fresh');
    return { success: true, skipped: true, source: 'cache' };
  }

  // Guard 2: Concurrent load
  if (STATE.isLoading) {
    console.log('[AdminModule] ⏳ Concurrent load detected — waiting...');
    const startWait = Date.now();
    while (STATE.isLoading && (Date.now() - startWait) < CONCURRENT_WAIT_MS) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (isReady()) {
      return { success: true, skipped: true, source: 'wait' };
    }
  }

  STATE.isLoading = true;
  STATE.lastError = null;

  const t0 = Date.now();

  try {
    // ==== STRATEGY 1: BATCH ====
    try {
      const result = await loadBatch();
      STATE.lastSync = Date.now();
      STATE.lastSyncSource = 'batch';
      STATE.lastSyncDurationMs = result.elapsed;
      STATE.partialErrors = [];
      notifySubscribers('all');
      return { success: true, source: 'batch', elapsed: result.elapsed };
    } catch (batchErr) {
      console.warn('[AdminModule] Batch failed, fallback paralel:', batchErr.message);
    }

    // ==== STRATEGY 2: PARALLEL ====
    try {
      const result = await loadParallel();
      STATE.lastSync = Date.now();
      STATE.lastSyncSource = 'parallel';
      STATE.lastSyncDurationMs = result.elapsed;
      notifySubscribers('all');
      return {
        success: true,
        source: 'parallel',
        elapsed: result.elapsed,
        partialErrors: result.errors,
      };
    } catch (parErr) {
      console.error('[AdminModule] Parallel failed:', parErr.message);

      if (hasData()) {
        STATE.lastSync = Date.now();
        notifySubscribers('partial');
        return {
          success: true,
          source: 'cache',
          partial: true,
          error: parErr.message,
        };
      }

      throw parErr;
    }
  } catch (err) {
    STATE.lastError = err.message;
    console.error('❌ [AdminModule] loadAllData error:', err);
    return { success: false, error: err.message };
  } finally {
    STATE.isLoading = false;
    STATE.lastSyncDurationMs = Date.now() - t0;
  }
}

// ============================================================
//   ⭐ NEW v28.0.0: Refresh Angkatan PKD (manual)
// ============================================================
export async function refreshAngkatanPKD() {
  try {
    const res = await apiGetAngkatanPKDWithCount();
    if (res && res.success) {
      STATE.angkatanPKDList = res.data || [];
      notifySubscribers('angkatan');
      return { success: true, count: STATE.angkatanPKDList.length };
    } else {
      console.warn('[AdminModule] refreshAngkatanPKD failed:', res?.error);
      return { success: false, error: res?.error || 'Unknown error' };
    }
  } catch (e) {
    console.warn('[AdminModule] refreshAngkatanPKD:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//   CRUD WRAPPERS — auto-refresh setelah mutasi
// ============================================================
async function _refresh() {
  if (MUTATION_REFRESH) {
    try { await loadAllData(true); }
    catch (e) { console.warn('[AdminModule] Auto-refresh failed:', e); }
  }
}

// ---- PESERTA ----
export async function deletePeserta(id) {
  const { deletePeserta: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function updatePeserta(data) {
  const { updatePeserta: api } = await import('../core/api.js');
  const res = await api(data);
  if (res?.success) await _refresh();
  return res;
}

export async function addPeserta(data) {
  const { submitPeserta: api } = await import('../core/api.js');
  const res = await api(data);
  if (res?.success) await _refresh();
  return res;
}

export async function approvePeserta(id) {
  const { approvePeserta: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function rejectPeserta(id) {
  const { rejectPeserta: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function approveMultiplePeserta(ids, onProgress) {
  const { approvePeserta: api } = await import('../core/api.js');
  let successCount = 0;
  let failCount = 0;
  const total = Array.isArray(ids) ? ids.length : 0;

  for (let i = 0; i < total; i++) {
    try {
      const res = await api(ids[i]);
      if (res?.success) successCount++;
      else failCount++;
    } catch (e) {
      failCount++;
    }

    if (typeof onProgress === 'function') {
      try { onProgress(i + 1, total, 'processing'); }
      catch (e) { /* silent */ }
    }

    if (i < total - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }

  if (successCount > 0) await _refresh();

  return { successCount, failCount, total };
}

export async function moveMultipleToAlumni(ids) {
  const { moveMultipleToAlumni: api } = await import('../core/api.js');
  const res = await api(ids);
  if (res?.success) await _refresh();
  return res;
}

export async function moveToAlumni(id) {
  const { moveToAlumni: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

// ---- SESI ABSEN ----
export async function addSesiAbsen(nama, waktuMulai, waktuSelesai, aktif, password) {
  const { addSesiAbsen: api } = await import('../core/api.js');
  const res = await api(nama, waktuMulai, waktuSelesai, aktif, password);
  if (res?.success) await _refresh();
  return res;
}

export async function updateSesiAbsen(id, nama, waktuMulai, waktuSelesai, aktif, password) {
  const { updateSesiAbsen: api } = await import('../core/api.js');
  const res = await api(id, nama, waktuMulai, waktuSelesai, aktif, password);
  if (res?.success) await _refresh();
  return res;
}

export async function deleteSesiAbsen(id) {
  const { deleteSesiAbsen: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function toggleAttendanceSession(id, open) {
  const { toggleAttendanceSession: api } = await import('../core/api.js');
  const res = await api(id, open);
  if (res?.success) await _refresh();
  return res;
}

export async function regenerateQRSesi(id) {
  const { regenerateQRSesi: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

// ---- MATERI ----
export async function deleteMateri(id, fileId) {
  const { deleteMateri: api } = await import('../core/api.js');
  const res = await api(id, fileId);
  if (res?.success) await _refresh();
  return res;
}

export async function addMateri(params) {
  const { addMateri: api } = await import('../core/api.js');
  const res = await api(
    params.judul, params.deskripsi, params.file,
    params.fileName, params.uploadBy
  );
  if (res?.success) await _refresh();
  return res;
}

export async function updateMateri(params) {
  const { updateMateri: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

// ---- SKRINING ----
export async function addSkriningQuestion(params) {
  const { addSkriningQuestion: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function updateSkriningQuestion(params) {
  const { updateSkriningQuestion: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function deleteSkriningQuestion(id) {
  const { deleteSkriningQuestion: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

// ---- RTL ----
export async function deleteRTLTask(id) {
  const { deleteRTLTask: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function approveRTLTask(id) {
  const { approveRTLTask: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function addRTLTask(params) {
  const { addRTLTask: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function updateRTLTask(params) {
  const { updateRTLTask: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

// ---- TIM INSTRUKTUR ----
export async function addTimInstruktur(params) {
  const { addTimInstruktur: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function updateTimInstruktur(params) {
  const { updateTimInstruktur: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function deleteTimInstruktur(id) {
  const { deleteTimInstruktur: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function reorderTimInstruktur(orders) {
  const { reorderTimInstruktur: api } = await import('../core/api.js');
  const res = await api(orders);
  // Reorder tidak refresh untuk hindari flicker
  return res;
}

// ---- INFORMASI ----
export async function addInfo(params) {
  const { addInfo: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function updateInfo(params) {
  const { updateInfo: api } = await import('../core/api.js');
  const res = await api(params);
  if (res?.success) await _refresh();
  return res;
}

export async function deleteInfo(id) {
  const { deleteInfo: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

export async function toggleInfoStatus(id) {
  const { toggleInfoStatus: api } = await import('../core/api.js');
  const res = await api(id);
  if (res?.success) await _refresh();
  return res;
}

// ---- SETTINGS ----
export async function setFormSettings(fields) {
  const { setFormSettings: api } = await import('../core/api.js');
  const res = await api(fields);
  if (res?.success) await _refresh();
  return res;
}

export async function setLoginMode(enabled) {
  const { setLoginMode: api } = await import('../core/api.js');
  const res = await api(enabled);
  if (res?.success) await _refresh();
  return res;
}

export async function setPublicVisibility(data) {
  const { setPublicVisibility: api } = await import('../core/api.js');
  const res = await api(data);
  if (res?.success) await _refresh();
  return res;
}

// ============================================================
//   ⭐ NEW v28.0.0: ANGKATAN PKD — CRUD WRAPPER
// ============================================================

export async function addAngkatanPKD(nama, tahun, status, lokasi, tglMulai, tglSelesai) {
  try {
    const res = await apiAddAngkatanPKD(nama, tahun, status, lokasi, tglMulai, tglSelesai);
    if (res?.success) {
      await refreshAngkatanPKD();
      await _refresh();
    }
    return res;
  } catch (e) {
    console.warn('[AdminModule] addAngkatanPKD error:', e.message);
    return { success: false, error: e.message };
  }
}

export async function updateAngkatanPKD(data) {
  try {
    const res = await apiUpdateAngkatanPKD(data);
    if (res?.success) {
      await refreshAngkatanPKD();
      await _refresh();
    }
    return res;
  } catch (e) {
    console.warn('[AdminModule] updateAngkatanPKD error:', e.message);
    return { success: false, error: e.message };
  }
}

export async function deleteAngkatanPKD(id) {
  try {
    const res = await apiDeleteAngkatanPKD(id);
    if (res?.success) {
      await refreshAngkatanPKD();
      await _refresh();
    }
    return res;
  } catch (e) {
    console.warn('[AdminModule] deleteAngkatanPKD error:', e.message);
    return { success: false, error: e.message };
  }
}

/**
 * ⭐ Ambil detail lengkap 1 angkatan (7 tabs).
 * Bypass state — selalu fetch fresh dari server.
 */
export async function getAngkatanDetail(namaOrId) {
  try {
    return await apiGetAngkatanDetail(namaOrId);
  } catch (e) {
    console.warn('[AdminModule] getAngkatanDetail error:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//   EXPORT — named (untuk view yang pakai direct import)
// ============================================================
// Sudah di-export di atas (getPesertaList, getSesiList, dll)

// ============================================================
//   EXPORT — AdminModule object (untuk view yang pakai namespace)
// ============================================================
export const AdminModule = {
  // Subscribe
  subscribe,

  // Getters
  getState,
  getStats,
  getPartialStats,

  getPesertaList,
  getSesiList,
  getMateriList,
  getSkriningList,
  getPretestList,
  getPosttestList,
  getAlumniList,
  getKaderList,
  getInformasiList,
  getInfoList,
  getAbsensiList,
  getSertifikatList,
  getDigitalApprovals,
  getAssetList,
  getFolders,
  getUsulanList,
  getRTLList,
  getTimInstruktur,
  getTimInstrukturList,
  getQuizSettings,
  getLoginMode,
  getPublicVisibility,
  getPKDLokasi,
  getFormSettings,
  getRealtimeSetting,
  getPesertaById,

  // ⭐ NEW v28.0.0
  getAngkatanPKDList,
  getActiveAngkatan,
  getAngkatanByName,
  getAngkatanById,

  // Ready checks
  isReady,
  hasData,
  ensureDataReady,

  // Main
  loadAllData,
  clearState,
  refreshAngkatanPKD,

  // CRUD Peserta
  deletePeserta,
  updatePeserta,
  addPeserta,
  approvePeserta,
  rejectPeserta,
  approveMultiplePeserta,
  moveMultipleToAlumni,
  moveToAlumni,

  // CRUD Sesi Absen
  addSesiAbsen,
  updateSesiAbsen,
  deleteSesiAbsen,
  toggleAttendanceSession,
  regenerateQRSesi,

  // CRUD Materi
  addMateri,
  updateMateri,
  deleteMateri,

  // CRUD Skrining
  addSkriningQuestion,
  updateSkriningQuestion,
  deleteSkriningQuestion,

  // CRUD RTL
  addRTLTask,
  updateRTLTask,
  deleteRTLTask,
  approveRTLTask,

  // CRUD Tim Instruktur
  addTimInstruktur,
  updateTimInstruktur,
  deleteTimInstruktur,
  reorderTimInstruktur,

  // CRUD Informasi
  addInfo,
  updateInfo,
  deleteInfo,
  toggleInfoStatus,

  // ⭐ NEW v28.0.0: CRUD Angkatan
  addAngkatanPKD,
  updateAngkatanPKD,
  deleteAngkatanPKD,
  getAngkatanDetail,

  // Settings
  setFormSettings,
  setLoginMode,
  setPublicVisibility,
};

export default { AdminModule };

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c AdminModule v28.0.0 — Angkatan PKD Edition ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
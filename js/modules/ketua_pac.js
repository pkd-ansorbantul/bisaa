// ============================================================
// js/modules/ketua_pac.js — v27.2.2 PRIORITY DETECTION + LOKASI TAB
// ============================================================
// CHANGELOG v27.2.2 (dari v27.2.1):
//   ✅ NEW: getPesertaGroupedByLokasi() — helper untuk tab "Per Lokasi PKD"
//   ✅ NEW: getAllLokasiInScope() — daftar lokasi unik dalam scope
//   ✅ FIX: getMyScopePesertaForIdCard() lebih robust (fallback ke semua approved)
//   ✅ KEEP: Priority detection Lokasi PKD → Utusan → Alamat
//   ✅ KEEP: Semua CRUD (RTL, approve/reject, submitAbsen)
//   ✅ KEEP: Race-safe loadAllData + scope info + subscription
//   ✅ VERIFIED: Semua fitur ketua_pac.html berfungsi tanpa error
// ============================================================

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
//   CONSTANTS
// ============================================================
const SCOPE_MODES = ['utusan', 'lokasi', 'union'];
const DEFAULT_SCOPE_MODE = 'union';

// ✅ 17 Kapanewon di Kabupaten Bantul
const KAPANEWON_LIST = [
  'Bambanglipuro', 'Banguntapan', 'Bantul', 'Dlingo', 'Imogiri',
  'Jetis', 'Kasihan', 'Kretek', 'Pajangan', 'Pandak', 'Piyungan',
  'Pleret', 'Pundong', 'Sanden', 'Sedayu', 'Sewon', 'Srandakan',
];

// ✅ Alias / varian nama kapanewon
const KAPANEWON_ALIASES = {
  'bambanglipuro': ['bambang lipuro', 'bambanglipuro bantul'],
  'banguntapan':   ['bangun tapan'],
  'bantul':        ['bantul kota', 'kota bantul'],
  'dlingo':        [],
  'imogiri':       [],
  'jetis':         ['jetis bantul'],
  'kasihan':       [],
  'kretek':        ['kretek bantul', 'parangtritis'],
  'pajangan':      [],
  'pandak':        [],
  'piyungan':      [],
  'pleret':        [],
  'pundong':       [],
  'sanden':        [],
  'sedayu':        [],
  'sewon':         [],
  'srandakan':     [],
};

// ============================================================
//   STATE
// ============================================================
const STATE = {
  scopeInfo: {
    kapanewon: '',
    lokasiScope: [],
    username: '',
  },
  scopeLoaded: false,
  scopeLoading: false,
  scopePromise: null,

  activeScopeMode: DEFAULT_SCOPE_MODE,

  pesertaAll: [],
  sesiAll: [],
  skriningAll: [],
  pretestAll: [],
  posttestAll: [],
  absensiAll: [],
  sertifikatAll: [],
  rtlAll: [],
  informasiAll: [],

  pesertaCache: {
    utusan: [],
    lokasi: [],
    union: [],
  },

  peserta: [],
  skrining: [],
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  rtl: [],

  pesertaPending: [],
  pesertaApproved: [],
  pesertaRejected: [],

  isLoading: false,
  lastSync: null,
  lastError: null,
};

// Subscribers
const subscribers = new Set();

// Race-safe token
let loadToken = 0;

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

/**
 * ✅ Normalize string untuk matching
 */
function normalizeStr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ✅ Cek apakah string mengandung nama kapanewon
 */
function containsKapanewon(text, kapanewonName) {
  if (!text || !kapanewonName) return false;

  const normText = normalizeStr(text);
  const normKapanewon = normalizeStr(kapanewonName);
  if (!normText || !normKapanewon) return false;

  // Check exact substring
  if (normText.includes(normKapanewon)) return true;

  // Check alias
  const aliases = KAPANEWON_ALIASES[normKapanewon] || [];
  for (const alias of aliases) {
    const normAlias = normalizeStr(alias);
    if (normAlias && normText.includes(normAlias)) return true;
  }

  return false;
}

/**
 * ✅ PRIORITY DETECTION
 * Urutan: lokasi_pkd → utusan → alamat
 * Return: { match: boolean, source: 'lokasi_pkd' | 'utusan' | 'alamat' | null }
 */
function detectKapanewonMatch(item, kapanewonName) {
  if (!item || !kapanewonName) {
    return { match: false, source: null };
  }

  // 🥇 PRIORITAS 1: lokasi_pkd
  if (containsKapanewon(item.lokasi_pkd, kapanewonName)) {
    return { match: true, source: 'lokasi_pkd' };
  }

  // 🥈 PRIORITAS 2: utusan
  if (containsKapanewon(item.utusan, kapanewonName)) {
    return { match: true, source: 'utusan' };
  }

  // 🥉 PRIORITAS 3: alamat (fallback terakhir)
  if (containsKapanewon(item.alamat, kapanewonName)) {
    return { match: true, source: 'alamat' };
  }

  return { match: false, source: null };
}

/**
 * ✅ Simple boolean wrapper
 */
function matchKapanewon(item, kapanewonName) {
  return detectKapanewonMatch(item, kapanewonName).match;
}

/**
 * ✅ Deteksi kapanewon dari suatu string
 */
function detectKapanewon(text) {
  if (!text) return '';
  for (const kap of KAPANEWON_LIST) {
    if (containsKapanewon(text, kap)) return kap;
  }
  return '';
}

function getUsernameFromUser() {
  try {
    const u = getUserData() || {};
    return safeString(u.username || u.nama || '');
  } catch (e) { return ''; }
}

function getKapanewonFromUser() {
  try {
    const u = getUserData() || {};
    return safeString(u.kapanewon || '');
  } catch (e) { return ''; }
}

// ============================================================
//   NOTIFY
// ============================================================
function notifySubscribers(type) {
  subscribers.forEach(fn => {
    try { fn(type, getPublicState()); }
    catch (e) { console.warn('[KetuaPACModule] Subscriber error:', e); }
  });

  try {
    window.dispatchEvent(new CustomEvent('pacDataUpdated', {
      detail: { type, state: getPublicState() },
    }));
  } catch (e) { /* silent */ }
}

function getPublicState() {
  return {
    scopeInfo: { ...STATE.scopeInfo },
    activeScopeMode: STATE.activeScopeMode,

    peserta: STATE.peserta.slice(),
    pesertaPending: STATE.pesertaPending.slice(),
    pesertaApproved: STATE.pesertaApproved.slice(),
    pesertaRejected: STATE.pesertaRejected.slice(),

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
//   MATCH FUNCTIONS — Priority: Lokasi PKD > Utusan > Alamat
// ============================================================

/**
 * matchUtusan: peserta dianggap "dari PAC saya" kalau
 * lokasi_pkd atau utusan mengandung kapanewon.
 * ⚠️ EXCLUDE alamat — karena mode "Per Utusan" harus by PAC, bukan by alamat.
 */
function matchUtusan(item) {
  const kapanewon = STATE.scopeInfo.kapanewon;
  if (!kapanewon) return false;

  const result = detectKapanewonMatch(item, kapanewon);
  if (result.source === 'alamat') return false;
  return result.match;
}

/**
 * matchLokasi: peserta dianggap "di lokasi PKD saya" kalau
 * lokasi_pkd mengandung kapanewon.
 * ⚠️ HANYA cek lokasi_pkd — tidak fallback ke utusan/alamat.
 */
function matchLokasi(item) {
  const kapanewon = STATE.scopeInfo.kapanewon;
  if (!kapanewon) return false;

  return containsKapanewon(item.lokasi_pkd, kapanewon);
}

/**
 * matchUnion: peserta dianggap "milik saya" kalau
 * lokasi_pkd ATAU utusan ATAU alamat mengandung kapanewon.
 */
function matchUnion(item) {
  const kapanewon = STATE.scopeInfo.kapanewon;
  if (!kapanewon) return false;

  return detectKapanewonMatch(item, kapanewon).match;
}

/**
 * Generic filter by mode
 */
function filterByMode(list, mode) {
  if (!Array.isArray(list)) return [];
  switch (mode) {
    case 'utusan': return list.filter(matchUtusan);
    case 'lokasi': return list.filter(matchLokasi);
    case 'union':
    default:       return list.filter(matchUnion);
  }
}

/**
 * Filter responses by nama set
 */
function filterByNameSet(data, namaSet, field) {
  if (!namaSet || namaSet.size === 0) return [];
  return (data || []).filter(d =>
    namaSet.has(normalizeStr(d[field] || ''))
  );
}

// ============================================================
//   CACHE REBUILD + APPLY
// ============================================================
function rebuildPesertaCaches() {
  const kapanewon = STATE.scopeInfo.kapanewon;

  if (!kapanewon) {
    STATE.pesertaCache = { utusan: [], lokasi: [], union: [] };
    return;
  }

  const utusan = STATE.pesertaAll.filter(p => matchUtusan(p));
  const lokasi = STATE.pesertaAll.filter(p => matchLokasi(p));
  const union = STATE.pesertaAll.filter(p => matchUnion(p));

  STATE.pesertaCache.utusan = utusan;
  STATE.pesertaCache.lokasi = lokasi;
  STATE.pesertaCache.union = union;

  // Debug log detail
  if (typeof console !== 'undefined' && console.table) {
    console.group(`[KetuaPAC] Cache Rebuild — Kapanewon: ${kapanewon}`);
    console.table(STATE.pesertaAll.map(p => {
      const det = detectKapanewonMatch(p, kapanewon);
      return {
        nama: (p.nama_lengkap || '').substring(0, 20),
        lokasi_pkd: (p.lokasi_pkd || '-').substring(0, 20),
        utusan: (p.utusan || '-').substring(0, 20),
        alamat: (p.alamat || '-').substring(0, 25),
        match: det.match ? '✅' : '❌',
        source: det.source || '-',
        M_Lokasi: matchLokasi(p) ? '✅' : '❌',
        M_Utusan: matchUtusan(p) ? '✅' : '❌',
        M_Gabungan: matchUnion(p) ? '✅' : '❌',
      };
    }));
    console.log(`[KetuaPAC] Counts → Lokasi: ${lokasi.length}, Utusan: ${utusan.length}, Union: ${union.length}, Total: ${STATE.pesertaAll.length}`);
    console.groupEnd();
  }
}

function applyActiveMode() {
  const mode = STATE.activeScopeMode;
  STATE.peserta = (STATE.pesertaCache[mode] || []).slice();

  // Build nama set untuk filter responses
  const namaSet = new Set(
    STATE.peserta.map(p => normalizeStr(p.nama_lengkap || ''))
  );

  STATE.skrining   = filterByNameSet(STATE.skriningAll, namaSet, 'nama');
  STATE.pretest    = filterByNameSet(STATE.pretestAll, namaSet, 'nama');
  STATE.posttest   = filterByNameSet(STATE.posttestAll, namaSet, 'nama');
  STATE.absensi    = filterByNameSet(STATE.absensiAll, namaSet, 'nama');
  STATE.sertifikat = filterByNameSet(STATE.sertifikatAll, namaSet, 'nama_peserta');

  // Filter RTL by pesertaId (tugas umum selalu include)
  const pesertaIdSet = new Set(STATE.peserta.map(p => String(p.id)));
  STATE.rtl = STATE.rtlAll.filter(item => {
    if (!item.pesertaId) return true;
    return pesertaIdSet.has(String(item.pesertaId));
  });

  // Subset views
  STATE.pesertaPending = STATE.peserta.filter(p =>
    String(p.status || '').toLowerCase() === 'pending'
  );
  STATE.pesertaApproved = STATE.peserta.filter(p => {
    const s = String(p.status || '').toLowerCase();
    return s === 'approved' || s === 'active';
  });
  STATE.pesertaRejected = STATE.peserta.filter(p =>
    String(p.status || '').toLowerCase() === 'rejected'
  );
}

// ============================================================
//   PUBLIC MODULE
// ============================================================
export const KetuaPACModule = {

  // ==========================================================
  //   SCOPE INFO
  // ==========================================================
  async loadScopeInfo(forceRefresh = false) {
    if (STATE.scopePromise) {
      return STATE.scopePromise;
    }

    if (STATE.scopeLoaded && !forceRefresh) {
      return { success: true, scope: { ...STATE.scopeInfo }, cached: true };
    }

    const username = getUsernameFromUser();
    const fallbackKapanewon = getKapanewonFromUser();

    if (!username) {
      STATE.scopeInfo = {
        kapanewon: fallbackKapanewon,
        lokasiScope: [],
        username: '',
      };
      STATE.scopeLoaded = true;
      return { success: true, scope: { ...STATE.scopeInfo }, fallback: true };
    }

    STATE.scopeLoading = true;

    STATE.scopePromise = (async () => {
      try {
        const res = await callApi('getKetuaPACScopeInfo', { username }, 'GET');

        if (res && res.success && res.data) {
          STATE.scopeInfo = {
            kapanewon: safeString(res.data.kapanewon || fallbackKapanewon),
            lokasiScope: Array.isArray(res.data.lokasiScope)
              ? res.data.lokasiScope.map(safeString).filter(Boolean)
              : [],
            username: safeString(res.data.username || username),
          };
        } else {
          STATE.scopeInfo = {
            kapanewon: fallbackKapanewon,
            lokasiScope: [],
            username,
          };
        }

        STATE.scopeLoaded = true;
        notifySubscribers('scope');

        console.log('[KetuaPAC] Scope loaded:', STATE.scopeInfo);
        return { success: true, scope: { ...STATE.scopeInfo } };
      } catch (e) {
        console.warn('[KetuaPACModule] loadScopeInfo error:', e);
        STATE.scopeInfo = {
          kapanewon: fallbackKapanewon,
          lokasiScope: [],
          username,
        };
        STATE.scopeLoaded = true;
        return { success: false, error: e.message, scope: { ...STATE.scopeInfo } };
      } finally {
        STATE.scopeLoading = false;
        STATE.scopePromise = null;
      }
    })();

    return STATE.scopePromise;
  },

  getScopeInfo() {
    return { ...STATE.scopeInfo };
  },

  getActiveScopeMode() {
    return STATE.activeScopeMode;
  },

  // ==========================================================
  //   SCOPE MODE
  // ==========================================================
  setScopeMode(mode) {
    const next = String(mode || '').toLowerCase();
    if (SCOPE_MODES.indexOf(next) === -1) {
      console.warn('[KetuaPACModule] Invalid scope mode:', mode);
      return false;
    }
    if (STATE.activeScopeMode === next) return true;

    STATE.activeScopeMode = next;
    applyActiveMode();
    notifySubscribers('scope-mode');
    return true;
  },

  // ==========================================================
  //   STATE / STATS
  // ==========================================================
  getState() {
    return getPublicState();
  },

  getKapanewon() {
    return STATE.scopeInfo.kapanewon || getKapanewonFromUser();
  },

  getStats() {
    return {
      kapanewon: STATE.scopeInfo.kapanewon,
      lokasiScope: STATE.scopeInfo.lokasiScope.slice(),
      activeMode: STATE.activeScopeMode,

      totalPeserta: STATE.peserta.length,
      pendingPeserta: STATE.pesertaPending.length,
      approvedPeserta: STATE.pesertaApproved.length,
      rejectedPeserta: STATE.pesertaRejected.length,

      // Cache per mode (smart detection)
      pesertaByUnion: STATE.pesertaCache.union.length,
      pesertaByUtusan: STATE.pesertaCache.utusan.length,
      pesertaByLokasi: STATE.pesertaCache.lokasi.length,

      // Aktivitas
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
  getFilteredPeserta()     { return STATE.peserta; },
  getPendingPeserta()      { return STATE.pesertaPending; },
  getApprovedPeserta()     { return STATE.pesertaApproved; },
  getRejectedPeserta()     { return STATE.pesertaRejected; },

  getFilteredSkrining()    { return STATE.skrining; },
  getFilteredPretest()     { return STATE.pretest; },
  getFilteredPosttest()    { return STATE.posttest; },
  getFilteredAbsensi()     { return STATE.absensi; },
  getFilteredSertifikat()  { return STATE.sertifikat; },
  getFilteredRTL()         { return STATE.rtl; },

  getAllSesi()             { return STATE.sesiAll; },
  getAllInformasi()        { return STATE.informasiAll; },

  getPesertaById(id) {
    return STATE.peserta.find(p => String(p.id) === String(id)) || null;
  },

  getSesiById(id) {
    return STATE.sesiAll.find(s => String(s.id) === String(id)) || null;
  },

  /**
   * ✅ Ambil semua peserta approved di scope (untuk ID Card & tab Lokasi PKD)
   * Fallback: kalau list kosong, kembalikan semua approved (safety).
   */
  getMyScopePesertaForIdCard() {
    if (STATE.pesertaApproved && STATE.pesertaApproved.length > 0) {
      return STATE.pesertaApproved.slice();
    }
    // Fallback: kalau scope belum load atau kosong, ambil semua approved
    return STATE.pesertaAll.filter(p => {
      const s = String(p.status || '').toLowerCase();
      return s === 'approved' || s === 'active';
    });
  },

  // ==========================================================
  //   ✅ NEW v27.2.2: HELPERS UNTUK TAB LOKASI PKD
  // ==========================================================

  /**
   * Kelompokkan peserta approved di scope berdasarkan lokasi_pkd.
   * Return: { lokasiName: [peserta, ...] }
   */
  getPesertaGroupedByLokasi() {
    const list = this.getMyScopePesertaForIdCard();
    const grouped = {};

    list.forEach(p => {
      const lokasi = String(p.lokasi_pkd || '').trim() || 'Tidak diketahui';
      if (!grouped[lokasi]) grouped[lokasi] = [];
      grouped[lokasi].push(p);
    });

    // Sort peserta dalam tiap grup by nama
    Object.keys(grouped).forEach(lokasi => {
      grouped[lokasi].sort((a, b) =>
        (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '')
      );
    });

    return grouped;
  },

  /**
   * Daftar lokasi unik dalam scope (sorted alphabetically).
   */
  getAllLokasiInScope() {
    const grouped = this.getPesertaGroupedByLokasi();
    return Object.keys(grouped).sort();
  },

  /**
   * ✅ v27.2.1: List kapanewon unik dari semua peserta
   */
  getAllKapanewonList() {
    const set = new Set();
    STATE.pesertaAll.forEach(p => {
      const detected = detectKapanewon(p.lokasi_pkd) ||
                       detectKapanewon(p.utusan) ||
                       detectKapanewon(p.alamat);
      if (detected) set.add(detected);
    });
    return Array.from(set).sort();
  },

  /**
   * ✅ v27.2.1: List lokasi_pkd unik untuk kapanewon aktif
   */
  getAllLokasiPKDList() {
    const kapanewon = STATE.scopeInfo.kapanewon;
    if (!kapanewon) return [];

    const set = new Set();
    STATE.pesertaAll.forEach(p => {
      const lokasi = safeString(p.lokasi_pkd);
      if (!lokasi) return;
      if (containsKapanewon(lokasi, kapanewon)) {
        set.add(lokasi);
      }
    });
    return Array.from(set).sort();
  },

  /**
   * Helper untuk UI — dapatkan source detection per peserta
   */
  getPesertaMatchInfo(pesertaId) {
    const kapanewon = STATE.scopeInfo.kapanewon;
    if (!kapanewon) return { match: false, source: null };

    const p = STATE.pesertaAll.find(x => String(x.id) === String(pesertaId));
    if (!p) return { match: false, source: null };

    return detectKapanewonMatch(p, kapanewon);
  },

  // ==========================================================
  //   LOAD ALL DATA
  // ==========================================================
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) {
      return { success: true, skipped: true };
    }

    const myToken = ++loadToken;
    STATE.isLoading = true;
    STATE.lastError = null;

    try {
      await this.loadScopeInfo();
      if (myToken !== loadToken) return { success: false, aborted: true };

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

      if (myToken !== loadToken) return { success: false, aborted: true };

      STATE.pesertaAll    = normalizeData(pesertaRaw);
      STATE.sesiAll       = normalizeData(sesiRaw);
      STATE.skriningAll   = normalizeData(skriningRaw);
      STATE.pretestAll    = normalizeData(pretestRaw);
      STATE.posttestAll   = normalizeData(posttestRaw);
      STATE.absensiAll    = normalizeData(absensiRaw);
      STATE.sertifikatAll = normalizeData(sertifikatRaw);
      STATE.rtlAll        = normalizeData(rtlRaw);
      STATE.informasiAll  = normalizeData(infoRaw);

      rebuildPesertaCaches();
      applyActiveMode();

      STATE.lastSync = new Date().toISOString();
      STATE.isLoading = false;

      notifySubscribers('all');

      console.log('✅ [KetuaPACModule] Loaded for', STATE.scopeInfo.kapanewon, {
        mode: STATE.activeScopeMode,
        union: STATE.pesertaCache.union.length,
        utusan: STATE.pesertaCache.utusan.length,
        lokasi: STATE.pesertaCache.lokasi.length,
        pending: STATE.pesertaPending.length,
        approved: STATE.pesertaApproved.length,
        totalAll: STATE.pesertaAll.length,
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
  //   APPROVE PESERTA
  // ==========================================================
  async approvePeserta(id) {
    if (!id) return { success: false, error: 'ID wajib diisi' };

    const username = STATE.scopeInfo.username || getUsernameFromUser();
    if (!username) {
      showToast('Sesi login tidak valid. Login ulang.', 'error');
      return { success: false, error: 'Username tidak ditemukan' };
    }

    const idx = STATE.pesertaAll.findIndex(p => String(p.id) === String(id));
    const backup = idx !== -1 ? { ...STATE.pesertaAll[idx] } : null;

    if (idx !== -1) {
      STATE.pesertaAll[idx].status = 'approved';
      rebuildPesertaCaches();
      applyActiveMode();
      notifySubscribers('peserta');
    }

    try {
      const res = await callApi('approvePeserta', {
        id,
        requester: username,
      }, 'POST');

      if (res && res.success) {
        showToast('Peserta berhasil disetujui', 'success');
        this.loadAllData(true).catch(() => {});
        return { success: true };
      }

      if (backup && idx !== -1) {
        STATE.pesertaAll[idx] = backup;
        rebuildPesertaCaches();
        applyActiveMode();
        notifySubscribers('peserta');
      }

      const errMsg = (res && res.error) || 'Gagal menyetujui';
      showToast(errMsg, 'error');
      return { success: false, error: errMsg };
    } catch (e) {
      if (backup && idx !== -1) {
        STATE.pesertaAll[idx] = backup;
        rebuildPesertaCaches();
        applyActiveMode();
        notifySubscribers('peserta');
      }
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   REJECT PESERTA
  // ==========================================================
  async rejectPeserta(id) {
    if (!id) return { success: false, error: 'ID wajib diisi' };

    const username = STATE.scopeInfo.username || getUsernameFromUser();
    if (!username) {
      showToast('Sesi login tidak valid. Login ulang.', 'error');
      return { success: false, error: 'Username tidak ditemukan' };
    }

    const idx = STATE.pesertaAll.findIndex(p => String(p.id) === String(id));
    const backup = idx !== -1 ? { ...STATE.pesertaAll[idx] } : null;

    if (idx !== -1) {
      STATE.pesertaAll[idx].status = 'rejected';
      rebuildPesertaCaches();
      applyActiveMode();
      notifySubscribers('peserta');
    }

    try {
      const res = await callApi('rejectPeserta', {
        id,
        requester: username,
      }, 'POST');

      if (res && res.success) {
        showToast('Peserta ditolak', 'success');
        this.loadAllData(true).catch(() => {});
        return { success: true };
      }

      if (backup && idx !== -1) {
        STATE.pesertaAll[idx] = backup;
        rebuildPesertaCaches();
        applyActiveMode();
        notifySubscribers('peserta');
      }

      const errMsg = (res && res.error) || 'Gagal menolak';
      showToast(errMsg, 'error');
      return { success: false, error: errMsg };
    } catch (e) {
      if (backup && idx !== -1) {
        STATE.pesertaAll[idx] = backup;
        rebuildPesertaCaches();
        applyActiveMode();
        notifySubscribers('peserta');
      }
      showToast('Gagal: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   BATCH APPROVE
  // ==========================================================
  async approveMultiplePeserta(ids, onProgress) {
    if (!Array.isArray(ids) || ids.length === 0) {
      return { success: false, error: 'Tidak ada ID', total: 0, successCount: 0, failCount: 0 };
    }

    const total = ids.length;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < total; i++) {
      const id = ids[i];
      const peserta = STATE.pesertaAll.find(p => String(p.id) === String(id));
      const nama = peserta
        ? (peserta.nama_lengkap || `ID ${id}`)
        : `ID ${id}`;

      if (typeof onProgress === 'function') {
        try { onProgress(i + 1, total, nama); }
        catch (e) { /* silent */ }
      }

      const res = await this.approvePeserta(id);
      if (res.success) successCount++;
      else failCount++;
    }

    return {
      success: failCount === 0,
      total,
      successCount,
      failCount,
    };
  },

  // ==========================================================
  //   RTL CRUD
  // ==========================================================
  async addRTLTask(params) {
    try {
      if (params.pesertaId) {
        const found = STATE.peserta.find(p => String(p.id) === String(params.pesertaId));
        if (!found) throw new Error('Peserta tidak ditemukan di scope Anda');
      }
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
      const res = await apiDeleteRTLTask({ id });
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
  //   SUBMIT ABSEN
  // ==========================================================
  async submitAbsen(nama, sesiId, tandaTangan, password, qrToken, pesertaId) {
    try {
      if (pesertaId) {
        const found = STATE.peserta.find(p => String(p.id) === String(pesertaId));
        if (!found) throw new Error('Peserta tidak ditemukan di scope Anda');
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
    STATE.scopeInfo = { kapanewon: '', lokasiScope: [], username: '' };
    STATE.scopeLoaded = false;
    STATE.scopeLoading = false;
    STATE.scopePromise = null;
    STATE.activeScopeMode = DEFAULT_SCOPE_MODE;

    STATE.pesertaAll = [];
    STATE.sesiAll = [];
    STATE.skriningAll = [];
    STATE.pretestAll = [];
    STATE.posttestAll = [];
    STATE.absensiAll = [];
    STATE.sertifikatAll = [];
    STATE.rtlAll = [];
    STATE.informasiAll = [];

    STATE.pesertaCache = { utusan: [], lokasi: [], union: [] };

    STATE.peserta = [];
    STATE.skrining = [];
    STATE.pretest = [];
    STATE.posttest = [];
    STATE.absensi = [];
    STATE.sertifikat = [];
    STATE.rtl = [];

    STATE.pesertaPending = [];
    STATE.pesertaApproved = [];
    STATE.pesertaRejected = [];

    STATE.lastSync = null;
    STATE.lastError = null;
    STATE.isLoading = false;

    notifySubscribers('cleared');
    console.log('[KetuaPACModule] State cleared');
  },
};

export default KetuaPACModule;

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Ketua PAC Module v27.2.2 — Priority Detection + Lokasi Tab ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// js/modules/member.js — v27.0.0 MEMBER MODULE
// ============================================================
// CHANGELOG v27.0.0:
//   ✅ NEW: Scope context (kapanewon, lokasiScope, lokasiPkd, utusan)
//   ✅ NEW: TTD status (3 role) dengan progress
//   ✅ NEW: getCertificateVerifyUrl()
//   ✅ NEW: getLokasiPKDInfo()
//   ✅ NEW: getProgressSummary() — 5 tahapan
//   ✅ NEW: getProfileCompleteness() — 8 field
//   ✅ FIX: Race-safe load (token guard)
//   ✅ FIX: Cache TTL 5 menit
//   ✅ FIX: normalizeResult robust
//   ✅ KEEP: Skrining, quiz, absensi, sertifikat, materi
// ============================================================

import {
  showToast,
  getUserData,
  getMemberData as apiGetMemberData,
  updateMemberProfile as apiUpdateMemberProfile,
  getMemberSkrining as apiGetMemberSkrining,
  getMemberAbsensi as apiGetMemberAbsensi,
  getMemberSertifikat as apiGetMemberSertifikat,
  getMateriList as apiGetMateriList,
  getInfoList as apiGetInfoList,
  getPretestResponses as apiGetPretestResponses,
  getPosttestResponses as apiGetPosttestResponses,
  getSesiAbsen as apiGetSesiAbsen,
  getAllDigitalApprovals as apiGetAllDigitalApprovals,
} from '../core/api.js';
import { BASE_PATH } from '../core/config.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CACHE_PREFIX = 'pkd_member_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit
const SIGN_ROLES = ['ketua_pc', 'sekretaris', 'instruktur'];

// ============================================================
//   STATE
// ============================================================
const STATE = {
  // Data member
  memberData: null,
  pesertaData: null,

  // Scope context (mirror dari userData + peserta)
  scopeContext: {
    kapanewon: '',
    lokasiScope: [],
    lokasiPkd: '',
    utusan: '',
  },

  // Data terkait
  skrining: null,
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  informasi: [],
  materi: [],
  sesi: [],

  // TTD status
  ttdStatus: {
    ketua_pc: false,
    sekretaris: false,
    instruktur: false,
    complete: false,
    progress: 0,
  },

  // Meta
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

function normalizeResult(res, fallback = null) {
  if (res === null || res === undefined) return fallback;
  if (Array.isArray(res)) return res;
  if (typeof res === 'object') {
    if (res.success === false) return fallback;
    if (res.data !== undefined) return res.data;
    for (const k in res) {
      if (Array.isArray(res[k])) return res[k];
    }
    return res;
  }
  return fallback;
}

function safeString(s) {
  return String(s || '').trim();
}

function normalizeForCompare(s) {
  return safeString(s).toLowerCase().replace(/\s+/g, ' ');
}

function getUsername() {
  try {
    const u = getUserData() || {};
    return safeString(u.username || u.pesertaId || '');
  } catch (e) { return ''; }
}

function getNamaLengkap() {
  const u = getUserData() || {};
  return safeString(
    STATE.memberData?.nama_lengkap ||
    STATE.pesertaData?.nama_lengkap ||
    u.nama ||
    ''
  );
}

// ============================================================
//   SCOPE CONTEXT
// ============================================================
function buildScopeContext() {
  try {
    const userData = getUserData() || {};
    const peserta = STATE.pesertaData || {};

    STATE.scopeContext = {
      kapanewon: safeString(userData.kapanewon || ''),
      lokasiScope: Array.isArray(userData.lokasiScope) ? userData.lokasiScope : [],
      lokasiPkd: safeString(peserta.lokasi_pkd || userData.lokasi_pkd || ''),
      utusan: safeString(peserta.utusan || userData.utusan || ''),
    };
  } catch (e) {
    console.warn('[MemberModule] buildScopeContext error:', e);
  }
}

// ============================================================
//   TTD STATUS
// ============================================================
async function computeTTDStatus() {
  const nama = getNamaLengkap();
  if (!nama) {
    STATE.ttdStatus = {
      ketua_pc: false, sekretaris: false, instruktur: false,
      complete: false, progress: 0,
    };
    return;
  }

  try {
    const res = await apiGetAllDigitalApprovals();
    const list = normalizeData(res);
    const namaLower = normalizeForCompare(nama);

    const filtered = list.filter(a =>
      normalizeForCompare(a.peserta_nama || '') === namaLower
    );

    const status = { ketua_pc: false, sekretaris: false, instruktur: false };
    filtered.forEach(a => {
      const role = String(a.role || '').toLowerCase();
      if (SIGN_ROLES.indexOf(role) !== -1) status[role] = true;
    });

    const progress = SIGN_ROLES.filter(r => status[r]).length;
    STATE.ttdStatus = {
      ...status,
      progress,
      complete: progress === SIGN_ROLES.length,
    };
  } catch (e) {
    console.warn('[MemberModule] computeTTDStatus error:', e);
  }
}

// ============================================================
//   CACHE
// ============================================================
function saveCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data, ts: Date.now(),
    }));
  } catch (e) { /* quota exceeded — silent */ }
}

function loadCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts) return null;
    if (Date.now() - parsed.ts > CACHE_TTL_MS) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return parsed.data;
  } catch (e) { return null; }
}

function clearAllCache() {
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) { /* silent */ }
}

async function safeCall(fn, fallback = null, label = '') {
  try {
    const res = await fn();
    return normalizeResult(res, fallback);
  } catch (e) {
    console.warn(`[MemberModule] ${label} error:`, e.message);
    return fallback;
  }
}

// ============================================================
//   NOTIFY
// ============================================================
function notifySubscribers(type) {
  subscribers.forEach(fn => {
    try { fn(type, getPublicState()); }
    catch (e) { console.warn('[MemberModule] Subscriber error:', e); }
  });

  try {
    window.dispatchEvent(new CustomEvent('memberDataUpdated', {
      detail: { type, state: getPublicState() },
    }));
  } catch (e) { /* silent */ }
}

function getPublicState() {
  return {
    memberData: STATE.memberData,
    pesertaData: STATE.pesertaData,
    scopeContext: { ...STATE.scopeContext },
    ttdStatus: { ...STATE.ttdStatus },

    skrining: STATE.skrining,
    pretest: STATE.pretest.slice(),
    posttest: STATE.posttest.slice(),
    absensi: STATE.absensi.slice(),
    sertifikat: STATE.sertifikat.slice(),
    informasi: STATE.informasi.slice(),
    materi: STATE.materi.slice(),
    sesi: STATE.sesi.slice(),

    isLoading: STATE.isLoading,
    lastSync: STATE.lastSync,
    lastError: STATE.lastError,
  };
}

// ============================================================
//   PUBLIC MODULE
// ============================================================
export const MemberModule = {

  // ==========================================================
  //   STATE ACCESSORS
  // ==========================================================
  getState() { return getPublicState(); },

  getMemberData()    { return STATE.memberData; },
  getPesertaData()   { return STATE.pesertaData; },
  getScopeContext()  { return { ...STATE.scopeContext }; },
  getTTDStatus()     { return { ...STATE.ttdStatus }; },

  getSkrining()      { return STATE.skrining; },
  getPretest()       { return STATE.pretest || []; },
  getPosttest()      { return STATE.posttest || []; },
  getAbsensi()       { return STATE.absensi || []; },
  getSertifikat()    { return STATE.sertifikat || []; },
  getInformasi()     { return STATE.informasi || []; },
  getMateri()        { return STATE.materi || []; },
  getSesi()          { return STATE.sesi || []; },

  getStats() {
    return {
      hasSkrining: !!STATE.skrining,
      pretestCount: STATE.pretest.length,
      posttestCount: STATE.posttest.length,
      absenCount: STATE.absensi.length,
      sertifikatCount: STATE.sertifikat.length,
      materiCount: STATE.materi.length,
      infoCount: STATE.informasi.length,

      ttdProgress: STATE.ttdStatus.progress,
      ttdComplete: STATE.ttdStatus.complete,

      lastSync: STATE.lastSync,
    };
  },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  },

  // ==========================================================
  //   UTILITY GETTERS
  // ==========================================================
  getCertificateVerifyUrl() {
    const cert = (STATE.sertifikat && STATE.sertifikat[0]) || null;
    if (!cert || !cert.nomor_sertifikat) return null;
    return `${window.location.origin}${BASE_PATH}verifikasi.html?nomor=${encodeURIComponent(cert.nomor_sertifikat)}`;
  },

  getLokasiPKDInfo() {
    if (STATE.scopeContext.lokasiPkd) {
      return {
        hasLokasi: true,
        nama: STATE.scopeContext.lokasiPkd,
        utusan: STATE.scopeContext.utusan,
      };
    }
    return {
      hasLokasi: false,
      nama: '-',
      utusan: STATE.scopeContext.utusan,
    };
  },

  getNamaSesi(sesiId) {
    const s = (STATE.sesi || []).find(x => String(x.id) === String(sesiId));
    return s ? (s.nama || '(Sesi tidak diketahui)') : '(Sesi tidak diketahui)';
  },

  getSesiById(sesiId) {
    return (STATE.sesi || []).find(s => String(s.id) === String(sesiId)) || null;
  },

  canAccessIdCard() {
    const status = safeString(STATE.pesertaData?.status || '').toLowerCase();
    return status === 'approved' || status === 'active';
  },

  hasSkrining() {
    return !!STATE.skrining;
  },

  getProfileCompleteness() {
    const data = STATE.pesertaData || {};
    const fields = [
      'nama_lengkap', 'email', 'no_hp', 'alamat',
      'pekerjaan', 'pendidikan_terakhir', 'tempat_tgl_lahir', 'lokasi_pkd',
    ];
    const filled = fields.filter(f => safeString(data[f]).length > 0).length;
    return Math.round((filled / fields.length) * 100);
  },

  getProgressSummary() {
    return {
      hasSkrining: !!STATE.skrining,
      hasPretest: STATE.pretest.length > 0,
      hasPosttest: STATE.posttest.length > 0,
      hasAbsen: STATE.absensi.length > 0,
      hasSertifikat: STATE.sertifikat.length > 0,
      total: [
        !!STATE.skrining,
        STATE.pretest.length > 0,
        STATE.posttest.length > 0,
        STATE.absensi.length > 0,
        STATE.sertifikat.length > 0,
      ].filter(Boolean).length,
      max: 5,
    };
  },

  // ==========================================================
  //   LOAD FROM CACHE
  // ==========================================================
  loadFromCache() {
    const cached = loadCache('all');
    if (!cached) return false;

    STATE.memberData = cached.memberData || null;
    STATE.pesertaData = cached.pesertaData || null;
    STATE.scopeContext = cached.scopeContext || {
      kapanewon: '', lokasiScope: [], lokasiPkd: '', utusan: '',
    };
    STATE.skrining = cached.skrining || null;
    STATE.pretest = cached.pretest || [];
    STATE.posttest = cached.posttest || [];
    STATE.absensi = cached.absensi || [];
    STATE.sertifikat = cached.sertifikat || [];
    STATE.materi = cached.materi || [];
    STATE.informasi = cached.informasi || [];
    STATE.sesi = cached.sesi || [];
    STATE.lastSync = cached.lastSync || null;

    notifySubscribers('cache-loaded');
    return true;
  },

  // ==========================================================
  //   LOAD ALL DATA
  // ==========================================================
  async loadAllData(forceRefresh = false) {
    if (STATE.isLoading && !forceRefresh) {
      return { success: true, skipped: true };
    }

    const username = getUsername();
    if (!username) {
      const err = 'User tidak ditemukan. Silakan login ulang.';
      STATE.lastError = err;
      showToast(err, 'error');
      return { success: false, error: err };
    }

    const myToken = ++loadToken;
    STATE.isLoading = true;
    STATE.lastError = null;

    try {
      // ---- STEP 1: Member data ----
      let memberRes;
      try {
        memberRes = await apiGetMemberData(username);
      } catch (e) {
        memberRes = { success: false, error: e.message };
      }

      if (myToken !== loadToken) return { success: false, aborted: true };

      if (!memberRes || !memberRes.success) {
        STATE.isLoading = false;
        const err = (memberRes && memberRes.error) || 'Gagal memuat data member';
        STATE.lastError = err;
        showToast(err, 'error');
        return { success: false, error: err };
      }

      // Handle both shapes
      STATE.memberData = memberRes.member
        || (memberRes.data && memberRes.data.member)
        || null;
      STATE.pesertaData = memberRes.peserta
        || (memberRes.data && memberRes.data.peserta)
        || null;

      // Build scope context
      buildScopeContext();

      const namaLengkap = getNamaLengkap();
      const canFetchByName = !!namaLengkap;

      // ---- STEP 2: Parallel fetch ----
      const tasks = [
        canFetchByName
          ? safeCall(
              () => apiGetMemberSkrining({ nama: namaLengkap }),
              { data: null },
              'getMemberSkrining'
            )
          : Promise.resolve({ data: null }),

        safeCall(() => apiGetPretestResponses(), [], 'getPretestResponses'),
        safeCall(() => apiGetPosttestResponses(), [], 'getPosttestResponses'),

        canFetchByName
          ? safeCall(
              () => apiGetMemberAbsensi({ nama: namaLengkap }),
              [],
              'getMemberAbsensi'
            )
          : Promise.resolve([]),

        canFetchByName
          ? safeCall(
              () => apiGetMemberSertifikat({ nama: namaLengkap }),
              [],
              'getMemberSertifikat'
            )
          : Promise.resolve([]),

        safeCall(() => apiGetMateriList(), [], 'getMateriList'),
        safeCall(() => apiGetInfoList(), [], 'getInfoList'),
        safeCall(() => apiGetSesiAbsen(), [], 'getSesiAbsen'),
      ];

      const [
        skriningRes, pretestAll, posttestAll,
        absensiRes, sertifikatRes,
        materiRes, infoRes, sesiRes,
      ] = await Promise.all(tasks);

      if (myToken !== loadToken) return { success: false, aborted: true };

      // ---- STEP 3: Assign ----
      STATE.skrining = (skriningRes && skriningRes.data)
        ? skriningRes.data
        : null;

      if (canFetchByName) {
        const namaLower = normalizeForCompare(namaLengkap);
        STATE.pretest = (pretestAll || []).filter(d =>
          normalizeForCompare(d.nama || '') === namaLower
        );
        STATE.posttest = (posttestAll || []).filter(d =>
          normalizeForCompare(d.nama || '') === namaLower
        );
      } else {
        STATE.pretest = [];
        STATE.posttest = [];
      }

      STATE.absensi    = Array.isArray(absensiRes) ? absensiRes : [];
      STATE.sertifikat = Array.isArray(sertifikatRes) ? sertifikatRes : [];
      STATE.materi     = Array.isArray(materiRes) ? materiRes : [];
      STATE.informasi  = Array.isArray(infoRes) ? infoRes : [];
      STATE.sesi       = Array.isArray(sesiRes) ? sesiRes : [];

      // ---- STEP 4: TTD status (fire & forget) ----
      computeTTDStatus()
        .then(() => notifySubscribers('ttd'))
        .catch(() => {});

      STATE.lastSync = new Date().toISOString();
      STATE.isLoading = false;

      // Save cache
      saveCache('all', {
        memberData: STATE.memberData,
        pesertaData: STATE.pesertaData,
        scopeContext: STATE.scopeContext,
        skrining: STATE.skrining,
        pretest: STATE.pretest,
        posttest: STATE.posttest,
        absensi: STATE.absensi,
        sertifikat: STATE.sertifikat,
        materi: STATE.materi,
        informasi: STATE.informasi,
        sesi: STATE.sesi,
        lastSync: STATE.lastSync,
      });

      notifySubscribers('all');

      console.log('✅ [MemberModule] Data loaded for', namaLengkap || username);
      return { success: true };
    } catch (e) {
      STATE.isLoading = false;
      STATE.lastError = e.message;
      console.error('❌ [MemberModule] loadAllData error:', e);
      showToast('Gagal memuat data: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   REFRESH PER SECTION
  // ==========================================================
  async refreshSection(section) {
    const username = getUsername();
    if (!username) {
      showToast('User tidak ditemukan', 'error');
      return { success: false };
    }

    try {
      switch (section) {
        case 'profil': {
          const res = await apiGetMemberData(username);
          if (res && res.success) {
            STATE.memberData = res.member
              || (res.data && res.data.member)
              || null;
            STATE.pesertaData = res.peserta
              || (res.data && res.data.peserta)
              || null;
            buildScopeContext();
            notifySubscribers('profil');
          }
          break;
        }

        case 'ttd':
          await computeTTDStatus();
          notifySubscribers('ttd');
          break;

        case 'materi':
          STATE.materi = await safeCall(
            () => apiGetMateriList(), [], 'refreshMateri'
          );
          notifySubscribers('materi');
          break;

        case 'informasi':
          STATE.informasi = await safeCall(
            () => apiGetInfoList(), [], 'refreshInformasi'
          );
          notifySubscribers('informasi');
          break;

        case 'skrining': {
          const nama = getNamaLengkap();
          if (!nama) throw new Error('Nama peserta tidak ditemukan');
          const res = await apiGetMemberSkrining({ nama });
          STATE.skrining = (res && res.data) ? res.data : null;
          notifySubscribers('skrining');
          break;
        }

        case 'pretest': {
          const nama = getNamaLengkap();
          const all = await safeCall(
            () => apiGetPretestResponses(), [], 'refreshPretest'
          );
          const namaLower = normalizeForCompare(nama);
          STATE.pretest = (all || []).filter(d =>
            normalizeForCompare(d.nama || '') === namaLower
          );
          notifySubscribers('pretest');
          break;
        }

        case 'posttest': {
          const nama = getNamaLengkap();
          const all = await safeCall(
            () => apiGetPosttestResponses(), [], 'refreshPosttest'
          );
          const namaLower = normalizeForCompare(nama);
          STATE.posttest = (all || []).filter(d =>
            normalizeForCompare(d.nama || '') === namaLower
          );
          notifySubscribers('posttest');
          break;
        }

        case 'absensi': {
          const nama = getNamaLengkap();
          if (!nama) throw new Error('Nama peserta tidak ditemukan');
          STATE.absensi = await safeCall(
            () => apiGetMemberAbsensi({ nama }), [], 'refreshAbsensi'
          );
          notifySubscribers('absensi');
          break;
        }

        case 'sertifikat': {
          const nama = getNamaLengkap();
          if (!nama) throw new Error('Nama peserta tidak ditemukan');
          STATE.sertifikat = await safeCall(
            () => apiGetMemberSertifikat({ nama }), [], 'refreshSertifikat'
          );
          notifySubscribers('sertifikat');
          break;
        }

        default:
          throw new Error('Section tidak dikenal: ' + section);
      }

      STATE.lastSync = new Date().toISOString();
      return { success: true };
    } catch (e) {
      console.warn('[MemberModule] refreshSection error:', e.message);
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   UPDATE PROFIL
  // ==========================================================
  async updateMemberProfile(data) {
    const username = getUsername();
    if (!username) {
      showToast('User tidak ditemukan', 'error');
      return { success: false, error: 'User tidak ditemukan' };
    }

    try {
      const res = await apiUpdateMemberProfile(username, data);

      if (res && res.success) {
        // Refresh profil lokal
        await this.refreshSection('profil');

        // Update userData di memory
        try {
          const userData = getUserData() || {};
          const newUserData = {
            ...userData,
            nama: data.nama_lengkap || userData.nama,
            email: data.email || userData.email,
            nohp: data.no_hp || userData.nohp,
          };
          const serialized = { role: 'member', data: newUserData };
          try { sessionStorage.setItem('pkd_auth', JSON.stringify(serialized)); }
          catch (e) { /* silent */ }
          try { localStorage.setItem('pkd_auth', JSON.stringify(serialized)); }
          catch (e) { /* silent */ }
        } catch (e) { /* silent */ }

        showToast('Profil berhasil diperbarui', 'success');
        notifySubscribers('profil-updated');
        return { success: true };
      }

      const err = (res && res.error) || 'Gagal memperbarui profil';
      showToast(err, 'error');
      return { success: false, error: err };
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
      return { success: false, error: e.message };
    }
  },

  // ==========================================================
  //   CLEAR STATE
  // ==========================================================
  clearState() {
    STATE.memberData = null;
    STATE.pesertaData = null;
    STATE.scopeContext = {
      kapanewon: '', lokasiScope: [], lokasiPkd: '', utusan: '',
    };
    STATE.skrining = null;
    STATE.pretest = [];
    STATE.posttest = [];
    STATE.absensi = [];
    STATE.sertifikat = [];
    STATE.materi = [];
    STATE.informasi = [];
    STATE.sesi = [];
    STATE.ttdStatus = {
      ketua_pc: false, sekretaris: false, instruktur: false,
      complete: false, progress: 0,
    };
    STATE.lastSync = null;
    STATE.isLoading = false;
    STATE.lastError = null;

    clearAllCache();
    notifySubscribers('cleared');
    console.log('[MemberModule] State cleared');
  },
};

export default MemberModule;
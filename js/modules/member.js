// js/modules/member.js — Full Fix Member Module (Final)
// Modul state untuk halaman Member (peserta PKD).
// Fitur:
// - Load data member dari username (dari userData)
// - Cache data terkait (skrining, pretest, posttest, absensi, sertifikat, materi, informasi)
// - Update profil
// - Cache dengan TTL (5 menit)
// - Custom event untuk sinkronisasi view
// - Lifecycle mount/unmount

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
} from '../core/api.js';

// ============================================================
//   CONSTANTS
// ============================================================
const CACHE_PREFIX = 'pkd_member_cache_';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 menit

// ============================================================
//   STATE
// ============================================================
const STATE = {
  // Data member
  memberData: null,     // { username, nama_lengkap, email, no_hp, pesertaId }
  pesertaData: null,    // full peserta record

  // Data terkait
  skrining: null,       // single object
  pretest: [],
  posttest: [],
  absensi: [],
  sertifikat: [],
  informasi: [],
  materi: [],
  sesi: [],

  // Meta
  isLoading: false,
  lastSync: null,
  lastError: null,
};

// Track subscribers
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
    const userData = getUserData() || {};
    return safeString(userData.username || userData.pesertaId || '');
  } catch (e) { return ''; }
}

function getNamaLengkap() {
  const userData = getUserData() || {};
  return safeString(
    STATE.memberData?.nama_lengkap ||
    STATE.pesertaData?.nama_lengkap ||
    userData.nama ||
    ''
  );
}

// ============================================================
//   CACHE HELPERS
// ============================================================
function saveCache(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({
      data, ts: Date.now(),
    }));
  } catch (e) { /* ignore */ }
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
  } catch (e) { /* ignore */ }
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
//   NOTIFY SUBSCRIBERS
// ============================================================
function notifySubscribers(type) {
  subscribers.forEach(fn => {
    try { fn(type, getPublicState()); } catch (e) {
      console.warn('[MemberModule] Subscriber error:', e);
    }
  });

  window.dispatchEvent(new CustomEvent('memberDataUpdated', {
    detail: { type, state: getPublicState() },
  }));
}

function getPublicState() {
  return {
    memberData: STATE.memberData,
    pesertaData: STATE.pesertaData,
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
//   EXPORTED MODULE
// ============================================================
export const MemberModule = {

  // ==========================================================
  //   STATE ACCESSORS
  // ==========================================================
  getState() {
    return getPublicState();
  },

  getMemberData() { return STATE.memberData; },
  getPesertaData() { return STATE.pesertaData; },
  getSkrining() { return STATE.skrining; },
  getPretest() { return STATE.pretest || []; },
  getPosttest() { return STATE.posttest || []; },
  getAbsensi() { return STATE.absensi || []; },
  getSertifikat() { return STATE.sertifikat || []; },
  getInformasi() { return STATE.informasi || []; },
  getMateri() { return STATE.materi || []; },
  getSesi() { return STATE.sesi || []; },

  getStats() {
    return {
      hasSkrining: !!STATE.skrining,
      pretestCount: STATE.pretest.length,
      posttestCount: STATE.posttest.length,
      absenCount: STATE.absensi.length,
      sertifikatCount: STATE.sertifikat.length,
      materiCount: STATE.materi.length,
      infoCount: STATE.informasi.length,
      lastSync: STATE.lastSync,
    };
  },

  subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    subscribers.add(fn);
    return () => subscribers.delete(fn);
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

    STATE.isLoading = true;
    STATE.lastError = null;

    try {
      // ==========================================================
      //   LANGKAH 1: Ambil memberData (butuh username)
      // ==========================================================
      let memberRes;
      try {
        memberRes = await apiGetMemberData(username);
      } catch (e) {
        memberRes = { success: false, error: e.message };
      }

      if (!memberRes || !memberRes.success) {
        STATE.isLoading = false;
        const err = (memberRes && memberRes.error) || 'Gagal memuat data member';
        STATE.lastError = err;
        showToast(err, 'error');
        return { success: false, error: err };
      }

      STATE.memberData = memberRes.member || null;
      STATE.pesertaData = memberRes.peserta || null;

      const namaLengkap = getNamaLengkap();
      const canFetchByName = !!namaLengkap;

      // ==========================================================
      //   LANGKAH 2: Ambil data terkait (paralel)
      // ==========================================================
      const tasks = [
        // Skrining — single object
        canFetchByName
          ? safeCall(() => apiGetMemberSkrining({ nama: namaLengkap }), { data: null }, 'getMemberSkrining')
          : Promise.resolve({ data: null }),

        // Pretest (semua, filter by nama nanti)
        safeCall(() => apiGetPretestResponses(), [], 'getPretestResponses'),

        // Posttest (semua, filter by nama nanti)
        safeCall(() => apiGetPosttestResponses(), [], 'getPosttestResponses'),

        // Absensi
        canFetchByName
          ? safeCall(() => apiGetMemberAbsensi({ nama: namaLengkap }), [], 'getMemberAbsensi')
          : Promise.resolve([]),

        // Sertifikat
        canFetchByName
          ? safeCall(() => apiGetMemberSertifikat({ nama: namaLengkap }), [], 'getMemberSertifikat')
          : Promise.resolve([]),

        // Materi (publik)
        safeCall(() => apiGetMateriList(), [], 'getMateriList'),

        // Informasi (publik)
        safeCall(() => apiGetInfoList(), [], 'getInfoList'),

        // Sesi absen (publik)
        safeCall(() => apiGetSesiAbsen(), [], 'getSesiAbsen'),
      ];

      const [
        skriningRes,
        pretestAll,
        posttestAll,
        absensiRes,
        sertifikatRes,
        materiRes,
        infoRes,
        sesiRes,
      ] = await Promise.all(tasks);

      // ==========================================================
      //   LANGKAH 3: Assign hasil
      // ==========================================================
      STATE.skrining = (skriningRes && skriningRes.data) ? skriningRes.data : null;

      // Pretest & Posttest — filter by nama
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

      STATE.absensi = Array.isArray(absensiRes) ? absensiRes : [];
      STATE.sertifikat = Array.isArray(sertifikatRes) ? sertifikatRes : [];
      STATE.materi = Array.isArray(materiRes) ? materiRes : [];
      STATE.informasi = Array.isArray(infoRes) ? infoRes : [];
      STATE.sesi = Array.isArray(sesiRes) ? sesiRes : [];

      STATE.lastSync = new Date().toISOString();
      STATE.isLoading = false;

      // Simpan ke cache
      saveCache('all', {
        memberData: STATE.memberData,
        pesertaData: STATE.pesertaData,
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
  //   LOAD FROM CACHE (untuk render awal cepat)
  // ==========================================================
  loadFromCache() {
    const cached = loadCache('all');
    if (!cached) return false;

    STATE.memberData = cached.memberData || null;
    STATE.pesertaData = cached.pesertaData || null;
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
            STATE.memberData = res.member || null;
            STATE.pesertaData = res.peserta || null;
            notifySubscribers('profil');
          }
          break;
        }

        case 'materi':
          STATE.materi = await safeCall(() => apiGetMateriList(), [], 'refreshMateri');
          notifySubscribers('materi');
          break;

        case 'informasi':
          STATE.informasi = await safeCall(() => apiGetInfoList(), [], 'refreshInformasi');
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
          const all = await safeCall(() => apiGetPretestResponses(), [], 'refreshPretest');
          const namaLower = normalizeForCompare(nama);
          STATE.pretest = (all || []).filter(d =>
            normalizeForCompare(d.nama || '') === namaLower
          );
          notifySubscribers('pretest');
          break;
        }

        case 'posttest': {
          const nama = getNamaLengkap();
          const all = await safeCall(() => apiGetPosttestResponses(), [], 'refreshPosttest');
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
          STATE.absensi = await safeCall(() => apiGetMemberAbsensi({ nama }), [], 'refreshAbsensi');
          notifySubscribers('absensi');
          break;
        }

        case 'sertifikat': {
          const nama = getNamaLengkap();
          if (!nama) throw new Error('Nama peserta tidak ditemukan');
          STATE.sertifikat = await safeCall(() => apiGetMemberSertifikat({ nama }), [], 'refreshSertifikat');
          notifySubscribers('sertifikat');
          break;
        }

        default:
          throw new Error('Section tidak dikenal: ' + section);
      }

      STATE.lastSync = new Date().toISOString();
      saveCache('all', {
        memberData: STATE.memberData,
        pesertaData: STATE.pesertaData,
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

        // Update userData di memori juga
        try {
          const userData = getUserData() || {};
          const newUserData = {
            ...userData,
            nama: data.nama_lengkap || userData.nama,
            email: data.email || userData.email,
            nohp: data.no_hp || userData.nohp,
          };
          // Simpan ke storage
          const serialized = { role: 'member', data: newUserData };
          try {
            sessionStorage.setItem('pkd_auth', JSON.stringify(serialized));
          } catch (e) {}
          try {
            localStorage.setItem('pkd_auth', JSON.stringify(serialized));
          } catch (e) {}
        } catch (e) { /* ignore */ }

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
  //   UTILITY HELPERS
  // ==========================================================
  clearState() {
    STATE.memberData = null;
    STATE.pesertaData = null;
    STATE.skrining = null;
    STATE.pretest = [];
    STATE.posttest = [];
    STATE.absensi = [];
    STATE.sertifikat = [];
    STATE.materi = [];
    STATE.informasi = [];
    STATE.sesi = [];
    STATE.lastSync = null;
    STATE.isLoading = false;
    STATE.lastError = null;

    clearAllCache();
    notifySubscribers('cleared');
    console.log('[MemberModule] State cleared');
  },

  /**
   * Cek apakah user boleh akses ID Card.
   */
  canAccessIdCard() {
    const status = safeString(STATE.pesertaData?.status || '').toLowerCase();
    return status === 'approved' || status === 'active';
  },

  hasSkrining() {
    return !!STATE.skrining;
  },

  getSesiById(sesiId) {
    return STATE.sesi.find(s => String(s.id) === String(sesiId)) || null;
  },

  getNamaSesi(sesiId) {
    const s = this.getSesiById(sesiId);
    return s ? (s.nama || '(Sesi tidak diketahui)') : '(Sesi tidak diketahui)';
  },

  // Persentase kelengkapan profil
  getProfileCompleteness() {
    const data = STATE.pesertaData || {};
    const fields = ['nama_lengkap', 'email', 'no_hp', 'alamat', 'pekerjaan',
      'pendidikan_terakhir', 'tempat_tgl_lahir'];
    const filled = fields.filter(f => safeString(data[f]).length > 0).length;
    return Math.round((filled / fields.length) * 100);
  },

  // Total progress aktivitas
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
};

// ============================================================
//   DEFAULT EXPORT
// ============================================================
export default MemberModule;
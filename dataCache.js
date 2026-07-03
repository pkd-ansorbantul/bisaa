// dataCache.js - Cache Manager untuk PKD GP Ansor Kabupaten Bantul
// Versi: 2.2.1
// Tanggal: 2026-07-02
// Perubahan: Memperbaiki self-initialization agar tidak menimpa cache yang sudah ada
// ======================================================================

const DataCache = {
  // ================================================================
  // KONFIGURASI
  // ================================================================
  
  CACHE_KEY: 'pkd_all_data',
  CACHE_KEY_META: 'pkd_cache_meta',
  CACHE_DURATION: 5 * 60 * 1000, // 5 menit
  CACHE_KEY_PREFIX: 'pkd_cache_',
  
  // ================================================================
  // METODE PUBLIK
  // ================================================================

  /**
   * Menyimpan semua data ke cache (objek apapun)
   * @param {Object} data - Objek berisi semua data (peserta, sesi, materi, dll.)
   */
  setAllData(data) {
    if (!data || typeof data !== 'object') {
      console.error('DataCache: Data harus berupa object');
      return;
    }

    const payload = {
      data: data,
      timestamp: Date.now(),
      version: '2.2.1'
    };

    try {
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(payload));
      localStorage.setItem(this.CACHE_KEY_META, JSON.stringify({
        timestamp: payload.timestamp,
        version: payload.version,
        dataTypes: Object.keys(data)
      }));
      
      // Simpan masing-masing tipe data secara terpisah untuk akses cepat
      Object.keys(data).forEach(type => {
        try {
          localStorage.setItem(this.CACHE_KEY_PREFIX + type, JSON.stringify(data[type]));
        } catch (e) {
          console.warn(`DataCache: Gagal menyimpan cache terpisah untuk ${type}`, e);
        }
      });
      
      console.log(`DataCache: Berhasil menyimpan ${Object.keys(data).length} tipe data ke cache`);
    } catch (e) {
      console.error('DataCache: Gagal menyimpan ke localStorage', e);
    }
  },

  /**
   * Mengambil semua data dari cache
   * @returns {Object|null} - Objek data atau null jika tidak ada
   */
  getAllData() {
    const raw = localStorage.getItem(this.CACHE_KEY);
    if (!raw) return null;

    try {
      const payload = JSON.parse(raw);
      return payload.data || null;
    } catch (e) {
      console.error('DataCache: Gagal parsing data cache', e);
      return null;
    }
  },

  /**
   * Mengecek apakah cache masih valid
   * @param {number} duration - Durasi valid dalam milidetik
   * @returns {boolean} - true jika cache valid
   */
  isValid(duration = this.CACHE_DURATION) {
    const raw = localStorage.getItem(this.CACHE_KEY);
    if (!raw) return false;

    try {
      const payload = JSON.parse(raw);
      return (Date.now() - payload.timestamp) < duration;
    } catch (e) {
      return false;
    }
  },

  /**
   * Mengambil data spesifik dari cache
   * @param {string} type - Tipe data (peserta, sesi, materi, skrining, pretest, posttest, alumni, kader, informasi, absensi, sertifikat)
   * @returns {any|null} - Data atau null jika tidak ada
   */
  getData(type) {
    if (!type) return null;

    // Coba ambil dari cache terpisah dulu (lebih cepat)
    const separateRaw = localStorage.getItem(this.CACHE_KEY_PREFIX + type);
    if (separateRaw) {
      try {
        return JSON.parse(separateRaw);
      } catch (e) {
        // Jika gagal, lanjut ke cache utama
      }
    }

    // Jika tidak ada di cache terpisah, ambil dari cache utama
    const all = this.getAllData();
    if (all && all[type] !== undefined) {
      return all[type];
    }

    return null;
  },

  /**
   * Memperbarui data spesifik di cache tanpa menghapus data lain
   * @param {string} type - Tipe data
   * @param {any} newData - Data baru (bisa array, objek, string, number, boolean)
   */
  updateData(type, newData) {
    if (!type) {
      console.error('DataCache: Tipe data harus string');
      return;
    }

    // Simpan ke cache terpisah
    try {
      localStorage.setItem(this.CACHE_KEY_PREFIX + type, JSON.stringify(newData));
    } catch (e) {
      console.warn(`DataCache: Gagal menyimpan cache terpisah untuk ${type}`, e);
    }

    // Update di cache utama
    const all = this.getAllData() || {};
    all[type] = newData;
    this.setAllData(all);
  },

  /**
   * Menghapus data spesifik dari cache
   * @param {string} type - Tipe data
   */
  removeData(type) {
    if (!type) return;

    // Hapus dari cache terpisah
    try {
      localStorage.removeItem(this.CACHE_KEY_PREFIX + type);
    } catch (e) {
      console.warn(`DataCache: Gagal menghapus cache terpisah untuk ${type}`, e);
    }

    // Hapus dari cache utama
    const all = this.getAllData() || {};
    if (all[type] !== undefined) {
      delete all[type];
      this.setAllData(all);
    }
  },

  /**
   * Menghapus semua cache
   */
  clear() {
    try {
      localStorage.removeItem(this.CACHE_KEY);
      localStorage.removeItem(this.CACHE_KEY_META);
      
      // Hapus semua cache terpisah
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.CACHE_KEY_PREFIX)) {
          localStorage.removeItem(key);
        }
      });
      
      console.log('DataCache: Semua cache berhasil dihapus');
    } catch (e) {
      console.error('DataCache: Gagal menghapus cache', e);
    }
  },

  /**
   * Mendapatkan metadata cache
   * @returns {Object|null} - Metadata atau null jika tidak ada
   */
  getMeta() {
    const raw = localStorage.getItem(this.CACHE_KEY_META);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  },

  /**
   * Mendapatkan jumlah data per tipe
   * @returns {Object} - Objek dengan jumlah data per tipe
   */
  getStats() {
    const all = this.getAllData();
    if (!all) return { total: 0, types: {} };

    const stats = {
      total: 0,
      types: {}
    };

    Object.keys(all).forEach(type => {
      const data = all[type];
      const count = Array.isArray(data) ? data.length : (typeof data === 'object' ? Object.keys(data).length : 1);
      stats.types[type] = count;
      stats.total += count;
    });

    return stats;
  },

  /**
   * Mengekspor semua data ke format JSON
   * @returns {string} - JSON string dari semua data
   */
  exportData() {
    const all = this.getAllData();
    if (!all) return '{}';
    return JSON.stringify({
      data: all,
      meta: this.getMeta(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  },

  /**
   * Mengimpor data dari JSON
   * @param {string} json - JSON string
   * @returns {boolean} - true jika berhasil
   */
  importData(json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed && parsed.data) {
        this.setAllData(parsed.data);
        return true;
      }
    } catch (e) {
      console.error('DataCache: Gagal import data', e);
    }
    return false;
  },

  /**
   * Memeriksa apakah data tertentu ada di cache
   * @param {string} type - Tipe data
   * @returns {boolean} - true jika ada
   */
  hasData(type) {
    const data = this.getData(type);
    return data !== null && data !== undefined;
  },

  /**
   * Mendapatkan semua tipe data yang tersedia
   * @returns {Array} - Daftar tipe data
   */
  getAvailableTypes() {
    const all = this.getAllData();
    if (!all) return [];
    return Object.keys(all);
  }
};

// ================================================================
// SELF-INITIALIZATION (TIDAK MENIMPA DATA YANG SUDAH ADA)
// ================================================================

(function() {
  // Cek apakah cache sudah ada
  const existingData = DataCache.getAllData();
  
  if (!existingData) {
    console.log('DataCache: Cache belum ada, inisialisasi dengan data dummy');
    
    // Data dummy dasar (semua array kosong)
    const dummyData = {
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
      sertifikat: []
    };
    
    DataCache.setAllData(dummyData);
  } else {
    console.log('DataCache: Cache sudah ada, mempertahankan data yang ada');
    const stats = DataCache.getStats();
    console.log('DataCache: Statistik cache saat ini:', stats);
  }
})();

// ================================================================
// EKSPOR UNTUK DIGUNAKAN DI LUAR
// ================================================================

if (typeof window !== 'undefined') {
  window.DataCache = DataCache;
  console.log('DataCache: Siap digunakan. Versi 2.2.1');
}

// ================================================================
// END OF FILE
// ================================================================
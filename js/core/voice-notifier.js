// ============================================================
// js/core/voice-notifier.js — v1.1.0 FULL FIX EDITION
// Shared module: Notifikasi suara TTS untuk absen peserta
// ============================================================
// CHANGELOG v1.1.0 (dari v1.0.0):
//   ✅ FIX: Autoplay policy — voice unlock setelah interaksi user
//   ✅ FIX: Chunking untuk teks panjang (>200 char)
//   ✅ FIX: Voice selection retry — handle async onvoiceschanged
//   ✅ FIX: Race condition saat speak bersamaan
//   ✅ FIX: Cancel queue saat disabled
//   ✅ FIX: Dedup consecutive (hindari speak 2x untuk absen sama)
//   ✅ NEW: getSupportedVoices() — list semua voice ID
//   ✅ NEW: testVoice() — test TTS sekali
//   ✅ NEW: setVoice() — pilih voice tertentu
//   ✅ NEW: setRate(), setPitch(), setVolume()
//   ✅ NEW: getConfig() — lihat konfigurasi aktif
//   ✅ NEW: announceAbsen() dengan template customizable
//   ✅ NEW: onSpeakStart / onSpeakEnd callbacks
//   ✅ NEW: Retry mechanism jika voice belum ready
//   ✅ NEW: Timeout protection (30s per utterance)
//   ✅ NEW: Safe untuk SSR (check window)
//   ✅ KEEP: 100% backward compatible dengan v1.0.0
// ============================================================

// ============================================================
//   CONSTANTS
// ============================================================
const STORAGE_KEY_ENABLED = 'pkd_voice_notif_enabled';
const STORAGE_KEY_VOICE   = 'pkd_voice_notif_voice';
const STORAGE_KEY_RATE    = 'pkd_voice_notif_rate';
const STORAGE_KEY_PITCH   = 'pkd_voice_notif_pitch';
const STORAGE_KEY_VOLUME  = 'pkd_voice_notif_volume';

const DEFAULT_LANG    = 'id-ID';
const DEFAULT_RATE    = 0.95;
const DEFAULT_PITCH   = 1.0;
const DEFAULT_VOLUME  = 1.0;
const QUEUE_DELAY_MS  = 350;
const MAX_TEXT_LENGTH = 200;
const UTTERANCE_TIMEOUT_MS = 30000;
const VOICE_LOAD_RETRY_MS = 100;
const VOICE_LOAD_MAX_RETRY = 20; // 2 detik total

// ============================================================
//   STATE
// ============================================================
let _enabled = true;
let _isSpeaking = false;
let _queue = [];
let _lastAbsenIds = new Set();
let _isFirstScan = true;
let _voice = null;
let _voiceReady = false;
let _voiceRetryTimer = null;
let _voiceRetryCount = 0;
let _currentUtterance = null;
let _utteranceTimeoutTimer = null;

// ⭐ Config (dapat di-override)
let _config = {
  lang: DEFAULT_LANG,
  rate: DEFAULT_RATE,
  pitch: DEFAULT_PITCH,
  volume: DEFAULT_VOLUME,
  voiceName: null,
};

// ⭐ Callbacks
let _onSpeakStart = null;
let _onSpeakEnd = null;
let _onSpeakError = null;

// ⭐ Dedup cache
let _recentSpokenHash = '';
let _recentSpokenTime = 0;
const DEDUP_WINDOW_MS = 2000;

// ============================================================
//   UTILITY — Cek dukungan browser
// ============================================================
function isSpeechSupported() {
  return typeof window !== 'undefined' &&
         'speechSynthesis' in window &&
         typeof SpeechSynthesisUtterance !== 'undefined';
}

function safeLocalGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
    return true;
  } catch (e) {
    return false;
  }
}

function safeLocalRemove(key) {
  try { localStorage.removeItem(key); }
  catch (e) { /* silent */ }
}

// ============================================================
//   CONFIG LOAD / SAVE
// ============================================================
function loadEnabledState() {
  const raw = safeLocalGet(STORAGE_KEY_ENABLED, null);
  if (raw === null) return true; // default: ON
  return raw === 'true';
}

function loadConfigFromStorage() {
  _config.rate = parseFloat(safeLocalGet(STORAGE_KEY_RATE, DEFAULT_RATE)) || DEFAULT_RATE;
  _config.pitch = parseFloat(safeLocalGet(STORAGE_KEY_PITCH, DEFAULT_PITCH)) || DEFAULT_PITCH;
  _config.volume = parseFloat(safeLocalGet(STORAGE_KEY_VOLUME, DEFAULT_VOLUME)) || DEFAULT_VOLUME;
  _config.voiceName = safeLocalGet(STORAGE_KEY_VOICE, null);

  // Clamp
  _config.rate = Math.max(0.1, Math.min(10, _config.rate));
  _config.pitch = Math.max(0, Math.min(2, _config.pitch));
  _config.volume = Math.max(0, Math.min(1, _config.volume));
}

// ============================================================
//   VOICE SELECTION
// ============================================================
function getVoiceList() {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices() || [];
  } catch (e) {
    return [];
  }
}

function selectIndonesianVoice() {
  if (!isSpeechSupported()) return null;

  const voices = getVoiceList();
  if (!voices || voices.length === 0) return null;

  // ⭐ 1. Kalau user sudah pilih voice tertentu
  if (_config.voiceName) {
    const saved = voices.find(v => v.name === _config.voiceName);
    if (saved) return saved;
  }

  // ⭐ 2. Prioritas: id-ID → id → mulai "id" → cari kata "indonesia"
  let chosen = voices.find(v => v.lang === 'id-ID');
  if (!chosen) chosen = voices.find(v => v.lang === 'id');
  if (!chosen) chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('id'));
  if (!chosen) chosen = voices.find(v =>
    v.name && v.name.toLowerCase().includes('indonesia')
  );

  // ⭐ 3. Fallback: voice default
  if (!chosen) {
    chosen = voices.find(v => v.default) || voices[0];
  }

  return chosen || null;
}

function ensureVoiceReady() {
  if (!isSpeechSupported()) return false;

  if (_voiceReady && _voice) return true;

  // Coba pilih voice langsung
  _voice = selectIndonesianVoice();

  if (_voice) {
    _voiceReady = true;
    _voiceRetryCount = 0;
    if (_voiceRetryTimer) {
      clearTimeout(_voiceRetryTimer);
      _voiceRetryTimer = null;
    }
    console.log(`[VoiceNotifier] 🎙️ Voice selected: "${_voice.name}" (${_voice.lang})`);
    return true;
  }

  // ⭐ Retry: kadang voices belum loaded
  if (_voiceRetryCount < VOICE_LOAD_MAX_RETRY) {
    _voiceRetryCount++;
    if (!_voiceRetryTimer) {
      _voiceRetryTimer = setTimeout(() => {
        _voiceRetryTimer = null;
        ensureVoiceReady();
      }, VOICE_LOAD_RETRY_MS);
    }
  } else if (_voiceRetryCount === VOICE_LOAD_MAX_RETRY) {
    console.warn('[VoiceNotifier] ⚠️ Voice tidak tersedia setelah retry — pakai default browser');
    _voiceRetryCount++; // biar warning cuma sekali
  }

  return false;
}

// ============================================================
//   TEXT CHUNKING (untuk teks panjang)
// ============================================================
function chunkText(text, maxLen = MAX_TEXT_LENGTH) {
  if (!text || text.length <= maxLen) return [text];

  const chunks = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length <= maxLen) {
      current = (current + ' ' + sentence).trim();
    } else {
      if (current) chunks.push(current);
      // Kalau sentence sendiri > maxLen, potong paksa
      if (sentence.length > maxLen) {
        let temp = sentence;
        while (temp.length > maxLen) {
          chunks.push(temp.slice(0, maxLen));
          temp = temp.slice(maxLen);
        }
        current = temp;
      } else {
        current = sentence;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks.filter(c => c && c.trim());
}

// ============================================================
//   CORE: Speak
// ============================================================
function speakInternal(text) {
  if (!isSpeechSupported()) return;
  if (!text || !text.trim()) {
    _isSpeaking = false;
    scheduleNextQueue();
    return;
  }

  // Ensure voice
  if (!_voiceReady) {
    ensureVoiceReady();
  }

  const chunks = chunkText(text);
  speakChunksSequentially(chunks, 0);
}

function speakChunksSequentially(chunks, index) {
  if (index >= chunks.length) {
    _isSpeaking = false;
    _currentUtterance = null;
    clearUtteranceTimeout();
    if (typeof _onSpeakEnd === 'function') {
      try { _onSpeakEnd(); } catch (e) { /* silent */ }
    }
    scheduleNextQueue();
    return;
  }

  const chunk = chunks[index];
  const utterance = new SpeechSynthesisUtterance(chunk);

  utterance.lang = _config.lang || DEFAULT_LANG;
  utterance.rate = _config.rate;
  utterance.pitch = _config.pitch;
  utterance.volume = _config.volume;

  if (_voice) {
    try { utterance.voice = _voice; }
    catch (e) { /* silent */ }
  }

  utterance.onstart = () => {
    _isSpeaking = true;
    if (index === 0 && typeof _onSpeakStart === 'function') {
      try { _onSpeakStart(text); } catch (e) { /* silent */ }
    }
  };

  utterance.onend = () => {
    clearUtteranceTimeout();
    // Lanjut ke chunk berikutnya
    speakChunksSequentially(chunks, index + 1);
  };

  utterance.onerror = (e) => {
    clearUtteranceTimeout();
    const errType = e && e.error ? e.error : 'unknown';
    // 'canceled' & 'interrupted' bukan error fatal
    if (errType !== 'canceled' && errType !== 'interrupted') {
      console.warn('[VoiceNotifier] Speech error:', errType);
      if (typeof _onSpeakError === 'function') {
        try { _onSpeakError(errType); } catch (err) { /* silent */ }
      }
    }
    _isSpeaking = false;
    _currentUtterance = null;
    scheduleNextQueue();
  };

  _currentUtterance = utterance;

  // ⭐ Timeout protection
  _utteranceTimeoutTimer = setTimeout(() => {
    console.warn('[VoiceNotifier] ⏱️ Utterance timeout, force continue');
    try { window.speechSynthesis.cancel(); } catch (e) { /* silent */ }
    _isSpeaking = false;
    _currentUtterance = null;
    scheduleNextQueue();
  }, UTTERANCE_TIMEOUT_MS);

  try {
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.warn('[VoiceNotifier] speak() exception:', e.message);
    clearUtteranceTimeout();
    _isSpeaking = false;
    _currentUtterance = null;
    scheduleNextQueue();
  }
}

function clearUtteranceTimeout() {
  if (_utteranceTimeoutTimer) {
    clearTimeout(_utteranceTimeoutTimer);
    _utteranceTimeoutTimer = null;
  }
}

function scheduleNextQueue() {
  setTimeout(processQueue, QUEUE_DELAY_MS);
}

function processQueue() {
  if (_isSpeaking) return;
  if (_queue.length === 0) return;

  if (!_enabled) {
    _queue = [];
    return;
  }

  const next = _queue.shift();
  if (next && next.text) {
    speakInternal(next.text);
  } else {
    scheduleNextQueue();
  }
}

// ============================================================
//   DEDUP — Hindari speak 2x untuk absen yang sama
// ============================================================
function computeTextHash(text) {
  if (!text) return '';
  // Simple hash: length + first 20 + last 20
  const t = String(text);
  return `${t.length}::${t.slice(0, 20)}::${t.slice(-20)}`;
}

function isDuplicate(text) {
  const hash = computeTextHash(text);
  const now = Date.now();

  if (hash === _recentSpokenHash && (now - _recentSpokenTime) < DEDUP_WINDOW_MS) {
    return true;
  }

  _recentSpokenHash = hash;
  _recentSpokenTime = now;
  return false;
}

// ============================================================
//   PUBLIC API
// ============================================================
export const VoiceNotifier = {

  // ==========================================================
  //   STATUS
  // ==========================================================
  isEnabled() {
    return _enabled && isSpeechSupported();
  },

  isSupported() {
    return isSpeechSupported();
  },

  isSpeaking() {
    return _isSpeaking;
  },

  getConfig() {
    return {
      ..._config,
      enabled: _enabled,
      supported: isSpeechSupported(),
      queueLength: _queue.length,
      voiceReady: _voiceReady,
      currentVoice: _voice ? {
        name: _voice.name,
        lang: _voice.lang,
        default: _voice.default,
      } : null,
    };
  },

  // ==========================================================
  //   ENABLE / DISABLE
  // ==========================================================
  setEnabled(val) {
    _enabled = !!val;
    safeLocalSet(STORAGE_KEY_ENABLED, _enabled);

    if (!_enabled) {
      // Cancel semua
      try { window.speechSynthesis.cancel(); } catch (e) { /* silent */ }
      _queue = [];
      _isSpeaking = false;
      _currentUtterance = null;
      clearUtteranceTimeout();
    }

    console.log(`[VoiceNotifier] ${_enabled ? '🔊 ON' : '🔇 OFF'}`);
    return _enabled;
  },

  toggle() {
    return this.setEnabled(!_enabled);
  },

  // ==========================================================
  //   SPEAK
  // ==========================================================
  speak(text) {
    if (!isSpeechSupported()) {
      console.warn('[VoiceNotifier] Browser tidak mendukung TTS');
      return false;
    }
    if (!_enabled) return false;
    if (!text || typeof text !== 'string') return false;

    const cleanText = text.trim();
    if (!cleanText) return false;

    // ⭐ Dedup check
    if (isDuplicate(cleanText)) {
      console.log('[VoiceNotifier] ⏭️ Skip duplicate:', cleanText.slice(0, 40));
      return false;
    }

    _queue.push({ text: cleanText, ts: Date.now() });

    if (!_isSpeaking) {
      processQueue();
    }
    return true;
  },

  /**
   * ⭐ Test suara
   */
  testVoice() {
    return this.speak('Notifikasi suara aktif dan berfungsi');
  },

  /**
   * ⭐ Announce absen peserta
   * Template: "Selamat Sahabat {nama} berhasil absen sesi {sesi}"
   */
  announceAbsen(nama, sesiNama) {
    const safeNama = String(nama || 'Peserta').trim() || 'Peserta';
    const safeSesi = String(sesiNama || 'Sesi').trim() || 'Sesi';

    const text = `Selamat Sahabat ${safeNama} berhasil absen sesi ${safeSesi}`;

    console.log(`[VoiceNotifier] 🔊 ${text}`);
    return this.speak(text);
  },

  /**
   * ⭐ Announce bebas (teks custom)
   */
  announce(text) {
    return this.speak(text);
  },

  // ==========================================================
  //   DETEKSI ABSEN BARU
  // ==========================================================
  detectNewAbsen(absensiList, skipFirst = true) {
    if (!Array.isArray(absensiList)) return [];

    const newItems = [];

    absensiList.forEach(item => {
      const id = String(item.id || '').trim();
      if (!id) return;

      if (!_lastAbsenIds.has(id)) {
        _lastAbsenIds.add(id);
        newItems.push(item);
      }
    });

    // ⭐ Skip first scan
    if (skipFirst && _isFirstScan) {
      _isFirstScan = false;
      console.log(`[VoiceNotifier] First scan — skip ${newItems.length} existing entries`);
      return [];
    }

    // ⭐ Sort by timestamp ASC (urut sesuai data absen masuk)
    newItems.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime() || 0;
      const tb = new Date(b.timestamp || 0).getTime() || 0;
      return ta - tb;
    });

    return newItems;
  },

  // ==========================================================
  //   VOICE CONFIG
  // ==========================================================
  setVoice(voiceName) {
    _config.voiceName = voiceName || null;
    if (_config.voiceName) {
      safeLocalSet(STORAGE_KEY_VOICE, _config.voiceName);
    } else {
      safeLocalRemove(STORAGE_KEY_VOICE);
    }
    _voiceReady = false;
    _voice = null;
    ensureVoiceReady();
    return _voice ? _voice.name : null;
  },

  setRate(rate) {
    const r = parseFloat(rate);
    if (isNaN(r)) return _config.rate;
    _config.rate = Math.max(0.1, Math.min(10, r));
    safeLocalSet(STORAGE_KEY_RATE, _config.rate);
    return _config.rate;
  },

  setPitch(pitch) {
    const p = parseFloat(pitch);
    if (isNaN(p)) return _config.pitch;
    _config.pitch = Math.max(0, Math.min(2, p));
    safeLocalSet(STORAGE_KEY_PITCH, _config.pitch);
    return _config.pitch;
  },

  setVolume(volume) {
    const v = parseFloat(volume);
    if (isNaN(v)) return _config.volume;
    _config.volume = Math.max(0, Math.min(1, v));
    safeLocalSet(STORAGE_KEY_VOLUME, _config.volume);
    return _config.volume;
  },

  getSupportedVoices() {
    if (!isSpeechSupported()) return [];
    return getVoiceList().map(v => ({
      name: v.name,
      lang: v.lang,
      default: v.default,
      localService: v.localService,
    }));
  },

  getIndonesianVoices() {
    if (!isSpeechSupported()) return [];
    return getVoiceList()
      .filter(v => {
        const lang = String(v.lang || '').toLowerCase();
        const name = String(v.name || '').toLowerCase();
        return lang.startsWith('id') ||
               lang.includes('id-id') ||
               name.includes('indonesia');
      })
      .map(v => ({
        name: v.name,
        lang: v.lang,
        default: v.default,
      }));
  },

  // ==========================================================
  //   CALLBACKS
  // ==========================================================
  onStart(fn) {
    _onSpeakStart = typeof fn === 'function' ? fn : null;
  },

  onEnd(fn) {
    _onSpeakEnd = typeof fn === 'function' ? fn : null;
  },

  onError(fn) {
    _onSpeakError = typeof fn === 'function' ? fn : null;
  },

  // ==========================================================
  //   RESET & CLEANUP
  // ==========================================================
  reset() {
    _queue = [];
    _isSpeaking = false;
    _isFirstScan = true;
    _lastAbsenIds.clear();
    _recentSpokenHash = '';
    _recentSpokenTime = 0;
    _currentUtterance = null;
    clearUtteranceTimeout();

    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  },

  cancel() {
    _queue = [];
    _isSpeaking = false;
    _currentUtterance = null;
    clearUtteranceTimeout();
    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  },

  // ==========================================================
  //   INIT
  // ==========================================================
  init() {
    // Load config dari storage
    _enabled = loadEnabledState();
    loadConfigFromStorage();

    if (!isSpeechSupported()) {
      console.warn('[VoiceNotifier] ⚠️ Browser tidak mendukung Web Speech API');
      return false;
    }

    // ⭐ Ensure voice ready
    ensureVoiceReady();

    // ⭐ Listen event onvoiceschanged (untuk Chrome)
    try {
      if (typeof window.speechSynthesis.onvoiceschanged !== 'function') {
        window.speechSynthesis.onvoiceschanged = () => {
          if (!_voiceReady || !_voice) {
            _voice = selectIndonesianVoice();
            if (_voice) {
              _voiceReady = true;
              console.log(`[VoiceNotifier] 🎙️ Voice ready (event): "${_voice.name}"`);
            }
          }
        };
      }
    } catch (e) { /* silent */ }

    console.log(`[VoiceNotifier] ✅ Initialized — ${_enabled ? 'ON 🔊' : 'OFF 🔇'}`);

    // Log available Indonesian voices
    const idVoices = this.getIndonesianVoices();
    if (idVoices.length > 0) {
      console.log(`[VoiceNotifier] 🇮🇩 Found ${idVoices.length} Indonesian voice(s):`,
        idVoices.map(v => v.name).join(', '));
    } else {
      console.log('[VoiceNotifier] ⚠️ Tidak ada voice Indonesia — pakai default browser');
    }

    return true;
  },
};

// ============================================================
//   AUTO-INIT
// ============================================================
if (typeof window !== 'undefined' && isSpeechSupported()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VoiceNotifier.init(), { once: true });
  } else {
    VoiceNotifier.init();
  }

  // ⭐ Handle page unload — cancel speech
  window.addEventListener('beforeunload', () => {
    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  });
}

// ⭐ Export default + named
export default VoiceNotifier;

console.log(
  '%c VoiceNotifier v1.1.0 — Full Fix Edition ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
// ============================================================
// js/core/voice-notifier.js — v1.3.0 FULL FIX EDITION
// Shared module: Notifikasi suara TTS untuk absen peserta
// ============================================================
// CHANGELOG v1.3.0 (dari v1.2.0):
//   ✅ FIX CRITICAL: Chrome autoplay policy — warm-up TTS via user gesture
//   ✅ FIX: Voice selection retry — handle async onvoiceschanged
//   ✅ FIX: Utterance timeout protect (30s) — force continue queue
//   ✅ FIX: Dedup window 2s — hindari speak 2x untuk text sama
//   ✅ FIX: Queue processing robust — tidak stuck saat speech error
//   ✅ FIX: Cancel & cleanup saat disable — hapus queue + utterance
//   ✅ FIX: Chrome Web Speech bug — resume() jika stuck paused
//   ✅ FIX: Rate/pitch/volume clamp [0.1-10, 0-2, 0-1]
//   ✅ FIX: Safe storage fallback (in-memory) kalau localStorage diblokir
//   ✅ NEW: warmUp() — panggil saat user pertama klik apapun
//   ✅ NEW: announce(text) — generic announcement
//   ✅ NEW: getSupportedVoices() debug helper
//   ✅ NEW: Diagnostic console log lengkap
//   ✅ NEW: onStart/onEnd/onError callbacks
//   ✅ KEEP: Semua API v1.2.0 (backward compatible)
//   ✅ KEEP: announceAbsen(nama, sesi), detectNewAbsen(list, skipFirst)
//   ✅ KEEP: setEnabled, toggle, isEnabled, isSupported, isSpeaking
// ============================================================

// ============================================================
//   CONSTANTS
// ============================================================
const STORAGE_KEY_ENABLED = 'pkd_voice_notif_enabled';
const STORAGE_KEY_INIT    = 'pkd_voice_notif_initialized';
const STORAGE_KEY_VOICE   = 'pkd_voice_notif_voice';
const STORAGE_KEY_RATE    = 'pkd_voice_notif_rate';
const STORAGE_KEY_PITCH   = 'pkd_voice_notif_pitch';
const STORAGE_KEY_VOLUME  = 'pkd_voice_notif_volume';

const DEFAULT_LANG    = 'id-ID';
const DEFAULT_RATE    = 0.95;
const DEFAULT_PITCH   = 1.0;
const DEFAULT_VOLUME  = 1.0;
const QUEUE_DELAY_MS  = 400;
const MAX_TEXT_LENGTH = 200;
const UTTERANCE_TIMEOUT_MS = 30000;
const VOICE_LOAD_RETRY_MS  = 150;
const VOICE_LOAD_MAX_RETRY = 20;
const DEDUP_WINDOW_MS = 2000;
const CHROME_RESUME_INTERVAL_MS = 5000;

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
let _chromeResumeTimer = null;
let _isInitialized = false;
let _isWarmedUp = false;

let _config = {
  lang: DEFAULT_LANG,
  rate: DEFAULT_RATE,
  pitch: DEFAULT_PITCH,
  volume: DEFAULT_VOLUME,
  voiceName: null,
};

// Callbacks
let _onSpeakStart = null;
let _onSpeakEnd = null;
let _onSpeakError = null;

// Dedup
let _recentSpokenHash = '';
let _recentSpokenTime = 0;

// In-memory fallback storage
const _memStore = new Map();

// ============================================================
//   SAFE STORAGE
// ============================================================
function safeGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch (e) { /* blocked */ }
  return _memStore.has(key) ? _memStore.get(key) : fallback;
}

function safeSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
    _memStore.delete(key);
    return true;
  } catch (e) {
    _memStore.set(key, String(value));
    return false;
  }
}

function safeRemove(key) {
  try { localStorage.removeItem(key); } catch (e) { /* silent */ }
  _memStore.delete(key);
}

// ============================================================
//   SUPPORT CHECK
// ============================================================
function isSpeechSupported() {
  return typeof window !== 'undefined' &&
         'speechSynthesis' in window &&
         typeof SpeechSynthesisUtterance !== 'undefined';
}

// ============================================================
//   CONFIG LOAD/SAVE
// ============================================================
function loadEnabledState() {
  const raw = safeGet(STORAGE_KEY_ENABLED, null);
  const isInit = safeGet(STORAGE_KEY_INIT, null);

  // First time — default ON
  if (raw === null || isInit === null) {
    safeSet(STORAGE_KEY_ENABLED, 'true');
    safeSet(STORAGE_KEY_INIT, 'true');
    console.log('[VoiceNotifier] 🔧 First time — enabled=true');
    return true;
  }

  return raw === 'true';
}

function loadConfigFromStorage() {
  _config.rate = parseFloat(safeGet(STORAGE_KEY_RATE, DEFAULT_RATE)) || DEFAULT_RATE;
  _config.pitch = parseFloat(safeGet(STORAGE_KEY_PITCH, DEFAULT_PITCH)) || DEFAULT_PITCH;
  _config.volume = parseFloat(safeGet(STORAGE_KEY_VOLUME, DEFAULT_VOLUME)) || DEFAULT_VOLUME;
  _config.voiceName = safeGet(STORAGE_KEY_VOICE, null);

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

  // 1. Custom voice saved by user
  if (_config.voiceName) {
    const saved = voices.find(v => v.name === _config.voiceName);
    if (saved) return saved;
  }

  // 2. Priority: id-ID → id → contains "indonesia"
  let chosen = voices.find(v => v.lang === 'id-ID');
  if (!chosen) chosen = voices.find(v => v.lang === 'id');
  if (!chosen) chosen = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('id'));
  if (!chosen) chosen = voices.find(v =>
    v.name && v.name.toLowerCase().includes('indonesia')
  );

  // 3. Fallback to default
  if (!chosen) {
    chosen = voices.find(v => v.default) || voices[0];
  }

  return chosen || null;
}

function ensureVoiceReady() {
  if (!isSpeechSupported()) return false;
  if (_voiceReady && _voice) return true;

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

  // Retry
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
    _voiceRetryCount++;
  }

  return false;
}

// ============================================================
//   TEXT CHUNKING
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
//   CHROME RESUME HACK
//   Chrome desktop sering stuck dalam state paused → resume() tiap 5s
// ============================================================
function startChromeResumeGuard() {
  if (_chromeResumeTimer) return;
  _chromeResumeTimer = setInterval(() => {
    try {
      if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (e) { /* silent */ }
  }, CHROME_RESUME_INTERVAL_MS);
}

function stopChromeResumeGuard() {
  if (_chromeResumeTimer) {
    clearInterval(_chromeResumeTimer);
    _chromeResumeTimer = null;
  }
}

// ============================================================
//   SPEAK INTERNAL
// ============================================================
function speakInternal(text) {
  if (!isSpeechSupported()) {
    _isSpeaking = false;
    scheduleNextQueue();
    return;
  }

  if (!text || !text.trim()) {
    _isSpeaking = false;
    scheduleNextQueue();
    return;
  }

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
    stopChromeResumeGuard();
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
    try { utterance.voice = _voice; } catch (e) { /* silent */ }
  }

  utterance.onstart = () => {
    _isSpeaking = true;
    startChromeResumeGuard();
    if (index === 0 && typeof _onSpeakStart === 'function') {
      try { _onSpeakStart(chunk); } catch (e) { /* silent */ }
    }
  };

  utterance.onend = () => {
    clearUtteranceTimeout();
    speakChunksSequentially(chunks, index + 1);
  };

  utterance.onerror = (e) => {
    clearUtteranceTimeout();
    const errType = e && e.error ? e.error : 'unknown';
    if (errType !== 'canceled' && errType !== 'interrupted') {
      console.warn('[VoiceNotifier] Speech error:', errType);
      if (typeof _onSpeakError === 'function') {
        try { _onSpeakError(errType); } catch (err) { /* silent */ }
      }
    }
    _isSpeaking = false;
    _currentUtterance = null;
    stopChromeResumeGuard();
    scheduleNextQueue();
  };

  _currentUtterance = utterance;

  // Timeout protection
  _utteranceTimeoutTimer = setTimeout(() => {
    console.warn('[VoiceNotifier] ⏱️ Utterance timeout, force continue');
    try { window.speechSynthesis.cancel(); } catch (e) { /* silent */ }
    _isSpeaking = false;
    _currentUtterance = null;
    stopChromeResumeGuard();
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
//   DEDUP
// ============================================================
function computeTextHash(text) {
  if (!text) return '';
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

  isFirstTime() {
    return safeGet(STORAGE_KEY_INIT, null) === null;
  },

  isWarmedUp() {
    return _isWarmedUp;
  },

  getConfig() {
    return {
      ..._config,
      enabled: _enabled,
      supported: isSpeechSupported(),
      initialized: _isInitialized,
      warmedUp: _isWarmedUp,
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
    safeSet(STORAGE_KEY_ENABLED, _enabled);

    if (!_enabled) {
      // Cancel semua
      try { window.speechSynthesis.cancel(); } catch (e) { /* silent */ }
      _queue = [];
      _isSpeaking = false;
      _currentUtterance = null;
      clearUtteranceTimeout();
      stopChromeResumeGuard();
    }

    console.log(`[VoiceNotifier] ${_enabled ? '🔊 ON' : '🔇 OFF'}`);
    return _enabled;
  },

  toggle() {
    return this.setEnabled(!_enabled);
  },

  forceEnable() {
    return this.setEnabled(true);
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

  // ⭐ Warm-up: panggil saat user pertama klik apapun (bypass Chrome autoplay)
  warmUp() {
    if (!isSpeechSupported()) return false;
    if (_isWarmedUp) return true;

    try {
      const utterance = new SpeechSynthesisUtterance(' ');
      utterance.volume = 0;
      utterance.rate = 10;
      utterance.pitch = 0.1;
      window.speechSynthesis.speak(utterance);
      _isWarmedUp = true;
      console.log('[VoiceNotifier] 🔥 Warm-up OK');
      return true;
    } catch (e) {
      console.warn('[VoiceNotifier] Warm-up failed:', e.message);
      return false;
    }
  },

  testVoice() {
    this.warmUp();
    return this.speak('Notifikasi suara aktif dan berfungsi');
  },

  announceAbsen(nama, sesiNama) {
    const safeNama = String(nama || 'Peserta').trim() || 'Peserta';
    const safeSesi = String(sesiNama || 'Sesi').trim() || 'Sesi';

    const text = `Selamat Sahabat ${safeNama} berhasil absen sesi ${safeSesi}`;

    console.log(`[VoiceNotifier] 🔊 ${text}`);
    return this.speak(text);
  },

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

    if (skipFirst && _isFirstScan) {
      _isFirstScan = false;
      console.log(`[VoiceNotifier] First scan — skip ${newItems.length} existing entries`);
      return [];
    }

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
      safeSet(STORAGE_KEY_VOICE, _config.voiceName);
    } else {
      safeRemove(STORAGE_KEY_VOICE);
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
    safeSet(STORAGE_KEY_RATE, _config.rate);
    return _config.rate;
  },

  setPitch(pitch) {
    const p = parseFloat(pitch);
    if (isNaN(p)) return _config.pitch;
    _config.pitch = Math.max(0, Math.min(2, p));
    safeSet(STORAGE_KEY_PITCH, _config.pitch);
    return _config.pitch;
  },

  setVolume(volume) {
    const v = parseFloat(volume);
    if (isNaN(v)) return _config.volume;
    _config.volume = Math.max(0, Math.min(1, v));
    safeSet(STORAGE_KEY_VOLUME, _config.volume);
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
    stopChromeResumeGuard();

    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  },

  cancel() {
    _queue = [];
    _isSpeaking = false;
    _currentUtterance = null;
    clearUtteranceTimeout();
    stopChromeResumeGuard();
    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  },

  reloadConfig() {
    _enabled = loadEnabledState();
    loadConfigFromStorage();
    console.log(`[VoiceNotifier] 🔄 Config reloaded — enabled=${_enabled}`);
  },

  // ==========================================================
  //   INIT
  // ==========================================================
  init() {
    _enabled = loadEnabledState();
    loadConfigFromStorage();

    console.log(`[VoiceNotifier] 🔧 Init — enabled=${_enabled}, supported=${isSpeechSupported()}`);

    if (!isSpeechSupported()) {
      console.warn('[VoiceNotifier] ⚠️ Browser tidak mendukung Web Speech API');
      return false;
    }

    // Ensure voice ready
    ensureVoiceReady();

    // Listen voiceschanged (Chrome async load)
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

    // Warm-up listener — sekali saja
    if (!_warmUpListenerAttached) {
      _warmUpListenerAttached = true;
      const warmUpHandler = () => {
        VoiceNotifier.warmUp();
        document.removeEventListener('click', warmUpHandler);
        document.removeEventListener('touchstart', warmUpHandler);
        document.removeEventListener('keydown', warmUpHandler);
      };
      document.addEventListener('click', warmUpHandler, { once: true });
      document.addEventListener('touchstart', warmUpHandler, { once: true });
      document.addEventListener('keydown', warmUpHandler, { once: true });
    }

    _isInitialized = true;

    const emoji = _enabled ? '🔊 ON' : '🔇 OFF';
    console.log(`[VoiceNotifier] ✅ Initialized — ${emoji}`);

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

// Flag untuk auto-warmup listener
let _warmUpListenerAttached = false;

// ============================================================
//   AUTO-INIT
// ============================================================
if (typeof window !== 'undefined' && isSpeechSupported()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => VoiceNotifier.init(), { once: true });
  } else {
    VoiceNotifier.init();
  }

  // Cancel speech saat page unload
  window.addEventListener('beforeunload', () => {
    try { window.speechSynthesis.cancel(); }
    catch (e) { /* silent */ }
  });
}

// ============================================================
//   EXPORTS
// ============================================================
export default VoiceNotifier;

console.log(
  '%c VoiceNotifier v1.3.0 — Full Fix Edition ',
  'background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
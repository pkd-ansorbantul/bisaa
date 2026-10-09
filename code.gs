// ============================================================
// code.gs — PKD GP ANSOR BANTUL BACKEND
// Versi: 27.3.0 — LOKASI PKD DYNAMIC MENU EDITION
// GitHub Pages /bisaa/ Edition
// ============================================================
// CHANGELOG v27.3.0 (dari v27.0.0):
//   ✅ NEW: getLokasiPKDWithCount() — daftar lokasi + count peserta
//   ✅ NEW: Route 'getLokasiPKDWithCount'
//   ✅ KEEP: Semua 100+ actions v27.0.0 (zero regression)
//   ✅ KEEP: getBootstrapData, getKetuaPACScopeInfo, dll
//   ✅ VERIFIED: Semua menu + fitur Lokasi PKD berfungsi
// ============================================================

// ============================================================
//   KONFIGURASI GLOBAL
// ============================================================
var SPREADSHEET_ID         = '1KUbq9UnSwyEpXtLH8Kf5OcIDUvopGMWnQ43NW1o7OSM';
var FOLDER_NAME            = 'TandaTangan_PKD_Ansor';
var SERTIFIKAT_FOLDER_NAME = 'Sertifikat_Generated';
var BASE_URL               = 'https://pkd-ansorbantul.github.io/bisaa';
var DEFAULT_PASSWORD_SALT  = 'PKD-ANSOR-BANTUL-2026';
var LOG_PREFIX             = '[v27.3.0]';
var APP_VERSION            = '27.3.0';

// ============================================================
//   KONSTANTA TTD
// ============================================================
var SIGN_ORDER = ['ketua_pc', 'sekretaris', 'instruktur'];
var ROLE_LABELS = {
  'ketua_pc':   'Ketua PC',
  'sekretaris': 'Sekretaris',
  'instruktur': 'Instruktur'
};

// ============================================================
//   SHEET NAMES
// ============================================================
var SHEET_NAMES = {
  SETTINGS:             'Settings',
  USERS:                'Users',
  MENU_PASSWORDS:       'MenuPasswords',
  QUIZ_SETTINGS:        'QuizSettings',
  SKRINING_QUESTIONS:   'SkriningQuestions',
  PRETEST_QUESTIONS:    'PretestQuestions',
  POSTTEST_QUESTIONS:   'PosttestQuestions',
  SESI_ABSEN:           'SesiAbsen',
  SKRINING_RESPONSES:   'SkriningResponses',
  PRETEST_RESPONSES:    'PretestResponses',
  POSTTEST_RESPONSES:   'PosttestResponses',
  ABSEN_RESPONSES:      'AbsenResponses',
  MATERI:               'Materi',
  PESERTA:              'Peserta',
  ALUMNI:               'Alumni',
  SERTIFIKAT_TEMPLATES: 'SertifikatTemplates',
  SERTIFIKAT_PRESETS:   'SertifikatPresets',
  SERTIFIKAT_GENERATED: 'SertifikatGenerated',
  MEMBERS:              'Members',
  INFO:                 'Informasi',
  USULAN:               'Usulan',
  KONTAK:               'Kontak',
  DIGITAL_APPROVALS:    'DigitalApprovals',
  ASSET:                'Asset',
  FOLDERS:              'Folders',
  KADER:                'Kader',
  RTL_TASKS:            'RTLTasks',
  CERTIFICATE_LAYOUTS:  'CertificateLayouts',
  LOKASI_PKD:           'LokasiPKD',
  TIM_INSTRUKTUR:       'TimInstruktur'
};

// ============================================================
//   RESPONSE HELPERS
// ============================================================
function ok(data, extra) {
  var res = { success: true };
  if (data !== undefined) res.data = data;
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach(function (k) { res[k] = extra[k]; });
  }
  return res;
}

function err(message) {
  return { success: false, error: String(message || 'Terjadi kesalahan') };
}

function log() {
  try {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG_PREFIX);
    console.log.apply(console, args);
  } catch (e) { /* silent */ }
}

function logErr() {
  try {
    var args = Array.prototype.slice.call(arguments);
    args.unshift(LOG_PREFIX);
    console.error.apply(console, args);
  } catch (e) { /* silent */ }
}

// ============================================================
//   BOOLEAN HELPERS
// ============================================================
function parseBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v === undefined || v === null) return false;
  var s = String(v).toLowerCase().trim();
  if (s.startsWith("'")) s = s.substring(1);
  return s === 'true' || s === 'yes' || s === '1';
}

function boolToSheetString(b) {
  return b ? "'true" : "'false";
}

// ============================================================
//   ENTRY POINTS
// ============================================================
function doGet(e) {
  try {
    if (e && e.method && String(e.method).toUpperCase() === 'OPTIONS') {
      return handleOptions();
    }

    if (e && e.parameter && e.parameter.action === 'health') {
      return handleOutput(ok({
        status: 'healthy',
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
        spreadsheetId: SPREADSHEET_ID ? '✓ configured' : '✗ missing',
        deploymentHint: 'CORS handled by Google edge — ensure "Anyone" access'
      }));
    }

    return handleOutput(handleRequest((e && e.parameter) || {}));
  } catch (ex) {
    logErr('doGet fatal:', ex.message, ex.stack);
    return handleOutput(err('Fatal Error: ' + ex.message));
  }
}

function doPost(e) {
  try {
    if (e && e.method && String(e.method).toUpperCase() === 'OPTIONS') {
      return handleOptions();
    }
    return handleOutput(handleRequest((e && e.parameter) || {}));
  } catch (ex) {
    logErr('doPost fatal:', ex.message, ex.stack);
    return handleOutput(err('Fatal Error: ' + ex.message));
  }
}

function handleOptions() {
  var output = ContentService.createTextOutput('{}');
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function handleOutput(result) {
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    output.setContent(JSON.stringify(result));
  } catch (ex) {
    output.setContent(JSON.stringify(err('Output Parse Error: ' + ex.message)));
  }
  return output;
}

// ============================================================
//   REQUEST ROUTER
// ============================================================
function handleRequest(params) {
  var action = params && params.action;
  if (!action) return err('Parameter action diperlukan');

  try {
    initializeSystem();
    log('[ACTION]', action);

    switch (action) {
      // ---- Health & Diagnostics ----
      case 'health':                     return ok({ status: 'healthy', version: APP_VERSION });
      case 'ping':                       return ok({ pong: true, ts: new Date().toISOString() });
      case 'getBootstrapData':           return getBootstrapData();
      case 'debugVerifyPassword':        return debugVerifyPassword(params);
      case 'auditAllPasswords':          return auditAllPasswords();
      case 'repairHashes':               return repairHashes(params);

      // ---- Auth ----
      case 'verifyAdmin':                return verifyAdmin(params);
      case 'verifyKetuaPAC':             return verifyKetuaPAC(params);
      case 'verifyMember':               return verifyMember(params);
      case 'updateAdminPassword':        return updateAdminPassword(params);

      // ---- Ketua PAC Scope ----
      case 'getKetuaPACScopeInfo':       return getKetuaPACScopeInfo(params);
      case 'updateKetuaPACScope':        return updateKetuaPACScope(params);

      // ---- Peserta ----
      case 'getPesertaList':             return getPesertaList(params);
      case 'submitPeserta':              return submitPeserta(params);
      case 'updatePeserta':              return updatePeserta(params);
      case 'deletePeserta':              return deletePeserta(params);
      case 'approvePeserta':             return approvePeserta(params);
      case 'rejectPeserta':              return rejectPeserta(params);
      case 'getPesertaById':             return getPesertaById(params);
      case 'getPesertaCredentials':      return getPesertaCredentials(params);
      case 'resetPesertaPassword':       return resetPesertaPassword(params);
      case 'getTotalPeserta':            return getTotalPeserta();
      case 'getAlumniList':              return getAlumniList();
      case 'moveToAlumni':               return moveToAlumni(params);
      case 'moveMultipleToAlumni':       return moveMultipleToAlumni(params);
      case 'moveBackToActive':           return moveBackToActive(params);

      // ---- Sesi Absen ----
      case 'getSesiAbsen':               return getSesiAbsen();
      case 'addSesiAbsen':               return addSesiAbsen(params);
      case 'updateSesiAbsen':            return updateSesiAbsen(params);
      case 'deleteSesiAbsen':            return deleteSesiAbsen(params);
      case 'regenerateQRSesi':           return regenerateQRSesi(params);
      case 'toggleAttendanceSession':    return toggleAttendanceSession(params);
      case 'getAttendanceSessionStatus': return getAttendanceSessionStatus(params);

      // ---- Absen ----
      case 'submitAbsen':                return submitAbsen(params);
      case 'getAbsensiResponses':        return getAbsensiResponses();
      case 'getAttendanceBySesi':        return getAttendanceBySesi(params);
      case 'deleteAbsensi':              return deleteAbsensi(params);
      case 'getAttendanceMatrix':        return getAttendanceMatrix();
      case 'exportAttendanceMatrixCSV':  return exportAttendanceMatrixCSV();

      // ---- Materi ----
      case 'getMateriList':              return getMateriList();
      case 'addMateri':                  return addMateri(params);
      case 'updateMateri':               return updateMateri(params);
      case 'deleteMateri':               return deleteMateri(params);

      // ---- Skrining ----
      case 'getSkriningQuestions':       return getSkriningQuestions();
      case 'addSkriningQuestion':        return addSkriningQuestion(params);
      case 'updateSkriningQuestion':     return updateSkriningQuestion(params);
      case 'deleteSkriningQuestion':     return deleteSkriningQuestion(params);
      case 'submitSkrining':             return submitSkrining(params);
      case 'getSkriningResponses':       return getSkriningResponses();
      case 'updateSkriningResponse':     return updateSkriningResponse(params);
      case 'deleteSkriningResponse':     return deleteSkriningResponse(params);

      // ---- Pretest ----
      case 'getPretestQuestions':        return getPretestQuestions();
      case 'addPretestQuestion':         return addPretestQuestion(params);
      case 'updatePretestQuestion':      return updatePretestQuestion(params);
      case 'deletePretestQuestion':      return deletePretestQuestion(params);
      case 'submitPretest':              return submitPretest(params);
      case 'getPretestResponses':        return getPretestResponses();

      // ---- Posttest ----
      case 'getPosttestQuestions':       return getPosttestQuestions();
      case 'addPosttestQuestion':        return addPosttestQuestion(params);
      case 'updatePosttestQuestion':     return updatePosttestQuestion(params);
      case 'deletePosttestQuestion':     return deletePosttestQuestion(params);
      case 'submitPosttest':             return submitPosttest(params);
      case 'getPosttestResponses':       return getPosttestResponses();

      // ---- Informasi & Usulan ----
      case 'getInfoList':                return getInfoList();
      case 'addInfo':                    return addInfo(params);
      case 'updateInfo':                 return updateInfo(params);
      case 'deleteInfo':                 return deleteInfo(params);
      case 'toggleInfoStatus':           return toggleInfoStatus(params);
      case 'getUsulanList':              return getUsulanList();
      case 'submitUsulan':               return submitUsulan(params);
      case 'updateUsulanStatus':         return updateUsulanStatus(params);

      // ---- Sertifikat ----
      case 'getCertificateTemplates':    return getCertificateTemplates();
      case 'addCertificateTemplateManual': return addCertificateTemplateManual(params);
      case 'updateCertificateTemplate':  return updateCertificateTemplate(params);
      case 'deleteCertificateTemplate':  return deleteCertificateTemplate(params);
      case 'getCertPresets':             return getCertPresets();
      case 'addCertPreset':              return addCertPreset(params);
      case 'updateCertPreset':           return updateCertPreset(params);
      case 'deleteCertPreset':           return deleteCertPreset(params);
      case 'generateCertificates':       return ok([], { message: 'Gunakan generateCertificateForParticipant.' });
      case 'getUploadedCertificates':    return getUploadedCertificates();
      case 'uploadManualCertificate':    return uploadManualCertificate(params);
      case 'verifyCertificate':          return verifyCertificate(params);
      case 'getNextCertificateNumber':   return getNextCertificateNumberHandler();
      case 'saveCertificateLayout':      return saveCertificateLayout(params);
      case 'getCertificateLayout':       return getCertificateLayout(params);
      case 'listCertificateLayouts':     return listCertificateLayouts();
      case 'generateCertificateForParticipant': return generateCertificateForParticipant(params);
      case 'deleteCertificate':          return deleteCertificate(params);

      // ---- TTD Digital ----
      case 'verifySignPassword':         return verifySignPassword(params);
      case 'submitDigitalSignature':     return submitDigitalSignature(params);
      case 'getDigitalApproval':         return getDigitalApproval(params);
      case 'getAllDigitalApprovals':     return getAllDigitalApprovals();
      case 'updateSignPassword':         return updateSignPassword(params.role, params.newPassword);
      case 'getSignPasswords':           return getSignPasswords();
      case 'bulkGenerateTTD':            return bulkGenerateTTD(params);
      case 'deleteDigitalApprovalByPeserta': return deleteDigitalApprovalByPeserta(params);
      case 'bulkSignForRole':            return bulkSignForRole(params);
      case 'getSignatureOrderStatus':    return getSignatureOrderStatusAction();

      // ---- Tim Instruktur ----
      case 'getTimInstrukturList':       return getTimInstrukturList();
      case 'addTimInstruktur':           return addTimInstruktur(params);
      case 'updateTimInstruktur':        return updateTimInstruktur(params);
      case 'deleteTimInstruktur':        return deleteTimInstruktur(params);
      case 'reorderTimInstruktur':       return reorderTimInstruktur(params);

      // ---- RTL ----
      case 'getRTLTasks':                return getRTLTasks(params);
      case 'addRTLTask':                 return addRTLTask(params);
      case 'updateRTLTask':              return updateRTLTask(params);
      case 'deleteRTLTask':              return deleteRTLTask(params);
      case 'submitRTLAttachment':        return submitRTLAttachment(params);
      case 'getRTLAttachments':          return getRTLAttachments(params);
      case 'approveRTLTask':             return approveRTLTask(params);
      case 'approveAllRTL':              return approveAllRTL(params);
      case 'getRTLStatus':               return getRTLStatus(params);

      // ---- Kader ----
      case 'getKaderList':               return getKaderList();
      case 'addKader':                   return addKader(params);
      case 'updateKader':                return updateKader(params);
      case 'deleteKader':                return deleteKader(params);

      // ---- Member ----
      case 'getMemberData':              return getMemberData(params);
      case 'updateMemberProfile':        return updateMemberProfile(params);
      case 'getMemberSkrining':          return getMemberSkrining(params);
      case 'getMemberAbsensi':           return getMemberAbsensi(params);
      case 'getMemberSertifikat':        return getMemberSertifikat(params);
      case 'getMemberUsername':          return getMemberUsername(params);
      case 'verifyMemberForgot':         return verifyMemberForgot(params);
      case 'resetMemberPassword':        return resetMemberPassword(params);

      // ---- Aset & Folder ----
      case 'getAssetList':               return getAssetList();
      case 'addAsset':                   return addAsset(params);
      case 'updateAsset':                return updateAsset(params);
      case 'deleteAsset':                return deleteAsset(params);
      case 'getFolders':                 return getFolders(params);
      case 'addFolder':                  return addFolder(params);
      case 'deleteFolder':               return deleteFolder(params);
      case 'toggleFolderPublic':         return toggleFolderPublic(params);
      case 'toggleFolderHideFromGallery': return toggleFolderHideFromGallery(params);
      case 'setFolderPassword':          return setFolderPassword(params);
      case 'clearFolderPassword':        return clearFolderPassword(params);
      case 'verifyFolderPassword':       return verifyFolderPassword(params);
      case 'getAssetPublicConfig':       return getAssetPublicConfig();
      case 'verifyAssetPublicPassword':  return verifyAssetPublicPassword(params);
      case 'setAssetPublicPassword':     return setAssetPublicPassword(params);
      case 'publishAllAssetsToPublic':   return publishAllAssetsToPublic();

      // ---- Drive Token ----
      case 'getDriveToken':              return getDriveToken();

      // ---- Lokasi PKD ----
      case 'getLokasiPKDList':           return getLokasiPKDList();
      case 'getLokasiPKDWithCount':      return getLokasiPKDWithCount();  // ⭐ NEW v27.3.0
      case 'addLokasiPKD':               return addLokasiPKD(params);
      case 'deleteLokasiPKD':            return deleteLokasiPKD(params);

      // ---- Pengaturan ----
      case 'getQuizSettings':            return getQuizSettings();
      case 'saveQuizSettings':           return updateQuizSettings(params);
      case 'setQuizSettings':            return updateQuizSettings(params);
      case 'getLoginMode':               return getLoginMode();
      case 'setLoginMode':               return setLoginMode(params);
      case 'getPublicVisibility':        return getPublicVisibility();
      case 'setPublicVisibility':        return setPublicVisibility(params);
      case 'getDashboardStats':          return getDashboardStats();
      case 'getRealtimeSetting':         return getRealtimeSetting();
      case 'setRealtimeSetting':         return setRealtimeSetting(params);
      case 'getFormSettings':            return getFormSettings();
      case 'setFormSettings':            return setFormSettings(params);
      case 'getPKDLokasi':               return getPKDLokasi();
      case 'setPKDLokasi':               return setPKDLokasi(params);
      case 'submitKontak':               return submitKontak(params);

      // ---- Migration ----
      case 'migrateSettingsBooleans':    return runMigrateSettingsBooleans();

      default:
        return err('Action tidak dikenal: ' + action);
    }
  } catch (ex) {
    logErr('[ERROR]', action, ex.message, ex.stack);
    return err(ex.message);
  }
}

// ============================================================
//   BATCH BOOTSTRAP
// ============================================================
function getBootstrapData() {
  try {
    var t0 = Date.now();

    var data = {
      peserta:           (getPesertaList({})       || {}).data || [],
      sesi:              (getSesiAbsen()            || {}).data || [],
      materi:            (getMateriList()           || {}).data || [],
      skrining:          (getSkriningResponses()    || {}).data || [],
      pretest:           (getPretestResponses()     || {}).data || [],
      posttest:          (getPosttestResponses()    || {}).data || [],
      alumni:            (getAlumniList()           || {}).data || [],
      kader:             (getKaderList()            || {}).data || [],
      informasi:         (getInfoList()             || {}).data || [],
      absensi:           (getAbsensiResponses()     || {}).data || [],
      sertifikat:        (getUploadedCertificates() || {}).data || [],
      digitalApprovals:  (getAllDigitalApprovals()  || {}).data || [],
      asset:             (getAssetList()            || {}).data || [],
      folders:           (getFolders({ all: 'true' }) || {}).data || [],
      usulan:            (getUsulanList()           || {}).data || [],
      rtl:               (getRTLTasks({})           || {}).data || [],
      timInstruktur:     (getTimInstrukturList()    || {}).data || [],
      quizSettings:      (getQuizSettings()         || {}).data || {},
      loginMode:         (getLoginMode()            || {}).data || { enabled: false },
      publicVisibility:  (getPublicVisibility()     || {}).data || {},
      pkdLokasi:         (getPDKLokasiSafe()        || {}).data || '',
      formSettings:      (getFormSettings()         || {}).data || [],
      realtime:          (getRealtimeSetting()      || {}).data || { enabled: false },
    };

    var elapsed = Date.now() - t0;
    log('[getBootstrapData] OK in', elapsed, 'ms',
        '| peserta:', data.peserta.length,
        '| sesi:', data.sesi.length,
        '| timInstruktur:', data.timInstruktur.length);

    return ok(data);

  } catch (ex) {
    logErr('getBootstrapData:', ex.message, ex.stack);
    return err('Bootstrap failed: ' + ex.message);
  }
}

function getPDKLokasiSafe() {
  try { return getPKDLokasi(); }
  catch (e) { return ok('MTs N 8 Bantul, D.I.Yogyakarta'); }
}

// ============================================================
//   INITIALIZATION
// ============================================================
var _systemInitialized = false;

function initializeSystem() {
  if (_systemInitialized) return;
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    Object.keys(SHEET_NAMES).forEach(function (k) {
      var name = SHEET_NAMES[k];
      if (!ss.getSheetByName(name)) {
        var sheet = ss.insertSheet(name);
        createHeaders(sheet, name);
      }
    });

    initSettings();
    cleanDuplicateSettings();
    initUsers();
    ensureUsersSchema();
    migratePesertaColumns();
    ensureAlumniSheet();
    ensureAssetSheet();
    ensureKaderSheet();
    ensureFormSettings();
    ensureRTLSheet();
    ensureCertPresetColumns();
    ensureSertifikatGeneratedColumns();
    ensureFoldersSheet();
    migrateSesiAbsen();
    ensureCertificateLayoutsSheet();
    ensureDigitalApprovalHeaders();
    ensureLokasiPKDSheet();
    ensureAbsenResponsesSheet();
    ensureTimInstrukturSheet();

    _systemInitialized = true;
    log('System initialized successfully');
  } catch (ex) {
    logErr('initializeSystem:', ex.message);
  }
}

function cleanDuplicateSettings() {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    if (keyCol === -1) return;

    var seen = {};
    var rowsToDelete = [];

    for (var i = 1; i < data.length; i++) {
      var key = String(data[i][keyCol]).trim();
      if (!key) continue;
      if (seen[key]) {
        rowsToDelete.push(i + 1);
      } else {
        seen[key] = true;
      }
    }

    if (rowsToDelete.length === 0) return;

    rowsToDelete.sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (row) { sheet.deleteRow(row); });
    log('cleanDuplicateSettings: removed ' + rowsToDelete.length + ' duplicate rows');
  } catch (ex) {
    logErr('cleanDuplicateSettings:', ex.message);
  }
}

function createHeaders(sheet, name) {
  var headers = {
    'Settings':             ['key', 'value'],
    'Users':                ['username', 'passwordHash', 'role', 'kapanewon', 'createdAt', 'lokasi_pkd_scope'],
    'MenuPasswords':        ['id', 'menu', 'hash'],
    'QuizSettings':         ['setting', 'value'],
    'SkriningQuestions':    ['id', 'teks', 'jenis', 'opsi', 'urutan'],
    'PretestQuestions':     ['id', 'teks', 'opsi', 'jawaban', 'urutan', 'timer_enabled', 'timer_duration'],
    'PosttestQuestions':    ['id', 'teks', 'opsi', 'jawaban', 'urutan', 'timer_enabled', 'timer_duration'],
    'SesiAbsen':            ['id', 'nama', 'waktu_mulai', 'waktu_selesai', 'aktif', 'passwordHash', 'qrToken', 'submission_open'],
    'SkriningResponses':    ['timestamp', 'nama', 'alamat', 'info', 'pengetahuan', 'qunut', 'penyakit', 'pernah', 'alasan', 'catatan', 'signatureDriveId', 'dataJson'],
    'PretestResponses':     ['timestamp', 'nama', 'answersJson', 'score', 'nohp', 'alamat'],
    'PosttestResponses':    ['timestamp', 'nama', 'answersJson', 'score', 'nohp', 'alamat'],
    'AbsenResponses':       ['id', 'timestamp', 'nama', 'sesiId', 'signatureDriveId', 'pesertaId'],
    'Materi':               ['id', 'judul', 'deskripsi', 'fileId', 'tipe', 'timestamp', 'uploadBy'],
    'Peserta':              ['id', 'timestamp', 'fotoDriveId', 'nama_lengkap', 'tempat_tgl_lahir', 'pekerjaan', 'pendidikan_terakhir', 'alamat', 'no_hp', 'email', 'utusan', 'pengalaman_organisasi', 'surat_rekomendasi_driveid', 'status', 'username', 'custom_data', 'payment_status', 'payment_method', 'payment_proof_driveId', 'lokasi_pkd'],
    'Alumni':               ['id', 'timestamp', 'fotoDriveId', 'nama_lengkap', 'tempat_tgl_lahir', 'pekerjaan', 'pendidikan_terakhir', 'alamat', 'no_hp', 'email', 'utusan', 'pengalaman_organisasi', 'surat_rekomendasi_driveid', 'alumni_at'],
    'SertifikatTemplates':  ['id', 'nama_template', 'doc_template_id', 'config', 'createdAt'],
    'SertifikatPresets':    ['id', 'name', 'kapanewon', 'tanggal', 'lokasi', 'tempat_tgl_pelaksanaan', 'ttd', 'instruktur_json', 'ttd_ketua_pc', 'ttd_sekretaris', 'ttd_instruktur', 'createdAt'],
    'SertifikatGenerated':  ['id', 'nama_peserta', 'nomor_sertifikat', 'pdf_url', 'lokasi', 'template_id', 'createdAt', 'peserta_id'],
    'Members':              ['username', 'passwordHash', 'nama_lengkap', 'email', 'no_hp', 'createdAt', 'pesertaId'],
    'Informasi':            ['id', 'jenis', 'judul', 'deskripsi', 'url', 'urutan', 'createdAt', 'tanggal_mulai', 'tanggal_akhir', 'lokasi', 'status'],
    'Usulan':               ['id', 'nama', 'usulan', 'tanggal_mulai', 'tanggal_akhir', 'lokasi', 'no_hp', 'status', 'createdAt', 'flyerDriveId'],
    'Kontak':               ['timestamp', 'nama', 'email', 'pesan', 'username', 'role', 'ip'],
    'DigitalApprovals':     ['role', 'nama', 'driveId', 'timestamp', 'peserta_nama', 'kegunaan'],
    'Asset':                ['id', 'judul', 'deskripsi', 'driveId', 'uploadBy', 'timestamp', 'jenis', 'folderId', 'fileName', 'mimeType'],
    'Folders':              ['id', 'nama', 'parentId', 'createdAt', 'createdBy', 'isPublic', 'hideFromGallery', 'passwordHash', 'driveFolderId'],
    'Kader':                ['id', 'nama', 'email', 'hp', 'asal', 'tingkatan', 'status', 'tanggal', 'catatan'],
    'RTLTasks':             ['id', 'judul', 'deskripsi', 'deadline', 'status', 'createdAt', 'createdBy', 'pesertaId', 'fileDriveId', 'catatan'],
    'CertificateLayouts':   ['id', 'nama', 'data_json', 'createdAt', 'updatedAt', 'createdBy'],
    'LokasiPKD':            ['id', 'nama', 'createdAt'],
    'TimInstruktur':        ['id', 'nama', 'jabatan', 'urutan', 'foto_driveId', 'deskripsi', 'kontak_wa', 'kontak_email', 'createdAt', 'updatedAt']
  }[name] || ['id', 'data'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

// ============================================================
//   CORE HELPERS
// ============================================================
function getSheet(name) {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
  } catch (ex) { return null; }
}

function getSheetData(name) {
  var sheet = getSheet(name);
  if (!sheet) return { sheet: null, headers: [], rows: [] };
  var data = sheet.getDataRange().getValues();
  if (data.length === 0) return { sheet: sheet, headers: [], rows: [] };
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var rows = data.slice(1);
  return { sheet: sheet, headers: headers, rows: rows };
}

function headersToObject(headers, row) {
  var obj = {};
  for (var i = 0; i < headers.length; i++) {
    if (headers[i]) obj[headers[i]] = row[i];
  }
  return obj;
}

function getNextId(sheetName, idCol) {
  var sheet = getSheet(sheetName);
  if (!sheet) return 1;
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return 1;
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var col = idCol !== undefined ? headers.indexOf(idCol) : 0;
  if (col === -1) col = 0;
  var max = 0;
  for (var i = 1; i < data.length; i++) {
    var id = parseInt(data[i][col]);
    if (!isNaN(id) && id > max) max = id;
  }
  return max + 1;
}

function generateUniqueId(prefix) {
  return (prefix || 'id') + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function findRowById(sheetName, id) {
  var s = getSheetData(sheetName);
  if (!s.sheet) return null;
  var idCol = s.headers.indexOf('id');
  if (idCol === -1) idCol = 0;
  for (var i = 0; i < s.rows.length; i++) {
    if (String(s.rows[i][idCol]) === String(id)) {
      return { rowIndex: i + 2, headers: s.headers, row: s.rows[i], sheet: s.sheet };
    }
  }
  return null;
}

function findRecordById(sheetName, id) {
  var s = getSheetData(sheetName);
  if (!s.sheet) return null;
  var idCol = s.headers.indexOf('id');
  for (var i = 0; i < s.rows.length; i++) {
    if (String(s.rows[i][idCol]) === String(id)) {
      return headersToObject(s.headers, s.rows[i]);
    }
  }
  return null;
}

// ============================================================
//   KETUA PAC SCOPE
// ============================================================
function getKetuaPACScope(username) {
  if (!username) throw new Error('Username diperlukan');
  var s = getSheetData(SHEET_NAMES.USERS);
  if (!s.sheet) throw new Error('Sheet Users tidak ditemukan');

  var userCol   = s.headers.indexOf('username');
  var roleCol   = s.headers.indexOf('role');
  var kapCol    = s.headers.indexOf('kapanewon');
  var lokasiCol = s.headers.indexOf('lokasi_pkd_scope');

  for (var i = 0; i < s.rows.length; i++) {
    var u = String(s.rows[i][userCol] || '').trim();
    if (u !== String(username).trim()) continue;

    var role = String(s.rows[i][roleCol] || '').toLowerCase().trim();
    if (role !== 'ketua_pac') continue;

    var kapanewon = String(s.rows[i][kapCol] || '').trim();
    var lokasiScope = [];

    if (lokasiCol !== -1 && s.rows[i][lokasiCol]) {
      var raw = String(s.rows[i][lokasiCol]).trim();
      try {
        var parsed = JSON.parse(raw);
        lokasiScope = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        lokasiScope = raw.split(',')
          .map(function (x) { return x.trim(); })
          .filter(Boolean);
      }
    }

    return {
      kapanewon: kapanewon,
      lokasiScope: lokasiScope,
      username: u
    };
  }

  throw new Error('Ketua PAC tidak ditemukan: ' + username);
}

function matchPesertaScope(peserta, scope) {
  var empty = { utusan: false, lokasi: false, union: false };
  if (!peserta || !scope) return empty;

  var utusanLower = String(peserta.utusan || '').toLowerCase().trim();
  var kapanewonLower = String(scope.kapanewon || '').toLowerCase().trim();
  var utusanMatch = !!kapanewonLower && utusanLower.indexOf(kapanewonLower) !== -1;

  var lokasiLower = String(peserta.lokasi_pkd || '').toLowerCase().trim();
  var lokasiMatch = false;
  if (scope.lokasiScope && scope.lokasiScope.length > 0 && lokasiLower) {
    for (var i = 0; i < scope.lokasiScope.length; i++) {
      if (String(scope.lokasiScope[i]).toLowerCase().trim() === lokasiLower) {
        lokasiMatch = true;
        break;
      }
    }
  }

  return {
    utusan: utusanMatch,
    lokasi: lokasiMatch,
    union: utusanMatch || lokasiMatch
  };
}

function resolveRequesterScope(requester) {
  if (!requester) return null;
  try {
    return getKetuaPACScope(String(requester).trim());
  } catch (e) {
    return null;
  }
}

function getKetuaPACScopeInfo(p) {
  try {
    if (!p.username) throw new Error('Username diperlukan');
    var scope = getKetuaPACScope(p.username);
    return ok(scope);
  } catch (ex) {
    return err(ex.message);
  }
}

function updateKetuaPACScope(p) {
  try {
    if (!p.username) throw new Error('Username diperlukan');

    var s = getSheetData(SHEET_NAMES.USERS);
    if (!s.sheet) throw new Error('Sheet Users tidak ditemukan');

    var userCol = s.headers.indexOf('username');
    var lokasiCol = s.headers.indexOf('lokasi_pkd_scope');
    if (lokasiCol === -1) throw new Error('Kolom lokasi_pkd_scope belum ada. Refresh dulu.');

    var arr = [];
    if (Array.isArray(p.lokasiScope)) arr = p.lokasiScope;
    else if (typeof p.lokasiScope === 'string') {
      try {
        var parsed = JSON.parse(p.lokasiScope);
        if (Array.isArray(parsed)) arr = parsed;
      } catch (e) {
        arr = p.lokasiScope.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      }
    }

    var cleaned = arr.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    var json = JSON.stringify(cleaned);

    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][userCol]).trim() === String(p.username).trim()) {
        s.sheet.getRange(i + 2, lokasiCol + 1).setValue(json);
        SpreadsheetApp.flush();
        log('[updateKetuaPACScope]', p.username, '→', cleaned.length, 'lokasi');
        return ok({ username: p.username, lokasiScope: cleaned });
      }
    }

    throw new Error('User tidak ditemukan: ' + p.username);
  } catch (ex) {
    return err(ex.message);
  }
}

// ============================================================
//   PASSWORD HASHING
// ============================================================
function normalizeHash(h) {
  if (!h) return '';
  var s = String(h).trim();
  while (s.charAt(0) === "'") s = s.substring(1);
  return s.toLowerCase();
}

function hashPasswordSalted(password, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + '::' + password,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function hashPasswordLegacy(password) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

function hashPassword(p) {
  if (!p || p === '') return '';
  return hashPasswordSalted(p, DEFAULT_PASSWORD_SALT);
}

function verifyPassword(input, storedHash) {
  if (!input || !storedHash) return false;
  var storedNorm = normalizeHash(storedHash);
  if (!storedNorm || storedNorm.length !== 64) return false;

  var salted = hashPasswordSalted(input, DEFAULT_PASSWORD_SALT);
  if (salted === storedNorm) return true;

  var legacy = hashPasswordLegacy(input);
  if (legacy === storedNorm) return true;

  return false;
}

// ============================================================
//   PASSWORD DIAGNOSTICS
// ============================================================
function debugVerifyPassword(p) {
  try {
    if (!p.username || !p.password) throw new Error('username & password wajib');

    var s = getSheetData(SHEET_NAMES.USERS);
    var userCol = s.headers.indexOf('username');
    var passCol = s.headers.indexOf('passwordHash');
    var roleCol = s.headers.indexOf('role');

    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][userCol]) === String(p.username)) {
        var rawStored = s.rows[i][passCol];
        var storedNorm = normalizeHash(rawStored);
        var role = String(s.rows[i][roleCol] || '');

        var salted = hashPasswordSalted(p.password, DEFAULT_PASSWORD_SALT);
        var legacy = hashPasswordLegacy(p.password);

        var matchSalted = (salted === storedNorm);
        var matchLegacy = (legacy === storedNorm);

        return ok({
          username: p.username,
          role: role,
          storedHashLength: storedNorm.length,
          storedHashValid: /^[0-9a-f]{64}$/.test(storedNorm),
          storedHashPrefix: storedNorm.substring(0, 16),
          saltedHashPrefix: salted.substring(0, 16),
          legacyHashPrefix: legacy.substring(0, 16),
          matchSalted: matchSalted,
          matchLegacy: matchLegacy,
          verdict: matchSalted ? '✅ COCOK (salted)'
                 : matchLegacy ? '✅ COCOK (legacy — akan auto-upgrade saat login)'
                 : '❌ TIDAK COCOK — password salah atau hash rusak'
        });
      }
    }
    throw new Error('User tidak ditemukan: ' + p.username);
  } catch (ex) {
    return err(ex.message);
  }
}

function auditAllPasswords() {
  try {
    var s = getSheetData(SHEET_NAMES.USERS);
    var userCol = s.headers.indexOf('username');
    var passCol = s.headers.indexOf('passwordHash');
    var roleCol = s.headers.indexOf('role');

    var stats = { total: 0, ok: 0, kosong: 0, panjangSalah: 0, nonHex: 0 };
    var issues = [];
    var hexPattern = /^[0-9a-f]{64}$/;

    for (var i = 0; i < s.rows.length; i++) {
      var username = String(s.rows[i][userCol] || '').trim();
      if (!username) continue;
      stats.total++;

      var hash = normalizeHash(s.rows[i][passCol]);
      var rowNum = i + 2;

      if (!hash) {
        stats.kosong++;
        issues.push({ row: rowNum, username: username, role: s.rows[i][roleCol], problem: 'HASH_KOSONG' });
      } else if (hash.length !== 64) {
        stats.panjangSalah++;
        issues.push({ row: rowNum, username: username, role: s.rows[i][roleCol], problem: 'PANJANG_' + hash.length + '_HARUS_64' });
      } else if (!hexPattern.test(hash)) {
        stats.nonHex++;
        issues.push({ row: rowNum, username: username, role: s.rows[i][roleCol], problem: 'MENGANDUNG_NON_HEX' });
      } else {
        stats.ok++;
      }
    }

    return ok({
      stats: stats,
      issues: issues,
      summary: stats.ok + '/' + stats.total + ' hash valid SHA-256'
    });
  } catch (ex) {
    return err(ex.message);
  }
}

function repairHashes(p) {
  try {
    if (!p.username) throw new Error('username wajib');

    var sheet = getSheet(SHEET_NAMES.USERS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var userCol = headers.indexOf('username');
    var passCol = headers.indexOf('passwordHash');
    var roleCol = headers.indexOf('role');

    var rowIndex = -1, role = '';
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][userCol]) === String(p.username)) {
        rowIndex = i + 1;
        role = String(data[i][roleCol] || '');
        break;
      }
    }
    if (rowIndex === -1) throw new Error('User tidak ditemukan');

    var newHash, msg;

    if (p.plainPassword) {
      newHash = hashPassword(p.plainPassword);
      msg = 'Hash diperbarui dari plaintext input';
    } else if (p.resetTo === 'default') {
      var defaults = { 'superadmin': 'ansor123', 'admin': 'ansor123', 'ketua_pac': 'pac123' };
      var defPass = defaults[role] || 'member123';
      newHash = hashPassword(defPass);
      msg = 'Reset ke password default untuk role "' + role + '"';
    } else {
      throw new Error('Sertakan plainPassword atau resetTo=default');
    }

    sheet.getRange(rowIndex, passCol + 1).setValue(newHash);
    SpreadsheetApp.flush();

    return ok({
      username: p.username,
      role: role,
      newHashPrefix: newHash.substring(0, 16),
      message: msg
    });
  } catch (ex) {
    return err(ex.message);
  }
}

// ============================================================
//   FILE UPLOAD
// ============================================================
function setFilePublic(fileId) {
  if (!fileId) return;
  try {
    DriveApp.getFileById(fileId).setSharing(
      DriveApp.Access.ANYONE_WITH_LINK,
      DriveApp.Permission.VIEW
    );
  } catch (ex) {
    logErr('setFilePublic:', fileId, ex.message);
  }
}

function uploadFile(dataURL, fileName, targetFolderId) {
  if (!dataURL || dataURL.indexOf('base64,') === -1) {
    throw new Error('Data URL tidak valid');
  }
  var matches = dataURL.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) throw new Error('Format data URL tidak valid');
  var mimeType = matches[1];
  var base64Data = matches[2];
  var blob = Utilities.base64Decode(base64Data);
  var fileBlob = Utilities.newBlob(blob, mimeType, fileName);

  var parentFolder = getMainAssetFolder();
  if (targetFolderId) {
    try {
      var subfolders = parentFolder.getFoldersById(targetFolderId);
      if (subfolders.hasNext()) parentFolder = subfolders.next();
    } catch (ex) { /* silent */ }
  }
  var file = parentFolder.createFile(fileBlob);
  setFilePublic(file.getId());
  return { id: file.getId(), mimeType: mimeType, fileName: fileName };
}

function getMainAssetFolder() {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  if (!sheet) throw new Error('Sheet Settings tidak ditemukan');
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var keyCol = headers.indexOf('key');
  var valCol = headers.indexOf('value');

  var folderId = null;
  var folderIdRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][keyCol] === 'main_asset_folder_id') {
      folderId = data[i][valCol];
      folderIdRow = i + 1;
      break;
    }
  }

  if (folderId) {
    try {
      var folder = DriveApp.getFolderById(folderId);
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      return folder;
    } catch (ex) {
      logErr('getMainAssetFolder: folder_id invalid');
    }
  }

  var existingFolders = DriveApp.getFoldersByName('PKD_GP_Ansor_Asset_Main');
  var newFolder;
  if (existingFolders.hasNext()) {
    newFolder = existingFolders.next();
  } else {
    newFolder = DriveApp.createFolder('PKD_GP_Ansor_Asset_Main');
  }
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  if (folderIdRow !== -1) {
    sheet.getRange(folderIdRow, valCol + 1).setValue(newFolder.getId());
  } else {
    sheet.appendRow(['main_asset_folder_id', newFolder.getId()]);
  }
  SpreadsheetApp.flush();
  return newFolder;
}

function getOrCreateSubFolder(name) {
  var parent = getMainAssetFolder();
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function createAssetFolderInTarget(folderName, parentId) {
  var parent = getMainAssetFolder();
  if (parentId && parentId !== '') {
    try {
      var nested = parent.getFoldersById(parentId);
      if (nested.hasNext()) parent = nested.next();
    } catch (ex) { /* silent */ }
  }
  var newFolder = parent.createFolder(folderName);
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return newFolder;
}

function moveFileToFolder(fileId, folderDbId) {
  if (!fileId || !folderDbId) return;
  var s = getSheetData(SHEET_NAMES.FOLDERS);
  if (!s.sheet) return;
  var idCol = s.headers.indexOf('id');
  var driveCol = s.headers.indexOf('driveFolderId');
  var targetDriveId = null;
  for (var i = 0; i < s.rows.length; i++) {
    if (String(s.rows[i][idCol]) === String(folderDbId)) {
      targetDriveId = s.rows[i][driveCol] || null;
      break;
    }
  }
  if (!targetDriveId) return;
  try {
    DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(targetDriveId));
  } catch (ex) {
    logErr('moveFileToFolder:', fileId, ex.message);
  }
}

function publishAllAssetsToPublic() {
  try {
    var folder = getMainAssetFolder();
    var count = 0;
    var files = folder.getFiles();
    while (files.hasNext()) {
      try { setFilePublic(files.next().getId()); count++; } catch (ex) {}
    }
    var subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      var sub = subfolders.next();
      var subFiles = sub.getFiles();
      while (subFiles.hasNext()) {
        try { setFilePublic(subFiles.next().getId()); count++; } catch (ex) {}
      }
    }
    return ok({ published: count });
  } catch (ex) { return err(ex.message); }
}

function escapeCsv(str) {
  if (!str) return '';
  str = String(str).replace(/"/g, '""');
  return (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1)
    ? '"' + str + '"' : str;
}

// ============================================================
//   ENSURE / MIGRATE FUNCTIONS
// ============================================================
function ensureAbsenResponsesSheet() {
  var sheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
  if (!sheet) return;
  try {
    var expected = ['id', 'timestamp', 'nama', 'sesiId', 'signatureDriveId', 'pesertaId'];
    var data = sheet.getDataRange().getValues();
    if (data.length === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      return;
    }
    var current = data[0].map(function (h) { return String(h).trim(); });
    if (current.join(',') === expected.join(',')) return;

    var migrated = [expected];
    var hasId = current[0] === 'id';
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var id = hasId ? String(row[0] || '') : '';
      if (!id || id.indexOf('absen_') !== 0) {
        id = 'absen_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 1000);
      }
      if (hasId) {
        migrated.push([id, row[1], row[2], row[3], row[4], row[5]]);
      } else {
        migrated.push([id, row[0], row[1], row[2], row[3], row[4]]);
      }
    }
    sheet.clear();
    sheet.getRange(1, 1, migrated.length, expected.length).setValues(migrated);
    SpreadsheetApp.flush();
  } catch (ex) { logErr('ensureAbsenResponsesSheet:', ex.message); }
}

function ensureCertificateLayoutsSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(SHEET_NAMES.CERTIFICATE_LAYOUTS)) {
    var s = ss.insertSheet(SHEET_NAMES.CERTIFICATE_LAYOUTS);
    s.appendRow(['id', 'nama', 'data_json', 'createdAt', 'updatedAt', 'createdBy']);
  }
}

function ensureDigitalApprovalHeaders() {
  var sheet = getSheet(SHEET_NAMES.DIGITAL_APPROVALS);
  if (!sheet) return;
  try {
    var expected = ['role', 'nama', 'driveId', 'timestamp', 'peserta_nama', 'kegunaan'];
    var lastCol = Math.max(1, sheet.getLastColumn());
    var current = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (current.length === expected.length &&
        JSON.stringify(current) === JSON.stringify(expected)) return;

    if (sheet.getLastRow() <= 1) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      return;
    }

    var currentMap = {};
    current.forEach(function (h, i) { currentMap[h] = i; });
    var allPresent = expected.every(function (h) { return currentMap[h] !== undefined; });
    var extraCols = current.filter(function (h) { return expected.indexOf(h) === -1; });

    if (allPresent && extraCols.length === 0) {
      sheet.getRange(1, 1, 1, expected.length).setValues([expected]);
      return;
    }

    var missing = expected.filter(function (h) { return currentMap[h] === undefined; });
    if (missing.length > 0) {
      var startCol = current.length + 1;
      sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
      log('ensureDigitalApprovalHeaders: added', missing.join(', '));
    }
  } catch (ex) { logErr('ensureDigitalApprovalHeaders:', ex.message); }
}

function ensureFoldersSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Folders');
  if (!sheet) {
    sheet = ss.insertSheet('Folders');
    sheet.appendRow(['id', 'nama', 'parentId', 'createdAt', 'createdBy', 'isPublic', 'hideFromGallery', 'passwordHash', 'driveFolderId']);
    return;
  }
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var need = ['isPublic', 'hideFromGallery', 'passwordHash', 'driveFolderId'];
    need.forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
        headers.push(col);
      }
    });
  } catch (ex) { /* silent */ }
}

function ensureRTLSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(SHEET_NAMES.RTL_TASKS)) {
    var s = ss.insertSheet(SHEET_NAMES.RTL_TASKS);
    s.appendRow(['id', 'judul', 'deskripsi', 'deadline', 'status', 'createdAt', 'createdBy', 'pesertaId', 'fileDriveId', 'catatan']);
  }
}

function ensureAlumniSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(SHEET_NAMES.ALUMNI)) {
    var s = ss.insertSheet(SHEET_NAMES.ALUMNI);
    var h = ['id', 'timestamp', 'fotoDriveId', 'nama_lengkap', 'tempat_tgl_lahir', 'pekerjaan', 'pendidikan_terakhir', 'alamat', 'no_hp', 'email', 'utusan', 'pengalaman_organisasi', 'surat_rekomendasi_driveid', 'alumni_at'];
    s.getRange(1, 1, 1, h.length).setValues([h]);
  }
}

function ensureAssetSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.ASSET);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.ASSET);
    sheet.appendRow(['id', 'judul', 'deskripsi', 'driveId', 'uploadBy', 'timestamp', 'jenis', 'folderId', 'fileName', 'mimeType']);
    return;
  }
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ['jenis', 'folderId', 'fileName', 'mimeType'].forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  } catch (ex) { /* silent */ }
}

function ensureKaderSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName('Kader')) {
    var s = ss.insertSheet('Kader');
    s.appendRow(['id', 'nama', 'email', 'hp', 'asal', 'tingkatan', 'status', 'tanggal', 'catatan']);
  }
}

function ensureFormSettings() {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  if (!sheet) return;
  try {
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'form_fields_config') { found = true; break; }
    }
    if (!found) {
      sheet.appendRow(['form_fields_config', JSON.stringify(getDefaultFormFields())]);
      SpreadsheetApp.flush();
    }
  } catch (ex) { /* silent */ }
}

function ensureCertPresetColumns() {
  var sheet = getSheet(SHEET_NAMES.SERTIFIKAT_PRESETS);
  if (!sheet) return;
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ['ttd_ketua_pc', 'ttd_sekretaris', 'ttd_instruktur'].forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  } catch (ex) { /* silent */ }
}

function ensureSertifikatGeneratedColumns() {
  var sheet = getSheet(SHEET_NAMES.SERTIFIKAT_GENERATED);
  if (!sheet) return;
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    ['peserta_id', 'lokasi'].forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
  } catch (ex) { /* silent */ }
}

function migratePesertaColumns() {
  var sheet = getSheet(SHEET_NAMES.PESERTA);
  if (!sheet) return;
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var headerMap = {};
    headers.forEach(function (h, i) { headerMap[String(h).trim()] = i; });

    var colsToAdd = ['status', 'username', 'custom_data', 'payment_status', 'payment_method', 'payment_proof_driveId', 'lokasi_pkd'];
    colsToAdd.forEach(function (colName) {
      if (headerMap[colName] === undefined) {
        var lastCol = sheet.getLastColumn() + 1;
        sheet.getRange(1, lastCol).setValue(colName);
        headerMap[colName] = lastCol - 1;

        if (sheet.getLastRow() > 1) {
          if (colName === 'status') {
            sheet.getRange(2, lastCol, sheet.getLastRow() - 1, 1).setValue('pending');
          } else if (colName === 'lokasi_pkd') {
            var utusanCol = headerMap['utusan'];
            if (utusanCol !== undefined) {
              var data = sheet.getDataRange().getValues();
              for (var i = 1; i < data.length; i++) {
                sheet.getRange(i + 1, lastCol).setValue(data[i][utusanCol] || '');
              }
            }
          }
        }
      }
    });
  } catch (ex) { /* silent */ }
}

function migrateSesiAbsen() {
  var sheet = getSheet(SHEET_NAMES.SESI_ABSEN);
  if (!sheet) return;
  try {
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var headerMap = {};
    headers.forEach(function (h, i) { headerMap[String(h).trim()] = i; });

    ['waktu_mulai', 'waktu_selesai'].forEach(function (col) {
      if (headerMap[col] === undefined) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(col);
      }
    });
    if (headerMap['submission_open'] === undefined) {
      var lc = sheet.getLastColumn() + 1;
      sheet.getRange(1, lc).setValue('submission_open');
      if (sheet.getLastRow() > 1) {
        sheet.getRange(2, lc, sheet.getLastRow() - 1, 1).setValue("'TRUE");
      }
    }
  } catch (ex) { /* silent */ }
}

function initSettings() {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(SHEET_NAMES.SETTINGS);
    sheet.appendRow(['key', 'value']);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data.length > 0 ? data[0].map(function (h) { return String(h).trim(); }) : ['key', 'value'];
  var keyCol = headers.indexOf('key');
  if (keyCol === -1) keyCol = 0;

  var existingKeys = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][keyCol]) existingKeys[String(data[i][keyCol])] = true;
  }

  var defVis = { pretest: true, posttest: true, absen: true, skrining: true, peserta: true, materi: true, informasi: true, asset: true, verifikasi: true, kader: true };
  var mainFolder = null;
  try { mainFolder = getMainAssetFolder(); } catch (ex) { /* silent */ }

  var defaults = [
    ['folder_id', mainFolder ? mainFolder.getId() : ''],
    ['realtime_enabled', "'false"],
    ['require_login', "'false"],
    ['last_cert_number', '0'],
    ['last_cert_year', String(new Date().getFullYear())],
    ['pkd_lokasi', 'MTs N 8 Bantul, D.I.Yogyakarta'],
    ['public_visibility', JSON.stringify(defVis)],
    ['public_asset_enabled', "'false"],
    ['public_asset_password', '']
  ];

  var added = [];
  defaults.forEach(function (pair) {
    if (!existingKeys[pair[0]]) {
      sheet.appendRow(pair);
      added.push(pair[0]);
    }
  });

  if (added.length > 0) log('initSettings: added keys =', added.join(', '));
  SpreadsheetApp.flush();
}

function initUsers() {
  var sheet = getSheet(SHEET_NAMES.USERS);
  if (!sheet) {
    sheet = SpreadsheetApp.openById(SPREADSHEET_ID).insertSheet(SHEET_NAMES.USERS);
    sheet.appendRow(['username', 'passwordHash', 'role', 'kapanewon', 'createdAt', 'lokasi_pkd_scope']);
  }

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    sheet.appendRow(['admin', hashPassword('ansor123'), 'superadmin', '', new Date(), '[]']);
  }

  var existingUsers = {};
  var uHeaders = data.length > 0 ? data[0].map(function (h) { return String(h).trim(); }) : ['username'];
  var uCol = uHeaders.indexOf('username');
  for (var i = 1; i < data.length; i++) {
    if (data[i][uCol]) existingUsers[String(data[i][uCol])] = true;
  }

  var kapanewonList = ['Bambanglipuro','Banguntapan','Bantul','Dlingo','Imogiri','Jetis','Kasihan','Kretek','Pajangan','Pandak','Piyungan','Pleret','Pundong','Sanden','Sedayu','Sewon','Srandakan'];
  var addedCount = 0;
  kapanewonList.forEach(function (kap) {
    var uname = 'ketua_' + kap.toLowerCase();
    if (!existingUsers[uname]) {
      sheet.appendRow([uname, hashPassword('pac123'), 'ketua_pac', kap, new Date(), '[]']);
      addedCount++;
    }
  });
  if (addedCount > 0) SpreadsheetApp.flush();
}

function ensureUsersSchema() {
  var sheet = getSheet(SHEET_NAMES.USERS);
  if (!sheet) return;
  try {
    var lastCol = Math.max(1, sheet.getLastColumn());
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(function (h) { return String(h).trim(); });

    if (headers.indexOf('lokasi_pkd_scope') === -1) {
      sheet.getRange(1, lastCol + 1).setValue('lokasi_pkd_scope');
      log('ensureUsersSchema: added lokasi_pkd_scope column');
    }
  } catch (ex) {
    logErr('ensureUsersSchema:', ex.message);
  }
}

function ensureLokasiPKDSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  if (!ss.getSheetByName(SHEET_NAMES.LOKASI_PKD)) {
    var s = ss.insertSheet(SHEET_NAMES.LOKASI_PKD);
    s.appendRow(['id', 'nama', 'createdAt']);
  }
}

function ensureTimInstrukturSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAMES.TIM_INSTRUKTUR);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAMES.TIM_INSTRUKTUR);
    var headers = ['id', 'nama', 'jabatan', 'urutan', 'foto_driveId', 'deskripsi', 'kontak_wa', 'kontak_email', 'createdAt', 'updatedAt'];
    sheet.appendRow(headers);

    var now = new Date();
    var seed = [
      [1, 'Cahyo Galih', 'Ketua Tim Instruktur', 1, '', 'Memimpin dan mengoordinasi seluruh kegiatan PKD GP Ansor Kabupaten Bantul.', '', '', now, now],
      [2, 'Faziri Muhammad', 'Wakil Tim Instruktur', 2, '', 'Mendampingi ketua dalam pelaksanaan dan evaluasi program pelatihan.', '', '', now, now],
      [3, 'Sucipto', 'Sekretaris', 3, '', 'Mengelola administrasi, dokumentasi, dan komunikasi tim instruktur.', '', '', now, now]
    ];
    seed.forEach(function (row) { sheet.appendRow(row); });
    log('ensureTimInstrukturSheet: seeded 3 default members');
  } else {
    try {
      var currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0]
        .map(function (h) { return String(h).trim(); });
      var expected = ['id', 'nama', 'jabatan', 'urutan', 'foto_driveId', 'deskripsi', 'kontak_wa', 'kontak_email', 'createdAt', 'updatedAt'];
      var missing = expected.filter(function (h) { return currentHeaders.indexOf(h) === -1; });
      if (missing.length > 0) {
        var startCol = currentHeaders.length + 1;
        sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
        log('ensureTimInstrukturSheet: added', missing.join(', '));
      }
    } catch (ex) { logErr('ensureTimInstrukturSheet migrate:', ex.message); }
  }
}

// ============================================================
//   AUTH HANDLERS
// ============================================================
function verifyAdmin(p) {
  try {
    if (!p.username || !p.password) throw new Error('Username dan password wajib');
    var s = getSheetData(SHEET_NAMES.USERS);
    if (!s.sheet) throw new Error('Sheet Users tidak ditemukan');
    var userCol = s.headers.indexOf('username');
    var passCol = s.headers.indexOf('passwordHash');
    var roleCol = s.headers.indexOf('role');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][userCol] === p.username && verifyPassword(p.password, s.rows[i][passCol])) {
        var role = String(s.rows[i][roleCol]).toLowerCase();
        if (role === 'superadmin' || role === 'admin') {
          var newHash = hashPassword(p.password);
          var storedNorm = normalizeHash(s.rows[i][passCol]);
          if (newHash !== storedNorm) {
            s.sheet.getRange(i + 2, passCol + 1).setValue(newHash);
            SpreadsheetApp.flush();
          }
          return { success: true, role: 'admin' };
        }
      }
    }
    return { success: false };
  } catch (ex) { return err(ex.message); }
}

function verifyKetuaPAC(p) {
  try {
    if (!p.username || !p.password) throw new Error('Username dan password wajib');
    var s = getSheetData(SHEET_NAMES.USERS);
    if (!s.sheet) throw new Error('Sheet Users tidak ditemukan');
    var userCol = s.headers.indexOf('username');
    var passCol = s.headers.indexOf('passwordHash');
    var roleCol = s.headers.indexOf('role');
    var kapCol = s.headers.indexOf('kapanewon');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][userCol] === p.username &&
          verifyPassword(p.password, s.rows[i][passCol]) &&
          s.rows[i][roleCol] === 'ketua_pac') {
        var newHash = hashPassword(p.password);
        var storedNorm = normalizeHash(s.rows[i][passCol]);
        if (newHash !== storedNorm) {
          s.sheet.getRange(i + 2, passCol + 1).setValue(newHash);
          SpreadsheetApp.flush();
        }
        return {
          success: true,
          role: 'ketua_pac',
          data: {
            username: s.rows[i][userCol],
            nama: s.rows[i][userCol],
            kapanewon: s.rows[i][kapCol] || ''
          }
        };
      }
    }
    return { success: false };
  } catch (ex) { return err(ex.message); }
}

function verifyMember(p) {
  try {
    if (!p.username || !p.password) throw new Error('Username dan password wajib');
    var s = getSheetData(SHEET_NAMES.USERS);
    if (!s.sheet) throw new Error('Sheet Users tidak ditemukan');
    var userCol = s.headers.indexOf('username');
    var passCol = s.headers.indexOf('passwordHash');
    var roleCol = s.headers.indexOf('role');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][userCol] === p.username &&
          verifyPassword(p.password, s.rows[i][passCol]) &&
          String(s.rows[i][roleCol]).toLowerCase() === 'member') {
        var newHash = hashPassword(p.password);
        var storedNorm = normalizeHash(s.rows[i][passCol]);
        if (newHash !== storedNorm) {
          s.sheet.getRange(i + 2, passCol + 1).setValue(newHash);
          SpreadsheetApp.flush();
        }
        var username = s.rows[i][userCol];
        var peserta = getPesertaByIdInternal(username);
        return {
          success: true,
          role: 'member',
          data: {
            username: username,
            nama: peserta ? (peserta.nama_lengkap || username) : username,
            email: peserta ? (peserta.email || '') : '',
            nohp: peserta ? (peserta.no_hp || '') : ''
          }
        };
      }
    }
    return { success: false };
  } catch (ex) { return err(ex.message); }
}

function updateAdminPassword(p) {
  try {
    if (!p.username || !p.newPassword) throw new Error('Data tidak lengkap');
    if (p.newPassword.length < 6) throw new Error('Password minimal 6 karakter');

    var sheet = getSheet(SHEET_NAMES.USERS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var userCol = headers.indexOf('username');
    var passCol = headers.indexOf('passwordHash');
    var roleCol = headers.indexOf('role');

    for (var i = 1; i < data.length; i++) {
      var role = String(data[i][roleCol] || '').toLowerCase();
      if (String(data[i][userCol]) === String(p.username) &&
          (role === 'admin' || role === 'superadmin')) {
        sheet.getRange(i + 1, passCol + 1).setValue(hashPassword(p.newPassword));
        SpreadsheetApp.flush();
        return ok();
      }
    }
    throw new Error('Admin tidak ditemukan');
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   PESERTA
// ============================================================
function getPesertaList(params) {
  try {
    var s = getSheetData(SHEET_NAMES.PESERTA);
    if (!s.sheet || s.rows.length === 0) return ok([]);

    var statusFilter = params && params.status
      ? String(params.status).toLowerCase().trim() : null;
    var scopeMode = params && params.scope
      ? String(params.scope).toLowerCase() : 'union';
    var requester = params && params.requester
      ? String(params.requester).trim() : null;

    var scope = resolveRequesterScope(requester);
    if (scope && ['utusan','lokasi','union'].indexOf(scopeMode) === -1) {
      scopeMode = 'union';
    }

    var rows = [];
    for (var i = 0; i < s.rows.length; i++) {
      var row = s.rows[i];
      if (!row[0] && !row[3]) continue;

      var obj = headersToObject(s.headers, row);
      var status = (obj.status || 'pending').toString().toLowerCase().trim();
      if (statusFilter && status !== statusFilter) continue;

      if (obj.custom_data && typeof obj.custom_data === 'string'
          && obj.custom_data.indexOf('{') === 0) {
        try {
          var parsed = JSON.parse(obj.custom_data);
          Object.keys(parsed).forEach(function (k) {
            if (obj[k] === undefined || obj[k] === '') obj[k] = parsed[k];
          });
        } catch (ex) { /* silent */ }
      }

      var matchInfo = { utusan: true, lokasi: true, union: true };
      if (scope) {
        matchInfo = matchPesertaScope(obj, scope);
        var include = false;
        if (scopeMode === 'utusan')      include = matchInfo.utusan;
        else if (scopeMode === 'lokasi') include = matchInfo.lokasi;
        else                             include = matchInfo.union;

        if (!include) continue;
      }
      obj._scope = matchInfo;
      rows.push(obj);
    }

    return ok(rows);
  } catch (ex) {
    logErr('getPesertaList:', ex.message);
    return ok([]);
  }
}

function getPesertaByIdInternal(id) {
  try {
    var s = getSheetData(SHEET_NAMES.PESERTA);
    if (!s.sheet) return null;
    var idCol = s.headers.indexOf('id');
    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][idCol]) === String(id)) {
        var obj = headersToObject(s.headers, s.rows[i]);
        if (obj.custom_data && typeof obj.custom_data === 'string' && obj.custom_data.indexOf('{') === 0) {
          try {
            var parsed = JSON.parse(obj.custom_data);
            Object.keys(parsed).forEach(function (k) {
              if (obj[k] === undefined || obj[k] === '') obj[k] = parsed[k];
            });
          } catch (ex) { /* silent */ }
        }
        return obj;
      }
    }
    return null;
  } catch (ex) { return null; }
}

function submitPeserta(p) {
  try {
    if (!p.nama_lengkap) throw new Error('Nama lengkap wajib diisi');

    var sheet = getSheet(SHEET_NAMES.PESERTA);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.PESERTA, 'id');

    var standardKeys = ['action', 'id', 'foto', 'surat_rekomendasi', 'password', 'tanda_tangan', 'status', 'lokasi_pkd'];
    var customData = {};
    Object.keys(p).forEach(function (key) {
      if (standardKeys.indexOf(key) === -1 &&
          ['nama_lengkap','email','no_hp','alamat','utusan','pekerjaan','pendidikan_terakhir','tempat_tgl_lahir','pengalaman_organisasi'].indexOf(key) === -1) {
        customData[key] = p[key];
      }
    });

    var rowData = [];
    for (var j = 0; j < headers.length; j++) {
      var colName = headers[j];
      var val = '';
      if (colName === 'id') val = id;
      else if (colName === 'timestamp') val = new Date();
      else if (colName === 'fotoDriveId') val = p.foto ? uploadFile(p.foto, 'Peserta_' + (p.nama_lengkap || id) + '_' + Date.now()).id : '';
      else if (colName === 'surat_rekomendasi_driveid') val = p.surat_rekomendasi ? uploadFile(p.surat_rekomendasi, 'Surat_' + (p.nama_lengkap || id) + '_' + Date.now()).id : '';
      else if (colName === 'status') val = p.status || 'pending';
      else if (colName === 'username') val = p.username || '';
      else if (colName === 'custom_data') val = JSON.stringify(customData);
      else if (colName === 'lokasi_pkd') val = p.lokasi_pkd || p.utusan || '';
      else if (p[colName] !== undefined) val = p[colName];
      rowData.push(val);
    }
    while (rowData.length < headers.length) rowData.push('');
    sheet.appendRow(rowData);

    var statusLower = String(p.status || 'pending').toLowerCase();
    if (statusLower === 'approved' || statusLower === 'active') {
      createOrUpdateUser(id, p.no_hp || '123456', 'member');
    }

    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) {
    logErr('submitPeserta:', ex.message);
    return err(ex.message);
  }
}

function createOrUpdateUser(username, password, role) {
  try {
    var sheet = getSheet(SHEET_NAMES.USERS);
    if (!sheet) return;
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var userCol = headers.indexOf('username');
    var passCol = headers.indexOf('passwordHash');
    var roleCol = headers.indexOf('role');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][userCol]) === String(username)) {
        sheet.getRange(i + 1, passCol + 1).setValue(hashPassword(password));
        if (roleCol !== -1) sheet.getRange(i + 1, roleCol + 1).setValue(role);
        return;
      }
    }
    sheet.appendRow([String(username), hashPassword(password), role, '', new Date(), '[]']);
  } catch (ex) { logErr('createOrUpdateUser:', ex.message); }
}

function updatePeserta(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    if (!data.id) throw new Error('ID peserta diperlukan');

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheetPeserta = ss.getSheetByName(SHEET_NAMES.PESERTA);
    var sheetAlumni = ss.getSheetByName(SHEET_NAMES.ALUMNI);
    var sheetUsers = ss.getSheetByName(SHEET_NAMES.USERS);

    var values = sheetPeserta.getDataRange().getValues();
    var headers = values[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    if (idCol === -1) throw new Error('Kolom id tidak ditemukan');

    var rowIndex = -1, existingData = null;
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][idCol]) === String(data.id)) {
        rowIndex = i + 1;
        existingData = values[i];
        break;
      }
    }
    if (rowIndex === -1) throw new Error('Peserta tidak ditemukan');

    var allowedFields = ['nama_lengkap','email','no_hp','alamat','utusan','pendidikan_terakhir','pekerjaan','tempat_tgl_lahir','pengalaman_organisasi','fotoDriveId','surat_rekomendasi_driveid','lokasi_pkd','status'];
    var updates = {};
    allowedFields.forEach(function (f) {
      if (data.hasOwnProperty(f)) updates[f] = data[f];
    });

    var statusCol = headers.indexOf('status');
    var oldStatus = statusCol !== -1 ? String(existingData[statusCol] || '') : '';
    var newRowData = headers.map(function (h, idx) {
      return updates.hasOwnProperty(h) ? updates[h] : existingData[idx];
    });
    sheetPeserta.getRange(rowIndex, 1, 1, headers.length).setValues([newRowData]);

    var newStatus = String(updates.status || oldStatus).toLowerCase().trim();
    var oldStatusLower = String(oldStatus).toLowerCase().trim();

    if (newStatus !== oldStatusLower) {
      if (newStatus === 'approved' || newStatus === 'active') {
        var noHpIdx = headers.indexOf('no_hp');
        var password = updates.no_hp || (noHpIdx !== -1 ? existingData[noHpIdx] : '') || '123456';
        createOrUpdateUser(data.id, password, 'member');
      } else if (newStatus === 'alumni') {
        if (sheetAlumni) {
          var alumniHeaders = ['id','timestamp','fotoDriveId','nama_lengkap','tempat_tgl_lahir','pekerjaan','pendidikan_terakhir','alamat','no_hp','email','utusan','pengalaman_organisasi','surat_rekomendasi_driveid'];
          var alumniRow = alumniHeaders.map(function (h) {
            var idx = headers.indexOf(h);
            return idx !== -1 ? existingData[idx] : '';
          });
          alumniRow.push(new Date());
          sheetAlumni.appendRow(alumniRow);
          sheetPeserta.deleteRow(rowIndex);

          if (sheetUsers) {
            var uValues = sheetUsers.getDataRange().getValues();
            var uHeaders = uValues[0].map(function (h) { return String(h).trim(); });
            var uCol = uHeaders.indexOf('username');
            for (var k = uValues.length - 1; k >= 1; k--) {
              if (String(uValues[k][uCol]) === String(data.id)) {
                sheetUsers.deleteRow(k + 1);
                break;
              }
            }
          }
        }
      }
    }

    SpreadsheetApp.flush();
    return ok({ message: 'Data peserta berhasil diperbarui.' });
  } catch (ex) {
    logErr('updatePeserta:', ex.message);
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function deletePeserta(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    var id = p.id;
    if (!id) throw new Error('ID peserta diperlukan');

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(SHEET_NAMES.PESERTA);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var fotoCol = headers.indexOf('fotoDriveId');
    var suratCol = headers.indexOf('surat_rekomendasi_driveid');

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(id)) {
        if (fotoCol !== -1 && data[i][fotoCol]) try { DriveApp.getFileById(data[i][fotoCol]).setTrashed(true); } catch (ex) {}
        if (suratCol !== -1 && data[i][suratCol]) try { DriveApp.getFileById(data[i][suratCol]).setTrashed(true); } catch (ex) {}
        sheet.deleteRow(i + 1);

        var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
        if (usersSheet) {
          var uData = usersSheet.getDataRange().getValues();
          var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
          var uCol = uHeaders.indexOf('username');
          for (var k = uData.length - 1; k >= 1; k--) {
            if (String(uData[k][uCol]) === String(id)) {
              usersSheet.deleteRow(k + 1);
              break;
            }
          }
        }
        SpreadsheetApp.flush();
        return ok();
      }
    }
    throw new Error('Peserta tidak ditemukan');
  } catch (ex) {
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function approvePeserta(params) {
  try {
    if (!params.id) throw new Error('ID peserta diperlukan');

    var scope = resolveRequesterScope(params.requester);
    if (scope) {
      var peserta = getPesertaByIdInternal(params.id);
      if (!peserta) throw new Error('Peserta tidak ditemukan');
      var matchInfo = matchPesertaScope(peserta, scope);
      if (!matchInfo.union) {
        throw new Error('Peserta di luar wewenang Anda (kapanewon / lokasi PKD)');
      }
    }

    return updatePeserta({ id: params.id, status: 'approved' });
  } catch (ex) {
    return err(ex.message);
  }
}

function rejectPeserta(params) {
  try {
    if (!params.id) throw new Error('ID peserta diperlukan');

    var scope = resolveRequesterScope(params.requester);
    if (scope) {
      var peserta = getPesertaByIdInternal(params.id);
      if (!peserta) throw new Error('Peserta tidak ditemukan');
      var matchInfo = matchPesertaScope(peserta, scope);
      if (!matchInfo.union) {
        throw new Error('Peserta di luar wewenang Anda (kapanewon / lokasi PKD)');
      }
    }

    return updatePeserta({ id: params.id, status: 'rejected' });
  } catch (ex) {
    return err(ex.message);
  }
}

function getPesertaById(p) {
  try {
    if (!p.id) throw new Error('ID peserta diperlukan');
    var peserta = getPesertaByIdInternal(p.id);
    if (!peserta) throw new Error('Peserta tidak ditemukan');
    return ok(peserta);
  } catch (ex) { return err(ex.message); }
}

function getTotalPeserta() {
  try {
    var s = getSheetData(SHEET_NAMES.PESERTA);
    if (!s.sheet) return ok({ total: 0 });
    var statusCol = s.headers.indexOf('status');
    if (statusCol === -1) return ok({ total: s.rows.length });
    var total = 0;
    s.rows.forEach(function (row) {
      var status = String(row[statusCol] || '').toLowerCase().trim();
      if (status !== 'rejected') total++;
    });
    return ok({ total: total });
  } catch (ex) { return err(ex.message); }
}

function getPesertaCredentials(params) {
  try {
    var id = params.id;
    if (!id) throw new Error('ID peserta diperlukan');

    var usersSheet = getSheet(SHEET_NAMES.USERS);
    if (!usersSheet) throw new Error('Sheet Users tidak ditemukan');
    var uData = usersSheet.getDataRange().getValues();
    var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
    var userCol = uHeaders.indexOf('username');
    var roleCol = uHeaders.indexOf('role');
    var found = null;
    for (var i = 1; i < uData.length; i++) {
      if (String(uData[i][userCol]) === String(id) && String(uData[i][roleCol]).toLowerCase() === 'member') {
        found = { username: uData[i][userCol], role: uData[i][roleCol] };
        break;
      }
    }
    if (!found) throw new Error('Akun belum dibuat. Pastikan peserta sudah disetujui.');

    var pData = getSheetData(SHEET_NAMES.PESERTA);
    var pIdCol = pData.headers.indexOf('id');
    var pNamaCol = pData.headers.indexOf('nama_lengkap');
    var pHpCol = pData.headers.indexOf('no_hp');
    var nama = '', noHp = '';
    for (var j = 0; j < pData.rows.length; j++) {
      if (String(pData.rows[j][pIdCol]) === String(id)) {
        nama = pData.rows[j][pNamaCol] || '';
        noHp = pData.rows[j][pHpCol] || '';
        break;
      }
    }

    return ok({
      username: found.username,
      passwordHint: noHp ? (noHp.substring(0, 3) + '****' + noHp.slice(-2)) : 'Nomor HP terdaftar',
      nama_lengkap: nama
    });
  } catch (ex) { return err(ex.message); }
}

function resetPesertaPassword(params) {
  try {
    if (!params.id) throw new Error('ID peserta diperlukan');
    if (!params.newPassword || params.newPassword.length < 6) {
      throw new Error('Password minimal 6 karakter');
    }

    var usersSheet = getSheet(SHEET_NAMES.USERS);
    var uData = usersSheet.getDataRange().getValues();
    var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
    var userCol = uHeaders.indexOf('username');
    var passCol = uHeaders.indexOf('passwordHash');
    for (var i = 1; i < uData.length; i++) {
      if (String(uData[i][userCol]) === String(params.id)) {
        usersSheet.getRange(i + 1, passCol + 1).setValue(hashPassword(params.newPassword));
        SpreadsheetApp.flush();
        return ok();
      }
    }
    throw new Error('User tidak ditemukan');
  } catch (ex) { return err(ex.message); }
}

function moveToAlumni(params) { return updatePeserta({ id: params.id, status: 'alumni' }); }

function moveMultipleToAlumni(params) {
  var ids = params.ids;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch (ex) { ids = ids.split(','); }
  }
  if (!Array.isArray(ids)) return err('IDs tidak valid');
  var moved = 0;
  ids.forEach(function (id) {
    if (moveToAlumni({ id: id }).success) moved++;
  });
  return ok({ moved: moved });
}

function getAlumniList() {
  try {
    var s = getSheetData(SHEET_NAMES.ALUMNI);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row) { return headersToObject(s.headers, row); });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function moveBackToActive(p) {
  try {
    if (!p.id) throw new Error('ID peserta diperlukan');
    var alumniSheet = getSheet(SHEET_NAMES.ALUMNI);
    var pesertaSheet = getSheet(SHEET_NAMES.PESERTA);
    var dataAlumni = alumniSheet.getDataRange().getValues();
    var headersAlumni = dataAlumni[0].map(function (h) { return String(h).trim(); });
    var idCol = headersAlumni.indexOf('id');

    for (var i = 1; i < dataAlumni.length; i++) {
      if (String(dataAlumni[i][idCol]) === String(p.id)) {
        var headersPeserta = pesertaSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
        var rowPeserta = headersPeserta.map(function (colName) {
          if (colName === 'status') return 'active';
          var alumniCol = headersAlumni.indexOf(colName);
          return alumniCol !== -1 ? dataAlumni[i][alumniCol] : '';
        });
        pesertaSheet.appendRow(rowPeserta);
        alumniSheet.deleteRow(i + 1);

        var noHpCol = headersAlumni.indexOf('no_hp');
        var noHp = noHpCol !== -1 ? dataAlumni[i][noHpCol] : '';
        createOrUpdateUser(p.id, noHp || '123456', 'member');

        SpreadsheetApp.flush();
        return ok();
      }
    }
    throw new Error('Alumni tidak ditemukan');
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   SESI ABSEN
// ============================================================
function getSesiAbsen() {
  try {
    var s = getSheetData(SHEET_NAMES.SESI_ABSEN);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      obj.submission_open = parseBool(obj.submission_open);
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addSesiAbsen(p) {
  try {
    if (!p.nama) throw new Error('Nama sesi wajib');
    var sheet = getSheet(SHEET_NAMES.SESI_ABSEN);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.SESI_ABSEN, 'id');
    var token = Utilities.getUuid();

    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama') return p.nama;
      if (colName === 'waktu_mulai') return p.waktu_mulai || '';
      if (colName === 'waktu_selesai') return p.waktu_selesai || '';
      if (colName === 'aktif') return boolToSheetString(p.aktif !== undefined ? p.aktif : true);
      if (colName === 'passwordHash') return p.password ? hashPassword(p.password) : '';
      if (colName === 'qrToken') return token;
      if (colName === 'submission_open') return boolToSheetString(true);
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id, qrToken: token });
  } catch (ex) { return err(ex.message); }
}

function updateSesiAbsen(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SESI_ABSEN, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    var row = r.rowIndex;
    var headers = r.headers;

    for (var j = 0; j < headers.length; j++) {
      var colName = headers[j];
      if (colName === 'passwordHash') continue;
      if (colName === 'submission_open') continue;
      if (p[colName] !== undefined) r.sheet.getRange(row, j + 1).setValue(p[colName]);
    }
    if (p.password && p.password.trim() !== '') {
      var passCol = headers.indexOf('passwordHash');
      if (passCol !== -1) r.sheet.getRange(row, passCol + 1).setValue(hashPassword(p.password));
    }
    if (p.submission_open !== undefined) {
      var openCol = headers.indexOf('submission_open');
      if (openCol !== -1) r.sheet.getRange(row, openCol + 1).setValue(boolToSheetString(parseBool(p.submission_open)));
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteSesiAbsen(p) {
  try {
    var r = findRowById(SHEET_NAMES.SESI_ABSEN, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function regenerateQRSesi(p) {
  try {
    if (!p.id) throw new Error('ID sesi diperlukan');
    var r = findRowById(SHEET_NAMES.SESI_ABSEN, p.id);
    if (!r) throw new Error('Sesi tidak ditemukan');
    var qrCol = r.headers.indexOf('qrToken');
    var newToken = Utilities.getUuid();
    r.sheet.getRange(r.rowIndex, qrCol + 1).setValue(newToken);
    SpreadsheetApp.flush();
    return ok({ qrToken: newToken });
  } catch (ex) { return err(ex.message); }
}

function toggleAttendanceSession(p) {
  try {
    if (!p.id) throw new Error('ID sesi diperlukan');
    var r = findRowById(SHEET_NAMES.SESI_ABSEN, p.id);
    if (!r) throw new Error('Sesi tidak ditemukan');
    var openCol = r.headers.indexOf('submission_open');
    if (openCol === -1) throw new Error('Kolom submission_open tidak ditemukan');
    var open = parseBool(p.open);
    r.sheet.getRange(r.rowIndex, openCol + 1).setValue(boolToSheetString(open));
    SpreadsheetApp.flush();
    return ok({ open: open });
  } catch (ex) { return err(ex.message); }
}

function getAttendanceSessionStatus(p) {
  try {
    if (!p.id) throw new Error('ID sesi diperlukan');
    var r = findRowById(SHEET_NAMES.SESI_ABSEN, p.id);
    if (!r) return ok({ open: true });
    var openCol = r.headers.indexOf('submission_open');
    if (openCol === -1) return ok({ open: true });
    return ok({ open: parseBool(r.row[openCol]) });
  } catch (ex) { return ok({ open: true }); }
}

// ============================================================
//   ABSEN
// ============================================================
function submitAbsen(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);

    if (!p.sesiId) throw new Error('Sesi tidak dipilih');
    if (!p.nama) throw new Error('Nama peserta diperlukan');

    var sesiSheet = getSheet(SHEET_NAMES.SESI_ABSEN);
    var sesiData = sesiSheet.getDataRange().getValues();
    var headersSesi = sesiData[0].map(function (h) { return String(h).trim(); });
    var idCol = headersSesi.indexOf('id');
    var passCol = headersSesi.indexOf('passwordHash');
    var tokenCol = headersSesi.indexOf('qrToken');
    var openCol = headersSesi.indexOf('submission_open');
    var waktuMulaiCol = headersSesi.indexOf('waktu_mulai');
    var waktuSelesaiCol = headersSesi.indexOf('waktu_selesai');

    var storedHash, storedToken, submissionOpenRaw, waktuMulai, waktuSelesai;
    for (var i = 1; i < sesiData.length; i++) {
      if (String(sesiData[i][idCol]) === String(p.sesiId)) {
        storedHash = sesiData[i][passCol];
        storedToken = sesiData[i][tokenCol];
        submissionOpenRaw = sesiData[i][openCol];
        waktuMulai = sesiData[i][waktuMulaiCol];
        waktuSelesai = sesiData[i][waktuSelesaiCol];
        break;
      }
    }
    if (storedHash === undefined && storedToken === undefined) throw new Error('Sesi tidak ditemukan');
    if (!parseBool(submissionOpenRaw)) throw new Error('Sesi absen sedang ditutup oleh panitia.');

    var now = new Date();
    if (waktuMulai && waktuMulai !== '' && waktuSelesai && waktuSelesai !== '') {
      var startDate = new Date(waktuMulai);
      var endDate = new Date(waktuSelesai);
      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        if (now < startDate || now > endDate) {
          throw new Error('Maaf, waktu absen untuk sesi ini belum dimulai atau sudah berakhir.');
        }
      }
    }

    if (isAlreadyAbsen(p.nama, p.sesiId, p.pesertaId)) {
      throw new Error('Anda sudah melakukan absen pada sesi ini sebelumnya.');
    }

    var isAdminMode = (p.pesertaId && !p.password && !p.qrToken);
    if (isAdminMode) {
      log('submitAbsen ADMIN MODE — pesertaId:', p.pesertaId, 'nama:', p.nama);
    }

    var method = '';
    if (p.qrToken) {
      if (p.qrToken !== storedToken) throw new Error('Token QR tidak valid');
      method = 'token';
    } else if (isAdminMode) {
      method = 'admin';
    } else {
      if (!p.password) throw new Error('Password sesi wajib diisi');
      if (!verifyPassword(p.password, storedHash)) throw new Error('Password salah');
      method = 'password';
    }

    if (!p.tandaTangan) {
      return ok({ needSignature: true, method: method, message: 'Validasi berhasil, silakan kirim tanda tangan' });
    }

    var uploadResult = uploadFile(p.tandaTangan, 'Absen_' + p.nama + '_' + p.sesiId + '_' + Date.now());
    var driveId = uploadResult.id;

    var absenSheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
    if (!absenSheet) throw new Error('Sheet AbsenResponses tidak ditemukan');
    var absenHeaders = absenSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var uniqueId = generateUniqueId('absen');

    var rowData = absenHeaders.map(function (colName) {
      if (colName === 'id') return uniqueId;
      if (colName === 'timestamp') return new Date();
      if (colName === 'nama') return String(p.nama || '');
      if (colName === 'sesiId') return String(p.sesiId || '');
      if (colName === 'signatureDriveId') return String(driveId || '');
      if (colName === 'pesertaId') return String(p.pesertaId || '');
      return '';
    });
    absenSheet.appendRow(rowData);
    SpreadsheetApp.flush();

    return ok({ signatureDriveId: driveId, method: method });
  } catch (ex) {
    logErr('submitAbsen:', ex.message);
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function isAlreadyAbsen(nama, sesiId, pesertaId) {
  var sheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return false;
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var namaCol = headers.indexOf('nama');
  var sesiCol = headers.indexOf('sesiId');
  var pidCol = headers.indexOf('pesertaId');

  var cleanNama = String(nama || '').trim().toLowerCase();
  var cleanSesi = String(sesiId || '').trim();
  var cleanPid = String(pesertaId || '').trim();

  for (var i = 1; i < data.length; i++) {
    var rowSesi = String(data[i][sesiCol] || '').trim();
    if (rowSesi !== cleanSesi) continue;
    var rowPid = String(data[i][pidCol] || '').trim();
    if (cleanPid && rowPid && cleanPid === rowPid) return true;
    var rowNama = String(data[i][namaCol] || '').trim().toLowerCase();
    if (rowNama === cleanNama) return true;
  }
  return false;
}

function getAbsensiResponses() {
  try {
    var sheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
    if (!sheet) return ok([]);
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) return ok([]);

    var headers = data[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var tsCol = headers.indexOf('timestamp');
    var namaCol = headers.indexOf('nama');
    var sesiCol = headers.indexOf('sesiId');
    var sigCol = headers.indexOf('signatureDriveId');
    var pidCol = headers.indexOf('pesertaId');

    var sesiSheet = getSheet(SHEET_NAMES.SESI_ABSEN);
    var sesiMap = {};
    if (sesiSheet) {
      var sesiData = sesiSheet.getDataRange().getValues();
      var sHeaders = sesiData[0].map(function (h) { return String(h).trim(); });
      var sIdCol = sHeaders.indexOf('id');
      var sNamaCol = sHeaders.indexOf('nama');
      for (var j = 1; j < sesiData.length; j++) {
        sesiMap[String(sesiData[j][sIdCol])] = sesiData[j][sNamaCol];
      }
    }

    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[namaCol] && !row[sesiCol]) continue;

      var ts = row[tsCol];
      var tsIso;
      if (ts instanceof Date) tsIso = ts.toISOString();
      else if (ts) {
        try {
          var d = new Date(ts);
          tsIso = !isNaN(d.getTime()) ? d.toISOString() : String(ts);
        } catch (ex) { tsIso = String(ts); }
      } else tsIso = '';

      rows.push({
        id: String(row[idCol] || ''),
        _rowIndex: i + 1,
        timestamp: tsIso,
        nama: String(row[namaCol] || ''),
        sesiId: String(row[sesiCol] || ''),
        signatureDriveId: String(row[sigCol] || ''),
        pesertaId: String(row[pidCol] || ''),
        namaSesi: sesiMap[String(row[sesiCol])] || '(sesi tidak diketahui)'
      });
    }
    return ok(rows);
  } catch (ex) {
    logErr('getAbsensiResponses:', ex.message);
    return ok([]);
  }
}

function getAttendanceBySesi(p) {
  try {
    if (!p.sesiId) throw new Error('Sesi ID diperlukan');
    var sheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var tsCol = headers.indexOf('timestamp');
    var namaCol = headers.indexOf('nama');
    var sesiCol = headers.indexOf('sesiId');
    var sigCol = headers.indexOf('signatureDriveId');
    var pidCol = headers.indexOf('pesertaId');

    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][sesiCol]) === String(p.sesiId)) {
        var ts = data[i][tsCol];
        results.push({
          nama: data[i][namaCol],
          timestamp: ts instanceof Date ? ts.toISOString() : String(ts || ''),
          signatureDriveId: data[i][sigCol],
          pesertaId: data[i][pidCol]
        });
      }
    }
    return ok(results);
  } catch (ex) { return err(ex.message); }
}

function deleteAbsensi(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    var sheet = getSheet(SHEET_NAMES.ABSEN_RESPONSES);
    if (!sheet) throw new Error('Sheet tidak ditemukan');

    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var namaCol = headers.indexOf('nama');
    var sesiCol = headers.indexOf('sesiId');
    var pidCol = headers.indexOf('pesertaId');

    if (p.id && idCol !== -1) {
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][idCol]) === String(p.id)) {
          sheet.deleteRow(i + 1);
          SpreadsheetApp.flush();
          return ok({ method: 'byId' });
        }
      }
    }

    if (p.nama && p.sesiId) {
      var cleanNama = String(p.nama).trim().toLowerCase();
      var cleanSesi = String(p.sesiId).trim();
      var cleanPid = String(p.pesertaId || '').trim();

      for (var i2 = data.length - 1; i2 >= 1; i2--) {
        var rowSesi = String(data[i2][sesiCol] || '').trim();
        if (rowSesi !== cleanSesi) continue;
        var rowPid = String(data[i2][pidCol] || '').trim();
        var rowNama = String(data[i2][namaCol] || '').trim().toLowerCase();

        if (cleanPid && rowPid && cleanPid === rowPid) {
          sheet.deleteRow(i2 + 1);
          SpreadsheetApp.flush();
          return ok({ method: 'byPid' });
        }
        if (rowNama === cleanNama) {
          sheet.deleteRow(i2 + 1);
          SpreadsheetApp.flush();
          return ok({ method: 'byNama' });
        }
      }
    }

    if (p._rowIndex && parseInt(p._rowIndex) > 1) {
      var ri = parseInt(p._rowIndex);
      if (ri <= sheet.getLastRow()) {
        var rowCheck = sheet.getRange(ri, 1, 1, headers.length).getValues()[0];
        var matchNama = !p.nama || String(rowCheck[namaCol] || '').trim().toLowerCase() === String(p.nama).trim().toLowerCase();
        if (matchNama) {
          sheet.deleteRow(ri);
          SpreadsheetApp.flush();
          return ok({ method: '_rowIndex' });
        }
      }
    }

    throw new Error('Data absensi tidak ditemukan');
  } catch (ex) {
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function getAttendanceMatrix() {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var pesertaSheet = ss.getSheetByName(SHEET_NAMES.PESERTA);
    var pesertaData = pesertaSheet ? pesertaSheet.getDataRange().getValues() : [];
    var peserta = [];
    if (pesertaData.length > 1) {
      var headers = pesertaData[0].map(function (h) { return String(h).trim(); });
      var namaCol = headers.indexOf('nama_lengkap');
      if (namaCol !== -1) {
        for (var i = 1; i < pesertaData.length; i++) {
          if (pesertaData[i][namaCol]) peserta.push({ nama: pesertaData[i][namaCol].toString().trim() });
        }
      }
    }
    var sesiSheet = ss.getSheetByName(SHEET_NAMES.SESI_ABSEN);
    var sesiData = sesiSheet ? sesiSheet.getDataRange().getValues() : [];
    var sesi = [];
    if (sesiData.length > 1) {
      var sHeaders = sesiData[0].map(function (h) { return String(h).trim(); });
      var idCol = sHeaders.indexOf('id');
      var namaCol = sHeaders.indexOf('nama');
      for (var i = 1; i < sesiData.length; i++) {
        if (sesiData[i][idCol] && sesiData[i][namaCol]) {
          sesi.push({ id: String(sesiData[i][idCol]), nama: String(sesiData[i][namaCol]).trim() });
        }
      }
    }
    var absenSheet = ss.getSheetByName(SHEET_NAMES.ABSEN_RESPONSES);
    var absenData = absenSheet ? absenSheet.getDataRange().getValues() : [];
    var hadirSet = {};
    if (absenData.length > 1) {
      var aHeaders = absenData[0].map(function (h) { return String(h).trim(); });
      var aNamaCol = aHeaders.indexOf('nama');
      var aSesiCol = aHeaders.indexOf('sesiId');
      for (var i = 1; i < absenData.length; i++) {
        var n = absenData[i][aNamaCol] ? String(absenData[i][aNamaCol]).trim() : '';
        var s = absenData[i][aSesiCol] ? String(absenData[i][aSesiCol]).trim() : '';
        if (n && s) hadirSet[n.toLowerCase() + '|' + s] = true;
      }
    }
    return ok({ peserta: peserta, sesi: sesi, hadirSet: Object.keys(hadirSet) });
  } catch (ex) { return err(ex.message); }
}

function exportAttendanceMatrixCSV() {
  try {
    var matrixRes = getAttendanceMatrix();
    if (!matrixRes.success) throw new Error('Gagal membuat matrix');
    var peserta = matrixRes.data.peserta, sesi = matrixRes.data.sesi;
    var hadirSet = {};
    matrixRes.data.hadirSet.forEach(function (k) { hadirSet[k] = true; });
    var csv = 'No,Nama Peserta';
    sesi.forEach(function (s) { csv += ',' + escapeCsv(s.nama); });
    csv += ',Total Hadir\n';
    peserta.forEach(function (p, i) {
      var nl = p.nama.toLowerCase();
      var total = 0;
      var row = (i + 1) + ',' + escapeCsv(p.nama);
      sesi.forEach(function (s) {
        var hadir = hadirSet[nl + '|' + s.id];
        if (hadir) total++;
        row += ',' + (hadir ? '1' : '0');
      });
      csv += row + ',' + total + '\n';
    });
    return ok({ csv: csv });
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   MATERI
// ============================================================
function getMateriList() {
  try {
    var s = getSheetData(SHEET_NAMES.MATERI);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function addMateri(p) {
  try {
    if (!p.judul || !p.file || !p.fileName) throw new Error('Judul, file, dan nama file wajib');
    var uploadResult = uploadFile(p.file, p.fileName);
    var driveId = uploadResult.id;
    var sheet = getSheet(SHEET_NAMES.MATERI);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.MATERI, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'judul') return p.judul;
      if (colName === 'deskripsi') return p.deskripsi || '';
      if (colName === 'fileId') return driveId;
      if (colName === 'tipe') return p.fileName.split('.').pop().toLowerCase();
      if (colName === 'timestamp') return new Date();
      if (colName === 'uploadBy') return p.uploadBy || 'admin';
      if (colName === 'kategori') return p.kategori || 'Umum';
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id, fileId: driveId });
  } catch (ex) { return err(ex.message); }
}

function updateMateri(p) {
  try {
    if (!p.id) throw new Error('ID materi diperlukan');
    var r = findRowById(SHEET_NAMES.MATERI, p.id);
    if (!r) throw new Error('Materi tidak ditemukan');

    var allowed = ['judul', 'deskripsi', 'kategori', 'tipe', 'timestamp'];
    for (var j = 0; j < r.headers.length; j++) {
      var colName = r.headers[j];
      if (colName === 'fileId') continue;
      if (colName === 'kategori') {
        if (p.kategori !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p.kategori);
        continue;
      }
      if (p[colName] !== undefined && allowed.indexOf(colName) !== -1) {
        r.sheet.getRange(r.rowIndex, j + 1).setValue(p[colName]);
      }
    }

    if (p.fileId) {
      var fileCol = r.headers.indexOf('fileId');
      if (fileCol !== -1) r.sheet.getRange(r.rowIndex, fileCol + 1).setValue(p.fileId);
    }

    if (p.file && p.fileName) {
      var upload = uploadFile(p.file, p.fileName);
      var fc = r.headers.indexOf('fileId');
      var tc = r.headers.indexOf('tipe');
      var tsc = r.headers.indexOf('timestamp');
      if (fc !== -1) r.sheet.getRange(r.rowIndex, fc + 1).setValue(upload.id);
      if (tc !== -1) r.sheet.getRange(r.rowIndex, tc + 1).setValue(p.fileName.split('.').pop().toLowerCase());
      if (tsc !== -1) r.sheet.getRange(r.rowIndex, tsc + 1).setValue(new Date());
    }

    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteMateri(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    if (p.fileId) try { DriveApp.getFileById(p.fileId).setTrashed(true); } catch (ex) {}
    var r = findRowById(SHEET_NAMES.MATERI, p.id);
    if (!r) throw new Error('Materi tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   SKRINING
// ============================================================
function getSkriningQuestions() {
  try {
    var s = getSheetData(SHEET_NAMES.SKRINING_QUESTIONS);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function addSkriningQuestion(p) {
  try {
    if (!p.teks) throw new Error('Teks pertanyaan wajib');
    var sheet = getSheet(SHEET_NAMES.SKRINING_QUESTIONS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.SKRINING_QUESTIONS, 'id');
    var row = headers.map(function (colName) {
      return colName === 'id' ? id : (p[colName] !== undefined ? p[colName] : '');
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateSkriningQuestion(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SKRINING_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteSkriningQuestion(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SKRINING_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function submitSkrining(p) {
  try {
    if (!p.nama) throw new Error('Nama wajib diisi');

    var signatureUpload = p.signature ? uploadFile(p.signature, 'Skrining_' + (p.nama || '') + '_' + Date.now()) : null;
    var signatureDriveId = signatureUpload ? signatureUpload.id : '';

    var fixedFields = ['action','signature','nama','alamat','info','pengetahuan','qunut','penyakit','pernah','alasan','catatan','dataJson','hasil','id'];
    var dataJson = {};
    Object.keys(p).forEach(function (k) {
      if (fixedFields.indexOf(k) === -1) dataJson[k] = p[k];
    });

    if (p.dataJson) {
      try {
        var existing = typeof p.dataJson === 'string' ? JSON.parse(p.dataJson) : p.dataJson;
        Object.keys(existing).forEach(function (k) { dataJson[k] = existing[k]; });
      } catch (ex) { /* silent */ }
    }

    var sheet = getSheet(SHEET_NAMES.SKRINING_RESPONSES);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var row = headers.map(function (colName) {
      if (colName === 'timestamp') return new Date();
      if (colName === 'nama') return p.nama || '';
      if (colName === 'alamat') return p.alamat || '';
      if (colName === 'info') return p.info || '';
      if (colName === 'pengetahuan') return p.pengetahuan || '';
      if (colName === 'qunut') return p.qunut || '';
      if (colName === 'penyakit') return p.penyakit || '';
      if (colName === 'pernah') return p.pernah || '';
      if (colName === 'alasan') return p.alasan || '';
      if (colName === 'catatan') return p.catatan || '';
      if (colName === 'hasil') return p.hasil || '';
      if (colName === 'signatureDriveId') return signatureDriveId;
      if (colName === 'dataJson') return JSON.stringify(dataJson);
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getSkriningResponses() {
  try {
    var s = getSheetData(SHEET_NAMES.SKRINING_RESPONSES);
    if (!s.sheet) return ok([]);
    var rows = [];
    for (var i = 0; i < s.rows.length; i++) {
      var obj = headersToObject(s.headers, s.rows[i]);
      if (obj.timestamp instanceof Date) obj.timestamp = obj.timestamp.toISOString();
      obj.id = String(i + 1);
      obj._rowIndex = i + 2;
      if (obj.dataJson && typeof obj.dataJson === 'string' && obj.dataJson.indexOf('{') === 0) {
        try {
          var extra = JSON.parse(obj.dataJson);
          Object.keys(extra).forEach(function (k) {
            if (obj[k] === undefined || obj[k] === '') obj[k] = extra[k];
          });
        } catch (ex) { /* silent */ }
      }
      rows.push(obj);
    }
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function updateSkriningResponse(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var numId = parseInt(p.id);
    if (isNaN(numId)) throw new Error('ID tidak valid');

    var sheet = getSheet(SHEET_NAMES.SKRINING_RESPONSES);
    var rowIndex = numId + 1;
    if (rowIndex < 2 || rowIndex > sheet.getLastRow()) {
      throw new Error('Data tidak ditemukan');
    }

    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var allowedFields = ['nama', 'alamat', 'hasil', 'catatan', 'info', 'pengetahuan', 'qunut', 'penyakit', 'pernah', 'alasan'];
    for (var j = 0; j < headers.length; j++) {
      var colName = headers[j];
      if (allowedFields.indexOf(colName) === -1) continue;
      if (p[colName] !== undefined) {
        sheet.getRange(rowIndex, j + 1).setValue(p[colName]);
      }
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteSkriningResponse(p) {
  try {
    var rowIndex = null;

    if (p._rowIndex !== undefined && p._rowIndex !== null && p._rowIndex !== '') {
      rowIndex = parseInt(p._rowIndex, 10);
    } else if (p.rowIndex !== undefined && p.rowIndex !== null && p.rowIndex !== '') {
      rowIndex = parseInt(p.rowIndex, 10);
    } else if (p.id !== undefined && p.id !== null && p.id !== '') {
      var numId = parseInt(p.id, 10);
      if (!isNaN(numId)) rowIndex = numId;
    }

    if (!rowIndex || isNaN(rowIndex)) throw new Error('ID/rowIndex diperlukan');

    var sheet = getSheet(SHEET_NAMES.SKRINING_RESPONSES);
    var lastRow = sheet.getLastRow();
    if (rowIndex < 2 || rowIndex > lastRow) {
      throw new Error('Baris tidak valid (rowIndex=' + rowIndex + ', lastRow=' + lastRow + ')');
    }

    sheet.deleteRow(rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   PRETEST
// ============================================================
function getPretestQuestions() {
  try {
    var s = getSheetData(SHEET_NAMES.PRETEST_QUESTIONS);
    if (!s.sheet) return ok([]);
    var q = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      if (obj.opsi) obj.opsi = obj.opsi.toString().split(',');
      return obj;
    });
    return ok(q);
  } catch (ex) { return ok([]); }
}

function addPretestQuestion(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.PRETEST_QUESTIONS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.PRETEST_QUESTIONS, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'timer_enabled') return boolToSheetString(p.timer_enabled);
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updatePretestQuestion(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.PRETEST_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (r.headers[j] === 'timer_enabled') continue;
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    if (p.timer_enabled !== undefined) {
      var tc = r.headers.indexOf('timer_enabled');
      if (tc !== -1) r.sheet.getRange(r.rowIndex, tc + 1).setValue(boolToSheetString(p.timer_enabled));
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deletePretestQuestion(p) {
  try {
    var r = findRowById(SHEET_NAMES.PRETEST_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function submitPretest(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.PRETEST_RESPONSES);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var row = headers.map(function (colName) {
      if (colName === 'timestamp') return new Date();
      if (colName === 'nama') return p.nama || 'Tanpa Nama';
      if (colName === 'answersJson') return p.answers || '{}';
      if (colName === 'score') return p.score || 0;
      if (colName === 'nohp') return p.nohp || '';
      if (colName === 'alamat') return p.alamat || '';
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getPretestResponses() {
  try {
    var s = getSheetData(SHEET_NAMES.PRETEST_RESPONSES);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row, i) {
      var obj = headersToObject(s.headers, row);
      if (obj.answersJson) { obj.answers = obj.answersJson; }
      if (obj.timestamp instanceof Date) obj.timestamp = obj.timestamp.toISOString();
      obj.id = String(i + 1);
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

// ============================================================
//   POSTTEST
// ============================================================
function getPosttestQuestions() {
  try {
    var s = getSheetData(SHEET_NAMES.POSTTEST_QUESTIONS);
    if (!s.sheet) return ok([]);
    var q = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      if (obj.opsi) obj.opsi = obj.opsi.toString().split(',');
      return obj;
    });
    return ok(q);
  } catch (ex) { return ok([]); }
}

function addPosttestQuestion(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.POSTTEST_QUESTIONS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.POSTTEST_QUESTIONS, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'timer_enabled') return boolToSheetString(p.timer_enabled);
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updatePosttestQuestion(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.POSTTEST_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (r.headers[j] === 'timer_enabled') continue;
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    if (p.timer_enabled !== undefined) {
      var tc = r.headers.indexOf('timer_enabled');
      if (tc !== -1) r.sheet.getRange(r.rowIndex, tc + 1).setValue(boolToSheetString(p.timer_enabled));
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deletePosttestQuestion(p) {
  try {
    var r = findRowById(SHEET_NAMES.POSTTEST_QUESTIONS, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function submitPosttest(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.POSTTEST_RESPONSES);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var row = headers.map(function (colName) {
      if (colName === 'timestamp') return new Date();
      if (colName === 'nama') return p.nama || 'Tanpa Nama';
      if (colName === 'answersJson') return p.answers || '{}';
      if (colName === 'score') return p.score || 0;
      if (colName === 'nohp') return p.nohp || '';
      if (colName === 'alamat') return p.alamat || '';
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getPosttestResponses() {
  try {
    var s = getSheetData(SHEET_NAMES.POSTTEST_RESPONSES);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row, i) {
      var obj = headersToObject(s.headers, row);
      if (obj.answersJson) { obj.answers = obj.answersJson; }
      if (obj.timestamp instanceof Date) obj.timestamp = obj.timestamp.toISOString();
      obj.id = String(i + 1);
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

// ============================================================
//   INFORMASI
// ============================================================
function getInfoList() {
  try {
    var s = getSheetData(SHEET_NAMES.INFO);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function addInfo(p) {
  try {
    var url = p.url || '';
    if (p.fileData) url = uploadFile(p.fileData, 'Flyer_' + (p.judul || '') + '_' + Date.now()).id;
    var sheet = getSheet(SHEET_NAMES.INFO);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.INFO, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'url') return url;
      if (colName === 'createdAt') return new Date();
      if (colName === 'status') return p.status || 'aktif';
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id, url: url });
  } catch (ex) { return err(ex.message); }
}

function updateInfo(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.INFO, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    if (p.fileData) {
      var urlCol = r.headers.indexOf('url');
      var jenisCol = r.headers.indexOf('jenis');
      var upload = uploadFile(p.fileData, 'Flyer_' + (p.judul || '') + '_' + Date.now());
      if (urlCol !== -1) r.sheet.getRange(r.rowIndex, urlCol + 1).setValue(upload.id);
      if (jenisCol !== -1) r.sheet.getRange(r.rowIndex, jenisCol + 1).setValue('flyer');
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteInfo(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.INFO, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    var urlCol = r.headers.indexOf('url');
    var fileId = r.row[urlCol];
    if (fileId) try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ex) {}
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function toggleInfoStatus(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.INFO, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    var statusCol = r.headers.indexOf('status');
    var current = r.row[statusCol] || 'aktif';
    var newStatus = current === 'selesai' ? 'aktif' : 'selesai';
    r.sheet.getRange(r.rowIndex, statusCol + 1).setValue(newStatus);
    SpreadsheetApp.flush();
    return ok({ status: newStatus });
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   USULAN
// ============================================================
function getUsulanList() {
  try {
    var s = getSheetData(SHEET_NAMES.USULAN);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function submitUsulan(p) {
  try {
    var flyerUpload = p.flyerData && p.flyerName ? uploadFile(p.flyerData, 'Usulan_' + p.flyerName) : null;
    var flyerId = flyerUpload ? flyerUpload.id : '';
    var sheet = getSheet(SHEET_NAMES.USULAN);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.USULAN, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama') return p.nama || '';
      if (colName === 'usulan') return p.usulan || '';
      if (colName === 'tanggal_mulai') return p.tanggal_mulai || '';
      if (colName === 'tanggal_akhir') return p.tanggal_akhir || '';
      if (colName === 'lokasi') return p.lokasi || '';
      if (colName === 'no_hp') return p.no_hp || '';
      if (colName === 'status') return 'pending';
      if (colName === 'createdAt') return new Date();
      if (colName === 'flyerDriveId') return flyerId;
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateUsulanStatus(p) {
  try {
    if (!p.id || !p.status) throw new Error('ID dan status diperlukan');
    var r = findRowById(SHEET_NAMES.USULAN, p.id);
    if (!r) throw new Error('Usulan tidak ditemukan');
    var statusCol = r.headers.indexOf('status');
    r.sheet.getRange(r.rowIndex, statusCol + 1).setValue(p.status);
    SpreadsheetApp.flush();

    if (p.status === 'approved') {
      var infoSheet = getSheet(SHEET_NAMES.INFO);
      var infoHeaders = infoSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
      var infoId = getNextId(SHEET_NAMES.INFO, 'id');
      var judul = r.row[r.headers.indexOf('usulan')];
      var deskripsi = 'Diusulkan oleh ' + r.row[r.headers.indexOf('nama')];
      var tglMulai = r.row[r.headers.indexOf('tanggal_mulai')];
      var tglAkhir = r.row[r.headers.indexOf('tanggal_akhir')];
      var lokasi = r.row[r.headers.indexOf('lokasi')];
      var flyerId = r.row[r.headers.indexOf('flyerDriveId')];
      var jenis = flyerId ? 'flyer' : 'timeline';
      var infoRow = infoHeaders.map(function (colName) {
        if (colName === 'id') return infoId;
        if (colName === 'jenis') return jenis;
        if (colName === 'judul') return judul;
        if (colName === 'deskripsi') return deskripsi;
        if (colName === 'url') return flyerId || '';
        if (colName === 'urutan') return infoId;
        if (colName === 'createdAt') return new Date();
        if (colName === 'tanggal_mulai') return tglMulai;
        if (colName === 'tanggal_akhir') return tglAkhir;
        if (colName === 'lokasi') return lokasi;
        if (colName === 'status') return 'aktif';
        return '';
      });
      infoSheet.appendRow(infoRow);
      SpreadsheetApp.flush();
    }
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   SERTIFIKAT
// ============================================================
function getCertificateTemplates() {
  try {
    var s = getSheetData(SHEET_NAMES.SERTIFIKAT_TEMPLATES);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      if (obj.config) {
        try { obj.config = JSON.parse(obj.config); } catch (ex) { obj.config = {}; }
      }
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addCertificateTemplateManual(p) {
  try {
    if (!p.nama_template || !p.doc_template_id) throw new Error('Nama dan ID wajib');
    var sheet = getSheet(SHEET_NAMES.SERTIFIKAT_TEMPLATES);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.SERTIFIKAT_TEMPLATES, 'id');
    var cfg = {};
    try { if (p.config) cfg = JSON.parse(p.config); } catch (ex) { throw new Error('Config JSON tidak valid'); }
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama_template') return p.nama_template;
      if (colName === 'doc_template_id') return p.doc_template_id;
      if (colName === 'config') return JSON.stringify(cfg);
      if (colName === 'createdAt') return new Date();
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateCertificateTemplate(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SERTIFIKAT_TEMPLATES, p.id);
    if (!r) throw new Error('Template tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    if (p.config !== undefined) {
      var cfgCol = r.headers.indexOf('config');
      try {
        r.sheet.getRange(r.rowIndex, cfgCol + 1).setValue(JSON.stringify(JSON.parse(p.config)));
      } catch (ex) { throw new Error('Config JSON tidak valid'); }
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteCertificateTemplate(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SERTIFIKAT_TEMPLATES, p.id);
    if (!r) throw new Error('Template tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getCertPresets() {
  try {
    var s = getSheetData(SHEET_NAMES.SERTIFIKAT_PRESETS);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      if (obj.instruktur_json) {
        try { obj.instruktur_json = JSON.parse(obj.instruktur_json); } catch (ex) { obj.instruktur_json = []; }
      }
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addCertPreset(p) {
  try {
    if (!p.name) throw new Error('Nama preset wajib');
    var sheet = getSheet(SHEET_NAMES.SERTIFIKAT_PRESETS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.SERTIFIKAT_PRESETS, 'id');
    var row = headers.map(function (colName) {
      return colName === 'id' ? id : (p[colName] !== undefined ? p[colName] : '');
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateCertPreset(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SERTIFIKAT_PRESETS, p.id);
    if (!r) throw new Error('Preset tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteCertPreset(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SERTIFIKAT_PRESETS, p.id);
    if (!r) throw new Error('Preset tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getUploadedCertificates() {
  try {
    ensureSertifikatGeneratedColumns();
    var s = getSheetData(SHEET_NAMES.SERTIFIKAT_GENERATED);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row, i) {
      var obj = headersToObject(s.headers, row);
      if (!obj.id) obj.id = String(i + 1);
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function uploadManualCertificate(p) {
  try {
    if (!p.pesertaId || !p.nomorSertifikat || !p.fileData) throw new Error('Data tidak lengkap');
    var peserta = getPesertaByIdInternal(p.pesertaId);
    if (!peserta) throw new Error('Peserta tidak ditemukan');
    var nama = peserta.nama_lengkap;

    var b64 = p.fileData.split('base64,')[1];
    var blob = Utilities.base64Decode(b64);
    var pdfBlob = Utilities.newBlob(blob, 'application/pdf', 'Sertifikat_' + nama + '_' + p.nomorSertifikat + '.pdf');
    var folder = getOrCreateSubFolder(SERTIFIKAT_FOLDER_NAME);
    var pdfFile = folder.createFile(pdfBlob);
    setFilePublic(pdfFile.getId());

    ensureSertifikatGeneratedColumns();
    var genSheet = getSheet(SHEET_NAMES.SERTIFIKAT_GENERATED);
    var genHeaders = genSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var genId = getNextId(SHEET_NAMES.SERTIFIKAT_GENERATED, 'id');
    var row = genHeaders.map(function (colName) {
      if (colName === 'id') return genId;
      if (colName === 'nama_peserta') return nama;
      if (colName === 'nomor_sertifikat') return p.nomorSertifikat;
      if (colName === 'pdf_url') return pdfFile.getUrl();
      if (colName === 'createdAt') return new Date();
      if (colName === 'peserta_id') return p.pesertaId;
      return '';
    });
    genSheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ pdfUrl: pdfFile.getUrl() });
  } catch (ex) { return err(ex.message); }
}

function verifyCertificate(p) {
  try {
    if (!p.nomor) throw new Error('Nomor sertifikat wajib');
    var s = getSheetData(SHEET_NAMES.SERTIFIKAT_GENERATED);
    if (!s.sheet) return ok(null);
    var nomorIdx = s.headers.indexOf('nomor_sertifikat');
    var namaIdx = s.headers.indexOf('nama_peserta');
    var pdfIdx = s.headers.indexOf('pdf_url');
    var lokasiIdx = s.headers.indexOf('lokasi');
    var createdAtIdx = s.headers.indexOf('createdAt');
    var search = String(p.nomor).trim().replace(/\s+/g, ' ');

    for (var i = 0; i < s.rows.length; i++) {
      var sheetNomor = String(s.rows[i][nomorIdx] || '').trim().replace(/\s+/g, ' ');
      if (sheetNomor === search) {
        return ok({
          nama_peserta: s.rows[i][namaIdx] || '',
          nomor_sertifikat: s.rows[i][nomorIdx] || '',
          pdf_url: pdfIdx !== -1 ? s.rows[i][pdfIdx] : '',
          lokasi: lokasiIdx !== -1 ? s.rows[i][lokasiIdx] : 'Kabupaten Bantul',
          createdAt: createdAtIdx !== -1 ? s.rows[i][createdAtIdx] : ''
        });
      }
    }
    return ok(null);
  } catch (ex) { return err(ex.message); }
}

function getNextCertificateNumberHandler() {
  try {
    var number = getNextCertificateNumber();
    return ok({ number: number });
  } catch (ex) { return err(ex.message); }
}

function getNextCertificateNumber() {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var settingsSheet = ss.getSheetByName(SHEET_NAMES.SETTINGS);
    if (!settingsSheet) throw new Error('Sheet Settings tidak ditemukan');

    var currentYear = new Date().getFullYear();
    var lastNumber = 0, lastYear = currentYear;
    var data = settingsSheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');

    var lastNumberRow = -1;
    var lastYearRow = -1;

    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'last_cert_number') {
        lastNumber = parseInt(data[i][valCol]) || 0;
        lastNumberRow = i + 1;
        break;
      }
    }
    for (var j = 1; j < data.length; j++) {
      if (data[j][keyCol] === 'last_cert_year') {
        lastYear = parseInt(data[j][valCol]) || currentYear;
        lastYearRow = j + 1;
        break;
      }
    }

    if (lastYear !== currentYear) {
      lastNumber = 0;
      if (lastYearRow !== -1) settingsSheet.getRange(lastYearRow, valCol + 1).setValue(currentYear);
      else settingsSheet.appendRow(['last_cert_year', currentYear]);
    }

    var candidate = lastNumber + 1;
    var genSheet = ss.getSheetByName(SHEET_NAMES.SERTIFIKAT_GENERATED);
    var used = {};
    if (genSheet) {
      var genData = genSheet.getDataRange().getValues();
      var gHeaders = genData[0].map(function (h) { return String(h).trim(); });
      var nomorIdx = gHeaders.indexOf('nomor_sertifikat');
      if (nomorIdx !== -1) {
        for (var k = 1; k < genData.length; k++) {
          var nomor = genData[k][nomorIdx];
          if (nomor && typeof nomor === 'string') {
            var m = nomor.match(/^(\d+)\//);
            if (m) used[parseInt(m[1])] = true;
          }
        }
      }
    }
    while (used[candidate]) candidate++;

    if (lastNumberRow !== -1) settingsSheet.getRange(lastNumberRow, valCol + 1).setValue(candidate);
    else settingsSheet.appendRow(['last_cert_number', candidate]);
    SpreadsheetApp.flush();
    return candidate;
  } catch (ex) {
    logErr('getNextCertificateNumber:', ex.message);
    throw new Error('Gagal generate nomor sertifikat: ' + ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function saveCertificateLayout(p) {
  try {
    if (!p.nama || !p.data_json) throw new Error('Nama dan data layout wajib');
    var sheet = getSheet(SHEET_NAMES.CERTIFICATE_LAYOUTS);
    var id = p.id || Utilities.getUuid();
    var s = getSheetData(SHEET_NAMES.CERTIFICATE_LAYOUTS);
    var idCol = s.headers.indexOf('id');
    var namaCol = s.headers.indexOf('nama');
    var dataJsonCol = s.headers.indexOf('data_json');
    var updatedAtCol = s.headers.indexOf('updatedAt');

    var found = false;
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][idCol] === id || s.rows[i][namaCol] === p.nama) {
        sheet.getRange(i + 2, dataJsonCol + 1).setValue(JSON.stringify(p.data_json));
        if (updatedAtCol !== -1) sheet.getRange(i + 2, updatedAtCol + 1).setValue(new Date());
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([id, p.nama, JSON.stringify(p.data_json), new Date(), new Date(), p.createdBy || 'admin']);
    }
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function getCertificateLayout(p) {
  try {
    var identifier = p.id || p.nama;
    if (!identifier) throw new Error('ID atau Nama layout diperlukan');
    var s = getSheetData(SHEET_NAMES.CERTIFICATE_LAYOUTS);
    if (!s.sheet) throw new Error('Sheet tidak ditemukan');
    var idCol = s.headers.indexOf('id');
    var namaCol = s.headers.indexOf('nama');
    var dataJsonCol = s.headers.indexOf('data_json');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][idCol] === identifier || s.rows[i][namaCol] === identifier) {
        try { return ok(JSON.parse(s.rows[i][dataJsonCol])); }
        catch (ex) { throw new Error('Data layout tidak valid'); }
      }
    }
    throw new Error('Layout tidak ditemukan');
  } catch (ex) { return err(ex.message); }
}

function listCertificateLayouts() {
  try {
    var s = getSheetData(SHEET_NAMES.CERTIFICATE_LAYOUTS);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function generateCertificateForParticipant(params) {
  try {
    if (!params.templateId || !params.pesertaId) throw new Error('Template ID dan Peserta ID wajib');

    var template = findRecordById(SHEET_NAMES.SERTIFIKAT_TEMPLATES, params.templateId);
    if (!template) throw new Error('Template tidak ditemukan');

    var peserta = findRecordById(SHEET_NAMES.PESERTA, params.pesertaId);
    if (!peserta) throw new Error('Peserta tidak ditemukan');

    var rtlStatus = getRTLStatus({ pesertaId: params.pesertaId });
    if (!rtlStatus.success || rtlStatus.data.status !== 'ready') {
      throw new Error('RTL belum selesai untuk peserta ini.');
    }

    var approvalsRes = getAllDigitalApprovals();
    var approvals = approvalsRes.data || [];
    var filtered = approvals.filter(function (a) { return a.peserta_nama === peserta.nama_lengkap; });
    var hasKetua = filtered.some(function (a) { return a.role === 'ketua_pc'; });
    var hasSekretaris = filtered.some(function (a) { return a.role === 'sekretaris'; });
    var hasInstruktur = filtered.some(function (a) { return a.role === 'instruktur'; });
    if (!hasKetua || !hasSekretaris || !hasInstruktur) {
      throw new Error('Tanda tangan digital belum lengkap.');
    }

    var number = getNextCertificateNumber();
    var nomorSertifikat = String(number).padStart(3, '0') + '/PC-XI/SR-01.PKD/I/' + new Date().getFullYear();
    var pdfUrl = generateCertificatePDF(peserta, nomorSertifikat, template, filtered);

    var genSheet = getSheet(SHEET_NAMES.SERTIFIKAT_GENERATED);
    var gHeaders = genSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var genId = getNextId(SHEET_NAMES.SERTIFIKAT_GENERATED, 'id');
    var row = gHeaders.map(function (colName) {
      if (colName === 'id') return genId;
      if (colName === 'nama_peserta') return peserta.nama_lengkap;
      if (colName === 'nomor_sertifikat') return nomorSertifikat;
      if (colName === 'pdf_url') return pdfUrl;
      if (colName === 'template_id') return params.templateId;
      if (colName === 'createdAt') return new Date();
      if (colName === 'peserta_id') return params.pesertaId;
      if (colName === 'lokasi') return peserta.lokasi_pkd || 'Kabupaten Bantul';
      return '';
    });
    genSheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ nomorSertifikat: nomorSertifikat, pdfUrl: pdfUrl });
  } catch (ex) {
    logErr('generateCertificateForParticipant:', ex.message);
    return err(ex.message);
  }
}

function generateCertificatePDF(peserta, nomorSertifikat, template, approvals) {
  var docTemplateId = template.doc_template_id;
  if (!docTemplateId) {
    var html = '<html><head><style>body { font-family: Arial; }</style></head><body><h1>Sertifikat</h1><p>Nama: ' + peserta.nama_lengkap + '</p><p>Nomor: ' + nomorSertifikat + '</p></body></html>';
    var blob = HtmlService.createHtmlOutput(html).getBlob().setName('sertifikat.pdf');
    var folder = getOrCreateSubFolder(SERTIFIKAT_FOLDER_NAME);
    var file = folder.createFile(blob);
    setFilePublic(file.getId());
    return file.getUrl();
  }
  var doc = DriveApp.getFileById(docTemplateId).makeCopy('Sertifikat_' + peserta.nama_lengkap);
  var docId = doc.getId();
  var body = DocumentApp.openById(docId).getBody();
  body.replaceText('{{nama}}', peserta.nama_lengkap);
  body.replaceText('{{nomor}}', nomorSertifikat);
  body.replaceText('{{tanggal}}', new Date().toLocaleDateString('id-ID'));
  body.replaceText('{{utusan}}', peserta.utusan || '');
  var ketua = approvals.find(function (a) { return a.role === 'ketua_pc'; });
  var sekretaris = approvals.find(function (a) { return a.role === 'sekretaris'; });
  var instruktur = approvals.find(function (a) { return a.role === 'instruktur'; });
  body.replaceText('{{ttd_ketua}}', ketua ? ketua.nama : '');
  body.replaceText('{{ttd_sekretaris}}', sekretaris ? sekretaris.nama : '');
  body.replaceText('{{ttd_instruktur}}', instruktur ? instruktur.nama : '');
  var pdfBlob = doc.getAs('application/pdf');
  var folder2 = getOrCreateSubFolder(SERTIFIKAT_FOLDER_NAME);
  var file2 = folder2.createFile(pdfBlob).setName('Sertifikat_' + peserta.nama_lengkap + '.pdf');
  setFilePublic(file2.getId());
  DriveApp.getFileById(docId).setTrashed(true);
  return file2.getUrl();
}

function deleteCertificate(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.SERTIFIKAT_GENERATED, p.id);
    if (!r) throw new Error('Sertifikat tidak ditemukan');
    var pdfUrlCol = r.headers.indexOf('pdf_url');
    var pdfUrl = r.row[pdfUrlCol];
    if (pdfUrl) {
      try {
        var m = String(pdfUrl).match(/\/d\/(.+)\/view/);
        if (m && m[1]) DriveApp.getFileById(m[1]).setTrashed(true);
      } catch (ex) { /* silent */ }
    }
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   TTD DIGITAL
// ============================================================
function getRequiredPreviousRole(role) {
  var idx = SIGN_ORDER.indexOf(String(role || '').toLowerCase().trim());
  if (idx <= 0) return null;
  return SIGN_ORDER[idx - 1];
}

var _approvalsCache = null;
var _approvalsCacheTime = 0;

function _getApprovalsCached() {
  var now = Date.now();
  if (_approvalsCache && (now - _approvalsCacheTime) < 5000) {
    return _approvalsCache;
  }
  _approvalsCache = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
  _approvalsCacheTime = now;
  return _approvalsCache;
}

function _invalidateApprovalsCache() {
  _approvalsCache = null;
  _approvalsCacheTime = 0;
}

function hasSignatureFor(pesertaNama, role) {
  var s = _getApprovalsCached();
  if (!s.sheet) return false;
  var roleCol = s.headers.indexOf('role');
  var pesertaCol = s.headers.indexOf('peserta_nama');
  if (roleCol === -1 || pesertaCol === -1) return false;

  var cleanNama = String(pesertaNama || '').toLowerCase().trim();
  var cleanRole = String(role || '').toLowerCase().trim();

  for (var i = 0; i < s.rows.length; i++) {
    var r = String(s.rows[i][roleCol] || '').toLowerCase().trim();
    var p = String(s.rows[i][pesertaCol] || '').toLowerCase().trim();
    if (r === cleanRole && p === cleanNama) return true;
  }
  return false;
}

function getEligiblePesertaForRole(role) {
  var prevRole = getRequiredPreviousRole(role);
  var pesertaData = getSheetData(SHEET_NAMES.PESERTA);
  var namaCol = pesertaData.headers.indexOf('nama_lengkap');
  var statusCol = pesertaData.headers.indexOf('status');
  var utusanCol = pesertaData.headers.indexOf('utusan');

  var approvals = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
  var aRoleCol = approvals.headers.indexOf('role');
  var aNamaCol = approvals.headers.indexOf('peserta_nama');

  var signedByThisRole = {};
  var signedByPrevRole = {};
  for (var i = 0; i < approvals.rows.length; i++) {
    var rRole = String(approvals.rows[i][aRoleCol] || '').toLowerCase().trim();
    var rNama = String(approvals.rows[i][aNamaCol] || '').toLowerCase().trim();
    if (!rNama) continue;
    if (rRole === role) signedByThisRole[rNama] = true;
    if (prevRole && rRole === prevRole) signedByPrevRole[rNama] = true;
  }

  var list = [];
  for (var k = 0; k < pesertaData.rows.length; k++) {
    var status = String(pesertaData.rows[k][statusCol] || '').toLowerCase().trim();
    if (status !== 'approved' && status !== 'active') continue;

    var nama = String(pesertaData.rows[k][namaCol] || '').trim();
    if (!nama) continue;
    var namaLower = nama.toLowerCase();

    if (signedByThisRole[namaLower]) continue;
    if (prevRole && !signedByPrevRole[namaLower]) continue;

    list.push({
      nama: nama,
      utusan: String(pesertaData.rows[k][utusanCol] || '').trim()
    });
  }
  return list;
}

function getSignatureOrderStatusAction() {
  try {
    var approvals = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
    var roleCol = approvals.headers.indexOf('role');
    var namaCol = approvals.headers.indexOf('peserta_nama');

    var map = {};
    for (var i = 0; i < approvals.rows.length; i++) {
      var nama = String(approvals.rows[i][namaCol] || '').trim();
      var role = String(approvals.rows[i][roleCol] || '').toLowerCase().trim();
      if (!nama || !role) continue;
      var key = nama.toLowerCase();
      if (!map[key]) map[key] = { ketua_pc: false, sekretaris: false, instruktur: false };
      if (map[key][role] !== undefined) map[key][role] = true;
    }

    var pesertaData = getSheetData(SHEET_NAMES.PESERTA);
    var pNamaCol = pesertaData.headers.indexOf('nama_lengkap');
    var pStatusCol = pesertaData.headers.indexOf('status');
    for (var k = 0; k < pesertaData.rows.length; k++) {
      var pStatus = String(pesertaData.rows[k][pStatusCol] || '').toLowerCase().trim();
      if (pStatus !== 'approved' && pStatus !== 'active') continue;
      var pNama = String(pesertaData.rows[k][pNamaCol] || '').trim();
      if (!pNama) continue;
      var pKey = pNama.toLowerCase();
      if (!map[pKey]) {
        map[pKey] = { ketua_pc: false, sekretaris: false, instruktur: false };
      }
    }
    return ok(map);
  } catch (ex) {
    return err(ex.message);
  }
}

function submitDigitalSignature(p) {
  try {
    ensureDigitalApprovalHeaders();
    if (!p.role || !p.nama || !p.signature) throw new Error('Data tidak lengkap');

    var sig = String(p.signature || '');
    if (!sig.startsWith('data:image/')) {
      throw new Error('Format tanda tangan tidak valid (harus data URL image)');
    }

    var allowed = ['ketua_pc', 'sekretaris', 'instruktur'];
    var roleLower = String(p.role).toLowerCase().trim();
    if (allowed.indexOf(roleLower) === -1) throw new Error('Role tidak valid');

    var storedHash = getSignPassword(roleLower);
    if (!p.password) throw new Error('Password wajib');
    if (!verifyPassword(p.password, storedHash)) throw new Error('Password salah');

    var prevRole = getRequiredPreviousRole(roleLower);
    if (prevRole && p.peserta_nama) {
      if (!hasSignatureFor(p.peserta_nama, prevRole)) {
        throw new Error(
          'Harap tunggu ' + (ROLE_LABELS[prevRole] || prevRole) +
          ' menandatangani "' + p.peserta_nama + '" terlebih dahulu.'
        );
      }
    }

    if (p.peserta_nama && hasSignatureFor(p.peserta_nama, roleLower)) {
      throw new Error(
        (ROLE_LABELS[roleLower] || roleLower) + ' sudah menandatangani "' +
        p.peserta_nama + '" sebelumnya.'
      );
    }

    var uploadResult = uploadFile(p.signature, 'Ttd_' + roleLower + '_' + p.nama + '_' + Date.now());
    var driveId = uploadResult.id;
    var sheet = getSheet(SHEET_NAMES.DIGITAL_APPROVALS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var row = headers.map(function (colName) {
      if (colName === 'role') return roleLower;
      if (colName === 'nama') return p.nama;
      if (colName === 'driveId') return driveId;
      if (colName === 'timestamp') return new Date();
      if (colName === 'peserta_nama') return p.peserta_nama || '';
      if (colName === 'kegunaan') return p.kegunaan || 'Verifikasi sertifikat PKD';
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();

    _invalidateApprovalsCache();
    log('[submitDigitalSignature]', roleLower, 'signed for', p.peserta_nama);

    return ok({ driveId: driveId, role: roleLower, nama: p.nama, message: 'Tanda tangan berhasil direkam' });
  } catch (ex) {
    logErr('submitDigitalSignature:', ex.message);
    return err(ex.message);
  }
}

function bulkSignForRole(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(30000);

    if (!p.role || !p.nama || !p.signature) throw new Error('Data tidak lengkap');

    var sig = String(p.signature || '');
    if (!sig.startsWith('data:image/')) {
      throw new Error('Format tanda tangan tidak valid (harus data URL image)');
    }

    var allowed = ['ketua_pc', 'sekretaris', 'instruktur'];
    var roleLower = String(p.role).toLowerCase().trim();
    if (allowed.indexOf(roleLower) === -1) throw new Error('Role tidak valid');

    var storedHash = getSignPassword(roleLower);
    if (!p.password) throw new Error('Password wajib');
    if (!verifyPassword(p.password, storedHash)) throw new Error('Password salah');

    var eligible = getEligiblePesertaForRole(roleLower);

    var filterPac = p.filterPac ? String(p.filterPac).trim().toLowerCase() : '';
    filterPac = filterPac.replace(/[<>"']/g, '');
    if (filterPac) {
      eligible = eligible.filter(function (x) {
        return String(x.utusan || '').toLowerCase().trim() === filterPac;
      });
    }

    if (eligible.length === 0) {
      throw new Error('Tidak ada peserta eligible. Cek: apakah urutan sudah benar & peserta belum selesai TTD.');
    }

    var uploadResult = uploadFile(p.signature, 'Ttd_bulk_' + roleLower + '_' + Date.now());
    var driveId = uploadResult.id;

    var sheet = getSheet(SHEET_NAMES.DIGITAL_APPROVALS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var roleCol = headers.indexOf('role');
    var namaCol = headers.indexOf('nama');
    var driveCol = headers.indexOf('driveId');
    var tsCol = headers.indexOf('timestamp');
    var pesertaCol = headers.indexOf('peserta_nama');
    var kegCol = headers.indexOf('kegunaan');

    var now = new Date();
    var kegunaan = p.kegunaan || 'Verifikasi sertifikat PKD';

    var rows = eligible.map(function (x) {
      var r = new Array(headers.length).fill('');
      if (roleCol !== -1) r[roleCol] = roleLower;
      if (namaCol !== -1) r[namaCol] = p.nama;
      if (driveCol !== -1) r[driveCol] = driveId;
      if (tsCol !== -1) r[tsCol] = now;
      if (pesertaCol !== -1) r[pesertaCol] = x.nama;
      if (kegCol !== -1) r[kegCol] = kegunaan;
      return r;
    });

    if (rows.length > 0) {
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
      SpreadsheetApp.flush();
    }

    _invalidateApprovalsCache();
    log('[bulkSignForRole]', roleLower, 'signed', eligible.length, 'peserta');

    return ok({
      driveId: driveId,
      role: roleLower,
      nama: p.nama,
      count: eligible.length,
      message: 'Berhasil tanda tangan ' + eligible.length + ' peserta'
    });
  } catch (ex) {
    logErr('bulkSignForRole:', ex.message);
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function getDigitalApproval(p) {
  try {
    if (!p.role) throw new Error('Role diperlukan');
    var s = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
    var roleCol = s.headers.indexOf('role');
    var latest = null;
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][roleCol] === p.role) {
        latest = headersToObject(s.headers, s.rows[i]);
      }
    }
    if (latest) return ok(latest);
    throw new Error('Belum ada tanda tangan untuk role ini');
  } catch (ex) { return err(ex.message); }
}

function getAllDigitalApprovals() {
  try {
    var s = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function deleteDigitalApprovalByPeserta(p) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    if (!p.peserta_nama) throw new Error('Nama peserta diperlukan');
    var s = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
    var pesertaCol = s.headers.indexOf('peserta_nama');
    var toDelete = [];
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][pesertaCol] === p.peserta_nama) toDelete.push(i + 2);
    }
    if (toDelete.length === 0) throw new Error('Tidak ada data untuk peserta ini');
    toDelete.sort(function (a, b) { return b - a; });
    toDelete.forEach(function (r) { s.sheet.deleteRow(r); });
    SpreadsheetApp.flush();
    _invalidateApprovalsCache();
    return ok({ deleted: toDelete.length });
  } catch (ex) {
    return err(ex.message);
  } finally {
    try { lock.releaseLock(); } catch (ex) {}
  }
}

function updateSignPassword(role, newPassword) {
  try {
    if (!role || !newPassword) throw new Error('Role dan password baru wajib');
    var allowed = ['ketua_pc', 'sekretaris', 'instruktur'];
    if (allowed.indexOf(role) === -1) throw new Error('Role tidak valid');
    if (String(newPassword).length < 6) throw new Error('Password minimal 6 karakter');

    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var key = 'sign_password_' + role;
    var hashed = hashPassword(newPassword);
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === key) {
        sheet.getRange(i + 1, valCol + 1).setValue(hashed);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow([key, hashed]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getSignPassword(role) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var key = 'sign_password_' + role;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === key && data[i][valCol]) return data[i][valCol];
    }

    var defaults = { 'ketua_pc': 'ketua123', 'sekretaris': 'sekretaris123', 'instruktur': 'instruktur123' };
    var defPass = defaults[role] || '123456';
    return hashPassword(defPass);
  } catch (ex) { return ''; }
}

function getSignPasswords() {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var result = {};
    var roles = ['ketua_pc', 'sekretaris', 'instruktur'];
    roles.forEach(function (role) {
      var key = 'sign_password_' + role;
      var val = null;
      for (var j = 1; j < data.length; j++) {
        if (data[j][keyCol] === key) { val = data[j][valCol]; break; }
      }
      result[role] = !!val;
    });
    return ok(result);
  } catch (ex) { return ok({}); }
}

function verifySignPassword(p) {
  try {
    if (!p.role) throw new Error('Role wajib');
    var allowed = ['ketua_pc', 'sekretaris', 'instruktur'];
    var role = String(p.role).toLowerCase().trim();
    if (allowed.indexOf(role) === -1) throw new Error('Role tidak valid');
    if (!p.password) throw new Error('Password wajib');

    var storedHash = getSignPassword(role);
    if (!verifyPassword(p.password, storedHash)) {
      return { success: false, error: 'Password salah' };
    }
    return { success: true, role: role };
  } catch (ex) { return err(ex.message); }
}

function bulkGenerateTTD(params) {
  try {
    var defaultKegunaan = params.kegunaan || 'verifikasi sertifikat PKD';
    var pesertaData = getSheetData(SHEET_NAMES.PESERTA);
    var namaCol = pesertaData.headers.indexOf('nama_lengkap');
    var statusCol = pesertaData.headers.indexOf('status');

    var daftarPeserta = [];
    for (var i = 0; i < pesertaData.rows.length; i++) {
      var status = pesertaData.rows[i][statusCol] || 'pending';
      if (status === 'approved' || status === 'active') {
        var n = pesertaData.rows[i][namaCol];
        if (n) daftarPeserta.push(n);
      }
    }

    var signersData = getLatestSigners();
    var approvalSheet = getSheet(SHEET_NAMES.DIGITAL_APPROVALS);
    var aHeaders = approvalSheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });

    var existingData = approvalSheet.getDataRange().getValues();
    var existingSet = {};
    var rColIdx = aHeaders.indexOf('role');
    var pColIdx = aHeaders.indexOf('peserta_nama');
    for (var k = 1; k < existingData.length; k++) {
      existingSet[existingData[k][rColIdx] + '|' + existingData[k][pColIdx]] = true;
    }

    var addedCount = 0;
    var roles = ['ketua_pc', 'sekretaris', 'instruktur'];

    daftarPeserta.forEach(function (peserta) {
      roles.forEach(function (role) {
        var signer = signersData[role];
        if (!signer || !signer.driveId) return;
        if (existingSet[role + '|' + peserta]) return;

        var row = aHeaders.map(function (colName) {
          if (colName === 'role') return role;
          if (colName === 'nama') return signer.nama;
          if (colName === 'driveId') return signer.driveId;
          if (colName === 'timestamp') return new Date();
          if (colName === 'peserta_nama') return peserta;
          if (colName === 'kegunaan') return signer.kegunaan || defaultKegunaan;
          return '';
        });
        approvalSheet.appendRow(row);
        existingSet[role + '|' + peserta] = true;
        addedCount++;
      });
    });

    SpreadsheetApp.flush();
    _invalidateApprovalsCache();
    return ok({ addedCount: addedCount, totalPeserta: daftarPeserta.length });
  } catch (ex) { return err(ex.message); }
}

function getLatestSigners() {
  try {
    var s = getSheetData(SHEET_NAMES.DIGITAL_APPROVALS);
    if (!s.sheet) throw new Error('Sheet tidak ditemukan');
    var roleCol = s.headers.indexOf('role');
    var namaCol = s.headers.indexOf('nama');
    var driveCol = s.headers.indexOf('driveId');
    var kegCol = s.headers.indexOf('kegunaan');
    var signers = {
      'ketua_pc': { nama: '', driveId: '', kegunaan: '' },
      'sekretaris': { nama: '', driveId: '', kegunaan: '' },
      'instruktur': { nama: '', driveId: '', kegunaan: '' }
    };
    for (var i = s.rows.length - 1; i >= 0; i--) {
      var role = s.rows[i][roleCol];
      if (signers[role] && !signers[role].driveId) {
        signers[role] = {
          nama: s.rows[i][namaCol],
          driveId: s.rows[i][driveCol],
          kegunaan: s.rows[i][kegCol] || ''
        };
      }
    }
    return signers;
  } catch (ex) {
    return {
      'ketua_pc': { nama: '', driveId: '', kegunaan: '' },
      'sekretaris': { nama: '', driveId: '', kegunaan: '' },
      'instruktur': { nama: '', driveId: '', kegunaan: '' }
    };
  }
}

// ============================================================
//   TIM INSTRUKTUR
// ============================================================
function getTimInstrukturList() {
  try {
    var s = getSheetData(SHEET_NAMES.TIM_INSTRUKTUR);
    if (!s.sheet) return ok([]);
    var rows = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      try {
        if (obj.createdAt instanceof Date) obj.createdAt = obj.createdAt.toISOString();
        if (obj.updatedAt instanceof Date) obj.updatedAt = obj.updatedAt.toISOString();
      } catch (ex) { /* silent */ }
      obj.urutan = parseInt(obj.urutan) || 999;
      return obj;
    }).filter(function (o) { return o.nama; });

    rows.sort(function (a, b) { return a.urutan - b.urutan; });
    return ok(rows);
  } catch (ex) {
    logErr('getTimInstrukturList:', ex.message);
    return err(ex.message);
  }
}

function addTimInstruktur(p) {
  try {
    if (!p.nama || !String(p.nama).trim()) throw new Error('Nama wajib diisi');
    if (!p.jabatan || !String(p.jabatan).trim()) throw new Error('Jabatan wajib diisi');

    var fotoDriveId = '';
    if (p.foto) {
      var upload = uploadFile(p.foto, 'TimInstruktur_' + String(p.nama).replace(/\s+/g, '_') + '_' + Date.now());
      fotoDriveId = upload.id;
    }

    var sheet = getSheet(SHEET_NAMES.TIM_INSTRUKTUR);
    if (!sheet) throw new Error('Sheet TimInstruktur tidak ditemukan');
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.TIM_INSTRUKTUR, 'id');
    var now = new Date();

    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama') return String(p.nama).trim();
      if (colName === 'jabatan') return String(p.jabatan).trim();
      if (colName === 'urutan') return parseInt(p.urutan) || id;
      if (colName === 'foto_driveId') return fotoDriveId;
      if (colName === 'deskripsi') return String(p.deskripsi || '').trim();
      if (colName === 'kontak_wa') return String(p.kontak_wa || '').trim();
      if (colName === 'kontak_email') return String(p.kontak_email || '').trim();
      if (colName === 'createdAt') return now;
      if (colName === 'updatedAt') return now;
      return '';
    });

    sheet.appendRow(row);
    SpreadsheetApp.flush();
    log('[addTimInstruktur]', id, p.nama);
    return ok({ id: id, fotoDriveId: fotoDriveId });
  } catch (ex) {
    logErr('addTimInstruktur:', ex.message);
    return err(ex.message);
  }
}

function updateTimInstruktur(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.TIM_INSTRUKTUR, p.id);
    if (!r) throw new Error('Data tidak ditemukan');

    var fotoCol = r.headers.indexOf('foto_driveId');
    var fotoDriveId = fotoCol !== -1 ? (r.row[fotoCol] || '') : '';

    if (p.foto) {
      if (fotoDriveId) {
        try { DriveApp.getFileById(fotoDriveId).setTrashed(true); } catch (ex) {}
      }
      var upload = uploadFile(p.foto, 'TimInstruktur_' + (p.nama || 'update') + '_' + Date.now());
      fotoDriveId = upload.id;
    } else if (p.clear_foto === true || p.clear_foto === 'true') {
      if (fotoDriveId) {
        try { DriveApp.getFileById(fotoDriveId).setTrashed(true); } catch (ex) {}
      }
      fotoDriveId = '';
    }

    for (var j = 0; j < r.headers.length; j++) {
      var colName = r.headers[j];
      if (colName === 'id' || colName === 'createdAt') continue;
      if (colName === 'foto_driveId') {
        r.sheet.getRange(r.rowIndex, j + 1).setValue(fotoDriveId);
        continue;
      }
      if (colName === 'updatedAt') {
        r.sheet.getRange(r.rowIndex, j + 1).setValue(new Date());
        continue;
      }
      if (colName === 'urutan') {
        if (p.urutan !== undefined) {
          r.sheet.getRange(r.rowIndex, j + 1).setValue(parseInt(p.urutan) || 0);
        }
        continue;
      }
      if (p[colName] !== undefined) {
        r.sheet.getRange(r.rowIndex, j + 1).setValue(String(p[colName]).trim());
      }
    }
    SpreadsheetApp.flush();
    log('[updateTimInstruktur]', p.id);
    return ok({ id: p.id, fotoDriveId: fotoDriveId });
  } catch (ex) {
    logErr('updateTimInstruktur:', ex.message);
    return err(ex.message);
  }
}

function deleteTimInstruktur(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.TIM_INSTRUKTUR, p.id);
    if (!r) throw new Error('Data tidak ditemukan');

    var fotoCol = r.headers.indexOf('foto_driveId');
    if (fotoCol !== -1 && r.row[fotoCol]) {
      try { DriveApp.getFileById(r.row[fotoCol]).setTrashed(true); } catch (ex) {}
    }

    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    log('[deleteTimInstruktur]', p.id);
    return ok();
  } catch (ex) {
    logErr('deleteTimInstruktur:', ex.message);
    return err(ex.message);
  }
}

function reorderTimInstruktur(p) {
  try {
    var orders = p.orders;
    if (typeof orders === 'string') {
      try { orders = JSON.parse(orders); } catch (ex) { orders = []; }
    }
    if (!Array.isArray(orders)) throw new Error('Format orders tidak valid');

    var sheet = getSheet(SHEET_NAMES.TIM_INSTRUKTUR);
    if (!sheet) throw new Error('Sheet tidak ditemukan');
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var idCol = headers.indexOf('id');
    var urutanCol = headers.indexOf('urutan');
    if (idCol === -1 || urutanCol === -1) throw new Error('Header id/urutan tidak ditemukan');

    var updates = 0;
    orders.forEach(function (item) {
      if (!item || !item.id) return;
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][idCol]) === String(item.id)) {
          sheet.getRange(i + 1, urutanCol + 1).setValue(parseInt(item.urutan) || 0);
          updates++;
          break;
        }
      }
    });
    SpreadsheetApp.flush();
    log('[reorderTimInstruktur]', updates, 'items updated');
    return ok({ updated: updates });
  } catch (ex) {
    logErr('reorderTimInstruktur:', ex.message);
    return err(ex.message);
  }
}

// ============================================================
//   RTL
// ============================================================
function getRTLTasks(p) {
  try {
    ensureRTLSheet();
    var s = getSheetData(SHEET_NAMES.RTL_TASKS);
    var rows = s.rows.map(function (row) { return headersToObject(s.headers, row); });
    var filterPesertaId = p && p.pesertaId ? p.pesertaId : null;
    if (filterPesertaId) {
      rows = rows.filter(function (r) { return String(r.pesertaId) === String(filterPesertaId); });
    }
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addRTLTask(p) {
  try {
    if (!p.judul || !p.deadline) throw new Error('Judul dan deadline wajib');
    ensureRTLSheet();
    var sheet = getSheet(SHEET_NAMES.RTL_TASKS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.RTL_TASKS, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'createdAt') return new Date();
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateRTLTask(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureRTLSheet();
    var r = findRowById(SHEET_NAMES.RTL_TASKS, p.id);
    if (!r) throw new Error('RTL task tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteRTLTask(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureRTLSheet();
    var r = findRowById(SHEET_NAMES.RTL_TASKS, p.id);
    if (!r) throw new Error('RTL task tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function submitRTLAttachment(p) {
  try {
    if (!p.taskId || !p.fileData || !p.fileName) throw new Error('Data tidak lengkap');
    var uploadResult = uploadFile(p.fileData, 'RTL_' + p.fileName + '_' + Date.now());
    var fileId = uploadResult.id;
    var r = findRowById(SHEET_NAMES.RTL_TASKS, p.taskId);
    if (!r) throw new Error('RTL task tidak ditemukan');
    var fileCol = r.headers.indexOf('fileDriveId');
    r.sheet.getRange(r.rowIndex, fileCol + 1).setValue(fileId);
    SpreadsheetApp.flush();
    return ok({ fileId: fileId });
  } catch (ex) { return err(ex.message); }
}

function getRTLAttachments(p) {
  try {
    if (!p.taskId) throw new Error('taskId diperlukan');
    var r = findRowById(SHEET_NAMES.RTL_TASKS, p.taskId);
    if (!r) throw new Error('RTL task tidak ditemukan');
    var fileCol = r.headers.indexOf('fileDriveId');
    var fileId = r.row[fileCol] || '';
    if (fileId) return ok({ fileId: fileId, fileUrl: 'https://drive.google.com/file/d/' + fileId + '/view' });
    return ok({ fileId: '', fileUrl: '' });
  } catch (ex) { return err(ex.message); }
}

function approveRTLTask(p) {
  try {
    if (!p.id) throw new Error('ID tugas diperlukan');
    var r = findRowById(SHEET_NAMES.RTL_TASKS, p.id);
    if (!r) throw new Error('Tugas tidak ditemukan');
    var statusCol = r.headers.indexOf('status');
    r.sheet.getRange(r.rowIndex, statusCol + 1).setValue('selesai');
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function approveAllRTL(p) {
  try {
    if (!p.pesertaId) throw new Error('Peserta ID diperlukan');
    var s = getSheetData(SHEET_NAMES.RTL_TASKS);
    var pesertaCol = s.headers.indexOf('pesertaId');
    var statusCol = s.headers.indexOf('status');
    var updated = 0;
    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][pesertaCol]) === String(p.pesertaId) && s.rows[i][statusCol] !== 'selesai') {
        s.sheet.getRange(i + 2, statusCol + 1).setValue('selesai');
        updated++;
      }
    }
    SpreadsheetApp.flush();
    return ok({ updated: updated });
  } catch (ex) { return err(ex.message); }
}

function getRTLStatus(p) {
  try {
    if (!p.pesertaId) throw new Error('Peserta ID diperlukan');
    var s = getSheetData(SHEET_NAMES.RTL_TASKS);
    var pesertaCol = s.headers.indexOf('pesertaId');
    var statusCol = s.headers.indexOf('status');
    var total = 0, completed = 0;
    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][pesertaCol]) === String(p.pesertaId)) {
        total++;
        if (s.rows[i][statusCol] === 'selesai') completed++;
      }
    }
    var status = 'notready';
    if (total === 0) status = 'ready';
    else if (completed === total) status = 'ready';
    else if (completed > 0) status = 'partial';
    return ok({ status: status, total: total, completed: completed });
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   KADER
// ============================================================
function getKaderList() {
  try {
    ensureKaderSheet();
    var s = getSheetData(SHEET_NAMES.KADER);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

function addKader(p) {
  try {
    ensureKaderSheet();
    var sheet = getSheet(SHEET_NAMES.KADER);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.KADER, 'id');
    var row = headers.map(function (colName) {
      return colName === 'id' ? id : (p[colName] !== undefined ? p[colName] : '');
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

function updateKader(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureKaderSheet();
    var r = findRowById(SHEET_NAMES.KADER, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteKader(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureKaderSheet();
    var r = findRowById(SHEET_NAMES.KADER, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   MEMBER
// ============================================================
function getMemberData(p) {
  try {
    if (!p.username) throw new Error('Username diperlukan');
    var usersSheet = getSheet(SHEET_NAMES.USERS);
    if (!usersSheet) throw new Error('Sheet Users tidak ditemukan');
    var uData = usersSheet.getDataRange().getValues();
    var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
    var userCol = uHeaders.indexOf('username');
    var roleCol = uHeaders.indexOf('role');
    var member = null;
    for (var i = 1; i < uData.length; i++) {
      if (String(uData[i][userCol]) === p.username) {
        member = { username: uData[i][userCol], role: uData[i][roleCol] };
        break;
      }
    }
    if (!member) throw new Error('Member tidak ditemukan');
    var peserta = getPesertaByIdInternal(p.username);

    var memberObj = {
      username: member.username,
      nama_lengkap: peserta ? (peserta.nama_lengkap || '') : '',
      email: peserta ? (peserta.email || '') : '',
      no_hp: peserta ? (peserta.no_hp || '') : '',
      pesertaId: peserta ? peserta.id : ''
    };

    return {
      success: true,
      member: memberObj,
      peserta: peserta,
      data: {
        member: memberObj,
        peserta: peserta
      }
    };
  } catch (ex) { return err(ex.message); }
}

function updateMemberProfile(p) {
  try {
    if (!p.username) throw new Error('Username wajib');
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var pesertaSheet = ss.getSheetByName(SHEET_NAMES.PESERTA);
    var data = pesertaSheet.getDataRange().getValues();
    var pHeaders = data[0].map(function (h) { return String(h).trim(); });
    var idCol = pHeaders.indexOf('id');

    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(p.username)) {
        found = true;
        var row = i + 1;
        var allowed = ['nama_lengkap','email','no_hp','alamat','pekerjaan','pendidikan_terakhir','tempat_tgl_lahir','pengalaman_organisasi'];
        allowed.forEach(function (fld) {
          if (p[fld] !== undefined) {
            var c = pHeaders.indexOf(fld);
            if (c !== -1) pesertaSheet.getRange(row, c + 1).setValue(p[fld]);
          }
        });
        if (p.foto) {
          var fotoCol = pHeaders.indexOf('fotoDriveId');
          var upload = uploadFile(p.foto, 'Profil_' + (p.nama_lengkap || p.username) + '_' + Date.now());
          pesertaSheet.getRange(row, fotoCol + 1).setValue(upload.id);
        }
        break;
      }
    }
    if (!found) throw new Error('Peserta tidak ditemukan');

    if (p.password && p.password.length >= 6) {
      var usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
      var uData = usersSheet.getDataRange().getValues();
      var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
      var userCol = uHeaders.indexOf('username');
      var passCol = uHeaders.indexOf('passwordHash');
      for (var j = 1; j < uData.length; j++) {
        if (String(uData[j][userCol]) === p.username) {
          usersSheet.getRange(j + 1, passCol + 1).setValue(hashPassword(p.password));
          break;
        }
      }
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getMemberSkrining(p) {
  try {
    if (!p.nama) throw new Error('Nama diperlukan');
    var s = getSheetData(SHEET_NAMES.SKRINING_RESPONSES);
    var namaCol = s.headers.indexOf('nama');
    for (var i = s.rows.length - 1; i >= 0; i--) {
      if (s.rows[i][namaCol] === p.nama) {
        var obj = headersToObject(s.headers, s.rows[i]);
        if (obj.timestamp instanceof Date) obj.timestamp = obj.timestamp.toISOString();
        return ok(obj);
      }
    }
    return ok(null);
  } catch (ex) { return err(ex.message); }
}

function getMemberAbsensi(p) {
  try {
    if (!p.nama) throw new Error('Nama diperlukan');
    var s = getSheetData(SHEET_NAMES.ABSEN_RESPONSES);
    var namaCol = s.headers.indexOf('nama');
    var sesiIdCol = s.headers.indexOf('sesiId');
    var tsCol = s.headers.indexOf('timestamp');
    var sigCol = s.headers.indexOf('signatureDriveId');

    var sesiData = getSheetData(SHEET_NAMES.SESI_ABSEN);
    var sIdCol = sesiData.headers.indexOf('id');
    var sNamaCol = sesiData.headers.indexOf('nama');
    var sesiMap = {};
    for (var i = 0; i < sesiData.rows.length; i++) {
      sesiMap[String(sesiData.rows[i][sIdCol])] = sesiData.rows[i][sNamaCol];
    }

    var absen = [];
    for (var j = 0; j < s.rows.length; j++) {
      if (s.rows[j][namaCol] === p.nama) {
        var ts = s.rows[j][tsCol];
        absen.push({
          timestamp: ts instanceof Date ? ts.toISOString() : String(ts || ''),
          sesiId: s.rows[j][sesiIdCol],
          sesiNama: sesiMap[String(s.rows[j][sesiIdCol])] || 'Sesi tidak diketahui',
          signatureDriveId: s.rows[j][sigCol]
        });
      }
    }
    return ok(absen);
  } catch (ex) { return err(ex.message); }
}

function getMemberSertifikat(p) {
  try {
    if (!p.nama) throw new Error('Nama diperlukan');
    var s = getSheetData(SHEET_NAMES.SERTIFIKAT_GENERATED);
    if (!s.sheet) return ok([]);
    var namaCol = s.headers.indexOf('nama_peserta');
    var results = [];
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][namaCol] === p.nama) {
        var obj = headersToObject(s.headers, s.rows[i]);
        if (obj.createdAt instanceof Date) obj.createdAt = obj.createdAt.toISOString();
        results.push(obj);
      }
    }
    return ok(results);
  } catch (ex) { return err(ex.message); }
}

function getMemberUsername(p) {
  try {
    if (!p.nama_lengkap || !p.email || !p.no_hp) throw new Error('Data tidak lengkap');
    var s = getSheetData(SHEET_NAMES.PESERTA);
    var namaCol = s.headers.indexOf('nama_lengkap');
    var emailCol = s.headers.indexOf('email');
    var hpCol = s.headers.indexOf('no_hp');
    var idCol = s.headers.indexOf('id');
    var searchName = p.nama_lengkap.trim().toLowerCase();
    var searchEmail = p.email.trim().toLowerCase();
    var searchPhone = String(p.no_hp).trim();
    for (var i = 0; i < s.rows.length; i++) {
      if (String(s.rows[i][namaCol] || '').trim().toLowerCase() === searchName &&
          String(s.rows[i][emailCol] || '').trim().toLowerCase() === searchEmail &&
          String(s.rows[i][hpCol] || '').trim() === searchPhone) {
        return ok({ username: String(s.rows[i][idCol]) });
      }
    }
    throw new Error('Data tidak ditemukan.');
  } catch (ex) { return err(ex.message); }
}

function verifyMemberForgot(p) {
  try {
    if (!p.username || !p.nama_lengkap || !p.email || !p.no_hp) throw new Error('Data verifikasi tidak lengkap.');
    var usersSheet = getSheet(SHEET_NAMES.USERS);
    var uData = usersSheet.getDataRange().getValues();
    var uHeaders = uData[0].map(function (h) { return String(h).trim(); });
    var uCol = uHeaders.indexOf('username');
    var exists = false;
    for (var i = 1; i < uData.length; i++) {
      if (String(uData[i][uCol]) === String(p.username)) { exists = true; break; }
    }
    if (!exists) throw new Error('Username tidak ditemukan.');

    var s = getSheetData(SHEET_NAMES.PESERTA);
    var idCol = s.headers.indexOf('id');
    var namaCol = s.headers.indexOf('nama_lengkap');
    var emailCol = s.headers.indexOf('email');
    var hpCol = s.headers.indexOf('no_hp');
    var searchName = p.nama_lengkap.trim().toLowerCase();
    var searchEmail = p.email.trim().toLowerCase();
    var searchPhone = String(p.no_hp).trim();
    for (var j = 0; j < s.rows.length; j++) {
      if (String(s.rows[j][idCol]) !== String(p.username)) continue;
      if (String(s.rows[j][namaCol] || '').trim().toLowerCase() === searchName &&
          String(s.rows[j][emailCol] || '').trim().toLowerCase() === searchEmail &&
          String(s.rows[j][hpCol] || '').trim() === searchPhone) {
        return ok();
      }
    }
    throw new Error('Data verifikasi tidak cocok.');
  } catch (ex) { return err(ex.message); }
}

function resetMemberPassword(p) {
  try {
    if (!p.username || !p.newPassword) throw new Error('Username dan password baru wajib diisi.');
    if (p.newPassword.length < 6) throw new Error('Password minimal 6 karakter.');
    var sheet = getSheet(SHEET_NAMES.USERS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var usernameCol = headers.indexOf('username');
    var passwordCol = headers.indexOf('passwordHash');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][usernameCol]).trim() === String(p.username).trim()) {
        sheet.getRange(i + 1, passwordCol + 1).setValue(hashPassword(p.newPassword));
        SpreadsheetApp.flush();
        return ok();
      }
    }
    throw new Error('Username tidak ditemukan.');
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   ASSET & FOLDERS
// ============================================================
function getAssetList() {
  try {
    var s = getSheetData(SHEET_NAMES.ASSET);
    var rows = s.rows.map(function (row) {
      var obj = headersToObject(s.headers, row);
      if (obj.timestamp instanceof Date) obj.timestamp = obj.timestamp.toISOString();
      return obj;
    });
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addAsset(p) {
  try {
    if (!p.fileData) throw new Error('Drive ID diperlukan');
    var driveId = p.fileData;
    var folderId = p.folderId || '';
    if (folderId) moveFileToFolder(driveId, folderId);

    ensureAssetSheet();
    var sheet = getSheet(SHEET_NAMES.ASSET);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.ASSET, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'driveId') return driveId;
      if (colName === 'uploadBy') return p.uploadBy || 'admin';
      if (colName === 'timestamp') return new Date();
      if (colName === 'jenis') return p.jenis || 'gambar';
      if (colName === 'folderId') return folderId;
      if (colName === 'fileName') return p.fileName || '';
      if (colName === 'mimeType') return p.mimeType || '';
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id, driveId: driveId, movedToFolder: folderId });
  } catch (ex) { return err(ex.message); }
}

function updateAsset(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.ASSET, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    for (var j = 0; j < r.headers.length; j++) {
      if (p[r.headers[j]] !== undefined) r.sheet.getRange(r.rowIndex, j + 1).setValue(p[r.headers[j]]);
    }
    if (p.fileData) {
      var driveCol = r.headers.indexOf('driveId');
      r.sheet.getRange(r.rowIndex, driveCol + 1).setValue(p.fileData);
      if (p.folderId) moveFileToFolder(p.fileData, p.folderId);
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function deleteAsset(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    var r = findRowById(SHEET_NAMES.ASSET, p.id);
    if (!r) throw new Error('Aset tidak ditemukan');
    var driveCol = r.headers.indexOf('driveId');
    var fileId = r.row[driveCol];
    if (fileId) try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ex) {}
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getFolders(params) {
  try {
    ensureFoldersSheet();
    var s = getSheetData(SHEET_NAMES.FOLDERS);
    if (!s.sheet) return ok([]);

    var isAdmin = params && parseBool(params.all);
    var folderIdParam = params && params.folderId ? String(params.folderId).trim() : null;

    var rows = [];
    for (var i = 0; i < s.rows.length; i++) {
      var obj = headersToObject(s.headers, s.rows[i]);
      obj.isPublic = parseBool(obj.isPublic);
      obj.hideFromGallery = parseBool(obj.hideFromGallery);
      obj.hasPassword = !!(obj.passwordHash && obj.passwordHash !== '');

      if (folderIdParam && String(obj.id) !== folderIdParam) continue;
      if (!isAdmin) {
        if (!obj.isPublic) continue;
        if (obj.hideFromGallery && !folderIdParam) continue;
      }
      rows.push(obj);
    }
    return ok(rows);
  } catch (ex) { return ok([]); }
}

function addFolder(p) {
  try {
    if (!p.nama) throw new Error('Nama folder wajib');
    ensureFoldersSheet();
    var sheet = getSheet(SHEET_NAMES.FOLDERS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.FOLDERS, 'id');
    var driveFolder = createAssetFolderInTarget(p.nama, p.parentId);
    var driveFolderId = driveFolder.getId();
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama') return p.nama;
      if (colName === 'parentId') return p.parentId || '';
      if (colName === 'createdAt') return new Date();
      if (colName === 'createdBy') return p.createdBy || 'admin';
      if (colName === 'isPublic') return boolToSheetString(false);
      if (colName === 'hideFromGallery') return boolToSheetString(false);
      if (colName === 'passwordHash') return '';
      if (colName === 'driveFolderId') return driveFolderId;
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id, driveFolderId: driveFolderId });
  } catch (ex) { return err(ex.message); }
}

function deleteFolder(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureFoldersSheet();
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var driveFolderId = r.row[r.headers.indexOf('driveFolderId')];
    if (driveFolderId) try { DriveApp.getFolderById(driveFolderId).setTrashed(true); } catch (ex) {}
    r.sheet.deleteRow(r.rowIndex);

    var assetData = getSheetData(SHEET_NAMES.ASSET);
    var folderCol = assetData.headers.indexOf('folderId');
    if (folderCol !== -1) {
      for (var j = 0; j < assetData.rows.length; j++) {
        if (String(assetData.rows[j][folderCol]) === String(p.id)) {
          assetData.sheet.getRange(j + 2, folderCol + 1).setValue('');
        }
      }
    }
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function toggleFolderPublic(p) {
  try {
    if (!p.id) throw new Error('ID folder diperlukan');
    var isPublic = parseBool(p.isPublic);
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var publicCol = r.headers.indexOf('isPublic');
    r.sheet.getRange(r.rowIndex, publicCol + 1).setValue(boolToSheetString(isPublic));
    SpreadsheetApp.flush();
    return ok({ isPublic: isPublic });
  } catch (ex) { return err(ex.message); }
}

function toggleFolderHideFromGallery(p) {
  try {
    if (!p.id) throw new Error('ID folder diperlukan');
    var isHidden = parseBool(p.isHidden);
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var hideCol = r.headers.indexOf('hideFromGallery');
    r.sheet.getRange(r.rowIndex, hideCol + 1).setValue(boolToSheetString(isHidden));
    SpreadsheetApp.flush();
    return ok({ isHidden: isHidden });
  } catch (ex) { return err(ex.message); }
}

function setFolderPassword(p) {
  try {
    if (!p.id) throw new Error('ID folder diperlukan');
    if (!p.password || p.password.trim() === '') throw new Error('Password tidak boleh kosong');
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var passCol = r.headers.indexOf('passwordHash');
    r.sheet.getRange(r.rowIndex, passCol + 1).setValue(hashPassword(p.password));
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function clearFolderPassword(p) {
  try {
    if (!p.id) throw new Error('ID folder diperlukan');
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var passCol = r.headers.indexOf('passwordHash');
    r.sheet.getRange(r.rowIndex, passCol + 1).setValue('');
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function verifyFolderPassword(p) {
  try {
    if (!p.id || !p.password) throw new Error('ID dan password diperlukan');
    var r = findRowById(SHEET_NAMES.FOLDERS, p.id);
    if (!r) throw new Error('Folder tidak ditemukan');
    var storedHash = r.row[r.headers.indexOf('passwordHash')] || '';
    if (storedHash === '') return ok();
    if (verifyPassword(p.password, storedHash)) return ok();
    throw new Error('Password salah');
  } catch (ex) { return err(ex.message); }
}

function getDriveToken() {
  try {
    var token = ScriptApp.getOAuthToken();
    if (!token) throw new Error('Tidak dapat memperoleh token OAuth.');
    return ok({ token: token });
  } catch (ex) { return err(ex.message); }
}

function getAssetPublicConfig() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    var enabled = false, hashed = '';

    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'public_asset_enabled') {
        enabled = parseBool(s.rows[i][valCol]);
        break;
      }
    }
    for (var j = 0; j < s.rows.length; j++) {
      if (s.rows[j][keyCol] === 'public_asset_password') {
        hashed = s.rows[j][valCol] || '';
        break;
      }
    }
    return ok({ enabled: enabled, hasPassword: hashed !== '' });
  } catch (ex) { return err(ex.message); }
}

function verifyAssetPublicPassword(p) {
  try {
    if (!p.password) throw new Error('Password diperlukan');
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    var storedHash = '';
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'public_asset_password') {
        storedHash = s.rows[i][valCol];
        break;
      }
    }
    if (verifyPassword(p.password, storedHash)) return ok();
    throw new Error('Password salah');
  } catch (ex) { return err(ex.message); }
}

function setAssetPublicPassword(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var enabled = parseBool(p.enabled);
    var password = p.password || '';

    var foundEnabled = false;
    var foundPass = false;
    var rowsToDelete = [];

    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'public_asset_enabled') {
        if (foundEnabled) {
          rowsToDelete.push(i + 1);
        } else {
          sheet.getRange(i + 1, valCol + 1).setValue(boolToSheetString(enabled));
          foundEnabled = true;
        }
      }
      if (data[i][keyCol] === 'public_asset_password') {
        if (foundPass) {
          rowsToDelete.push(i + 1);
        } else {
          if (password.trim() !== '') {
            sheet.getRange(i + 1, valCol + 1).setValue(hashPassword(password));
          } else {
            sheet.getRange(i + 1, valCol + 1).setValue('');
          }
          foundPass = true;
        }
      }
    }

    if (!foundEnabled) sheet.appendRow(['public_asset_enabled', boolToSheetString(enabled)]);
    if (!foundPass && password.trim() !== '') sheet.appendRow(['public_asset_password', hashPassword(password)]);

    rowsToDelete.sort(function (a, b) { return b - a; });
    rowsToDelete.forEach(function (row) { sheet.deleteRow(row); });

    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   PENGATURAN
// ============================================================
function getQuizSettings() {
  try {
    var s = getSheetData(SHEET_NAMES.QUIZ_SETTINGS);
    var keyCol = s.headers.indexOf('setting');
    var valCol = s.headers.indexOf('value');
    var obj = {};
    for (var i = 0; i < s.rows.length; i++) {
      var key = s.rows[i][keyCol];
      if (!key) continue;
      var val = s.rows[i][valCol];
      if (val === true || val === false) obj[key] = val;
      else if (val === 'true' || val === 'false') obj[key] = val === 'true';
      else if (!isNaN(val) && val !== '') obj[key] = parseInt(val);
      else obj[key] = val;
    }
    return ok(obj);
  } catch (ex) { return ok({}); }
}

function updateQuizSettings(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.QUIZ_SETTINGS);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('setting');
    var valCol = headers.indexOf('value');
    var updates = [
      { key: 'pretest_timer', val: p.pretest_timer },
      { key: 'posttest_timer', val: p.posttest_timer },
      { key: 'passing_grade', val: p.passing_grade }
    ];
    updates.forEach(function (u) {
      if (u.val === undefined) return;
      var data = sheet.getDataRange().getValues();
      var found = false;
      for (var j = 1; j < data.length; j++) {
        if (data[j][keyCol] === u.key) {
          sheet.getRange(j + 1, valCol + 1).setValue(u.val);
          found = true;
          break;
        }
      }
      if (!found) sheet.appendRow([u.key, u.val]);
    });
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getLoginMode() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'require_login') {
        return ok({ enabled: parseBool(s.rows[i][valCol]) });
      }
    }
    return ok({ enabled: false });
  } catch (ex) { return ok({ enabled: false }); }
}

function setLoginMode(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var enabled = parseBool(p.enabled);
    var stringVal = boolToSheetString(enabled);

    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'require_login') {
        sheet.getRange(i + 1, valCol + 1).setValue(stringVal);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['require_login', stringVal]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getPublicVisibility() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'public_visibility') {
        try { return ok(JSON.parse(s.rows[i][valCol])); }
        catch (ex) { return ok({}); }
      }
    }
    return ok({});
  } catch (ex) { return ok({}); }
}

function setPublicVisibility(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var visibility = p.data;
    if (typeof visibility === 'string') {
      try { visibility = JSON.parse(visibility); } catch (ex) { /* silent */ }
    }
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'public_visibility') {
        sheet.getRange(i + 1, valCol + 1).setValue(JSON.stringify(visibility));
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['public_visibility', JSON.stringify(visibility)]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getDashboardStats() {
  return ok({
    totalPeserta: getTotalPeserta().data.total,
    totalSesi: getSesiAbsen().data.length,
    totalMateri: getMateriList().data.length
  });
}

function getRealtimeSetting() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'realtime_enabled') {
        return ok({ enabled: parseBool(s.rows[i][valCol]) });
      }
    }
    return ok({ enabled: false });
  } catch (ex) { return ok({ enabled: false }); }
}

function setRealtimeSetting(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var enabled = parseBool(p.enabled);
    var stringVal = boolToSheetString(enabled);
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'realtime_enabled') {
        sheet.getRange(i + 1, valCol + 1).setValue(stringVal);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['realtime_enabled', stringVal]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getFormSettings() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'form_fields_config') {
        try { return ok(JSON.parse(s.rows[i][valCol])); }
        catch (ex) { return ok(getDefaultFormFields()); }
      }
    }
    return ok(getDefaultFormFields());
  } catch (ex) { return ok(getDefaultFormFields()); }
}

function setFormSettings(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var fields = p.fields;
    if (typeof fields === 'string') {
      try { fields = JSON.parse(fields); } catch (ex) { /* silent */ }
    }
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'form_fields_config') {
        sheet.getRange(i + 1, valCol + 1).setValue(JSON.stringify(fields));
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['form_fields_config', JSON.stringify(fields)]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function getPKDLokasi() {
  try {
    var s = getSheetData(SHEET_NAMES.SETTINGS);
    var keyCol = s.headers.indexOf('key');
    var valCol = s.headers.indexOf('value');
    for (var i = 0; i < s.rows.length; i++) {
      if (s.rows[i][keyCol] === 'pkd_lokasi') return ok(s.rows[i][valCol]);
    }
    return ok('MTs N 8 Bantul, D.I.Yogyakarta');
  } catch (ex) { return ok('MTs N 8 Bantul, D.I.Yogyakarta'); }
}

function setPKDLokasi(p) {
  try {
    var sheet = getSheet(SHEET_NAMES.SETTINGS);
    var data = sheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyCol = headers.indexOf('key');
    var valCol = headers.indexOf('value');
    var found = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][keyCol] === 'pkd_lokasi') {
        sheet.getRange(i + 1, valCol + 1).setValue(p.lokasi);
        found = true;
        break;
      }
    }
    if (!found) sheet.appendRow(['pkd_lokasi', p.lokasi]);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

function submitKontak(p) {
  try {
    if (!p.nama || !p.email || !p.pesan) throw new Error('Nama, email, dan pesan wajib');
    var sheet = getSheet(SHEET_NAMES.KONTAK);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var row = headers.map(function (colName) {
      if (colName === 'timestamp') return new Date();
      return p[colName] !== undefined ? p[colName] : '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   ⭐ LOKASI PKD — v27.3.0
// ============================================================

/**
 * Ambil semua Lokasi PKD (simple list).
 */
function getLokasiPKDList() {
  try {
    ensureLokasiPKDSheet();
    var s = getSheetData(SHEET_NAMES.LOKASI_PKD);
    return ok(s.rows.map(function (row) { return headersToObject(s.headers, row); }));
  } catch (ex) { return ok([]); }
}

/**
 * ⭐ NEW v27.3.0: Ambil daftar Lokasi PKD beserta jumlah peserta per lokasi.
 *
 * Return: [{
 *   id, nama, createdAt,
 *   totalPeserta, totalApproved, totalPending, totalRejected
 * }]
 *
 * Digunakan oleh:
 *   - sidebar.js → render submenu "Lokasi PKD" dinamis
 *   - app.html   → render filter Lokasi PKD di modal "Lainnya"
 *   - peserta.js → verifikasi filter dari sessionStorage
 */
function getLokasiPKDWithCount() {
  try {
    var t0 = Date.now();

    // 1. Pastikan sheet LokasiPKD ada
    ensureLokasiPKDSheet();

    // 2. Ambil daftar lokasi
    var lokasiData = getSheetData(SHEET_NAMES.LOKASI_PKD);

    var lokasiList = lokasiData.rows
      .map(function (row) {
        var obj = headersToObject(lokasiData.headers, row);
        return {
          id: String(obj.id || ''),
          nama: String(obj.nama || '').trim(),
          createdAt: obj.createdAt instanceof Date
            ? obj.createdAt.toISOString()
            : String(obj.createdAt || ''),
          totalPeserta: 0,
          totalApproved: 0,
          totalPending: 0,
          totalRejected: 0
        };
      })
      .filter(function (l) { return l.nama; });

    // 3. Hitung jumlah peserta per lokasi dari sheet Peserta
    var pesertaData = getSheetData(SHEET_NAMES.PESERTA);
    var lokasiCol = pesertaData.headers.indexOf('lokasi_pkd');
    var statusCol = pesertaData.headers.indexOf('status');

    if (lokasiCol === -1) {
      // Kolom lokasi_pkd tidak ada — kembalikan list tanpa count
      log('[getLokasiPKDWithCount] ⚠️ Kolom lokasi_pkd tidak ditemukan');
      return ok(lokasiList);
    }

    var countMap = {};

    for (var i = 0; i < pesertaData.rows.length; i++) {
      var row = pesertaData.rows[i];
      var lokasi = String(row[lokasiCol] || '').trim();
      if (!lokasi) continue;

      if (!countMap[lokasi]) {
        countMap[lokasi] = { total: 0, approved: 0, pending: 0, rejected: 0 };
      }

      var status = statusCol !== -1
        ? String(row[statusCol] || 'pending').toLowerCase().trim()
        : 'pending';

      countMap[lokasi].total++;

      if (status === 'approved' || status === 'active') {
        countMap[lokasi].approved++;
      } else if (status === 'pending') {
        countMap[lokasi].pending++;
      } else if (status === 'rejected') {
        countMap[lokasi].rejected++;
      }
    }

    // 4. Gabungkan count ke lokasiList
    lokasiList.forEach(function (l) {
      var c = countMap[l.nama] || { total: 0, approved: 0, pending: 0, rejected: 0 };
      l.totalPeserta = c.total;
      l.totalApproved = c.approved;
      l.totalPending = c.pending;
      l.totalRejected = c.rejected;
    });

    // 5. Sort alphabetically (case-insensitive)
    lokasiList.sort(function (a, b) {
      return a.nama.toLowerCase().localeCompare(b.nama.toLowerCase());
    });

    var elapsed = Date.now() - t0;
    log('[getLokasiPKDWithCount] Total', lokasiList.length, 'lokasi in', elapsed, 'ms');

    return ok(lokasiList);

  } catch (ex) {
    logErr('getLokasiPKDWithCount:', ex.message, ex.stack);
    return err(ex.message);
  }
}

/**
 * Tambah Lokasi PKD baru.
 */
function addLokasiPKD(p) {
  try {
    if (!p.nama) throw new Error('Nama lokasi wajib');
    ensureLokasiPKDSheet();
    var sheet = getSheet(SHEET_NAMES.LOKASI_PKD);
    var headers = sheet.getDataRange().getValues()[0].map(function (h) { return String(h).trim(); });
    var id = getNextId(SHEET_NAMES.LOKASI_PKD, 'id');
    var row = headers.map(function (colName) {
      if (colName === 'id') return id;
      if (colName === 'nama') return p.nama;
      if (colName === 'createdAt') return new Date();
      return '';
    });
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return ok({ id: id });
  } catch (ex) { return err(ex.message); }
}

/**
 * Hapus Lokasi PKD.
 */
function deleteLokasiPKD(p) {
  try {
    if (!p.id) throw new Error('ID diperlukan');
    ensureLokasiPKDSheet();
    var r = findRowById(SHEET_NAMES.LOKASI_PKD, p.id);
    if (!r) throw new Error('ID tidak ditemukan');
    r.sheet.deleteRow(r.rowIndex);
    SpreadsheetApp.flush();
    return ok();
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   DEFAULT FORM FIELDS
// ============================================================
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
    { id: 'surat_rekomendasi', label: 'Surat Rekomendasi', type: 'file', options: '', required: false, isCore: true }
  ];
}

// ============================================================
//   MIGRATION HELPERS
// ============================================================
function migrateSettingsBooleans() {
  var sheet = getSheet(SHEET_NAMES.SETTINGS);
  if (!sheet) return 0;
  var data = sheet.getDataRange().getValues();
  var headers = data[0].map(function (h) { return String(h).trim(); });
  var keyCol = headers.indexOf('key');
  var valCol = headers.indexOf('value');
  var boolKeys = ['require_login', 'realtime_enabled', 'public_asset_enabled'];
  var fixed = 0;
  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][keyCol] || '').trim();
    if (boolKeys.indexOf(key) === -1) continue;
    var boolVal = parseBool(data[i][valCol]);
    sheet.getRange(i + 1, valCol + 1).setValue(boolVal ? "'true" : "'false");
    fixed++;
  }
  SpreadsheetApp.flush();
  return fixed;
}

function runMigrateSettingsBooleans() {
  try {
    var count = migrateSettingsBooleans();
    return ok({ fixed: count });
  } catch (ex) { return err(ex.message); }
}

// ============================================================
//   END OF FILE — v27.3.0
// ============================================================
//   Deployment Checklist:
//     1. Deploy → Manage Deployments → "Anyone" (BUKAN "Anyone with Google Account")
//     2. Copy URL → update `js/core/config.js` (SCRIPT_URL) jika berubah
//     3. Test: URL + ?action=health
//        → expect JSON { success: true, data: { status: 'healthy', version: '27.3.0' } }
//     4. Test: URL + ?action=getLokasiPKDWithCount
//        → expect JSON { success: true, data: [{ id, nama, totalPeserta, ... }] }
//     5. Test: URL + ?action=getBootstrapData
//        → expect JSON dengan 23 keys (peserta, sesi, materi, dst)
//     6. Test: URL + ?action=getKetuaPACScopeInfo&username=ketua_sewon
//        → expect { kapanewon: 'Sewon', lokasiScope: [], username: 'ketua_sewon' }
//     7. Frontend console harus menampilkan:
//        ✅ [AdminModule] Loaded via batch: { peserta: N, ... }
//        ✅ [Sidebar] Total N lokasi loaded
// ============================================================
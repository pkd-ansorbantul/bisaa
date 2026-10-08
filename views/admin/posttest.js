// ============================================================
// VIEW: posttest.js — v27.2.0 PRODUCTION (Shared Base)
// Dimuat oleh: js/router.js
// HTML: views/admin/posttest.html
// ============================================================
// CHANGELOG v27.2.0 (dari v27.0.0):
//   ✅ Shared base v27.2.0 (_base-quiz-view.js) sudah upgrade
//     → Subscription ke AdminModule
//     → Instant render dari preload cache
//     → Auto re-render saat data berubah
//   ✅ Zero behavior change — semua fitur tetap berfungsi
//   ✅ Single source of truth — fix bug sekali, 2 view terupdate
// ============================================================

import { createQuizView } from './_base-quiz-view.js';
import { AdminModule } from '../../js/modules/admin.js';

// ============================================================
//   INSTANTIATE QUIZ VIEW
// ============================================================
const view = createQuizView({
  kind: 'posttest',
  title: 'Post-test',
  cacheKey: 'pkd_cache_posttest_questions_v2',
  exportFileName: 'posttest_data',

  // API endpoints
  api: {
    getQuestions: 'getPosttestQuestions',
    addQuestion: 'addPosttestQuestion',
    updateQuestion: 'updatePosttestQuestion',
    deleteQuestion: 'deletePosttestQuestion',
  },

  // Response getter — dari AdminModule cache
  getResponses: () => AdminModule.getPosttestList() || [],

  // DOM IDs
  ids: {
    soalContainer: 'soalContainer',
    dataContainer: 'dataContainer',
    modal: 'posttestModal',
    modalTitle: 'posttestModalTitle',
    editId: 'posttestId',
    teks: 'posttestTeks',
    opsi: 'posttestOpsi',
    optionsContainer: 'posttestOptionsContainer',
    jawaban: 'posttestJawaban',
    urutan: 'posttestUrutan',
    timerEnabled: 'posttestTimerEnabled',
    timerDurationGroup: 'posttestTimerDurationGroup',
    timerDuration: 'posttestTimerDuration',
    saveBtn: 'simpanPosttestBtn',
    detailModal: 'detailModal',
    detailBody: 'detailModalBody',
  },
});

// ============================================================
//   EXPORTS (kompatibel dengan router.js)
// ============================================================
export const mount = view.mount;
export const unmount = view.unmount;
export default view;

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Posttest View v27.2.0 — Refactored to Shared Base ',
  'background:#2563eb;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
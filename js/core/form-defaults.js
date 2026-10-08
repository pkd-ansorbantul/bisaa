// ============================================================
// js/core/form-defaults.js — v26.2.1 PRODUCTION FULL FIX
// Single source of truth untuk default form fields
// ============================================================
// CHANGELOG v26.2.1:
//   ✅ NEW: Diekstrak dari api.js (deduplication)
//   ✅ Pure data module — zero side effects, zero external deps
//   ✅ Frozen constant + fresh clone getter
//   ✅ Helper functions: isCoreFieldId, findFieldById, validateFieldId
//   ✅ Utusan options di-extract ke const (reusable)
//   ✅ Type validation untuk form structure
// ============================================================

// ============================================================
//   UTUSAN OPTIONS (PAC list)
// ============================================================
export const UTUSAN_OPTIONS = [
  'PAC Bantul',
  'PAC Banguntapan',
  'PAC Sewon',
  'PAC Kasihan',
  'PAC Pajangan',
  'PAC Sedayu',
  'PAC Pandak',
  'PAC Piyungan',
  'PAC Pleret',
  'PAC Jetis',
  'PAC Imogiri',
  'PAC Dlingo',
  'PAC Bambanglipuro',
  'PAC Sanden',
  'PAC Kretek',
  'PAC Pundong',
  'PAC Srandakan',
  'Lainnya',
];

// ============================================================
//   CORE FIELD IDS
//   Field core tidak bisa dihapus oleh admin
// ============================================================
export const CORE_FIELD_IDS = new Set([
  'nama_lengkap',
  'tempat_tgl_lahir',
  'pekerjaan',
  'pendidikan_terakhir',
  'alamat',
  'no_hp',
  'email',
  'utusan',
  'pengalaman_organisasi',
  'foto',
  'surat_rekomendasi',
]);

// ============================================================
//   DEFAULT FORM FIELDS (frozen)
// ============================================================
export const DEFAULT_FORM_FIELDS = Object.freeze([
  { id: 'nama_lengkap',          label: 'Nama Lengkap',              type: 'text',     options: '', required: true,  isCore: true },
  { id: 'tempat_tgl_lahir',      label: 'Tempat & Tanggal Lahir',    type: 'text',     options: '', required: true,  isCore: true },
  { id: 'pekerjaan',             label: 'Pekerjaan',                 type: 'text',     options: '', required: true,  isCore: true },
  { id: 'pendidikan_terakhir',   label: 'Pendidikan Terakhir',       type: 'text',     options: '', required: true,  isCore: true },
  { id: 'alamat',                label: 'Alamat',                    type: 'textarea', options: '', required: true,  isCore: true },
  { id: 'no_hp',                 label: 'No HP',                     type: 'text',     options: '', required: true,  isCore: true },
  { id: 'email',                 label: 'Email',                     type: 'text',     options: '', required: true,  isCore: true },
  { id: 'utusan',                label: 'Utusan (PAC)',              type: 'select',   options: UTUSAN_OPTIONS.join(','), required: true, isCore: true },
  { id: 'pengalaman_organisasi', label: 'Pengalaman Organisasi',     type: 'textarea', options: '', required: true,  isCore: true },
  { id: 'foto',                  label: 'Foto',                      type: 'file',     options: '', required: true,  isCore: true },
  { id: 'surat_rekomendasi',     label: 'Surat Rekomendasi',         type: 'file',     options: '', required: false, isCore: true },
]);

// ============================================================
//   GET DEFAULT FORM FIELDS
//   Return fresh clone (prevent mutation bugs)
// ============================================================
export function getDefaultFormFields() {
  return DEFAULT_FORM_FIELDS.map(f => ({ ...f }));
}

// ============================================================
//   HELPER: isCoreFieldId
// ============================================================
export function isCoreFieldId(id) {
  return CORE_FIELD_IDS.has(String(id || ''));
}

// ============================================================
//   HELPER: findFieldById
// ============================================================
export function findFieldById(fields, id) {
  if (!Array.isArray(fields) || !id) return null;
  return fields.find(f => f.id === String(id)) || null;
}

// ============================================================
//   HELPER: validateFieldId
//   Return normalized id atau null jika invalid
// ============================================================
export function validateFieldId(id) {
  if (!id) return null;
  const cleaned = String(id).trim();
  if (!/^[a-zA-Z0-9_]+$/.test(cleaned)) return null;
  return cleaned;
}

// ============================================================
//   HELPER: isValidFormStructure
//   Validate: array, non-empty, each item has id+label+type
// ============================================================
export function isValidFormStructure(structure) {
  if (!Array.isArray(structure)) return false;
  if (structure.length === 0) return false;
  return structure.every(f =>
    f && typeof f === 'object' &&
    typeof f.id === 'string' && f.id.length > 0 &&
    typeof f.label === 'string' &&
    typeof f.type === 'string'
  );
}

// ============================================================
//   HELPER: normalizeFormStructure
//   Handle nested array dari backend — pilih config paling lengkap
// ============================================================
export function normalizeFormStructure(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return getDefaultFormFields();
  }

  // Kasus nested: [[...], [...], [...]]
  if (Array.isArray(raw[0])) {
    // Prioritas: config dengan surat_rekomendasi non-required
    const correct = raw.find(cfg =>
      Array.isArray(cfg) &&
      cfg.some(f => f.id === 'surat_rekomendasi' && f.required === false)
    );
    const chosen = correct || raw[0];

    if (isValidFormStructure(chosen)) return chosen;
    return getDefaultFormFields();
  }

  // Kasus flat: [{...}, {...}]
  if (isValidFormStructure(raw)) return raw;

  return getDefaultFormFields();
}

// ============================================================
//   CONSOLE BANNER
// ============================================================
console.log(
  '%c Form Defaults v26.2.1 — Single Source of Truth ',
  'background:#8b5cf6;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600;'
);
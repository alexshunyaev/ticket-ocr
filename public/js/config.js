// js/config.js
// Holds the DEFAULT_CONFIG (normalized bounding boxes + field metadata +
// multi-ticket slot settings) and localStorage load/save helpers.
//
// All bounding boxes are stored as NORMALIZED values (0.0 .. 1.0) relative to
// the full page width/height. Boxes describe SLOT 1 (the first/top ticket).
// Additional slots are derived at runtime by shifting y by slotIndex * slotOffsetY.
//
// The coordinates below are calibrated to match the synthetic demo ticket drawn
// in js/demo-ticket.js (two stacked tickets on one page).

export const STORAGE_KEY = 'ru-ticket-ocr-config-v1';

// Post-processing type constants (keep in sync with ocr-engine.js)
export const FIELD_TYPES = {
  TEXT_CYRILLIC: 'text_cyrillic',
  NUMBER: 'ticket_number',
  MIXED: 'mixed',
  DATE_TIME: 'date_time',
  PRICE: 'price',
};

export const DEFAULT_CONFIG = {
  version: 1,
  // PDF.js render scale — higher = crisper Cyrillic OCR.
  pageRenderScale: 2.0,

  // Multi-ticket stacking.
  slotsPerPage: 1,
  slotOffsetY: 0.5, // each additional slot shifts boxes down by 50% of page height

  // Anchor / required-validation box. A slot is kept only if this check passes.
  //   mode: 'nonempty' -> the referenced field's OCR text must be long enough
  //         'keyword'  -> the referenced field's OCR text must contain `keyword`
  // An empty fieldId disables the check (every slot is kept).
  anchor: {
    fieldId: '',
    mode: 'nonempty',
    minChars: 4,
    keyword: 'БИЛЕТ',
  },

  // Calibrated on a real ticket layout. Boxes are normalized (0..1) for slot 1;
  // edit them in the Admin → Калибровка studio.
  fields: [
    {
      id: 'field_mv8ec0uy',
      label: 'Номер билета',
      type: FIELD_TYPES.MIXED,
      box: { x: 0.5086, y: 0.0435, w: 0.1826, h: 0.0243 },
    },
    {
      id: 'field_mv8echs1',
      label: 'Номер поезда',
      type: FIELD_TYPES.NUMBER,
      box: { x: 0.0566, y: 0.0806, w: 0.094, h: 0.0281 },
    },
    {
      id: 'field_mv8ecy12',
      label: 'ФИО',
      type: FIELD_TYPES.TEXT_CYRILLIC,
      box: { x: 0.5086, y: 0.1636, w: 0.3924, h: 0.0409 },
    },
    {
      id: 'field_mv8edocq',
      label: 'Время отправления',
      type: FIELD_TYPES.DATE_TIME,
      box: { x: 0.0656, y: 0.1519, w: 0.0958, h: 0.0243 },
    },
    {
      id: 'field_mv8ee803',
      label: 'Дата отправления',
      type: FIELD_TYPES.DATE_TIME,
      box: { x: 0.2066, y: 0.1531, w: 0.1284, h: 0.0243 },
    },
  ],
};

/** Deep clone helper (structuredClone fallback). */
export function cloneConfig(cfg) {
  if (typeof structuredClone === 'function') return structuredClone(cfg);
  return JSON.parse(JSON.stringify(cfg));
}

/** Load config from localStorage, falling back to DEFAULT_CONFIG. */
export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneConfig(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw);
    // Minimal shape validation; fall back if broken.
    if (!parsed || !Array.isArray(parsed.fields)) {
      return cloneConfig(DEFAULT_CONFIG);
    }
    return parsed;
  } catch (err) {
    console.warn('Failed to load config from localStorage, using defaults.', err);
    return cloneConfig(DEFAULT_CONFIG);
  }
}

/** Persist config to localStorage. Returns true on success. */
export function saveConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch (err) {
    console.error('Failed to save config to localStorage.', err);
    return false;
  }
}

/** Remove the stored config (reset to defaults on next load). */
export function clearStoredConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (err) {
    console.error('Failed to clear stored config.', err);
    return false;
  }
}

/** Produce a pretty-printed JSON string suitable for pasting into config.js. */
export function configToJSON(cfg) {
  return JSON.stringify(cfg, null, 2);
}

// js/ocr-engine.js
// 100% client-side OCR pipeline for Russian train tickets.
//   - PDF.js page rendering onto HTML5 canvas (scale from config)
//   - Canvas cropping of normalized field boxes (with slot shifting)
//   - Image preprocessing (upscale, grayscale, Otsu binarization)
//   - Persistent Tesseract.js v5 worker configured strictly for 'rus'
//   - Field-specific Russian post-processing
//
// Depends on global `window.pdfjsLib` and `window.Tesseract` loaded via CDN.

import { FIELD_TYPES } from './config.js';

const pdfjsLib = window.pdfjsLib;
const Tesseract = window.Tesseract;

// ---------------------------------------------------------------------------
// Tesseract worker (persistent, lazily created, Russian only)
// ---------------------------------------------------------------------------

const _workers = {}; // lang -> Promise<worker>

/**
 * Get (creating on first use) a persistent Tesseract worker for a language.
 *
 * TEXT fields are read with 'rus' ONLY, so Tesseract never confuses similar
 * Cyrillic/Latin letters (С, В, Е, К, М, Н, О, Р, Т, Х). Pure-DIGIT fields
 * (ticket/train numbers, dates, prices) are read with a digit-accurate engine
 * ('eng'), because the Russian model's training is letter-focused and misreads
 * long numeric strings. Digit fields contain no letters, so there is nothing
 * for the two alphabets to confuse there.
 *
 * @param {string} lang 'rus' (default, text) or 'eng' (numeric)
 * @param {(m:object)=>void} [logger] optional progress logger
 */
export async function getWorker(lang = 'rus', logger) {
  if (_workers[lang]) return _workers[lang];
  _workers[lang] = (async () => {
    // Only attach a logger when one is actually provided. Passing
    // `logger: undefined` makes Tesseract v5 try to call undefined() on every
    // progress message ("b is not a function").
    const options = {};
    if (typeof logger === 'function') options.logger = logger;
    return Tesseract.createWorker(lang, 1, options);
  })();
  return _workers[lang];
}

/** Terminate all persistent workers (e.g. on teardown). */
export async function terminateWorker() {
  const langs = Object.keys(_workers);
  for (const lang of langs) {
    try {
      const w = await _workers[lang];
      await w.terminate();
    } catch (_) {
      /* ignore */
    }
    delete _workers[lang];
  }
}

/** Language to use for a given field type. */
function langForType(type) {
  switch (type) {
    case FIELD_TYPES.NUMBER:
    case FIELD_TYPES.DATE_TIME:
    case FIELD_TYPES.PRICE:
      return 'eng'; // digit-accurate
    default:
      return 'rus'; // Cyrillic text / mixed
  }
}

// ---------------------------------------------------------------------------
// PDF / image rendering to canvas
// ---------------------------------------------------------------------------

/**
 * Render every page of a document (PDF or image File) to an array of canvases.
 * @param {File} file
 * @param {number} scale PDF render scale
 * @param {(info:{page:number,total:number})=>void} [onPage]
 * @returns {Promise<HTMLCanvasElement[]>}
 */
export async function renderDocumentToCanvases(file, scale, onPage) {
  const isPdf =
    file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (isPdf) {
    return renderPdfToCanvases(file, scale, onPage);
  }
  const canvas = await renderImageFileToCanvas(file, scale);
  if (onPage) onPage({ page: 1, total: 1 });
  return [canvas];
}

async function renderPdfToCanvases(file, scale, onPage) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const canvases = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
    if (onPage) onPage({ page: pageNum, total: pdf.numPages });
  }
  await pdf.cleanup();
  return canvases;
}

/**
 * Render an image file to a canvas. For images we apply the PDF scale as an
 * upscale factor (clamped) so small photos still OCR well.
 */
export async function renderImageFileToCanvas(file, scale) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    // Upscale small images; don't blow up already-huge photos.
    const base = Math.max(img.naturalWidth, img.naturalHeight);
    let factor = scale;
    if (base * factor > 3000) factor = Math.max(1, 3000 / base);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * factor);
    canvas.height = Math.round(img.naturalHeight * factor);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Cropping + preprocessing
// ---------------------------------------------------------------------------

/**
 * Shift a slot-1 normalized box down for a given slot index.
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function shiftBoxForSlot(box, slotIndex, slotOffsetY) {
  return {
    x: box.x,
    y: box.y + slotIndex * slotOffsetY,
    w: box.w,
    h: box.h,
  };
}

/**
 * Crop a normalized box out of a page canvas into a new canvas.
 * Returns null if the box falls (mostly) outside the page.
 */
export function cropBox(pageCanvas, box) {
  const pw = pageCanvas.width;
  const ph = pageCanvas.height;
  const sx = Math.round(box.x * pw);
  const sy = Math.round(box.y * ph);
  const sw = Math.round(box.w * pw);
  const sh = Math.round(box.h * ph);
  if (sw <= 0 || sh <= 0) return null;
  if (sy >= ph || sx >= pw) return null;

  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * Preprocess a crop for OCR: upscale small crops ~2x, grayscale, then Otsu
 * binarization to force crisp black-on-white. Returns a NEW canvas.
 */
export function preprocessCanvas(srcCanvas) {
  const minH = 60; // target a comfortable x-height for Tesseract
  let factor = 1;
  if (srcCanvas.height < minH) {
    factor = Math.max(2, Math.ceil(minH / srcCanvas.height));
  } else if (srcCanvas.height < 120) {
    factor = 2;
  }

  // Quiet-zone padding: Tesseract recognizes a single line far more reliably
  // when the glyphs don't touch the image edges.
  const pad = Math.max(12, Math.round(srcCanvas.height * factor * 0.25));
  const innerW = srcCanvas.width * factor;
  const innerH = srcCanvas.height * factor;
  const w = innerW + pad * 2;
  const h = innerH + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(srcCanvas, pad, pad, innerW, innerH);

  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  const n = w * h;

  // Grayscale + histogram
  const gray = new Uint8ClampedArray(n);
  const hist = new Array(256).fill(0);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const g = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    gray[p] = g;
    hist[g]++;
  }

  // Otsu threshold
  const threshold = otsuThreshold(hist, n);

  // Decide polarity: ensure text is dark on light. Count how many pixels are
  // below threshold; if the majority is dark, the background is dark -> invert.
  let below = 0;
  for (let p = 0; p < n; p++) if (gray[p] < threshold) below++;
  const invert = below > n / 2;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    let v = gray[p] < threshold ? 0 : 255;
    if (invert) v = 255 - v;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function otsuThreshold(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

// ---------------------------------------------------------------------------
// Recognition + post-processing
// ---------------------------------------------------------------------------

/**
 * Recognize text in a single preprocessed crop canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {string} psm page segmentation mode ('6' or '7')
 */
export async function recognizeCanvas(canvas, psm = '7', whitelist = '', lang = 'rus') {
  const worker = await getWorker(lang);
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: '1',
    // Must be reset to '' between fields or it persists on the shared worker.
    tessedit_char_whitelist: whitelist,
  });
  const { data } = await worker.recognize(canvas);
  return (data.text || '').trim();
}

/** Map a field type to a sensible page segmentation mode. */
function psmForType(_type) {
  // All our boxes are single lines.
  return '7';
}

/**
 * Character whitelist per field type. Constraining pure numeric / date / price
 * fields to their expected alphabet dramatically improves OCR of isolated
 * digits (which the Russian model otherwise confuses with letters).
 */
function whitelistForType(type) {
  switch (type) {
    case FIELD_TYPES.NUMBER:
      return '0123456789';
    case FIELD_TYPES.DATE_TIME:
      return '0123456789.:-/ ';
    case FIELD_TYPES.PRICE:
      return '0123456789.,  ';
    default:
      return ''; // Cyrillic / mixed -> no restriction
  }
}

const CYR = 'А-Яа-яЁё';

/** Field-specific Russian post-processing. */
export function postProcess(type, raw) {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  switch (type) {
    case FIELD_TYPES.TEXT_CYRILLIC:
      return cleanCyrillic(text);
    case FIELD_TYPES.NUMBER:
      return cleanNumberField(text);
    case FIELD_TYPES.MIXED:
      return cleanMixed(text);
    case FIELD_TYPES.DATE_TIME:
      return cleanDateTime(text);
    case FIELD_TYPES.PRICE:
      return cleanPrice(text);
    default:
      return text;
  }
}

function cleanCyrillic(text) {
  // Keep Cyrillic letters, spaces, hyphens, dots. Drop stray noise.
  return text
    .replace(new RegExp(`[^${CYR}\\s.\\-]`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cyrillicLookalikesToDigits(s) {
  return s
    .replace(/[Оо]/g, '0')
    .replace(/[Зз]/g, '3')
    .replace(/Б/g, '6')
    .replace(/[Ll]/g, '1')
    .replace(/[Ii]/g, '1');
}

function cleanNumberField(text) {
  const converted = cyrillicLookalikesToDigits(text);
  const digits = converted.replace(/[^0-9]/g, '');
  return digits;
}

function cleanMixed(text) {
  // Train / carriage / seat: keep digits, Cyrillic letters, spaces.
  return text
    .replace(new RegExp(`[^0-9${CYR}\\s/№.\\-]`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cleanDateTime(text) {
  const converted = cyrillicLookalikesToDigits(text);
  let out = '';

  // Extract the date first and REMOVE it from the string. Otherwise the time
  // search below would treat the day/month of a date like "27.10.2026" as a
  // time "27:10", because '.' is also a valid time separator.
  const dateMatch = converted.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  let remainder = converted;
  if (dateMatch) {
    const dd = dateMatch[1].padStart(2, '0');
    const mm = dateMatch[2].padStart(2, '0');
    let yyyy = dateMatch[3];
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    out += `${dd}.${mm}.${yyyy}`;
    remainder =
      converted.slice(0, dateMatch.index) +
      ' ' +
      converted.slice(dateMatch.index + dateMatch[0].length);
  }

  // Only now look for a time, and only in whatever is left after the date was
  // removed (dots there are safe to accept as a colon substitute).
  const timeMatch = remainder.match(/(\d{1,2})[:.](\d{2})/);
  if (timeMatch) {
    const hh = timeMatch[1].padStart(2, '0');
    const mi = timeMatch[2];
    out += (out ? ' ' : '') + `${hh}:${mi}`;
  }

  return out || converted.trim();
}

function cleanPrice(text) {
  // Drop everything except digits and separators (strips руб./₽ and any letters
  // the OCR produced from the currency suffix), then collapse spaces.
  let s = cyrillicLookalikesToDigits(text)
    .replace(/[^\d.,\s]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
  if (!s) return '';
  // If the value ends with a 2-digit decimal part, split it off and strip any
  // thousands separators from the integer part.
  const dec = s.match(/[.,](\d{2})$/);
  if (dec) {
    const intPart = s.slice(0, dec.index).replace(/[.,\s]/g, '');
    return `${intPart},${dec[1]}`;
  }
  // No clear decimals -> return the digits only.
  return s.replace(/[.,\s]/g, '');
}

// ---------------------------------------------------------------------------
// High-level extraction
// ---------------------------------------------------------------------------

/**
 * Extract one field from a page canvas for a given slot.
 * @returns {{text:string, raw:string, dataURL:string}}
 */
export async function extractField(pageCanvas, field, slotIndex, slotOffsetY) {
  const box = shiftBoxForSlot(field.box, slotIndex, slotOffsetY);
  const crop = cropBox(pageCanvas, box);
  if (!crop) return { text: '', raw: '', dataURL: '' };
  const dataURL = crop.toDataURL('image/png');
  const pre = preprocessCanvas(crop);
  const raw = await recognizeCanvas(
    pre,
    psmForType(field.type),
    whitelistForType(field.type),
    langForType(field.type)
  );
  const text = postProcess(field.type, raw);
  return { text, raw, dataURL };
}

/**
 * Check the anchor/validation for a slot. Returns true if the slot should be kept.
 */
export async function checkAnchor(pageCanvas, config, slotIndex) {
  const anchor = config.anchor;
  if (!anchor || !anchor.fieldId) return true;
  const field = config.fields.find((f) => f.id === anchor.fieldId);
  if (!field) return true;
  const { text } = await extractField(
    pageCanvas,
    field,
    slotIndex,
    config.slotOffsetY
  );
  if (anchor.mode === 'keyword') {
    return text.toUpperCase().includes((anchor.keyword || '').toUpperCase());
  }
  // default: nonempty
  const min = anchor.minChars || 1;
  return text.replace(/\s/g, '').length >= min;
}

/**
 * Extract all tickets from an array of page canvases.
 * @param {HTMLCanvasElement[]} pageCanvases
 * @param {object} config
 * @param {(p:{stage:string, page:number, totalPages:number, slot:number, totalSlots:number, field?:string})=>void} [onProgress]
 * @returns {Promise<Array>} one record per kept slot
 */
export async function extractTickets(pageCanvases, config, onProgress) {
  const results = [];
  const totalPages = pageCanvases.length;
  const totalSlots = Math.max(1, config.slotsPerPage || 1);

  for (let p = 0; p < totalPages; p++) {
    const pageCanvas = pageCanvases[p];
    for (let s = 0; s < totalSlots; s++) {
      if (onProgress)
        onProgress({
          stage: 'anchor',
          page: p + 1,
          totalPages,
          slot: s + 1,
          totalSlots,
        });
      const keep = await checkAnchor(pageCanvas, config, s);
      if (!keep) continue;

      const record = {
        _page: p + 1,
        _slot: s + 1,
        fields: {},
      };
      for (const field of config.fields) {
        if (onProgress)
          onProgress({
            stage: 'field',
            page: p + 1,
            totalPages,
            slot: s + 1,
            totalSlots,
            field: field.label,
          });
        const res = await extractField(
          pageCanvas,
          field,
          s,
          config.slotOffsetY
        );
        record.fields[field.id] = res;
      }
      results.push(record);
    }
  }
  return results;
}

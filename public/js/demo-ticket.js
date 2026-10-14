// js/demo-ticket.js
// Generates a synthetic Russian train ticket (two stacked tickets on one page)
// on an offscreen canvas. It is CONFIG-DRIVEN: it draws sample values into
// exactly the fields/boxes of the supplied config, so "Load demo" always lines
// up with the active calibration (including a freshly imported one).

import { DEFAULT_CONFIG } from './config.js';

const PAGE_W = 1000;
const PAGE_H = 1414;

/** Pick a believable sample value for a field, varying a little per slot. */
function sampleValue(field, slot) {
  const L = (field.label || '').toLowerCase();
  const alt = slot % 2 === 1;
  switch (field.type) {
    case 'text_cyrillic':
      if (L.includes('фио') || L.includes('пассажир'))
        return alt ? 'ПЕТРОВА АННА СЕРГЕЕВНА' : 'ИВАНОВ ИВАН ИВАНОВИЧ';
      if (L.includes('отправл') || L.includes('откуда'))
        return alt ? 'САНКТ-ПЕТЕРБУРГ' : 'МОСКВА';
      if (L.includes('приб') || L.includes('назнач') || L.includes('куда'))
        return alt ? 'МОСКВА' : 'САНКТ-ПЕТЕРБУРГ';
      return alt ? 'КАЗАНЬ' : 'МОСКВА';
    case 'date_time':
      if (L.includes('врем') && !L.includes('дат')) return alt ? '21:15' : '09:40';
      if (L.includes('дат') && !L.includes('врем')) return alt ? '16.12.2026' : '15.12.2026';
      return alt ? '16.12.2026 21:15' : '15.12.2026 09:40';
    case 'ticket_number': // numeric
      if (L.includes('поезд')) return alt ? '026' : '120';
      return alt ? '70987654321' : '70123456789';
    case 'mixed':
      return alt ? 'ГЖ2026009876' : 'ГЖ2026001234';
    case 'price':
      return alt ? '3980,00' : '4567,80';
    default:
      return 'ОБРАЗЕЦ';
  }
}

/** Shrink the font until the value fits inside the box width. */
function fitFont(ctx, text, boxWpx, boxHpx) {
  let size = Math.max(12, Math.floor(boxHpx * 0.82));
  const maxW = boxWpx - 8;
  for (; size > 9; size--) {
    ctx.font = `bold ${size}px Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW) break;
  }
  return size;
}

function drawField(ctx, field, slotTopNorm, value) {
  const b = field.box;
  const x = b.x * PAGE_W;
  const y = (b.y + slotTopNorm) * PAGE_H;
  const w = b.w * PAGE_W;
  const h = b.h * PAGE_H;

  // Label (small, gray) above the value box.
  ctx.fillStyle = '#6b7280';
  ctx.font = '13px Arial, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(field.label || '', x, y - 5);

  // Value (dark) inside the box, auto-fit to the box width.
  fitFont(ctx, value, w, h);
  ctx.fillStyle = '#111111';
  ctx.textBaseline = 'top';
  ctx.fillText(value, x + 4, y + 3);

  // Faint guide rectangle so the demo visually resembles form fields.
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}

function drawSlot(ctx, config, slot) {
  const offset = config.slotOffsetY || 0;
  const slotTop = slot * offset; // normalized

  // Extent of this slot's fields (for the card background).
  let maxY = 0.1;
  for (const f of config.fields) maxY = Math.max(maxY, f.box.y + f.box.h);
  const cardTopPx = slotTop * PAGE_H + 6;
  const cardBottomPx = (slotTop + maxY) * PAGE_H + 40;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(16, cardTopPx, PAGE_W - 32, cardBottomPx - cardTopPx);
  ctx.strokeStyle = '#1e3a8a';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, cardTopPx, PAGE_W - 32, cardBottomPx - cardTopPx);

  // Title (so a keyword anchor like "БИЛЕТ" can be configured too).
  ctx.fillStyle = '#1e3a8a';
  ctx.font = 'bold 18px Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(
    `ЭЛЕКТРОННЫЙ БИЛЕТ · Билет ${slot + 1}`,
    28,
    slotTop * PAGE_H + 12
  );

  for (const field of config.fields) {
    drawField(ctx, field, slotTop, sampleValue(field, slot));
  }
}

/**
 * Generate the demo ticket page as a canvas for the given config.
 * @param {object} [config] defaults to DEFAULT_CONFIG
 * @returns {HTMLCanvasElement}
 */
export function generateDemoTicketCanvas(config = DEFAULT_CONFIG) {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  const slots = Math.max(1, config.slotsPerPage || 1);
  for (let s = 0; s < slots; s++) drawSlot(ctx, config, s);

  return canvas;
}

/**
 * Generate the demo ticket as a PNG File (for the normal upload pipeline).
 * @param {object} [config]
 * @returns {Promise<File>}
 */
export function generateDemoTicketFile(config = DEFAULT_CONFIG) {
  return new Promise((resolve) => {
    generateDemoTicketCanvas(config).toBlob((blob) => {
      resolve(new File([blob], 'demo-russian-ticket.png', { type: 'image/png' }));
    }, 'image/png');
  });
}

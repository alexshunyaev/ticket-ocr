// js/app.js
// Main UI controller: tab/state management, file handling, extraction
// orchestration, inline-editable verification table, Excel/CSV export, and the
// Admin Calibration Studio wiring.

import {
  DEFAULT_CONFIG,
  FIELD_TYPES,
  cloneConfig,
  loadConfig,
  saveConfig,
  clearStoredConfig,
  configToJSON,
} from './config.js';
import {
  renderDocumentToCanvases,
  extractTickets,
  extractField,
  getWorker,
} from './ocr-engine.js';
import { generateDemoTicketCanvas } from './demo-ticket.js';
import { Calibrator } from './calibrator.js';

// Configure PDF.js worker (CDN, matches the UMD build in index.html).
if (window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  config: loadConfig(),
  records: [], // extracted ticket records with editable field text
  showCrops: false, // document crops are folded by default — fields only
  admin: {
    pages: [], // sample page canvases
    pageIndex: 0,
    selectedFieldId: null,
  },
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function showView(which) {
  const extract = which === 'extract';
  $('viewExtract').classList.toggle('hidden', !extract);
  $('viewAdmin').classList.toggle('hidden', extract);
  $('tabExtract').classList.toggle('active', extract);
  $('tabAdmin').classList.toggle('active', !extract);
  if (!extract) {
    calibrator.setConfig(state.config);
    renderAdminSidebar();
    renderConfigJson();
  }
}

// ---------------------------------------------------------------------------
// Progress helpers
// ---------------------------------------------------------------------------
function showProgress(label, pct) {
  $('progressBox').classList.remove('hidden');
  $('progressLabel').textContent = label;
  if (typeof pct === 'number') $('progressFill').style.width = `${pct}%`;
}
function hideProgress() {
  $('progressBox').classList.add('hidden');
  $('progressFill').style.width = '0%';
}

/**
 * Update the 3-step progress indicator. Steps before `n` are marked done,
 * step `n` is active, later steps are idle.
 */
function setActiveStep(n) {
  [1, 2, 3].forEach((i) => {
    const el = $(`step${i}`);
    if (!el) return;
    el.classList.toggle('active', i === n);
    el.classList.toggle('done', i < n);
  });
}

// ---------------------------------------------------------------------------
// Extraction flow
// ---------------------------------------------------------------------------
async function processCanvases(pageCanvases, sourceLabel) {
  const onProgress = (p) => {
    const base =
      p.stage === 'anchor'
        ? `Проверка якоря · стр. ${p.page}/${p.totalPages}, слот ${p.slot}/${p.totalSlots}`
        : `OCR · стр. ${p.page}/${p.totalPages}, слот ${p.slot}/${p.totalSlots} · ${p.field || ''}`;
    const pct = Math.round(((p.page - 1) / p.totalPages) * 100);
    showProgress(`${sourceLabel}: ${base}`, pct);
  };

  const raw = await extractTickets(pageCanvases, state.config, onProgress);
  // Map engine records into editable table records.
  for (const rec of raw) {
    const fields = {};
    for (const f of state.config.fields) {
      const r = rec.fields[f.id] || { text: '', dataURL: '' };
      fields[f.id] = { text: r.text, dataURL: r.dataURL };
    }
    state.records.push({
      source: sourceLabel,
      page: rec._page,
      slot: rec._slot,
      fields,
    });
  }
}

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) =>
    /\.(pdf|png|jpe?g)$/i.test(f.name) || /pdf|image/.test(f.type)
  );
  if (!files.length) return;

  $('emptyState').classList.add('hidden');
  setActiveStep(2);
  try {
    showProgress('Инициализация OCR (rus)…', 2);
    await getWorker('rus', (m) => {
      if (m.status && m.progress != null) {
        showProgress(
          `Tesseract (rus): ${m.status} ${Math.round(m.progress * 100)}%`,
          Math.round(m.progress * 100)
        );
      }
    });

    for (const file of files) {
      showProgress(`Рендеринг: ${file.name}…`, 5);
      const canvases = await renderDocumentToCanvases(
        file,
        state.config.pageRenderScale,
        (info) =>
          showProgress(
            `Рендеринг ${file.name}: стр. ${info.page}/${info.total}`,
            10
          )
      );
      await processCanvases(canvases, file.name);
    }
    renderTable();
  } catch (err) {
    console.error(err);
    alert('Ошибка обработки: ' + err.message);
  } finally {
    hideProgress();
  }
}

async function handleDemo() {
  $('emptyState').classList.add('hidden');
  setActiveStep(2);
  try {
    showProgress('Инициализация OCR (rus)…', 2);
    await getWorker('rus', (m) => {
      if (m.status && m.progress != null) {
        showProgress(
          `Tesseract (rus): ${m.status} ${Math.round(m.progress * 100)}%`,
          Math.round(m.progress * 100)
        );
      }
    });
    const canvas = generateDemoTicketCanvas(state.config);
    await processCanvases([canvas], 'Демо-билет');
    renderTable();
  } catch (err) {
    console.error(err);
    alert('Ошибка демо: ' + err.message);
  } finally {
    hideProgress();
  }
}

// ---------------------------------------------------------------------------
// Verification table
// ---------------------------------------------------------------------------
function renderTable() {
  const list = $('resultsList');
  list.innerHTML = '';

  if (!state.records.length) {
    $('resultsBox').classList.add('hidden');
    $('emptyState').classList.remove('hidden');
    setActiveStep(1);
    return;
  }
  $('resultsBox').classList.remove('hidden');
  $('emptyState').classList.add('hidden');
  $('rowCount').textContent = state.records.length;
  setActiveStep(3);

  // One card per recognized set — fields wrap in a grid, so no horizontal scroll.
  state.records.forEach((rec, idx) => {
    const card = document.createElement('div');
    card.className = 'result-card';

    const fieldsHtml = state.config.fields
      .map((f) => {
        const cell = rec.fields[f.id] || { text: '', dataURL: '' };
        let img = '';
        if (state.showCrops) {
          img = cell.dataURL
            ? `<img class="crop-img" src="${cell.dataURL}" alt="crop" />`
            : '<div class="muted" style="font-size:12px;margin-bottom:6px">нет фрагмента</div>';
        }
        return `<div class="result-field">
            <label class="result-field-label">${escapeHtml(f.label)}</label>
            ${img}
            <input class="cell-input" data-row="${idx}" data-field="${f.id}" value="${escapeAttr(
          cell.text
        )}" />
          </div>`;
      })
      .join('');

    card.innerHTML = `
      <div class="result-card-head">
        <span class="row-index">${idx + 1}</span>
        <span class="result-meta">${escapeHtml(rec.source)} · с.${rec.page} / сл.${rec.slot}</span>
        <div class="result-card-actions no-print">
          <button class="copy-str btn btn-ghost btn-sm" data-row="${idx}">📋 Копировать строкой</button>
          <button class="del-row link-danger" data-row="${idx}">✕ удалить</button>
        </div>
      </div>
      <div class="result-fields">${fieldsHtml}</div>`;
    list.appendChild(card);
  });

  // Wire inline editing
  list.querySelectorAll('input.cell-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const r = +inp.dataset.row;
      const fid = inp.dataset.field;
      if (state.records[r] && state.records[r].fields[fid]) {
        state.records[r].fields[fid].text = inp.value;
      }
    });
  });
  list.querySelectorAll('button.del-row').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.records.splice(+btn.dataset.row, 1);
      renderTable();
    });
  });
  list.querySelectorAll('button.copy-str').forEach((btn) => {
    btn.addEventListener('click', () => copyRecordString(+btn.dataset.row, btn));
  });
}

// ---------------------------------------------------------------------------
// Single-line string per ticket, e.g.
//   "780АА (24.09 19:30), 76665039752152, КАЕНКОВА А. В."
// Fields are located by label so it keeps working if ids change.
// ---------------------------------------------------------------------------
function recVal(rec, predicate) {
  const f = state.config.fields.find(predicate);
  return f ? (rec.fields[f.id]?.text || '').trim() : '';
}

function formatRecordString(rec) {
  const L = (f) => (f.label || '').toLowerCase();
  const train = recVal(rec, (f) => L(f).includes('поезд'));
  const dDate = recVal(rec, (f) => L(f).includes('дат') && L(f).includes('отправл'));
  const dTime = recVal(rec, (f) => L(f).includes('врем') && L(f).includes('отправл'));
  const ticket = recVal(rec, (f) => L(f).includes('билет'));
  const fio = recVal(
    rec,
    (f) => L(f).includes('фио') || L(f).includes('пассажир') || L(f).includes('фамил')
  );

  const dt = [dDate, dTime].filter(Boolean).join(' ');
  let head = train;
  if (dt) head = head ? `${head} (${dt})` : `(${dt})`;
  const parts = [head, ticket, fio].filter(Boolean);
  if (parts.length) return parts.join(', ');

  // Fallback: every non-empty field value, comma-joined.
  return state.config.fields
    .map((f) => (rec.fields[f.id]?.text || '').trim())
    .filter(Boolean)
    .join(', ');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

async function copyRecordString(idx, btn) {
  const rec = state.records[idx];
  if (!rec) return;
  await copyText(formatRecordString(rec));
  const original = btn.textContent;
  btn.textContent = '✅ Скопировано';
  setTimeout(() => {
    btn.textContent = original;
  }, 1400);
}

// ---------------------------------------------------------------------------
// Admin: sample loading & page switching
// ---------------------------------------------------------------------------
async function loadAdminSample(file) {
  try {
    showAdminMsg('Рендеринг образца…');
    const canvases = await renderDocumentToCanvases(
      file,
      state.config.pageRenderScale
    );
    state.admin.pages = canvases;
    state.admin.pageIndex = 0;
    updateAdminPage();
    showAdminMsg('Образец загружен.');
  } catch (err) {
    console.error(err);
    showAdminMsg('Ошибка загрузки образца: ' + err.message, true);
  }
}

function loadAdminDemo() {
  state.admin.pages = [generateDemoTicketCanvas(state.config)];
  state.admin.pageIndex = 0;
  updateAdminPage();
}

function updateAdminPage() {
  const total = state.admin.pages.length;
  const idx = state.admin.pageIndex;
  $('pageIndicator').textContent = `стр. ${total ? idx + 1 : 0} / ${total}`;
  calibrator.setConfig(state.config);
  calibrator.setImage(state.admin.pages[idx] || null);
}

// ---------------------------------------------------------------------------
// Admin: sidebar (fields, slots, anchor)
// ---------------------------------------------------------------------------
function renderAdminSidebar() {
  $('slotsPerPage').value = state.config.slotsPerPage;
  $('slotOffsetY').value = state.config.slotOffsetY;

  // Anchor field select
  const af = $('anchorField');
  af.innerHTML = state.config.fields
    .map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`)
    .join('');
  af.value = state.config.anchor?.fieldId || '';
  $('anchorMode').value = state.config.anchor?.mode || 'nonempty';
  $('anchorKeyword').value = state.config.anchor?.keyword || '';

  // Field list
  const list = $('fieldList');
  list.innerHTML = '';
  state.config.fields.forEach((f) => {
    const row = document.createElement('div');
    row.className =
      'field-row cursor-pointer' +
      (f.id === state.admin.selectedFieldId ? ' selected' : '');
    row.innerHTML = `
      <span class="field-dot" style="background:#4f46e5"></span>
      <input class="cell-input fl-name" value="${escapeAttr(f.label)}" />
      <select class="cell-input fl-type" style="max-width:118px">
        ${typeOptions(f.type)}
      </select>
      <button class="fl-del link-danger" title="Удалить" style="flex:none">✕</button>`;

    // Select on click (but not when editing inputs)
    row.addEventListener('click', (e) => {
      if (e.target.closest('input,select,button')) return;
      state.admin.selectedFieldId = f.id;
      calibrator.setSelectedField(f.id);
      renderAdminSidebar();
    });
    row.querySelector('.fl-name').addEventListener('input', (e) => {
      f.label = e.target.value;
      renderConfigJson();
    });
    row.querySelector('.fl-type').addEventListener('change', (e) => {
      f.type = e.target.value;
      renderConfigJson();
    });
    row.querySelector('.fl-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.config.fields = state.config.fields.filter((x) => x.id !== f.id);
      if (state.admin.selectedFieldId === f.id)
        state.admin.selectedFieldId = null;
      calibrator.setConfig(state.config);
      renderAdminSidebar();
      renderConfigJson();
    });
    list.appendChild(row);
  });

  renderConfigJson();
}

function typeOptions(selected) {
  const types = [
    [FIELD_TYPES.TEXT_CYRILLIC, 'Кириллица'],
    [FIELD_TYPES.NUMBER, 'Число'],
    [FIELD_TYPES.MIXED, 'Смешанный'],
    [FIELD_TYPES.DATE_TIME, 'Дата/время'],
    [FIELD_TYPES.PRICE, 'Цена'],
  ];
  return types
    .map(
      ([v, l]) =>
        `<option value="${v}" ${v === selected ? 'selected' : ''}>${l}</option>`
    )
    .join('');
}

function addField() {
  const id = 'field_' + Date.now().toString(36);
  state.config.fields.push({
    id,
    label: 'Новое поле',
    type: FIELD_TYPES.TEXT_CYRILLIC,
    box: { x: 0.1, y: 0.1, w: 0.3, h: 0.03 },
  });
  state.admin.selectedFieldId = id;
  calibrator.setConfig(state.config);
  calibrator.setSelectedField(id);
  renderAdminSidebar();
}

function renderConfigJson() {
  const el = $('configJson');
  // Don't overwrite while the user is editing/pasting into the box.
  if (document.activeElement === el) return;
  el.value = configToJSON(state.config);
}

/**
 * Validate and apply a parsed config object. Returns {ok, error}.
 * Does NOT persist — the user still clicks «Сохранить в браузере» to store it.
 */
function applyConfigObject(obj) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.fields) || !obj.fields.length) {
    return { ok: false, error: 'Нет массива "fields" в конфигурации.' };
  }
  // Sensible defaults for anything the saved config might be missing.
  obj.slotsPerPage = obj.slotsPerPage || 1;
  obj.slotOffsetY = obj.slotOffsetY ?? 0;
  obj.pageRenderScale = obj.pageRenderScale || 2.0;
  state.config = obj;
  state.admin.selectedFieldId = null;
  calibrator.setConfig(state.config);
  renderAdminSidebar();
  renderConfigJson();
  return { ok: true };
}

/** Extract a config object from raw text — accepts pure JSON or a config.js file. */
function parseConfigText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Пустой текст.');
  // Try plain JSON first.
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    /* fall through to config.js extraction */
  }
  // Try to pull the object literal after `DEFAULT_CONFIG = { ... }`.
  const m = trimmed.match(/DEFAULT_CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (m) {
    // eslint-disable-next-line no-new-func — parse a trusted object literal the user supplied
    return Function('"use strict";return (' + m[1] + ');')();
  }
  // Last resort: first {...} block.
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1));
  }
  throw new Error('Не удалось найти JSON или DEFAULT_CONFIG в файле.');
}

function applyJsonFromTextarea() {
  try {
    const obj = parseConfigText($('configJson').value);
    const res = applyConfigObject(obj);
    if (!res.ok) return showAdminMsg(res.error, true);
    showAdminMsg('Конфигурация применена. Нажмите «Сохранить в браузере», чтобы запомнить.');
  } catch (err) {
    showAdminMsg('Ошибка разбора JSON: ' + err.message, true);
  }
}

async function importConfigFile(file) {
  try {
    const text = await file.text();
    const obj = parseConfigText(text);
    const res = applyConfigObject(obj);
    if (!res.ok) return showAdminMsg(res.error, true);
    showAdminMsg(`Импортировано из «${file.name}». Нажмите «Сохранить в браузере».`);
  } catch (err) {
    showAdminMsg('Не удалось импортировать файл: ' + err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Admin: test OCR on current page (slot 1)
// ---------------------------------------------------------------------------
async function testOcr() {
  const page = state.admin.pages[state.admin.pageIndex];
  if (!page) {
    showAdminMsg('Сначала загрузите образец.', true);
    return;
  }
  const box = $('testOcrResult');
  const listEl = $('testOcrList');
  box.classList.remove('hidden');
  listEl.innerHTML = '<span class="spinner"></span> Распознавание…';

  try {
    await getWorker();
    const items = [];
    for (const f of state.config.fields) {
      const res = await extractField(page, f, 0, state.config.slotOffsetY);
      items.push(
        `<div class="flex gap-2 items-start border-b pb-1">
           <img class="crop-img" style="max-width:160px;margin:0" src="${res.dataURL}" />
           <div><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(res.text) || '<em class="text-gray-400">—</em>'}</div>
         </div>`
      );
    }
    listEl.innerHTML = items.join('');
  } catch (err) {
    listEl.innerHTML = `<span class="text-red-600">Ошибка: ${escapeHtml(err.message)}</span>`;
  }
}

// ---------------------------------------------------------------------------
// Admin: config persistence
// ---------------------------------------------------------------------------
function pullAnchorFromUI() {
  state.config.anchor = {
    fieldId: $('anchorField').value,
    mode: $('anchorMode').value,
    minChars: state.config.anchor?.minChars || 4,
    keyword: $('anchorKeyword').value,
  };
}

function showAdminMsg(text, isError) {
  const el = $('adminMsg');
  el.textContent = text;
  el.classList.remove('hidden');
  el.classList.toggle('text-red-600', !!isError);
  el.classList.toggle('text-emerald-700', !isError);
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Calibrator instance
// ---------------------------------------------------------------------------
const calibrator = new Calibrator($('calibratorCanvas'), {
  onChange: () => {
    renderConfigJson();
  },
});

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
function wire() {
  // Tabs
  $('tabExtract').addEventListener('click', () => showView('extract'));
  $('tabAdmin').addEventListener('click', () => showView('admin'));

  // Upload / dropzone
  const dz = $('dropzone');
  const fi = $('fileInput');
  dz.addEventListener('click', () => fi.click());
  fi.addEventListener('change', (e) => handleFiles(e.target.files));
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('dragover');
    })
  );
  dz.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  $('demoBtn').addEventListener('click', handleDemo);
  $('clearBtn').addEventListener('click', () => {
    state.records = [];
    renderTable();
    $('emptyState').classList.remove('hidden');
  });

  // Results view toggle
  $('toggleCropsBtn').addEventListener('click', () => {
    state.showCrops = !state.showCrops;
    $('toggleCropsBtn').textContent = state.showCrops
      ? '🙈 Скрыть фрагменты'
      : '🖼️ Показать фрагменты';
    renderTable();
  });

  // Admin sample
  $('sampleInput').addEventListener('change', (e) => {
    if (e.target.files[0]) loadAdminSample(e.target.files[0]);
  });
  $('sampleDemoBtn').addEventListener('click', loadAdminDemo);
  $('prevPageBtn').addEventListener('click', () => {
    if (state.admin.pageIndex > 0) {
      state.admin.pageIndex--;
      updateAdminPage();
    }
  });
  $('nextPageBtn').addEventListener('click', () => {
    if (state.admin.pageIndex < state.admin.pages.length - 1) {
      state.admin.pageIndex++;
      updateAdminPage();
    }
  });

  // Admin config inputs
  $('slotsPerPage').addEventListener('change', (e) => {
    state.config.slotsPerPage = Math.max(1, +e.target.value || 1);
    calibrator.setConfig(state.config);
    renderConfigJson();
  });
  $('slotOffsetY').addEventListener('change', (e) => {
    state.config.slotOffsetY = Math.min(1, Math.max(0, +e.target.value || 0));
    calibrator.setConfig(state.config);
    renderConfigJson();
  });
  $('anchorField').addEventListener('change', () => {
    pullAnchorFromUI();
    renderConfigJson();
  });
  $('anchorMode').addEventListener('change', () => {
    pullAnchorFromUI();
    renderConfigJson();
  });
  $('anchorKeyword').addEventListener('input', () => {
    pullAnchorFromUI();
    renderConfigJson();
  });

  $('addFieldBtn').addEventListener('click', addField);
  $('testOcrBtn').addEventListener('click', testOcr);

  $('saveConfigBtn').addEventListener('click', () => {
    pullAnchorFromUI();
    showAdminMsg(
      saveConfig(state.config)
        ? 'Сохранено в localStorage.'
        : 'Не удалось сохранить.',
      false
    );
  });
  $('copyConfigBtn').addEventListener('click', async () => {
    pullAnchorFromUI();
    renderConfigJson();
    try {
      await navigator.clipboard.writeText(configToJSON(state.config));
      showAdminMsg('JSON скопирован в буфер обмена.');
    } catch (_) {
      $('configJson').select();
      document.execCommand('copy');
      showAdminMsg('JSON скопирован.');
    }
  });
  $('resetConfigBtn').addEventListener('click', () => {
    clearStoredConfig();
    state.config = cloneConfig(DEFAULT_CONFIG);
    state.admin.selectedFieldId = null;
    calibrator.setConfig(state.config);
    renderAdminSidebar();
    showAdminMsg('Сброшено к значениям по умолчанию.');
  });
  $('applyJsonBtn').addEventListener('click', applyJsonFromTextarea);
  $('importConfigInput').addEventListener('change', (e) => {
    if (e.target.files[0]) importConfigFile(e.target.files[0]);
    e.target.value = ''; // allow re-importing the same file
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
wire();
renderTable();
showView('extract');

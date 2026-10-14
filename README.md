# TicketScan — Russian train-ticket OCR

A 100% client-side web app that extracts structured data from fixed-layout
**Russian train tickets** (PDF / images). All PDF rendering, cropping and OCR
run locally in the browser via WebAssembly — **no document data is ever
uploaded**.

## Features

- Drag-and-drop upload of PDF / PNG / JPG (batch + multi-page PDFs)
- Field extraction via `PDF.js` + `Tesseract.js` (Cyrillic `rus`; digits via `eng`)
- Multi-ticket support: several tickets stacked per page (configurable slots)
- Editable verification table with foldable document crops for visual checking
- Exports: copy for Excel (TSV), copy as JSON, CSV with UTF-8 BOM (RU Excel)
- **Admin calibration studio**: drag boxes on a sample, import/export config JSON

## Project layout

```
public/            # the static web app (served as the site root)
  index.html
  css/styles.css
  js/              # config.js, ocr-engine.js, calibrator.js, demo-ticket.js, app.js
server.py          # dependency-free static dev/prod server (stdlib only)
Dockerfile         # tiny python:3.12-slim image serving public/
docker-compose.yml
scripts/
  make_test_pdf.py # Pillow generator for a multi-page test ticket PDF
```

## Run locally

```bash
python server.py            # serves ./public on http://127.0.0.1:8000
# open http://127.0.0.1:8000
```

## Run with Docker

```bash
docker compose up --build   # http://127.0.0.1:8000
```

The image contains only Python + the `public/` folder. **No Tesseract / OCR
packages are installed** — OCR runs in the browser (WASM), with the engine and
language data loaded from a CDN at runtime.

## Deploy on Render

Two options:

- **Static Site (simplest):** New → Static Site, build command empty,
  **Publish directory: `public`**. No Docker, no server needed.
- **Web Service (Docker):** New → Web Service → "Use a Dockerfile". Render
  injects `$PORT`; the server reads it automatically (see `server.py` /
  `Dockerfile`). Nothing else to configure.

## Configuration

The field boxes are stored normalized (0..1) in `public/js/config.js`
(`DEFAULT_CONFIG`). A calibrated config saved in the browser (`localStorage`)
overrides the default. Use **Admin → Калибровка** to adjust boxes, then
**Сохранить в браузере**, **Копировать JSON** or **Импорт** to move configs
between machines.

Everything runs in the browser; the first run downloads the Tesseract language
data from a CDN, after which recognition is fully local.

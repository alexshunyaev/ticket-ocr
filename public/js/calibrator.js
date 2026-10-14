// js/calibrator.js
// Interactive click-and-drag bounding-box editor for the Admin Calibration
// Studio. Draws the sample ticket, overlays Slot 1 boxes (solid blue) and the
// previewed shifted Slot 2/3 boxes (dashed amber), and lets the admin drag a
// new box for the currently selected field. All boxes are kept normalized.

export class Calibrator {
  /**
   * @param {HTMLCanvasElement} canvasEl visible overlay canvas
   * @param {object} opts { onChange }
   */
  constructor(canvasEl, opts = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.onChange = opts.onChange || (() => {});

    this.sourceCanvas = null; // the rendered sample page canvas
    this.config = null;
    this.selectedFieldId = null;

    // Display geometry (source drawn to fit canvas width).
    this._displayW = 0;
    this._displayH = 0;

    this._dragging = false;
    this._start = null;
    this._current = null;

    this._bind();
  }

  setConfig(config) {
    this.config = config;
    this.redraw();
  }

  setImage(sourceCanvas) {
    this.sourceCanvas = sourceCanvas;
    this._fit();
    this.redraw();
  }

  setSelectedField(fieldId) {
    this.selectedFieldId = fieldId;
    this.redraw();
  }

  _fit() {
    if (!this.sourceCanvas) return;
    // Fit to a max display width; keep aspect ratio.
    const maxW = this.canvas.parentElement
      ? this.canvas.parentElement.clientWidth || 640
      : 640;
    const displayW = Math.min(maxW, this.sourceCanvas.width);
    const scale = displayW / this.sourceCanvas.width;
    this._displayW = Math.round(this.sourceCanvas.width * scale);
    this._displayH = Math.round(this.sourceCanvas.height * scale);
    this.canvas.width = this._displayW;
    this.canvas.height = this._displayH;
  }

  _bind() {
    const onDown = (e) => {
      if (!this.sourceCanvas || !this.selectedFieldId) return;
      this._dragging = true;
      this._start = this._pos(e);
      this._current = this._start;
    };
    const onMove = (e) => {
      if (!this._dragging) return;
      this._current = this._pos(e);
      this.redraw();
    };
    const onUp = () => {
      if (!this._dragging) return;
      this._dragging = false;
      this._commitBox();
    };

    this.canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // Touch support.
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches[0]) onDown(e.touches[0]);
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches[0]) onMove(e.touches[0]);
      e.preventDefault();
    }, { passive: false });
    this.canvas.addEventListener('touchend', onUp);
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.canvas.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(this.canvas.height, e.clientY - rect.top));
    return { x, y };
  }

  _commitBox() {
    if (!this._start || !this._current || !this.config) return;
    const x0 = Math.min(this._start.x, this._current.x);
    const y0 = Math.min(this._start.y, this._current.y);
    const w = Math.abs(this._current.x - this._start.x);
    const h = Math.abs(this._current.y - this._start.y);
    this._start = null;
    this._current = null;
    if (w < 4 || h < 4) {
      this.redraw();
      return; // ignore tiny accidental clicks
    }
    const field = this.config.fields.find((f) => f.id === this.selectedFieldId);
    if (!field) return;
    field.box = {
      x: +(x0 / this._displayW).toFixed(4),
      y: +(y0 / this._displayH).toFixed(4),
      w: +(w / this._displayW).toFixed(4),
      h: +(h / this._displayH).toFixed(4),
    };
    this.onChange(this.config);
    this.redraw();
  }

  redraw() {
    const ctx = this.ctx;
    if (!this.canvas.width || !this.canvas.height) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.sourceCanvas) {
      ctx.fillStyle = '#f3f4f6';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'Загрузите образец билета (PDF / изображение)',
        this.canvas.width / 2,
        this.canvas.height / 2 || 40
      );
      ctx.textAlign = 'left';
      return;
    }
    // Draw the sample image.
    ctx.drawImage(this.sourceCanvas, 0, 0, this._displayW, this._displayH);

    if (!this.config) return;
    const slots = Math.max(1, this.config.slotsPerPage || 1);
    const offset = this.config.slotOffsetY || 0;

    for (const field of this.config.fields) {
      const selected = field.id === this.selectedFieldId;
      // Slot 1 (solid blue; selected field brighter).
      this._drawBox(field.box, 0, {
        color: selected ? '#2563eb' : '#60a5fa',
        dashed: false,
        label: field.label,
        lineWidth: selected ? 3 : 2,
      });
      // Slots 2..n (dashed amber preview).
      for (let s = 1; s < slots; s++) {
        this._drawBox(field.box, s * offset, {
          color: '#f59e0b',
          dashed: true,
          label: '',
          lineWidth: 1.5,
        });
      }
    }

    // In-progress drag rectangle.
    if (this._dragging && this._start && this._current) {
      const x0 = Math.min(this._start.x, this._current.x);
      const y0 = Math.min(this._start.y, this._current.y);
      const w = Math.abs(this._current.x - this._start.x);
      const h = Math.abs(this._current.y - this._start.y);
      ctx.save();
      ctx.strokeStyle = '#dc2626';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, w, h);
      ctx.restore();
    }
  }

  _drawBox(box, yShift, opts) {
    const ctx = this.ctx;
    const x = box.x * this._displayW;
    const y = (box.y + yShift) * this._displayH;
    const w = box.w * this._displayW;
    const h = box.h * this._displayH;
    ctx.save();
    ctx.strokeStyle = opts.color;
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.setLineDash(opts.dashed ? [6, 4] : []);
    ctx.strokeRect(x, y, w, h);
    if (opts.label) {
      ctx.setLineDash([]);
      const text = opts.label;
      ctx.font = '12px sans-serif';
      const tw = ctx.measureText(text).width + 8;
      ctx.fillStyle = opts.color;
      const labelY = y - 16 >= 0 ? y - 16 : y;
      ctx.fillRect(x, labelY, tw, 15);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x + 4, labelY + 11);
    }
    ctx.restore();
  }
}

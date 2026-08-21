(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('asciiCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const frame = $('canvasFrame');

  const PRESETS = {
    strict: '@%#*+=-:. ',
    dense: '@#8&%$*+=-:,. ',
    tech: 'MWN8B@$0OQXKAHmwpqdbkhao*+=-:. ',
    blocks: '█▓▒░ '
  };

  const QUICK_CHARS = ['#', '@', '%', '&', '*', '+', '=', '-', ':', '.', '/', '\\', '|', '_', '(', ')', '[', ']', '{', '}', '<', '>', '0', '1', 'A', 'Z', '?', '!', '$', '^', '~', ' '];
  const TOOL_LABELS = { pencil: 'Карандаш', eraser: 'Ластик', line: 'Линия', rect: 'Рамка', fill: 'Заливка' };

  const state = {
    cols: 80,
    rows: 42,
    zoom: 1,
    baseFont: 16,
    showGrid: true,
    tool: 'pencil',
    char: '#',
    fg: '#8dff00',
    bg: '#050806',
    grid: [],
    colors: [],
    isPointerDown: false,
    startCell: null,
    lastCell: null,
    history: [],
    future: [],
    loadedImage: null,
    imageName: '',
    showReference: false,
    referenceOpacity: 0.28,
    contrast: 1,
    invert: false,
    sourceColors: false,
    saveTimer: null,
  };

  function blankGrid(cols = state.cols, rows = state.rows) {
    return Array.from({ length: rows }, () => Array(cols).fill(' '));
  }
  function blankColors(cols = state.cols, rows = state.rows, color = state.fg) {
    return Array.from({ length: rows }, () => Array(cols).fill(color));
  }

  function initializeGrid() {
    state.grid = blankGrid();
    state.colors = blankColors();
  }

  function sanitizeChar(value) {
    if (!value) return ' ';
    return Array.from(value)[0] || ' ';
  }

  function currentMetrics() {
    const fontSize = Math.max(8, Math.round(state.baseFont * state.zoom));
    const cellW = Math.max(6, Math.round(fontSize * 0.62));
    const cellH = Math.max(9, Math.round(fontSize * 1.12));
    return { fontSize, cellW, cellH };
  }

  function resizeCanvas() {
    const { cellW, cellH } = currentMetrics();
    canvas.width = state.cols * cellW;
    canvas.height = state.rows * cellH;
    render();
    $('gridStatus').textContent = `${state.cols} × ${state.rows}`;
  }

  function render(includeReference = true) {
    const { fontSize, cellW, cellH } = currentMetrics();

    ctx.save();
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (includeReference && state.loadedImage && state.showReference) {
      ctx.globalAlpha = state.referenceOpacity;
      drawImageCover(ctx, state.loadedImage, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexToRgba(state.bg, 0.35);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const ch = state.grid[y][x];
        if (ch && ch !== ' ') {
          ctx.fillStyle = state.colors[y][x] || state.fg;
          ctx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2 + 0.5);
        }
      }
    }

    if (state.showGrid && state.zoom >= 0.7) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(141, 255, 0, 0.065)';
      ctx.beginPath();
      for (let x = 0; x <= state.cols; x++) {
        const px = x * cellW + 0.5;
        ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height);
      }
      for (let y = 0; y <= state.rows; y++) {
        const py = y * cellH + 0.5;
        ctx.moveTo(0, py); ctx.lineTo(canvas.width, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawImageCover(context, img, x, y, w, h) {
    const imageRatio = img.width / img.height;
    const targetRatio = w / h;
    let dw, dh, dx, dy;
    if (imageRatio > targetRatio) {
      dh = h; dw = h * imageRatio; dx = x - (dw - w) / 2; dy = y;
    } else {
      dw = w; dh = w / imageRatio; dx = x; dy = y - (dh - h) / 2;
    }
    context.drawImage(img, dx, dy, dw, dh);
  }

  function rgbToHex(r, g, b) {
    const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const normalized = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function cellFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (event.clientX - rect.left) * scaleX;
    const py = (event.clientY - rect.top) * scaleY;
    const { cellW, cellH } = currentMetrics();
    return {
      x: Math.max(0, Math.min(state.cols - 1, Math.floor(px / cellW))),
      y: Math.max(0, Math.min(state.rows - 1, Math.floor(py / cellH)))
    };
  }

  function inBounds(x, y) { return x >= 0 && x < state.cols && y >= 0 && y < state.rows; }

  function setCell(x, y, char = state.char, color = state.fg) {
    if (!inBounds(x, y)) return;
    state.grid[y][x] = char;
    state.colors[y][x] = color;
  }

  function eraseCell(x, y) { setCell(x, y, ' ', state.fg); }

  function paintLine(a, b, char = state.char, color = state.fg) {
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      setCell(x0, y0, char, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function paintRect(a, b, char = state.char, color = state.fg) {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (let x = minX; x <= maxX; x++) { setCell(x, minY, char, color); setCell(x, maxY, char, color); }
    for (let y = minY; y <= maxY; y++) { setCell(minX, y, char, color); setCell(maxX, y, char, color); }
  }

  function floodFill(startX, startY, replacementChar, replacementColor) {
    const targetChar = state.grid[startY][startX];
    const targetColor = state.colors[startY][startX];
    if (targetChar === replacementChar && targetColor === replacementColor) return;
    const stack = [[startX, startY]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inBounds(x, y)) continue;
      if (state.grid[y][x] !== targetChar || state.colors[y][x] !== targetColor) continue;
      setCell(x, y, replacementChar, replacementColor);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  function snapshot() {
    return {
      cols: state.cols,
      rows: state.rows,
      grid: state.grid.map(row => [...row]),
      colors: state.colors.map(row => [...row]),
      fg: state.fg,
      bg: state.bg
    };
  }

  function restore(snap) {
    state.cols = snap.cols; state.rows = snap.rows;
    state.grid = snap.grid.map(row => [...row]);
    state.colors = snap.colors.map(row => [...row]);
    state.fg = snap.fg || state.fg; state.bg = snap.bg || state.bg;
    $('colsInput').value = state.cols; $('rowsInput').value = state.rows;
    $('fgColor').value = state.fg; $('bgColor').value = state.bg;
    resizeCanvas(); updateStatus(); scheduleSave();
  }

  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 60) state.history.shift();
    state.future.length = 0;
    updateHistoryButtons();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshot());
    restore(state.history.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshot());
    restore(state.future.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = state.history.length === 0;
    $('redoBtn').disabled = state.future.length === 0;
  }

  function beginPointer(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const cell = cellFromEvent(event);
    state.isPointerDown = true;
    state.startCell = cell;
    state.lastCell = cell;
    pushHistory();

    if (state.tool === 'pencil') setCell(cell.x, cell.y);
    else if (state.tool === 'eraser') eraseCell(cell.x, cell.y);
    else if (state.tool === 'fill') {
      floodFill(cell.x, cell.y, state.char, state.fg);
      state.isPointerDown = false;
    }
    render(); updateStatus(); scheduleSave();
  }

  function movePointer(event) {
    const cell = cellFromEvent(event);
    $('cursorInfo').textContent = `x: ${cell.x} · y: ${cell.y}`;
    if (!state.isPointerDown) return;
    if (state.tool === 'pencil' || state.tool === 'eraser') {
      if (cell.x === state.lastCell.x && cell.y === state.lastCell.y) return;
      paintLine(state.lastCell, cell, state.tool === 'eraser' ? ' ' : state.char, state.fg);
      state.lastCell = cell;
      render(); scheduleSave();
    }
  }

  function endPointer(event) {
    if (!state.isPointerDown) return;
    const cell = cellFromEvent(event);
    if (state.tool === 'line') paintLine(state.startCell, cell);
    else if (state.tool === 'rect') paintRect(state.startCell, cell);
    state.isPointerDown = false;
    render(); updateStatus(); scheduleSave();
  }

  function resizeGrid(newCols, newRows, preserve = true) {
    newCols = Math.max(8, Math.min(240, Number(newCols) || 80));
    newRows = Math.max(6, Math.min(160, Number(newRows) || 42));
    pushHistory();
    const nextGrid = blankGrid(newCols, newRows);
    const nextColors = blankColors(newCols, newRows);
    if (preserve) {
      for (let y = 0; y < Math.min(state.rows, newRows); y++) {
        for (let x = 0; x < Math.min(state.cols, newCols); x++) {
          nextGrid[y][x] = state.grid[y][x];
          nextColors[y][x] = state.colors[y][x];
        }
      }
    }
    state.cols = newCols; state.rows = newRows;
    state.grid = nextGrid; state.colors = nextColors;
    $('colsInput').value = newCols; $('rowsInput').value = newRows;
    resizeCanvas(); updateStatus(); scheduleSave();
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.toggle('active', btn.dataset.tool === tool));
    updateStatus();
  }

  function setChar(char) {
    state.char = sanitizeChar(char);
    $('charInput').value = state.char === ' ' ? '' : state.char;
    $('selectedCharLabel').textContent = state.char === ' ' ? 'SPACE' : state.char;
    document.querySelectorAll('.char-button').forEach(btn => btn.classList.toggle('active', btn.dataset.char === state.char));
    updateStatus();
  }

  function updateStatus() {
    $('toolStatus').textContent = `${TOOL_LABELS[state.tool]} · ${state.char === ' ' ? 'SPACE' : state.char}`;
  }

  function buildQuickPalette() {
    const host = $('quickPalette');
    host.innerHTML = '';
    QUICK_CHARS.forEach(ch => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'char-button';
      button.dataset.char = ch;
      button.textContent = ch === ' ' ? '␠' : ch;
      button.title = ch === ' ' ? 'Пробел' : ch;
      button.addEventListener('click', () => setChar(ch));
      host.appendChild(button);
    });
  }

  function gridToText() {
    const lines = state.grid.map(row => row.join('').replace(/\s+$/g, ''));
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTxt() {
    const blob = new Blob([gridToText()], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'glyphforge-art.txt');
    toast('TXT экспортирован');
  }

  function exportPng() {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = canvas.width; exportCanvas.height = canvas.height;
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });
    const originalCtx = ctx;
    // Re-render independently so the reference image and grid lines never leak into output.
    const { fontSize, cellW, cellH } = currentMetrics();
    exportCtx.fillStyle = state.bg; exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.textAlign = 'center'; exportCtx.textBaseline = 'middle';
    exportCtx.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace`;
    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const ch = state.grid[y][x];
        if (ch && ch !== ' ') {
          exportCtx.fillStyle = state.colors[y][x] || state.fg;
          exportCtx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2 + 0.5);
        }
      }
    }
    exportCanvas.toBlob(blob => {
      if (blob) downloadBlob(blob, 'glyphforge-art.png');
      toast('PNG экспортирован');
    }, 'image/png');
  }

  async function copyText() {
    const text = gridToText();
    try {
      await navigator.clipboard.writeText(text);
      toast('ASCII-арт скопирован');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      toast('ASCII-арт скопирован');
    }
  }

  function importText(text) {
    const normalized = text.replace(/\r/g, '');
    const lines = normalized.split('\n');
    const cols = Math.max(8, Math.min(240, Math.max(...lines.map(l => Array.from(l).length), 8)));
    const rows = Math.max(6, Math.min(160, lines.length));
    pushHistory();
    state.cols = cols; state.rows = rows;
    state.grid = blankGrid(cols, rows); state.colors = blankColors(cols, rows);
    lines.slice(0, rows).forEach((line, y) => {
      Array.from(line).slice(0, cols).forEach((ch, x) => setCell(x, y, ch, state.fg));
    });
    $('colsInput').value = cols; $('rowsInput').value = rows;
    resizeCanvas(); scheduleSave(); toast('TXT импортирован');
  }

  function loadImage(file) {
    const img = new Image();
    img.onload = () => {
      state.loadedImage = img;
      state.imageName = file.name;
      $('convertImageBtn').disabled = false;
      $('fitImageGridBtn').disabled = false;
      $('referenceToggle').disabled = false;
      $('referenceOpacity').disabled = false;
      $('referenceToggle').checked = true;
      state.showReference = true;
      render();
      toast(`Изображение загружено: ${file.name}`);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function fitGridToImage() {
    if (!state.loadedImage) return;
    const ratio = state.loadedImage.width / state.loadedImage.height;
    const cols = Math.max(24, Math.min(160, state.cols));
    // Character cells are taller than wide; compensate to preserve perceived aspect.
    const rows = Math.max(12, Math.min(120, Math.round(cols / ratio * 0.55)));
    resizeGrid(cols, rows, false);
    toast(`Сетка подогнана: ${cols} × ${rows}`);
  }

  function convertImageToAscii() {
    if (!state.loadedImage) return;
    const charset = Array.from($('charsetInput').value || PRESETS.strict);
    if (!charset.length) return;
    pushHistory();

    const off = document.createElement('canvas');
    off.width = state.cols; off.height = state.rows;
    const octx = off.getContext('2d', { willReadFrequently: true });
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, off.width, off.height);
    drawImageCover(octx, state.loadedImage, 0, 0, off.width, off.height);
    const data = octx.getImageData(0, 0, off.width, off.height).data;

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const i = (y * state.cols + x) * 4;
        let lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        lum = (lum - 0.5) * state.contrast + 0.5;
        lum = Math.max(0, Math.min(1, lum));
        if (state.invert) lum = 1 - lum;
        const idx = Math.min(charset.length - 1, Math.floor(lum * charset.length));
        state.grid[y][x] = charset[idx];
        state.colors[y][x] = state.sourceColors
          ? rgbToHex(data[i], data[i + 1], data[i + 2])
          : state.fg;
      }
    }
    render(); scheduleSave(); toast('Изображение преобразовано в ASCII');
  }

  function clearCanvas() {
    if (!confirm('Очистить весь ASCII-холст?')) return;
    pushHistory(); initializeGrid(); render(); scheduleSave(); toast('Холст очищен');
  }

  function scheduleSave() {
    $('saveStatus').textContent = 'Сохранение…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      try {
        const data = {
          version: 1,
          cols: state.cols,
          rows: state.rows,
          zoom: state.zoom,
          showGrid: state.showGrid,
          char: state.char,
          fg: state.fg,
          bg: state.bg,
          grid: state.grid,
          colors: state.colors,
          charset: $('charsetInput').value
        };
        localStorage.setItem('glyphforge.autosave', JSON.stringify(data));
        $('saveStatus').textContent = 'Сохранено локально';
      } catch {
        $('saveStatus').textContent = 'Не удалось сохранить';
      }
    }, 250);
  }

  function loadAutosave() {
    try {
      const raw = localStorage.getItem('glyphforge.autosave');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.grid) || !data.cols || !data.rows) return false;
      state.cols = data.cols; state.rows = data.rows; state.zoom = data.zoom || 1;
      state.showGrid = data.showGrid !== false; state.char = data.char || '#';
      state.fg = data.fg || state.fg; state.bg = data.bg || state.bg;
      state.grid = data.grid;
      state.colors = Array.isArray(data.colors) ? data.colors : blankColors(data.cols, data.rows, state.fg);
      $('charsetInput').value = data.charset || PRESETS.strict;
      return true;
    } catch { return false; }
  }

  let toastTimer;
  function toast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function bindEvents() {
    canvas.addEventListener('pointerdown', beginPointer);
    canvas.addEventListener('pointermove', movePointer);
    window.addEventListener('pointerup', endPointer);
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    document.querySelectorAll('.tool-button').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
    $('charInput').addEventListener('input', e => setChar(e.target.value));

    document.querySelectorAll('[data-preset]').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('[data-preset]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('charsetInput').value = PRESETS[btn.dataset.preset];
      scheduleSave();
    }));

    $('fgColor').addEventListener('input', e => { state.fg = e.target.value; scheduleSave(); updateStatus(); });
    $('bgColor').addEventListener('input', e => { state.bg = e.target.value; render(); scheduleSave(); });
    $('gridToggle').addEventListener('change', e => { state.showGrid = e.target.checked; render(); scheduleSave(); });
    $('zoomRange').addEventListener('input', e => {
      state.zoom = Number(e.target.value) / 100;
      $('zoomLabel').textContent = `${e.target.value}%`;
      resizeCanvas(); scheduleSave();
    });
    $('resizeBtn').addEventListener('click', () => resizeGrid($('colsInput').value, $('rowsInput').value, true));

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('copyBtn').addEventListener('click', copyText);
    $('exportTxtBtn').addEventListener('click', exportTxt);
    $('exportPngBtn').addEventListener('click', exportPng);
    $('clearBtn').addEventListener('click', clearCanvas);

    $('importTxtBtn').addEventListener('click', () => $('txtInput').click());
    $('txtInput').addEventListener('change', async e => {
      const file = e.target.files?.[0]; if (!file) return;
      importText(await file.text()); e.target.value = '';
    });

    $('imageInput').addEventListener('change', e => {
      const file = e.target.files?.[0]; if (file) loadImage(file);
    });
    $('convertImageBtn').addEventListener('click', convertImageToAscii);
    $('fitImageGridBtn').addEventListener('click', fitGridToImage);
    $('referenceToggle').addEventListener('change', e => { state.showReference = e.target.checked; render(); });
    $('referenceOpacity').addEventListener('input', e => {
      state.referenceOpacity = Number(e.target.value) / 100;
      $('referenceOpacityLabel').textContent = `${e.target.value}%`; render();
    });
    $('contrastRange').addEventListener('input', e => {
      state.contrast = Number(e.target.value) / 100;
      $('contrastLabel').textContent = `${e.target.value}%`;
    });
    $('invertToggle').addEventListener('change', e => state.invert = e.target.checked);
    $('sourceColorToggle').addEventListener('change', e => state.sourceColors = e.target.checked);
    $('charsetInput').addEventListener('input', scheduleSave);

    const drop = document.querySelector('.drop-zone');
    ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)'; }));
    ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, e => { e.preventDefault(); drop.style.borderColor = ''; }));
    drop.addEventListener('drop', e => {
      const file = [...(e.dataTransfer?.files || [])].find(f => f.type.startsWith('image/'));
      if (file) loadImage(file);
    });

    window.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (typing) return;
      const map = { q: 'pencil', w: 'eraser', e: 'line', r: 'rect', t: 'fill' };
      const tool = map[e.key.toLowerCase()];
      if (tool) { e.preventDefault(); setTool(tool); }
    });
  }

  function syncControls() {
    $('colsInput').value = state.cols;
    $('rowsInput').value = state.rows;
    $('zoomRange').value = Math.round(state.zoom * 100);
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
    $('gridToggle').checked = state.showGrid;
    $('fgColor').value = state.fg;
    $('bgColor').value = state.bg;
    setChar(state.char);
  }

  buildQuickPalette();
  if (!loadAutosave()) initializeGrid();
  syncControls();
  bindEvents();
  resizeCanvas();
  updateHistoryButtons();
  updateStatus();
})();

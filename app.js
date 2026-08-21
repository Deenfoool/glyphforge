(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('asciiCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const frame = $('canvasFrame');
  const crtScreen = $('crtScreen');

  const PRESETS = {
    strict: '@%#*+=-:. ',
    dense: '@#8&%$*+=-:,. ',
    tech: 'MWN8B@$0OQXKAHmwpqdbkhao*+=-:. ',
    blocks: '█▓▒░ '
  };

  const QUICK_CHARS = [
    '#', '@', '%', '&', '*', '+', '=', '-', ':', '.', '/', '\\', '|', '_',
    '(', ')', '[', ']', '{', '}', '<', '>', '0', '1', 'A', 'Z', '?', '!', '$', '^', '~', ' '
  ];

  const TOOL_LABELS = {
    pencil: 'Кисть',
    eraser: 'Ластик',
    lighten: 'Осветлить',
    darken: 'Тень',
    line: 'Линия',
    rect: 'Рамка',
    fill: 'Заливка'
  };

  const STORAGE_KEY = 'glyphforge-v02-state';
  const SETTINGS_KEY = 'glyphforge-v02-settings';

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
    brushSize: 1,
    brushShape: 'square',
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
    theme: 'night',
    fishEye: false,
    fishEyeStrength: 24,
    scanlines: true,
    glow: 45,
    saveTimer: null,
    strokeTouched: null
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
      ctx.fillStyle = hexToRgba(state.bg, 0.34);
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
      ctx.strokeStyle = state.theme === 'day'
        ? 'rgba(50, 90, 42, 0.08)'
        : 'rgba(141, 255, 0, 0.065)';
      ctx.beginPath();

      for (let x = 0; x <= state.cols; x++) {
        const px = x * cellW + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, canvas.height);
      }

      for (let y = 0; y <= state.rows; y++) {
        const py = y * cellH + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(canvas.width, py);
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
      dh = h;
      dw = h * imageRatio;
      dx = x - (dw - w) / 2;
      dy = y;
    } else {
      dw = w;
      dh = w / imageRatio;
      dx = x;
      dy = y - (dh - h) / 2;
    }

    context.drawImage(img, dx, dy, dw, dh);
  }

  function rgbToHex(r, g, b) {
    const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace('#', '');
    const normalized = value.length === 3
      ? value.split('').map(c => c + c).join('')
      : value;
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

  function inBounds(x, y) {
    return x >= 0 && x < state.cols && y >= 0 && y < state.rows;
  }

  function setCell(x, y, char = state.char, color = state.fg) {
    if (!inBounds(x, y)) return;
    state.grid[y][x] = char;
    state.colors[y][x] = color;
  }

  function densityChars() {
    let chars = Array.from($('charsetInput').value || PRESETS.strict);
    if (!chars.length) chars = Array.from(PRESETS.strict);
    if (!chars.includes(' ')) chars.push(' ');
    return chars;
  }

  function adjustDensityCell(x, y, direction) {
    if (!inBounds(x, y)) return;

    const key = `${x}:${y}`;
    if (state.strokeTouched && state.strokeTouched.has(key)) return;
    if (state.strokeTouched) state.strokeTouched.add(key);

    const chars = densityChars();
    const ch = state.grid[y][x];
    let index = chars.indexOf(ch);

    if (index === -1) {
      index = ch === ' ' ? chars.length - 1 : Math.floor((chars.length - 1) / 2);
    }

    const nextIndex = Math.max(0, Math.min(chars.length - 1, index + direction));
    state.grid[y][x] = chars[nextIndex];
    if (state.grid[y][x] !== ' ') {
      state.colors[y][x] = state.colors[y][x] || state.fg;
    }
  }

  function brushOffsets(size = state.brushSize, shape = state.brushShape) {
    const offsets = [];
    const radius = (size - 1) / 2;

    for (let oy = 0; oy < size; oy++) {
      for (let ox = 0; ox < size; ox++) {
        const dx = ox - radius;
        const dy = oy - radius;

        if (shape === 'round' && size > 1) {
          const threshold = radius + 0.35;
          if ((dx * dx + dy * dy) > threshold * threshold) continue;
        }

        offsets.push({
          x: Math.round(dx),
          y: Math.round(dy)
        });
      }
    }

    return offsets;
  }

  function applyBrushAt(cx, cy, mode = state.tool) {
    const offsets = brushOffsets();

    for (const offset of offsets) {
      const x = cx + offset.x;
      const y = cy + offset.y;
      if (!inBounds(x, y)) continue;

      if (mode === 'pencil') setCell(x, y, state.char, state.fg);
      else if (mode === 'eraser') setCell(x, y, ' ', state.fg);
      else if (mode === 'lighten') adjustDensityCell(x, y, +1);
      else if (mode === 'darken') adjustDensityCell(x, y, -1);
    }
  }

  function traceLine(a, b, callback) {
    let x0 = a.x;
    let y0 = a.y;
    const x1 = b.x;
    const y1 = b.y;
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;

    while (true) {
      callback(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  function paintStroke(a, b, mode = state.tool) {
    traceLine(a, b, (x, y) => applyBrushAt(x, y, mode));
  }

  function paintRect(a, b) {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);

    paintStroke({ x: minX, y: minY }, { x: maxX, y: minY }, 'pencil');
    paintStroke({ x: minX, y: maxY }, { x: maxX, y: maxY }, 'pencil');
    paintStroke({ x: minX, y: minY }, { x: minX, y: maxY }, 'pencil');
    paintStroke({ x: maxX, y: minY }, { x: maxX, y: maxY }, 'pencil');
  }

  function floodFill(startX, startY, replacementChar, replacementColor) {
    const targetChar = state.grid[startY][startX];
    const targetColor = state.colors[startY][startX];

    if (targetChar === replacementChar && targetColor === replacementColor) return;

    const stack = [[startX, startY]];
    const visited = new Set();

    while (stack.length) {
      const [x, y] = stack.pop();
      if (!inBounds(x, y)) continue;

      const key = `${x}:${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (state.grid[y][x] !== targetChar || state.colors[y][x] !== targetColor) continue;

      setCell(x, y, replacementChar, replacementColor);
      stack.push(
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1]
      );
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
    state.cols = snap.cols;
    state.rows = snap.rows;
    state.grid = snap.grid.map(row => [...row]);
    state.colors = snap.colors.map(row => [...row]);
    state.fg = snap.fg || state.fg;
    state.bg = snap.bg || state.bg;

    $('colsInput').value = state.cols;
    $('rowsInput').value = state.rows;
    $('fgColor').value = state.fg;
    $('bgColor').value = state.bg;

    resizeCanvas();
    updateStatus();
    scheduleSave();
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
    state.strokeTouched = new Set();
    pushHistory();

    if (['pencil', 'eraser', 'lighten', 'darken'].includes(state.tool)) {
      applyBrushAt(cell.x, cell.y);
    } else if (state.tool === 'fill') {
      floodFill(cell.x, cell.y, state.char, state.fg);
      state.isPointerDown = false;
      state.strokeTouched = null;
    }

    render();
    updateStatus();
    scheduleSave();
  }

  function movePointer(event) {
    const cell = cellFromEvent(event);
    $('cursorInfo').textContent = `x: ${cell.x} · y: ${cell.y}`;

    if (!state.isPointerDown) return;

    if (['pencil', 'eraser', 'lighten', 'darken'].includes(state.tool)) {
      if (cell.x === state.lastCell.x && cell.y === state.lastCell.y) return;
      paintStroke(state.lastCell, cell, state.tool);
      state.lastCell = cell;
      render();
      scheduleSave();
    }
  }

  function endPointer(event) {
    if (!state.isPointerDown) return;

    const cell = cellFromEvent(event);

    if (state.tool === 'line') {
      paintStroke(state.startCell, cell, 'pencil');
    } else if (state.tool === 'rect') {
      paintRect(state.startCell, cell);
    }

    state.isPointerDown = false;
    state.strokeTouched = null;
    render();
    updateStatus();
    scheduleSave();
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

    state.cols = newCols;
    state.rows = newRows;
    state.grid = nextGrid;
    state.colors = nextColors;

    $('colsInput').value = newCols;
    $('rowsInput').value = newRows;

    resizeCanvas();
    updateStatus();
    scheduleSave();
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    updateStatus();
  }

  function setChar(char) {
    state.char = sanitizeChar(char);
    $('charInput').value = state.char === ' ' ? '' : state.char;
    $('selectedCharLabel').textContent = state.char === ' ' ? 'SPACE' : state.char;

    document.querySelectorAll('.char-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.char === state.char);
    });

    updateStatus();
  }

  function setBrushSize(size) {
    let next = Math.max(1, Math.min(9, Number(size) || 1));
    if (next % 2 === 0) next += next < state.brushSize ? -1 : 1;
    state.brushSize = Math.max(1, Math.min(9, next));
    $('brushSizeRange').value = state.brushSize;
    $('brushSizeValue').textContent = state.brushSize;
    $('brushSizeLabel').textContent = `${state.brushSize} × ${state.brushSize}`;
    updateStatus();
    saveSettings();
  }

  function setBrushShape(shape) {
    state.brushShape = shape === 'round' ? 'round' : 'square';
    document.querySelectorAll('[data-brush-shape]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.brushShape === state.brushShape);
    });
    saveSettings();
  }

  function updateStatus() {
    const charLabel = state.char === ' ' ? 'SPACE' : state.char;
    $('toolStatus').textContent = `${TOOL_LABELS[state.tool]} · ${charLabel} · ${state.brushSize}×`;
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
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportTxt() {
    const blob = new Blob([gridToText()], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, 'glyphforge-art.txt');
    toast('TXT экспортирован');
  }

  function exportPng() {
    const { fontSize, cellW, cellH } = currentMetrics();
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = state.cols * cellW;
    exportCanvas.height = state.rows * cellH;
    const exportCtx = exportCanvas.getContext('2d', { alpha: false });

    exportCtx.fillStyle = state.bg;
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.textAlign = 'center';
    exportCtx.textBaseline = 'middle';
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
      if (!blob) return;
      downloadBlob(blob, 'glyphforge-art.png');
      toast('PNG экспортирован без CRT-эффектов');
    }, 'image/png');
  }

  async function copyText() {
    const text = gridToText();

    try {
      await navigator.clipboard.writeText(text);
      toast('ASCII скопирован');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('ASCII скопирован');
    }
  }

  function importText(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    const rows = Math.max(6, Math.min(160, lines.length || 6));
    const cols = Math.max(8, Math.min(240, Math.max(...lines.map(line => Array.from(line).length), 8)));

    pushHistory();

    state.cols = cols;
    state.rows = rows;
    state.grid = blankGrid(cols, rows);
    state.colors = blankColors(cols, rows);

    for (let y = 0; y < Math.min(lines.length, rows); y++) {
      const chars = Array.from(lines[y]);
      for (let x = 0; x < Math.min(chars.length, cols); x++) {
        state.grid[y][x] = chars[x];
      }
    }

    $('colsInput').value = cols;
    $('rowsInput').value = rows;
    resizeCanvas();
    updateStatus();
    scheduleSave();
    toast('TXT импортирован');
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      if (state.loadedImage && state.loadedImage.__objectUrl) {
        URL.revokeObjectURL(state.loadedImage.__objectUrl);
      }

      img.__objectUrl = url;
      state.loadedImage = img;
      state.imageName = file.name;

      $('convertImageBtn').disabled = false;
      $('fitImageGridBtn').disabled = false;
      $('referenceToggle').disabled = false;
      $('referenceOpacity').disabled = false;

      toast(`Загружено: ${file.name}`);
      render();
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('Не удалось загрузить изображение');
    };

    img.src = url;
  }

  function fitGridToImage() {
    if (!state.loadedImage) return;

    const ratio = state.loadedImage.width / state.loadedImage.height;
    let cols = Math.max(24, Math.min(180, state.cols));
    let rows = Math.round(cols / ratio * 0.53);

    if (rows > 120) {
      rows = 120;
      cols = Math.round(rows * ratio / 0.53);
    }

    resizeGrid(
      Math.max(8, Math.min(240, cols)),
      Math.max(6, Math.min(160, rows)),
      false
    );

    toast(`Сетка подогнана: ${state.cols} × ${state.rows}`);
  }

  function convertImageToAscii() {
    if (!state.loadedImage) return;

    pushHistory();

    const sample = document.createElement('canvas');
    sample.width = state.cols;
    sample.height = state.rows;
    const sampleCtx = sample.getContext('2d', { willReadFrequently: true });

    sampleCtx.fillStyle = '#fff';
    sampleCtx.fillRect(0, 0, sample.width, sample.height);
    drawImageCover(sampleCtx, state.loadedImage, 0, 0, sample.width, sample.height);

    const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;
    const chars = densityChars();
    const maxIndex = chars.length - 1;

    state.grid = blankGrid();
    state.colors = blankColors();

    for (let y = 0; y < state.rows; y++) {
      for (let x = 0; x < state.cols; x++) {
        const i = (y * state.cols + x) * 4;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];

        let luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        luminance = 0.5 + (luminance - 0.5) * state.contrast;
        luminance = Math.max(0, Math.min(1, luminance));
        if (state.invert) luminance = 1 - luminance;

        const charIndex = Math.round(luminance * maxIndex);
        state.grid[y][x] = chars[charIndex] ?? ' ';
        state.colors[y][x] = state.sourceColors ? rgbToHex(r, g, b) : state.fg;
      }
    }

    render();
    scheduleSave();
    toast('Изображение преобразовано в ASCII');
  }

  function applyTheme(theme) {
    state.theme = theme === 'day' ? 'day' : 'night';
    document.documentElement.dataset.theme = state.theme;

    document.querySelectorAll('[data-theme-value]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.themeValue === state.theme);
    });

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = state.theme === 'day' ? '#c8c6b4' : '#050806';

    render();
    saveSettings();
  }

  function applyCrtSettings() {
    const strength = Math.max(0, Math.min(100, state.fishEyeStrength));
    const glow = Math.max(0, Math.min(100, state.glow));
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty('--fisheye-radius', `${16 + strength * 0.16}px`);
    rootStyle.setProperty('--fisheye-perspective', `${1600 - strength * 6}px`);
    rootStyle.setProperty('--fisheye-tilt', `${strength * 0.012}deg`);
    rootStyle.setProperty('--fisheye-scale', String(1 - strength * 0.00055));
    rootStyle.setProperty('--fisheye-shadow', `${26 + strength * 0.8}px`);
    rootStyle.setProperty('--fisheye-shadow-soft', `${8 + strength * 0.24}px`);
    rootStyle.setProperty('--fisheye-darkness', String(0.20 + strength * 0.004));
    rootStyle.setProperty('--glow-mix', `${Math.round(glow * 0.22)}%`);
    rootStyle.setProperty('--glow-mix-soft', `${Math.round(glow * 0.11)}%`);
    rootStyle.setProperty('--glow-blur', `${(glow * 0.03).toFixed(2)}px`);

    crtScreen.classList.toggle('fisheye', state.fishEye);
    crtScreen.classList.toggle('no-scanlines', !state.scanlines);

    $('fishEyeToggle').checked = state.fishEye;
    $('fishEyeRange').value = state.fishEyeStrength;
    $('fishEyeLabel').textContent = `${state.fishEyeStrength}%`;
    $('scanlinesToggle').checked = state.scanlines;
    $('glowRange').value = state.glow;
    $('glowLabel').textContent = `${state.glow}%`;

    saveSettings();
  }

  function saveSettings() {
    const payload = {
      theme: state.theme,
      fishEye: state.fishEye,
      fishEyeStrength: state.fishEyeStrength,
      scanlines: state.scanlines,
      glow: state.glow,
      brushSize: state.brushSize,
      brushShape: state.brushShape,
      showGrid: state.showGrid,
      zoom: state.zoom
    };

    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    } catch {}
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      if (saved.theme) state.theme = saved.theme;
      if (typeof saved.fishEye === 'boolean') state.fishEye = saved.fishEye;
      if (Number.isFinite(saved.fishEyeStrength)) state.fishEyeStrength = saved.fishEyeStrength;
      if (typeof saved.scanlines === 'boolean') state.scanlines = saved.scanlines;
      if (Number.isFinite(saved.glow)) state.glow = saved.glow;
      if (Number.isFinite(saved.brushSize)) state.brushSize = saved.brushSize;
      if (saved.brushShape) state.brushShape = saved.brushShape;
      if (typeof saved.showGrid === 'boolean') state.showGrid = saved.showGrid;
      if (Number.isFinite(saved.zoom)) state.zoom = saved.zoom;
    } catch {}
  }

  function saveProject() {
    try {
      const payload = {
        cols: state.cols,
        rows: state.rows,
        grid: state.grid,
        colors: state.colors,
        fg: state.fg,
        bg: state.bg,
        char: state.char,
        charset: $('charsetInput').value
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      $('saveStatus').textContent = 'Сохранено локально';
    } catch {
      $('saveStatus').textContent = 'Не удалось сохранить';
    }
  }

  function scheduleSave() {
    $('saveStatus').textContent = 'Сохранение…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(saveProject, 220);
  }

  function loadProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.grid)) return false;

      state.cols = Math.max(8, Math.min(240, Number(saved.cols) || 80));
      state.rows = Math.max(6, Math.min(160, Number(saved.rows) || 42));
      state.grid = blankGrid();
      state.colors = blankColors();

      for (let y = 0; y < Math.min(state.rows, saved.grid.length); y++) {
        for (let x = 0; x < Math.min(state.cols, saved.grid[y].length); x++) {
          state.grid[y][x] = sanitizeChar(saved.grid[y][x]);
          state.colors[y][x] = saved.colors?.[y]?.[x] || state.fg;
        }
      }

      if (saved.fg) state.fg = saved.fg;
      if (saved.bg) state.bg = saved.bg;
      if (saved.char) state.char = sanitizeChar(saved.char);
      if (typeof saved.charset === 'string' && saved.charset.length) {
        $('charsetInput').value = saved.charset;
      }

      return true;
    } catch {
      return false;
    }
  }

  let toastTimer = null;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function confirmClear() {
    if (!state.grid.some(row => row.some(ch => ch !== ' '))) {
      toast('Холст уже пуст');
      return;
    }

    if (!window.confirm('Очистить весь холст? Это действие можно отменить.')) return;

    pushHistory();
    state.grid = blankGrid();
    state.colors = blankColors();
    render();
    scheduleSave();
    toast('Холст очищен');
  }

  function bindEvents() {
    document.querySelectorAll('.tool-button').forEach(button => {
      button.addEventListener('click', () => setTool(button.dataset.tool));
    });

    document.querySelectorAll('[data-brush-shape]').forEach(button => {
      button.addEventListener('click', () => setBrushShape(button.dataset.brushShape));
    });

    document.querySelectorAll('[data-theme-value]').forEach(button => {
      button.addEventListener('click', () => applyTheme(button.dataset.themeValue));
    });

    document.querySelectorAll('.chip').forEach(button => {
      button.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(chip => chip.classList.remove('active'));
        button.classList.add('active');
        $('charsetInput').value = PRESETS[button.dataset.preset] || PRESETS.strict;
        scheduleSave();
      });
    });

    $('charInput').addEventListener('input', event => setChar(event.target.value));
    $('fgColor').addEventListener('input', event => {
      state.fg = event.target.value;
      updateStatus();
      scheduleSave();
    });

    $('bgColor').addEventListener('input', event => {
      state.bg = event.target.value;
      render();
      scheduleSave();
    });

    $('brushSizeRange').addEventListener('input', event => setBrushSize(event.target.value));

    $('resizeBtn').addEventListener('click', () => {
      resizeGrid($('colsInput').value, $('rowsInput').value, true);
    });

    $('gridToggle').addEventListener('change', event => {
      state.showGrid = event.target.checked;
      render();
      saveSettings();
    });

    $('zoomRange').addEventListener('input', event => {
      state.zoom = Number(event.target.value) / 100;
      $('zoomLabel').textContent = `${event.target.value}%`;
      resizeCanvas();
      saveSettings();
    });

    $('fishEyeToggle').addEventListener('change', event => {
      state.fishEye = event.target.checked;
      applyCrtSettings();
    });

    $('fishEyeRange').addEventListener('input', event => {
      state.fishEyeStrength = Number(event.target.value);
      applyCrtSettings();
    });

    $('scanlinesToggle').addEventListener('change', event => {
      state.scanlines = event.target.checked;
      applyCrtSettings();
    });

    $('glowRange').addEventListener('input', event => {
      state.glow = Number(event.target.value);
      applyCrtSettings();
    });

    $('contrastRange').addEventListener('input', event => {
      state.contrast = Number(event.target.value) / 100;
      $('contrastLabel').textContent = `${event.target.value}%`;
    });

    $('invertToggle').addEventListener('change', event => {
      state.invert = event.target.checked;
    });

    $('sourceColorToggle').addEventListener('change', event => {
      state.sourceColors = event.target.checked;
    });

    $('referenceToggle').addEventListener('change', event => {
      state.showReference = event.target.checked;
      render();
    });

    $('referenceOpacity').addEventListener('input', event => {
      state.referenceOpacity = Number(event.target.value) / 100;
      $('referenceOpacityLabel').textContent = `${event.target.value}%`;
      render();
    });

    $('imageInput').addEventListener('change', event => {
      const file = event.target.files?.[0];
      loadImageFile(file);
      event.target.value = '';
    });

    $('fitImageGridBtn').addEventListener('click', fitGridToImage);
    $('convertImageBtn').addEventListener('click', convertImageToAscii);

    $('exportTxtBtn').addEventListener('click', exportTxt);
    $('exportPngBtn').addEventListener('click', exportPng);
    $('copyBtn').addEventListener('click', copyText);

    $('importTxtBtn').addEventListener('click', () => $('txtInput').click());
    $('txtInput').addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importText(reader.result);
      reader.readAsText(file, 'utf-8');
      event.target.value = '';
    });

    $('clearBtn').addEventListener('click', confirmClear);
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);

    canvas.addEventListener('pointerdown', beginPointer);
    canvas.addEventListener('pointermove', movePointer);
    window.addEventListener('pointerup', endPointer);
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    frame.addEventListener('dragover', event => {
      event.preventDefault();
    });

    frame.addEventListener('drop', event => {
      event.preventDefault();
      const file = [...event.dataTransfer.files].find(item => item.type.startsWith('image/'));
      if (file) loadImageFile(file);
    });

    document.addEventListener('keydown', event => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
        return;
      }

      if (typing) return;

      const shortcuts = {
        q: 'pencil',
        w: 'eraser',
        e: 'lighten',
        r: 'darken',
        t: 'line',
        y: 'rect',
        u: 'fill'
      };

      const key = event.key.toLowerCase();

      if (shortcuts[key]) {
        setTool(shortcuts[key]);
        return;
      }

      if (event.key === '[') {
        setBrushSize(state.brushSize - 2);
      } else if (event.key === ']') {
        setBrushSize(state.brushSize + 2);
      }
    });

    window.addEventListener('beforeunload', saveProject);
  }

  function syncUiFromState() {
    $('colsInput').value = state.cols;
    $('rowsInput').value = state.rows;
    $('fgColor').value = state.fg;
    $('bgColor').value = state.bg;

    $('gridToggle').checked = state.showGrid;
    $('zoomRange').value = Math.round(state.zoom * 100);
    $('zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;

    setChar(state.char);
    setBrushSize(state.brushSize);
    setBrushShape(state.brushShape);
    applyTheme(state.theme);
    applyCrtSettings();
    updateHistoryButtons();
  }

  function init() {
    buildQuickPalette();
    loadSettings();

    if (!loadProject()) {
      initializeGrid();
    }

    bindEvents();
    syncUiFromState();
    resizeCanvas();
    updateStatus();
    saveProject();
  }

  init();
})();

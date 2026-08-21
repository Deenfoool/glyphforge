(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const { BrushEngine, PRESETS, clamp } = window.GlyphBrushEngine;
  const canvas = $('asciiCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const frame = $('canvasFrame');
  const crtScreen = $('crtScreen');
  const previewCanvas = $('brushPreviewCanvas');
  const previewCtx = previewCanvas.getContext('2d');

  const STORAGE_KEY = 'glyphforge-v03-project';
  const SETTINGS_KEY = 'glyphforge-v03-settings';
  const CUSTOM_BRUSHES_KEY = 'glyphforge-v03-custom-brushes';
  const BRUSH_HISTORY_KEY = 'glyphforge-v03-brush-history';
  const QUICK_CHARS = ['#','@','%','&','*','+','=','-',':','.','/','\\','|','_','(',')','[',']','{','}','<','>','0','1','A','Z','?','!','$','^','~',' '];
  const TOOL_LABELS = { brush:'Кисть', eraser:'Ластик', lighten:'Осветлить', darken:'Тень', line:'Линия', rect:'Рамка', fill:'Заливка', picker:'Пипетка' };
  const LOCK_KEYS = ['size','hardness','opacity','flow','spacing','tip','roundness','angle','falloff','texture','blendMode','symmetry','seed'];

  const state = {
    cols: 80,
    rows: 42,
    zoom: 1,
    baseFont: 16,
    showGrid: true,
    showSymmetryGuides: true,
    tool: 'brush',
    char: '#',
    fg: '#8dff00',
    bg: '#050806',
    layers: [],
    activeLayerId: null,
    history: [],
    future: [],
    historyLimit: 60,
    pointerDown: false,
    pointerStart: null,
    hover: null,
    panMode: false,
    spaceDown: false,
    panStart: null,
    loadedImage: null,
    imageName: '',
    showReference: false,
    referenceOpacity: .28,
    contrast: 1,
    invert: false,
    sourceColors: false,
    theme: 'night',
    fishEye: false,
    fishEyeStrength: 24,
    scanlines: true,
    glow: 45,
    saveTimer: 0,
    currentBrushMode: 'density',
    customBrushes: {},
    brushHistory: []
  };

  const blankDensity = (c = state.cols, r = state.rows) => Array.from({ length: r }, () => Array(c).fill(0));
  const blankGlyphs = (c = state.cols, r = state.rows) => Array.from({ length: r }, () => Array(c).fill(null));
  const blankColors = (c = state.cols, r = state.rows, color = state.fg) => Array.from({ length: r }, () => Array(c).fill(color));

  let layerCounter = 0;
  const makeLayerId = () => `layer-${Date.now().toString(36)}-${(++layerCounter).toString(36)}`;

  function createLayer(name = 'Слой', options = {}) {
    return {
      id: options.id || makeLayerId(),
      name,
      visible: options.visible !== false,
      locked: Boolean(options.locked),
      opacity: clamp(Number.isFinite(options.opacity) ? options.opacity : 1),
      blendMode: options.blendMode || 'normal',
      density: options.density ? options.density.map(row => row.slice()) : blankDensity(),
      glyphs: options.glyphs ? options.glyphs.map(row => row.slice()) : blankGlyphs(),
      colors: options.colors ? options.colors.map(row => row.slice()) : blankColors()
    };
  }

  function activeLayer() {
    return state.layers.find(layer => layer.id === state.activeLayerId) || state.layers[state.layers.length - 1] || null;
  }

  function ensureLayer() {
    let layer = activeLayer();
    if (!layer) {
      layer = createLayer('Рисунок');
      state.layers = [layer];
      state.activeLayerId = layer.id;
    }
    return layer;
  }

  Object.defineProperties(state, {
    density: {
      get() { return ensureLayer().density; },
      set(value) { ensureLayer().density = value; }
    },
    glyphs: {
      get() { return ensureLayer().glyphs; },
      set(value) { ensureLayer().glyphs = value; }
    },
    colors: {
      get() { return ensureLayer().colors; },
      set(value) { ensureLayer().colors = value; }
    }
  });

  function initializeGrid() {
    if (!state.layers.length) {
      const layer = createLayer('Рисунок');
      state.layers = [layer];
      state.activeLayerId = layer.id;
    } else {
      const layer = ensureLayer();
      layer.density = blankDensity();
      layer.glyphs = blankGlyphs();
      layer.colors = blankColors();
    }
    emitLayersChanged('initialize');
  }

  function inBounds(x, y) { return x >= 0 && x < state.cols && y >= 0 && y < state.rows; }
  function sanitizeChar(v) { return Array.from(v || ' ')[0] || ' '; }
  function getCharset() { const a = Array.from($('charsetInput').value || '@%#*+=-:. '); return a.length ? a : [' ']; }
  function densityToGlyph(d) { const a = getCharset(); if (a.length === 1) return a[0]; const i = Math.round((1 - clamp(d)) * (a.length - 1)); return a[Math.max(0, Math.min(a.length - 1, i))] || ' '; }
  function densityForGlyph(g) { const a = getCharset(), i = a.indexOf(g); if (i < 0) return g === ' ' ? 0 : 1; return 1 - i / Math.max(1, a.length - 1); }
  function layerGlyph(layer, x, y) { return layer.glyphs[y]?.[x] ?? densityToGlyph(layer.density[y]?.[x] || 0); }

  function blendDensity(dst, src, alpha, mode) {
    alpha = clamp(alpha);
    src = clamp(src);
    dst = clamp(dst);
    if (alpha <= 0) return dst;
    const mixed = (() => {
      switch (mode) {
        case 'add': return clamp(dst + src);
        case 'multiply': return dst * src;
        case 'screen': return 1 - (1 - dst) * (1 - src);
        case 'max': return Math.max(dst, src);
        case 'min': return Math.min(dst, src);
        case 'difference': return Math.abs(dst - src);
        default: return src;
      }
    })();
    return clamp(dst * (1 - alpha) + mixed * alpha);
  }

  function compositeCell(x, y) {
    let density = 0;
    let glyph = null;
    let color = state.fg;
    let sourceLayerId = null;

    for (const layer of state.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const srcDensity = layer.density[y]?.[x] || 0;
      const explicitGlyph = layer.glyphs[y]?.[x] ?? null;
      const contribution = Math.max(srcDensity, explicitGlyph && explicitGlyph !== ' ' ? densityForGlyph(explicitGlyph) : 0);
      if (contribution <= .001) continue;

      density = blendDensity(density, contribution, layer.opacity, layer.blendMode);
      if (layer.opacity * contribution >= .03) {
        glyph = explicitGlyph;
        color = layer.colors[y]?.[x] || state.fg;
        sourceLayerId = layer.id;
      }
    }

    return {
      density,
      glyph: glyph ?? densityToGlyph(density),
      color,
      sourceLayerId
    };
  }

  function displayGlyph(x, y) { return compositeCell(x, y).glyph; }
  function displayColor(x, y) { return compositeCell(x, y).color; }

  function currentMetrics() {
    const fontSize = Math.max(8, Math.round(state.baseFont * state.zoom));
    return { fontSize, cellW: Math.max(6, Math.round(fontSize * .62)), cellH: Math.max(9, Math.round(fontSize * 1.12)) };
  }

  function resizeCanvas() {
    const { cellW, cellH } = currentMetrics();
    canvas.width = state.cols * cellW;
    canvas.height = state.rows * cellH;
    render();
    $('gridStatus').textContent = `${state.cols} × ${state.rows}`;
    requestBrushPreview();
  }

  function drawImageCover(c, img, x, y, w, h) {
    const ir = img.width / img.height, tr = w / h;
    let dw, dh, dx, dy;
    if (ir > tr) { dh = h; dw = h * ir; dx = x - (dw - w) / 2; dy = y; }
    else { dw = w; dh = w / ir; dx = x; dy = y - (dh - h) / 2; }
    c.drawImage(img, dx, dy, dw, dh);
  }

  function hexToRgba(hex, a) {
    const v = hex.replace('#', ''), n = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
    return `rgba(${parseInt(n.slice(0,2),16)},${parseInt(n.slice(2,4),16)},${parseInt(n.slice(4,6),16)},${a})`;
  }

  function rgbToHex(r, g, b) {
    const h = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
  }

  function canvasCompositeMode(mode) {
    return ({
      add: 'lighter',
      multiply: 'multiply',
      screen: 'screen',
      difference: 'difference'
    })[mode] || 'source-over';
  }

  function render(includeReference = true, includeGrid = true, includePreview = true) {
    const { fontSize, cellW, cellH } = currentMetrics();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (includeReference && state.loadedImage && state.showReference) {
      ctx.globalAlpha = state.referenceOpacity;
      drawImageCover(ctx, state.loadedImage, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = hexToRgba(state.bg, .34);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${fontSize}px ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace`;

    for (const layer of state.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = clamp(layer.opacity);
      ctx.globalCompositeOperation = canvasCompositeMode(layer.blendMode);
      for (let y = 0; y < state.rows; y++) {
        for (let x = 0; x < state.cols; x++) {
          const d = layer.density[y]?.[x] || 0;
          const explicit = layer.glyphs[y]?.[x] ?? null;
          if (d <= .001 && (!explicit || explicit === ' ')) continue;
          const ch = explicit ?? densityToGlyph(d);
          if (!ch || ch === ' ') continue;
          ctx.fillStyle = layer.colors[y]?.[x] || state.fg;
          ctx.fillText(ch, x * cellW + cellW / 2, y * cellH + cellH / 2 + .5);
        }
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (includeGrid && state.showGrid && state.zoom >= .65) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = state.theme === 'day' ? 'rgba(50,90,42,.08)' : 'rgba(141,255,0,.065)';
      ctx.beginPath();
      for (let x = 0; x <= state.cols; x++) { const px = x * cellW + .5; ctx.moveTo(px, 0); ctx.lineTo(px, canvas.height); }
      for (let y = 0; y <= state.rows; y++) { const py = y * cellH + .5; ctx.moveTo(0, py); ctx.lineTo(canvas.width, py); }
      ctx.stroke();
    }

    if (state.showSymmetryGuides && brush.settings.symmetry !== 'none') {
      ctx.save();
      ctx.setLineDash([5,5]);
      ctx.strokeStyle = hexToRgba(state.fg, .28);
      ctx.lineWidth = 1;
      const cx = canvas.width / 2, cy = canvas.height / 2;
      ctx.beginPath();
      if (['mirrorX','mirrorXY','radial4','radial8'].includes(brush.settings.symmetry)) { ctx.moveTo(cx,0); ctx.lineTo(cx,canvas.height); }
      if (['mirrorY','mirrorXY','radial4','radial8'].includes(brush.settings.symmetry)) { ctx.moveTo(0,cy); ctx.lineTo(canvas.width,cy); }
      if (['radial4','radial8'].includes(brush.settings.symmetry)) { ctx.moveTo(0,0); ctx.lineTo(canvas.width,canvas.height); ctx.moveTo(canvas.width,0); ctx.lineTo(0,canvas.height); }
      ctx.stroke();
      ctx.restore();
    }

    if (includePreview && state.hover && !state.panMode) drawCursorPreview(cellW, cellH);
    ctx.restore();
    emitLayersChanged('render');
  }

  function drawCursorPreview(cellW, cellH) {
    const size = Math.max(1, brush.settings.size), r = size / 2, h = brush.settings.hardness / 100;
    const minX = Math.floor(state.hover.x - r - 1), maxX = Math.ceil(state.hover.x + r + 1);
    const minY = Math.floor(state.hover.y - r - 1), maxY = Math.ceil(state.hover.y + r + 1);
    ctx.save();
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!inBounds(x, y)) continue;
      const dx = (x + .5 - state.hover.x) / r, dy = (y + .5 - state.hover.y) / r;
      let d = Math.hypot(dx, dy);
      if (brush.settings.tip === 'square') d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d > 1) continue;
      const a = clamp(Math.pow(1 - d, Math.max(.3, 3.2 - h * 2.7)) * .28, .03, .28);
      ctx.fillStyle = hexToRgba(state.fg, a);
      ctx.fillRect(x * cellW, y * cellH, cellW, cellH);
    }
    ctx.strokeStyle = hexToRgba(state.fg, .8);
    ctx.lineWidth = 1;
    ctx.strokeRect((state.hover.x - r) * cellW, (state.hover.y - r) * cellH, size * cellW, size * cellH);
    ctx.restore();
  }

  function activeLayerLocked() { return Boolean(activeLayer()?.locked); }
  function canEditActiveLayer(showMessage = false) {
    if (!activeLayerLocked()) return true;
    if (showMessage) toast('Активный слой заблокирован');
    return false;
  }

  const adapter = {
    getDimensions: () => ({ cols: state.cols, rows: state.rows }),
    inBounds,
    getCell: (x, y) => inBounds(x,y) ? { density: state.density[y][x], glyph: state.glyphs[y][x], color: state.colors[y][x] } : null,
    setCell: (x, y, c) => {
      if (!inBounds(x,y) || activeLayerLocked()) return;
      state.density[y][x] = clamp(c.density);
      state.glyphs[y][x] = c.glyph ?? null;
      state.colors[y][x] = c.color || state.fg;
    },
    getCharset,
    densityForGlyph,
    getSelectedGlyph: () => state.char,
    getBrushColor: () => state.fg,
    getEdgeStrength: (x, y) => {
      const c = state.density[y][x]; let total = 0, n = 0;
      for (let oy=-1; oy<=1; oy++) for (let ox=-1; ox<=1; ox++) {
        if (!ox && !oy) continue;
        if (inBounds(x+ox,y+oy)) { total += Math.abs(c - state.density[y+oy][x+ox]); n++; }
      }
      return n ? clamp(total / n * 2) : 0;
    },
    getOrientationGlyph: (x, y, f) => {
      const d = (xx,yy) => inBounds(xx,yy) ? state.density[yy][xx] : state.density[y][x];
      const gx = (d(x+1,y-1)+2*d(x+1,y)+d(x+1,y+1))-(d(x-1,y-1)+2*d(x-1,y)+d(x-1,y+1));
      const gy = (d(x-1,y+1)+2*d(x,y+1)+d(x+1,y+1))-(d(x-1,y-1)+2*d(x,y-1)+d(x+1,y-1));
      if (Math.hypot(gx,gy) < .08) return f;
      const a = ((Math.atan2(gy,gx)*180/Math.PI+180)%180);
      if (a < 22.5 || a >= 157.5) return '|';
      if (a < 67.5) return '/';
      if (a < 112.5) return '-';
      return '\\';
    },
    requestRender: () => { render(); scheduleSave(); }
  };

  const brush = new BrushEngine(adapter);

  function setTool(t) { state.tool=t; document.querySelectorAll('.tool-button').forEach(b=>b.classList.toggle('active',b.dataset.tool===t)); updateStatus(); }
  function effectiveMode() { if (state.tool==='eraser') return 'erase'; if (state.tool==='lighten') return 'lighten'; if (state.tool==='darken') return 'darken'; return state.currentBrushMode; }
  function withEffectiveMode(fn) { const o=brush.settings.mode; brush.settings.mode=effectiveMode(); try{return fn();} finally{brush.settings.mode=o;} }
  function setChar(v) { state.char=sanitizeChar(v); $('charInput').value=state.char; $('selectedCharLabel').textContent=state.char===' '?'␠':state.char; document.querySelectorAll('.char-button').forEach(b=>b.classList.toggle('active',b.dataset.char===state.char)); updateStatus(); scheduleSave(); }

  function buildQuickPalette() {
    const h=$('quickPalette'); h.innerHTML='';
    QUICK_CHARS.forEach(ch=>{ const b=document.createElement('button'); b.className='char-button'; b.type='button'; b.dataset.char=ch; b.textContent=ch===' '?'␠':ch; b.onclick=()=>setChar(ch); h.appendChild(b); });
  }

  function cellFromEvent(e) {
    const r=canvas.getBoundingClientRect(), sx=canvas.width/r.width, sy=canvas.height/r.height, {cellW,cellH}=currentMetrics();
    const px=(e.clientX-r.left)*sx, py=(e.clientY-r.top)*sy;
    return {x:clamp(px/cellW,0,state.cols-.001), y:clamp(py/cellH,0,state.rows-.001)};
  }

  function eventInput(e) { return { pressure:Number.isFinite(e.pressure)?e.pressure:0, tiltX:e.tiltX||0, tiltY:e.tiltY||0, pointerType:e.pointerType||'mouse' }; }

  const cloneLayerData = layer => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    density: layer.density.map(r=>r.slice()),
    glyphs: layer.glyphs.map(r=>r.slice()),
    colors: layer.colors.map(r=>r.slice())
  });

  function snapshot() {
    return { cols:state.cols, rows:state.rows, layers:state.layers.map(cloneLayerData), activeLayerId:state.activeLayerId };
  }

  function restoreSnapshot(s) {
    state.cols=s.cols; state.rows=s.rows;
    state.layers=(s.layers||[]).map(layer=>createLayer(layer.name, layer));
    state.activeLayerId=s.activeLayerId;
    ensureLayer();
    $('colsInput').value=state.cols; $('rowsInput').value=state.rows;
    resizeCanvas(); scheduleSave(); emitLayersChanged('history');
  }

  function pushHistory() { state.history.push(snapshot()); if(state.history.length>state.historyLimit) state.history.shift(); state.future=[]; updateHistoryButtons(); }
  function undo() { if(!state.history.length)return; state.future.push(snapshot()); restoreSnapshot(state.history.pop()); updateHistoryButtons(); toast('Отменено'); }
  function redo() { if(!state.future.length)return; state.history.push(snapshot()); restoreSnapshot(state.future.pop()); updateHistoryButtons(); toast('Возвращено'); }
  function updateHistoryButtons() { $('undoBtn').disabled=!state.history.length; $('redoBtn').disabled=!state.future.length; }

  function beginPointer(e) {
    if (e.button===1 || state.spaceDown) { startPan(e); return; }
    if (e.button!==0) return;
    const p=cellFromEvent(e);
    if (state.tool!=='picker' && !canEditActiveLayer(true)) return;
    state.pointerDown=true; state.pointerStart=p;
    if (state.tool!=='picker') pushHistory();
    if (state.tool==='picker') { pickAt(p); state.pointerDown=false; return; }
    if (state.tool==='fill') { floodFill(Math.floor(p.x),Math.floor(p.y)); state.pointerDown=false; render(); scheduleSave(); return; }
    if (state.tool==='line'||state.tool==='rect') return;
    withEffectiveMode(()=>brush.begin(p,eventInput(e))); render();
  }

  function movePointer(e) {
    const p=cellFromEvent(e); state.hover=p;
    $('cursorInfo').textContent=`x: ${Math.floor(p.x)} · y: ${Math.floor(p.y)} · p:${Math.round((e.pressure||0)*100)}%`;
    if(state.panMode){movePan(e);return;}
    if(state.pointerDown&&!['line','rect','fill','picker'].includes(state.tool)){withEffectiveMode(()=>brush.move(p,eventInput(e)));scheduleSave();}
    render();
  }

  function endPointer(e) {
    if(state.panMode){endPan();return;}
    if(!state.pointerDown)return;
    const p=cellFromEvent(e);
    if(state.tool==='line')drawLineTool(state.pointerStart,p,eventInput(e));
    else if(state.tool==='rect')drawRectTool(state.pointerStart,p,eventInput(e));
    else if(!['fill','picker'].includes(state.tool))withEffectiveMode(()=>brush.end(p,eventInput(e)));
    state.pointerDown=false;state.pointerStart=null;render();scheduleSave();updateHistoryButtons();
  }

  function drawLineTool(a,b,input){const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy),steps=Math.max(1,Math.ceil(dist*2));withEffectiveMode(()=>{for(let i=0;i<=steps;i++)brush.stamp({x:a.x+dx*i/steps,y:a.y+dy*i/steps},input);});}
  function drawRectTool(a,b,input){const x1=Math.min(a.x,b.x),x2=Math.max(a.x,b.x),y1=Math.min(a.y,b.y),y2=Math.max(a.y,b.y);drawLineTool({x:x1,y:y1},{x:x2,y:y1},input);drawLineTool({x:x2,y:y1},{x:x2,y:y2},input);drawLineTool({x:x2,y:y2},{x:x1,y:y2},input);drawLineTool({x:x1,y:y2},{x:x1,y:y1},input);}

  function floodFill(sx,sy){
    if(!inBounds(sx,sy)||!canEditActiveLayer(true))return;
    const target=state.density[sy][sx],visited=new Set(),q=[[sx,sy]],mode=effectiveMode();
    while(q.length&&visited.size<state.cols*state.rows){const[x,y]=q.shift(),key=`${x},${y}`;if(visited.has(key)||!inBounds(x,y)||Math.abs(state.density[y][x]-target)>.05)continue;visited.add(key);if(mode==='erase'||mode==='lighten'){state.density[y][x]=0;state.glyphs[y][x]=null;}else if(mode==='normal'){state.density[y][x]=densityForGlyph(state.char);state.glyphs[y][x]=state.char;state.colors[y][x]=state.fg;}else{state.density[y][x]=1;state.glyphs[y][x]=null;state.colors[y][x]=state.fg;}q.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
  }

  function pickAt(p){const x=Math.floor(p.x),y=Math.floor(p.y);if(!inBounds(x,y))return;const cell=compositeCell(x,y);setChar(cell.glyph);state.fg=cell.color||state.fg;$('fgColor').value=state.fg;toast('Символ и цвет взяты со сведённого изображения');}

  function startPan(e){state.panMode=true;state.panStart={x:e.clientX,y:e.clientY,left:frame.scrollLeft,top:frame.scrollTop};canvas.style.cursor='grabbing';e.preventDefault();}
  function movePan(e){if(!state.panStart)return;frame.scrollLeft=state.panStart.left-(e.clientX-state.panStart.x);frame.scrollTop=state.panStart.top-(e.clientY-state.panStart.y);}
  function endPan(){state.panMode=false;state.panStart=null;canvas.style.cursor='crosshair';}

  function resizeLayer(layer, cols, rows, oldCols, oldRows) {
    const nd=blankDensity(cols,rows),ng=blankGlyphs(cols,rows),nc=blankColors(cols,rows);
    for(let y=0;y<Math.min(rows,oldRows);y++)for(let x=0;x<Math.min(cols,oldCols);x++){
      nd[y][x]=layer.density[y]?.[x]||0;
      ng[y][x]=layer.glyphs[y]?.[x]??null;
      nc[y][x]=layer.colors[y]?.[x]||state.fg;
    }
    layer.density=nd;layer.glyphs=ng;layer.colors=nc;
  }

  function resizeGrid(cols,rows,preserve=true){
    cols=Math.max(8,Math.min(360,Number(cols)||80));rows=Math.max(6,Math.min(240,Number(rows)||42));
    if(preserve)pushHistory();
    const oldCols=state.cols,oldRows=state.rows;
    state.layers.forEach(layer=>resizeLayer(layer,cols,rows,oldCols,oldRows));
    state.cols=cols;state.rows=rows;$('colsInput').value=cols;$('rowsInput').value=rows;resizeCanvas();scheduleSave();emitLayersChanged('resize');
  }

  function loadImageFile(file){if(!file||!file.type.startsWith('image/'))return;const url=URL.createObjectURL(file),img=new Image();img.onload=()=>{if(state.loadedImage?.__url)URL.revokeObjectURL(state.loadedImage.__url);img.__url=url;state.loadedImage=img;state.imageName=file.name;$('convertImageBtn').disabled=false;$('fitImageGridBtn').disabled=false;$('referenceToggle').disabled=false;$('referenceOpacity').disabled=false;toast(`Загружено: ${file.name}`);render();};img.onerror=()=>{URL.revokeObjectURL(url);toast('Не удалось загрузить изображение');};img.src=url;}
  function fitGridToImage(){if(!state.loadedImage)return;const ratio=state.loadedImage.width/state.loadedImage.height;let cols=Math.max(24,Math.min(220,state.cols)),rows=Math.round(cols/ratio*.53);if(rows>180){rows=180;cols=Math.round(rows*ratio/.53);}resizeGrid(cols,rows,true);toast(`Сетка: ${state.cols} × ${state.rows}`);}
  function convertImageToAscii(){if(!state.loadedImage||!canEditActiveLayer(true))return;pushHistory();const sample=document.createElement('canvas');sample.width=state.cols;sample.height=state.rows;const s=sample.getContext('2d',{willReadFrequently:true});s.fillStyle='#fff';s.fillRect(0,0,sample.width,sample.height);drawImageCover(s,state.loadedImage,0,0,sample.width,sample.height);const px=s.getImageData(0,0,sample.width,sample.height).data;state.density=blankDensity();state.glyphs=blankGlyphs();state.colors=blankColors();for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){const i=(y*state.cols+x)*4,r=px[i],g=px[i+1],b=px[i+2];let lum=(.2126*r+.7152*g+.0722*b)/255;lum=.5+(lum-.5)*state.contrast;lum=clamp(lum);if(state.invert)lum=1-lum;state.density[y][x]=1-lum;state.colors[y][x]=state.sourceColors?rgbToHex(r,g,b):state.fg;}render();scheduleSave();toast(`Изображение помещено в слой «${activeLayer().name}»`);}

  function exportText(){const lines=[];for(let y=0;y<state.rows;y++){let line='';for(let x=0;x<state.cols;x++)line+=displayGlyph(x,y);lines.push(line.replace(/\s+$/,''));}return lines.join('\n').replace(/\n+$/,'');}
  function download(name,content,type='text/plain;charset=utf-8'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
  async function copyText(){const text=exportText();try{await navigator.clipboard.writeText(text);toast('ASCII скопирован');}catch{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();toast('ASCII скопирован');}}
  function exportTxt(){download('glyphforge-art.txt',exportText());}
  function exportPng(){const old=state.hover;state.hover=null;render(false,false,false);const url=canvas.toDataURL('image/png'),a=document.createElement('a');a.href=url;a.download='glyphforge-art.png';a.click();state.hover=old;render();}

  function importText(text){
    if(!canEditActiveLayer(true))return;
    const lines=String(text).replace(/\r/g,'').split('\n'),rows=Math.max(6,Math.min(240,lines.length||6)),cols=Math.max(8,Math.min(360,Math.max(...lines.map(l=>Array.from(l).length),8)));
    pushHistory();
    const oldCols=state.cols,oldRows=state.rows;
    state.layers.forEach(layer=>resizeLayer(layer,cols,rows,oldCols,oldRows));
    state.cols=cols;state.rows=rows;
    state.density=blankDensity();state.glyphs=blankGlyphs();state.colors=blankColors();
    for(let y=0;y<Math.min(rows,lines.length);y++){const chars=Array.from(lines[y]);for(let x=0;x<Math.min(cols,chars.length);x++){state.glyphs[y][x]=chars[x];state.density[y][x]=densityForGlyph(chars[x]);state.colors[y][x]=state.fg;}}
    $('colsInput').value=cols;$('rowsInput').value=rows;resizeCanvas();scheduleSave();toast(`TXT импортирован в слой «${activeLayer().name}»`);
  }

  function normalizedLayerFromProject(layer) {
    return createLayer(layer.name || 'Слой', {
      ...layer,
      opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
      blendMode: layer.blendMode || 'normal',
      density: Array.isArray(layer.density) ? layer.density : blankDensity(),
      glyphs: Array.isArray(layer.glyphs) ? layer.glyphs : blankGlyphs(),
      colors: Array.isArray(layer.colors) ? layer.colors : blankColors()
    });
  }

  function serializeProject(){
    return JSON.stringify({
      format:'glyphforge',version:4,cols:state.cols,rows:state.rows,
      layers:state.layers.map(cloneLayerData),activeLayerId:state.activeLayerId,
      fg:state.fg,bg:state.bg,charset:$('charsetInput').value,brush:brush.settings,theme:state.theme
    },null,2);
  }
  function exportProject(){download('drawing.glyph',serializeProject(),'application/json');}

  function applyProjectData(p) {
    state.cols=Math.max(8,Math.min(360,p.cols||80));state.rows=Math.max(6,Math.min(240,p.rows||42));
    if(Array.isArray(p.layers)&&p.layers.length){state.layers=p.layers.map(normalizedLayerFromProject);state.activeLayerId=p.activeLayerId&&state.layers.some(l=>l.id===p.activeLayerId)?p.activeLayerId:state.layers[state.layers.length-1].id;}
    else {const layer=createLayer('Рисунок',{density:Array.isArray(p.density)?p.density:blankDensity(),glyphs:Array.isArray(p.glyphs)?p.glyphs:blankGlyphs(),colors:Array.isArray(p.colors)?p.colors:blankColors()});state.layers=[layer];state.activeLayerId=layer.id;}
    state.fg=p.fg||state.fg;state.bg=p.bg||state.bg;if(p.charset)$('charsetInput').value=p.charset;if(p.brush)brush.setSettings(p.brush);if(p.theme)state.theme=p.theme;ensureLayer();
  }

  function importProjectText(text){try{const p=JSON.parse(text);if(p.format!=='glyphforge')throw 0;pushHistory();applyProjectData(p);syncUi();resizeCanvas();scheduleSave();emitLayersChanged('project');toast('Проект открыт');}catch{toast('Неверный .glyph файл');}}

  function customBrushesLoad(){try{state.customBrushes=JSON.parse(localStorage.getItem(CUSTOM_BRUSHES_KEY)||'{}');}catch{state.customBrushes={};}}
  function brushHistoryLoad(){try{state.brushHistory=JSON.parse(localStorage.getItem(BRUSH_HISTORY_KEY)||'[]');}catch{state.brushHistory=[];}}
  function recordBrushHistory(name='Recent'){const snap={name,settings:{...brush.settings,locked:{...brush.settings.locked}},at:Date.now()};state.brushHistory=[snap,...state.brushHistory.filter(x=>JSON.stringify(x.settings)!==JSON.stringify(snap.settings))].slice(0,10);try{localStorage.setItem(BRUSH_HISTORY_KEY,JSON.stringify(state.brushHistory));}catch{}renderBrushHistory();}
  function renderBrushHistory(){const h=$('brushHistory');h.innerHTML='';state.brushHistory.slice(0,8).forEach((item,i)=>{const b=document.createElement('button');b.className='history-chip';b.textContent=item.name||`#${i+1}`;b.onclick=()=>{brush.setSettings(item.settings);syncBrushUi();requestBrushPreview();toast('Кисть восстановлена');};h.appendChild(b);});}
  function populatePresets(){const s=$('brushPresetSelect');s.innerHTML='';Object.keys(PRESETS).forEach(name=>{const o=document.createElement('option');o.value=`builtin:${name}`;o.textContent=name;s.appendChild(o);});Object.keys(state.customBrushes).forEach(name=>{const o=document.createElement('option');o.value=`custom:${name}`;o.textContent=`★ ${name}`;s.appendChild(o);});}
  function applySelectedPreset(){const v=$('brushPresetSelect').value;if(v.startsWith('builtin:'))brush.applyPreset(v.slice(8));else if(v.startsWith('custom:')){const p=state.customBrushes[v.slice(7)];if(p){const locked=brush.settings.locked||{},patch={};Object.entries(p).forEach(([k,val])=>{if(!locked[k])patch[k]=val;});brush.setSettings(patch);}}syncBrushUi();recordBrushHistory(v.split(':')[1]);requestBrushPreview();toast('Пресет применён');}
  function saveCustomBrush(){const name=prompt('Название кисти:','My Brush');if(!name)return;state.customBrushes[name]={...brush.settings,locked:{...brush.settings.locked}};localStorage.setItem(CUSTOM_BRUSHES_KEY,JSON.stringify(state.customBrushes));populatePresets();$('brushPresetSelect').value=`custom:${name}`;recordBrushHistory(name);toast('Кисть сохранена');}
  function deleteCustomBrush(){const v=$('brushPresetSelect').value;if(!v.startsWith('custom:'))return toast('Выбран встроенный пресет');delete state.customBrushes[v.slice(7)];localStorage.setItem(CUSTOM_BRUSHES_KEY,JSON.stringify(state.customBrushes));populatePresets();toast('Кисть удалена');}
  function exportBrush(){download('brush.gbrush',JSON.stringify({format:'glyphforge-brush',version:1,settings:brush.settings},null,2),'application/json');}
  function importBrushText(text){try{const p=JSON.parse(text);if(p.format!=='glyphforge-brush'||!p.settings)throw 0;brush.setSettings(p.settings);syncBrushUi();recordBrushHistory('Imported');requestBrushPreview();toast('Кисть импортирована');}catch{toast('Неверный .gbrush файл');}}

  function updateStatus(){const layer=activeLayer();$('toolStatus').textContent=`${TOOL_LABELS[state.tool]} · ${state.char===' '?'␠':state.char}`;$('brushStatus').textContent=`${brush.settings.size}px · H${brush.settings.hardness} · Flow${brush.settings.flow}${layer?` · ${layer.name}`:''}`;}
  function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove('show'),1800);}

  function applyTheme(theme){state.theme=theme==='day'?'day':'night';document.documentElement.dataset.theme=state.theme;document.querySelectorAll('[data-theme-value]').forEach(b=>b.classList.toggle('active',b.dataset.themeValue===state.theme));const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=state.theme==='day'?'#c8c6b4':'#050806';render();saveSettings();}
  function applyCrt(){const glow=clamp(state.glow/100);document.documentElement.style.setProperty('--glow-mix',`${Math.round(glow*22)}%`);document.documentElement.style.setProperty('--glow-mix-soft',`${Math.round(glow*11)}%`);document.documentElement.style.setProperty('--glow-blur',`${(glow*3).toFixed(2)}px`);crtScreen.classList.toggle('fisheye',state.fishEye);crtScreen.classList.toggle('no-scanlines',!state.scanlines);$('fishEyeToggle').checked=state.fishEye;$('fishEyeRange').value=state.fishEyeStrength;$('fishEyeLabel').textContent=`${state.fishEyeStrength}%`;$('scanlinesToggle').checked=state.scanlines;$('glowRange').value=state.glow;$('glowLabel').textContent=`${state.glow}%`;saveSettings();}
  function saveSettings(){try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({theme:state.theme,fishEye:state.fishEye,fishEyeStrength:state.fishEyeStrength,scanlines:state.scanlines,glow:state.glow,showGrid:state.showGrid,showSymmetryGuides:state.showSymmetryGuides,zoom:state.zoom,brush:brush.settings,currentBrushMode:state.currentBrushMode}));}catch{}}
  function loadSettings(){try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(!s)return;if(s.theme)state.theme=s.theme;if(typeof s.fishEye==='boolean')state.fishEye=s.fishEye;if(Number.isFinite(s.fishEyeStrength))state.fishEyeStrength=s.fishEyeStrength;if(typeof s.scanlines==='boolean')state.scanlines=s.scanlines;if(Number.isFinite(s.glow))state.glow=s.glow;if(typeof s.showGrid==='boolean')state.showGrid=s.showGrid;if(typeof s.showSymmetryGuides==='boolean')state.showSymmetryGuides=s.showSymmetryGuides;if(Number.isFinite(s.zoom))state.zoom=s.zoom;if(s.brush)brush.setSettings(s.brush);if(s.currentBrushMode)state.currentBrushMode=s.currentBrushMode;}catch{}}
  function saveProjectLocal(){try{localStorage.setItem(STORAGE_KEY,serializeProject());$('saveStatus').textContent='Сохранено локально';}catch{$('saveStatus').textContent='Не удалось сохранить';}}
  function scheduleSave(){$('saveStatus').textContent='Сохранение…';clearTimeout(state.saveTimer);state.saveTimer=setTimeout(()=>{saveProjectLocal();saveSettings();},220);}
  function loadProjectLocal(){try{const p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(!p||p.format!=='glyphforge')return false;if(!Array.isArray(p.layers)&&!Array.isArray(p.density))return false;applyProjectData(p);return true;}catch{return false;}}

  const LABEL_FORMAT={size:v=>v,hardness:v=>`${v}%`,customFalloff:v=>`${v}%`,opacity:v=>`${v}%`,flow:v=>`${v}%`,spacing:v=>`${v}%`,smoothing:v=>`${v}%`,stabilizer:v=>`${v}%`,buildUpRate:v=>`${v}%`,roundness:v=>`${v}%`,angle:v=>`${v}°`,sizeJitter:v=>`${v}%`,minDiameter:v=>`${v}%`,angleJitter:v=>`${v}%`,roundnessJitter:v=>`${v}%`,scatterX:v=>`${v}%`,scatterY:v=>`${v}%`,count:v=>v,countJitter:v=>`${v}%`,glyphJitter:v=>`${v}%`,densityJitter:v=>`${v}%`,colorJitter:v=>`${v}%`,speedSize:v=>`${v}%`,speedDensity:v=>`${v}%`,textureScale:v=>v,textureStrength:v=>`${v}%`,dualSize:v=>`${v}%`,preserveDetail:v=>`${v}%`,edgeStrength:v=>`${v}%`,lightAngle:v=>`${v}°`};
  function updateBrushSettingFromElement(el){const key=el.dataset.brushKey;if(!key)return;let value;if(el.type==='checkbox')value=el.checked;else if(el.type==='range'||el.type==='number')value=Number(el.value);else value=el.value;brush.setSettings({[key]:value});const l=$(key+'Value');if(l)l.textContent=(LABEL_FORMAT[key]||String)(value);updateStatus();requestBrushPreview();render();saveSettings();}
  function syncBrushUi(){document.querySelectorAll('[data-brush-key]').forEach(el=>{const key=el.dataset.brushKey,val=brush.settings[key];if(val===undefined)return;if(el.type==='checkbox')el.checked=!!val;else el.value=String(val);const l=$(key+'Value');if(l)l.textContent=(LABEL_FORMAT[key]||String)(val);});$('brushMode').value=state.currentBrushMode=brush.settings.mode||state.currentBrushMode;$('blendMode').value=brush.settings.blendMode;updateStatus();renderLockGrid();}
  function renderLockGrid(){const h=$('lockGrid');h.innerHTML='';LOCK_KEYS.forEach(key=>{const l=document.createElement('label');l.className='lock-item';const i=document.createElement('input');i.type='checkbox';i.checked=!!brush.settings.locked?.[key];i.onchange=()=>{brush.settings.locked={...(brush.settings.locked||{}),[key]:i.checked};saveSettings();};l.append(i,document.createTextNode(`🔒 ${key}`));h.appendChild(l);});}

  let previewRaf=0;
  function requestBrushPreview(){if(previewRaf)return;previewRaf=requestAnimationFrame(drawBrushPreview);}
  function drawBrushPreview(){previewRaf=0;const w=previewCanvas.width,h=previewCanvas.height;previewCtx.fillStyle=state.bg;previewCtx.fillRect(0,0,w,h);const m=brush.previewMatrix(17),cw=w/17,ch=h/17;previewCtx.textAlign='center';previewCtx.textBaseline='middle';previewCtx.font=`bold ${Math.floor(ch*.75)}px monospace`;for(let y=0;y<17;y++)for(let x=0;x<17;x++){const d=m[y][x];if(d<=.02)continue;previewCtx.fillStyle=hexToRgba(state.fg,.25+d*.75);previewCtx.fillText(densityToGlyph(d),x*cw+cw/2,y*ch+ch/2);}previewCtx.strokeStyle=hexToRgba(state.fg,.25);previewCtx.strokeRect(.5,.5,w-1,h-1);}

  function confirmClear(){if(!canEditActiveLayer(true))return;if(!state.density.some(r=>r.some(v=>v>.001))&&!state.glyphs.some(r=>r.some(v=>v&&v!==' ')))return toast('Активный слой уже пуст');if(!confirm(`Очистить слой «${activeLayer().name}»?`))return;pushHistory();initializeGrid();render();scheduleSave();toast('Слой очищен');}

  function bindBrushInputs(){document.querySelectorAll('[data-brush-key]').forEach(el=>{const ev=el.type==='range'?'input':'change';el.addEventListener(ev,()=>updateBrushSettingFromElement(el));if(el.tagName==='TEXTAREA')el.addEventListener('input',()=>updateBrushSettingFromElement(el));});$('brushMode').addEventListener('change',e=>{state.currentBrushMode=e.target.value;brush.setSettings({mode:e.target.value});recordBrushHistory('Mode');updateStatus();requestBrushPreview();saveSettings();});$('blendMode').addEventListener('change',e=>{brush.setSettings({blendMode:e.target.value});requestBrushPreview();saveSettings();});}

  function bindEvents(){
    document.querySelectorAll('.tool-button').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
    document.querySelectorAll('[data-theme-value]').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeValue));
    document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');$('charsetInput').value=b.dataset.charset;render();requestBrushPreview();scheduleSave();});
    $('charsetInput').addEventListener('input',()=>{render();requestBrushPreview();scheduleSave();});
    $('charInput').oninput=e=>setChar(e.target.value);
    $('fgColor').oninput=e=>{state.fg=e.target.value;render();requestBrushPreview();scheduleSave();};
    $('bgColor').oninput=e=>{state.bg=e.target.value;render();requestBrushPreview();scheduleSave();};
    $('resizeBtn').onclick=()=>resizeGrid($('colsInput').value,$('rowsInput').value,true);
    $('gridToggle').onchange=e=>{state.showGrid=e.target.checked;render();saveSettings();};
    $('symmetryGuideToggle').onchange=e=>{state.showSymmetryGuides=e.target.checked;render();saveSettings();};
    $('zoomRange').oninput=e=>{state.zoom=Number(e.target.value)/100;$('zoomLabel').textContent=`${e.target.value}%`;resizeCanvas();saveSettings();};
    $('fishEyeToggle').onchange=e=>{state.fishEye=e.target.checked;applyCrt();};
    $('fishEyeRange').oninput=e=>{state.fishEyeStrength=Number(e.target.value);applyCrt();};
    $('scanlinesToggle').onchange=e=>{state.scanlines=e.target.checked;applyCrt();};
    $('glowRange').oninput=e=>{state.glow=Number(e.target.value);applyCrt();};
    $('contrastRange').oninput=e=>{state.contrast=Number(e.target.value)/100;$('contrastLabel').textContent=`${e.target.value}%`;};
    $('invertToggle').onchange=e=>state.invert=e.target.checked;
    $('sourceColorToggle').onchange=e=>state.sourceColors=e.target.checked;
    $('referenceToggle').onchange=e=>{state.showReference=e.target.checked;render();};
    $('referenceOpacity').oninput=e=>{state.referenceOpacity=Number(e.target.value)/100;$('referenceOpacityLabel').textContent=`${e.target.value}%`;render();};
    $('imageInput').onchange=e=>{loadImageFile(e.target.files?.[0]);e.target.value='';};
    $('fitImageGridBtn').onclick=fitGridToImage;$('convertImageBtn').onclick=convertImageToAscii;
    $('undoBtn').onclick=undo;$('redoBtn').onclick=redo;$('copyBtn').onclick=copyText;$('exportPngBtn').onclick=exportPng;$('exportTxtBtn').onclick=exportTxt;$('clearBtn').onclick=confirmClear;
    $('importTxtBtn').onclick=()=>$('txtInput').click();$('txtInput').onchange=e=>{const f=e.target.files?.[0];if(!f)return;f.text().then(importText);e.target.value='';};
    $('exportProjectBtn').onclick=exportProject;$('importProjectBtn').onclick=()=>$('projectInput').click();$('projectInput').onchange=e=>{const f=e.target.files?.[0];if(!f)return;f.text().then(importProjectText);e.target.value='';};
    $('exportBrushBtn').onclick=exportBrush;$('importBrushBtn').onclick=()=>$('brushFileInput').click();$('brushFileInput').onchange=e=>{const f=e.target.files?.[0];if(!f)return;f.text().then(importBrushText);e.target.value='';};
    $('saveBrushBtn').onclick=saveCustomBrush;$('applyBrushPresetBtn').onclick=applySelectedPreset;$('deleteCustomBrushBtn').onclick=deleteCustomBrush;
    canvas.addEventListener('pointerdown',beginPointer);canvas.addEventListener('pointermove',movePointer);canvas.addEventListener('pointerleave',()=>{state.hover=null;render();});window.addEventListener('pointerup',endPointer);canvas.addEventListener('contextmenu',e=>e.preventDefault());
    frame.addEventListener('wheel',e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();const next=clamp(Math.round(state.zoom*100+(e.deltaY<0?10:-10)),45,220);state.zoom=next/100;$('zoomRange').value=next;$('zoomLabel').textContent=`${next}%`;resizeCanvas();saveSettings();}},{passive:false});
    frame.addEventListener('dragover',e=>e.preventDefault());frame.addEventListener('drop',e=>{e.preventDefault();const f=[...e.dataTransfer.files].find(x=>x.type.startsWith('image/'));if(f)loadImageFile(f);});
    document.addEventListener('keydown',e=>{const typing=e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}if(typing)return;if(e.code==='Space'){state.spaceDown=true;e.preventDefault();}const map={q:'brush',w:'eraser',e:'lighten',r:'darken',t:'line',y:'rect',u:'fill',i:'picker'};if(map[e.key.toLowerCase()])setTool(map[e.key.toLowerCase()]);if(e.key==='['){brush.setSettings({size:Math.max(1,brush.settings.size-2)});syncBrushUi();requestBrushPreview();}if(e.key===']'){brush.setSettings({size:Math.min(81,brush.settings.size+2)});syncBrushUi();requestBrushPreview();}});
    document.addEventListener('keyup',e=>{if(e.code==='Space')state.spaceDown=false;});window.addEventListener('beforeunload',saveProjectLocal);bindBrushInputs();
  }

  function syncUi(){$('colsInput').value=state.cols;$('rowsInput').value=state.rows;$('fgColor').value=state.fg;$('bgColor').value=state.bg;$('gridToggle').checked=state.showGrid;$('symmetryGuideToggle').checked=state.showSymmetryGuides;$('zoomRange').value=Math.round(state.zoom*100);$('zoomLabel').textContent=`${Math.round(state.zoom*100)}%`;setChar(state.char);syncBrushUi();applyTheme(state.theme);applyCrt();updateHistoryButtons();updateStatus();}

  // ---------------- Layer Engine API ----------------
  function emitLayersChanged(reason='change') {
    window.dispatchEvent(new CustomEvent('glyphforge:layers-changed', { detail: { reason, activeLayerId: state.activeLayerId } }));
  }

  function layerMeta(layer) {
    return { id:layer.id,name:layer.name,visible:layer.visible,locked:layer.locked,opacity:layer.opacity,blendMode:layer.blendMode,active:layer.id===state.activeLayerId };
  }

  function selectLayer(id) {
    if (!state.layers.some(layer=>layer.id===id)) return false;
    state.activeLayerId=id;updateStatus();render();scheduleSave();emitLayersChanged('select');return true;
  }

  function addLayer(name='Новый слой') {
    pushHistory();
    const layer=createLayer(name);
    const activeIndex=state.layers.findIndex(l=>l.id===state.activeLayerId);
    state.layers.splice(activeIndex<0?state.layers.length:activeIndex+1,0,layer);
    state.activeLayerId=layer.id;render();scheduleSave();emitLayersChanged('add');toast(`Создан слой «${layer.name}»`);return layer.id;
  }

  function duplicateLayer(id=state.activeLayerId) {
    const source=state.layers.find(l=>l.id===id);if(!source)return null;pushHistory();
    const copy=createLayer(`${source.name} копия`,source);copy.id=makeLayerId();copy.locked=false;
    const index=state.layers.indexOf(source);state.layers.splice(index+1,0,copy);state.activeLayerId=copy.id;render();scheduleSave();emitLayersChanged('duplicate');toast('Слой дублирован');return copy.id;
  }

  function deleteLayer(id=state.activeLayerId) {
    const index=state.layers.findIndex(l=>l.id===id);if(index<0)return false;
    if(state.layers.length===1){if(!confirm('Это последний слой. Очистить его вместо удаления?'))return false;pushHistory();state.activeLayerId=id;initializeGrid();render();scheduleSave();return true;}
    pushHistory();const [removed]=state.layers.splice(index,1);const next=state.layers[Math.min(index,state.layers.length-1)];state.activeLayerId=next.id;render();scheduleSave();emitLayersChanged('delete');toast(`Слой «${removed.name}» удалён`);return true;
  }

  function renameLayer(id,name) { const layer=state.layers.find(l=>l.id===id);if(!layer)return false;name=String(name||'').trim();if(!name)return false;pushHistory();layer.name=name.slice(0,80);scheduleSave();emitLayersChanged('rename');updateStatus();return true; }
  function toggleLayerVisibility(id) { const layer=state.layers.find(l=>l.id===id);if(!layer)return false;pushHistory();layer.visible=!layer.visible;render();scheduleSave();emitLayersChanged('visibility');return layer.visible; }
  function toggleLayerLock(id) { const layer=state.layers.find(l=>l.id===id);if(!layer)return false;layer.locked=!layer.locked;scheduleSave();emitLayersChanged('lock');return layer.locked; }
  function setLayerOpacity(id,value) { const layer=state.layers.find(l=>l.id===id);if(!layer)return false;layer.opacity=clamp(Number(value));render();scheduleSave();emitLayersChanged('opacity');return true; }
  function setLayerBlendMode(id,mode) { const layer=state.layers.find(l=>l.id===id);if(!layer)return false;const allowed=['normal','add','multiply','screen','max','min','difference'];layer.blendMode=allowed.includes(mode)?mode:'normal';render();scheduleSave();emitLayersChanged('blend');return true; }

  function moveLayer(id,toIndex) {
    const from=state.layers.findIndex(l=>l.id===id);if(from<0)return false;toIndex=Math.max(0,Math.min(state.layers.length-1,Number(toIndex)));if(from===toIndex)return true;pushHistory();const [layer]=state.layers.splice(from,1);state.layers.splice(toIndex,0,layer);render();scheduleSave();emitLayersChanged('reorder');return true;
  }

  function mergeDown(id=state.activeLayerId) {
    const index=state.layers.findIndex(l=>l.id===id);if(index<=0)return false;const top=state.layers[index],bottom=state.layers[index-1];if(top.locked||bottom.locked){toast('Сначала разблокируй объединяемые слои');return false;}pushHistory();
    for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){
      const td=top.density[y][x]||0,tg=top.glyphs[y][x]??null,contribution=Math.max(td,tg&&tg!==' '?densityForGlyph(tg):0);
      if(contribution<=.001)continue;
      bottom.density[y][x]=blendDensity(bottom.density[y][x]||0,contribution,top.opacity,top.blendMode);
      if(top.opacity*contribution>.08){bottom.glyphs[y][x]=tg;bottom.colors[y][x]=top.colors[y][x]||bottom.colors[y][x]||state.fg;}
    }
    state.layers.splice(index,1);state.activeLayerId=bottom.id;render();scheduleSave();emitLayersChanged('merge');toast('Слои объединены');return true;
  }

  function flattenLayers() {
    if(state.layers.length<=1)return false;if(!confirm('Свести все видимые слои в один?'))return false;pushHistory();const merged=createLayer('Сведённое изображение');
    for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){const cell=compositeCell(x,y);merged.density[y][x]=cell.density;merged.glyphs[y][x]=cell.glyph===' '?null:cell.glyph;merged.colors[y][x]=cell.color;}
    state.layers=[merged];state.activeLayerId=merged.id;render();scheduleSave();emitLayersChanged('flatten');toast('Слои сведены');return true;
  }

  function layerThumbnail(id,width=46,height=30) {
    const layer=state.layers.find(l=>l.id===id);if(!layer)return '';
    const c=document.createElement('canvas');c.width=width;c.height=height;const cctx=c.getContext('2d');cctx.fillStyle=state.bg;cctx.fillRect(0,0,width,height);
    const sx=state.cols/width,sy=state.rows/height;
    for(let py=0;py<height;py++)for(let px=0;px<width;px++){
      const x=Math.min(state.cols-1,Math.floor(px*sx)),y=Math.min(state.rows-1,Math.floor(py*sy));const d=layer.density[y]?.[x]||0;const g=layer.glyphs[y]?.[x];const amount=Math.max(d,g&&g!==' '?densityForGlyph(g):0);if(amount<=.02)continue;cctx.globalAlpha=Math.max(.14,amount);cctx.fillStyle=layer.colors[y]?.[x]||state.fg;cctx.fillRect(px,py,1,1);
    }
    cctx.globalAlpha=1;return c.toDataURL('image/png');
  }

  window.GlyphForgeLayers = {
    getLayers: () => state.layers.slice().reverse().map(layerMeta),
    getActiveId: () => state.activeLayerId,
    select: selectLayer,
    add: addLayer,
    duplicate: duplicateLayer,
    remove: deleteLayer,
    rename: renameLayer,
    toggleVisibility: toggleLayerVisibility,
    toggleLock: toggleLayerLock,
    setOpacity: setLayerOpacity,
    setBlendMode: setLayerBlendMode,
    moveDisplayIndex(id, displayIndex) {
      const targetInternal = state.layers.length - 1 - Math.max(0,Math.min(state.layers.length-1,displayIndex));
      return moveLayer(id,targetInternal);
    },
    moveUp(id=state.activeLayerId) { const i=state.layers.findIndex(l=>l.id===id); return i<state.layers.length-1 ? moveLayer(id,i+1) : false; },
    moveDown(id=state.activeLayerId) { const i=state.layers.findIndex(l=>l.id===id); return i>0 ? moveLayer(id,i-1) : false; },
    mergeDown,
    flatten: flattenLayers,
    thumbnail: layerThumbnail,
    isLocked: id => Boolean(state.layers.find(l=>l.id===id)?.locked)
  };

  function init(){buildQuickPalette();customBrushesLoad();brushHistoryLoad();loadSettings();if(!loadProjectLocal())initializeGrid();populatePresets();bindEvents();syncUi();resizeCanvas();renderBrushHistory();requestBrushPreview();saveProjectLocal();emitLayersChanged('ready');}
  init();
})();

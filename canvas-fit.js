(() => {
  'use strict';

  const frame = document.getElementById('canvasFrame');
  const canvas = document.getElementById('asciiCanvas');
  const colsInput = document.getElementById('colsInput');
  const rowsInput = document.getElementById('rowsInput');
  const resizeBtn = document.getElementById('resizeBtn');
  const zoomRange = document.getElementById('zoomRange');
  const zoomLabel = document.getElementById('zoomLabel');
  const fitImageGridBtn = document.getElementById('fitImageGridBtn');
  const convertImageBtn = document.getElementById('convertImageBtn');
  const imageInput = document.getElementById('imageInput');

  if (!frame || !canvas || !colsInput || !rowsInput || !resizeBtn) return;

  let resizeFrame = 0;
  let applyingGridFit = false;
  let fitCanvasEnabled = true;

  function numberValue(input, fallback) {
    const value = Number(input?.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function clearDisplayFit() {
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    canvas.dataset.viewportFit = 'false';
    updateFitButton();
  }

  function fitCanvasDisplay() {
    if (!fitCanvasEnabled || !canvas.width || !canvas.height) {
      clearDisplayFit();
      return;
    }

    const availableWidth = Math.max(1, frame.clientWidth - 2);
    const availableHeight = Math.max(1, frame.clientHeight - 2);
    if (!availableWidth || !availableHeight) return;

    // Keep the real canvas resolution untouched. Only its CSS display box is
    // scaled down. Pointer mapping in app-v3.js already uses the ratio between
    // canvas.width and getBoundingClientRect(), so brushes stay pixel-accurate.
    const scale = Math.min(
      1,
      availableWidth / canvas.width,
      availableHeight / canvas.height
    );

    const width = Math.max(1, Math.floor(canvas.width * scale));
    const height = Math.max(1, Math.floor(canvas.height * scale));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.dataset.viewportFit = 'true';

    // A fitted document starts from its top-left corner and never opens with
    // half of the canvas already scrolled out of view.
    frame.scrollLeft = 0;
    frame.scrollTop = 0;
    updateFitButton();
  }

  function expandGridToViewport() {
    if (applyingGridFit || !canvas.width || !canvas.height) return false;

    const cols = numberValue(colsInput, 80);
    const rows = numberValue(rowsInput, 42);
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    if (!cellWidth || !cellHeight || !frame.clientWidth || !frame.clientHeight) return false;

    const maxCols = numberValue({ value: colsInput.max }, 360);
    const maxRows = numberValue({ value: rowsInput.max }, 240);
    const requiredCols = Math.min(maxCols, Math.ceil(frame.clientWidth / cellWidth));
    const requiredRows = Math.min(maxRows, Math.ceil(frame.clientHeight / cellHeight));
    const nextCols = Math.max(cols, requiredCols);
    const nextRows = Math.max(rows, requiredRows);

    if (nextCols === cols && nextRows === rows) return false;

    applyingGridFit = true;
    colsInput.value = String(nextCols);
    rowsInput.value = String(nextRows);
    resizeBtn.click();

    requestAnimationFrame(() => {
      applyingGridFit = false;
      scheduleFit();
    });
    return true;
  }

  function fitViewport() {
    resizeFrame = 0;

    // Preserve the earlier behaviour where an undersized document grows to
    // cover the available drawing field. Once the grid is large enough, fit
    // its entire display box back inside the CRT viewport.
    if (fitCanvasEnabled && expandGridToViewport()) return;
    fitCanvasDisplay();
  }

  function scheduleFit() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitViewport);
  }

  function setFitCanvas(enabled) {
    fitCanvasEnabled = Boolean(enabled);
    if (fitCanvasEnabled) scheduleFit();
    else clearDisplayFit();
  }

  function installFitButton() {
    if (document.getElementById('fitCanvasViewportBtn')) return;
    const toolbar = zoomLabel?.closest('.editor-toolbar');
    if (!toolbar || !zoomLabel) return;

    const button = document.createElement('button');
    button.id = 'fitCanvasViewportBtn';
    button.type = 'button';
    button.className = 'button ghost';
    button.textContent = 'Вписать холст';
    button.title = 'Показать весь холст целиком внутри рабочей области';
    button.addEventListener('click', () => setFitCanvas(true));
    zoomLabel.insertAdjacentElement('afterend', button);
  }

  function updateFitButton() {
    const button = document.getElementById('fitCanvasViewportBtn');
    if (!button) return;
    button.classList.toggle('active', fitCanvasEnabled);
    button.textContent = fitCanvasEnabled ? 'Холст вписан' : 'Вписать холст';
  }

  installFitButton();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (fitCanvasEnabled) scheduleFit();
    });
    observer.observe(frame);
    observer.observe(canvas);
  }

  window.addEventListener('resize', () => {
    if (fitCanvasEnabled) scheduleFit();
  });

  // Any deliberate zoom means the user wants to inspect the document closer.
  // Disable auto-fit first; clicking "Вписать холст" restores the full view.
  zoomRange?.addEventListener('input', () => {
    if (!applyingGridFit) setFitCanvas(false);
  });
  frame.addEventListener('wheel', () => setFitCanvas(false), { capture: true, passive: true });

  resizeBtn.addEventListener('click', () => {
    if (!applyingGridFit && fitCanvasEnabled) requestAnimationFrame(scheduleFit);
  });

  // Loading or fitting a source image should always leave the complete glyph
  // canvas visible. The image may be contained correctly while the document
  // itself is larger than the CRT viewport; this is the bug this controller
  // fixes.
  imageInput?.addEventListener('change', () => setFitCanvas(true), true);
  fitImageGridBtn?.addEventListener('click', () => {
    setFitCanvas(true);
    requestAnimationFrame(scheduleFit);
  });
  convertImageBtn?.addEventListener('click', () => {
    setFitCanvas(true);
    requestAnimationFrame(scheduleFit);
  });

  window.GlyphForgeCanvasViewport = {
    fit: () => setFitCanvas(true),
    free: () => setFitCanvas(false),
    isFit: () => fitCanvasEnabled
  };

  requestAnimationFrame(scheduleFit);
})();

// Image fitting is independent from the shell, so load it immediately after
// app-v3.js. The default mode is "contain": the whole source image remains
// visible instead of being cropped to the current glyph-canvas aspect ratio.
(() => {
  'use strict';

  const id = 'glyphforge-image-fit-script';
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.src = 'image-fit.js?v=20260821-1640';
  script.async = false;
  document.body.appendChild(script);
})();

// Load the editor shell only after its stylesheet is ready, then layer UI and
// finally the adaptive context-menu system. Keeping this order avoids the
// unstyled-layout flash on GitHub Pages and gives context menus access to the
// real layer inspector instead of placeholder DOM.
(() => {
  'use strict';

  const STYLE_ID = 'glyphforge-editor-layout-style';
  const SCRIPT_ID = 'glyphforge-editor-layout-script';
  const LAYERS_SCRIPT_ID = 'glyphforge-layers-ui-script';
  const CONTEXT_STYLE_ID = 'glyphforge-context-menu-style';
  const CONTEXT_SCRIPT_ID = 'glyphforge-context-menu-script';
  const VERSION = '20260821-1640';

  function loadContextMenus() {
    if (!document.getElementById(CONTEXT_STYLE_ID)) {
      const link = document.createElement('link');
      link.id = CONTEXT_STYLE_ID;
      link.rel = 'stylesheet';
      link.href = `context-menu.css?v=${VERSION}`;
      document.head.appendChild(link);
    }
    if (document.getElementById(CONTEXT_SCRIPT_ID)) return;
    const script = document.createElement('script');
    script.id = CONTEXT_SCRIPT_ID;
    script.src = `context-menu.js?v=${VERSION}`;
    script.async = false;
    document.body.appendChild(script);
  }

  function loadLayersUi() {
    const existing = document.getElementById(LAYERS_SCRIPT_ID);
    if (existing) {
      if (window.GlyphForgeLayers) loadContextMenus();
      else existing.addEventListener('load', loadContextMenus, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = LAYERS_SCRIPT_ID;
    script.src = `layers-ui.js?v=${VERSION}`;
    script.async = false;
    script.addEventListener('load', loadContextMenus, { once: true });
    document.body.appendChild(script);
  }

  function loadLayoutScript() {
    const existing = document.getElementById(SCRIPT_ID);
    if (existing) {
      if (document.body.classList.contains('editor-shell-v2')) loadLayersUi();
      else existing.addEventListener('load', loadLayersUi, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `editor-layout.js?v=${VERSION}`;
    script.async = false;
    script.addEventListener('load', loadLayersUi, { once: true });
    document.body.appendChild(script);
  }

  let link = document.getElementById(STYLE_ID);

  if (!link) {
    link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = `editor-layout.css?v=${VERSION}`;
    link.addEventListener('load', loadLayoutScript, { once: true });
    link.addEventListener('error', () => {
      console.error('GlyphForge: editor-layout.css failed to load');
    }, { once: true });
    document.head.appendChild(link);
  } else if (link.sheet) {
    loadLayoutScript();
  } else {
    link.addEventListener('load', loadLayoutScript, { once: true });
  }
})();

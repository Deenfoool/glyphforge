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
  let fitCanvasEnabled = true;
  let verifyingFit = false;

  function installFitStyles() {
    if (document.getElementById('glyphforge-canvas-viewport-styles')) return;
    const style = document.createElement('style');
    style.id = 'glyphforge-canvas-viewport-styles';
    style.textContent = `
      .canvas-frame.glyphforge-canvas-fit-active {
        overflow: hidden !important;
      }
      .canvas-frame.glyphforge-canvas-fit-active #asciiCanvas[data-viewport-fit="true"] {
        display: block !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        transform: none !important;
        transform-origin: 0 0 !important;
      }
    `;
    document.head.appendChild(style);
  }

  function clearDisplayFit() {
    canvas.style.removeProperty('width');
    canvas.style.removeProperty('height');
    canvas.dataset.viewportFit = 'false';
    frame.classList.remove('glyphforge-canvas-fit-active');
    updateFitButton();
  }

  function availableViewport() {
    // Leave a real safety gutter. Using the exact clientWidth/clientHeight can
    // still produce a scrollbar because of sub-pixel rounding, CRT clipping
    // and browser scrollbar metrics.
    const gutter = 12;
    return {
      width: Math.max(1, frame.clientWidth - gutter),
      height: Math.max(1, frame.clientHeight - gutter)
    };
  }

  function applyDisplaySize(width, height) {
    // Important is intentional: the canvas is the document surface and its
    // fitted display size must win over editor/theme CSS loaded later.
    canvas.style.setProperty('width', `${Math.max(1, Math.floor(width))}px`, 'important');
    canvas.style.setProperty('height', `${Math.max(1, Math.floor(height))}px`, 'important');
    canvas.dataset.viewportFit = 'true';
    frame.classList.add('glyphforge-canvas-fit-active');
    frame.scrollLeft = 0;
    frame.scrollTop = 0;
  }

  function fitCanvasDisplay() {
    resizeFrame = 0;
    if (!fitCanvasEnabled || !canvas.width || !canvas.height) {
      clearDisplayFit();
      return;
    }

    const available = availableViewport();
    const scale = Math.min(
      1,
      available.width / canvas.width,
      available.height / canvas.height
    );

    applyDisplaySize(canvas.width * scale, canvas.height * scale);
    updateFitButton();

    // Validate the ACTUAL CSS box after layout. This second pass makes the
    // fit robust against late-loaded styles, zoom rounding and CRT geometry.
    if (!verifyingFit) {
      verifyingFit = true;
      requestAnimationFrame(() => {
        verifyingFit = false;
        if (!fitCanvasEnabled) return;
        const rect = canvas.getBoundingClientRect();
        const availableNow = availableViewport();
        if (!rect.width || !rect.height) return;
        if (rect.width <= availableNow.width + .5 && rect.height <= availableNow.height + .5) return;

        const correction = Math.min(
          availableNow.width / rect.width,
          availableNow.height / rect.height,
          1
        );
        applyDisplaySize(rect.width * correction, rect.height * correction);
      });
    }
  }

  function scheduleFit() {
    if (!fitCanvasEnabled) return;
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitCanvasDisplay);
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
    button.title = 'Показать весь холст целиком внутри CRT-окна';
    button.addEventListener('click', () => setFitCanvas(true));
    zoomLabel.insertAdjacentElement('afterend', button);
  }

  function updateFitButton() {
    const button = document.getElementById('fitCanvasViewportBtn');
    if (!button) return;
    button.classList.toggle('active', fitCanvasEnabled);
    button.textContent = fitCanvasEnabled ? 'Холст вписан' : 'Вписать холст';
  }

  installFitStyles();
  installFitButton();

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      if (fitCanvasEnabled) scheduleFit();
    });
    observer.observe(frame);
  }

  // Canvas intrinsic dimensions are changed by app-v3.js when the grid or
  // zoom changes. Observe those attributes directly rather than the canvas
  // CSS box; observing the fitted CSS size itself can create resize loops.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(() => {
      if (fitCanvasEnabled) scheduleFit();
    });
    observer.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  }

  window.addEventListener('resize', scheduleFit);

  // Manual zoom intentionally enters free/scrollable mode. The user can
  // restore the complete document with one click on "Вписать холст".
  zoomRange?.addEventListener('input', () => setFitCanvas(false));

  resizeBtn.addEventListener('click', () => {
    if (fitCanvasEnabled) requestAnimationFrame(scheduleFit);
  });

  // Any image workflow must end with the COMPLETE document visible. This is
  // the important part: fitting the source image and fitting the glyph canvas
  // are separate operations.
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
    isFit: () => fitCanvasEnabled,
    refresh: scheduleFit
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
  script.src = 'image-fit.js?v=20260822-0815';
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
  const VERSION = '20260822-0815';

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

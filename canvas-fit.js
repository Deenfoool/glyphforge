(() => {
  'use strict';

  const frame = document.getElementById('canvasFrame');
  const canvas = document.getElementById('asciiCanvas');
  const colsInput = document.getElementById('colsInput');
  const rowsInput = document.getElementById('rowsInput');
  const resizeBtn = document.getElementById('resizeBtn');
  const zoomRange = document.getElementById('zoomRange');

  if (!frame || !canvas || !colsInput || !rowsInput || !resizeBtn) return;

  let resizeFrame = 0;
  let applyingFit = false;

  function numberValue(input, fallback) {
    const value = Number(input.value);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function fitGridToViewport() {
    resizeFrame = 0;
    if (applyingFit || !canvas.width || !canvas.height) return;

    const cols = numberValue(colsInput, 80);
    const rows = numberValue(rowsInput, 42);
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    if (!cellWidth || !cellHeight || !frame.clientWidth || !frame.clientHeight) return;

    const maxCols = numberValue({ value: colsInput.max }, 240);
    const maxRows = numberValue({ value: rowsInput.max }, 160);

    const requiredCols = Math.min(maxCols, Math.ceil(frame.clientWidth / cellWidth));
    const requiredRows = Math.min(maxRows, Math.ceil(frame.clientHeight / cellHeight));
    const nextCols = Math.max(cols, requiredCols);
    const nextRows = Math.max(rows, requiredRows);

    if (nextCols === cols && nextRows === rows) return;

    applyingFit = true;
    colsInput.value = String(nextCols);
    rowsInput.value = String(nextRows);
    resizeBtn.click();

    requestAnimationFrame(() => {
      applyingFit = false;
      scheduleFit();
    });
  }

  function scheduleFit() {
    if (resizeFrame) cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitGridToViewport);
  }

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleFit);
    observer.observe(frame);
    observer.observe(canvas);
  }

  window.addEventListener('resize', scheduleFit);
  zoomRange?.addEventListener('input', scheduleFit);
  resizeBtn.addEventListener('click', () => {
    if (!applyingFit) requestAnimationFrame(scheduleFit);
  });

  requestAnimationFrame(scheduleFit);
})();

// Load the editor shell only after its stylesheet is ready. Relocating the
// controls before the CSS was applied caused the huge unstyled layout seen on
// GitHub Pages, especially when the stylesheet was not yet cached.
(() => {
  'use strict';

  const STYLE_ID = 'glyphforge-editor-layout-style';
  const SCRIPT_ID = 'glyphforge-editor-layout-script';
  const VERSION = '20260821-1545';

  function loadLayoutScript() {
    if (document.getElementById(SCRIPT_ID)) return;

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = `editor-layout.js?v=${VERSION}`;
    script.async = false;
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

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

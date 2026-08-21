(() => {
  'use strict';

  if (window.__glyphforgeImageFit) return;
  window.__glyphforgeImageFit = true;

  const MODE_KEY = 'glyphforge-image-fit-mode';
  const canvas = document.getElementById('asciiCanvas');
  const imageInput = document.getElementById('imageInput');
  const fitGridBtn = document.getElementById('fitImageGridBtn');
  const referenceToggle = document.getElementById('referenceToggle');
  const referenceOpacity = document.getElementById('referenceOpacity');
  const invertToggle = document.getElementById('invertToggle');

  if (!canvas || !imageInput) return;

  const proto = CanvasRenderingContext2D.prototype;
  const nativeDrawImage = proto.drawImage;
  const nativeGetImageData = proto.getImageData;
  const fittedRects = new WeakMap();

  function savedMode() {
    try {
      const value = localStorage.getItem(MODE_KEY);
      return value === 'cover' ? 'cover' : 'contain';
    } catch {
      return 'contain';
    }
  }

  function currentMode() {
    return document.getElementById('imageFitMode')?.value || savedMode();
  }

  function imageSettingsBody() {
    return imageInput.closest('.settings-body') || imageInput.parentElement?.parentElement;
  }

  function installModeControl() {
    if (document.getElementById('imageFitMode')) return;
    const body = imageSettingsBody();
    if (!body) return;

    const label = document.createElement('label');
    label.className = 'image-fit-mode-control';
    label.innerHTML = `
      <span>Размещение изображения</span>
      <select id="imageFitMode" class="select">
        <option value="contain">Вписать целиком</option>
        <option value="cover">Заполнить холст с обрезкой</option>
      </select>
    `;

    const select = label.querySelector('select');
    select.value = savedMode();
    select.addEventListener('change', () => {
      try { localStorage.setItem(MODE_KEY, select.value); } catch {}
      if (referenceToggle?.checked) {
        referenceOpacity?.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    const actions = body.querySelector('.stack-actions');
    if (actions) body.insertBefore(label, actions);
    else body.appendChild(label);

    if (fitGridBtn) {
      fitGridBtn.textContent = 'Подогнать сетку под изображение';
      fitGridBtn.title = 'Изменить пропорции сетки так, чтобы они соответствовали изображению';
    }
  }

  function isHtmlImage(source) {
    return typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement;
  }

  function looksLikeFullCanvasCover(context, dx, dy, dw, dh) {
    const w = context.canvas?.width || 0;
    const h = context.canvas?.height || 0;
    if (!w || !h) return false;
    const eps = 1.5;
    return dx <= eps && dy <= eps &&
      dx + dw >= w - eps && dy + dh >= h - eps;
  }

  function containRect(image, width, height) {
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    if (!iw || !ih || !width || !height) return { x: 0, y: 0, width, height };

    const scale = Math.min(width / iw, height / ih);
    const drawWidth = iw * scale;
    const drawHeight = ih * scale;
    return {
      x: (width - drawWidth) / 2,
      y: (height - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight
    };
  }

  // app-v3.js deliberately had a cover helper. That is good for thumbnails,
  // but wrong as the default for Image → ASCII because it crops every image
  // whose aspect ratio differs from the glyph canvas. Intercept only the
  // full-canvas HTMLImageElement draw used by the reference and converter.
  proto.drawImage = function(source, ...args) {
    if (currentMode() !== 'contain' || !isHtmlImage(source) || args.length !== 4) {
      return nativeDrawImage.call(this, source, ...args);
    }

    const [dx, dy, dw, dh] = args.map(Number);
    if (!looksLikeFullCanvasCover(this, dx, dy, dw, dh)) {
      return nativeDrawImage.call(this, source, ...args);
    }

    const width = this.canvas.width;
    const height = this.canvas.height;
    const rect = containRect(source, width, height);

    // The converter samples from a temporary canvas. Keep the letterbox area
    // empty even when "Invert brightness" is enabled: before inversion it
    // must be black, otherwise the empty border would turn into dense glyphs.
    if (this.canvas !== canvas) {
      const empty = invertToggle?.checked ? '#000000' : '#ffffff';
      this.save();
      this.globalAlpha = 1;
      this.globalCompositeOperation = 'source-over';
      this.fillStyle = empty;
      this.fillRect(0, 0, width, height);
      this.restore();
    }

    fittedRects.set(this.canvas, rect);
    return nativeDrawImage.call(this, source, rect.x, rect.y, rect.width, rect.height);
  };

  // Make sure converter letterboxing always resolves to zero glyph density.
  // This also protects against sub-pixel antialiasing along the fit boundary.
  proto.getImageData = function(...args) {
    const imageData = nativeGetImageData.apply(this, args);
    const rect = fittedRects.get(this.canvas);
    if (!rect || this.canvas === canvas || currentMode() !== 'contain') return imageData;

    const [sx = 0, sy = 0, sw = this.canvas.width, sh = this.canvas.height] = args;
    if (sx !== 0 || sy !== 0 || sw !== this.canvas.width || sh !== this.canvas.height) return imageData;

    const empty = invertToggle?.checked ? 0 : 255;
    const data = imageData.data;
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const cx = x + .5;
        const cy = y + .5;
        if (cx >= left && cx <= right && cy >= top && cy <= bottom) continue;
        const i = (y * sw + x) * 4;
        data[i] = empty;
        data[i + 1] = empty;
        data[i + 2] = empty;
        data[i + 3] = 255;
      }
    }

    fittedRects.delete(this.canvas);
    return imageData;
  };

  installModeControl();

  // The Image panel is later moved into the editor shell, but the same DOM
  // nodes survive. Retry briefly in case the script was loaded during layout.
  if (!document.getElementById('imageFitMode')) {
    let attempts = 0;
    const retry = () => {
      installModeControl();
      if (!document.getElementById('imageFitMode') && attempts++ < 60) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  }
})();

(() => {
  'use strict';

  const screen = document.getElementById('crtScreen');
  const canvas = document.getElementById('asciiCanvas');
  const toggle = document.getElementById('fishEyeToggle');
  const range = document.getElementById('fishEyeRange');

  if (!screen || !canvas || !toggle || !range) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILTER_ID = 'glyphforgeBarrelFilter';
  const DISPLACEMENT_ID = 'glyphforgeBarrelDisplacement';
  const MAX_FILTER_SCALE = 38;
  const activeCanvasPointers = new Set();

  function createDisplacementMap(size = 256) {
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = size;
    mapCanvas.height = size;

    const mapCtx = mapCanvas.getContext('2d');
    const image = mapCtx.createImageData(size, size);
    const data = image.data;

    for (let y = 0; y < size; y++) {
      const ny = (y / (size - 1)) * 2 - 1;

      for (let x = 0; x < size; x++) {
        const nx = (x / (size - 1)) * 2 - 1;
        const radius2 = nx * nx + ny * ny;
        const radial = Math.min(1, radius2);
        const i = (y * size + x) * 4;

        data[i] = Math.round(128 + 127 * nx * radial);
        data[i + 1] = Math.round(128 + 127 * ny * radial);
        data[i + 2] = 128;
        data[i + 3] = 255;
      }
    }

    mapCtx.putImageData(image, 0, 0);
    return mapCanvas.toDataURL('image/png');
  }

  function installSvgFilter() {
    if (document.getElementById(FILTER_ID)) {
      return document.getElementById(DISPLACEMENT_ID);
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'fixed';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.pointerEvents = 'none';

    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = FILTER_ID;
    filter.setAttribute('x', '-8%');
    filter.setAttribute('y', '-8%');
    filter.setAttribute('width', '116%');
    filter.setAttribute('height', '116%');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const map = document.createElementNS(SVG_NS, 'feImage');
    map.setAttribute('x', '0%');
    map.setAttribute('y', '0%');
    map.setAttribute('width', '100%');
    map.setAttribute('height', '100%');
    map.setAttribute('preserveAspectRatio', 'none');
    map.setAttribute('href', createDisplacementMap());
    map.setAttribute('result', 'barrelMap');

    const displacement = document.createElementNS(SVG_NS, 'feDisplacementMap');
    displacement.id = DISPLACEMENT_ID;
    displacement.setAttribute('in', 'SourceGraphic');
    displacement.setAttribute('in2', 'barrelMap');
    displacement.setAttribute('scale', '0');
    displacement.setAttribute('xChannelSelector', 'R');
    displacement.setAttribute('yChannelSelector', 'G');

    filter.append(map, displacement);
    defs.appendChild(filter);
    svg.appendChild(defs);
    document.body.appendChild(svg);

    return displacement;
  }

  function installLensStyles() {
    if (document.getElementById('glyphforge-fisheye-styles')) return;

    const style = document.createElement('style');
    style.id = 'glyphforge-fisheye-styles';
    style.textContent = `
      .crt-screen.fisheye {
        transform: none !important;
        filter: url(#${FILTER_ID});
        border-radius: var(--crt-lens-radius, 24px) !important;
        clip-path: inset(0 round var(--crt-lens-radius, 24px));
        will-change: filter;
      }

      .crt-screen.fisheye::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 7;
        pointer-events: none;
        border-radius: inherit;
        opacity: var(--crt-lens-overlay, .45);
        background:
          radial-gradient(ellipse at 50% 48%, transparent 50%, rgba(0, 0, 0, .08) 70%, rgba(0, 0, 0, .38) 100%),
          linear-gradient(118deg, rgba(255, 255, 255, .035) 0%, transparent 19% 78%, rgba(255, 255, 255, .012) 100%);
        box-shadow:
          inset 0 0 var(--crt-lens-edge, 54px) rgba(0, 0, 0, var(--crt-lens-darkness, .26)),
          inset 0 0 9px color-mix(in srgb, var(--accent) 7%, transparent);
      }

      html[data-theme="day"] .crt-screen.fisheye::before {
        background:
          radial-gradient(ellipse at 50% 48%, transparent 53%, rgba(0, 0, 0, .045) 73%, rgba(0, 0, 0, .22) 100%),
          linear-gradient(118deg, rgba(255, 255, 255, .09) 0%, transparent 20% 78%, rgba(255, 255, 255, .025) 100%);
      }
    `;
    document.head.appendChild(style);
  }

  const displacement = installSvgFilter();
  installLensStyles();

  function getStrength() {
    return Math.max(0, Math.min(100, Number(range.value) || 0));
  }

  function getFilterScale() {
    return MAX_FILTER_SCALE * (getStrength() / 100);
  }

  function updateBarrelDistortion() {
    const strength = getStrength();
    const enabled = toggle.checked && strength > 0;
    const scale = enabled ? getFilterScale() : 0;

    displacement.setAttribute('scale', scale.toFixed(2));
    screen.style.setProperty('--crt-lens-radius', `${20 + strength * 0.22}px`);
    screen.style.setProperty('--crt-lens-edge', `${38 + strength * 0.42}px`);
    screen.style.setProperty('--crt-lens-darkness', String(0.15 + strength * 0.0024));
    screen.style.setProperty('--crt-lens-overlay', String(0.28 + strength * 0.0042));
  }

  function sourcePointForDisplayedPoint(clientX, clientY) {
    const rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: clientX, y: clientY };

    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    const nx = u * 2 - 1;
    const ny = v * 2 - 1;
    const radius2 = nx * nx + ny * ny;
    const radial = Math.min(1, radius2);
    const scale = getFilterScale();
    const dx = scale * 0.5 * nx * radial;
    const dy = scale * 0.5 * ny * radial;

    return {
      x: clientX + dx,
      y: clientY + dy
    };
  }

  function clonePointerEvent(event, clientX, clientY) {
    return new PointerEvent(event.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: event.pointerId,
      width: event.width,
      height: event.height,
      pressure: event.pressure,
      tangentialPressure: event.tangentialPressure,
      tiltX: event.tiltX,
      tiltY: event.tiltY,
      twist: event.twist,
      pointerType: event.pointerType,
      isPrimary: event.isPrimary,
      button: event.button,
      buttons: event.buttons,
      clientX,
      clientY,
      screenX: event.screenX + (clientX - event.clientX),
      screenY: event.screenY + (clientY - event.clientY),
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
  }

  function remapCanvasPointer(event) {
    if (!event.isTrusted || !toggle.checked || getStrength() <= 0) return;

    if (event.type === 'pointerdown') {
      activeCanvasPointers.add(event.pointerId);
    }

    const point = sourcePointForDisplayedPoint(event.clientX, event.clientY);
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.dispatchEvent(clonePointerEvent(event, point.x, point.y));
  }

  function remapWindowPointerUp(event) {
    if (!event.isTrusted || !activeCanvasPointers.has(event.pointerId)) return;

    activeCanvasPointers.delete(event.pointerId);

    if (!toggle.checked || getStrength() <= 0) return;

    const point = sourcePointForDisplayedPoint(event.clientX, event.clientY);
    event.preventDefault();
    event.stopImmediatePropagation();
    window.dispatchEvent(clonePointerEvent(event, point.x, point.y));
  }

  canvas.addEventListener('pointerdown', remapCanvasPointer, true);
  canvas.addEventListener('pointermove', remapCanvasPointer, true);
  window.addEventListener('pointerup', remapWindowPointerUp, true);
  window.addEventListener('pointercancel', event => activeCanvasPointers.delete(event.pointerId), true);

  toggle.addEventListener('change', updateBarrelDistortion);
  range.addEventListener('input', updateBarrelDistortion);
  window.addEventListener('resize', updateBarrelDistortion);

  updateBarrelDistortion();
})();
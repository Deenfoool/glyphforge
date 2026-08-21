(() => {
  'use strict';

  const screen = document.getElementById('crtScreen');
  const canvas = document.getElementById('asciiCanvas');
  const toggle = document.getElementById('fishEyeToggle');
  const range = document.getElementById('fishEyeRange');

  if (!screen || !canvas || !toggle || !range) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const FILTER_ID = 'glyphforgeBarrelFilter';
  const MAP_ID = 'glyphforgeBarrelMap';
  const DISPLACEMENT_ID = 'glyphforgeBarrelDisplacement';
  const MAP_SIZE = 384;
  const MAX_SCALE_RATIO = 0.48;
  const activeCanvasPointers = new Set();

  let mapAspectRatio = 0;
  let resizeFrame = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getStrength() {
    return clamp(Number(range.value) || 0, 0, 100);
  }

  function lensVector(nx, ny, aspectRatio) {
    const aspect = Math.max(0.1, aspectRatio || 1);
    const diagonal = Math.hypot(aspect, 1);
    const radius = clamp(Math.hypot(nx * aspect, ny) / diagonal, 0, 1);
    const radiusSquared = radius * radius;
    const curve = radiusSquared * (0.52 + 0.48 * radiusSquared);

    return {
      x: nx * curve,
      y: ny * curve
    };
  }

  function createDisplacementMap(aspectRatio) {
    const mapCanvas = document.createElement('canvas');
    mapCanvas.width = MAP_SIZE;
    mapCanvas.height = MAP_SIZE;

    const mapContext = mapCanvas.getContext('2d');
    const image = mapContext.createImageData(MAP_SIZE, MAP_SIZE);
    const pixels = image.data;

    for (let y = 0; y < MAP_SIZE; y++) {
      const ny = (y / (MAP_SIZE - 1)) * 2 - 1;

      for (let x = 0; x < MAP_SIZE; x++) {
        const nx = (x / (MAP_SIZE - 1)) * 2 - 1;
        const vector = lensVector(nx, ny, aspectRatio);
        const offset = (y * MAP_SIZE + x) * 4;

        pixels[offset] = Math.round(127.5 + vector.x * 127.5);
        pixels[offset + 1] = Math.round(127.5 + vector.y * 127.5);
        pixels[offset + 2] = 128;
        pixels[offset + 3] = 255;
      }
    }

    mapContext.putImageData(image, 0, 0);
    return mapCanvas.toDataURL('image/png');
  }

  function installSvgFilter() {
    const existing = document.getElementById(FILTER_ID);
    if (existing) {
      return {
        map: document.getElementById(MAP_ID),
        displacement: document.getElementById(DISPLACEMENT_ID)
      };
    }

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.overflow = 'hidden';
    svg.style.pointerEvents = 'none';

    const defs = document.createElementNS(SVG_NS, 'defs');
    const filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = FILTER_ID;
    filter.setAttribute('x', '0%');
    filter.setAttribute('y', '0%');
    filter.setAttribute('width', '100%');
    filter.setAttribute('height', '100%');
    filter.setAttribute('filterUnits', 'objectBoundingBox');
    filter.setAttribute('color-interpolation-filters', 'sRGB');

    const map = document.createElementNS(SVG_NS, 'feImage');
    map.id = MAP_ID;
    map.setAttribute('x', '0%');
    map.setAttribute('y', '0%');
    map.setAttribute('width', '100%');
    map.setAttribute('height', '100%');
    map.setAttribute('preserveAspectRatio', 'none');
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

    return { map, displacement };
  }

  function installLensStyles() {
    if (document.getElementById('glyphforge-fisheye-styles')) return;

    const style = document.createElement('style');
    style.id = 'glyphforge-fisheye-styles';
    style.textContent = `
      .crt-screen.fisheye {
        transform: none !important;
        filter: url(#${FILTER_ID});
        border-radius: var(--crt-lens-radius, 26px) !important;
        clip-path: inset(0 round var(--crt-lens-radius, 26px));
        will-change: filter;
      }

      .crt-screen.fisheye::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: 7;
        pointer-events: none;
        border-radius: inherit;
        opacity: var(--crt-lens-overlay, .55);
        background:
          radial-gradient(ellipse at 50% 49%,
            transparent 36%,
            rgba(0, 0, 0, .08) 65%,
            rgba(0, 0, 0, .48) 100%),
          radial-gradient(ellipse at 50% -46%,
            rgba(255, 255, 255, .11) 0%,
            rgba(255, 255, 255, .035) 35%,
            transparent 65%),
          linear-gradient(118deg,
            rgba(255, 255, 255, .055) 0%,
            transparent 19% 77%,
            rgba(255, 255, 255, .018) 100%);
        box-shadow:
          inset 0 0 var(--crt-lens-edge, 64px)
            rgba(0, 0, 0, var(--crt-lens-darkness, .32)),
          inset 0 0 10px
            color-mix(in srgb, var(--accent) 9%, transparent);
      }

      html[data-theme="day"] .crt-screen.fisheye::before {
        background:
          radial-gradient(ellipse at 50% 49%,
            transparent 42%,
            rgba(0, 0, 0, .055) 70%,
            rgba(0, 0, 0, .28) 100%),
          radial-gradient(ellipse at 50% -46%,
            rgba(255, 255, 255, .22) 0%,
            rgba(255, 255, 255, .07) 35%,
            transparent 68%),
          linear-gradient(118deg,
            rgba(255, 255, 255, .12) 0%,
            transparent 20% 76%,
            rgba(255, 255, 255, .035) 100%);
      }
    `;

    document.head.appendChild(style);
  }

  const filter = installSvgFilter();
  installLensStyles();

  function getGeometry() {
    const rect = screen.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    return {
      rect,
      width,
      height,
      aspectRatio: width / height,
      shortSide: Math.min(width, height)
    };
  }

  function getFilterScale(geometry = getGeometry()) {
    const strength = getStrength() / 100;
    const perceptualStrength = Math.pow(strength, 0.82);

    return geometry.shortSide * MAX_SCALE_RATIO * perceptualStrength;
  }

  function updateDisplacementMap(geometry) {
    if (!filter.map || Math.abs(geometry.aspectRatio - mapAspectRatio) < 0.012) {
      return;
    }

    const imageUrl = createDisplacementMap(geometry.aspectRatio);
    filter.map.setAttribute('href', imageUrl);
    filter.map.setAttributeNS(XLINK_NS, 'xlink:href', imageUrl);
    mapAspectRatio = geometry.aspectRatio;
  }

  function updateBarrelDistortion() {
    const geometry = getGeometry();
    const strength = getStrength();
    const enabled = toggle.checked && strength > 0;
    const scale = enabled ? getFilterScale(geometry) : 0;

    if (enabled) updateDisplacementMap(geometry);

    filter.displacement.setAttribute('scale', scale.toFixed(2));
    screen.style.setProperty('--crt-lens-radius', `${19 + strength * 0.34}px`);
    screen.style.setProperty('--crt-lens-edge', `${35 + strength * 0.82}px`);
    screen.style.setProperty('--crt-lens-darkness', String(0.16 + strength * 0.0035));
    screen.style.setProperty('--crt-lens-overlay', String(0.34 + strength * 0.0049));
  }

  function scheduleGeometryUpdate() {
    if (resizeFrame) window.cancelAnimationFrame(resizeFrame);

    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      updateBarrelDistortion();
    });
  }

  function sourcePointForDisplayedPoint(clientX, clientY) {
    const geometry = getGeometry();
    const { rect, aspectRatio } = geometry;

    if (!rect.width || !rect.height) return { x: clientX, y: clientY };

    const nx = clamp(((clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
    const ny = clamp(((clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    const vector = lensVector(nx, ny, aspectRatio);
    const halfScale = getFilterScale(geometry) * 0.5;

    return {
      x: clientX + vector.x * halfScale,
      y: clientY + vector.y * halfScale
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
  window.addEventListener('pointercancel', event => {
    activeCanvasPointers.delete(event.pointerId);
  }, true);

  toggle.addEventListener('change', updateBarrelDistortion);
  range.addEventListener('input', updateBarrelDistortion);
  window.addEventListener('resize', scheduleGeometryUpdate);

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(scheduleGeometryUpdate).observe(screen);
  }

  updateBarrelDistortion();
})();

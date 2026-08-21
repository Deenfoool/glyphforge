(() => {
  'use strict';

  const screen = document.getElementById('crtScreen');
  const source = document.getElementById('asciiCanvas');
  const toggle = document.getElementById('fishEyeToggle');
  const range = document.getElementById('fishEyeRange');

  if (!screen || !source || !toggle || !range || !source.parentElement) return;

  const ACTIVE_CLASS = 'glyphforge-fisheye-active';
  const OUTPUT_ID = 'glyphforgeFisheyeCanvas';
  const activePointers = new Set();

  let renderer = null;
  let animationFrame = 0;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getStrength() {
    return clamp(Number(range.value) || 0, 0, 100);
  }

  function getIntensity() {
    return Math.pow(getStrength() / 100, 0.8);
  }

  function isEnabled() {
    return toggle.checked && getStrength() > 0;
  }

  function installStyles() {
    if (document.getElementById('glyphforge-fisheye-styles')) return;

    const style = document.createElement('style');
    style.id = 'glyphforge-fisheye-styles';
    style.textContent = `
      .crt-screen.fisheye {
        filter: none !important;
        transform: none !important;
        border-radius: var(--crt-lens-radius, 25px) !important;
        clip-path: inset(0 round var(--crt-lens-radius, 25px));
      }

      .crt-screen.${ACTIVE_CLASS} #asciiCanvas {
        opacity: 0 !important;
      }

      #${OUTPUT_ID} {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 1;
        display: block;
        pointer-events: none;
        image-rendering: auto;
      }

      #${OUTPUT_ID}[hidden] {
        display: none !important;
      }

      .crt-screen.${ACTIVE_CLASS} .cursor-info {
        z-index: 2;
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
            transparent 35%,
            rgba(0, 0, 0, .08) 64%,
            rgba(0, 0, 0, .48) 100%),
          radial-gradient(ellipse at 50% -45%,
            rgba(255, 255, 255, .12) 0%,
            rgba(255, 255, 255, .03) 35%,
            transparent 65%);
        box-shadow: inset 0 0 var(--crt-lens-edge, 64px)
          rgba(0, 0, 0, var(--crt-lens-darkness, .32));
      }

      html[data-theme="day"] .crt-screen.fisheye::before {
        background:
          radial-gradient(ellipse at 50% 49%,
            transparent 42%,
            rgba(0, 0, 0, .055) 70%,
            rgba(0, 0, 0, .28) 100%),
          radial-gradient(ellipse at 50% -45%,
            rgba(255, 255, 255, .22) 0%,
            rgba(255, 255, 255, .07) 35%,
            transparent 68%);
      }
    `;

    document.head.appendChild(style);
  }

  function createOutputCanvas() {
    const output = document.createElement('canvas');
    output.id = OUTPUT_ID;
    output.setAttribute('aria-hidden', 'true');
    output.hidden = true;
    return output;
  }

  function compileShader(gl, type, sourceCode) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, sourceCode);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createWebGlRenderer(output) {
    const gl = output.getContext('webgl', {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false
    }) || output.getContext('experimental-webgl');

    if (!gl) return null;

    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;

      void main() {
        v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;

      uniform sampler2D u_image;
      uniform float u_strength;
      varying vec2 v_uv;

      void main() {
        vec2 position = v_uv * 2.0 - 1.0;
        float radiusSquared = dot(position, position) * 0.5;
        float curve = 1.0 + u_strength *
          (0.42 * radiusSquared + 0.28 * radiusSquared * radiusSquared);
        float zoom = 1.0 - u_strength * 0.12;
        vec2 sampleUv = position * curve * zoom * 0.5 + 0.5;

        if (sampleUv.x < 0.0 || sampleUv.x > 1.0 ||
            sampleUv.y < 0.0 || sampleUv.y > 1.0) {
          discard;
        }

        gl_FragColor = texture2D(u_image, sampleUv);
      }
    `;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;

    const program = gl.createProgram();
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1
    ]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);

    const strengthLocation = gl.getUniformLocation(program, 'u_strength');

    return {
      type: 'webgl',
      output,

      draw(intensity) {
        gl.viewport(0, 0, output.width, output.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1f(strengthLocation, intensity);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA,
          gl.UNSIGNED_BYTE, source);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    };
  }

  function createCanvasRenderer(output) {
    const context = output.getContext('2d', { alpha: true });
    if (!context) return null;

    const intermediate = document.createElement('canvas');
    const intermediateContext = intermediate.getContext('2d', { alpha: true });
    if (!intermediateContext) return null;

    return {
      type: 'canvas',
      output,

      draw(intensity) {
        const width = output.width;
        const height = output.height;

        if (intermediate.width !== width) intermediate.width = width;
        if (intermediate.height !== height) intermediate.height = height;

        intermediateContext.clearRect(0, 0, width, height);
        context.clearRect(0, 0, width, height);

        const rowStep = Math.max(2, Math.ceil(height / 220));
        const columnStep = Math.max(2, Math.ceil(width / 260));

        for (let y = 0; y < height; y += rowStep) {
          const stripe = Math.min(rowStep + 1, height - y);
          const ny = ((y + stripe / 2) / height) * 2 - 1;
          const scale = 1 + intensity * (0.08 - 0.27 * ny * ny);
          const scaledWidth = width * scale;

          intermediateContext.drawImage(source,
            0, y, width, stripe,
            (width - scaledWidth) / 2, y, scaledWidth, stripe);
        }

        for (let x = 0; x < width; x += columnStep) {
          const stripe = Math.min(columnStep + 1, width - x);
          const nx = ((x + stripe / 2) / width) * 2 - 1;
          const scale = 1 + intensity * (0.08 - 0.27 * nx * nx);
          const scaledHeight = height * scale;

          context.drawImage(intermediate,
            x, 0, stripe, height,
            x, (height - scaledHeight) / 2, stripe, scaledHeight);
        }
      }
    };
  }

  function ensureRenderer() {
    if (renderer) return renderer;

    let output = createOutputCanvas();

    try {
      renderer = createWebGlRenderer(output);
    } catch {
      renderer = null;
    }

    if (!renderer) {
      output = createOutputCanvas();
      renderer = createCanvasRenderer(output);
    }

    if (!renderer) return null;

    source.parentElement.insertBefore(output, source.nextSibling);
    return renderer;
  }

  function repaint() {
    animationFrame = 0;

    if (!isEnabled() || !renderer || !source.width || !source.height) return;

    const output = renderer.output;
    if (output.width !== source.width) output.width = source.width;
    if (output.height !== source.height) output.height = source.height;

    output.style.width = `${source.offsetWidth || source.width}px`;
    output.style.height = `${source.offsetHeight || source.height}px`;
    renderer.draw(getIntensity());
  }

  function requestRepaint() {
    if (!isEnabled() || animationFrame) return;
    animationFrame = window.requestAnimationFrame(repaint);
  }

  function updateLens() {
    const strength = getStrength();
    const enabled = isEnabled() && Boolean(ensureRenderer());

    screen.classList.toggle(ACTIVE_CLASS, enabled);
    screen.style.setProperty('--crt-lens-radius', `${18 + strength * 0.36}px`);
    screen.style.setProperty('--crt-lens-edge', `${35 + strength * 0.82}px`);
    screen.style.setProperty('--crt-lens-darkness', String(0.16 + strength * 0.0035));
    screen.style.setProperty('--crt-lens-overlay', String(0.34 + strength * 0.0049));

    if (renderer) renderer.output.hidden = !enabled;

    if (enabled) requestRepaint();
    else if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  function getSourcePoint(clientX, clientY) {
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: clientX, y: clientY };

    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((clientY - rect.top) / rect.height) * 2 - 1;
    const intensity = getIntensity();
    let sampleX;
    let sampleY;

    if (renderer && renderer.type === 'canvas') {
      const verticalScale = 1 + intensity * (0.08 - 0.27 * nx * nx);
      sampleY = ny / verticalScale;

      const horizontalScale = 1 + intensity * (0.08 - 0.27 * sampleY * sampleY);
      sampleX = nx / horizontalScale;
    } else {
      const radiusSquared = (nx * nx + ny * ny) * 0.5;
      const curve = 1 + intensity *
        (0.42 * radiusSquared + 0.28 * radiusSquared * radiusSquared);
      const zoom = 1 - intensity * 0.12;

      sampleX = nx * curve * zoom;
      sampleY = ny * curve * zoom;
    }

    return {
      x: rect.left + (sampleX + 1) * rect.width * 0.5,
      y: rect.top + (sampleY + 1) * rect.height * 0.5
    };
  }

  function clonePointer(event, point) {
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
      clientX: point.x,
      clientY: point.y,
      screenX: event.screenX + point.x - event.clientX,
      screenY: event.screenY + point.y - event.clientY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
  }

  function remapCanvasPointer(event) {
    if (!event.isTrusted || !isEnabled() || !renderer) return;

    if (event.type === 'pointerdown') activePointers.add(event.pointerId);

    const point = getSourcePoint(event.clientX, event.clientY);
    event.preventDefault();
    event.stopImmediatePropagation();
    source.dispatchEvent(clonePointer(event, point));
    requestRepaint();
  }

  function remapPointerUp(event) {
    if (!event.isTrusted || !activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);

    if (!isEnabled() || !renderer) return;

    const point = getSourcePoint(event.clientX, event.clientY);
    event.preventDefault();
    event.stopImmediatePropagation();
    window.dispatchEvent(clonePointer(event, point));
    requestRepaint();
  }

  function observeSourceRendering() {
    const context = source.getContext('2d');
    if (!context || typeof context.restore !== 'function') return;

    const originalRestore = context.restore.bind(context);

    try {
      context.restore = function (...args) {
        const result = originalRestore(...args);
        requestRepaint();
        return result;
      };
    } catch {
      document.addEventListener('input', requestRepaint, true);
      document.addEventListener('click', requestRepaint, true);
      document.addEventListener('keydown', requestRepaint, true);
    }
  }

  installStyles();
  observeSourceRendering();

  source.addEventListener('pointerdown', remapCanvasPointer, true);
  source.addEventListener('pointermove', remapCanvasPointer, true);
  window.addEventListener('pointerup', remapPointerUp, true);
  window.addEventListener('pointercancel', event => {
    activePointers.delete(event.pointerId);
  }, true);

  toggle.addEventListener('change', updateLens);
  range.addEventListener('input', updateLens);
  window.addEventListener('resize', requestRepaint);

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(requestRepaint);
    observer.observe(screen);
    observer.observe(source);
  }

  if (typeof MutationObserver === 'function') {
    new MutationObserver(requestRepaint).observe(source, {
      attributes: true,
      attributeFilter: ['width', 'height']
    });
  }

  updateLens();
})();

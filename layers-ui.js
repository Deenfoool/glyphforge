(() => {
  'use strict';

  if (window.__glyphforgeLayersUiLoaded) return;
  window.__glyphforgeLayersUiLoaded = true;

  const STYLE_ID = 'glyphforge-layers-ui-style';
  if (!document.getElementById(STYLE_ID)) {
    const link = document.createElement('link');
    link.id = STYLE_ID;
    link.rel = 'stylesheet';
    link.href = 'layers-ui.css?v=20260821-1';
    document.head.appendChild(link);
  }

  let root = null;
  let renderQueued = false;
  let contentRefreshTimer = 0;

  function api() { return window.GlyphForgeLayers; }
  function findRoot() { return document.querySelector('.inspector-page[data-inspector-page="layers"]'); }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function scheduleContentRefresh() {
    clearTimeout(contentRefreshTimer);
    contentRefreshTimer = setTimeout(scheduleRender, 180);
  }

  function bindHeaderControls(container, layers, activeId) {
    const active = layers.find(layer => layer.id === activeId) || layers[0];
    const opacity = container.querySelector('[data-layer-opacity]');
    const opacityLabel = container.querySelector('[data-layer-opacity-label]');
    const blend = container.querySelector('[data-layer-blend]');
    if (!active) return;

    opacity.value = Math.round(active.opacity * 100);
    opacityLabel.textContent = `${Math.round(active.opacity * 100)}%`;
    blend.value = active.blendMode || 'normal';

    opacity.addEventListener('input', () => {
      opacityLabel.textContent = `${opacity.value}%`;
      api()?.setOpacity(active.id, Number(opacity.value) / 100);
    });
    blend.addEventListener('change', () => api()?.setBlendMode(active.id, blend.value));
  }

  function bindRows(container) {
    container.querySelectorAll('.gf-layer-row').forEach(row => {
      const id = row.dataset.layerId;
      row.addEventListener('click', event => {
        if (event.target.closest('button,input,select')) return;
        api()?.select(id);
      });
      row.querySelector('[data-layer-visible]')?.addEventListener('click', event => {
        event.stopPropagation();
        api()?.toggleVisibility(id);
      });
      row.querySelector('[data-layer-lock]')?.addEventListener('click', event => {
        event.stopPropagation();
        api()?.toggleLock(id);
      });
      row.querySelector('[data-layer-name]')?.addEventListener('dblclick', event => {
        event.stopPropagation();
        const current = event.currentTarget.textContent.trim();
        const next = prompt('Название слоя:', current);
        if (next && next.trim() && next.trim() !== current) api()?.rename(id, next.trim());
      });

      row.draggable = true;
      row.addEventListener('dragstart', event => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/x-glyphforge-layer', id);
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', event => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', event => {
        event.preventDefault();
        row.classList.remove('drag-over');
        const sourceId = event.dataTransfer.getData('text/x-glyphforge-layer');
        if (!sourceId || sourceId === id) return;
        const rows = [...container.querySelectorAll('.gf-layer-row')];
        const targetDisplayIndex = rows.findIndex(item => item.dataset.layerId === id);
        api()?.moveDisplayIndex(sourceId, targetDisplayIndex);
      });
    });
  }

  function bindActions(container, activeId) {
    container.querySelector('[data-layer-add]')?.addEventListener('click', () => api()?.add('Новый слой'));
    container.querySelector('[data-layer-duplicate]')?.addEventListener('click', () => api()?.duplicate(activeId));
    container.querySelector('[data-layer-delete]')?.addEventListener('click', () => api()?.remove(activeId));
    container.querySelector('[data-layer-up]')?.addEventListener('click', () => api()?.moveUp(activeId));
    container.querySelector('[data-layer-down]')?.addEventListener('click', () => api()?.moveDown(activeId));
    container.querySelector('[data-layer-merge]')?.addEventListener('click', () => {
      if (!api()?.mergeDown(activeId)) alert('Под активным слоем нет слоя для объединения или один из слоёв заблокирован.');
    });
    container.querySelector('[data-layer-flatten]')?.addEventListener('click', () => api()?.flatten());
  }

  function render() {
    const layerApi = api();
    root = root && document.contains(root) ? root : findRoot();
    if (!layerApi || !root) return;

    const layers = layerApi.getLayers();
    const activeId = layerApi.getActiveId();
    const active = layers.find(layer => layer.id === activeId) || layers[0];

    root.innerHTML = `
      <section class="gf-layers-panel">
        <header class="gf-layers-header">
          <div><strong>Слои</strong><span>${layers.length} ${layers.length === 1 ? 'слой' : 'слоёв'}</span></div>
          <div class="gf-layer-header-actions">
            <button type="button" data-layer-add title="Новый слой">＋</button>
            <button type="button" data-layer-duplicate title="Дублировать слой">⧉</button>
          </div>
        </header>
        <div class="gf-layer-properties ${active ? '' : 'is-disabled'}">
          <label>
            <span>Непрозрачность <b data-layer-opacity-label>${active ? Math.round(active.opacity * 100) : 100}%</b></span>
            <input data-layer-opacity type="range" min="0" max="100" value="${active ? Math.round(active.opacity * 100) : 100}" ${active ? '' : 'disabled'}>
          </label>
          <label>
            <span>Режим наложения</span>
            <select data-layer-blend ${active ? '' : 'disabled'}>
              <option value="normal">Normal</option>
              <option value="add">Add</option>
              <option value="multiply">Multiply</option>
              <option value="screen">Screen</option>
              <option value="difference">Difference</option>
              <option value="max">Max density</option>
              <option value="min">Min density</option>
            </select>
          </label>
        </div>
        <div class="gf-layer-list" role="listbox" aria-label="Список слоёв">
          ${layers.map(layer => `
            <div class="gf-layer-row ${layer.active ? 'active' : ''} ${layer.visible ? '' : 'hidden-layer'}" data-layer-id="${layer.id}" role="option" aria-selected="${layer.active}">
              <button type="button" class="gf-layer-eye" data-layer-visible title="${layer.visible ? 'Скрыть слой' : 'Показать слой'}">${layer.visible ? '◉' : '○'}</button>
              <img class="gf-layer-thumb" src="${layerApi.thumbnail(layer.id, 48, 32)}" alt="" draggable="false">
              <div class="gf-layer-copy">
                <strong data-layer-name title="Двойной клик — переименовать">${escapeHtml(layer.name)}</strong>
                <small>${layer.blendMode} · ${Math.round(layer.opacity * 100)}%</small>
              </div>
              <button type="button" class="gf-layer-lock ${layer.locked ? 'locked' : ''}" data-layer-lock title="${layer.locked ? 'Разблокировать' : 'Заблокировать'}">${layer.locked ? '◆' : '◇'}</button>
            </div>
          `).join('')}
        </div>
        <footer class="gf-layers-footer">
          <div class="gf-layer-order-actions">
            <button type="button" data-layer-down title="Опустить слой">↓</button>
            <button type="button" data-layer-up title="Поднять слой">↑</button>
            <button type="button" data-layer-merge title="Объединить с нижним">⇣</button>
          </div>
          <div class="gf-layer-final-actions">
            <button type="button" data-layer-flatten title="Свести все слои">▤</button>
            <button type="button" class="danger" data-layer-delete title="Удалить слой">⌫</button>
          </div>
        </footer>
      </section>`;

    bindHeaderControls(root, layers, activeId);
    bindRows(root);
    bindActions(root, activeId);
  }

  function waitForLayout(attempt = 0) {
    root = findRoot();
    if (root && api()) { render(); return; }
    if (attempt < 180) requestAnimationFrame(() => waitForLayout(attempt + 1));
  }

  window.addEventListener('glyphforge:layers-changed', event => {
    if (event.detail?.reason === 'render') scheduleContentRefresh();
    else scheduleRender();
  });
  window.addEventListener('load', scheduleRender);
  waitForLayout();
})();

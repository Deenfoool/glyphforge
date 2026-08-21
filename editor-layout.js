(() => {
  'use strict';

  const topbar = document.querySelector('.topbar');
  const workspace = document.querySelector('.workspace');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');
  const topActions = topbar?.querySelector('.top-actions');

  if (!topbar || !workspace || !leftPanel || !rightPanel || !topActions) return;
  if (document.body.classList.contains('editor-shell-v2')) return;

  document.body.classList.add('editor-shell-v2');

  const findLeftSection = title => Array.from(leftPanel.querySelectorAll(':scope > .panel-section'))
    .find(section => section.querySelector('h2')?.textContent.trim() === title);

  const optionGroups = new Map();
  rightPanel.querySelectorAll(':scope > .settings-group').forEach(details => {
    const title = details.querySelector(':scope > summary')?.textContent.trim();
    if (title) optionGroups.set(title, details);
  });

  const brushHead = rightPanel.querySelector(':scope > .brush-head');

  // Main application menu. Heavy panels are reachable from the header, but
  // they no longer occupy permanent screen space or become dozens of buttons.
  const menuBar = document.createElement('nav');
  menuBar.className = 'editor-menu-bar';
  menuBar.setAttribute('aria-label', 'Главное меню');
  topbar.insertBefore(menuBar, topActions);

  const openMenus = new Set();

  function closeMenus(except = null) {
    openMenus.forEach(menu => {
      if (menu !== except) menu.classList.remove('open');
    });
  }

  function makeMenu(label, sourceTitle, className = '') {
    const source = optionGroups.get(sourceTitle);
    if (!source) return null;

    const body = source.querySelector(':scope > .settings-body');
    if (!body) return null;

    const menu = document.createElement('div');
    menu.className = `editor-menu ${className}`.trim();

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'editor-menu-button';
    button.textContent = label;
    button.setAttribute('aria-expanded', 'false');

    const popover = document.createElement('div');
    popover.className = 'editor-menu-popover';
    popover.appendChild(body);

    button.addEventListener('click', event => {
      event.stopPropagation();
      const opening = !menu.classList.contains('open');
      closeMenus(menu);
      menu.classList.toggle('open', opening);
      button.setAttribute('aria-expanded', String(opening));
    });

    menu.append(button, popover);
    menuBar.appendChild(menu);
    openMenus.add(menu);
    source.remove();
    return menu;
  }

  makeMenu('Файл', 'Файл / Проект', 'file-menu');
  makeMenu('Изображение', 'Изображение → ASCII', 'image-menu');
  makeMenu('Вид', 'Экран / CRT', 'view-menu');

  // Context options bar. Only the parameters used constantly while painting
  // live here. The rest is one proper Brush Settings panel.
  const contextBar = document.createElement('div');
  contextBar.className = 'tool-options-bar';
  topbar.insertAdjacentElement('afterend', contextBar);

  const contextIdentity = document.createElement('div');
  contextIdentity.className = 'tool-options-identity';
  contextIdentity.innerHTML = '<span class="tool-options-icon">✎</span><strong>Кисть</strong>';
  contextBar.appendChild(contextIdentity);

  const contextBrush = document.createElement('div');
  contextBrush.className = 'tool-options-brush';
  contextBar.appendChild(contextBrush);

  if (brushHead) {
    const preview = brushHead.querySelector('.brush-preview-wrap');
    const modeRow = brushHead.querySelector('.mode-row');

    if (preview) {
      const previewSlot = document.createElement('div');
      previewSlot.className = 'compact-brush-preview';
      previewSlot.title = 'Предпросмотр текущей кисти';
      previewSlot.appendChild(preview);
      contextBrush.appendChild(previewSlot);
    }

    if (modeRow) contextBrush.appendChild(modeRow);
    brushHead.remove();
  }

  const mainBrushGroup = optionGroups.get('Основная кисть');
  const essentialIds = ['sizeRange', 'hardnessRange', 'opacityRange', 'flowRange'];

  if (mainBrushGroup) {
    const mainBody = mainBrushGroup.querySelector(':scope > .settings-body');
    const essentials = document.createElement('div');
    essentials.className = 'brush-essential-controls';

    essentialIds.forEach(id => {
      const control = mainBody?.querySelector(`#${id}`);
      const label = control?.closest('label');
      if (label) essentials.appendChild(label);
    });

    contextBrush.appendChild(essentials);
  }

  const brushSettingsButton = document.createElement('button');
  brushSettingsButton.type = 'button';
  brushSettingsButton.className = 'brush-settings-button';
  brushSettingsButton.innerHTML = '<span>⚙</span><span>Настройки кисти</span><span class="menu-caret">⌄</span>';
  contextBrush.appendChild(brushSettingsButton);

  // Brush Settings: one floating panel with categories, instead of a
  // horizontal row of unrelated dropdowns.
  const brushPanel = document.createElement('section');
  brushPanel.className = 'brush-settings-panel';
  brushPanel.setAttribute('aria-hidden', 'true');
  brushPanel.innerHTML = `
    <div class="brush-settings-header">
      <div>
        <strong>Настройки кисти</strong>
        <span>GlyphForge Brush Engine</span>
      </div>
      <button type="button" class="brush-settings-close" aria-label="Закрыть">×</button>
    </div>
    <div class="brush-settings-main">
      <nav class="brush-settings-nav" aria-label="Категории кисти"></nav>
      <div class="brush-settings-pages"></div>
    </div>
    <div class="brush-settings-footer"></div>
  `;
  document.body.appendChild(brushPanel);

  const brushNav = brushPanel.querySelector('.brush-settings-nav');
  const brushPages = brushPanel.querySelector('.brush-settings-pages');
  const brushFooter = brushPanel.querySelector('.brush-settings-footer');

  const brushGroupNames = [
    ['Основная кисть', 'Основные'],
    ['Brush Tip', 'Форма'],
    ['Shape Dynamics', 'Динамика'],
    ['Scatter', 'Разброс'],
    ['Glyph Dynamics', 'Glyph Dynamics'],
    ['Velocity / Pressure / Tilt', 'Перо и скорость'],
    ['Texture / Dual Brush', 'Текстура'],
    ['Умная кисть', 'Smart Brush'],
    ['Stroke / Symmetry', 'Штрих и симметрия'],
    ['Lock параметров', 'Блокировки']
  ];

  let firstBrushPage = null;

  brushGroupNames.forEach(([sourceTitle, label], index) => {
    const details = optionGroups.get(sourceTitle);
    const body = details?.querySelector(':scope > .settings-body');
    if (!details || !body) return;

    const navButton = document.createElement('button');
    navButton.type = 'button';
    navButton.className = 'brush-category-button';
    navButton.textContent = label;

    const page = document.createElement('div');
    page.className = 'brush-settings-page';
    page.dataset.brushPage = sourceTitle;
    page.appendChild(body);

    const activate = () => {
      brushNav.querySelectorAll('.brush-category-button').forEach(button => button.classList.remove('active'));
      brushPages.querySelectorAll('.brush-settings-page').forEach(item => item.classList.remove('active'));
      navButton.classList.add('active');
      page.classList.add('active');
    };

    navButton.addEventListener('click', activate);
    brushNav.appendChild(navButton);
    brushPages.appendChild(page);
    details.remove();

    if (!firstBrushPage || index === 0) firstBrushPage = activate;
  });

  firstBrushPage?.();

  const saveBrushButton = document.getElementById('saveBrushBtn');
  if (saveBrushButton) {
    saveBrushButton.classList.remove('ghost');
    brushFooter.appendChild(saveBrushButton);
  }

  const closeBrushPanel = () => {
    brushPanel.classList.remove('open');
    brushPanel.setAttribute('aria-hidden', 'true');
    brushSettingsButton.classList.remove('active');
  };

  const openBrushPanel = () => {
    closeMenus();
    brushPanel.classList.add('open');
    brushPanel.setAttribute('aria-hidden', 'false');
    brushSettingsButton.classList.add('active');
  };

  brushSettingsButton.addEventListener('click', event => {
    event.stopPropagation();
    brushPanel.classList.contains('open') ? closeBrushPanel() : openBrushPanel();
  });
  brushPanel.querySelector('.brush-settings-close')?.addEventListener('click', closeBrushPanel);

  // Right dock: Layers and visual resources live here; painting tools stay in
  // the left rail.
  rightPanel.innerHTML = '';
  rightPanel.classList.add('inspector-dock');

  const inspectorTabs = document.createElement('div');
  inspectorTabs.className = 'inspector-tabs';
  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'inspector-body';
  rightPanel.append(inspectorTabs, inspectorBody);

  function makeInspectorTab(id, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inspector-tab';
    button.dataset.inspectorTarget = id;
    button.textContent = label;

    const page = document.createElement('div');
    page.className = 'inspector-page';
    page.dataset.inspectorPage = id;

    button.addEventListener('click', () => activateInspector(id));
    inspectorTabs.appendChild(button);
    inspectorBody.appendChild(page);
    return page;
  }

  function activateInspector(id) {
    inspectorTabs.querySelectorAll('.inspector-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.inspectorTarget === id);
    });
    inspectorBody.querySelectorAll('.inspector-page').forEach(page => {
      page.classList.toggle('active', page.dataset.inspectorPage === id);
    });
    try { localStorage.setItem('glyphforge-inspector-tab', id); } catch {}
  }

  const layersPage = makeInspectorTab('layers', 'Слои');
  const colorPage = makeInspectorTab('color', 'Цвет');
  const glyphPage = makeInspectorTab('glyphs', 'Глифы');
  const brushesPage = makeInspectorTab('brushes', 'Кисти');

  layersPage.innerHTML = `
    <div class="inspector-panel-heading">
      <div><strong>Слои</strong><span>1 слой</span></div>
      <div class="layer-actions">
        <button type="button" class="layer-icon-button" disabled title="Новый слой">＋</button>
        <button type="button" class="layer-icon-button" disabled title="Дублировать">⧉</button>
      </div>
    </div>
    <div class="layer-list">
      <div class="layer-row active" aria-current="true">
        <button type="button" class="layer-visibility" title="Видимый" disabled>◉</button>
        <span class="layer-thumb" aria-hidden="true"><span>GF</span></span>
        <span class="layer-name"><strong>Рисунок</strong><small>Glyph layer</small></span>
        <span class="layer-lock" title="Разблокирован">◇</span>
      </div>
    </div>
    <div class="layers-bottom-bar">
      <button type="button" disabled title="Добавить слой">＋</button>
      <button type="button" disabled title="Группа">▣</button>
      <span></span>
      <button type="button" disabled title="Удалить">⌫</button>
    </div>
  `;

  const colorSection = findLeftSection('Цвет');
  const symbolSection = findLeftSection('Символ');
  const charsetSection = findLeftSection('Шкала плотности');
  const presetsSection = findLeftSection('Пресеты кистей');

  if (colorSection) colorPage.appendChild(colorSection);
  if (symbolSection) glyphPage.appendChild(symbolSection);
  if (charsetSection) glyphPage.appendChild(charsetSection);
  if (presetsSection) brushesPage.appendChild(presetsSection);

  if (colorSection) {
    const swatches = document.createElement('div');
    swatches.className = 'quick-color-swatches';
    ['#8dff00', '#ffffff', '#b6ff7a', '#37d9ff', '#ffcc66', '#ff7373', '#d987ff', '#7f8c8d', '#111511'].forEach(color => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'quick-color-swatch';
      swatch.style.setProperty('--swatch-color', color);
      swatch.title = color;
      swatch.addEventListener('click', () => {
        const input = document.getElementById('fgColor');
        if (!input) return;
        input.value = color;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      swatches.appendChild(swatch);
    });
    colorSection.appendChild(swatches);
  }

  Array.from(leftPanel.querySelectorAll(':scope > .panel-section')).forEach(section => {
    const title = section.querySelector('h2')?.textContent.trim();
    if (title !== 'Инструменты') section.remove();
  });

  leftPanel.querySelectorAll('.tool-button').forEach(button => {
    const label = button.querySelector('small')?.textContent.trim() || 'Инструмент';
    button.title ||= label;
    button.setAttribute('aria-label', label);
  });

  try {
    const remembered = localStorage.getItem('glyphforge-inspector-tab');
    activateInspector(['layers', 'color', 'glyphs', 'brushes'].includes(remembered) ? remembered : 'layers');
  } catch {
    activateInspector('layers');
  }

  function syncToolContext() {
    const active = leftPanel.querySelector('.tool-button.active');
    const tool = active?.dataset.tool || 'brush';
    const label = active?.querySelector('small')?.textContent.trim() || 'Кисть';
    const icon = active?.querySelector('span')?.textContent.trim() || '✎';
    const usesBrush = ['brush', 'eraser', 'lighten', 'darken', 'line', 'rect'].includes(tool);

    contextIdentity.querySelector('.tool-options-icon').textContent = icon;
    contextIdentity.querySelector('strong').textContent = label;
    contextBar.classList.toggle('simple-tool-options', !usesBrush);
    brushSettingsButton.disabled = !usesBrush;
    if (!usesBrush) closeBrushPanel();
  }

  leftPanel.querySelectorAll('.tool-button').forEach(button => {
    button.addEventListener('click', () => requestAnimationFrame(syncToolContext));
  });
  syncToolContext();

  document.addEventListener('pointerdown', event => {
    if (!event.target.closest('.editor-menu')) closeMenus();
    if (brushPanel.classList.contains('open') &&
        !brushPanel.contains(event.target) &&
        !brushSettingsButton.contains(event.target)) {
      closeBrushPanel();
    }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeMenus();
      closeBrushPanel();
    }
  });
})();

(() => {
  'use strict';

  const topbar = document.querySelector('.topbar');
  const workspace = document.querySelector('.workspace');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');

  if (!topbar || !workspace || !leftPanel || !rightPanel) return;

  document.body.classList.add('editor-pro-layout');

  const optionsDock = document.createElement('div');
  optionsDock.className = 'options-dock';
  optionsDock.setAttribute('aria-label', 'Параметры активного инструмента');
  topbar.insertAdjacentElement('afterend', optionsDock);

  // The old right column was actually the brush/options stack. In a desktop
  // image editor those controls belong in a contextual options bar, not in
  // the inspector column. Keep every existing control/ID intact and only
  // relocate the DOM nodes so app-v3.js continues to bind them normally.
  const optionNodes = Array.from(rightPanel.children);
  optionNodes.forEach(node => {
    if (node.tagName === 'DETAILS') node.open = false;
    optionsDock.appendChild(node);
  });

  const shortLabels = new Map([
    ['Основная кисть', 'Кисть'],
    ['Brush Tip', 'Наконечник'],
    ['Shape Dynamics', 'Динамика'],
    ['Scatter', 'Разброс'],
    ['Glyph Dynamics', 'Glyph'],
    ['Velocity / Pressure / Tilt', 'Ввод'],
    ['Texture / Dual Brush', 'Текстура'],
    ['Умная кисть', 'Smart'],
    ['Stroke / Symmetry', 'Штрих'],
    ['Lock параметров', 'Lock'],
    ['Экран / CRT', 'Экран'],
    ['Изображение → ASCII', 'Image → ASCII'],
    ['Файл / Проект', 'Файл']
  ]);

  optionsDock.querySelectorAll('.settings-group > summary').forEach(summary => {
    const original = summary.textContent.trim();
    summary.title = original;
    summary.textContent = shortLabels.get(original) || original;
  });

  // Close other popovers when one opens. This makes the header behave like
  // the option/menu strips in Photoshop, Affinity and similar editors.
  const headerDetails = Array.from(optionsDock.querySelectorAll('.settings-group'));
  headerDetails.forEach(details => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      headerDetails.forEach(other => {
        if (other !== details) other.open = false;
      });
    });
  });

  document.addEventListener('pointerdown', event => {
    headerDetails.forEach(details => {
      if (details.open && !details.contains(event.target)) details.open = false;
    });
  });

  function findLeftSection(title) {
    return Array.from(leftPanel.querySelectorAll(':scope > .panel-section')).find(section => {
      return section.querySelector('h2')?.textContent.trim() === title;
    });
  }

  // The inspector starts with Layers. GlyphForge still has a single backing
  // artwork grid, so don't expose fake add/delete operations yet; the panel
  // deliberately shows the real current artwork layer and reserves the
  // standard controls for the upcoming multi-layer data model.
  const layersSection = document.createElement('section');
  layersSection.className = 'inspector-section layers-panel';
  layersSection.innerHTML = `
    <div class="inspector-title-row">
      <h2>Слои</h2>
      <div class="layer-actions" aria-label="Действия со слоями">
        <button class="layer-icon-button" type="button" disabled title="Добавление слоёв будет подключено к многослойному движку">＋</button>
        <button class="layer-icon-button" type="button" disabled title="Дублировать слой">⧉</button>
        <button class="layer-icon-button" type="button" disabled title="Удалить слой">⌫</button>
      </div>
    </div>
    <div class="layer-list">
      <div class="layer-row active" aria-current="true">
        <span class="layer-eye" title="Видимый">◉</span>
        <span class="layer-thumb" aria-hidden="true"></span>
        <span class="layer-name"><strong>Рисунок</strong><small>активный glyph-слой</small></span>
        <span class="layer-lock" title="Разблокирован">◇</span>
      </div>
    </div>
    <p class="layer-engine-note">Панель уже стоит на правильном месте. Сейчас документ использует один реальный glyph-слой; фиктивные слои не создаются.</p>
  `;
  rightPanel.appendChild(layersSection);

  // Inspector content: visual properties and resources belong on the right.
  // Tools themselves intentionally remain only in the left rail.
  ['Цвет', 'Символ', 'Шкала плотности', 'Пресеты кистей'].forEach(title => {
    const section = findLeftSection(title);
    if (section) rightPanel.appendChild(section);
  });

  // Keep only the actual tools section in the left toolbar.
  Array.from(leftPanel.querySelectorAll(':scope > .panel-section')).forEach(section => {
    const title = section.querySelector('h2')?.textContent.trim();
    if (title !== 'Инструменты') rightPanel.appendChild(section);
  });
})();

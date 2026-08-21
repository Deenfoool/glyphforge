(() => {
  'use strict';

  if (window.__glyphforgeContextMenus) return;
  window.__glyphforgeContextMenus = true;

  const canvas = document.getElementById('asciiCanvas');
  const frame = document.getElementById('canvasFrame');
  const leftPanel = document.querySelector('.left-panel');
  const rightPanel = document.querySelector('.right-panel');
  if (!canvas || !frame || !leftPanel || !rightPanel) return;

  const $ = id => document.getElementById(id);
  const TOOL_NAMES = {
    brush: 'Кисть', eraser: 'Ластик', lighten: 'Осветлить', darken: 'Тень',
    line: 'Линия', rect: 'Рамка', fill: 'Заливка', picker: 'Пипетка'
  };
  const TOOL_KEYS = {brush:'Q',eraser:'W',lighten:'E',darken:'R',line:'T',rect:'Y',fill:'U',picker:'I'};

  function layerApi() { return window.GlyphForgeLayers || null; }
  function activeToolButton() { return leftPanel.querySelector('.tool-button.active'); }
  function currentTool() { return activeToolButton()?.dataset.tool || 'brush'; }
  function selectTool(tool) { leftPanel.querySelector(`.tool-button[data-tool="${tool}"]`)?.click(); }
  function clickId(id) { $(id)?.click(); }
  function inputValue(id) { return $(id)?.value; }
  function checked(id) { return !!$(id)?.checked; }
  function setControl(id, value, eventName) {
    const el = $(id); if (!el) return;
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
    el.dispatchEvent(new Event(eventName || (el.type === 'range' ? 'input' : 'change'), { bubbles: true }));
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(String(text)); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = String(text); document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
  }
  function hexToRgb(hex) {
    const value = String(hex || '').replace('#','');
    const normalized = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
    return [0,2,4].map(i => parseInt(normalized.slice(i,i+2),16));
  }
  function activeLayer() {
    const api = layerApi(); if (!api) return null;
    const id = api.getActiveId?.();
    return api.getLayers?.().find(layer => layer.id === id) || api.getLayers?.()[0] || null;
  }
  function layerById(id) { return layerApi()?.getLayers?.().find(layer => layer.id === id) || null; }
  function activeLayerName() { return activeLayer()?.name || 'Рисунок'; }

  function cellFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cols = Math.max(1, Number($('colsInput')?.value) || 80);
    const rows = Math.max(1, Number($('rowsInput')?.value) || 42);
    const x = Math.max(0, Math.min(cols - 1, Math.floor((clientX - rect.left) / Math.max(1, rect.width) * cols)));
    const y = Math.max(0, Math.min(rows - 1, Math.floor((clientY - rect.top) / Math.max(1, rect.height) * rows)));
    return { x, y };
  }
  function glyphFromDensity(density) {
    const chars = Array.from($('charsetInput')?.value || '@%#*+=-:. ');
    if (!chars.length) return ' ';
    const d = Math.max(0, Math.min(1, Number(density) || 0));
    const index = Math.round((1 - d) * (chars.length - 1));
    return chars[Math.max(0, Math.min(chars.length - 1, index))] || ' ';
  }
  function activeCell(cell) {
    const layer = activeLayer();
    if (!layer) return null;
    const glyph = layer.glyphs?.[cell.y]?.[cell.x] ?? glyphFromDensity(layer.density?.[cell.y]?.[cell.x]);
    const color = layer.colors?.[cell.y]?.[cell.x] || $('fgColor')?.value || '#8dff00';
    const density = layer.density?.[cell.y]?.[cell.x] ?? 0;
    return { glyph, color, density };
  }
  function setCurrentGlyph(glyph) {
    const input = $('charInput'); if (!input) return;
    input.value = glyph || ' ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function setFg(color) { if (color) setControl('fgColor', color, 'input'); }
  function setBg(color) { if (color) setControl('bgColor', color, 'input'); }

  function syntheticStroke(tool, point, options = {}) {
    const previousTool = currentTool();
    const previousSize = inputValue('sizeRange');
    if (options.size != null) setControl('sizeRange', options.size, 'input');
    selectTool(tool);
    const common = {
      bubbles: true, cancelable: true, composed: true, pointerId: 991,
      pointerType: 'mouse', isPrimary: true, clientX: point.clientX, clientY: point.clientY
    };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...common, button: 0, buttons: 1, pressure: .5 }));
    window.dispatchEvent(new PointerEvent('pointerup', { ...common, button: 0, buttons: 0, pressure: 0 }));
    if (previousSize != null && options.size != null) setControl('sizeRange', previousSize, 'input');
    selectTool(previousTool);
  }

  function openBrushSettings() {
    const button = document.querySelector('.brush-settings-button');
    if (button && !button.classList.contains('active')) button.click();
  }

  function activePresetValue() { return $('brushPresetSelect')?.value || ''; }

  class ContextMenuManager {
    constructor() {
      this.root = document.createElement('div');
      this.root.className = 'gf-context-root';
      document.body.appendChild(this.root);
      this.menus = [];
      this.typeBuffer = '';
      this.typeTimer = 0;
      document.addEventListener('pointerdown', e => {
        if (!this.root.contains(e.target)) this.close();
      }, true);
      window.addEventListener('blur', () => this.close());
      window.addEventListener('resize', () => this.close());
      document.addEventListener('keydown', e => this.onKeyDown(e), true);
    }

    close(fromIndex = 0) {
      while (this.menus.length > fromIndex) this.menus.pop()?.remove();
      if (!this.menus.length) {
        document.body.classList.remove('gf-context-open');
        this.typeBuffer = '';
      }
    }

    open(model, x, y, options = {}) {
      this.close();
      document.body.classList.add('gf-context-open');
      const menu = this.createMenu(model, options);
      this.root.appendChild(menu);
      this.menus.push(menu);
      this.position(menu, x, y);
      menu.focus({ preventScroll: true });
    }

    createMenu(model, options = {}) {
      const menu = document.createElement('div');
      menu.className = `gf-context-menu ${options.className || ''}`.trim();
      menu.tabIndex = -1;
      menu.setAttribute('role', 'menu');
      if (model.header) {
        const header = document.createElement('div');
        header.className = 'gf-context-header';
        header.innerHTML = `<strong>${this.escape(model.header.title || '')}</strong>${model.header.subtitle ? `<small>${this.escape(model.header.subtitle)}</small>` : ''}`;
        menu.appendChild(header);
      }
      (model.items || []).forEach(item => {
        if (!item || item.hidden) return;
        if (item.type === 'separator') {
          const sep = document.createElement('div'); sep.className = 'gf-context-separator'; sep.setAttribute('role','separator'); menu.appendChild(sep); return;
        }
        if (item.type === 'title') {
          const title = document.createElement('div'); title.className = 'gf-context-item-title'; title.textContent = item.label; menu.appendChild(title); return;
        }
        menu.appendChild(this.createItem(item, menu));
      });
      return menu;
    }

    createItem(item, parentMenu) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `gf-context-item${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`;
      button.setAttribute('role', item.radio ? 'menuitemradio' : item.checkable ? 'menuitemcheckbox' : 'menuitem');
      button.tabIndex = -1;
      if (item.disabled) button.setAttribute('aria-disabled','true');
      if (item.radio || item.checkable) button.setAttribute('aria-checked', String(!!item.checked));
      button.dataset.menuLabel = item.label || '';
      const icon = document.createElement('span'); icon.className = 'gf-context-icon';
      if (item.color) {
        icon.className += ' gf-context-color-chip'; icon.style.setProperty('--chip-color', item.color);
      } else if (item.checked) icon.innerHTML = '<span class="gf-context-check">✓</span>';
      else icon.textContent = item.icon || '';
      const label = document.createElement('span'); label.className = 'gf-context-label'; label.textContent = item.label || '';
      const shortcut = document.createElement('span'); shortcut.className = 'gf-context-shortcut'; shortcut.textContent = item.shortcut || item.value || '';
      const arrow = document.createElement('span'); arrow.className = 'gf-context-arrow'; arrow.textContent = item.submenu ? '›' : '';
      button.append(icon, label, shortcut, arrow);

      if (item.submenu) {
        button.dataset.hasSubmenu = 'true';
        button.addEventListener('pointerenter', () => this.openSubmenu(button, item.submenu, parentMenu));
        button.addEventListener('click', e => { e.stopPropagation(); this.openSubmenu(button, item.submenu, parentMenu, true); });
      } else if (!item.disabled) {
        button.addEventListener('click', e => {
          e.stopPropagation(); this.close();
          requestAnimationFrame(() => item.action?.());
        });
      }
      button.addEventListener('pointerenter', () => {
        this.activate(button, parentMenu);
        if (!item.submenu) this.closeSubmenusAfter(parentMenu);
      });
      return button;
    }

    openSubmenu(button, submenuModel, parentMenu, focus = false) {
      const parentIndex = this.menus.indexOf(parentMenu);
      this.close(parentIndex + 1);
      const submenu = this.createMenu(submenuModel, { className: 'compact' });
      this.root.appendChild(submenu); this.menus.push(submenu);
      button.classList.add('submenu-open');
      const rect = button.getBoundingClientRect();
      submenu.style.visibility = 'hidden';
      const bounds = submenu.getBoundingClientRect();
      let x = rect.right + 4;
      if (x + bounds.width > innerWidth - 6) x = rect.left - bounds.width - 4;
      let y = rect.top - 5;
      if (y + bounds.height > innerHeight - 6) y = Math.max(6, innerHeight - bounds.height - 6);
      submenu.style.left = `${Math.max(6,x)}px`; submenu.style.top = `${y}px`; submenu.style.visibility = '';
      if (focus) { const first = this.items(submenu)[0]; if (first) this.activate(first, submenu); submenu.focus({ preventScroll:true }); }
    }

    closeSubmenusAfter(menu) {
      const index = this.menus.indexOf(menu);
      if (index >= 0) this.close(index + 1);
    }

    position(menu, x, y) {
      menu.style.visibility = 'hidden';
      menu.style.left = `${x}px`; menu.style.top = `${y}px`;
      const rect = menu.getBoundingClientRect();
      const left = Math.max(6, Math.min(x, innerWidth - rect.width - 6));
      const top = Math.max(6, Math.min(y, innerHeight - rect.height - 6));
      menu.style.left = `${left}px`; menu.style.top = `${top}px`; menu.style.visibility = '';
    }

    items(menu) { return [...menu.querySelectorAll(':scope > .gf-context-item:not(.disabled)')]; }
    active(menu) { return menu.querySelector(':scope > .gf-context-item.active'); }
    activate(item, menu) { this.items(menu).forEach(el => el.classList.toggle('active', el === item)); }

    onKeyDown(event) {
      if (!this.menus.length) return;
      const menu = this.menus[this.menus.length - 1];
      const items = this.items(menu);
      if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
      if (!items.length) return;
      let index = Math.max(0, items.indexOf(this.active(menu)));
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; this.activate(items[index], menu); return;
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); this.activate(items[event.key === 'Home' ? 0 : items.length - 1], menu); return;
      }
      if (event.key === 'ArrowRight') {
        const item = this.active(menu) || items[0]; if (item.dataset.hasSubmenu) { event.preventDefault(); item.click(); } return;
      }
      if (event.key === 'ArrowLeft' && this.menus.length > 1) {
        event.preventDefault(); this.close(this.menus.length - 1); this.menus.at(-1)?.focus({preventScroll:true}); return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); (this.active(menu) || items[0]).click(); return;
      }
      if (event.key.length === 1 && /\S/.test(event.key)) {
        clearTimeout(this.typeTimer); this.typeBuffer += event.key.toLocaleLowerCase();
        const match = items.find(item => item.dataset.menuLabel.toLocaleLowerCase().startsWith(this.typeBuffer));
        if (match) this.activate(match, menu);
        this.typeTimer = setTimeout(() => { this.typeBuffer = ''; }, 650);
      }
    }

    escape(text) { return String(text).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
  }

  const manager = new ContextMenuManager();
  const sep = () => ({ type:'separator' });
  const title = label => ({ type:'title', label });
  const item = (label, action, extra={}) => ({ label, action, ...extra });
  const toggleItem = (label, id, extra={}) => item(label, () => { const el=$(id); if(el){el.checked=!el.checked;el.dispatchEvent(new Event('change',{bubbles:true}));}}, { checkable:true, checked:checked(id), ...extra });
  const radioItem = (label, checkedValue, action, extra={}) => item(label, action, { radio:true, checked:!!checkedValue, ...extra });
  const submenu = (items, header=null) => ({ header, items });

  function numericSubmenu(id, values, suffix='') {
    const current = Number(inputValue(id));
    const list = [...new Set([current, ...values])].filter(Number.isFinite).sort((a,b)=>a-b);
    return submenu(list.map(v => radioItem(`${v}${suffix}`, current === v, () => setControl(id, v, 'input'))));
  }
  function selectSubmenu(id, map) {
    const el = $(id); const current = el?.value;
    if (!el) return submenu([]);
    const options = [...el.options].map(o => ({ value:o.value, label:map?.[o.value] || o.textContent }));
    return submenu(options.map(o => radioItem(o.label, current === o.value, () => setControl(id, o.value, 'change'))));
  }

  function layerSubmenu() {
    const api = layerApi(); if (!api) return submenu([item('Layer Engine недоступен', null, {disabled:true})]);
    const activeId = api.getActiveId?.();
    return submenu((api.getLayers?.() || []).map(layer => radioItem(layer.name, layer.id === activeId, () => api.select?.(layer.id), { icon: layer.visible ? '◉' : '○' })));
  }

  function brushQuickItems(tool) {
    const common = [
      item('Настройки кисти…', openBrushSettings, { icon:'⚙' }),
      item('Размер', null, { submenu:numericSubmenu('sizeRange',[1,3,5,9,15,25,41,61]), value:inputValue('sizeRange') }),
      item('Жёсткость', null, { submenu:numericSubmenu('hardnessRange',[0,25,50,75,100],'%'), value:`${inputValue('hardnessRange')}%` })
    ];
    if (tool === 'brush' || tool === 'eraser') {
      common.push(item('Поток / Flow', null, { submenu:numericSubmenu('flowRange',[5,10,25,50,75,100],'%'), value:`${inputValue('flowRange')}%` }));
    }
    if (tool === 'brush' || tool === 'lighten' || tool === 'darken') {
      common.push(item('Сила / Opacity', null, { submenu:numericSubmenu('opacityRange',[10,25,50,75,100],'%'), value:`${inputValue('opacityRange')}%` }));
    }
    return common;
  }

  function toolMenu(tool, button) {
    const label = TOOL_NAMES[tool] || tool;
    const items = [];
    if (currentTool() !== tool) items.push(item(`Выбрать «${label}»`, () => button.click(), { icon:'✓', shortcut:TOOL_KEYS[tool] }));

    if (['brush','eraser','lighten','darken'].includes(tool)) {
      items.push(...brushQuickItems(tool), sep());
      if (tool === 'brush') {
        items.push(item('Пресет кисти', null, {
          submenu: submenu([...($('brushPresetSelect')?.options || [])].map(option => radioItem(option.textContent, option.value === activePresetValue(), () => {
            $('brushPresetSelect').value = option.value; clickId('applyBrushPresetBtn');
          })))
        }));
        items.push(item('Сохранить текущую кисть', () => clickId('saveBrushBtn')));
        items.push(item('Экспортировать .gbrush', () => clickId('exportBrushBtn')));
      }
    } else if (tool === 'line' || tool === 'rect') {
      items.push(item('Размер линии', null, { submenu:numericSubmenu('sizeRange',[1,3,5,9,15,25]), value:inputValue('sizeRange') }));
      items.push(item('Форма наконечника', null, { submenu:selectSubmenu('tipSelect') }));
      items.push(item('Snap angle', null, { submenu:selectSubmenu('snapAngle') }));
      items.push(item('Симметрия', null, { submenu:selectSubmenu('symmetry') }));
      items.push(sep(), item('Расширенные настройки…', openBrushSettings, {icon:'⚙'}));
    } else if (tool === 'fill') {
      items.push(item('Режим заливки', null, { submenu:selectSubmenu('brushMode') }));
      items.push(item('Текущий glyph', null, { disabled:true, value:$('charInput')?.value || ' ' }));
      items.push(item('Текущий цвет', null, { disabled:true, color:$('fgColor')?.value, value:$('fgColor')?.value }));
    } else if (tool === 'picker') {
      items.push(item('Пипетка берёт glyph + цвет', null, { disabled:true, icon:'⌾' }));
      items.push(item('Подсказка', null, { disabled:true, value:'ПКМ по холсту' }));
    }

    return { header:{title:label, subtitle:`Инструмент · ${TOOL_KEYS[tool] || ''}`}, items };
  }

  function canvasMenu(event) {
    const cell = cellFromClient(event.clientX, event.clientY);
    const cellData = activeCell(cell);
    const tool = currentTool();
    const api = layerApi();
    const active = activeLayer();
    const layerLocked = !!active?.locked;
    const items = [];

    if (['brush','eraser','lighten','darken'].includes(tool)) items.push(...brushQuickItems(tool), sep());
    else if (tool === 'line' || tool === 'rect') items.push(
      item('Snap angle', null, {submenu:selectSubmenu('snapAngle')}),
      item('Симметрия', null, {submenu:selectSubmenu('symmetry')}), sep()
    );

    items.push(title('Ячейка'));
    items.push(item('Взять glyph + цвет', () => {
      if (cellData) { setCurrentGlyph(cellData.glyph); setFg(cellData.color); }
      else syntheticStroke('picker', event);
    }, { icon:'⌾' }));
    items.push(item('Копировать glyph', () => copyText(cellData?.glyph ?? ''), { disabled:!cellData, value:cellData?.glyph === ' ' ? '␠' : cellData?.glyph }));
    items.push(item('Копировать цвет', () => copyText(cellData?.color ?? ''), { disabled:!cellData, color:cellData?.color, value:cellData?.color }));
    items.push(item('Очистить ячейку', () => syntheticStroke('eraser', event, {size:1}), { danger:false, disabled:layerLocked, icon:'⌫' }));

    items.push(sep(), title('Правка'));
    items.push(item('Отменить', () => clickId('undoBtn'), { shortcut:'Ctrl+Z', disabled:!!$('undoBtn')?.disabled }));
    items.push(item('Вернуть', () => clickId('redoBtn'), { shortcut:'Ctrl+Y', disabled:!!$('redoBtn')?.disabled }));

    items.push(sep(), title('Слой'));
    items.push(item(`Активный: ${active?.name || 'Рисунок'}`, null, { submenu:layerSubmenu(), icon:layerLocked?'◆':'◇' }));
    items.push(item('Новый слой', () => api?.add?.('Новый слой'), { icon:'＋', disabled:!api }));
    items.push(item('Дублировать активный', () => api?.duplicate?.(api.getActiveId?.()), { icon:'⧉', disabled:!api }));
    items.push(item('Объединить с нижним', () => api?.mergeDown?.(api.getActiveId?.()), { icon:'⇣', disabled:!api || layerLocked }));

    items.push(sep(), title('Вид'));
    items.push(item('Масштаб', null, { submenu:numericSubmenu('zoomRange',[50,75,100,125,150,200],'%'), value:`${inputValue('zoomRange')}%` }));
    items.push(toggleItem('Сетка','gridToggle'));
    items.push(toggleItem('Оси симметрии','symmetryGuideToggle'));
    items.push(toggleItem('Рыбий глаз','fishEyeToggle'));

    items.push(sep());
    items.push(item('Копировать ASCII', () => clickId('copyBtn'), { shortcut:'Ctrl+C*' }));
    items.push(item('Экспорт PNG', () => clickId('exportPngBtn'), { icon:'⇩' }));

    return { header:{title:`Холст · x:${cell.x} y:${cell.y}`, subtitle:`${TOOL_NAMES[tool]} · ${active?.name || 'Рисунок'}${layerLocked?' · заблокирован':''}`}, items };
  }

  function layerMenu(row) {
    const api = layerApi(); const id = row.dataset.layerId; const layer = layerById(id);
    if (!api || !layer) return { header:{title:'Слои'}, items:[item('Layer Engine недоступен',null,{disabled:true})] };
    const layers = api.getLayers?.() || [];
    const currentIndex = layers.findIndex(x => x.id === id);
    const rename = () => { const next=prompt('Название слоя:', layer.name); if(next?.trim() && next.trim()!==layer.name) api.rename?.(id,next.trim()); };
    const orderMenu = submenu([
      item('Поднять выше', () => api.moveUp?.(id), {disabled:currentIndex===layers.length-1, shortcut:'↑'}),
      item('Опустить ниже', () => api.moveDown?.(id), {disabled:currentIndex===0, shortcut:'↓'}),
      sep(),
      item('На самый верх', () => { for(let i=currentIndex;i<layers.length-1;i++) api.moveUp?.(id); }, {disabled:currentIndex===layers.length-1}),
      item('В самый низ', () => { for(let i=currentIndex;i>0;i--) api.moveDown?.(id); }, {disabled:currentIndex===0})
    ]);
    const blendMap={normal:'Normal',add:'Add',multiply:'Multiply',screen:'Screen',difference:'Difference',max:'Max density',min:'Min density'};
    const blendMenu=submenu(Object.entries(blendMap).map(([value,label])=>radioItem(label,layer.blendMode===value,()=>api.setBlendMode?.(id,value))));
    const opacityMenu=submenu([25,50,75,100].map(v=>radioItem(`${v}%`,Math.round(layer.opacity*100)===v,()=>api.setOpacity?.(id,v/100))));

    return {
      header:{title:layer.name,subtitle:`Glyph layer · ${Math.round(layer.opacity*100)}% · ${layer.blendMode}`},
      items:[
        item('Переименовать',rename,{shortcut:'F2'}),
        item('Дублировать',()=>api.duplicate?.(id),{icon:'⧉'}),
        sep(),
        item(layer.visible?'Скрыть':'Показать',()=>api.toggleVisibility?.(id),{checkable:true,checked:!!layer.visible,icon:'◉'}),
        item(layer.locked?'Разблокировать':'Заблокировать',()=>api.toggleLock?.(id),{checkable:true,checked:!!layer.locked,icon:layer.locked?'◆':'◇'}),
        item('Непрозрачность',null,{submenu:opacityMenu,value:`${Math.round(layer.opacity*100)}%`}),
        item('Режим наложения',null,{submenu:blendMenu,value:blendMap[layer.blendMode]||layer.blendMode}),
        sep(),
        item('Порядок слоя',null,{submenu:orderMenu,icon:'↕'}),
        item('Объединить с нижним',()=>api.mergeDown?.(id),{icon:'⇣',disabled:currentIndex<=0 || layer.locked}),
        sep(),
        item('Удалить слой',()=>{ if(layers.length<=1 || confirm(`Удалить слой «${layer.name}»?`)) api.remove?.(id); },{danger:true,icon:'⌫',disabled:layers.length<=1})
      ]
    };
  }

  function layersBlankMenu() {
    const api=layerApi(); const id=api?.getActiveId?.();
    return {header:{title:'Слои',subtitle:`${api?.getLayers?.().length || 0} в документе`},items:[
      item('Новый слой',()=>api?.add?.('Новый слой'),{icon:'＋',disabled:!api}),
      item('Дублировать активный',()=>api?.duplicate?.(id),{icon:'⧉',disabled:!api}),
      sep(),
      item('Свести изображение',()=>{ if(api && confirm('Свести все слои в один?')) api.flatten?.(); },{icon:'▤',disabled:!api})
    ]};
  }

  function colorMenu(target) {
    let color = null;
    if (target.matches('input[type="color"]')) color = target.value;
    else if (target.closest('.quick-color-swatch')) color = getComputedStyle(target.closest('.quick-color-swatch')).getPropertyValue('--swatch-color').trim();
    color ||= $('fgColor')?.value || '#8dff00';
    const rgb=hexToRgb(color);
    return {header:{title:color.toUpperCase(),subtitle:rgb?`rgb(${rgb.join(', ')})`:'Цвет'},items:[
      item('Использовать как основной',()=>setFg(color),{color}),
      item('Использовать как фон',()=>setBg(color),{color}),
      sep(),
      item('Копировать HEX',()=>copyText(color.toUpperCase()),{value:color.toUpperCase()}),
      item('Копировать RGB',()=>rgb&&copyText(`rgb(${rgb.join(', ')})`),{disabled:!rgb,value:rgb?rgb.join(', '):''}),
      sep(),
      item('Поменять FG / BG местами',()=>{const fg=$('fgColor')?.value,bg=$('bgColor')?.value;if(fg&&bg){setFg(bg);setBg(fg);}}, {icon:'⇄'}),
      item('Сбросить цвета',()=>{setFg('#8dff00');setBg('#050806');})
    ]};
  }

  function glyphMenu(target) {
    const charButton=target.closest('.char-button');
    const chip=target.closest('.chip');
    const char=charButton?.dataset.char ?? $('charInput')?.value ?? '#';
    if (chip) {
      return {header:{title:'Charset',subtitle:chip.textContent.trim()},items:[
        item('Применить charset',()=>chip.click(),{icon:'✓'}),
        item('Инвертировать порядок',()=>{const el=$('charsetInput');if(el){el.value=Array.from(el.value).reverse().join('');el.dispatchEvent(new Event('input',{bubbles:true}));}}),
        item('Копировать charset',()=>copyText(chip.dataset.charset || ''))
      ]};
    }
    return {header:{title:char===' '?'Пробел':char,subtitle:'Glyph'},items:[
      item('Выбрать символ',()=>setCurrentGlyph(char),{icon:'✓'}),
      item('Копировать символ',()=>copyText(char),{value:char===' '?'␠':char}),
      sep(),
      item('Использовать в Normal brush',()=>{setCurrentGlyph(char);setControl('brushMode','normal','change');})
    ]};
  }

  function brushesMenu() {
    const select=$('brushPresetSelect'); const value=select?.value || ''; const option=select?.selectedOptions?.[0];
    return {header:{title:option?.textContent || 'Кисти',subtitle:value.startsWith('custom:')?'Пользовательский пресет':'Пресет кисти'},items:[
      item('Применить выбранный',()=>clickId('applyBrushPresetBtn'),{icon:'✓',disabled:!value}),
      item('Открыть настройки кисти…',openBrushSettings,{icon:'⚙'}),
      sep(),
      item('Сохранить текущую кисть',()=>clickId('saveBrushBtn')),
      item('Экспортировать .gbrush',()=>clickId('exportBrushBtn')),
      item('Импортировать .gbrush',()=>clickId('importBrushBtn')),
      sep(),
      item('Удалить пользовательский пресет',()=>clickId('deleteCustomBrushBtn'),{danger:true,disabled:!value.startsWith('custom:')})
    ]};
  }

  function inspectorMenu(target) {
    const tab=target.closest('.inspector-tab');
    const pages=[...document.querySelectorAll('.inspector-tab')];
    return {header:{title:tab?.textContent.trim() || 'Инспектор',subtitle:'Правая панель'},items:[
      item('Панель',null,{submenu:submenu(pages.map(button=>radioItem(button.textContent.trim(),button.classList.contains('active'),()=>button.click())))}),
      sep(),
      item('Слои',()=>pages.find(x=>x.textContent.trim()==='Слои')?.click()),
      item('Цвет',()=>pages.find(x=>x.textContent.trim()==='Цвет')?.click()),
      item('Глифы',()=>pages.find(x=>x.textContent.trim()==='Глифы')?.click()),
      item('Кисти',()=>pages.find(x=>x.textContent.trim()==='Кисти')?.click())
    ]};
  }

  function resolveContext(target, event) {
    const toolButton=target.closest('.left-panel .tool-button');
    if (toolButton) return {kind:'tool', model:toolMenu(toolButton.dataset.tool,toolButton)};

    if (target === canvas || target.closest('#canvasFrame')) return {kind:'canvas', model:canvasMenu(event)};

    const layerRow=target.closest('.gf-layer-row');
    if (layerRow) return {kind:'layer', model:layerMenu(layerRow)};
    if (target.closest('.inspector-page[data-inspector-page="layers"]')) return {kind:'layers', model:layersBlankMenu()};
    if (target.closest('.inspector-page[data-inspector-page="color"]')) return {kind:'color', model:colorMenu(target)};
    if (target.closest('.inspector-page[data-inspector-page="glyphs"]')) return {kind:'glyph', model:glyphMenu(target)};
    if (target.closest('.inspector-page[data-inspector-page="brushes"]')) return {kind:'brushes', model:brushesMenu(target)};
    if (target.closest('.right-panel')) return {kind:'inspector', model:inspectorMenu(target)};
    return null;
  }

  document.addEventListener('contextmenu', event => {
    const resolved=resolveContext(event.target,event);
    if (!resolved) return;
    event.preventDefault(); event.stopPropagation();
    manager.open(resolved.model,event.clientX,event.clientY,{className:resolved.kind==='canvas'?'wide':''});
  }, true);

  document.addEventListener('keydown', event => {
    if (!(event.shiftKey && event.key === 'F10')) return;
    const target=document.activeElement;
    let fakeTarget=target;
    if (!fakeTarget || fakeTarget===document.body) fakeTarget=canvas;
    const rect=fakeTarget.getBoundingClientRect?.() || canvas.getBoundingClientRect();
    const synthetic={target:fakeTarget,clientX:rect.left+Math.min(24,rect.width/2),clientY:rect.top+Math.min(24,rect.height/2)};
    const resolved=resolveContext(fakeTarget,synthetic);
    if (!resolved) return;
    event.preventDefault(); manager.open(resolved.model,synthetic.clientX,synthetic.clientY);
  }, true);

  window.GlyphForgeContextMenu = { close:()=>manager.close(), openFor:(target,x,y)=>{const resolved=resolveContext(target,{target,clientX:x,clientY:y});if(resolved)manager.open(resolved.model,x,y);} };
})();

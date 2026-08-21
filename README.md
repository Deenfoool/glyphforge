# GlyphForge

GlyphForge — браузерный ASCII / glyph-art редактор, где рисунок строится из букв, цифр и символов. Проект работает полностью в браузере и публикуется через GitHub Pages как статический сайт.

## Brush Engine 1.0

Внутренняя модель хранит **плотность 0–1 отдельно от символа**. Символ выбирается из активной шкалы плотности при рендере, поэтому один и тот же рисунок можно мгновенно переводить между разными charset-палитрами.

Поддерживается:

- Size, Hardness, Opacity, Flow, Spacing, Smoothing и Stabilizer;
- профили края Hard / Soft / Linear / Gaussian / Custom;
- круг, квадрат, эллипс, линия, ромб, custom ASCII mask и pattern tip;
- Roundness и Angle;
- Airbrush / Build-up;
- Shape Dynamics: Size/Angle/Roundness Jitter, Minimum Diameter;
- Scatter X/Y, Count и Count Jitter;
- Glyph Dynamics: Character/Density/Color Jitter, Sequence, Direction и Orientation glyphs;
- скорость мыши → размер/плотность;
- pressure stylus → Size / Flow / Density / Scatter;
- pen tilt → Angle;
- текстуры Hatch, Cross Hatch, Dots, Checker, Noise, Matrix, Bricks;
- Dual Brush;
- blend modes Replace, Add, Subtract, Max, Min, Multiply, Screen, Difference;
- Preserve Detail, Edge Protect / Enhance;
- Directional Shading с направлением света;
- Snap Angle;
- Mirror X/Y/XY, Radial 4/8;
- deterministic Random Seed;
- live preview кисти;
- Brush History;
- Lock параметров при переключении пресетов;
- встроенные пресеты: Hard/Soft Pencil, Shade, Airbrush, Chalk, Noise, Spray, Hair, Grass, Smoke, Cloud, Hatching, Cross Hatch, Pixel, Glitch, Terminal, Matrix, Ink, Calligraphy;
- пользовательские пресеты и экспорт/импорт `.gbrush`.

## Редактор

- кисть, ластик, осветление, тень, линия, рамка, заливка, пипетка;
- изменение сетки и автоматическое заполнение видимой CRT-области холстом;
- zoom колесом мыши над холстом;
- pan через `Space + drag` или среднюю кнопку;
- Undo / Redo;
- цвет символов и фон;
- Image → ASCII с контрастом, инверсией и исходными цветами;
- подложка изображения для ручной обводки;
- CRT day/night, scanlines, glow и fish-eye;
- экспорт PNG / TXT;
- формат проекта `.glyph`;
- локальное автосохранение.

## Горячие клавиши

- `Q` — кисть
- `W` — ластик
- `E` — осветлить
- `R` — тень
- `T` — линия
- `Y` — рамка
- `U` — заливка
- `I` — пипетка
- `[` / `]` — размер кисти
- `Ctrl/Cmd + Z` — Undo
- `Ctrl/Cmd + Y` — Redo
- `Space + drag` — перемещение холста

## GitHub Pages

Репозиторий рассчитан на `Deploy from a branch` → `main` → `/(root)`. Файл `.nojekyll` отключает Jekyll-сборку.
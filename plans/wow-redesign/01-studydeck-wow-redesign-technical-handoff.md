# StudyDeck AI: технический handoff «Пятиминутная редакционная студия»

Этот документ предназначен для Codex, который будет реализовывать редизайн в монорепозитории `D:\presentation`.

Документ фиксирует утверждённую пользователем концепцию, привязывает её к текущему коду и запрещает подключать параллельные библиотеки, когда нужная возможность уже есть в проекте.

## 1. Результат, которого нужно добиться

StudyDeck должен восприниматься как современная пятиминутная студия презентаций для студентов.

Ключевое обещание публичного лендинга:

> Я написал одну тему — и через пять минут у меня есть яркая презентация и готовая речь.

Пользователь должен получить два последовательных «вау»-эффекта:

1. визуальный — крупная редакционная композиция, выразительные демонстрационные слайды, асимметрия, светлые и тёмные сцены, заметная автоматическая демонстрация;
2. продуктовый — понимание, что для запуска достаточно одной темы, а результат включает и презентацию, и связный текст выступления.

Утверждённые продуктовые решения:

- основная аудитория — студенты;
- публичный лендинг предназначен прежде всего для новых пользователей;
- обращение на публичных страницах — на «ты»;
- обещание «за 5 минут» можно использовать прямо;
- дизайн должен сочетать срочность перед выступлением и удовольствие от готового результата;
- первый экран должен содержать заметную автоматическую демонстрацию;
- примеры презентаций могут быть специально подготовленными безупречными showcase-работами;
- showcase-работы должны заметно отличаться друг от друга;
- публичная шапка должна быть отделена от навигации личного кабинета;
- максимальная выразительность нужна на `/`, `/new`, этапах генерации, в редакторе и экспорте;
- dashboard, проекты, папки, профиль, тариф и админка остаются спокойнее.

## 2. Творческое направление

Рабочее название системы:

> Пятиминутная редакционная студия

Визуальная формула:

- крупная типографика;
- реальные изображения, схемы, данные и презентационные композиции;
- асимметричная редакционная сетка;
- один большой визуальный объект вместо множества одинаковых карточек;
- чередование светлых рабочих полей и крупных тёмных сцен;
- стопка слайдов 16:9 и лист речи как повторяемый фирменный мотив;
- оранжевый означает скорость и действие;
- фиолетовый означает AI-преобразование;
- зелёный появляется только в момент надёжной готовности;
- тёмный шоколадный editor-цвет используется как сцена для яркого контента.

Локальные референсы пользователя, доступные на этой машине:

- `C:\Users\Борис.BORIS\Downloads\Build Your Dream Home in 2025_ Real Estate Landing Page.jfif`;
- `C:\Users\Борис.BORIS\Downloads\Desarrollo de webs online profesionales para tu negocio en pocos días.jfif`;
- `C:\Users\Борис.BORIS\Downloads\Open Trip Travel Website Design Inspiration & UI Ideas.jfif`.

Референсы нельзя копировать буквально или использовать как изображения сайта. Из них нужно взять только принципы:

- из real-estate референса — ясную модульность, разные размеры блоков и сочетание светлых/тёмных поверхностей;
- из Armonia — воздух, редакционный ритм и асимметрию текста с изображениями;
- из Visa Travels — масштаб первого экрана, большие изображения, крупную типографику и секции без тотальной карточной упаковки.

### Запрещённые визуальные решения

- gradient text;
- декоративные AI-градиенты как главный приём;
- тяжёлый glassmorphism;
- бесконечно летающие фигуры;
- случайные blob-формы, не связанные со слайдами или речью;
- одинаковые сетки `иконка + заголовок + абзац`;
- hand-drawn/sketchy иллюстрации;
- side-stripe borders;
- broad shadow и видимая 1px-рамка одновременно на обычной карточке;
- радиусы больше 24px на обычных прямоугольных поверхностях;
- autoplay-карусели с постоянным движением;
- bounce, spring и elastic motion;
- анимация каждого блока при каждом скролле;
- скрытие важного контента до срабатывания JavaScript-анимации.

## 3. Сначала провести обязательный аудит

Перед реализацией:

1. Прочитать корневой `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` и `.impeccable/design.json`.
2. Выполнить:

   ```powershell
   git -c safe.directory=D:/presentation status --short
   git -c safe.directory=D:/presentation diff --name-only
   ```

3. Считать все существующие изменения пользовательскими, пока не доказано обратное.
4. Не откатывать и не форматировать несвязанные файлы.
5. Повторно проверить активные импорты экранов: в репозитории есть старые и новые варианты некоторых компонентов.
6. Зафиксировать baseline-скриншоты ключевых маршрутов на `http://localhost:3020` или, если dev preview ещё не запущен, сначала запустить его по правилам раздела проверки.

На момент написания handoff рабочее дерево уже содержит изменения в `apps/api`, `apps/web`, `packages/shared` и `apps/web/tsconfig.tsbuildinfo`. Будущая реализация обязана повторно проверить актуальный список и аккуратно интегрироваться с ним.

## 4. Текущая архитектура, которую нужно сохранить

### Приложение и shell

- `apps/web/src/app/layout.tsx`
  - серверный root layout;
  - загружает локальный Nunito;
  - получает Auth.js session;
  - подключает `SessionProvider`, `AppQueryProvider` и `AppChrome`.
- `apps/web/src/components/app-chrome.tsx`
  - клиентская маршрутизация shell;
  - сейчас использует один `AppHeader` почти для всех страниц;
  - подключает `MotionProvider`, `PageTransition` и мобильную нижнюю навигацию.
- `apps/web/src/components/app-header.tsx`
  - текущая навигация личного кабинета;
  - использует `lucide-react` и Radix DropdownMenu;
  - не должна оставаться публичной маркетинговой шапкой.
- `apps/web/src/components/mobile-bottom-nav.tsx`
  - нижняя навигация только для авторизованных продуктовых маршрутов.

### Активные страницы и компоненты

| Маршрут | Активная реализация |
|---|---|
| `/` | `apps/web/src/app/page.tsx` |
| `/login` | `apps/web/src/app/login/page.tsx`, `telegram-sign-in-button.tsx` |
| `/dashboard` | `dashboard/page.tsx` → `dashboard/dashboard-overview.tsx` |
| `/projects` | `projects/page.tsx` → `projects/projects-view.tsx`, `projects-toolbar.tsx`, `project-row.tsx` |
| `/folders` | `folders/page.tsx` → `folders/folders-manager.tsx` |
| `/profile` | `profile/page.tsx` → `profile/profile-view.tsx` |
| `/pricing` | `pricing/page.tsx` |
| `/billing` | redirect на `/pricing`; отдельного UI сейчас нет |
| `/new` | `new/page.tsx` → `new-project-form.tsx` |
| `/projects/[id]/script` | `project-script-review-query.tsx` |
| `/projects/[id]/editor` | `project-editor.tsx` |
| `/projects/[id]/export` | `export-panel-query.tsx` |
| `/invite/[token]` | `invitations/invitation-view.tsx` |
| `/admin/**` | `admin/admin-shell.tsx` и соответствующие admin-компоненты |

Не редизайнить устаревшие варианты только из-за похожего имени. Сначала подтвердить импорт через `rg`.

На момент handoff активные маршруты не используют как основной UI:

- `apps/web/src/components/project-script-review.tsx`;
- `apps/web/src/components/export-panel.tsx`;
- `apps/web/src/components/export-panel-v2.tsx`.

Если активные импорты к моменту реализации изменились, следовать текущему коду, а не этому снимку.

### Canvas и presentation contract

- `project-editor.tsx` сохраняет модель `1280x720`;
- `slide-template-renderer.tsx` уже умеет отображать реальные слайды и Mermaid-диаграммы;
- `presentation-display.ts` и shared-типы являются контрактом между web и export;
- слайдовые темы независимы от application chrome;
- приложение не должно перекрашивать слайды своими orange-токенами.

## 5. Использовать только уже установленный стек

Новые frontend-зависимости для этого редизайна не требуются.

| Возможность | Использовать | Где уже есть |
|---|---|---|
| Motion и choreography | `motion` / `motion/react` | `components/motion/*`, `MotionProvider` |
| Диалоги | существующая обёртка Radix Dialog | `components/ui/dialog.tsx` |
| Dropdown menu | существующая Radix-обёртка | `components/ui/dropdown-menu.tsx` |
| Tabs | существующая Radix-обёртка | `components/ui/tabs.tsx` |
| Progress | существующая Radix-обёртка | `components/ui/progress.tsx` |
| Tooltip | существующая Radix-обёртка | `components/ui/tooltip.tsx` |
| Кнопки и variants | `Button`, CVA, `cn` | `components/ui/button.tsx`, `lib/utils.ts` |
| Серверные и фоновые состояния | TanStack Query | `query-provider.tsx`, `*-queries.ts` |
| Редактирование текста | Tiptap | `editor/rich-text-field.tsx` |
| Иконки | `lucide-react` | используется по всему web app |
| Учебные диаграммы | Mermaid | `editor/mermaid-diagram.tsx` |
| Шрифт | локальный `@fontsource-variable/nunito` | импортируется в root layout |
| Типы презентации | `@studydeck/shared` | текущие web/worker/export контракты |
| Изображения лендинга | встроенный `next/image` и локальный `public/` | Next.js; `public` нужно создать |
| Подготовка растров | установленный `sharp` | root workspace |

Прямые запреты:

- не добавлять GSAP;
- не добавлять Framer Motion отдельно от уже установленного `motion`;
- не добавлять Swiper/Embla для трёх showcase-работ;
- не добавлять Lenis;
- не добавлять Three.js/WebGL;
- не добавлять новый UI-kit;
- не мигрировать проект на Tailwind;
- не добавлять второй icon pack;
- не загружать новый web font;
- не использовать ad hoc `fetch` polling там, где уже есть TanStack Query.

Если не хватает небольшого элемента, сначала использовать семантический HTML, CSS и существующие wrappers. Новую зависимость можно рассматривать только после доказанного функционального пробела и отдельного согласования.

## 6. Целевая файловая архитектура

Предпочтительная структура новых файлов:

```text
apps/web/src/components/landing/
  public-header.tsx
  landing-hero.tsx
  hero-generation-demo.tsx
  demo-deck-preview.tsx
  demo-gallery.tsx
  five-minute-timeline.tsx
  landing-final-cta.tsx

apps/web/src/lib/
  landing-demo-data.ts

apps/web/src/app/
  landing.css

apps/web/public/landing/
  ai-education/
  caribbean-crisis/
  future-energy/
```

Имена можно немного адаптировать, но не складывать всю страницу и весь animation state в `page.tsx`.

### Server/client boundaries

- `apps/web/src/app/page.tsx` оставить server component.
- Статический текст, semantic sections и SEO должны рендериться на сервере.
- Клиентскими сделать только `PublicHeader`, автоматическую hero-демонстрацию, интерактивную showcase-галерею и минимальные motion-обёртки.
- Не добавлять `"use client"` на всю landing page.
- Статические showcase-данные держать вне React-компонентов и типизировать через `@studydeck/shared`.
- Не создавать variants и большие массивы данных внутри render.

## 7. Публичная и продуктовая навигация

### Изменить `AppChrome`

Разделить маршруты на четыре класса:

1. public landing: `/`;
2. auth: `/login`;
3. account/product: `/dashboard`, `/projects`, `/new`, `/folders`, `/pricing`, `/profile`, `/invite`;
4. admin/editor special surfaces.

Требования:

- на `/` показывать новый `PublicHeader`;
- на `/login` использовать компактный auth shell без навигации личного кабинета;
- на account-маршрутах оставить `AppHeader` и `MobileBottomNav`;
- editor workflow progress не переносить в публичную шапку;
- не показывать мобильную нижнюю навигацию на публичном лендинге;
- авторизованный пользователь на `/` всё равно видит публичный лендинг, но CTA может называться «Открыть кабинет» или «Создать презентацию» в зависимости от session;
- brand link внутри кабинета ведёт на `/dashboard`, публичный brand link — на `/`.

### Новый `PublicHeader`

Desktop:

- логотип StudyDeck AI;
- якоря `Как работает`, `Примеры`, `Возможности`;
- `Войти`;
- primary CTA `Создать за 5 минут` → `/new` или `/login?callbackUrl=/new` в зависимости от текущей auth-модели;
- высота и геометрия должны оставаться родственными текущему AppHeader.

Mobile:

- логотип;
- `Войти` или `Кабинет`;
- компактный CTA;
- якорные ссылки можно скрыть без введения тяжёлого drawer, если они не помещаются;
- touch target не меньше 44x44px.

Использовать `lucide-react`, существующий `Button`/button vocabulary и текущие focus tokens.

## 8. Landing page `/`

### 8.1 Hero

Главная фраза:

> От одной темы до готового выступления за 5 минут

Допустимый редакционный вариант разбиения:

```text
Одна тема.
Пять минут.
Готовое выступление.
```

В copy обязательно явно присутствуют:

- одна тема;
- презентация;
- готовая речь;
- пять минут;
- студенческое выступление/защита.

CTA:

- primary: `Создать за 5 минут`;
- secondary: `Посмотреть примеры` → `#examples`.

Hero должен быть большой тёмной сценой почти на всю доступную ширину, а не ещё одной белой карточкой. Использовать текущие тёмные editor-токены и умеренный радиус до 24px. Текст остаётся читаемым и видимым до запуска JavaScript.

### 8.2 Автоматическая демонстрация

Компонент: `hero-generation-demo.tsx`.

Состояния:

```text
topic → structure → speech → slides → ready
```

Сценарий первого цикла:

1. В поле появляется тема «Как искусственный интеллект меняет образование».
2. Появляются компактные промежуточные объекты: план, источники, текст.
3. Фиолетовый акцент коротко показывает AI-преобразование.
4. Собирается стопка из нескольких разных 16:9 слайдов.
5. Из-за стопки появляется лист речи.
6. Финальный зелёный статус сообщает: `Готово за 4:48` или `Готово примерно за 5 минут`.

Motion contract:

- старт после стабилизации первого paint, примерно через 300–500ms;
- общая активная часть 4–6 секунд;
- после ready-состояния удерживать результат не менее 6 секунд;
- повторять не чаще одного раза в 12–15 секунд или только после явной кнопки `Повторить`;
- все timers очищать при unmount;
- не использовать вечный мигающий cursor;
- тему показывать одной короткой write-in/clip анимацией, а не посимвольной анимацией на десятки секунд;
- анимировать `transform`, `opacity`, `clip-path` и при необходимости `filter`;
- не анимировать размеры layout, `top/left`, `width/height` без необходимости;
- не использовать bounce/elastic;
- при `prefers-reduced-motion` сразу показывать финальный готовый комплект;
- доступный текст и результат должны существовать в DOM независимо от анимации.

Расширять `components/motion/motion-presets.ts`, а не создавать случайные easing/duration в каждом компоненте. Hero может иметь отдельные `demo` durations, но продуктовые transitions остаются 150–220ms.

### 8.3 «Одной темы достаточно»

Асимметричная композиция `до → преобразование → после`:

- слева поле с одной темой;
- в центре короткая траектория/маркер AI;
- справа слайды, речь, источники и заметки;
- использовать открытое пространство и крупную типографику;
- не превращать четыре результата в одинаковые cards.

Допустимые короткие плашки:

- `Без долгого промпта`;
- `Без пустого слайда`;
- `Текст выступления уже готов`.

Плашки используются как типографические акценты, а не как новая card-grid система.

### 8.4 Showcase-галерея

Три утверждённые работы:

1. `Как искусственный интеллект меняет образование`
   - технологичная;
   - современные фотографии;
   - яркая типографика;
   - инфографика.
2. `Причины и последствия Карибского кризиса`
   - документальные/архивные изображения;
   - серьёзная редакционная композиция;
   - timeline или comparison.
3. `Возобновляемая энергетика и города будущего`
   - научная визуализация;
   - архитектурные изображения;
   - схемы, metrics или Mermaid diagram.

Для каждой работы подготовить 4–6 слайдов и короткий фрагмент речи. Данные хранить как типизированные fixtures, совместимые с текущими shared presentation types.

Рендерить слайды через существующие:

- `SlideTemplatePreview`;
- `slideTemplateThemeStyle`;
- `slideBackgroundVariant`;
- при необходимости текущий Mermaid renderer.

Не создавать параллельный fake slide renderer для лендинга.

Интеракции:

- desktop hover/focus слегка раздвигает стопку на 2–8px;
- keyboard focus даёт тот же информационный результат, что hover;
- клик открывает подробный preview через существующий Radix Dialog;
- mobile использует CSS scroll snap или обычный вертикальный список;
- не добавлять carousel library;
- не загружать все крупные изображения до первого взаимодействия.

### 8.5 Пятиминутная линия

Показать одну цельную временную шкалу:

```text
0:00 — написал тему
0:40 — готов план
1:30 — подобраны материалы
3:20 — подготовлена речь
4:48 — собраны слайды
5:00 — можно редактировать или скачивать
```

Это демонстрационная продуктовая история, а не реальный job progress. Не смешивать её с TanStack polling.

Использовать семантический `<ol>`. Motion может заполнять декоративную линию при попадании секции в viewport, но все подписи всегда остаются видимыми. Не делать six-card grid.

### 8.6 «Что получает студент»

Показать два главных артефакта крупно:

- презентация;
- текст выступления по слайдам.

Источники, заметки, PDF/PPTX/DOCX показать вторичным слоем. Не ставить вторичные возможности на один уровень с двумя основными результатами.

### 8.7 Финальный CTA

Широкая тёмная секция со стопкой слайдов и листом речи.

Copy:

> Следующая презентация начинается с одной темы

CTA:

> Создать за 5 минут

Никакого конфетти. Допустима короткая сборка стопки один раз при входе секции в viewport.

### 8.8 SEO и semantics

- один `h1`;
- правильная иерархия `h2/h3`;
- обновить metadata title/description под обещание одной темы и пяти минут;
- meaningful alt text у showcase-изображений;
- декоративные фрагменты скрыть через `aria-hidden`;
- CTA должны быть обычными ссылками с понятным destination;
- не прятать ключевой marketing copy в canvas или изображение.

## 9. Showcase assets

Создать `apps/web/public/landing`, которого сейчас в web workspace нет.

Правила:

- inspiration screenshots не использовать как assets;
- использовать оригинальные AI-generated или лицензированные изображения;
- не hotlink-ить внешние изображения;
- для каждого изображения зафиксировать понятный alt/caption в fixture data;
- оптимизировать через установленный `sharp` в WebP/AVIF;
- hero-critical assets держать максимально лёгкими;
- ниже fold использовать lazy loading;
- вне slide renderer предпочитать встроенный `next/image`;
- не base64-embed-ить крупные изображения в TSX/CSS;
- не добавлять remote image domains без необходимости.

Целевой performance budget:

- critical hero images суммарно желательно не больше 500–700KB;
- каждый below-fold raster обычно не больше 200–300KB;
- избегать CLS: задавать width/height или aspect-ratio;
- не загружать Mermaid до появления слайда с диаграммой, сохранить текущий dynamic import.

## 10. Продуктовые экраны

### 10.1 `/new`

Активные файлы:

- `apps/web/src/app/new/page.tsx`;
- `apps/web/src/components/new-project-form.tsx`;
- `apps/web/src/components/workflow-progress.tsx`.

Задача:

- сделать поле темы главным визуальным объектом;
- рядом показать спокойный ориентир `≈ 5 минут до готовой презентации и речи`;
- сохранить текущие шаги, audience selection, slide count, source mode, upload и API payload;
- не менять лимиты, `studentGenerationBrief` и бизнес-логику;
- использовать существующий `AnimatePresence`, motion presets и Lucide;
- показать переход `тема → объём → источники` как короткий путь, а не тяжёлый enterprise wizard;
- loading/error/limit states должны занимать стабильное место и не сдвигать layout;
- mobile bottom nav не должен перекрывать primary action.

### 10.2 Генерация и `/projects/[id]/script`

Активный компонент: `project-script-review-query.tsx`.

Не редизайнить только старый `project-script-review.tsx`.

Задача:

- связать реальный status polling с визуальным языком hero, но не показывать выдуманные проценты;
- фактические состояния `queued/generating/ready/failed` получать через существующий TanStack Query flow;
- показывать этапы «подбираем основу», «готовим речь», «собираем слайды» только если они соответствуют реальным status данным;
- использовать skeleton/indeterminate progress для неизвестного времени;
- сохранить проверку источников, включение/отключение материалов, speech sections, dirty/saved и AI confirmation dialog;
- сделать речь главным результатом, источники — проверяемой основой;
- Tiptap использовать там, где уже нужен rich text; не заменять стабильные структурированные поля Tiptap без UX-причины;
- не добавлять отдельный polling hook;
- ошибки AI должны оставаться видимыми и предлагать retry.

### 10.3 Dashboard `/dashboard`

Активный компонент: `dashboard/dashboard-overview.tsx`.

Задача:

- сохранить спокойную account-плотность;
- сделать `Продолжить работу` главным объектом;
- повторить мотив 16:9 стопки без загрузки полного presentation document;
- не добавлять N+1 fetch для реальных миниатюр;
- если ProjectSummary не содержит preview, использовать честную абстрактную cover-геометрию, а не fake content;
- usage и stats оставить вторичными;
- использовать текущий Radix Progress;
- пустое состояние объясняет следующий шаг.

### 10.4 `/projects`

Активные компоненты:

- `projects/projects-view.tsx`;
- `projects/projects-toolbar.tsx`;
- `projects/project-row.tsx`;
- `projects/project-actions-menu.tsx`;
- dialogs sharing/actions.

Задача:

- сохранить лёгкие list rows и текущую пагинацию/infinite query;
- не превращать библиотеку в тяжёлую gallery, если API не отдаёт thumbnails;
- hover/focus может слегка раздвигать абстрактную стопку слайдов;
- filters/selects/dialogs продолжают использовать существующие Radix wrappers;
- не менять URL query contract;
- loading, empty, limit и shared scopes должны быть визуально полными.

### 10.5 `/folders`

Активный компонент: `folders/folders-manager.tsx`.

Задача:

- сохранить одноуровневую структуру;
- дать папке короткий hover/focus «открывается крышка» через Lucide swap или transform;
- использовать существующий DropdownMenu и Dialog;
- не добавлять drag-and-drop или вложенность;
- пустое пространство сделать намеренным, а не случайно пустым.

### 10.6 `/projects/[id]/editor`

Активный компонент: `project-editor.tsx`.

Это уже самый сильный визуальный экран. Нужен polish, а не переписывание.

Требования:

- сохранить все editor interactions, `1280x720`, canvas scaling, upload, selection, resize, save, refresh и conflict flow;
- не анимировать текст/картинки/диаграммы внутри готового слайда;
- анимировать только chrome: выбор слайда, rail, toolbar, tabs, properties panels, dialogs;
- сохранить 12px editor radii;
- current slide, selection и active tools используют orange;
- AI/editor-specific actions могут использовать purple;
- не допускать application token leakage в `.slide-content`, `.canvas-viewport` и theme CSS variables;
- desktop сохраняет структурный editor layout;
- mobile/compact layout не должен обрезать заголовок или создавать горизонтальный overflow;
- проверить наблюдавшееся на mobile обрезание длинного project title.

### 10.7 `/projects/[id]/export`

Активный компонент: `export-panel-query.tsx`.

Не переносить редизайн только в `export-panel-v2.tsx`, если он не импортируется страницей.

Задача:

- превратить ready-state в спокойный кульминационный момент;
- использовать существующие Tabs, Button, Tooltip и TanStack Query;
- презентация и речь собираются в один визуальный комплект;
- готовые файлы появляются через короткий state transition;
- не показывать конфетти;
- stale export, queued, generating, failed и ready остаются различимыми;
- не менять revision safety и download behavior;
- сохранить PPTX/PDF/DOCX действия и aria-live статусы.

### 10.8 `/login`, `/profile`, `/pricing`, `/billing`, `/invite`

- `/login`: использовать компактный public/auth визуальный язык и сообщение о быстром результате; не добавлять лишнюю маркетинговую навигацию.
- `/profile`: спокойная account page, без showcase motion; сохранить Telegram и destructive flow.
- `/pricing`: не делать одинаковую трёхколоночную pricing grid, пока существует один честный тариф; сохранить текущие данные API.
- `/billing`: сейчас redirect на `/pricing`; не проектировать несуществующий отдельный экран.
- `/invite/[token]`: оформить accepted/expired/used/revoked/not-found/error состояния; invalid token не должен приводить к чёрной системной ошибке.
- Добавить подходящий Next.js `error.tsx`/`not-found.tsx` на нужном уровне, если это требуется для устойчивого invite/public UX, без изменения API.

### 10.9 `/admin/**`

Админка остаётся restrained product UI:

- не переносить туда hero-эстетику;
- сохранить fixed shell, tables, filters и Moscow-time context;
- motion максимум 4–6px и только для state changes;
- loading/error/empty должны быть стабильными;
- текущую проблему получения данных не маскировать skeleton бесконечно;
- не менять API/admin contracts в рамках визуального редизайна.

## 11. CSS и design tokens

Текущий source of truth приложения — `apps/web/src/app/globals.css`; он уже большой и содержит исторические/переопределённые блоки.

Рекомендуемый подход:

- глобальные tokens и shared controls оставить в `globals.css`;
- public landing styles вынести в `apps/web/src/app/landing.css` и импортировать один раз из `globals.css` или root layout;
- не создавать Tailwind classes или CSS-in-JS параллельно текущей системе;
- перед добавлением нового класса выполнить `rg` по существующим именам;
- не переписывать весь `globals.css` механически;
- удалять дубли только если они точно относятся к редизайну и покрыты визуальной проверкой.

Допустимые landing tokens должны переиспользовать текущие роли:

```css
--landing-bg: var(--surface-input);
--landing-stage: var(--dark);
--landing-stage-panel: var(--editor-workspace);
--landing-action: var(--orange);
--landing-ai: var(--purple);
--landing-ready: var(--green);
```

Не вводить новую rainbow palette. При необходимости нейтрального публичного фона использовать почти нейтральный off-white, а тепло переносить через orange, фотографии и тёмные brown surfaces.

Typography:

- Nunito остаётся единственным application font;
- public H1 максимум 88px на широком desktop и не больше 54px на mobile;
- letter-spacing не плотнее `-0.035em`;
- body 17–18px на лендинге;
- line length 65–75ch;
- `text-wrap: balance` для заголовков;
- длинные русские слова и CTA проверять на 320px.

## 12. Motion architecture

Расширять:

- `components/motion/motion-provider.tsx`;
- `components/motion/motion-presets.ts`;
- `animated-panel.tsx`;
- `motion-card.tsx`;
- `motion-list.tsx`;
- `page-transition.tsx`.

Не создавать вторую motion-систему.

Базовые диапазоны:

- control feedback: 140–180ms;
- product surface: 180–220ms;
- editor slide/chrome change: 180–220ms;
- hero demo step: 280–500ms;
- dialog/menu: 140–200ms;
- exit быстрее enter.

Правила:

- easing — текущий exponential-like ease out;
- page transition не должен повторно каскадировать landing sections;
- long lists не получают stagger после первых 6–8 объектов;
- hover lift максимум 2–4px;
- slide stack fan максимум 8px;
- auto demo останавливается при hidden tab, unmount и reduced motion;
- reduced-motion fallback показывает статичный финальный result;
- не привязывать доступность контента к завершению animation promise.

Если bundle impact `motion` станет заметным, сначала измерить, затем рассмотреть `LazyMotion`/`m`. Не усложнять без данных.

## 13. Async state и TanStack Query

TanStack Query уже является стандартом проекта.

Соблюдать:

- не дублировать server data в отдельном ad hoc state без причины;
- не добавлять setInterval polling рядом с query polling;
- hero demo является локальной декоративной state machine и не имитирует API;
- generation/export progress использует реальные query statuses;
- query refetch не должен перезапускать крупную entrance animation;
- skeleton должен сохранять размеры конечного layout;
- error state остаётся видимым после завершения запроса;
- retry использует существующие mutations/refetch.

## 14. Доступность и responsive

Обязательные размеры:

- 1440x900;
- 1280x800;
- 1024x768;
- 768x1024;
- 390x844;
- 320px minimum.

Проверить:

- нет horizontal page scroll;
- public header не перекрывает anchors;
- mobile bottom nav не появляется на public landing;
- CTA и controls не меньше 44px;
- hover features имеют keyboard/focus equivalent;
- focus-visible остаётся заметным на светлом и тёмном фоне;
- body text достигает WCAG AA;
- reduced motion полностью работоспособен;
- showcase dialog закрывается клавиатурой и возвращает focus;
- изображения имеют alt;
- декоративные sheets не озвучиваются;
- автоматическая демонстрация не создаёт бесконечный aria-live поток;
- hero copy читается без animation и JavaScript;
- long Russian labels не обрезаются;
- editor title и rail не уходят за viewport.

## 15. Тесты

### Vitest

Добавить только детерминированные тесты:

- route classification для `PublicHeader`/`AppHeader`/mobile nav;
- hero demo state reducer или pure timeline function;
- showcase fixture validation через shared types/Zod, если это доступно без network;
- сохранить существующие speech/export/project UI tests;
- не снапшотить огромный HTML/CSS.

### Playwright

Добавить/обновить browser сценарии:

- `/` показывает public header, один H1, primary CTA и все section anchors;
- hero demo доходит до ready-state;
- `prefers-reduced-motion` сразу показывает финальный state;
- showcase dialog открывается и закрывается с keyboard focus restore;
- `/new` сохраняет шаги и payload;
- `/projects/[id]/script` показывает реальные async states при mocked/env-gated data;
- `/projects/[id]/editor` не имеет overflow на desktop/mobile;
- `/projects/[id]/export` сохраняет queued/ready/failed/stale states;
- invalid invitation показывает оформленное unavailable/error состояние, а не системный crash;
- public landing на 320px не имеет horizontal scroll.

AI/search/network calls должны оставаться mocked или env-gated.

## 16. Порядок реализации

### Этап 0. Baseline и защита worktree

- status/diff;
- baseline screenshots;
- подтвердить активные компоненты;
- составить точный список затрагиваемых файлов;
- не трогать unrelated API/shared changes.

### Этап 1. Shell и foundation

- PublicHeader;
- route classification в AppChrome;
- landing tokens и `landing.css`;
- motion preset additions;
- auth/public/account shell separation.

Проверить `/`, `/login`, `/dashboard`, mobile nav.

### Этап 2. Showcase data и assets

- три типизированных demo decks;
- локальные изображения;
- sharp optimization;
- reuse `SlideTemplatePreview`;
- no hotlinks.

### Этап 3. Landing

- hero;
- automatic demo;
- one-topic transformation;
- showcase gallery/dialog;
- five-minute timeline;
- outputs section;
- final CTA;
- metadata.

### Этап 4. Creation и generation

- `/new`;
- real generation states;
- active `project-script-review-query.tsx`;
- loading/error/retry/reduced motion.

### Этап 5. Editor и export

- focused editor polish;
- mobile overflow repair;
- active `export-panel-query.tsx`;
- final ready moment;
- no business logic changes.

### Этап 6. Calm account surfaces

- dashboard;
- projects;
- folders;
- profile;
- pricing/login/invite;
- admin token alignment only.

### Этап 7. Hardening и docs

- empty/loading/error/not-found;
- responsive/a11y/performance;
- tests;
- update `DESIGN.md` and `.impeccable/design.json` only after implementation matches them;
- final browser audit.

## 17. Verification workflow

Для обычной frontend-итерации не rebuild-ить production web container.

После логических этапов:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
```

Перед сдачей:

```powershell
npm run build -w @studydeck/web
docker compose config --quiet
```

Preview:

```powershell
npm run dev:web:fast
```

Проверять на:

```text
http://localhost:3020
```

После изменений `packages/shared` перезапустить fast preview. Docker web rebuild выполнять только по прямому запросу на production-container validation.

Обязательные маршруты browser audit:

- `/`;
- `/login`;
- `/dashboard`;
- `/projects`;
- `/folders`;
- `/profile`;
- `/pricing`;
- `/new`;
- реальный `/projects/[id]/script`;
- реальный `/projects/[id]/editor`;
- реальный `/projects/[id]/export`;
- `/invite/invalid` или безопасный mocked invalid state;
- `/admin` и один table-heavy admin route.

Проверить browser console. Не считать HTTP 200 визуальной проверкой.

## 18. Acceptance criteria

### Публичный лендинг

- За первые 5 секунд понятно: достаточно одной темы, результат — презентация и речь, срок — 5 минут.
- PublicHeader не похож на навигацию личного кабинета.
- Hero содержит заметную автоматическую демонстрацию и статичный reduced-motion fallback.
- Три showcase-презентации визуально различаются.
- Showcase использует настоящий StudyDeck slide renderer, а не отдельную имитацию.
- Landing не состоит из одинаковых cards.
- Есть светлые и тёмные секции, крупная типографика и контролируемая асимметрия.
- CTA ведут в существующий auth/create flow.

### Продукт

- `/new`, generation, editor и export получают концентрированные wow-моменты.
- Dashboard/projects/folders/profile/pricing/admin остаются спокойными и быстрыми.
- Реальные query states не заменены декоративной имитацией.
- Editor canvas, theme rendering и exports визуально не сломаны.
- Billing redirect остаётся честным.
- Invalid invite не вызывает системную чёрную страницу.

### Техника

- Не добавлены новые frontend-зависимости.
- Использованы текущие Motion, Radix, TanStack Query, Tiptap, Lucide, Mermaid, Nunito и shared types.
- Нет horizontal overflow на 320px.
- Reduced motion, keyboard и focus-visible работают.
- Нет blocking console errors.
- Typecheck, tests и web build проходят.
- Пользовательские изменения в worktree не потеряны.
- Не изменены API, worker generation logic или shared contracts без отдельной необходимости и согласования.

## 19. Non-goals

- Не переделывать generation pipeline.
- Не менять AI prompts.
- Не менять presentation contract ради лендинга.
- Не переписывать slide renderer.
- Не редизайнить generated themes в orange app style.
- Не добавлять новые тарифы или платёжные функции.
- Не добавлять nested folders.
- Не добавлять drag-and-drop в библиотеку проектов.
- Не выполнять remote deploy.
- Не rebuild-ить Docker web для обычной итерации.
- Не использовать inspiration screenshots как production assets.

## 20. Формат финального отчёта Codex

После реализации сообщить:

1. какие визуальные и UX-решения реализованы;
2. какие существующие библиотеки использованы и где;
3. какие файлы изменены и какие новые assets созданы;
4. какие tests/typecheck/build выполнены;
5. какие маршруты и viewport проверены в браузере;
6. как работает automatic hero demo и reduced-motion fallback;
7. какие состояния не удалось проверить из-за отсутствия данных;
8. какой URL открыть пользователю;
9. остались ли unrelated изменения в worktree.


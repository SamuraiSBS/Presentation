export type GoldTextKind = "title" | "thesis" | "conclusion" | "label" | "number" | "date" | "decorative";

export type GoldText = {
  id: string;
  text: string;
  kind: GoldTextKind;
  /** The fixture acts as the production planned semantic-zone input. */
  zone: { x: number; y: number; w: number; h: number };
  raster: "replace" | "decoration";
};

export type ReferenceFixture = {
  id: string;
  sourcePath: string;
  visualFamily: "cosmos" | "motorsport" | "editorial_nature";
  archetype: "hero" | "timeline" | "comparison" | "flow" | "evidence" | "closing";
  texts: GoldText[];
  decorativeText: string[];
  forceFallback?: "structured_evidence" | "unresolved_text";
};

const zone = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const title = (id: string, text: string, y = 0.04, w = .7): GoldText => ({ id, text, kind: "title", zone: zone(.04, y, w, .1), raster: "replace" });
const label = (id: string, text: string, x: number, y: number, w = .22): GoldText => ({ id, text, kind: "label", zone: zone(x, y, w, .07), raster: "replace" });
const thesis = (id: string, text: string, x: number, y: number, w = .34): GoldText => ({ id, text, kind: "thesis", zone: zone(x, y, w, .11), raster: "replace" });
const number = (id: string, text: string, x: number, y: number): GoldText => ({ id, text, kind: "number", zone: zone(x, y, .08, .06), raster: "replace" });

// These are manual, exact gold fixtures. Small recurring headers, watermarks,
// slogans, and handwritten quotations are listed as decorative controls rather
// than silently promoted into editable claims.
export const referenceFixtures: readonly ReferenceFixture[] = [
  {
    id: "solar-01", sourcePath: "референц слайдов/1.png", visualFamily: "cosmos", archetype: "hero", forceFallback: "structured_evidence",
    texts: [title("solar-01-title", "Солнечная система как единая система"), number("solar-01-page", "1 / 6", .94, .02), thesis("solar-01-age", "4,6 млрд лет", .80, .17, .17), thesis("solar-01-cloud", "Облако газа и пыли", .80, .32, .17), thesis("solar-01-mass", "Масса — в Солнце", .80, .48, .17), thesis("solar-01-orbits", "Движение по орбитам", .80, .64, .17), thesis("solar-01-summary", "Единая динамическая система", .80, .80, .17), label("solar-01-mercury", "Меркурий", .06, .46), label("solar-01-earth", "Земля", .17, .46), label("solar-01-jupiter", "Юпитер", .34, .46), label("solar-01-asteroids", "Пояс астероидов", .23, .57), thesis("solar-01-formation", "Как формировалась Солнечная система", .04, .69, .55), label("solar-01-cloud-step", "Облако", .06, .90), label("solar-01-disk-step", "Диск", .24, .90), label("solar-01-sun-step", "Рождение Солнца", .38, .90), label("solar-01-system-step", "Система сегодня", .55, .90)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "solar-02", sourcePath: "референц слайдов/2.png", visualFamily: "cosmos", archetype: "flow",
    texts: [title("solar-02-title", "Солнце — источник энергии и главный центр движения"), number("solar-02-page", "2 / 6", .94, .02), label("solar-02-photosphere", "Фотосфера", .20, .17), label("solar-02-convection", "Конвективная зона", .22, .31), label("solar-02-core", "Ядро", .24, .52), label("solar-02-hydrogen", "Водород", .35, .37), label("solar-02-helium", "Гелий", .50, .37), label("solar-02-energy", "Энергия", .62, .37), thesis("solar-02-star", "Звезда среднего размера", .80, .18, .17), thesis("solar-02-composition", "Водород и гелий", .80, .35, .17), thesis("solar-02-reactions", "Термоядерные реакции", .80, .52, .17), thesis("solar-02-life", "Энергия Солнца поддерживает жизнь на Земле.", .24, .88, .65)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "solar-03", sourcePath: "референц слайдов/3.png", visualFamily: "cosmos", archetype: "comparison", forceFallback: "structured_evidence",
    texts: [title("solar-03-title", "Планеты и закономерности их строения"), number("solar-03-page", "3 / 6", .94, .02), thesis("solar-03-rocky", "Каменные планеты", .10, .19), thesis("solar-03-gas", "Газовые гиганты", .55, .19), thesis("solar-03-ice", "Ледяные гиганты", .84, .19, .13), label("solar-03-rocky-description", "Плотные, с твёрдой поверхностью", .10, .26, .25), label("solar-03-gas-description", "Состоят в основном из газа", .55, .26, .23), label("solar-03-ice-description", "Содержат много льдов", .84, .26, .13), label("solar-03-belt", "Пояс астероидов", .39, .64, .08), thesis("solar-03-difference", "Разные условия — разные планеты", .13, .79, .30), thesis("solar-03-pluto", "Плутон — карликовая планета", .70, .79, .25)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "solar-04", sourcePath: "референц слайдов/4.png", visualFamily: "cosmos", archetype: "flow",
    texts: [title("solar-04-title", "Малые тела и движение"), number("solar-04-page", "4 / 6", .94, .02), label("solar-04-asteroids", "Астероиды", .08, .43), label("solar-04-comet", "Комета", .33, .43), label("solar-04-kuiper", "Пояс Койпера", .54, .43), thesis("solar-04-jupiter", "Влияние Юпитера", .04, .52, .38), label("solar-04-outer", "Во внешнюю область", .59, .56, .14), label("solar-04-inner", "К внутренним планетам", .59, .76, .14), thesis("solar-04-collision", "Столкновения редки, но важны", .17, .90, .48), thesis("solar-04-tail", "У комет есть хвост", .80, .47, .17), thesis("solar-04-orbits", "Юпитер меняет орбиты", .80, .77, .17)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "solar-05", sourcePath: "референц слайдов/5.png", visualFamily: "cosmos", archetype: "evidence", forceFallback: "structured_evidence",
    texts: [title("solar-05-title", "Как исследуют Солнечную систему"), number("solar-05-page", "5 / 6", .94, .02), thesis("solar-05-telescopes", "Телескопы", .04, .38, .20), thesis("solar-05-stations", "Автоматические станции", .28, .37, .20), thesis("solar-05-orbital", "Орбитальные аппараты", .51, .37, .20), thesis("solar-05-landers", "Посадочные модули", .75, .38, .20), thesis("solar-05-conclusion", "Надёжные выводы даёт сочетание методов", .40, .59, .30), label("solar-05-images", "Изображения", .05, .88), label("solar-05-spectra", "Спектры", .22, .88), label("solar-05-orbits", "Орбиты", .39, .88), label("solar-05-samples", "Анализ образцов", .55, .88)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "solar-06", sourcePath: "референц слайдов/6.png", visualFamily: "cosmos", archetype: "closing",
    texts: [title("solar-06-title", "Почему изучение системы продолжается"), number("solar-06-page", "6 / 6", .94, .02), label("solar-06-earth", "Земля", .10, .51), label("solar-06-venus", "Венера", .33, .51), label("solar-06-mars", "Марс", .54, .51), label("solar-06-sun", "Солнце", .12, .80), label("solar-06-asteroids", "Астероиды", .34, .80), label("solar-06-comets", "Кометы", .56, .80), thesis("solar-06-origin", "Общее происхождение", .80, .16, .17), thesis("solar-06-evolution", "Эволюция планет", .80, .31, .17), thesis("solar-06-weather", "Космическая погода", .80, .59, .17), thesis("solar-06-environment", "Солнечная система — изменяющаяся физическая среда", .14, .91, .70)],
    decorativeText: ["АСТРОНОМИЯ", "Наше место во Вселенной"],
  },
  {
    id: "porsche-01", sourcePath: "референц слайдов/Porsche/1.png", visualFamily: "motorsport", archetype: "hero",
    texts: [title("porsche-01-title", "Porsche 911", .14, .5), thesis("porsche-01-subtitle", "История модели, культовые версии, влияние на автоспорт", .05, .30, .38), thesis("porsche-01-legend", "Легенда спортивных автомобилей", .05, .44, .26), thesis("porsche-01-era", "1963 — наши дни", .05, .57, .20)],
    decorativeText: ["01 / 06", "DRIVEN BY A HIGHER STANDARD", "ОДНА ИДЕЯ. МНОГИЕ ПОКОЛЕНИЯ.", "ПРОШЛОЕ ВДОХНОВЛЯЕТ БУДУЩЕЕ"],
  },
  {
    id: "porsche-02", sourcePath: "референц слайдов/Porsche/2.png", visualFamily: "motorsport", archetype: "timeline", forceFallback: "structured_evidence",
    texts: [title("porsche-02-title", "История модели", .13, .55), thesis("porsche-02-subtitle", "От Porsche 901 до мировой иконы", .05, .25, .36), number("porsche-02-1963", "1963", .62, .20), label("porsche-02-1963-copy", "дебют Porsche 901", .62, .25, .16), number("porsche-02-1964", "1964", .62, .31), label("porsche-02-1964-copy", "старт производства, имя 911", .62, .36, .16), number("porsche-02-1974", "1974", .62, .44), label("porsche-02-1974-copy", "появление 911 Turbo", .62, .49, .16), number("porsche-02-1998", "1998", .62, .56), label("porsche-02-1998-copy", "переход на жидкостное охлаждение", .62, .61, .16), label("porsche-02-rear", "Заднемоторная компоновка", .79, .71, .16)],
    decorativeText: ["02 / 06", "DRIVEN BY A HIGHER STANDARD", "ОДНА ИДЕЯ. МНОГИЕ ПОКОЛЕНИЯ."],
  },
  {
    id: "porsche-03", sourcePath: "референц слайдов/Porsche/3.png", visualFamily: "motorsport", archetype: "comparison", forceFallback: "structured_evidence",
    texts: [title("porsche-03-title", "Культовые модели", .13, .56), thesis("porsche-03-subtitle", "Версии, ставшие легендами", .05, .24, .32), thesis("porsche-03-rs", "Carrera RS 2.7", .05, .65, .19), thesis("porsche-03-turbo", "911 Turbo (930)", .29, .65, .19), thesis("porsche-03-993", "993", .53, .65, .19), thesis("porsche-03-gt3", "GT3 RS", .76, .65, .19), label("porsche-03-rs-era", "1970s", .06, .38), label("porsche-03-turbo-era", "1970s", .29, .38), label("porsche-03-993-era", "1990s", .53, .38), label("porsche-03-gt3-era", "2010s+", .76, .38)],
    decorativeText: ["03 / 06", "DRIVEN BY A HIGHER STANDARD", "ОДНА ИДЕЯ. МНОГИЕ ПОКОЛЕНИЯ."],
  },
  {
    id: "porsche-04", sourcePath: "референц слайдов/Porsche/4.png", visualFamily: "motorsport", archetype: "timeline", forceFallback: "structured_evidence",
    texts: [title("porsche-04-title", "Эволюция и технологии", .12, .68), thesis("porsche-04-subtitle", "Как 911 перешёл в современную эпоху", .05, .24, .42), label("porsche-04-old", "911 (901)\n1963", .03, .55, .16), label("porsche-04-new", "911 (992)\n2022+", .92, .55, .07), thesis("porsche-04-cooling", "Воздушное охлаждение → жидкостное", .05, .74, .20), thesis("porsche-04-power", "Рост мощности", .29, .74, .20), thesis("porsche-04-systems", "Современные системы", .53, .74, .20), thesis("porsche-04-dna", "ДНК сохранилась", .76, .74, .20), label("porsche-04-generations", "901 → 930 → 993 → 996 → 992", .26, .93, .45)],
    decorativeText: ["04 / 06", "DRIVEN BY A HIGHER STANDARD", "ТРАДИЦИИ СОЗДАЮТ ХАРАКТЕР"],
  },
  {
    id: "porsche-05", sourcePath: "референц слайдов/Porsche/5.png", visualFamily: "motorsport", archetype: "flow", forceFallback: "structured_evidence",
    texts: [title("porsche-05-title", "Влияние на автоспорт", .11, .40), thesis("porsche-05-subtitle", "Гонки как лаборатория технологий", .05, .29, .30), thesis("porsche-05-rally", "Ралли", .04, .72, .17), thesis("porsche-05-gt", "Гонки GT", .27, .72, .17), thesis("porsche-05-cup", "Porsche Cup", .50, .72, .17), thesis("porsche-05-endurance", "Выносливость", .73, .72, .17), label("porsche-05-chain", "Автоспорт → Испытания → Технологии → Дорожные версии", .06, .88, .70)],
    decorativeText: ["05 / 06", "RACING FOR A BETTER TOMORROW", "ОДНА ИДЕЯ. МНОГИЕ ПОКОЛЕНИЯ."],
  },
  {
    id: "porsche-06", sourcePath: "референц слайдов/Porsche/6.png", visualFamily: "motorsport", archetype: "closing",
    texts: [title("porsche-06-title", "Почему Porsche 911 стал иконой", .12, .58), thesis("porsche-06-recognizable", "Узнаваемый дизайн", .05, .43, .19), thesis("porsche-06-engineering", "Инженерная уникальность", .29, .43, .20), thesis("porsche-06-racing", "Успех в автоспорте", .05, .59, .19), thesis("porsche-06-generations", "Связь поколений", .29, .59, .20), thesis("porsche-06-conclusion", "Porsche 911 — это не просто спортивный автомобиль, а символ инженерии, скорости и традиций.", .07, .76, .39)],
    decorativeText: ["06 / 06", "DRIVEN BY A HIGHER STANDARD", "ОДНА ИДЕЯ. МНОГИЕ ПОКОЛЕНИЯ."],
  },
  {
    id: "nature-01", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_13 (1).png", visualFamily: "editorial_nature", archetype: "hero", forceFallback: "structured_evidence",
    texts: [title("nature-01-title", "Природа и растения Ростовской области", .10, .55), thesis("nature-01-steppe", "Степной край юга России", .11, .40, .18), thesis("nature-01-climate", "Климат: умеренно континентальный", .31, .40, .18), thesis("nature-01-river", "Главная река — Дон", .11, .55, .18), thesis("nature-01-landscape", "Степи, поймы, балки и лесополосы", .31, .55, .22), thesis("nature-01-map", "Ростовская область", .52, .42, .14), label("nature-01-don", "р. Дон", .52, .57), label("nature-01-rostov", "Ростов-на-Дону", .48, .62), label("nature-01-volgodonsk", "Волгодонск", .57, .60), thesis("nature-01-summer", "Жаркое сухое лето", .08, .82, .12), thesis("nature-01-winter", "Мягкая зима", .24, .82, .12), thesis("nature-01-forest", "Небольшая лесистость", .40, .82, .15)],
    decorativeText: ["РОДНОЙ КРАЙ — БОЛЬШИЕ ГОРИЗОНТЫ", "Природа вдохновляет", "Здесь начинается большая Россия"],
  },
  {
    id: "nature-02", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_14 (2).png", visualFamily: "editorial_nature", archetype: "comparison", forceFallback: "structured_evidence",
    texts: [title("nature-02-title", "Степи Ростовской области", .10, .55), thesis("nature-02-main", "Степь — главная природная зона области", .11, .37, .17), thesis("nature-02-cultivated", "Многие территории распаханы", .32, .37, .17), thesis("nature-02-valuable", "Сохранившиеся участки особенно ценны", .11, .50, .17), thesis("nature-02-seasons", "Весной степь яркая, летом — золотистая", .32, .50, .20), label("nature-02-spring", "Весна — зелень и цветение", .06, .75, .14), label("nature-02-summer", "Лето — жара и сухость", .20, .75, .14), label("nature-02-autumn", "Осень — спокойные золотистые тона", .34, .75, .14), thesis("nature-02-soil", "Защищает почву", .10, .88, .12), thesis("nature-02-animals", "Кормит животных", .25, .88, .12), thesis("nature-02-biodiversity", "Сохраняет биоразнообразие", .40, .88, .15)],
    decorativeText: ["РОДНОЙ КРАЙ — БОЛЬШИЕ ГОРИЗОНТЫ", "Природа вдохновляет", "Бескрайние степи — наше природное богатство"],
  },
  {
    id: "nature-03", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_14 (3).png", visualFamily: "editorial_nature", archetype: "comparison", forceFallback: "structured_evidence",
    texts: [title("nature-03-title", "Растения степей", .10, .55), label("nature-03-feather", "Ковыль", .07, .53), label("nature-03-wormwood", "Полынь", .23, .53), label("nature-03-sage", "Шалфей", .39, .53), label("nature-03-tulips", "Тюльпаны", .55, .53), thesis("nature-03-symbol", "Ковыль — символ степи", .09, .64, .15), thesis("nature-03-drought", "Полынь и шалфей устойчивы к засухе", .25, .64, .18), thesis("nature-03-bloom", "Весной цветут тюльпаны и ирисы", .42, .64, .18), thesis("nature-03-cycle", "Многие растения быстро проходят цикл развития", .58, .64, .20), thesis("nature-03-roots", "Длинные корни", .09, .88, .12), thesis("nature-03-leaves", "Узкие листья", .26, .88, .12), thesis("nature-03-flowering", "Раннее цветение", .42, .88, .12)],
    decorativeText: ["СТЕПИ. РЕКИ. ПРОСТОРЫ. ЖИВАЯ ИСТОРИЯ КРАЯ", "В степи в каждом цветке — сила жизни"],
  },
  {
    id: "nature-04", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_15 (4).png", visualFamily: "editorial_nature", archetype: "flow", forceFallback: "structured_evidence",
    texts: [title("nature-04-title", "Дон, поймы и леса", .10, .55), thesis("nature-04-water", "У рек больше влаги", .11, .31, .16), thesis("nature-04-meadows", "В поймах растут луга, кустарники и деревья", .34, .30, .20), thesis("nature-04-trees", "Типичные деревья: ива, тополь, дуб", .11, .45, .16), thesis("nature-04-wind", "Лесополосы защищают почву от ветра", .34, .45, .20), label("nature-04-steppe", "Сухая степь", .08, .70), label("nature-04-floodplain", "Пойма реки", .23, .70), label("nature-04-shelterbelt", "Лесополоса", .38, .70), thesis("nature-04-source", "Источник влаги", .08, .88, .12), thesis("nature-04-habitat", "Среда для растений и животных", .23, .88, .15), thesis("nature-04-nature", "Важная часть природы края", .40, .88, .15)],
    decorativeText: ["ВОДА СОЗДАЁТ ЖИЗНЬ. РЕКИ ДЕЛАЮТ КРАЙ ЗЕЛЕНЕЕ", "Реки делают наш край особенным"],
  },
  {
    id: "nature-05", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_15 (5).png", visualFamily: "editorial_nature", archetype: "evidence", forceFallback: "structured_evidence",
    texts: [title("nature-05-title", "Редкие растения и охрана природы", .10, .64), thesis("nature-05-ploughing", "Распашка степей сокращает естественные территории", .11, .41, .18), thesis("nature-05-fire", "Пожары и чрезмерный выпас вредят растениям", .34, .41, .18), thesis("nature-05-reserve", "Заповедник «Ростовский» сохраняет степные экосистемы", .11, .56, .18), thesis("nature-05-protection", "Охрана природы поддерживает биоразнообразие", .34, .56, .18), thesis("nature-05-species", "Сохраняются редкие виды", .10, .84, .14), thesis("nature-05-ecosystems", "Поддерживаются экосистемы", .27, .84, .14), thesis("nature-05-heritage", "Защищается природное наследие", .44, .84, .14), label("nature-05-threats", "распашка · пожары · выпас", .42, .84, .23)],
    decorativeText: ["СТЕПИ. РЕКИ. ПРОСТОРЫ. ЖИВАЯ ИСТОРИЯ КРАЯ", "Природа вдохновляет", "Сохраняя природу — сохраняем будущее"],
  },
  {
    id: "nature-06", sourcePath: "референц слайдов/Природа и растения Ростовской области/ChatGPT Image 10 сент. 2026 г., 21_52_16 (6).png", visualFamily: "editorial_nature", archetype: "closing", forceFallback: "structured_evidence",
    texts: [title("nature-06-title", "Значение природы Ростовской области", .10, .62), thesis("nature-06-oxygen", "Растения выделяют кислород", .10, .41, .15), thesis("nature-06-soil", "Степи защищают почву от эрозии", .26, .41, .15), thesis("nature-06-water", "Природа сохраняет влагу и кормовую базу", .10, .56, .15), thesis("nature-06-wealth", "Это важное богатство Донского края", .26, .56, .15), label("nature-06-plants", "Растения", .42, .57), label("nature-06-ground", "Почва", .51, .57), label("nature-06-animals", "Животные", .60, .57), label("nature-06-person", "Человек", .69, .57), thesis("nature-06-task", "Главная задача — сохранить баланс природы и человека", .13, .75, .28), thesis("nature-06-study", "Природу нужно изучать", .53, .81, .20), thesis("nature-06-protect", "Природу нужно беречь", .53, .88, .20)],
    decorativeText: ["ПРИРОДА СЕГОДНЯ — БЛАГОПОЛУЧНОЕ ЗАВТРА", "Природа вдохновляет", "Наш край — наше общее будущее"],
  },
];

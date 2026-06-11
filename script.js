const fileInput = document.querySelector("#fileInput");
const fileChips = document.querySelector("#fileChips");
const dropZone = document.querySelector("#dropZone");
const generateBtn = document.querySelector("#generateBtn");
const jobStatus = document.querySelector("#jobStatus");
const tabs = document.querySelectorAll(".tab");
const slideCount = document.querySelector("#slideCount");
const tone = document.querySelector("#tone");
const mode = document.querySelector("#mode");
const promptInput = document.querySelector("#prompt");
const slidesList = document.querySelector("#slidesList");
const slideCanvas = document.querySelector("#slideCanvas");
const deckTitle = document.querySelector("#deckTitle");
const generationMode = document.querySelector("#generationMode");
const activeSlideLabel = document.querySelector("#activeSlideLabel");
const notesEditor = document.querySelector("#notesEditor");
const sourceList = document.querySelector("#sourceList");
const questionList = document.querySelector("#questionList");
const pipelineSteps = document.querySelector("#pipelineSteps");
const printBtn = document.querySelector("#printBtn");
const pptxBtn = document.querySelector("#pptxBtn");
const prevSlideBtn = document.querySelector("#prevSlideBtn");
const nextSlideBtn = document.querySelector("#nextSlideBtn");
const printDeck = document.querySelector("#printDeck");
const aiPanel = document.querySelector(".ai-panel");

let presentation = createInitialPresentation();
let activeSlideIndex = 0;
let progressTimer = null;

renderEditor();

fileInput.addEventListener("change", () => {
  renderFileChips(Array.from(fileInput.files || []));
});

dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("dragging");

  if (!event.dataTransfer?.files?.length) return;

  const transfer = new DataTransfer();
  Array.from(event.dataTransfer.files).forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
  renderFileChips(Array.from(fileInput.files || []));
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
  });
});

generateBtn.addEventListener("click", async () => {
  const formData = new FormData();
  const scenario = document.querySelector(".tab.active")?.dataset.scenario || "Школьный доклад";

  formData.append("prompt", promptInput.value);
  formData.append("scenario", scenario);
  formData.append("level", tone.value);
  formData.append("mode", mode.value);
  formData.append("slideCount", slideCount.value);
  Array.from(fileInput.files || []).forEach((file) => formData.append("files", file));

  setBusy(true);
  startProgress(["Загружаем материалы", "Извлекаем текст", "Собираем план", "Пишем слайды", "Проверяем источники"]);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData,
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Не удалось собрать презентацию.");
    }

    presentation = result.presentation;
    activeSlideIndex = 0;
    stopProgress("Черновик готов");
    updatePipeline(["Материалы разобраны", "План создан", "Слайды готовы к правке"], 2);
    renderEditor();
    document.querySelector("#editor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    stopProgress(error.message || "Ошибка генерации");
    updatePipeline(["Материалы не разобраны", "План не создан", "Попробуйте другой запрос"], 0);
  } finally {
    setBusy(false);
  }
});

slidesList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-slide-index]");
  if (!button) return;
  activeSlideIndex = Number(button.dataset.slideIndex);
  renderEditor();
});

prevSlideBtn.addEventListener("click", () => {
  activeSlideIndex = Math.max(0, activeSlideIndex - 1);
  renderEditor();
});

nextSlideBtn.addEventListener("click", () => {
  activeSlideIndex = Math.min(presentation.slides.length - 1, activeSlideIndex + 1);
  renderEditor();
});

slideCanvas.addEventListener("input", (event) => {
  const target = event.target;
  const slide = getActiveSlide();
  if (!slide) return;

  if (target.matches("[data-edit='title']")) {
    slide.title = cleanText(target.textContent);
    renderSlideListOnly();
    deckTitle.textContent = presentation.title;
    return;
  }

  const blockIndex = Number(target.dataset.blockIndex);
  const itemIndex = Number(target.dataset.itemIndex);
  const block = slide.blocks[blockIndex];

  if (!block) return;

  if (block.type === "bullets" && Number.isFinite(itemIndex)) {
    block.items[itemIndex] = cleanText(target.textContent);
  } else if (target.dataset.blockContent === "true") {
    block.content = cleanText(target.textContent);
  }
});

notesEditor.addEventListener("input", () => {
  const slide = getActiveSlide();
  if (!slide) return;
  slide.speakerNotes = notesEditor.value;
});

aiPanel.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const slide = getActiveSlide();
  if (!slide) return;

  button.disabled = true;
  jobStatus.textContent = "AI правит слайд";

  try {
    const response = await fetch("/api/rewrite-slide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: button.dataset.action,
        slide,
        presentation,
      }),
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Не удалось применить правку.");
    }

    presentation.slides[activeSlideIndex] = result.slide;
    jobStatus.textContent = "Правка применена";
    renderEditor();
  } catch (error) {
    jobStatus.textContent = error.message || "Ошибка AI-правки";
  } finally {
    button.disabled = false;
  }
});

printBtn.addEventListener("click", () => {
  buildPrintDeck();
  window.print();
});

pptxBtn.addEventListener("click", async () => {
  pptxBtn.disabled = true;
  jobStatus.textContent = "Готовим PPTX";

  try {
    const response = await fetch("/api/export/pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Не удалось экспортировать PPTX.");
    }

    const blob = await response.blob();
    downloadBlob(blob, `${slugify(presentation.title)}.pptx`);
    jobStatus.textContent = "PPTX готов";
  } catch (error) {
    jobStatus.textContent = error.message || "Ошибка экспорта";
  } finally {
    pptxBtn.disabled = false;
  }
});

window.addEventListener("afterprint", () => {
  printDeck.innerHTML = "";
});

function renderEditor() {
  if (!presentation.slides.length) return;
  activeSlideIndex = Math.min(activeSlideIndex, presentation.slides.length - 1);
  renderSlideListOnly();
  renderCanvas();
  renderDetails();
  deckTitle.textContent = presentation.title;
  generationMode.textContent = presentation.generationMode || "demo";
  activeSlideLabel.textContent = `Слайд ${activeSlideIndex + 1}`;
}

function renderSlideListOnly() {
  slidesList.innerHTML = presentation.slides
    .map(
      (slide, index) => `
        <button class="slide-thumb ${index === activeSlideIndex ? "active" : ""}" type="button" data-slide-index="${index}">
          <span>${String(index + 1).padStart(2, "0")}</span>
          <strong>${escapeHtml(slide.title)}</strong>
        </button>
      `,
    )
    .join("");
}

function renderCanvas() {
  const slide = getActiveSlide();
  const sourceLine = (slide.sourceRefs || [])
    .map((ref) => `${escapeHtml(ref.label)}${ref.page ? `, ${escapeHtml(ref.page)}` : ""}`)
    .join("; ");
  const bullets = slide.blocks
    .map((block, blockIndex) => {
      if (block.type === "bullets") {
        return `
          <ul class="editable-bullets">
            ${(block.items || [])
              .map(
                (item, itemIndex) => `
                  <li contenteditable="true" data-block-index="${blockIndex}" data-item-index="${itemIndex}">${escapeHtml(item)}</li>
                `,
              )
              .join("")}
          </ul>
        `;
      }

      return `
        <div class="slide-callout" contenteditable="true" data-block-index="${blockIndex}" data-block-content="true">
          ${escapeHtml(block.content || "")}
        </div>
      `;
    })
    .join("");

  slideCanvas.innerHTML = `
    <div class="slide-header">
      <span>${escapeHtml(presentation.scenario)}</span>
      <span>${slide.timingSeconds || 45} сек</span>
    </div>
    <div class="slide-body editable-slide">
      <div>
        <h2 contenteditable="true" data-edit="title">${escapeHtml(slide.title)}</h2>
        ${bullets}
      </div>
      <div class="metric-stack">
        <div>
          <strong>${(slide.sourceRefs || []).length}</strong>
          <span>источники</span>
        </div>
        <div>
          <strong>${(slide.defenseQuestions || []).length}</strong>
          <span>вопросы</span>
        </div>
      </div>
    </div>
    <div class="source-strip">
      <span>Источник: ${sourceLine || "добавьте источник"}</span>
      <span>${escapeHtml(presentation.level)}</span>
    </div>
  `;
}

function renderDetails() {
  const slide = getActiveSlide();
  notesEditor.value = slide.speakerNotes || "";
  sourceList.innerHTML = (slide.sourceRefs || [])
    .map(
      (ref) => `
        <div class="mini-item">
          <strong>${escapeHtml(ref.label)}</strong>
          <span>${escapeHtml(ref.excerpt || "Фрагмент источника не указан.")}</span>
        </div>
      `,
    )
    .join("");
  questionList.innerHTML = (slide.defenseQuestions || [])
    .map((question) => `<div class="mini-item">${escapeHtml(question)}</div>`)
    .join("");
}

function buildPrintDeck() {
  printDeck.innerHTML = (presentation.slides || [])
    .map((slide) => {
      const bulletHtml = slide.blocks
        .map((block) => {
          if (block.type === "bullets") {
            return `<ul>${(block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
          }

          return `<p class="print-callout">${escapeHtml(block.content || "")}</p>`;
        })
        .join("");
      const sources = (slide.sourceRefs || []).map((ref) => escapeHtml(ref.label)).join("; ");

      return `
        <article class="print-slide">
          <header>
            <span>${escapeHtml(presentation.scenario)}</span>
            <span>${slide.order}/${presentation.slides.length}</span>
          </header>
          <h2>${escapeHtml(slide.title)}</h2>
          ${bulletHtml}
          <footer>Источник: ${sources || "добавьте источник"}</footer>
        </article>
      `;
    })
    .join("");
}

function startProgress(states) {
  let index = 0;
  jobStatus.textContent = states[index];
  updatePipeline(states, index);
  window.clearInterval(progressTimer);
  progressTimer = window.setInterval(() => {
    index = Math.min(index + 1, states.length - 1);
    jobStatus.textContent = states[index];
    updatePipeline(states, index);
  }, 900);
}

function stopProgress(status) {
  window.clearInterval(progressTimer);
  progressTimer = null;
  jobStatus.textContent = status;
}

function updatePipeline(states, activeIndex) {
  pipelineSteps.innerHTML = states
    .map((state, index) => {
      const className = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
      return `<li class="${className}">${escapeHtml(state)}</li>`;
    })
    .join("");
}

function setBusy(isBusy) {
  generateBtn.disabled = isBusy;
  generateBtn.textContent = isBusy ? "Собираем..." : "Собрать учебную презентацию";
}

function renderFileChips(files) {
  fileChips.innerHTML = "";

  if (!files.length) {
    fileChips.innerHTML = '<span class="chip">Можно начать без файлов</span>';
    return;
  }

  files.slice(0, 5).forEach((file) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = file.name;
    fileChips.append(chip);
  });

  if (files.length > 5) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `+${files.length - 5} файлов`;
    fileChips.append(chip);
  }
}

function getActiveSlide() {
  return presentation.slides[activeSlideIndex];
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function createInitialPresentation() {
  return {
    id: "demo-local",
    title: "Школьный доклад: Искусственный интеллект в образовании",
    scenario: "Школьный доклад",
    level: "8-11 класс",
    slideCount: 4,
    generationMode: "demo",
    sources: [
      {
        id: "src-demo",
        label: "пример-конспект.txt",
        type: "TXT",
        excerpt:
          "Искусственный интеллект помогает адаптировать объяснения под уровень ученика, быстро находить пробелы в знаниях и готовить материалы для повторения.",
      },
    ],
    outline: ["Введение", "Главные идеи", "Пример", "Выводы"],
    slides: [
      {
        id: "slide-1",
        order: 1,
        title: "Искусственный интеллект помогает учиться персонально",
        layout: "hero",
        blocks: [
          {
            type: "bullets",
            items: [
              "AI может подстраивать объяснения под уровень ученика.",
              "Он помогает быстрее находить пробелы в знаниях.",
              "Ученику важно понимать источник каждого тезиса.",
            ],
          },
          {
            type: "callout",
            content: "Проще: AI не заменяет учебу, а помогает разобраться и подготовиться к выступлению.",
          },
        ],
        speakerNotes:
          "Начните с примера: один ученик просит объяснить тему проще, другой хочет проверить доклад. Затем покажите, что AI полезен как помощник, если ученик понимает материал.",
        timingSeconds: 50,
        sourceRefs: [
          {
            sourceId: "src-demo",
            label: "пример-конспект.txt",
            excerpt:
              "Искусственный интеллект помогает адаптировать объяснения под уровень ученика, быстро находить пробелы в знаниях и готовить материалы для повторения.",
            page: null,
          },
        ],
        defenseQuestions: [
          "Почему AI не должен полностью заменять работу ученика?",
          "Как проверить, что тезис взят из источника?",
        ],
      },
      {
        id: "slide-2",
        order: 2,
        title: "Главные учебные пользы",
        layout: "bullets",
        blocks: [
          {
            type: "bullets",
            items: [
              "Сложный текст можно превратить в короткий план.",
              "Презентация получает заметки для выступления.",
              "Вопросы для защиты помогают подготовиться заранее.",
            ],
          },
        ],
        speakerNotes: "Расскажите по одному примеру на каждый пункт и свяжите пользу с учебной ситуацией.",
        timingSeconds: 55,
        sourceRefs: [
          {
            sourceId: "src-demo",
            label: "пример-конспект.txt",
            excerpt: "Короткий план, заметки и вопросы помогают готовиться к выступлению.",
            page: null,
          },
        ],
        defenseQuestions: ["Какая польза самая важная для школьного доклада?"],
      },
      {
        id: "slide-3",
        order: 3,
        title: "Как использовать источники",
        layout: "two-column",
        blocks: [
          {
            type: "bullets",
            items: [
              "Каждый важный тезис связан с файлом или конспектом.",
              "Фрагмент источника помогает объяснить, откуда взята мысль.",
              "Если источник слабый, тезис лучше перепроверить.",
            ],
          },
        ],
        speakerNotes: "Покажите источник внизу слайда и объясните, что это не просто украшение, а способ проверить доклад.",
        timingSeconds: 50,
        sourceRefs: [
          {
            sourceId: "src-demo",
            label: "пример-конспект.txt",
            excerpt: "Источник нужен, чтобы ученик мог объяснить происхождение мысли.",
            page: null,
          },
        ],
        defenseQuestions: ["Что делать, если преподаватель спрашивает источник тезиса?"],
      },
      {
        id: "slide-4",
        order: 4,
        title: "Вывод",
        layout: "summary",
        blocks: [
          {
            type: "bullets",
            items: [
              "StudyDeck AI помогает структурировать материал.",
              "Главная ценность - подготовка к понятному выступлению.",
              "Ученик сохраняет контроль над смыслом и источниками.",
            ],
          },
        ],
        speakerNotes: "Завершите доклад мыслью: хороший AI-помощник не списывает за ученика, а помогает говорить понятнее.",
        timingSeconds: 45,
        sourceRefs: [
          {
            sourceId: "src-demo",
            label: "пример-конспект.txt",
            excerpt: "AI должен помогать разобраться, а не заменять учебную работу.",
            page: null,
          },
        ],
        defenseQuestions: ["Какой главный риск есть у AI-инструментов для учебы?"],
      },
    ],
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(value) {
  return String(value || "studydeck-presentation")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase() || "studydeck-presentation";
}

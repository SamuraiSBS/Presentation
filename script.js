const storageKeys = {
  draft: "studydeck:draft-input",
  presentation: "studydeck:presentation",
  activeSlide: "studydeck:active-slide",
};

const uiStates = {
  idle: "idle",
  uploading: "uploading",
  generating: "generating",
  reviewingOutline: "reviewingOutline",
  editing: "editing",
  exporting: "exporting",
  error: "error",
};

const defaultDraft = {
  prompt:
    'Сделай презентацию на 10 слайдов по теме "Искусственный интеллект в образовании". Используй загруженные материалы, объясни простыми словами, добавь список источников, заметки и рассказ для выступления.',
  scenario: "Школьный доклад",
  level: "8-11 класс",
  mode: "С источниками",
  slideCount: "10",
};

const page = document.body.dataset.page || "home";
const stateAlert = document.querySelector("#stateAlert");
const jobStatus = document.querySelector("#jobStatus");
const pipelineSteps = document.querySelector("#pipelineSteps");
const emptyState = document.querySelector("#emptyState");
const printDeck = document.querySelector("#printDeck");

let draftInput = loadDraftInput();
let presentation = loadPresentation();
let activeSlideIndex = loadActiveSlideIndex();
let progressTimer = null;
let currentUiState = uiStates.idle;

setUiState(uiStates.idle);
initTabs();
initPage();

window.addEventListener("afterprint", () => {
  if (!printDeck) return;
  printDeck.innerHTML = "";
  setUiState(uiStates.editing, "PDF готов через окно печати. Можно вернуться к редактору.");
});

function initPage() {
  if (page === "prompt") {
    initPromptPage();
  }

  if (page === "files") {
    initFilesPage();
  }

  if (page === "plan") {
    initPlanPage();
  }

  if (page === "editor") {
    initEditorPage();
  }

  if (page === "export") {
    initExportPage();
  }
}

function initPromptPage() {
  const promptInput = document.querySelector("#prompt");
  const slideCount = document.querySelector("#slideCount");
  const tone = document.querySelector("#tone");
  const mode = document.querySelector("#mode");
  const savePromptBtn = document.querySelector("#savePromptBtn");

  promptInput.value = draftInput.prompt;
  setSelectValue(slideCount, draftInput.slideCount);
  setSelectValue(tone, draftInput.level);
  setSelectValue(mode, draftInput.mode);
  setActiveScenario(draftInput.scenario);

  savePromptBtn.addEventListener("click", () => {
    const prompt = promptInput.value.trim();

    if (prompt.length < 18) {
      setUiState(uiStates.error, "Добавьте тему, предмет или требования. Так AI соберет более полезный план.");
      promptInput.focus();
      return;
    }

    draftInput = {
      prompt,
      scenario: document.querySelector(".tab.active")?.dataset.scenario || defaultDraft.scenario,
      level: tone.value,
      mode: mode.value,
      slideCount: slideCount.value,
    };

    saveDraftInput(draftInput);
    setUiState(uiStates.idle, "Промт сохранен. Переходим к материалам.");
    window.location.href = "/files";
  });
}

function initFilesPage() {
  const fileInput = document.querySelector("#fileInput");
  const fileChips = document.querySelector("#fileChips");
  const dropZone = document.querySelector("#dropZone");
  const generateBtn = document.querySelector("#generateBtn");
  const draftSummary = document.querySelector("#draftSummary");

  draftSummary.textContent = draftInput.prompt
    ? `${draftInput.scenario}, ${draftInput.level}, ${draftInput.slideCount} слайдов. Файлы не обязательны, но с ними источники будут точнее.`
    : "Файлы не обязательны, но с ними источники будут точнее.";

  fileInput.addEventListener("change", () => {
    renderFileChips(fileInput, fileChips);
  });

  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    setUiState(uiStates.uploading, "Отпустите файлы здесь - добавим их к презентации.");
    dropZone.classList.add("dragging");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragging");
    setUiState(uiStates.idle);
  });

  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");

    if (!event.dataTransfer?.files?.length) {
      setUiState(uiStates.idle);
      return;
    }

    const transfer = new DataTransfer();
    Array.from(event.dataTransfer.files).forEach((file) => transfer.items.add(file));
    fileInput.files = transfer.files;
    renderFileChips(fileInput, fileChips);
    setUiState(uiStates.idle, "Файлы добавлены. Теперь можно собрать план и слайды.");
  });

  generateBtn.addEventListener("click", async () => {
    const files = Array.from(fileInput.files || []);

    if (!draftInput.prompt || draftInput.prompt.trim().length < 18) {
      setUiState(uiStates.error, "Сначала заполните промт. Без темы презентация получится слишком общей.");
      return;
    }

    const formData = new FormData();
    formData.append("prompt", draftInput.prompt);
    formData.append("scenario", draftInput.scenario);
    formData.append("level", draftInput.level);
    formData.append("mode", draftInput.mode);
    formData.append("slideCount", draftInput.slideCount);
    files.forEach((file) => formData.append("files", file));

    setBusy(generateBtn, true);
    setUiState(
      uiStates.generating,
      files.length
        ? "Разбираем материалы и связываем тезисы с источниками."
        : "Файлов нет. Соберем черновик по запросу, но источники лучше проверить вручную.",
    );
    startProgress(["Загружаем материалы", "Извлекаем главное", "Собираем план", "Пишем слайды", "Проверяем источники"]);

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
      savePresentation();
      saveActiveSlideIndex();
      stopProgress("Черновик готов к проверке");
      setUiState(uiStates.reviewingOutline, "План и слайды готовы. Сейчас откроется проверка структуры.");
      window.location.href = "/plan";
    } catch (error) {
      stopProgress(error.message || "Ошибка генерации");
      setUiState(uiStates.error, error.message || "Не удалось собрать презентацию. Попробуйте уточнить запрос.");
      updatePipeline(["Материалы не разобраны", "План не создан", "Попробуйте другой запрос"], 0);
    } finally {
      setBusy(generateBtn, false);
    }
  });
}

function initPlanPage() {
  const planContent = document.querySelector("#planContent");
  const deckTitle = document.querySelector("#deckTitle");
  const planMeta = document.querySelector("#planMeta");
  const outlineList = document.querySelector("#outlineList");
  const planSources = document.querySelector("#planSources");

  if (!hasPresentation()) {
    showEmptyState(planContent);
    return;
  }

  hideEmptyState(planContent);
  deckTitle.textContent = presentation.title;
  planMeta.textContent = `${presentation.scenario} · ${presentation.level} · ${presentation.slides.length} слайдов`;

  outlineList.innerHTML = (presentation.outline?.length ? presentation.outline : presentation.slides.map((slide) => slide.title))
    .map((item, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span>${escapeHtml(item)}</li>`)
    .join("");

  const sources = presentation.sources || [];
  planSources.innerHTML = sources.length
    ? sources
        .map(
          (source) => `
            <div class="mini-item">
              <strong>${escapeHtml(source.label)}</strong>
              <span>${escapeHtml(source.excerpt || "Фрагмент источника не указан.")}</span>
            </div>
          `,
        )
        .join("")
    : '<div class="warning-state">Источников нет. Проверьте важные тезисы вручную или вернитесь к загрузке файлов.</div>';
}

function initEditorPage() {
  const editorPreview = document.querySelector("#editor");
  const mobileRail = document.querySelector(".mobile-rail");

  if (!hasPresentation()) {
    showEmptyState(editorPreview);
    if (mobileRail) mobileRail.hidden = true;
    return;
  }

  hideEmptyState(editorPreview);
  if (mobileRail) mobileRail.hidden = false;
  bindEditorEvents();
  renderEditor();
}

function initExportPage() {
  const exportContent = document.querySelector("#exportContent");
  const exportSummary = document.querySelector("#exportSummary");
  const sourceAudit = document.querySelector("#sourceAudit");
  const printBtn = document.querySelector("#printBtn");
  const pptxBtn = document.querySelector("#pptxBtn");

  if (!hasPresentation()) {
    showEmptyState(exportContent);
    return;
  }

  hideEmptyState(exportContent);
  const sourceCount = (presentation.sources || []).length;
  const speechCount = getSpeechScript().length;
  exportSummary.textContent = `${presentation.title}: ${presentation.slides.length} слайдов, ${sourceCount} источников, ${speechCount} частей рассказа.`;

  sourceAudit.innerHTML = [
    {
      label: "Слайды",
      value: `${presentation.slides.length} шт.`,
      ok: presentation.slides.length > 0,
    },
    {
      label: "Источники",
      value: sourceCount ? `${sourceCount} шт.` : "нет источников",
      ok: sourceCount > 0,
    },
    {
      label: "Рассказ",
      value: speechCount ? `${speechCount} частей` : "нужно добавить",
      ok: speechCount > 0,
    },
  ]
    .map(
      (item) => `
        <div class="mini-item ${item.ok ? "" : "needs-review"}">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.value)}</span>
        </div>
      `,
    )
    .join("");

  printBtn.addEventListener("click", () => {
    setUiState(uiStates.exporting, "Готовим PDF через печать браузера.");
    buildPrintDeck();
    window.print();
  });

  pptxBtn.addEventListener("click", () => exportPptx(pptxBtn));
}

function bindEditorEvents() {
  const slidesList = document.querySelector("#slidesList");
  const slideCanvas = document.querySelector("#slideCanvas");
  const notesEditor = document.querySelector("#notesEditor");
  const prevSlideBtn = document.querySelector("#prevSlideBtn");
  const nextSlideBtn = document.querySelector("#nextSlideBtn");
  const mobileSteps = document.querySelectorAll(".mobile-step");
  const editorPreview = document.querySelector("#editor");

  mobileSteps.forEach((step, index) => {
    if (step.tagName === "A") return;
    step.addEventListener("click", () => {
      const panels = ["outline", "canvas", "speech", "canvas"];
      mobileSteps.forEach((item) => item.classList.remove("active"));
      step.classList.add("active");
      editorPreview.dataset.mobilePanel = panels[index] || "canvas";
    });
  });

  slidesList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-slide-index]");
    if (!button) return;
    activeSlideIndex = Number(button.dataset.slideIndex);
    saveActiveSlideIndex();
    setUiState(uiStates.editing);
    renderEditor();
  });

  prevSlideBtn.addEventListener("click", () => {
    activeSlideIndex = Math.max(0, activeSlideIndex - 1);
    saveActiveSlideIndex();
    setUiState(uiStates.editing);
    renderEditor();
  });

  nextSlideBtn.addEventListener("click", () => {
    activeSlideIndex = Math.min(presentation.slides.length - 1, activeSlideIndex + 1);
    saveActiveSlideIndex();
    setUiState(uiStates.editing);
    renderEditor();
  });

  slideCanvas.addEventListener("input", (event) => {
    const target = event.target;
    const slide = getActiveSlide();
    if (!slide) return;

    setUiState(uiStates.editing, "Правки сохраняются в текущем черновике.");

    if (target.matches("[data-edit='title']")) {
      slide.title = cleanText(target.textContent);
      savePresentation();
      renderSlideListOnly();
      document.querySelector("#deckTitle").textContent = presentation.title;
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

    savePresentation();
  });

  notesEditor.addEventListener("input", () => {
    const slide = getActiveSlide();
    if (!slide) return;
    slide.speakerNotes = notesEditor.value;
    savePresentation();
    setUiState(uiStates.editing, "Заметки обновлены. Используйте их для репетиции выступления.");
  });
}

function initTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
    });
  });
}

function setUiState(state, message = "") {
  currentUiState = state;
  document.body.dataset.state = state;

  if (!stateAlert) return;

  const defaults = {
    [uiStates.idle]: "",
    [uiStates.uploading]: "Добавьте материалы, чтобы источники были точнее.",
    [uiStates.generating]: "Собираем черновик. Сначала появится план, затем слайды.",
    [uiStates.reviewingOutline]: "Проверьте план, источники и сложные места перед редактурой.",
    [uiStates.editing]: "",
    [uiStates.exporting]: "Подготовка экспорта.",
    [uiStates.error]: "Что-то пошло не так. Исправьте запрос или попробуйте еще раз.",
  };

  const nextMessage = message || defaults[state] || "";
  stateAlert.textContent = nextMessage;
  stateAlert.classList.toggle("visible", Boolean(nextMessage));
}

function renderEditor() {
  if (!hasPresentation()) return;
  activeSlideIndex = Math.min(activeSlideIndex, presentation.slides.length - 1);
  const editorPreview = document.querySelector("#editor");
  editorPreview.dataset.mobilePanel ||= "canvas";
  renderSlideListOnly();
  renderCanvas();
  renderDetails();
  renderSpeechScript();
  document.querySelector("#deckTitle").textContent = presentation.title;
  document.querySelector("#generationMode").textContent = presentation.generationMode || "demo";
  document.querySelector("#activeSlideLabel").textContent = `Слайд ${activeSlideIndex + 1}`;
}

function renderSlideListOnly() {
  const slidesList = document.querySelector("#slidesList");
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
  const slideCanvas = document.querySelector("#slideCanvas");
  const slide = getActiveSlide();
  const sourceCount = (slide.sourceRefs || []).length;
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
          <strong>${sourceCount}</strong>
          <span>${sourceCount ? "источники" : "нет источников"}</span>
        </div>
        <div>
          <strong>${getSpeechScript().length}</strong>
          <span>части рассказа</span>
        </div>
      </div>
    </div>
    <div class="source-strip">
      <span>${sourceLine ? `Источник: ${sourceLine}` : "Источник не указан - проверьте тезис вручную"}</span>
      <span>${escapeHtml(presentation.level)}</span>
    </div>
  `;
}

function renderDetails() {
  const notesEditor = document.querySelector("#notesEditor");
  const slide = getActiveSlide();
  notesEditor.value = slide.speakerNotes || "";
}

function renderSpeechScript() {
  const speechScript = document.querySelector("#speechScript");
  if (!speechScript) return;

  const items = getSpeechScript();
  speechScript.innerHTML = items.length
    ? items
        .map(
          (item, index) => `
            <article class="speech-item ${index === activeSlideIndex ? "active" : ""}">
              <strong>Слайд ${item.slideOrder || index + 1}: ${escapeHtml(item.slideTitle || presentation.slides[index]?.title || "")}</strong>
              <p>${escapeHtml(item.text || "")}</p>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-state">Рассказ появится после генерации презентации.</div>';
}

function buildPrintDeck() {
  if (!printDeck || !hasPresentation()) return;
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

async function exportPptx(button) {
  if (!hasPresentation()) {
    setUiState(uiStates.error, "Нет презентации для экспорта.");
    return;
  }

  button.disabled = true;
  setUiState(uiStates.exporting, "Готовим PPTX для скачивания.");
  if (jobStatus) jobStatus.textContent = "Готовим PPTX";

  try {
    const response = await fetch("/api/export/pptx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presentation: { ...presentation, speechScript: getSpeechScript() } }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Не удалось экспортировать PPTX.");
    }

    const blob = await response.blob();
    downloadBlob(blob, `${slugify(presentation.title)}.pptx`);
    if (jobStatus) jobStatus.textContent = "PPTX готов";
    setUiState(uiStates.editing, "PPTX скачан. Можно продолжить правки и экспортировать еще раз.");
  } catch (error) {
    if (jobStatus) jobStatus.textContent = error.message || "Ошибка экспорта";
    setUiState(uiStates.error, error.message || "PPTX не скачался. Попробуйте PDF или повторите экспорт.");
  } finally {
    button.disabled = false;
  }
}

function startProgress(states) {
  if (!jobStatus || !pipelineSteps) return;
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
  if (jobStatus) jobStatus.textContent = status;
}

function updatePipeline(states, activeIndex) {
  if (!pipelineSteps) return;
  pipelineSteps.innerHTML = states
    .map((state, index) => {
      const className = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
      return `<li class="${className}">${escapeHtml(state)}</li>`;
    })
    .join("");
}

function setBusy(button, isBusy) {
  button.disabled = isBusy;
  button.textContent = isBusy ? "Собираем..." : "Собрать презентацию";
}

function renderFileChips(fileInput, fileChips) {
  const files = Array.from(fileInput.files || []);
  fileChips.innerHTML = "";

  if (!files.length) {
    fileChips.innerHTML = '<span class="chip warning">Можно продолжить без файлов, но источники будут слабее</span>';
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

function showEmptyState(contentNode) {
  if (emptyState) emptyState.hidden = false;
  if (contentNode) contentNode.hidden = true;
  const flowActions = document.querySelector(".flow-actions");
  if (flowActions) flowActions.hidden = true;
}

function hideEmptyState(contentNode) {
  if (emptyState) emptyState.hidden = true;
  if (contentNode) contentNode.hidden = false;
  const flowActions = document.querySelector(".flow-actions");
  if (flowActions) flowActions.hidden = false;
}

function hasPresentation() {
  return Boolean(presentation && Array.isArray(presentation.slides) && presentation.slides.length);
}

function getActiveSlide() {
  return presentation.slides[activeSlideIndex];
}

function getSpeechScript() {
  const script = Array.isArray(presentation?.speechScript) ? presentation.speechScript : [];

  if (script.length) {
    return script
      .map((item, index) => ({
        slideOrder: Number(item.slideOrder || index + 1),
        slideTitle: cleanText(item.slideTitle || presentation.slides?.[index]?.title || `Слайд ${index + 1}`),
        text: cleanText(item.text || ""),
      }))
      .filter((item) => item.text);
  }

  return (presentation?.slides || []).map((slide, index) => ({
    slideOrder: slide.order || index + 1,
    slideTitle: slide.title || `Слайд ${index + 1}`,
    text: slide.speakerNotes || "Коротко расскажите основную мысль этого слайда своими словами.",
  }));
}

function loadDraftInput() {
  const stored = readJson(storageKeys.draft);
  return { ...defaultDraft, ...(stored || {}) };
}

function saveDraftInput(value) {
  sessionStorage.setItem(storageKeys.draft, JSON.stringify(value));
}

function loadPresentation() {
  return readJson(storageKeys.presentation);
}

function savePresentation() {
  sessionStorage.setItem(storageKeys.presentation, JSON.stringify(presentation));
}

function loadActiveSlideIndex() {
  return Number(sessionStorage.getItem(storageKeys.activeSlide) || 0);
}

function saveActiveSlideIndex() {
  sessionStorage.setItem(storageKeys.activeSlide, String(activeSlideIndex));
}

function readJson(key) {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function setSelectValue(select, value) {
  if (!select) return;
  const option = Array.from(select.options).find((item) => item.value === String(value));
  if (option) select.value = option.value;
}

function setActiveScenario(scenario) {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.scenario === scenario);
  });

  if (![...tabs].some((tab) => tab.classList.contains("active")) && tabs[0]) {
    tabs[0].classList.add("active");
  }
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
  return (
    String(value || "studydeck-presentation")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase() || "studydeck-presentation"
  );
}

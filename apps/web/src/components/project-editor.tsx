"use client";

import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  Check,
  Copy,
  Eye,
  Image,
  Italic,
  LayoutTemplate,
  Lock,
  MousePointer2,
  Plus,
  Redo2,
  Replace,
  SendToBack,
  Settings2,
  Square,
  Trash2,
  Type,
  Underline,
  Undo2,
  Unlock,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { RichTextField } from "@/components/editor/rich-text-field";
import type {
  CanvasElement,
  CanvasImageElement,
  CanvasShapeElement,
  CanvasTextElement,
  PresentationDocument,
  PresentationTheme,
  Slide,
  SlideCanvas,
  SlideLayout,
  SlideVisual,
} from "@studydeck/shared";
import {
  buildSlideCanvas,
  canvasBackgroundCss,
  ensureEditableCanvas,
  sortCanvasElements,
} from "@studydeck/shared";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";

type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  presentation?: { document: PresentationDocument } | null;
};

type Tool = "select" | "text" | "shape";
type ViewMode = "preview" | "edit";
type SimpleEditorTab = "text" | "image";
type MobileEditorSection = "slides" | "edit" | "preview";
type SaveStatus = "idle" | "saving" | "saved" | "error";
type ElementPatch = Partial<CanvasElement> & Record<string, unknown>;
type DragState =
  | {
      mode: "move";
      id: string;
      startX: number;
      startY: number;
      original: CanvasElement;
      originals: CanvasElement[];
    }
  | {
      mode: "resize";
      id: string;
      startX: number;
      startY: number;
      original: CanvasElement;
      originals: CanvasElement[];
      lastValid: CanvasElement[];
    };

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const CUSTOM_CANVAS_MARKER_SUFFIX = "custom-canvas-marker";
const MIN_READABLE_TEXT_SIZE = 12;

export function ProjectEditor({
  initialProject,
}: {
  initialProject: ProjectPayload;
}) {
  const [project, setProject] = useState(() =>
    sanitizeProjectForDisplay(initialProject),
  );
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [advancedMode, setAdvancedMode] = useState(false);
  const [simpleTab, setSimpleTab] = useState<SimpleEditorTab>("text");
  const [mobileSection, setMobileSection] =
    useState<MobileEditorSection>("preview");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [undoStack, setUndoStack] = useState<SlideCanvas[]>([]);
  const [redoStack, setRedoStack] = useState<SlideCanvas[]>([]);
  const [canvasScale, setCanvasScale] = useState(1);
  const [editingTextId, setEditingTextId] = useState("");
  const [imageReplaceTargetId, setImageReplaceTargetId] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const presentation = project.presentation?.document
    ? ensureEditableCanvas(project.presentation.document)
    : null;
  const theme = presentation?.presentationTheme;
  const slide = presentation?.slides[active];
  const canvas =
    slide?.canvas || (slide && theme ? buildSlideCanvas(slide, theme) : null);
  const selected =
    canvas?.elements.find((element) => element.id === selectedId) || null;
  const primaryImage = canvas?.elements.find(
    (element): element is CanvasImageElement => element.type === "image",
  );
  const canvasWidth = canvas?.width ?? CANVAS_WIDTH;
  const canvasHeight = canvas?.height ?? CANVAS_HEIGHT;
  const showObjectCanvas = advancedMode && viewMode === "edit";
  const canUpload =
    project.id !== "demo" || process.env.NEXT_PUBLIC_DEMO_PREVIEW === "false";

  useEffect(() => {
    setSelectedId("");
    setUndoStack([]);
    setRedoStack([]);
    setTool("select");
    setViewMode("preview");
    setAdvancedMode(false);
    setSimpleTab("text");
    setMobileSection("preview");
    setSaveStatus("idle");
    setEditingTextId("");
    setImageReplaceTargetId("");
  }, [active]);

  useEffect(() => {
    if (editingTextId && editingTextId !== selectedId) {
      setEditingTextId("");
    }
  }, [editingTextId, selectedId]);

  useEffect(() => {
    if (!editingTextId) return;
    const editor = stageRef.current?.querySelector<HTMLElement>(
      `[data-element-editor="${editingTextId}"]`,
    );
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [editingTextId]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const updateScale = (width: number, height: number) => {
      if (width <= 0 || height <= 0) return;
      const nextScale = Math.min(width / canvasWidth, height / canvasHeight);
      setCanvasScale((current) =>
        Math.abs(current - nextScale) < 0.001 ? current : nextScale,
      );
    };

    const readFrameContentBox = () => {
      const styles = window.getComputedStyle(frame);
      const horizontalPadding =
        parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding =
        parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      updateScale(
        frame.clientWidth - horizontalPadding,
        frame.clientHeight - verticalPadding,
      );
    };

    readFrameContentBox();

    const observer = new ResizeObserver(([entry]) => {
      updateScale(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(frame);

    return () => observer.disconnect();
  }, [canvasHeight, canvasWidth, showObjectCanvas]);

  async function refresh() {
    const response = await fetch(`/api/projects/${project.id}`);
    setProject(sanitizeProjectForDisplay(await response.json()));
  }

  async function generate() {
    setBusy(true);
    setActionError("");

    try {
      const response = await fetch(`/api/projects/${project.id}/generate`, {
        method: "POST",
      });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setActionError(
        editorError(
          error,
          "Не получилось запустить сборку презентации. Попробуй ещё раз.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSlide(next: {
    title?: string;
    thesis?: string;
    bullets?: string[];
    layout?: SlideLayout;
    visual?: SlideVisual;
    blocks?: Slide["blocks"];
    canvas?: SlideCanvas;
    speakerNotes?: string;
  }) {
    if (!slide) return;
    setSaveStatus("saving");
    const response = await fetch(
      `/api/projects/${project.id}/slides/${slide.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      },
    );
    if (!response.ok) {
      setSaveStatus("error");
      setActionError(
        editorError(
          new Error(await response.text()),
          "Не получилось сохранить изменения. Попробуй ещё раз.",
        ),
      );
      return;
    }
    setSaveStatus("saved");
  }

  function updateLocalSlide(patch: Partial<Slide>) {
    setProject((current) => {
      const document = current.presentation?.document;
      if (!document) return current;
      const slides = document.slides.map((item, index) =>
        index === active ? { ...item, ...patch } : item,
      );
      const speechScript = document.speechScript.map((item) =>
        item.slideOrder === slide?.order
          ? {
              ...item,
              slideTitle: patch.title ?? item.slideTitle,
              text: patch.speakerNotes ?? item.text,
            }
          : item,
      );
      return {
        ...current,
        presentation: {
          ...current.presentation,
          document: ensureEditableCanvas({ ...document, speechScript, slides }),
        },
      };
    });
  }

  function saveSlideText(patch: {
    title?: string;
    thesis?: string;
    bullets?: string[];
    speakerNotes?: string;
  }) {
    if (!slide) return;
    const nextSlide: Slide = { ...slide, ...patch };
    const blocks = blocksFromSlideText(nextSlide);
    const payload = { ...patch, blocks };
    updateLocalSlide({ ...patch, blocks });
    void saveSlide(payload);
  }

  function setLocalCanvas(next: SlideCanvas) {
    setProject((current) => {
      const document = current.presentation?.document;
      if (!document) return current;
      const slides = document.slides.map((item, index) =>
        index === active ? { ...item, canvas: next } : item,
      );
      return {
        ...current,
        presentation: {
          ...current.presentation,
          document: ensureEditableCanvas({ ...document, slides }),
        },
      };
    });
  }

  function commitCanvas(
    next: SlideCanvas,
    options: { history?: boolean; persist?: boolean } = {
      history: true,
      persist: true,
    },
  ) {
    if (!canvas || !slide) return;
    const nextCanvas = options.persist
      ? markCanvasAsCustom(slide.id, next)
      : next;
    const normalized = {
      ...nextCanvas,
      elements: sortCanvasElements(nextCanvas.elements),
    };
    if (options.history) {
      setUndoStack((stack) => [...stack.slice(-29), cloneCanvas(canvas)]);
      setRedoStack([]);
    }
    setLocalCanvas(normalized);
    if (options.persist) {
      void saveSlide({
        title: titleFromCanvas(slide, normalized),
        canvas: normalized,
      });
    }
  }

  function updateSelected(patch: ElementPatch) {
    if (!canvas || !selected) return;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) =>
        element.id === selected.id
          ? ({ ...element, ...patch } as CanvasElement)
          : element,
      ),
    });
  }

  function addTextElement() {
    if (!canvas || !theme) return;
    const id = `text-${crypto.randomUUID()}`;
    const element: CanvasTextElement = {
      id,
      type: "text",
      role: "free",
      x: 170,
      y: 150,
      w: 520,
      h: 120,
      rotation: 0,
      zIndex: nextZIndex(canvas),
      opacity: 1,
      locked: false,
      text: "Новый текст",
      runs: [{ text: "Новый текст" }],
      fontSize: 34,
      fontFamily: theme.fonts.body,
      color: theme.colors.text,
      bold: false,
      italic: false,
      underline: false,
      align: "left",
      valign: "top",
    };
    commitCanvas({ ...canvas, elements: [...canvas.elements, element] });
    setSelectedId(id);
    setTool("select");
  }

  function addShapeElement(shape: CanvasShapeElement["shape"] = "roundRect") {
    if (!canvas || !theme) return;
    const id = `shape-${crypto.randomUUID()}`;
    const element: CanvasShapeElement = {
      id,
      type: "shape",
      shape,
      x: 210,
      y: 210,
      w: 280,
      h: 150,
      rotation: 0,
      zIndex: nextZIndex(canvas),
      opacity: 1,
      locked: false,
      fill: theme.colors.surfaceAlt,
      stroke: theme.colors.accent,
      strokeWidth: 2,
    };
    commitCanvas({ ...canvas, elements: [...canvas.elements, element] });
    setSelectedId(id);
    setTool("select");
  }

  function deleteSelected() {
    if (!canvas || !selected || selected.locked) return;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.filter((element) =>
        selected.groupId
          ? element.groupId !== selected.groupId
          : element.id !== selected.id,
      ),
    });
    setSelectedId("");
    setEditingTextId("");
  }

  function duplicateSelected() {
    if (!canvas || !selected) return;
    const source = selected.groupId
      ? canvas.elements.filter(
          (element) => element.groupId === selected.groupId,
        )
      : [selected];
    const nextGroupId = selected.groupId
      ? `group:${crypto.randomUUID()}`
      : undefined;
    const baseZ = nextZIndex(canvas);
    const copies = source.map(
      (element, index) =>
        ({
          ...element,
          id: `${element.type}-${crypto.randomUUID()}`,
          groupId: nextGroupId,
          x: clamp(element.x + 32, 0, canvasWidth - element.w),
          y: clamp(element.y + 32, 0, canvasHeight - element.h),
          zIndex: baseZ + index,
        }) as CanvasElement,
    );
    commitCanvas({ ...canvas, elements: [...canvas.elements, ...copies] });
    setSelectedId(
      copies.find((element) => element.type === selected.type)?.id ||
        copies[0].id,
    );
  }

  function moveLayer(direction: "up" | "down") {
    if (!canvas || !selected) return;
    const delta = direction === "up" ? 1 : -1;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) =>
        selected.groupId
          ? element.groupId === selected.groupId
            ? { ...element, zIndex: Math.max(1, element.zIndex + delta) }
            : element
          : element.id === selected.id
            ? { ...element, zIndex: Math.max(1, element.zIndex + delta) }
            : element,
      ),
    });
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous || !canvas || !slide) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, cloneCanvas(canvas)]);
    setLocalCanvas(previous);
    void saveSlide({
      title: titleFromCanvas(slide, previous),
      canvas: previous,
    });
  }

  function redo() {
    const next = redoStack.at(-1);
    if (!next || !canvas || !slide) return;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, cloneCanvas(canvas)]);
    setLocalCanvas(next);
    void saveSlide({ title: titleFromCanvas(slide, next), canvas: next });
  }

  function onCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canvas || !theme) return;
    if (event.target !== event.currentTarget) return;
    setSelectedId("");
    setEditingTextId("");

    if (tool === "text") {
      const point = eventPoint(event, stageRef.current, canvasScale);
      const id = `text-${crypto.randomUUID()}`;
      const element: CanvasTextElement = {
        id,
        type: "text",
        role: "free",
        x: clamp(point.x - 180, 0, canvasWidth - 360),
        y: clamp(point.y - 40, 0, canvasHeight - 90),
        w: 360,
        h: 90,
        rotation: 0,
        zIndex: nextZIndex(canvas),
        opacity: 1,
        locked: false,
        text: "Новый текст",
        runs: [{ text: "Новый текст" }],
        fontSize: 32,
        fontFamily: theme.fonts.body,
        color: theme.colors.text,
        bold: false,
        italic: false,
        underline: false,
        align: "left",
        valign: "top",
      };
      commitCanvas({ ...canvas, elements: [...canvas.elements, element] });
      setSelectedId(id);
      setTool("select");
    }

    if (tool === "shape") {
      const point = eventPoint(event, stageRef.current, canvasScale);
      const id = `shape-${crypto.randomUUID()}`;
      const element: CanvasShapeElement = {
        id,
        type: "shape",
        shape: "roundRect",
        x: clamp(point.x - 130, 0, canvasWidth - 260),
        y: clamp(point.y - 70, 0, canvasHeight - 140),
        w: 260,
        h: 140,
        rotation: 0,
        zIndex: nextZIndex(canvas),
        opacity: 1,
        locked: false,
        fill: theme.colors.surfaceAlt,
        stroke: theme.colors.accent,
        strokeWidth: 2,
      };
      commitCanvas({ ...canvas, elements: [...canvas.elements, element] });
      setSelectedId(id);
      setTool("select");
    }
  }

  function startMove(
    event: PointerEvent<HTMLDivElement>,
    element: CanvasElement,
  ) {
    event.stopPropagation();
    setSelectedId(element.id);
    if (element.locked) return;
    if (editingTextId !== element.id) {
      setEditingTextId("");
    }
    const point = eventPoint(event, stageRef.current, canvasScale);
    const originals = element.groupId
      ? canvas!.elements.filter((item) => item.groupId === element.groupId)
      : [element];
    dragRef.current = {
      mode: "move",
      id: element.id,
      startX: point.x,
      startY: point.y,
      original: element,
      originals,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResize(
    event: PointerEvent<HTMLButtonElement>,
    element: CanvasElement,
  ) {
    if (element.locked) return;
    event.stopPropagation();
    const point = eventPoint(event, stageRef.current, canvasScale);
    const originals = element.groupId
      ? canvas!.elements.filter((item) => item.groupId === element.groupId)
      : [element];
    dragRef.current = {
      mode: "resize",
      id: element.id,
      startX: point.x,
      startY: point.y,
      original: element,
      originals,
      lastValid: originals,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!canvas || !dragRef.current) return;
    const drag = dragRef.current;
    const point = eventPoint(event, stageRef.current, canvasScale);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const originalById = new Map(
      drag.originals.map((element) => [element.id, element]),
    );
    if (drag.mode === "move") {
      const elements = canvas.elements.map((element) => {
        const original = originalById.get(element.id);
        if (!original) return element;
        return {
          ...element,
          x: clamp(original.x + dx, 0, canvasWidth - element.w),
          y: clamp(original.y + dy, 0, canvasHeight - element.h),
        } as CanvasElement;
      });
      setLocalCanvas({ ...canvas, elements });
      return;
    }
    const resized = drag.originals.map((original) => {
      const scaleX = clamp((drag.original.w + dx) / drag.original.w, 0.2, 5);
      const scaleY = clamp((drag.original.h + dy) / drag.original.h, 0.2, 5);
      const w = clamp(original.w * scaleX, 24, canvasWidth);
      const h = clamp(original.h * scaleY, 20, canvasHeight);
      if (original.type !== "text") {
        return {
          ...original,
          x: drag.original.x + (original.x - drag.original.x) * scaleX,
          y: drag.original.y + (original.y - drag.original.y) * scaleY,
          w,
          h,
        } as CanvasElement;
      }
      const fontSize = fittedTextSize(original, w, h);
      if (fontSize === null) return null;
      return {
        ...original,
        x: drag.original.x + (original.x - drag.original.x) * scaleX,
        y: drag.original.y + (original.y - drag.original.y) * scaleY,
        w,
        h,
        fontSize,
      } as CanvasElement;
    });
    const nextDragElements = resized.some((element) => element === null)
      ? drag.lastValid
      : (resized as CanvasElement[]);
    if (!resized.some((element) => element === null)) {
      drag.lastValid = nextDragElements;
    }
    const nextById = new Map(
      nextDragElements.map((element) => [element.id, element]),
    );
    const elements = canvas.elements.map((element) => {
      if (!originalById.has(element.id)) return element;
      return nextById.get(element.id) || element;
    });
    setLocalCanvas({ ...canvas, elements });
  }

  function onPointerUp() {
    if (!canvas || !dragRef.current) return;
    dragRef.current = null;
    commitCanvas(canvas, { history: true, persist: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      !showObjectCanvas ||
      !selected ||
      !canvas ||
      isTypingTarget(event.target)
    )
      return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    const dx =
      event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy =
      event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) => {
        const included = selected.groupId
          ? element.groupId === selected.groupId
          : element.id === selected.id;
        return included
          ? {
              ...element,
              x: clamp(element.x + dx, 0, canvasWidth - element.w),
              y: clamp(element.y + dy, 0, canvasHeight - element.h),
            }
          : element;
      }),
    });
  }

  async function uploadImage(file: File | null, replaceElementId = "") {
    if (!file || !slide) return;
    setBusy(true);
    setActionError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `/api/projects/${project.id}/slides/${slide.id}/assets`,
        { method: "POST", body },
      );
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as {
        element: CanvasImageElement;
      };
      const imageToReplace = replaceElementId
        ? canvas?.elements.find(
            (element): element is CanvasImageElement =>
              element.id === replaceElementId && element.type === "image",
          )
        : null;
      const nextElement: CanvasImageElement = imageToReplace
        ? {
            ...payload.element,
            id: imageToReplace.id,
            x: imageToReplace.x,
            y: imageToReplace.y,
            w: imageToReplace.w,
            h: imageToReplace.h,
            rotation: imageToReplace.rotation,
            zIndex: imageToReplace.zIndex,
            opacity: imageToReplace.opacity,
            locked: imageToReplace.locked,
            fit: imageToReplace.fit,
            url: `/api/projects/${project.id}/slides/${slide.id}/assets/${imageToReplace.id}`,
          }
        : payload.element;
      const next = canvas
        ? {
            ...canvas,
            elements: imageToReplace
              ? canvas.elements.map((element) =>
                  element.id === imageToReplace.id ? nextElement : element,
                )
              : [
                  ...canvas.elements.filter(
                    (element) => element.id !== payload.element.id,
                  ),
                  nextElement,
                ],
          }
        : {
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
            background: theme?.colors.background || "#F7F8FA",
            elements: [nextElement],
          };
      setLocalCanvas(next);
      setSelectedId(nextElement.id);
      void saveSlide({ title: titleFromCanvas(slide, next), canvas: next });
    } catch (error) {
      setActionError(
        editorError(
          error,
          "Не получилось загрузить изображение. Проверь файл и попробуй ещё раз.",
        ),
      );
    } finally {
      setBusy(false);
      setImageReplaceTargetId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!presentation || !slide || !canvas) {
    const canStartGeneration =
      project.status === "draft" || project.status === "failed";

    return (
      <section className="panel">
        <span className="status">{projectStatusLabel(project.status)}</span>
        <h1 className="page-title" style={{ fontSize: 44 }}>
          {project.title}
        </h1>
        <p className="lead">
          {canStartGeneration
            ? "Слайды ещё не собирались. Запусти подготовку, когда будешь готов."
            : "Презентация ещё собирается. Подожди немного и обнови страницу."}
        </p>
        {project.error ? (
          <p className="muted">
            {editorError(
              new Error(project.error),
              "Не получилось собрать презентацию. Попробуй ещё раз.",
            )}
          </p>
        ) : null}
        {actionError ? <p className="form-error">{actionError}</p> : null}
        {canStartGeneration ? (
          <div className="actions">
            <button
              className="button"
              type="button"
              onClick={generate}
              disabled={busy}
            >
              {busy ? "Запускаем..." : "Собрать презентацию"}
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="editor-workspace" data-testid="project-editor">
      <div className="editor-top">
        <div>
          <span className="status">{projectStatusLabel(project.status)}</span>
          <h1>{presentation.title}</h1>
        </div>
        <SaveIndicator status={saveStatus} />
      </div>

      {actionError ? <p className="form-error">{actionError}</p> : null}

      <section
        className="power-editor"
        data-mobile-section={mobileSection}
        onKeyDown={onKeyDown}
        tabIndex={0}
      >
        <aside className="slide-rail">
          <strong>Слайды</strong>
          <div className="slide-rail-list">
            {presentation.slides.map((item, index) => (
              <button
                className={`slide-thumb ${index === active ? "slide-thumb-active" : ""}`}
                key={item.id}
                type="button"
                aria-current={index === active ? "step" : undefined}
                onClick={() => {
                  setActive(index);
                  setMobileSection("preview");
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        </aside>

        <main className="canvas-shell">
          <EditorTopToolbar
            projectId={project.id}
            tool={tool}
            setTool={(nextTool) => {
              setTool(nextTool);
              setViewMode("edit");
            }}
            viewMode={showObjectCanvas ? "edit" : "preview"}
            advancedMode={advancedMode}
            onPreview={() => {
              setViewMode("preview");
              setMobileSection("preview");
            }}
            onOpenAdvanced={() => {
              setAdvancedMode(true);
              setViewMode("edit");
              setMobileSection("edit");
            }}
            onCloseAdvanced={() => {
              setAdvancedMode(false);
              setViewMode("preview");
              setSelectedId("");
              setEditingTextId("");
            }}
            previewDisabled={false}
            busy={busy}
            canUpload={canUpload}
            undoDisabled={!undoStack.length}
            redoDisabled={!redoStack.length}
            onUploadClick={() => {
              setViewMode("edit");
              setImageReplaceTargetId("");
              fileInputRef.current?.click();
            }}
            onUndo={undo}
            onRedo={redo}
          />
          <input
            ref={fileInputRef}
            className="file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!canUpload || busy}
            onChange={(event) =>
              void uploadImage(
                event.target.files?.[0] || null,
                imageReplaceTargetId,
              )
            }
          />

          {showObjectCanvas ? (
            <>
              <div className="canvas-scroll">
                <div className="canvas-frame" ref={frameRef}>
                  <div
                    className="canvas-viewport"
                    style={{
                      width: `${canvasWidth * canvasScale}px`,
                      height: `${canvasHeight * canvasScale}px`,
                    }}
                  >
                    <div
                      ref={stageRef}
                      className="object-canvas"
                      style={{
                        width: `${canvasWidth}px`,
                        height: `${canvasHeight}px`,
                        background: canvasBackgroundCss(
                          canvas.backgroundStyle,
                          canvas.background,
                        ),
                        transform: `scale(${canvasScale})`,
                      }}
                      onPointerDown={onCanvasPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    >
                      {sortCanvasElements(canvas.elements).map((element) => (
                        <CanvasElementView
                          element={element}
                          key={element.id}
                          selected={element.id === selectedId}
                          editing={editingTextId === element.id}
                          onPointerDown={(event) => startMove(event, element)}
                          onResizePointerDown={(event) =>
                            startResize(event, element)
                          }
                          onEditText={() => setEditingTextId(element.id)}
                          onStopEditText={() => setEditingTextId("")}
                          onTextChange={(text) => {
                            if (element.type !== "text" || !canvas) return;
                            const next = {
                              ...element,
                              text,
                              runs: [{ text }],
                            };
                            commitCanvas({
                              ...canvas,
                              elements: canvas.elements.map((item) =>
                                item.id === element.id ? next : item,
                              ),
                            });
                          }}
                        />
                      ))}
                    </div>
                    {selected ? (
                      <ObjectFloatingMenu
                        element={selected}
                        scale={canvasScale}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                        canUpload={canUpload}
                        busy={busy}
                        onEditText={() => setEditingTextId(selected.id)}
                        onUpdate={updateSelected}
                        onDuplicate={duplicateSelected}
                        onDelete={deleteSelected}
                        onLayerUp={() => moveLayer("up")}
                        onLayerDown={() => moveLayer("down")}
                        onReplaceImage={() => {
                          setImageReplaceTargetId(selected.id);
                          fileInputRef.current?.click();
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <TemplatePreviewFrame
              slide={slide}
              theme={theme}
              scale={canvasScale}
              frameRef={frameRef}
              onSelectElement={(element) => {
                if (element.type === "text") setSimpleTab("text");
                if (element.type === "image") setSimpleTab("image");
                if (element.type === "text" || element.type === "image") {
                  setMobileSection("edit");
                }
              }}
            />
          )}

        </main>

        <aside className="properties-panel">
          {advancedMode ? (
            <PropertiesPanel
              selected={showObjectCanvas ? selected : null}
              slide={slide}
              onUpdate={updateSelected}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onLayerUp={() => moveLayer("up")}
              onLayerDown={() => moveLayer("down")}
              onSaveText={saveSlideText}
            />
          ) : (
            <SimplePropertiesPanel
              activeTab={simpleTab}
              slide={slide}
              image={primaryImage}
              busy={busy}
              canUpload={canUpload}
              onChangeTab={setSimpleTab}
              onSaveText={saveSlideText}
              onUploadClick={() => {
                setImageReplaceTargetId(primaryImage?.id || "");
                fileInputRef.current?.click();
              }}
            />
          )}
        </aside>
      </section>
      <MobileEditorNav
        section={mobileSection}
        onChange={(section) => {
          setMobileSection(section);
          if (section === "preview") setViewMode("preview");
        }}
      />
    </section>
  );
}

function TemplatePreviewFrame({
  slide,
  theme,
  scale,
  frameRef,
  onSelectElement,
}: {
  slide: Slide;
  theme?: PresentationTheme;
  scale: number;
  frameRef: RefObject<HTMLDivElement | null>;
  onSelectElement: (element: CanvasElement) => void;
}) {
  const canvas =
    slide.canvas || (theme ? buildSlideCanvas(slide, theme) : null);
  if (!canvas) return null;
  return (
    <div className="canvas-scroll">
      <div className="canvas-frame" ref={frameRef}>
        <div
          className="canvas-viewport"
          style={{ width: canvas.width * scale, height: canvas.height * scale }}
        >
          <div
            className="object-canvas object-canvas-preview"
            style={{
              width: canvas.width,
              height: canvas.height,
              background: canvasBackgroundCss(
                canvas.backgroundStyle,
                canvas.background,
              ),
              transform: `scale(${scale})`,
            }}
          >
            {sortCanvasElements(canvas.elements)
              .filter((element) => element.opacity > 0)
              .map((element) => (
                <ReadonlyCanvasElement
                  element={element}
                  key={element.id}
                  onSelect={onSelectElement}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadonlyCanvasElement({
  element,
  onSelect,
}: {
  element: CanvasElement;
  onSelect: (element: CanvasElement) => void;
}) {
  const interactive = element.type === "text" || element.type === "image";
  const interactiveProps = interactive
    ? {
        className: "canvas-element canvas-element-preview-action",
        onClick: () => onSelect(element),
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(element);
          }
        },
        role: "button",
        tabIndex: 0,
      }
    : { className: "canvas-element" };
  if (element.type === "shape") {
    return (
      <div {...interactiveProps} style={elementStyle(element)}>
        <div
          className={`canvas-shape canvas-shape-${element.shape}`}
          style={shapeStyle(element)}
        />
      </div>
    );
  }
  if (element.type === "image") {
    return (
      <div
        {...interactiveProps}
        style={{
          ...elementStyle(element),
          borderRadius: element.id.includes("-editorial-") ? 0 : 18,
          overflow: "hidden",
        }}
      >
        {element.url ? (
          <img
            src={element.url}
            alt={element.alt}
            style={{ objectFit: element.fit }}
          />
        ) : null}
      </div>
    );
  }
  return (
    <div
      {...interactiveProps}
      className={`${interactiveProps.className} canvas-text-element`}
      style={elementStyle(element)}
    >
      <div style={textStyle(element)}>{element.text}</div>
    </div>
  );
}

function markCanvasAsCustom(slideId: string, canvas: SlideCanvas): SlideCanvas {
  const markerId = `${slideId}-${CUSTOM_CANVAS_MARKER_SUFFIX}`;
  if (canvas.elements.some((element) => element.id === markerId)) return canvas;

  const marker: CanvasShapeElement = {
    id: markerId,
    type: "shape",
    shape: "rect",
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    zIndex: -1,
    opacity: 0,
    locked: true,
    fill: "#000000",
    stroke: "#000000",
    strokeWidth: 0,
  };

  return { ...canvas, elements: [...canvas.elements, marker] };
}

type IconName =
  | "cursor"
  | "text"
  | "shape"
  | "image"
  | "undo"
  | "redo"
  | "preview"
  | "export"
  | "copy"
  | "trash"
  | "front"
  | "back"
  | "lock"
  | "unlock"
  | "replace"
  | "alignLeft"
  | "alignCenter"
  | "alignRight"
  | "plus"
  | "settings"
  | "bold"
  | "italic"
  | "underline";

const editorIcons: Record<IconName, LucideIcon> = {
  cursor: MousePointer2,
  text: Type,
  shape: Square,
  image: Image,
  undo: Undo2,
  redo: Redo2,
  preview: Eye,
  export: Upload,
  copy: Copy,
  trash: Trash2,
  front: BringToFront,
  back: SendToBack,
  lock: Lock,
  unlock: Unlock,
  replace: Replace,
  alignLeft: AlignLeft,
  alignCenter: AlignCenter,
  alignRight: AlignRight,
  plus: Plus,
  settings: Settings2,
  bold: Bold,
  italic: Italic,
  underline: Underline,
};

function EditorTopToolbar({
  projectId,
  tool,
  setTool,
  viewMode,
  advancedMode,
  onPreview,
  onOpenAdvanced,
  onCloseAdvanced,
  previewDisabled,
  busy,
  canUpload,
  undoDisabled,
  redoDisabled,
  onUploadClick,
  onUndo,
  onRedo,
}: {
  projectId: string;
  tool: Tool;
  setTool: (tool: Tool) => void;
  viewMode: ViewMode;
  advancedMode: boolean;
  onPreview: () => void;
  onOpenAdvanced: () => void;
  onCloseAdvanced: () => void;
  previewDisabled: boolean;
  busy: boolean;
  canUpload: boolean;
  undoDisabled: boolean;
  redoDisabled: boolean;
  onUploadClick: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="editor-toolbar editor-toolbar-primary">
      <div className="toolbar-group mode-group" aria-label="Режим просмотра">
        <button
          className={viewMode === "preview" ? "tool-active" : ""}
          type="button"
          onClick={onPreview}
          disabled={previewDisabled}
          title="Предпросмотр слайда"
        >
          <Icon name="preview" />
          <span>Просмотр</span>
        </button>
        <button
          className={advancedMode ? "tool-active" : ""}
          type="button"
          onClick={advancedMode ? onCloseAdvanced : onOpenAdvanced}
          title={advancedMode ? "Вернуться к простой правке" : "Точная правка объектов"}
        >
          <Icon name={advancedMode ? "preview" : "settings"} />
          <span>{advancedMode ? "Простой режим" : "Точная правка"}</span>
        </button>
      </div>
      {advancedMode ? (
        <div className="toolbar-group" aria-label="Инструменты">
          <button
            className={
              tool === "select" && viewMode === "edit" ? "tool-active" : ""
            }
            type="button"
            onClick={() => setTool("select")}
            title="Выбрать объект"
          >
            <Icon name="cursor" />
            <span>Выбрать</span>
          </button>
          <button
            className={
              tool === "text" && viewMode === "edit" ? "tool-active" : ""
            }
            type="button"
            onClick={() => setTool("text")}
            title="Добавить текст"
          >
            <Icon name="text" />
            <span>Текст</span>
          </button>
          <button
            className={
              tool === "shape" && viewMode === "edit" ? "tool-active" : ""
            }
            type="button"
            onClick={() => setTool("shape")}
            title="Добавить фигуру"
          >
            <Icon name="shape" />
            <span>Фигура</span>
          </button>
          <button
            type="button"
            onClick={onUploadClick}
            disabled={!canUpload || busy}
            title="Загрузить изображение"
          >
            <Icon name="image" />
            <span>Изображение</span>
          </button>
        </div>
      ) : null}
      <div className="toolbar-spacer" />
      {advancedMode ? <div
        className="toolbar-group toolbar-compact"
        aria-label="История изменений"
      >
        <button
          type="button"
          onClick={onUndo}
          disabled={undoDisabled}
          title="Отменить"
          aria-label="Отменить"
        >
          <Icon name="undo" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={redoDisabled}
          title="Повторить"
          aria-label="Повторить"
        >
          <Icon name="redo" />
        </button>
      </div> : null}
      <Link
        className="toolbar-export"
        href={`/projects/${projectId}/export`}
        title="Экспортировать презентацию"
      >
        <Icon name="export" />
        <span>Экспорт</span>
      </Link>
    </div>
  );
}

function ObjectFloatingMenu({
  element,
  scale,
  canvasWidth,
  canvasHeight,
  canUpload,
  busy,
  onEditText,
  onUpdate,
  onDuplicate,
  onDelete,
  onLayerUp,
  onLayerDown,
  onReplaceImage,
}: {
  element: CanvasElement;
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
  canUpload: boolean;
  busy: boolean;
  onEditText: () => void;
  onUpdate: (patch: ElementPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayerUp: () => void;
  onLayerDown: () => void;
  onReplaceImage: () => void;
}) {
  return (
    <div
      className="object-floating-menu"
      style={floatingMenuStyle(element, scale, canvasWidth, canvasHeight)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="object-menu-title">
        <strong>{elementLabel(element)}</strong>
        {element.locked ? <span>Заблокирован</span> : null}
      </div>

      <div className="object-menu-row">
        {element.type === "text" ? (
          <>
            <button
              type="button"
              onClick={onEditText}
              disabled={element.locked}
              title="Редактировать текст"
            >
              <Icon name="text" />
              <span>Правка</span>
            </button>
            <button
              className={element.bold ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ bold: !element.bold } as Partial<CanvasTextElement>)
              }
              disabled={element.locked}
              title="Полужирный"
            >
              Ж
            </button>
            <button
              className={element.italic ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({
                  italic: !element.italic,
                } as Partial<CanvasTextElement>)
              }
              disabled={element.locked}
              title="Курсив"
            >
              К
            </button>
            <button
              className={element.align === "left" ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ align: "left" } as Partial<CanvasTextElement>)
              }
              disabled={element.locked}
              title="Выровнять по левому краю"
            >
              <Icon name="alignLeft" />
            </button>
            <button
              className={element.align === "center" ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ align: "center" } as Partial<CanvasTextElement>)
              }
              disabled={element.locked}
              title="Выровнять по центру"
            >
              <Icon name="alignCenter" />
            </button>
            <button
              className={element.align === "right" ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ align: "right" } as Partial<CanvasTextElement>)
              }
              disabled={element.locked}
              title="Выровнять по правому краю"
            >
              <Icon name="alignRight" />
            </button>
          </>
        ) : null}

        {element.type === "image" ? (
          <>
            <button
              type="button"
              onClick={onReplaceImage}
              disabled={!canUpload || busy || element.locked}
              title="Заменить изображение"
            >
              <Icon name="replace" />
              <span>Заменить</span>
            </button>
            <button
              className={element.fit === "cover" ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ fit: "cover" } as Partial<CanvasImageElement>)
              }
              disabled={element.locked}
              title="Заполнить рамку"
            >
              Заполнить
            </button>
            <button
              className={element.fit === "contain" ? "tool-active" : ""}
              type="button"
              onClick={() =>
                onUpdate({ fit: "contain" } as Partial<CanvasImageElement>)
              }
              disabled={element.locked}
              title="Вписать изображение"
            >
              Вписать
            </button>
          </>
        ) : null}
      </div>

      <div className="object-menu-row">
        <button type="button" onClick={onDuplicate} title="Дублировать">
          <Icon name="copy" />
        </button>
        <button type="button" onClick={onLayerDown} title="Переместить назад">
          <Icon name="back" />
        </button>
        <button type="button" onClick={onLayerUp} title="Переместить вперёд">
          <Icon name="front" />
        </button>
        <button
          type="button"
          onClick={() => onUpdate({ locked: !element.locked })}
          title={element.locked ? "Разблокировать" : "Заблокировать"}
        >
          <Icon name={element.locked ? "unlock" : "lock"} />
        </button>
        <button
          className="danger-action"
          type="button"
          onClick={onDelete}
          disabled={element.locked}
          title="Удалить"
        >
          <Icon name="trash" />
        </button>
      </div>
    </div>
  );
}

function CanvasElementView({
  element,
  selected,
  editing,
  onPointerDown,
  onResizePointerDown,
  onEditText,
  onStopEditText,
  onTextChange,
}: {
  element: CanvasElement;
  selected: boolean;
  editing: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onEditText: () => void;
  onStopEditText: () => void;
  onTextChange: (text: string) => void;
}) {
  const style = elementStyle(element);

  if (element.type === "shape") {
    return (
      <div
        className={`canvas-element ${selected ? "canvas-element-selected" : ""}`}
        style={style}
        onPointerDown={onPointerDown}
      >
        <div
          className={`canvas-shape canvas-shape-${element.shape}`}
          style={shapeStyle(element)}
        />
        {selected && !element.locked ? (
          <button
            className="resize-handle"
            type="button"
            onPointerDown={onResizePointerDown}
          />
        ) : null}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div
        className={`canvas-element ${selected ? "canvas-element-selected" : ""}`}
        style={{ ...style, borderRadius: element.id.includes("-editorial-") ? 0 : 18, overflow: "hidden" }}
        onPointerDown={onPointerDown}
      >
        {element.url ? (
          <img
            src={element.url}
            alt={element.alt}
            draggable={false}
            style={{ objectFit: element.fit }}
          />
        ) : null}
        {selected && !element.locked ? (
          <button
            className="resize-handle"
            type="button"
            onPointerDown={onResizePointerDown}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`canvas-element canvas-text-element ${selected ? "canvas-element-selected" : ""}`}
      style={style}
      onPointerDown={onPointerDown}
    >
      <div
        contentEditable={selected && editing && !element.locked}
        data-element-editor={element.id}
        suppressContentEditableWarning
        spellCheck={false}
        onDoubleClick={onEditText}
        onPointerDown={(event) => {
          if (editing) event.stopPropagation();
        }}
        onBlur={(event) => {
          onTextChange(event.currentTarget.innerText);
          onStopEditText();
        }}
        style={textStyle(element)}
      >
        {element.text}
      </div>
      {selected && !element.locked ? (
        <button
          className="resize-handle"
          type="button"
          onPointerDown={onResizePointerDown}
        />
      ) : null}
    </div>
  );
}

function PropertiesPanel({
  selected,
  slide,
  onUpdate,
  onDuplicate,
  onDelete,
  onLayerUp,
  onLayerDown,
  onSaveText,
}: {
  selected: CanvasElement | null;
  slide: Slide;
  onUpdate: (patch: ElementPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayerUp: () => void;
  onLayerDown: () => void;
  onSaveText: (patch: { title?: string; thesis?: string; bullets?: string[]; speakerNotes?: string }) => void;
}) {
  return (
    <div className="properties-stack">
      <div className="properties-header">
        <strong>{selected ? elementLabel(selected) : "Слайд"}</strong>
      </div>

      <PropertySection title="Текст слайда">
        <label className="field">
          Заголовок
          <RichTextField
            key={`${slide.id}-title`}
            value={slide.title}
            testId="slide-title-editor"
            multiline={false}
            toolbar={false}
            onSave={(title) => title && onSaveText({ title })}
          />
        </label>
        <label className="field">
          Короткий тезис
          <RichTextField
            key={`${slide.id}-thesis`}
            value={slide.thesis}
            multiline
            toolbar
            onSave={(thesis) => onSaveText({ thesis })}
          />
        </label>
        <div className="field">
          Пункты
          <div className="bullet-editor-list">
            {slide.bullets.map((bullet, index) => (
              <RichTextField
                className="bullet-rich-field"
                key={`${slide.id}-bullet-${index}`}
                value={bullet}
                multiline={false}
                toolbar={false}
                onSave={(value) => {
                  const bullets = [...slide.bullets];
                  if (value) bullets[index] = value;
                  else bullets.splice(index, 1);
                  onSaveText({ bullets });
                }}
              />
            ))}
            {slide.bullets.length < 5 ? (
              <button
                className="property-add-button"
                type="button"
                onClick={() => onSaveText({ bullets: [...slide.bullets, "Новый пункт"] })}
              >
                <Icon name="plus" />
                Добавить
              </button>
            ) : null}
          </div>
        </div>
      </PropertySection>

      {selected ? (
        <>
          <PropertySection
            title="Содержимое"
            description="Здесь можно изменить текст, фигуру или изображение."
          >
            {selected.type === "text" ? (
              <TextContentProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
            {selected.type === "shape" ? (
              <ShapeContentProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
            {selected.type === "image" ? (
              <ImageContentProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
          </PropertySection>

          <PropertySection
            title="Оформление"
            description="Настрой, как выглядит выбранный объект."
          >
            {selected.type === "text" ? (
              <TextStyleProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
            {selected.type === "shape" ? (
              <ShapeStyleProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
            {selected.type === "image" ? (
              <ImageStyleProperties selected={selected} onUpdate={onUpdate} />
            ) : null}
            <label className="field">
              Прозрачность
              <input
                className="input"
                max={1}
                min={0}
                step={0.05}
                type="number"
                value={selected.opacity}
                onChange={(event) =>
                  onUpdate({ opacity: Number(event.target.value) })
                }
              />
            </label>
          </PropertySection>

          <PropertySection
            title="Положение"
            description="Укажи размер и точное место на слайде."
          >
            <div className="property-grid">
              <label className="field">
                X
                <input
                  className="input"
                  type="number"
                  value={Math.round(selected.x)}
                  onChange={(event) =>
                    onUpdate({ x: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                Y
                <input
                  className="input"
                  type="number"
                  value={Math.round(selected.y)}
                  onChange={(event) =>
                    onUpdate({ y: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                Ширина
                <input
                  className="input"
                  type="number"
                  min={32}
                  value={Math.round(selected.w)}
                  onChange={(event) =>
                    onUpdate({ w: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                Высота
                <input
                  className="input"
                  type="number"
                  min={24}
                  value={Math.round(selected.h)}
                  onChange={(event) =>
                    onUpdate({ h: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field">
                Поворот
                <input
                  className="input"
                  type="number"
                  value={Math.round(selected.rotation)}
                  onChange={(event) =>
                    onUpdate({ rotation: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </PropertySection>

          <PropertySection
            title="Слой"
            description="Перемести объект выше или ниже, либо заблокируй его."
          >
            <div className="property-actions">
              <button type="button" onClick={onDuplicate}>
                <Icon name="copy" />
                Дублировать
              </button>
              <button type="button" onClick={onLayerDown}>
                <Icon name="back" />
                Назад
              </button>
              <button type="button" onClick={onLayerUp}>
                <Icon name="front" />
                Вперёд
              </button>
            </div>
            <label className="field property-check">
              <input
                type="checkbox"
                checked={selected.locked}
                onChange={(event) => onUpdate({ locked: event.target.checked })}
              />
              Заблокировать объект
            </label>
            <button
              className="property-danger"
              type="button"
              onClick={onDelete}
              disabled={selected.locked}
            >
              <Icon name="trash" />
              Удалить объект
            </button>
          </PropertySection>
        </>
      ) : null}

      <PropertySection className="property-section-fill">
        <label className="field">
          Текст выступления
          <RichTextField
            className="notes-rich-field"
            key={`${slide.id}-notes`}
            value={slide.speakerNotes}
            testId="slide-notes-editor"
            multiline
            toolbar
            onSave={(speakerNotes) => onSaveText({ speakerNotes })}
          />
        </label>
      </PropertySection>
    </div>
  );
}

function SimplePropertiesPanel({
  activeTab,
  slide,
  image,
  busy,
  canUpload,
  onChangeTab,
  onSaveText,
  onUploadClick,
}: {
  activeTab: SimpleEditorTab;
  slide: Slide;
  image?: CanvasImageElement;
  busy: boolean;
  canUpload: boolean;
  onChangeTab: (tab: SimpleEditorTab) => void;
  onSaveText: (patch: {
    title?: string;
    thesis?: string;
    bullets?: string[];
    speakerNotes?: string;
  }) => void;
  onUploadClick: () => void;
}) {
  return (
    <div className="simple-properties">
      <div className="simple-properties-header">
        <div>
          <strong>Правка слайда</strong>
          <p>Меняй только то, что нужно перед защитой.</p>
        </div>
      </div>
      <div className="simple-tabs" role="tablist" aria-label="Правка слайда">
        <SimpleTab
          active={activeTab === "text"}
          icon={<Type aria-hidden="true" />}
          id="text"
          label="Текст"
          onClick={() => onChangeTab("text")}
        />
        <SimpleTab
          active={activeTab === "image"}
          icon={<Image aria-hidden="true" />}
          id="image"
          label="Картинка"
          onClick={() => onChangeTab("image")}
        />
      </div>

      {activeTab === "text" ? (
        <div className="simple-tab-panel" role="tabpanel">
          <label className="field">
            Заголовок
            <RichTextField
              key={`${slide.id}-simple-title`}
              value={slide.title}
              testId="slide-title-editor"
              multiline={false}
              toolbar={false}
              onSave={(title) => title && onSaveText({ title })}
            />
          </label>
          <label className="field">
            Короткий тезис
            <RichTextField
              key={`${slide.id}-simple-thesis`}
              value={slide.thesis}
              multiline
              toolbar
              onSave={(thesis) => onSaveText({ thesis })}
            />
          </label>
          <div className="field">
            Пункты
            <div className="bullet-editor-list">
              {slide.bullets.map((bullet, index) => (
                <RichTextField
                  className="bullet-rich-field"
                  key={`${slide.id}-simple-bullet-${index}`}
                  value={bullet}
                  multiline={false}
                  toolbar={false}
                  onSave={(value) => {
                    const bullets = [...slide.bullets];
                    if (value) bullets[index] = value;
                    else bullets.splice(index, 1);
                    onSaveText({ bullets });
                  }}
                />
              ))}
              {slide.bullets.length < 5 ? (
                <button
                  className="property-add-button"
                  type="button"
                  onClick={() =>
                    onSaveText({ bullets: [...slide.bullets, "Новый пункт"] })
                  }
                >
                  <Icon name="plus" />
                  Добавить пункт
                </button>
              ) : null}
            </div>
          </div>
          <details className="speaker-notes-details">
            <summary>Текст выступления</summary>
            <RichTextField
              className="notes-rich-field"
              key={`${slide.id}-simple-notes`}
              value={slide.speakerNotes}
              testId="slide-notes-editor"
              multiline
              toolbar
              onSave={(speakerNotes) => onSaveText({ speakerNotes })}
            />
          </details>
        </div>
      ) : null}

      {activeTab === "image" ? (
        <div className="simple-tab-panel" role="tabpanel">
          {image?.url ? (
            <img
              className="simple-image-preview"
              src={image.url}
              alt={image.alt || "Изображение на слайде"}
            />
          ) : (
            <div className="simple-empty-state">
              <Image aria-hidden="true" />
              <strong>На этом слайде нет изображения</strong>
              <p>Текст можно изменить в соседней вкладке.</p>
            </div>
          )}
          <button
            className="button simple-upload-button"
            type="button"
            onClick={onUploadClick}
            disabled={!image || !canUpload || busy}
          >
            <Upload aria-hidden="true" />
            {busy ? "Загружаем…" : "Заменить файлом"}
          </button>
          <p className="simple-helper">PNG, JPG или WebP с устройства.</p>
        </div>
      ) : null}

    </div>
  );
}

function SimpleTab({
  active,
  icon,
  id,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  id: SimpleEditorTab;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-controls={`simple-editor-${id}`}
      aria-selected={active}
      className={active ? "simple-tab simple-tab-active" : "simple-tab"}
      id={`simple-editor-tab-${id}`}
      role="tab"
      type="button"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  const label =
    status === "saving"
      ? "Сохраняем…"
      : status === "saved"
        ? "Сохранено"
        : "Не удалось сохранить";
  return (
    <span className={`save-indicator save-indicator-${status}`} role="status">
      {status === "saved" ? <Check aria-hidden="true" /> : null}
      {label}
    </span>
  );
}

function MobileEditorNav({
  section,
  onChange,
}: {
  section: MobileEditorSection;
  onChange: (section: MobileEditorSection) => void;
}) {
  return (
    <nav className="mobile-editor-nav" aria-label="Навигация редактора">
      <button
        className={section === "slides" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("slides")}
      >
        <LayoutTemplate aria-hidden="true" />
        Слайды
      </button>
      <button
        className={section === "edit" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("edit")}
      >
        <Settings2 aria-hidden="true" />
        Правка
      </button>
      <button
        className={section === "preview" ? "mobile-editor-nav-active" : ""}
        type="button"
        onClick={() => onChange("preview")}
      >
        <Eye aria-hidden="true" />
        Просмотр
      </button>
    </nav>
  );
}

function PropertySection({
  title,
  description,
  className = "",
  children,
}: {
  title?: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`property-section ${className}`.trim()}>
      {title || description ? (
        <div className="property-section-header">
          {title ? <strong>{title}</strong> : null}
          {description ? <p>{description}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

function TextContentProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasTextElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Текст
      <textarea
        className="textarea element-textarea"
        value={selected.text}
        onChange={(event) =>
          onUpdate({
            text: event.target.value,
            runs: [{ text: event.target.value }],
          } as Partial<CanvasTextElement>)
        }
      />
    </label>
  );
}

function TextStyleProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasTextElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <>
      <div className="property-grid">
        <label className="field">
          Размер
          <input
            className="input"
            type="number"
            min={8}
            max={160}
            value={selected.fontSize}
            onChange={(event) =>
              onUpdate({
                fontSize: Number(event.target.value),
              } as Partial<CanvasTextElement>)
            }
          />
        </label>
        <label className="field">
          Цвет
          <input
            className="input color-input"
            type="color"
            value={selected.color}
            onChange={(event) =>
              onUpdate({
                color: event.target.value,
              } as Partial<CanvasTextElement>)
            }
          />
        </label>
      </div>
      <label className="field">
        Шрифт
        <input
          className="input"
          value={selected.fontFamily}
          onChange={(event) =>
            onUpdate({
              fontFamily: event.target.value,
            } as Partial<CanvasTextElement>)
          }
        />
      </label>
      <div className="segmented segmented-five">
        <button
          className={selected.bold ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({ bold: !selected.bold } as Partial<CanvasTextElement>)
          }
          title="Полужирный"
        >
          Ж
        </button>
        <button
          className={selected.italic ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({ italic: !selected.italic } as Partial<CanvasTextElement>)
          }
          title="Курсив"
        >
          К
        </button>
        <button
          className={selected.underline ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({
              underline: !selected.underline,
            } as Partial<CanvasTextElement>)
          }
          title="Подчёркнутый"
        >
          Ч
        </button>
        <button
          className={selected.align === "left" ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({ align: "left" } as Partial<CanvasTextElement>)
          }
          title="Выровнять по левому краю"
        >
          <Icon name="alignLeft" />
        </button>
        <button
          className={selected.align === "center" ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({ align: "center" } as Partial<CanvasTextElement>)
          }
          title="Выровнять по центру"
        >
          <Icon name="alignCenter" />
        </button>
        <button
          className={selected.align === "right" ? "tool-active" : ""}
          type="button"
          onClick={() =>
            onUpdate({ align: "right" } as Partial<CanvasTextElement>)
          }
          title="Выровнять по правому краю"
        >
          <Icon name="alignRight" />
        </button>
      </div>
    </>
  );
}

function ShapeContentProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasShapeElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Фигура
      <select
        className="select"
        value={selected.shape}
        onChange={(event) =>
          onUpdate({
            shape: event.target.value as CanvasShapeElement["shape"],
          } as Partial<CanvasShapeElement>)
        }
      >
        <option value="rect">Прямоугольник</option>
        <option value="roundRect">Скруглённый прямоугольник</option>
        <option value="ellipse">Эллипс</option>
        <option value="line">Линия</option>
      </select>
    </label>
  );
}

function ShapeStyleProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasShapeElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <>
      <div className="property-grid">
        <label className="field">
          Заливка
          <input
            className="input color-input"
            type="color"
            value={selected.fill}
            onChange={(event) =>
              onUpdate({
                fill: event.target.value,
              } as Partial<CanvasShapeElement>)
            }
          />
        </label>
        <label className="field">
          Обводка
          <input
            className="input color-input"
            type="color"
            value={selected.stroke}
            onChange={(event) =>
              onUpdate({
                stroke: event.target.value,
              } as Partial<CanvasShapeElement>)
            }
          />
        </label>
      </div>
      <label className="field">
        Толщина обводки
        <input
          className="input"
          type="number"
          min={0}
          max={24}
          value={selected.strokeWidth}
          onChange={(event) =>
            onUpdate({
              strokeWidth: Number(event.target.value),
            } as Partial<CanvasShapeElement>)
          }
        />
      </label>
    </>
  );
}

function ImageContentProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasImageElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Описание изображения
      <input
        className="input"
        value={selected.alt}
        onChange={(event) =>
          onUpdate({ alt: event.target.value } as Partial<CanvasImageElement>)
        }
      />
    </label>
  );
}

function ImageStyleProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasImageElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Размещение
      <select
        className="select"
        value={selected.fit}
        onChange={(event) =>
          onUpdate({
            fit: event.target.value as CanvasImageElement["fit"],
          } as Partial<CanvasImageElement>)
        }
      >
        <option value="cover">Заполнить рамку</option>
        <option value="contain">Вписать целиком</option>
      </select>
    </label>
  );
}

function Icon({ name }: { name: IconName }) {
  const Component = editorIcons[name];
  return <Component className="tool-icon" aria-hidden="true" focusable="false" />;
}

function floatingMenuStyle(
  element: CanvasElement,
  scale: number,
  canvasWidth: number,
  canvasHeight: number,
): CSSProperties {
  const menuWidth = element.type === "text" ? 360 : 300;
  const menuHeight = element.type === "text" ? 92 : 84;
  const viewportWidth = canvasWidth * scale;
  const viewportHeight = canvasHeight * scale;
  const centerX = (element.x + element.w / 2) * scale;
  const above = element.y * scale - menuHeight - 10;
  const below = (element.y + element.h) * scale + 10;

  return {
    left: `${clamp(centerX - menuWidth / 2, 8, Math.max(8, viewportWidth - menuWidth - 8))}px`,
    top: `${above >= 8 ? above : clamp(below, 8, Math.max(8, viewportHeight - menuHeight - 8))}px`,
    width: `${menuWidth}px`,
  };
}

function elementLabel(element: CanvasElement) {
  if (element.type === "text") return "Текст";
  if (element.type === "image") return "Изображение";
  return "Фигура";
}

function projectStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "Черновик",
    uploading: "Загрузка файлов",
    script_queued: "Текст в очереди",
    script_generating: "Готовим текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Собираем презентацию",
    ready: "Готово",
    failed: "Нужно повторить",
  };
  return labels[status] || "Обновляем статус";
}

function editorError(error: unknown, fallback: string) {
  if (
    error instanceof Error &&
    /[А-Яа-яЁё]/.test(error.message) &&
    !/<[^>]+>|\b(?:error|failed|invalid|internal)\b/i.test(error.message)
  ) {
    return error.message;
  }
  return fallback;
}

function elementStyle(element: CanvasElement): CSSProperties {
  return {
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.w}px`,
    height: `${element.h}px`,
    transform: `rotate(${element.rotation}deg)`,
    zIndex: element.zIndex,
    opacity: element.opacity,
  };
}

function fittedTextSize(
  element: CanvasTextElement,
  width: number,
  height: number,
): number | null {
  const maximum = Math.max(
    MIN_READABLE_TEXT_SIZE,
    Math.floor(element.fontSize),
  );
  if (textFitsBox(element, width, height, maximum)) return maximum;
  if (!textFitsBox(element, width, height, MIN_READABLE_TEXT_SIZE)) return null;

  let low = MIN_READABLE_TEXT_SIZE;
  let high = maximum;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textFitsBox(element, width, height, middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function textFitsBox(
  element: CanvasTextElement,
  width: number,
  height: number,
  fontSize: number,
) {
  if (!element.text.trim()) return true;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return true;
  context.font = `${element.italic ? "italic " : ""}${element.bold ? 800 : 400} ${fontSize}px ${element.fontFamily}, Arial, sans-serif`;

  let lines = 0;
  for (const paragraph of element.text.split("\n")) {
    if (!paragraph) {
      lines += 1;
      continue;
    }
    let currentWidth = 0;
    for (const token of paragraph.match(/\S+\s*/g) || [paragraph]) {
      const tokenWidth = context.measureText(token).width;
      if (tokenWidth <= width) {
        if (currentWidth > 0 && currentWidth + tokenWidth > width) {
          lines += 1;
          currentWidth = tokenWidth;
        } else {
          currentWidth += tokenWidth;
        }
        continue;
      }
      for (const character of token) {
        const characterWidth = context.measureText(character).width;
        if (characterWidth > width) return false;
        if (currentWidth > 0 && currentWidth + characterWidth > width) {
          lines += 1;
          currentWidth = characterWidth;
        } else {
          currentWidth += characterWidth;
        }
      }
    }
    lines += 1;
  }
  return lines * fontSize * 1.14 <= height + 0.5;
}

function textStyle(element: CanvasTextElement): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    color: element.color,
    fontFamily: `${element.fontFamily}, Arial, sans-serif`,
    fontSize: `${element.fontSize}px`,
    fontWeight: element.bold ? 800 : 400,
    fontStyle: element.italic ? "italic" : "normal",
    textDecoration: element.underline ? "underline" : "none",
    textAlign: element.align,
    display: "flex",
    flexDirection: "column",
    justifyContent:
      element.valign === "middle"
        ? "center"
        : element.valign === "bottom"
          ? "flex-end"
          : "flex-start",
    lineHeight: 1.14,
    outline: "none",
    overflow: "hidden",
    overflowWrap: "anywhere",
    whiteSpace: "pre-wrap",
  };
}

function shapeStyle(element: CanvasShapeElement): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    background: element.shape === "line" ? "transparent" : element.fill,
    border:
      element.shape === "line"
        ? "0"
        : `${element.strokeWidth}px solid ${element.stroke}`,
    borderRadius:
      element.shape === "roundRect"
        ? 18
        : element.shape === "ellipse"
          ? "50%"
          : 0,
    borderTop:
      element.shape === "line"
        ? `${Math.max(1, element.strokeWidth)}px solid ${element.stroke}`
        : undefined,
  };
}

function eventPoint(
  event: PointerEvent<HTMLElement>,
  stageElement: HTMLElement | null,
  scale: number,
) {
  const stage = stageElement || findStage(event.currentTarget);
  const rect = stage.getBoundingClientRect();
  const safeScale = scale > 0 ? scale : 1;
  return {
    x: (event.clientX - rect.left) / safeScale,
    y: (event.clientY - rect.top) / safeScale,
  };
}

function findStage(target: HTMLElement) {
  return (target.closest(".object-canvas") as HTMLElement | null) || target;
}

function nextZIndex(canvas: SlideCanvas) {
  return Math.max(1, ...canvas.elements.map((element) => element.zIndex)) + 1;
}

function titleFromCanvas(slide: Slide, canvas: SlideCanvas) {
  const title = canvas.elements.find(
    (element): element is CanvasTextElement =>
      element.type === "text" && element.role === "title",
  );
  return title?.text.trim() || slide.title;
}

function blocksFromSlideText(slide: Slide): Slide["blocks"] {
  const bullets = slide.bullets.map((item) => item.trim()).filter(Boolean);
  if (bullets.length) return [{ type: "bullets", items: bullets }];
  const thesis = slide.thesis.trim();
  if (thesis) return [{ type: "callout", content: thesis }];
  return slide.blocks;
}

function cloneCanvas(canvas: SlideCanvas): SlideCanvas {
  return JSON.parse(JSON.stringify(canvas)) as SlideCanvas;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isTypingTarget(target: EventTarget) {
  const element = target as HTMLElement | null;
  return Boolean(
    element?.closest("input, textarea, select, [contenteditable='true']"),
  );
}

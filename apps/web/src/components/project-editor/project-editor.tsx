"use client";

import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { CanvasElement, CanvasImageElement, CanvasShapeElement, CanvasTextElement, Slide, SlideCanvas, SlideLayout, SlideVisual } from "@studydeck/shared";
import { buildSlideCanvas, canvasBackgroundCss, ensureEditableCanvas, sortCanvasElements } from "@studydeck/shared";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";
import { PropertiesPanel } from "./advanced-properties-panel";
import { CanvasElementView, TemplatePreviewFrame } from "./editor-canvas";
import { editorError, projectStatusLabel } from "./editor-errors";
import { CANVAS_HEIGHT, CANVAS_WIDTH, clamp, cloneCanvas, eventPoint, fittedTextSize, isTypingTarget, markCanvasAsCustom, nextZIndex, blocksFromSlideText, titleFromCanvas } from "./editor-geometry";
import { EditorTopToolbar } from "./editor-top-toolbar";
import { MobileEditorNav, SaveIndicator } from "./editor-status";
import type { DragState, ElementPatch, ProjectPayload, SimpleEditorTab, Tool, ViewMode, MobileEditorSection, SaveStatus } from "./editor-types";
import { ObjectFloatingMenu } from "./object-floating-menu";
import { SimplePropertiesPanel } from "./simple-properties-panel";
import { DefenseCompliancePanel } from "@/components/defense/defense-compliance-panel";

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
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [conflictText, setConflictText] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const revisionRef = useRef(initialProject.presentationRevision || 0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);

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
  const canEdit = (project.accessRole || "owner") !== "viewer";

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
    if (!response.ok) throw new Error(await response.text());
    const next = sanitizeProjectForDisplay(await response.json()) as ProjectPayload;
    revisionRef.current = next.presentationRevision || 0;
    conflictRef.current = false;
    setRevisionConflict(false);
    setProject(next);
  }

  function saveSlide(next: {
    title?: string;
    thesis?: string;
    bullets?: string[];
    layout?: SlideLayout;
    visual?: SlideVisual;
    blocks?: Slide["blocks"];
    canvas?: SlideCanvas;
    speakerNotes?: string;
  }) {
    if (!slide || !canEdit || conflictRef.current) return Promise.resolve();
    const slideId = slide.id;
    const run = async () => {
      if (conflictRef.current) return;
      setSaveStatus("saving");
      const response = await fetch(`/api/projects/${project.id}/slides/${slideId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...next, expectedRevision: revisionRef.current }),
      });
      const payload = await response.json().catch(() => null) as ProjectPayload | { message?: string } | null;
      if (response.status === 409) {
        conflictRef.current = true;
        setRevisionConflict(true);
        setSaveStatus("error");
        return;
      }
      if (!response.ok) {
        setSaveStatus("error");
        setActionError(editorError(new Error(payload && "message" in payload && payload.message || ""), "Не получилось сохранить изменения. Попробуй ещё раз."));
        return;
      }
      if (payload && "presentationRevision" in payload && typeof payload.presentationRevision === "number") {
        revisionRef.current = payload.presentationRevision;
        setProject((current) => ({ ...current, presentationRevision: payload.presentationRevision }));
      } else {
        revisionRef.current += 1;
      }
      setSaveStatus("saved");
    };
    saveQueueRef.current = saveQueueRef.current.then(run, run);
    return saveQueueRef.current;
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
    setConflictText([patch.title, patch.thesis, ...(patch.bullets || []), patch.speakerNotes].filter(Boolean).join("\n\n"));
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
        presentationRevision: number;
      };
      revisionRef.current = payload.presentationRevision;
      setProject((current) => ({ ...current, presentationRevision: payload.presentationRevision }));
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
        {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
        {canStartGeneration && canEdit ? (
          <div className="actions">
            <Link className="button" href={`/projects/${project.id}/script`}>Проверить текст и запуск</Link>
          </div>
        ) : null}
      </section>
    );
  }

  if (!canEdit) {
    return (
      <section className="editor-workspace viewer-workspace" data-testid="project-editor">
        <div className="editor-top"><div><span className="status">Только просмотр</span><h1>{presentation.title}</h1></div><Link className="button" href={`/projects/${project.id}/export`}>Экспорт</Link></div>
        {project.workflow === "requirements_driven" ? <DefenseCompliancePanel projectId={project.id} presentationRevision={project.presentationRevision || 0} slides={presentation.slides} canEdit={false} onSelectSlide={setActive} /> : null}
        <section className="viewer-editor">
          <aside className="slide-rail"><strong>Слайды</strong><div className="slide-rail-list">{presentation.slides.map((item, index) => <button className={`slide-thumb ${index === active ? "slide-thumb-active" : ""}`} key={item.id} type="button" onClick={() => setActive(index)}><span>{String(index + 1).padStart(2, "0")}</span><strong>{item.title}</strong></button>)}</div></aside>
          <main className="canvas-shell viewer-canvas-shell"><div className="viewer-toolbar"><span>Редактирование доступно владельцу и редакторам</span><Link href={`/projects/${project.id}/export`}>PDF и PPTX</Link></div><TemplatePreviewFrame slide={slide} theme={theme} scale={canvasScale} frameRef={frameRef} onSelectElement={() => undefined} /></main>
        </section>
      </section>
    );
  }

  return (
    <section className="editor-workspace" data-testid="project-editor">
      <div className="editor-top">
        <div>
          <h1>{presentation.title}</h1>
        </div>
        <SaveIndicator status={saveStatus} />
      </div>

      {project.workflow === "requirements_driven" ? <DefenseCompliancePanel projectId={project.id} presentationRevision={project.presentationRevision || 0} slides={presentation.slides} canEdit={canEdit} onSelectSlide={(index) => { setActive(index); setMobileSection("preview"); }} /> : null}

      {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
      <Dialog open={revisionConflict} onOpenChange={(open) => { if (!open) setRevisionConflict(false); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Презентация изменилась</DialogTitle><DialogDescription>Слайд изменился в другой вкладке или другим участником. Мы не перезаписали свежую версию.</DialogDescription></DialogHeader>
          <div className="conflict-actions"><button className="ghost" type="button" onClick={() => void navigator.clipboard.writeText(conflictText)} disabled={!conflictText}>Скопировать мой текст</button><button className="button" type="button" onClick={() => void refresh()}>Загрузить свежую версию</button></div>
        </DialogContent>
      </Dialog>

      <section
        className="power-editor"
        data-mobile-section={mobileSection}
        onKeyDown={onKeyDown}
      >
        <aside className="slide-rail">
          <strong>Слайды</strong>
          <div className="slide-rail-list">
            {presentation.slides.map((item, index) => (
              <button
                className={`slide-thumb ${index === active ? "slide-thumb-active" : ""}`}
                key={item.id}
                type="button"
                  aria-current={index === active ? "page" : undefined}
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

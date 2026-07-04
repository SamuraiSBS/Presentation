"use client";

import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  hasMeasurableValue,
  slideLayoutOptions,
  sortCanvasElements,
} from "@studydeck/shared";
import { sanitizeProjectForDisplay } from "@/lib/presentation-display";
import { presentationTextForSlide } from "./slide-template-renderer";

type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  presentation?: { document: PresentationDocument } | null;
};

type Tool = "select" | "text" | "shape";
type ViewMode = "preview" | "edit";
type ElementPatch = Partial<CanvasElement> & Record<string, unknown>;
type DragState =
  | { mode: "move"; id: string; startX: number; startY: number; original: CanvasElement; originals: CanvasElement[] }
  | { mode: "resize"; id: string; startX: number; startY: number; original: CanvasElement; originals: CanvasElement[] };

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const CUSTOM_CANVAS_MARKER_SUFFIX = "custom-canvas-marker";

export function ProjectEditor({ initialProject }: { initialProject: ProjectPayload }) {
  const [project, setProject] = useState(() => sanitizeProjectForDisplay(initialProject));
  const [active, setActive] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [tool, setTool] = useState<Tool>("select");
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
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

  const presentation = project.presentation?.document ? ensureEditableCanvas(project.presentation.document) : null;
  const theme = presentation?.presentationTheme;
  const slide = presentation?.slides[active];
  const canvas = slide?.canvas || (slide && theme ? buildSlideCanvas(slide, theme) : null);
  const selected = canvas?.elements.find((element) => element.id === selectedId) || null;
  const canvasWidth = canvas?.width ?? CANVAS_WIDTH;
  const canvasHeight = canvas?.height ?? CANVAS_HEIGHT;
  const showObjectCanvas = viewMode === "edit";
  const activeSlideText = presentation && slide ? presentationTextForSlide(presentation, slide, active) : "";
  const canUpload = project.id !== "demo" || process.env.NEXT_PUBLIC_DEMO_PREVIEW === "false";

  useEffect(() => {
    setSelectedId("");
    setUndoStack([]);
    setRedoStack([]);
    setTool("select");
    setViewMode("preview");
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
    const editor = stageRef.current?.querySelector<HTMLElement>(`[data-element-editor="${editingTextId}"]`);
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
      setCanvasScale((current) => (Math.abs(current - nextScale) < 0.001 ? current : nextScale));
    };

    const readFrameContentBox = () => {
      const styles = window.getComputedStyle(frame);
      const horizontalPadding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const verticalPadding = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
      updateScale(frame.clientWidth - horizontalPadding, frame.clientHeight - verticalPadding);
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
      const response = await fetch(`/api/projects/${project.id}/generate`, { method: "POST" });
      if (!response.ok) throw new Error(await response.text());
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось запустить генерацию");
    } finally {
      setBusy(false);
    }
  }

  async function saveSlide(next: { title?: string; layout?: SlideLayout; visual?: SlideVisual; canvas?: SlideCanvas; speakerNotes?: string }) {
    if (!slide) return;
    const response = await fetch(`/api/projects/${project.id}/slides/${slide.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!response.ok) {
      setActionError(await response.text());
    }
  }

  function setLocalCanvas(next: SlideCanvas) {
    setProject((current) => {
      const document = current.presentation?.document;
      if (!document) return current;
      const slides = document.slides.map((item, index) => (index === active ? { ...item, canvas: next } : item));
      return {
        ...current,
        presentation: {
          ...current.presentation,
          document: ensureEditableCanvas({ ...document, slides }),
        },
      };
    });
  }

  function commitCanvas(next: SlideCanvas, options: { history?: boolean; persist?: boolean } = { history: true, persist: true }) {
    if (!canvas || !slide) return;
    const nextCanvas = options.persist ? markCanvasAsCustom(slide.id, next) : next;
    const normalized = { ...nextCanvas, elements: sortCanvasElements(nextCanvas.elements) };
    if (options.history) {
      setUndoStack((stack) => [...stack.slice(-29), cloneCanvas(canvas)]);
      setRedoStack([]);
    }
    setLocalCanvas(normalized);
    if (options.persist) {
      void saveSlide({ title: titleFromCanvas(slide, normalized), canvas: normalized });
    }
  }

  function applySlideLayout(layout: SlideLayout) {
    if (!slide || !theme || layout === slide.layout) return;
    const nextVisual = layoutKeepsVisualImage(layout) ? slide.visual : visualWithoutImage(slide.visual);
    const nextSlide = { ...slide, layout, visual: nextVisual, canvas: undefined };
    const nextCanvas = buildSlideCanvas(nextSlide, theme);
    setProject((current) => {
      const document = current.presentation?.document;
      if (!document) return current;
      const slides = document.slides.map((item, index) => (index === active ? { ...nextSlide, canvas: nextCanvas } : item));
      return {
        ...current,
        presentation: {
          ...current.presentation,
          document: { ...document, slides },
        },
      };
    });
    setSelectedId("");
    setUndoStack([]);
    setRedoStack([]);
    void saveSlide({ layout, title: slide.title, visual: nextVisual, canvas: nextCanvas });
  }

  function updateSelected(patch: ElementPatch) {
    if (!canvas || !selected) return;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) => (element.id === selected.id ? ({ ...element, ...patch } as CanvasElement) : element)),
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
      elements: canvas.elements.filter((element) => selected.groupId ? element.groupId !== selected.groupId : element.id !== selected.id),
    });
    setSelectedId("");
    setEditingTextId("");
  }

  function duplicateSelected() {
    if (!canvas || !selected) return;
    const source = selected.groupId ? canvas.elements.filter((element) => element.groupId === selected.groupId) : [selected];
    const nextGroupId = selected.groupId ? `group:${crypto.randomUUID()}` : undefined;
    const baseZ = nextZIndex(canvas);
    const copies = source.map((element, index) => ({
      ...element,
      id: `${element.type}-${crypto.randomUUID()}`,
      groupId: nextGroupId,
      x: clamp(element.x + 32, 0, canvasWidth - element.w),
      y: clamp(element.y + 32, 0, canvasHeight - element.h),
      zIndex: baseZ + index,
    } as CanvasElement));
    commitCanvas({ ...canvas, elements: [...canvas.elements, ...copies] });
    setSelectedId(copies.find((element) => element.type === selected.type)?.id || copies[0].id);
  }

  function moveLayer(direction: "up" | "down") {
    if (!canvas || !selected) return;
    const delta = direction === "up" ? 1 : -1;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) =>
        selected.groupId ? element.groupId === selected.groupId ? { ...element, zIndex: Math.max(1, element.zIndex + delta) } : element
          : element.id === selected.id ? { ...element, zIndex: Math.max(1, element.zIndex + delta) } : element,
      ),
    });
  }

  function undo() {
    const previous = undoStack.at(-1);
    if (!previous || !canvas || !slide) return;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, cloneCanvas(canvas)]);
    setLocalCanvas(previous);
    void saveSlide({ title: titleFromCanvas(slide, previous), canvas: previous });
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

  function startMove(event: PointerEvent<HTMLDivElement>, element: CanvasElement) {
    event.stopPropagation();
    setSelectedId(element.id);
    if (element.locked) return;
    if (editingTextId !== element.id) {
      setEditingTextId("");
    }
    const point = eventPoint(event, stageRef.current, canvasScale);
    const originals = element.groupId ? canvas!.elements.filter((item) => item.groupId === element.groupId) : [element];
    dragRef.current = { mode: "move", id: element.id, startX: point.x, startY: point.y, original: element, originals };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function startResize(event: PointerEvent<HTMLButtonElement>, element: CanvasElement) {
    if (element.locked) return;
    event.stopPropagation();
    const point = eventPoint(event, stageRef.current, canvasScale);
    const originals = element.groupId ? canvas!.elements.filter((item) => item.groupId === element.groupId) : [element];
    dragRef.current = { mode: "resize", id: element.id, startX: point.x, startY: point.y, original: element, originals };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!canvas || !dragRef.current) return;
    const drag = dragRef.current;
    const point = eventPoint(event, stageRef.current, canvasScale);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    const originalById = new Map(drag.originals.map((element) => [element.id, element]));
    const elements = canvas.elements.map((element) => {
      const original = originalById.get(element.id);
      if (!original) return element;
      if (drag.mode === "move") {
        return {
          ...element,
          x: clamp(original.x + dx, 0, canvasWidth - element.w),
          y: clamp(original.y + dy, 0, canvasHeight - element.h),
        } as CanvasElement;
      }
      const scaleX = clamp((drag.original.w + dx) / drag.original.w, 0.2, 5);
      const scaleY = clamp((drag.original.h + dy) / drag.original.h, 0.2, 5);
      return {
        ...element,
        x: drag.original.x + (original.x - drag.original.x) * scaleX,
        y: drag.original.y + (original.y - drag.original.y) * scaleY,
        w: clamp(original.w * scaleX, 24, canvasWidth),
        h: clamp(original.h * scaleY, 20, canvasHeight),
        ...(element.type === "text" ? { fontSize: clamp(Math.round(element.fontSize * Math.min(scaleX, scaleY)), 8, 160) } : {}),
      } as CanvasElement;
    });
    setLocalCanvas({ ...canvas, elements });
  }

  function onPointerUp() {
    if (!canvas || !dragRef.current) return;
    dragRef.current = null;
    commitCanvas(canvas, { history: true, persist: true });
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!showObjectCanvas || !selected || !canvas || isTypingTarget(event.target)) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteSelected();
      return;
    }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    commitCanvas({
      ...canvas,
      elements: canvas.elements.map((element) => {
        const included = selected.groupId ? element.groupId === selected.groupId : element.id === selected.id;
        return included ? {
          ...element,
          x: clamp(element.x + dx, 0, canvasWidth - element.w),
          y: clamp(element.y + dy, 0, canvasHeight - element.h),
        } : element;
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
      const response = await fetch(`/api/projects/${project.id}/slides/${slide.id}/assets`, { method: "POST", body });
      if (!response.ok) throw new Error(await response.text());
      const payload = (await response.json()) as { element: CanvasImageElement };
      const imageToReplace = replaceElementId
        ? canvas?.elements.find((element): element is CanvasImageElement => element.id === replaceElementId && element.type === "image")
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
              ? canvas.elements.map((element) => (element.id === imageToReplace.id ? nextElement : element))
              : [...canvas.elements.filter((element) => element.id !== payload.element.id), nextElement],
          }
        : { width: CANVAS_WIDTH, height: CANVAS_HEIGHT, background: theme?.colors.background || "#F7F8FA", elements: [nextElement] };
      setLocalCanvas(next);
      setSelectedId(nextElement.id);
      void saveSlide({ title: titleFromCanvas(slide, next), canvas: next });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось загрузить изображение");
    } finally {
      setBusy(false);
      setImageReplaceTargetId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!presentation || !slide || !canvas) {
    const canStartGeneration = project.status === "draft" || project.status === "failed";

    return (
      <section className="panel">
        <span className="status">{projectStatusLabel(project.status)}</span>
        <h1 className="page-title" style={{ fontSize: 44 }}>{project.title}</h1>
        <p className="lead">
          {canStartGeneration
            ? "Презентация еще не отправлена в генерацию. Запустите ее вручную."
            : "Генерация еще идет. Обновите страницу через несколько секунд."}
        </p>
        {project.error ? <p className="muted">{project.error}</p> : null}
        {actionError ? <p className="form-error">{actionError}</p> : null}
        <div className="actions">
          {canStartGeneration ? (
            <button className="button" type="button" onClick={generate} disabled={busy}>
              {busy ? "Запускаем..." : "Запустить генерацию"}
            </button>
          ) : null}
          <button className="ghost" type="button" onClick={refresh}>Обновить</button>
        </div>
      </section>
    );
  }

  return (
    <section className="editor-workspace">
      <div className="editor-top">
        <div>
          <span className="status">{projectStatusLabel(project.status)}</span>
          <h1>{presentation.title}</h1>
        </div>
        <div className="actions">
          <button className="ghost" type="button" onClick={refresh}>Обновить</button>
        </div>
      </div>

      {actionError ? <p className="form-error">{actionError}</p> : null}

      <section className="power-editor" onKeyDown={onKeyDown} tabIndex={0}>
        <aside className="slide-rail">
          <strong>Слайды</strong>
          <div className="slide-rail-list">
            {presentation.slides.map((item, index) => (
              <button
                className={`slide-thumb ${index === active ? "slide-thumb-active" : ""}`}
                key={item.id}
                type="button"
                onClick={() => setActive(index)}
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
            onPreview={() => setViewMode("preview")}
            onEdit={() => setViewMode("edit")}
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
            onChange={(event) => void uploadImage(event.target.files?.[0] || null, imageReplaceTargetId)}
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
                        background: canvasBackgroundCss(canvas.backgroundStyle, canvas.background),
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
                          onResizePointerDown={(event) => startResize(event, element)}
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
                              elements: canvas.elements.map((item) => (item.id === element.id ? next : item)),
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
            <TemplatePreviewFrame slide={slide} theme={theme} scale={canvasScale} frameRef={frameRef} />
          )}

          {!showObjectCanvas && activeSlideText ? (
            <aside className="slide-text-panel">
              <strong>Текст презентации</strong>
              <textarea className="textarea notes" value={activeSlideText} readOnly aria-label="Текст презентации" />
            </aside>
          ) : null}
        </main>

        <aside className="properties-panel">
          <PropertiesPanel
            selected={showObjectCanvas ? selected : null}
            slide={slide}
            onUpdate={updateSelected}
            onDuplicate={duplicateSelected}
            onDelete={deleteSelected}
            onLayerUp={() => moveLayer("up")}
            onLayerDown={() => moveLayer("down")}
            onChangeLayout={applySlideLayout}
            onSaveNotes={(speakerNotes) => void saveSlide({ speakerNotes })}
          />
        </aside>
      </section>
    </section>
  );
}

function TemplatePreviewFrame({ slide, theme, scale, frameRef }: { slide: Slide; theme?: PresentationTheme; scale: number; frameRef: RefObject<HTMLDivElement | null> }) {
  const canvas = slide.canvas || (theme ? buildSlideCanvas(slide, theme) : null);
  if (!canvas) return null;
  return (
    <div className="canvas-scroll">
      <div className="canvas-frame" ref={frameRef}>
        <div className="canvas-viewport" style={{ width: canvas.width * scale, height: canvas.height * scale }}>
          <div
            className="object-canvas object-canvas-preview"
            style={{
              width: canvas.width,
              height: canvas.height,
              background: canvasBackgroundCss(canvas.backgroundStyle, canvas.background),
              transform: `scale(${scale})`,
            }}
          >
            {sortCanvasElements(canvas.elements).filter((element) => element.opacity > 0).map((element) => (
              <ReadonlyCanvasElement element={element} key={element.id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReadonlyCanvasElement({ element }: { element: CanvasElement }) {
  if (element.type === "shape") {
    return <div className="canvas-element" style={elementStyle(element)}><div className={`canvas-shape canvas-shape-${element.shape}`} style={shapeStyle(element)} /></div>;
  }
  if (element.type === "image") {
    return <div className="canvas-element" style={{ ...elementStyle(element), borderRadius: 18, overflow: "hidden" }}>{element.url ? <img src={element.url} alt={element.alt} style={{ objectFit: element.fit }} /> : null}</div>;
  }
  return <div className="canvas-element canvas-text-element" style={elementStyle(element)}><div style={textStyle(element)}>{element.text}</div></div>;
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
  | "alignRight";

function EditorTopToolbar({
  projectId,
  tool,
  setTool,
  viewMode,
  onPreview,
  onEdit,
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
  onPreview: () => void;
  onEdit: () => void;
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
        <button className={viewMode === "preview" ? "tool-active" : ""} type="button" onClick={onPreview} disabled={previewDisabled} title="Предпросмотр слайда">
          <Icon name="preview" />
          <span>Просмотр</span>
        </button>
        <button className={viewMode === "edit" ? "tool-active" : ""} type="button" onClick={onEdit} title="Редактировать объекты">
          <Icon name="cursor" />
          <span>Правка</span>
        </button>
      </div>
      <div className="toolbar-group" aria-label="Инструменты">
        <button className={tool === "select" && viewMode === "edit" ? "tool-active" : ""} type="button" onClick={() => setTool("select")} title="Выбрать объект">
          <Icon name="cursor" />
          <span>Выбрать</span>
        </button>
        <button className={tool === "text" && viewMode === "edit" ? "tool-active" : ""} type="button" onClick={() => setTool("text")} title="Добавить текст">
          <Icon name="text" />
          <span>Текст</span>
        </button>
        <button className={tool === "shape" && viewMode === "edit" ? "tool-active" : ""} type="button" onClick={() => setTool("shape")} title="Добавить фигуру">
          <Icon name="shape" />
          <span>Фигура</span>
        </button>
        <button type="button" onClick={onUploadClick} disabled={!canUpload || busy} title="Загрузить изображение">
          <Icon name="image" />
          <span>Изображение</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group toolbar-compact" aria-label="История изменений">
        <button type="button" onClick={onUndo} disabled={undoDisabled} title="Отменить" aria-label="Отменить">
          <Icon name="undo" />
        </button>
        <button type="button" onClick={onRedo} disabled={redoDisabled} title="Повторить" aria-label="Повторить">
          <Icon name="redo" />
        </button>
      </div>
      <Link className="toolbar-export" href={`/projects/${projectId}/export`} title="Экспортировать презентацию">
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
            <button type="button" onClick={onEditText} disabled={element.locked} title="Редактировать текст">
              <Icon name="text" />
              <span>Правка</span>
            </button>
            <button className={element.bold ? "tool-active" : ""} type="button" onClick={() => onUpdate({ bold: !element.bold } as Partial<CanvasTextElement>)} disabled={element.locked} title="Полужирный">
              Ж
            </button>
            <button className={element.italic ? "tool-active" : ""} type="button" onClick={() => onUpdate({ italic: !element.italic } as Partial<CanvasTextElement>)} disabled={element.locked} title="Курсив">
              К
            </button>
            <button className={element.align === "left" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "left" } as Partial<CanvasTextElement>)} disabled={element.locked} title="Выровнять по левому краю">
              <Icon name="alignLeft" />
            </button>
            <button className={element.align === "center" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "center" } as Partial<CanvasTextElement>)} disabled={element.locked} title="Выровнять по центру">
              <Icon name="alignCenter" />
            </button>
            <button className={element.align === "right" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "right" } as Partial<CanvasTextElement>)} disabled={element.locked} title="Выровнять по правому краю">
              <Icon name="alignRight" />
            </button>
          </>
        ) : null}

        {element.type === "image" ? (
          <>
            <button type="button" onClick={onReplaceImage} disabled={!canUpload || busy || element.locked} title="Заменить изображение">
              <Icon name="replace" />
              <span>Заменить</span>
            </button>
            <button className={element.fit === "cover" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ fit: "cover" } as Partial<CanvasImageElement>)} disabled={element.locked} title="Заполнить рамку">
              Заполнить
            </button>
            <button className={element.fit === "contain" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ fit: "contain" } as Partial<CanvasImageElement>)} disabled={element.locked} title="Вписать изображение">
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
        <button type="button" onClick={() => onUpdate({ locked: !element.locked })} title={element.locked ? "Разблокировать" : "Заблокировать"}>
          <Icon name={element.locked ? "unlock" : "lock"} />
        </button>
        <button className="danger-action" type="button" onClick={onDelete} disabled={element.locked} title="Удалить">
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
      <div className={`canvas-element ${selected ? "canvas-element-selected" : ""}`} style={style} onPointerDown={onPointerDown}>
        <div className={`canvas-shape canvas-shape-${element.shape}`} style={shapeStyle(element)} />
        {selected && !element.locked ? <button className="resize-handle" type="button" onPointerDown={onResizePointerDown} /> : null}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div className={`canvas-element ${selected ? "canvas-element-selected" : ""}`} style={{ ...style, borderRadius: 18, overflow: "hidden" }} onPointerDown={onPointerDown}>
        {element.url ? <img src={element.url} alt={element.alt} draggable={false} style={{ objectFit: element.fit }} /> : null}
        {selected && !element.locked ? <button className="resize-handle" type="button" onPointerDown={onResizePointerDown} /> : null}
      </div>
    );
  }

  return (
    <div className={`canvas-element canvas-text-element ${selected ? "canvas-element-selected" : ""}`} style={style} onPointerDown={onPointerDown}>
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
      {selected && !element.locked ? <button className="resize-handle" type="button" onPointerDown={onResizePointerDown} /> : null}
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
  onChangeLayout,
  onSaveNotes,
}: {
  selected: CanvasElement | null;
  slide: Slide;
  onUpdate: (patch: ElementPatch) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onLayerUp: () => void;
  onLayerDown: () => void;
  onChangeLayout: (layout: SlideLayout) => void;
  onSaveNotes: (speakerNotes: string) => void;
}) {
  return (
    <div className="properties-stack">
      <div className="properties-header">
        <span>Свойства</span>
        <strong>{selected ? elementLabel(selected) : "Слайд"}</strong>
      </div>

      <PropertySection title="Шаблон слайда" description="Композиция пересобирается из текущего содержания.">
        <label className="field">
          Шаблон
          <select className="select" value={slide.layout} onChange={(event) => onChangeLayout(event.target.value as SlideLayout)}>
            {slideLayoutOptions(slide.slideKind).map((option) => (
              <option key={option.id} value={option.id} disabled={!layoutCanRender(option.id, slide)}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </PropertySection>

      {selected ? (
        <>
          <PropertySection title="Содержимое" description="Текст или изображение внутри объекта.">
            {selected.type === "text" ? <TextContentProperties selected={selected} onUpdate={onUpdate} /> : null}
            {selected.type === "shape" ? <ShapeContentProperties selected={selected} onUpdate={onUpdate} /> : null}
            {selected.type === "image" ? <ImageContentProperties selected={selected} onUpdate={onUpdate} /> : null}
          </PropertySection>

          <PropertySection title="Оформление" description="Настройте внешний вид объекта.">
            {selected.type === "text" ? <TextStyleProperties selected={selected} onUpdate={onUpdate} /> : null}
            {selected.type === "shape" ? <ShapeStyleProperties selected={selected} onUpdate={onUpdate} /> : null}
            {selected.type === "image" ? <ImageStyleProperties selected={selected} onUpdate={onUpdate} /> : null}
            <label className="field">
              Прозрачность
              <input
                className="input"
                max={1}
                min={0}
                step={0.05}
                type="number"
                value={selected.opacity}
                onChange={(event) => onUpdate({ opacity: Number(event.target.value) })}
              />
            </label>
          </PropertySection>

          <PropertySection title="Положение" description="Точно разместите объект на слайде.">
            <div className="property-grid">
              <label className="field">
                X
                <input className="input" type="number" value={Math.round(selected.x)} onChange={(event) => onUpdate({ x: Number(event.target.value) })} />
              </label>
              <label className="field">
                Y
                <input className="input" type="number" value={Math.round(selected.y)} onChange={(event) => onUpdate({ y: Number(event.target.value) })} />
              </label>
              <label className="field">
                Ширина
                <input className="input" type="number" min={32} value={Math.round(selected.w)} onChange={(event) => onUpdate({ w: Number(event.target.value) })} />
              </label>
              <label className="field">
                Высота
                <input className="input" type="number" min={24} value={Math.round(selected.h)} onChange={(event) => onUpdate({ h: Number(event.target.value) })} />
              </label>
              <label className="field">
                Поворот
                <input className="input" type="number" value={Math.round(selected.rotation)} onChange={(event) => onUpdate({ rotation: Number(event.target.value) })} />
              </label>
            </div>
          </PropertySection>

          <PropertySection title="Слой" description="Настройте порядок и блокировку объекта.">
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
              <input type="checkbox" checked={selected.locked} onChange={(event) => onUpdate({ locked: event.target.checked })} />
              Заблокировать объект
            </label>
            <button className="property-danger" type="button" onClick={onDelete} disabled={selected.locked}>
              <Icon name="trash" />
              Удалить объект
            </button>
          </PropertySection>
        </>
      ) : (
        <div className="properties-empty">
          <strong>Выберите объект на слайде</strong>
          <p>Нажмите на текст, изображение или фигуру, чтобы изменить содержимое, оформление и положение.</p>
        </div>
      )}

      <PropertySection title="Заметки докладчика" description="Текст выступления для этого слайда.">
        <label className="field">
          Заметки
          <textarea key={slide.id} className="textarea notes" defaultValue={slide.speakerNotes} onBlur={(event) => onSaveNotes(event.target.value)} />
        </label>
      </PropertySection>
    </div>
  );
}

function PropertySection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="property-section">
      <div className="property-section-header">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function layoutCanRender(layout: SlideLayout, slide: Slide) {
  const sequenceCount = Math.max(slide.visual.items.length, slide.bullets.length);
  if (layout === "metrics") {
    const text = [slide.title, slide.thesis, ...slide.bullets, ...slide.blocks.flatMap((block) => (block.type === "bullets" ? block.items : [block.content]))].join(" ");
    return hasMeasurableValue(text);
  }
  if (layout === "definition") return Boolean(slide.definition);
  if (layout === "comparison") {
    return slide.visual.rows.filter((row) => row.left.trim() && row.right.trim()).length >= 2
      && Boolean(slide.visual.leftLabel.trim() && slide.visual.rightLabel.trim());
  }
  if (layout === "myth-fact") return slide.visual.items.length >= 2 && slide.bullets.length >= 1;
  if (layout === "question-answer") return Boolean(slide.thesis.trim() && slide.bullets.length >= 2);
  if (layout === "timeline" || layout === "process") {
    return slide.visual.items.filter((item) => item.label.trim() && item.text.trim()).length >= 3;
  }
  if (layout === "case-study" || layout === "problem-solution") return sequenceCount >= 3;
  if (layout === "evidence") return Boolean(slide.thesis && slide.bullets.length >= 2);
  return true;
}

function layoutKeepsVisualImage(layout: SlideLayout) {
  return layout === "image-focus";
}

function visualWithoutImage(visual: SlideVisual): SlideVisual {
  const { image: _image, ...rest } = visual;
  return {
    ...rest,
    type: visual.type === "image" ? "none" : visual.type,
  };
}

function TextContentProperties({ selected, onUpdate }: { selected: CanvasTextElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <label className="field">
      Текст
      <textarea
        className="textarea element-textarea"
        value={selected.text}
        onChange={(event) => onUpdate({ text: event.target.value, runs: [{ text: event.target.value }] } as Partial<CanvasTextElement>)}
      />
    </label>
  );
}

function TextStyleProperties({ selected, onUpdate }: { selected: CanvasTextElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <>
      <div className="property-grid">
        <label className="field">
          Размер
          <input className="input" type="number" min={8} max={160} value={selected.fontSize} onChange={(event) => onUpdate({ fontSize: Number(event.target.value) } as Partial<CanvasTextElement>)} />
        </label>
        <label className="field">
          Цвет
          <input className="input color-input" type="color" value={selected.color} onChange={(event) => onUpdate({ color: event.target.value } as Partial<CanvasTextElement>)} />
        </label>
      </div>
      <label className="field">
        Шрифт
        <input className="input" value={selected.fontFamily} onChange={(event) => onUpdate({ fontFamily: event.target.value } as Partial<CanvasTextElement>)} />
      </label>
      <div className="segmented segmented-five">
        <button className={selected.bold ? "tool-active" : ""} type="button" onClick={() => onUpdate({ bold: !selected.bold } as Partial<CanvasTextElement>)} title="Полужирный">Ж</button>
        <button className={selected.italic ? "tool-active" : ""} type="button" onClick={() => onUpdate({ italic: !selected.italic } as Partial<CanvasTextElement>)} title="Курсив">К</button>
        <button className={selected.underline ? "tool-active" : ""} type="button" onClick={() => onUpdate({ underline: !selected.underline } as Partial<CanvasTextElement>)} title="Подчёркнутый">Ч</button>
        <button className={selected.align === "left" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "left" } as Partial<CanvasTextElement>)} title="Выровнять по левому краю"><Icon name="alignLeft" /></button>
        <button className={selected.align === "center" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "center" } as Partial<CanvasTextElement>)} title="Выровнять по центру"><Icon name="alignCenter" /></button>
        <button className={selected.align === "right" ? "tool-active" : ""} type="button" onClick={() => onUpdate({ align: "right" } as Partial<CanvasTextElement>)} title="Выровнять по правому краю"><Icon name="alignRight" /></button>
      </div>
    </>
  );
}

function ShapeContentProperties({ selected, onUpdate }: { selected: CanvasShapeElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <label className="field">
      Фигура
      <select className="select" value={selected.shape} onChange={(event) => onUpdate({ shape: event.target.value as CanvasShapeElement["shape"] } as Partial<CanvasShapeElement>)}>
        <option value="rect">Прямоугольник</option>
        <option value="roundRect">Скруглённый прямоугольник</option>
        <option value="ellipse">Эллипс</option>
        <option value="line">Линия</option>
      </select>
    </label>
  );
}

function ShapeStyleProperties({ selected, onUpdate }: { selected: CanvasShapeElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <>
      <div className="property-grid">
        <label className="field">
          Заливка
          <input className="input color-input" type="color" value={selected.fill} onChange={(event) => onUpdate({ fill: event.target.value } as Partial<CanvasShapeElement>)} />
        </label>
        <label className="field">
          Обводка
          <input className="input color-input" type="color" value={selected.stroke} onChange={(event) => onUpdate({ stroke: event.target.value } as Partial<CanvasShapeElement>)} />
        </label>
      </div>
      <label className="field">
        Толщина обводки
        <input className="input" type="number" min={0} max={24} value={selected.strokeWidth} onChange={(event) => onUpdate({ strokeWidth: Number(event.target.value) } as Partial<CanvasShapeElement>)} />
      </label>
    </>
  );
}

function ImageContentProperties({ selected, onUpdate }: { selected: CanvasImageElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <label className="field">
      Описание изображения
      <input className="input" value={selected.alt} onChange={(event) => onUpdate({ alt: event.target.value } as Partial<CanvasImageElement>)} />
    </label>
  );
}

function ImageStyleProperties({ selected, onUpdate }: { selected: CanvasImageElement; onUpdate: (patch: ElementPatch) => void }) {
  return (
    <label className="field">
      Размещение
      <select className="select" value={selected.fit} onChange={(event) => onUpdate({ fit: event.target.value as CanvasImageElement["fit"] } as Partial<CanvasImageElement>)}>
        <option value="cover">Заполнить рамку</option>
        <option value="contain">Вписать целиком</option>
      </select>
    </label>
  );
}

function Icon({ name }: { name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
  };

  return (
    <svg className="tool-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === "cursor" ? <path {...common} d="M5 3l12 9-5 1.2 3 5.3-3 1.7-3-5.4-4 3.2z" /> : null}
      {name === "text" ? <path {...common} d="M5 6h14M12 6v12M9 18h6" /> : null}
      {name === "shape" ? <path {...common} d="M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /> : null}
      {name === "image" ? (
        <>
          <path {...common} d="M5 6h14v12H5z" />
          <path {...common} d="M8 15l3-3 2 2 2-3 3 4" />
          <path {...common} d="M8.5 9.5h.1" />
        </>
      ) : null}
      {name === "undo" ? <path {...common} d="M9 7H5v4M5 7l5 5a6 6 0 0 0 9 1" /> : null}
      {name === "redo" ? <path {...common} d="M15 7h4v4M19 7l-5 5a6 6 0 0 1-9 1" /> : null}
      {name === "preview" ? (
        <>
          <path {...common} d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" />
          <path {...common} d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z" />
        </>
      ) : null}
      {name === "export" ? (
        <>
          <path {...common} d="M12 4v10M8 8l4-4 4 4" />
          <path {...common} d="M5 14v5h14v-5" />
        </>
      ) : null}
      {name === "copy" ? (
        <>
          <path {...common} d="M8 8h10v10H8z" />
          <path {...common} d="M6 16H5V5h11v1" />
        </>
      ) : null}
      {name === "trash" ? (
        <>
          <path {...common} d="M6 7h12M10 7V5h4v2M8 7l1 12h6l1-12" />
        </>
      ) : null}
      {name === "front" ? <path {...common} d="M8 8h8v8H8zM5 5h8M5 5v8M11 19h8M19 11v8" /> : null}
      {name === "back" ? <path {...common} d="M8 8h8v8H8zM11 5h8M19 5v8M5 11v8h8" /> : null}
      {name === "lock" ? <path {...common} d="M7 11h10v8H7zM9 11V8a3 3 0 0 1 6 0v3" /> : null}
      {name === "unlock" ? <path {...common} d="M7 11h10v8H7zM9 11V8a3 3 0 0 1 5.4-1.8" /> : null}
      {name === "replace" ? <path {...common} d="M7 7h8l-2-2M17 17H9l2 2M17 17a6 6 0 0 0 1-7M7 7a6 6 0 0 0-1 7" /> : null}
      {name === "alignLeft" ? <path {...common} d="M5 7h12M5 12h8M5 17h12" /> : null}
      {name === "alignCenter" ? <path {...common} d="M6 7h12M9 12h6M6 17h12" /> : null}
      {name === "alignRight" ? <path {...common} d="M7 7h12M11 12h8M7 17h12" /> : null}
    </svg>
  );
}

function floatingMenuStyle(element: CanvasElement, scale: number, canvasWidth: number, canvasHeight: number): CSSProperties {
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
    script_generating: "Создаём текст",
    script_ready: "Текст готов",
    queued: "В очереди",
    generating: "Создаём презентацию",
    ready: "Готово",
    failed: "Ошибка",
  };
  return labels[status] || status;
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
    justifyContent: element.valign === "middle" ? "center" : element.valign === "bottom" ? "flex-end" : "flex-start",
    lineHeight: 1.14,
    outline: "none",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
  };
}

function shapeStyle(element: CanvasShapeElement): CSSProperties {
  return {
    width: "100%",
    height: "100%",
    background: element.shape === "line" ? "transparent" : element.fill,
    border: element.shape === "line" ? "0" : `${element.strokeWidth}px solid ${element.stroke}`,
    borderRadius: element.shape === "roundRect" ? 18 : element.shape === "ellipse" ? "50%" : 0,
    borderTop: element.shape === "line" ? `${Math.max(1, element.strokeWidth)}px solid ${element.stroke}` : undefined,
  };
}

function eventPoint(event: PointerEvent<HTMLElement>, stageElement: HTMLElement | null, scale: number) {
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
  const title = canvas.elements.find((element): element is CanvasTextElement => element.type === "text" && element.role === "title");
  return title?.text.trim() || slide.title;
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
  return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
}

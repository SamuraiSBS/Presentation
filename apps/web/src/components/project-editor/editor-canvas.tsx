import type { CSSProperties, KeyboardEvent, PointerEvent, RefObject } from "react";
import NextImage from "next/image";
import type { CanvasElement, PresentationTheme, Slide } from "@studydeck/shared";
import { buildSlideCanvas, canvasBackgroundCss, sortCanvasElements } from "@studydeck/shared";
import { elementStyle, shapeStyle, textStyle } from "./editor-geometry";

export function TemplatePreviewFrame({
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
            <SlidePlaceholderOverlay slide={slide} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SlidePlaceholderOverlay({ slide }: { slide: Slide }) {
  const placeholders = (slide.placeholders || []).filter((item) => !item.resolved);
  if (!placeholders.length) return null;
  return (
    <div className="canvas-placeholder-overlay" role="note" aria-label="Незаполненные данные на слайде">
      <strong>Нужно заполнить</strong>
      <span>{placeholders.slice(0, 2).map((item) => item.label).join(" · ")}</span>
      {placeholders.length > 2 ? <small>+{placeholders.length - 2}</small> : null}
    </div>
  );
}

export function ReadonlyCanvasElement({
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
          <NextImage
            src={element.url}
            alt={element.alt}
            fill
            sizes="100vw"
            unoptimized
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

export function CanvasElementView({
  element,
  position,
  scale,
  selected,
  editing,
  onPointerDown,
  onSelect,
  onResizePointerDown,
  onResizeKeyDown,
  onEditText,
  onStopEditText,
  onTextChange,
}: {
  element: CanvasElement;
  position: number;
  scale: number;
  selected: boolean;
  editing: boolean;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onSelect: () => void;
  onResizePointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onEditText: () => void;
  onStopEditText: () => void;
  onTextChange: (text: string) => void;
}) {
  const style = elementStyle(element);
  const elementLabel = canvasElementLabel(element, position);
  const elementStateLabel = element.locked
    ? "заблокирован"
    : selected
      ? element.type === "text"
        ? "выбран. Нажмите Enter, чтобы редактировать текст или используйте клавиши со стрелками для перемещения."
        : "выбран. Используйте клавиши со стрелками для перемещения."
      : "нажмите Enter или пробел, чтобы выбрать.";

  const selectWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    if (element.type === "text" && selected && !element.locked) {
      onEditText();
      return;
    }
    onSelect();
  };

  const selectWithPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.focus();
    onPointerDown(event);
  };

  const elementProps = {
    "aria-label": `${elementLabel} — ${elementStateLabel}`,
    "aria-pressed": selected,
    className: `canvas-element${element.type === "text" ? " canvas-text-element" : ""} ${selected ? "canvas-element-selected" : ""}`,
    "data-canvas-element-id": element.id,
    "data-canvas-element-type": element.type,
    onKeyDown: selectWithKeyboard,
    onPointerDown: selectWithPointer,
    role: "button" as const,
    tabIndex: 0,
  };

  const resizeHandle = selected && !element.locked ? (
    <button
      aria-label={`Изменить размер: ${elementLabel}`}
      className="resize-handle"
      data-resize-element-id={element.id}
      onKeyDown={onResizeKeyDown}
      onPointerDown={onResizePointerDown}
      style={{
        "--canvas-inverse-scale": 1 / Math.max(scale, 0.01),
      } as CSSProperties}
      type="button"
    />
  ) : null;

  if (element.type === "shape") {
    return (
      <div className="canvas-element-shell" style={style}>
        <div {...elementProps}>
          <div
            className={`canvas-shape canvas-shape-${element.shape}`}
            style={shapeStyle(element)}
          />
        </div>
        {resizeHandle}
      </div>
    );
  }

  if (element.type === "image") {
    return (
      <div className="canvas-element-shell" style={style}>
        <div
          {...elementProps}
          style={{ borderRadius: element.id.includes("-editorial-") ? 0 : 18, overflow: "hidden" }}
        >
          {element.url ? (
            <NextImage
              src={element.url}
              alt={element.alt}
              fill
              sizes="100vw"
              unoptimized
              draggable={false}
              style={{ objectFit: element.fit }}
            />
          ) : null}
        </div>
        {resizeHandle}
      </div>
    );
  }

  return (
    <div className="canvas-element-shell" style={style}>
      <div {...elementProps}>
        <div
          contentEditable={selected && editing && !element.locked}
          data-element-editor={element.id}
          suppressContentEditableWarning
          spellCheck={false}
          onDoubleClick={onEditText}
          onPointerDown={(event) => {
            if (editing) event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.currentTarget.parentElement?.focus();
            onStopEditText();
          }}
          onBlur={(event) => {
            onTextChange(event.currentTarget.innerText);
            onStopEditText();
          }}
          style={textStyle(element)}
        >
          {element.text}
        </div>
      </div>
      {resizeHandle}
    </div>
  );
}

function canvasElementLabel(element: CanvasElement, position: number) {
  if (element.type === "text") {
    const preview = accessiblePreview(element.text);
    return preview
      ? `Текстовый элемент ${position}: ${preview}`
      : `Пустой текстовый элемент ${position}`;
  }
  if (element.type === "image") {
    const preview = accessiblePreview(element.alt);
    return preview
      ? `Изображение ${position}: ${preview}`
      : `Изображение ${position} без описания`;
  }
  const shapeNames: Record<typeof element.shape, string> = {
    ellipse: "эллипс",
    line: "линия",
    rect: "прямоугольник",
    roundRect: "скруглённый прямоугольник",
  };
  return `Фигура ${position}: ${shapeNames[element.shape]}`;
}

function accessiblePreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 72 ? `${normalized.slice(0, 69)}…` : normalized;
}

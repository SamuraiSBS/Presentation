import type { KeyboardEvent, PointerEvent, RefObject } from "react";
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

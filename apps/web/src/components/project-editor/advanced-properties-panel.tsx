import type { ReactNode } from "react";
import { LazyRichTextField as RichTextField } from "@/components/editor/lazy-rich-text-field";
import { Select } from "@/components/ui/select";
import type { CanvasElement, CanvasImageElement, CanvasShapeElement, CanvasTextElement, Slide } from "@studydeck/shared";
import { elementLabel } from "./editor-errors";
import { Icon } from "./editor-icons";
import type { ElementPatch } from "./editor-types";

export function PropertiesPanel({
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
              <button
                type="button"
                onClick={onDuplicate}
                aria-label="Дублировать объект"
                title="Дублировать объект"
              >
                <Icon name="copy" />
              </button>
              <button
                type="button"
                onClick={onLayerDown}
                aria-label="Переместить объект назад"
                title="Переместить объект назад"
              >
                <Icon name="back" />
              </button>
              <button
                type="button"
                onClick={onLayerUp}
                aria-label="Переместить объект вперёд"
                title="Переместить объект вперёд"
              >
                <Icon name="front" />
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

export function PropertySection({
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

export function TextContentProperties({
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

export function TextStyleProperties({
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
          value="Nunito"
          readOnly
          aria-label="Nunito font"
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

export function ShapeContentProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasShapeElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Фигура
      <Select
        className="select"
        value={selected.shape}
        onValueChange={(value) => onUpdate({ shape: value as CanvasShapeElement["shape"] } as Partial<CanvasShapeElement>)}
        ariaLabel="Фигура"
        options={[{ value: "rect", label: "Прямоугольник" }, { value: "roundRect", label: "Скруглённый прямоугольник" }, { value: "ellipse", label: "Эллипс" }, { value: "line", label: "Линия" }]}
      />
    </label>
  );
}

export function ShapeStyleProperties({
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

export function ImageContentProperties({
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

export function ImageStyleProperties({
  selected,
  onUpdate,
}: {
  selected: CanvasImageElement;
  onUpdate: (patch: ElementPatch) => void;
}) {
  return (
    <label className="field">
      Размещение
      <Select
        className="select"
        value={selected.fit}
        onValueChange={(value) => onUpdate({ fit: value as CanvasImageElement["fit"] } as Partial<CanvasImageElement>)}
        ariaLabel="Размещение изображения"
        options={[{ value: "cover", label: "Заполнить рамку" }, { value: "contain", label: "Вписать целиком" }]}
      />
    </label>
  );
}

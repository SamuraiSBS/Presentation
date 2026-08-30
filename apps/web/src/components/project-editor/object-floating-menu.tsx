import type { CanvasElement, CanvasImageElement, CanvasTextElement } from "@studydeck/shared";
import { elementLabel } from "./editor-errors";
import { floatingMenuStyle } from "./editor-geometry";
import { Icon } from "./editor-icons";
import type { ElementPatch } from "./editor-types";

export function ObjectFloatingMenu({
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

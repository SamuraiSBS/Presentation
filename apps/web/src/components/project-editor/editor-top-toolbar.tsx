import Link from "next/link";
import { Icon } from "./editor-icons";
import type { Tool, ViewMode } from "./editor-types";

export function EditorTopToolbar({
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

import type { ReactNode } from "react";
import NextImage from "next/image";
import { Image as ImageIcon, Type, Upload } from "lucide-react";
import { RichTextField } from "@/components/editor/rich-text-field";
import type { CanvasImageElement, Slide } from "@studydeck/shared";
import { Icon } from "./editor-icons";
import type { SimpleEditorTab } from "./editor-types";

export function SimplePropertiesPanel({
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
      <div
        className="simple-tabs"
        role="tablist"
        aria-label="Правка слайда"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const next = activeTab === "text" ? "image" : "text";
          onChangeTab(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`#simple-editor-tab-${next}`)?.focus();
        }}
      >
        <SimpleTab
          active={activeTab === "text"}
          icon={<Type aria-hidden="true" />}
          id="text"
          label="Текст"
          onClick={() => onChangeTab("text")}
        />
        <SimpleTab
          active={activeTab === "image"}
          icon={<ImageIcon aria-hidden="true" />}
          id="image"
          label="Картинка"
          onClick={() => onChangeTab("image")}
        />
      </div>

      {activeTab === "text" ? (
        <div className="simple-tab-panel" id="simple-editor-text" role="tabpanel" aria-labelledby="simple-editor-tab-text">
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
        <div className="simple-tab-panel" id="simple-editor-image" role="tabpanel" aria-labelledby="simple-editor-tab-image">
          {image?.url ? (
            <NextImage
              className="simple-image-preview"
              src={image.url}
              alt={image.alt || "Изображение на слайде"}
              width={1600}
              height={900}
              unoptimized
            />
          ) : (
            <div className="simple-empty-state">
              <ImageIcon aria-hidden="true" />
              <strong>На этом слайде нет изображения</strong>
              <p>Добавьте изображение с устройства — точная правка для этого не нужна.</p>
            </div>
          )}
          <button
            className="button simple-upload-button"
            type="button"
            onClick={onUploadClick}
            disabled={!canUpload || busy}
          >
            <Upload aria-hidden="true" />
            {busy ? "Загружаем…" : image ? "Заменить изображение" : "Добавить изображение"}
          </button>
          <p className="simple-helper">PNG, JPG или WebP с устройства.</p>
        </div>
      ) : null}

    </div>
  );
}

export function SimpleTab({
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

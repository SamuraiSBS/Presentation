"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, Redo2, Undo2 } from "lucide-react";

type RichTextFieldProps = {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
  multiline?: boolean;
  toolbar?: boolean;
};

export function RichTextField({
  value,
  onSave,
  placeholder = "",
  className = "",
  testId,
  multiline = true,
  toolbar = true,
}: RichTextFieldProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: textToHtml(value, multiline),
    editorProps: {
      attributes: {
        class: `rich-text-content ${multiline ? "rich-text-multiline" : "rich-text-singleline"}`,
      },
      handleKeyDown: (_, event) => {
        if (!multiline && event.key === "Enter") {
          event.preventDefault();
          editor?.commands.blur();
          return true;
        }
        return false;
      },
    },
    immediatelyRender: false,
    onBlur: ({ editor: current }) => onSave(editorText(current.getText({ blockSeparator: "\n" }))),
  });

  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editorText(editor.getText({ blockSeparator: "\n" }));
    const next = editorText(value);
    if (current !== next) {
      editor.commands.setContent(textToHtml(value, multiline), { emitUpdate: false });
    }
  }, [editor, multiline, value]);

  if (!editor) return null;

  return (
    <div className={`rich-text-field ${className}`.trim()} data-testid={testId}>
      {toolbar ? (
        <div className="rich-text-toolbar">
          <button
            type="button"
            className={editor.isActive("bold") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="Полужирный"
          >
            <Bold aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            className={editor.isActive("italic") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="Курсив"
          >
            <Italic aria-hidden="true" size={15} />
          </button>
          {multiline ? (
            <button
              type="button"
              className={editor.isActive("bulletList") ? "active" : ""}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              title="Список"
            >
              <List aria-hidden="true" size={15} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => editor.chain().focus().undo().run()}
            title="Отменить"
          >
            <Undo2 aria-hidden="true" size={15} />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().redo().run()}
            title="Повторить"
          >
            <Redo2 aria-hidden="true" size={15} />
          </button>
        </div>
      ) : null}
      <EditorContent editor={editor} />
    </div>
  );
}

function textToHtml(value: string, multiline: boolean) {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  if (!multiline) return `<p>${escapeHtml(lines.join(" "))}</p>`;
  return lines.length
    ? lines.map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`).join("")
    : "<p></p>";
}

function editorText(value: string) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

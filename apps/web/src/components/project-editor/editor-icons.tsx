import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  BringToFront,
  Copy,
  Eye,
  Image as ImageIcon,
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

export type IconName =
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
  image: ImageIcon,
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


export function Icon({ name }: { name: IconName }) {
  const Component = editorIcons[name];
  return <Component className="tool-icon" aria-hidden="true" focusable="false" />;
}

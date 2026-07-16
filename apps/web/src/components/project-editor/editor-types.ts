import type { CanvasElement, PresentationDocument, SlideCanvas } from "@studydeck/shared";

export type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  presentation?: { document: PresentationDocument } | null;
  accessRole?: "owner" | "editor" | "viewer";
  presentationRevision?: number;
};

export type Tool = "select" | "text" | "shape";
export type ViewMode = "preview" | "edit";
export type SimpleEditorTab = "text" | "image";
export type MobileEditorSection = "slides" | "edit" | "preview";
export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type ElementPatch = Partial<CanvasElement> & Record<string, unknown>;
export type DragState =
  | {
      mode: "move";
      id: string;
      startX: number;
      startY: number;
      original: CanvasElement;
      originals: CanvasElement[];
    }
  | {
      mode: "resize";
      id: string;
      startX: number;
      startY: number;
      original: CanvasElement;
      originals: CanvasElement[];
      lastValid: CanvasElement[];
    };

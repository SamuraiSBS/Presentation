import { useRef } from "react";
import type { Slide, SlideCanvas, SlideLayout, SlideVisual } from "@studydeck/shared";
import type { SaveStatus } from "./editor-types";

export type SlideSavePatch = {
  title?: string;
  thesis?: string;
  bullets?: string[];
  layout?: SlideLayout;
  visual?: SlideVisual;
  blocks?: Slide["blocks"];
  canvas?: SlideCanvas;
  speakerNotes?: string;
};

type UseEditorSaveQueueOptions = {
  projectId: string;
  canEdit: boolean;
  getSlide: () => Slide | undefined;
  getRevision: () => number;
  onRevision: (revision: number | undefined) => void;
  onStatus: (status: SaveStatus) => void;
  onError: (error: unknown) => void;
  onConflict: () => void;
};

/** Serializes slide writes and preserves the newest failed patch for retry. */
export function useEditorSaveQueue(options: UseEditorSaveQueueOptions) {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const conflictRef = useRef(false);
  const hasUnsavedChangesRef = useRef(false);
  const sequenceRef = useRef(0);
  const latestRef = useRef<{ patch: SlideSavePatch; sequence: number } | null>(null);

  function saveSlide(next: SlideSavePatch) {
    const slide = options.getSlide();
    if (!slide || !options.canEdit || conflictRef.current) return Promise.resolve();
    const slideId = slide.id;
    const sequence = ++sequenceRef.current;
    latestRef.current = { patch: next, sequence };
    hasUnsavedChangesRef.current = true;
    const run = async () => {
      if (conflictRef.current) return;
      options.onStatus("saving");
      try {
        const response = await fetch(`/api/projects/${options.projectId}/slides/${slideId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...next, expectedRevision: options.getRevision() }),
        });
        const payload = await response.json().catch(() => null) as { presentationRevision?: number; message?: string } | null;
        if (response.status === 409) {
          conflictRef.current = true;
          options.onConflict();
          options.onStatus("error");
          return;
        }
        if (!response.ok) throw new Error(payload?.message || "Slide save failed");
        options.onRevision(payload?.presentationRevision);
        if (latestRef.current?.sequence === sequence) {
          hasUnsavedChangesRef.current = false;
          options.onStatus("saved");
        }
      } catch (error) {
        if (latestRef.current?.sequence === sequence) {
          options.onStatus("error");
          options.onError(error);
        }
      }
    };
    queueRef.current = queueRef.current.then(run, run);
    return queueRef.current;
  }

  return {
    saveSlide,
    retryLatestSave: () => {
      const latest = latestRef.current;
      if (!latest || conflictRef.current) return Promise.resolve();
      return saveSlide(latest.patch);
    },
    clearConflict: () => { conflictRef.current = false; },
    hasUnsavedChangesRef,
  };
}

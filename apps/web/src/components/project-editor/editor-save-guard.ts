export type BeforeUnloadLikeEvent = {
  preventDefault: () => void;
  returnValue?: string;
};

/**
 * Keep this handler independent of React state: a close/navigation event can
 * arrive before React has rendered the saving indicator.
 */
export function createUnsavedChangesBeforeUnloadHandler(
  hasUnsavedChanges: () => boolean,
) {
  return (event: BeforeUnloadLikeEvent) => {
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  };
}

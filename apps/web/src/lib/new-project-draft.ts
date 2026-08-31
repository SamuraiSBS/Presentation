export const NEW_PROJECT_DRAFT_VERSION = 1;
export const NEW_PROJECT_DRAFT_STORAGE_KEY = "studydeck:new-project:draft";

export const newProjectCreationPhases = [
  "draft",
  "project_created",
  "uploading",
  "upload_failed",
  "uploaded",
  "narration",
  "narration_failed",
] as const;

export type NewProjectCreationPhase = typeof newProjectCreationPhases[number];

export type NewProjectDraft = {
  version: typeof NEW_PROJECT_DRAFT_VERSION;
  step: number;
  topic: string;
  slideCount: number;
  volumeConfirmed: boolean;
  sourceMode: "web" | "files";
  projectId: string | null;
  idempotencyKey: string;
  phase: NewProjectCreationPhase;
};

export function createNewProjectIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `new-project-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function readNewProjectDraft(): NewProjectDraft | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    return parseNewProjectDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeNewProjectDraft(draft: NewProjectDraft) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(NEW_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // A blocked or full sessionStorage must not prevent project creation.
  }
}

export function clearNewProjectDraft() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures; the completed request remains authoritative.
  }
}

export function parseNewProjectDraft(value: unknown): NewProjectDraft | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NewProjectDraft>;
  const step = candidate.step;
  const slideCount = candidate.slideCount;
  const topic = candidate.topic;
  const volumeConfirmed = candidate.volumeConfirmed;
  const sourceMode = candidate.sourceMode;
  const projectId = candidate.projectId;
  const idempotencyKey = candidate.idempotencyKey;
  const phase = candidate.phase;
  if (candidate.version !== NEW_PROJECT_DRAFT_VERSION) return null;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > 2) return null;
  if (typeof topic !== "string" || typeof slideCount !== "number" || !Number.isInteger(slideCount)) return null;
  if (typeof volumeConfirmed !== "boolean") return null;
  if (sourceMode !== "web" && sourceMode !== "files") return null;
  if (projectId !== null && (typeof projectId !== "string" || projectId.length === 0)) return null;
  if (typeof idempotencyKey !== "string" || idempotencyKey.trim().length < 8) return null;
  if (!newProjectCreationPhases.includes(phase as NewProjectCreationPhase)) return null;

  return {
    version: NEW_PROJECT_DRAFT_VERSION,
    step,
    topic,
    slideCount,
    volumeConfirmed,
    sourceMode,
    projectId,
    idempotencyKey,
    phase: phase as NewProjectCreationPhase,
  };
}

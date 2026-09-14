import type { AiSceneV3Candidate } from "@studydeck/shared";

export type AiSceneV3CandidateArtifacts = {
  background: { objectKey: string; body: Buffer; contentType: "image/png" };
  preview: { objectKey: string; body: Buffer; contentType: "image/png" };
};

/**
 * Stores both binary artifacts before exposing candidate metadata. The caller's
 * database transaction is the visibility boundary: preview/layout/hash cannot
 * become externally selectable in a partially stored state.
 */
export async function persistAiSceneV3Candidate(input: {
  candidate: AiSceneV3Candidate;
  artifacts: AiSceneV3CandidateArtifacts;
  putObject: (key: string, body: Buffer, contentType: "image/png") => Promise<void>;
  deleteObject: (key: string) => Promise<void>;
  transaction: (write: () => Promise<void>) => Promise<void>;
  writeCandidate: (candidate: AiSceneV3Candidate) => Promise<void>;
}) {
  if (input.candidate.backgroundObjectKey !== input.artifacts.background.objectKey || input.candidate.renderedPreviewObjectKey !== input.artifacts.preview.objectKey) {
    throw new Error("ai_scene_v3_candidate_persistence_key_mismatch");
  }
  let backgroundStored = false;
  let previewStored = false;
  try {
    await input.putObject(input.artifacts.background.objectKey, input.artifacts.background.body, "image/png"); backgroundStored = true;
    await input.putObject(input.artifacts.preview.objectKey, input.artifacts.preview.body, "image/png"); previewStored = true;
    await input.transaction(() => input.writeCandidate(input.candidate));
  } catch (error) {
    await Promise.allSettled([
      backgroundStored ? input.deleteObject(input.artifacts.background.objectKey) : Promise.resolve(),
      previewStored ? input.deleteObject(input.artifacts.preview.objectKey) : Promise.resolve(),
    ]);
    throw error;
  }
}

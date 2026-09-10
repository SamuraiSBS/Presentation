type EnvLike = Record<string, string | undefined>;

export const AI_SCENE_IMAGE_TIMEOUT_MS = 90_000;

/**
 * AI Scene v2 image stages are sequential provider calls, not interactive
 * thumbnail fetches. Keep their timeout independent from the legacy 8 s
 * presentation-image setting.
 */
export function aiSceneImageEnv(env: EnvLike = process.env): EnvLike {
  const configured = Number(env.AI_SCENE_IMAGE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configured)
    ? Math.min(Math.max(Math.trunc(configured), 30_000), 180_000)
    : AI_SCENE_IMAGE_TIMEOUT_MS;
  return { ...env, AITUNNEL_IMAGE_TIMEOUT_MS: String(timeoutMs) };
}

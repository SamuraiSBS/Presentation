
type AiGenerationMode = "openai" | "yandex" | "aitunnel";
type EnvLike = Record<string, string | undefined>;

export class StructuredGenerationError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly validationError: unknown,
  ) {
    const detail = validationError instanceof Error ? validationError.message : String(validationError);
    super(`Structured generation for ${schemaName} failed validation: ${detail}`);
    this.name = "StructuredGenerationError";
  }
}

import { aitunnelConfig } from "../../../openai-client.js";
import { normalizeProvider } from "../quality/orchestration.js";

export function selectAiProviders(env: EnvLike = process.env): AiGenerationMode[] {
  const requested = normalizeProvider(env.AI_PROVIDER);
  const hasOpenAI = Boolean(env.OPENAI_API_KEY?.trim());
  const hasYandex = Boolean(env.YANDEX_API_KEY?.trim() && (env.YANDEX_MODEL_URI?.trim() || env.YANDEX_FOLDER_ID?.trim()));
  const hasAitunnel = Boolean(aitunnelConfig(env));

  // An explicit provider selection is a contract, not a preference.  In
  // particular, a failed Yandex request must never spend OpenAI credits or
  // produce a result from a different model.
  if (requested === "openai") return hasOpenAI ? ["openai"] : [];
  if (requested === "yandex") return hasYandex ? ["yandex"] : [];
  if (requested === "aitunnel") return hasAitunnel ? ["aitunnel"] : [];

  return [
    ...(hasOpenAI ? ["openai" as const] : []),
    ...(hasYandex ? ["yandex" as const] : []),
  ];
}

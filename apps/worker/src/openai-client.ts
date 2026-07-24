import OpenAI from "openai";
import { createOpenAI } from "@ai-sdk/openai";
import { isApprovedAitunnelModel } from "./aitunnel-provider-catalog.js";

type EnvLike = Record<string, string | undefined>;

export const AITUNNEL_DEFAULT_BASE_URL = "https://api.aitunnel.ru/v1";
export const AITUNNEL_DEFAULT_NARRATION_MODEL = "gemini-3.6-flash";

export type AitunnelConfig = {
  apiKey: string;
  baseURL: string;
  narrationModel: string;
};

/**
 * Build one OpenAI-compatible client configuration for the whole worker.
 *
 * `OPENAI_BASE_URL` deliberately remains provider-neutral: it supports a
 * gateway such as AITUNNEL without changing the generation contract or
 * exposing a gateway-specific secret in application code.
 */
export function openAIClientOptions(env: EnvLike = process.env) {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const baseURL = env.OPENAI_BASE_URL?.trim();

  return {
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
  };
}

export function createOpenAIClient(env: EnvLike = process.env) {
  return new OpenAI(openAIClientOptions(env));
}

export function createOpenAIProvider(env: EnvLike = process.env) {
  return createOpenAI(openAIClientOptions(env));
}

/** AITUNNEL is a separately selected provider, never an OPENAI_BASE_URL alias. */
export function aitunnelConfig(env: EnvLike = process.env): AitunnelConfig | undefined {
  const apiKey = env.AITUNNEL_API_KEY?.trim();
  const narrationModel = (env.AITUNNEL_NARRATION_MODEL === undefined ? AITUNNEL_DEFAULT_NARRATION_MODEL : env.AITUNNEL_NARRATION_MODEL).trim();
  if (!apiKey || narrationModel !== AITUNNEL_DEFAULT_NARRATION_MODEL || !isApprovedAitunnelModel(narrationModel)) return undefined;
  return {
    apiKey,
    baseURL: env.AITUNNEL_BASE_URL?.trim() || AITUNNEL_DEFAULT_BASE_URL,
    narrationModel,
  };
}

export function createAitunnelClient(env: EnvLike = process.env) {
  const config = aitunnelConfig(env);
  if (!config) throw new Error("AITUNNEL_API_KEY and an explicit AITUNNEL_NARRATION_MODEL are required");
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
}

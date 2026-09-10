import OpenAI from "openai";
import { createOpenAI } from "@ai-sdk/openai";
import { Agent } from "node:https";
import { createRequire } from "node:module";
import { setDefaultResultOrder } from "node:dns";
import { isApprovedAitunnelModel } from "./aitunnel-provider-catalog.js";
import { AITUNNEL_ECONOMY_MODEL } from "./aitunnel-narration-budget.js";

type EnvLike = Record<string, string | undefined>;
type NodeFetchLike = (url: string | URL, init?: RequestInit & { agent?: Agent }) => Promise<Response>;
const nodeFetch = createRequire(import.meta.url)("node-fetch") as NodeFetchLike;

export const AITUNNEL_DEFAULT_BASE_URL = "https://api.aitunnel.ru/v1";
export const AITUNNEL_DEFAULT_NARRATION_MODEL = AITUNNEL_ECONOMY_MODEL;
export const AITUNNEL_DEFAULT_SEARCH_MODEL = "gpt-5.6-luna";
export const AITUNNEL_DEFAULT_REQUEST_TIMEOUT_MS = 90_000;

export type AitunnelConfig = {
  apiKey: string;
  baseURL: string;
  narrationModel: string;
};

export type AitunnelSearchConfig = {
  apiKey: string;
  baseURL: string;
  searchModel: string;
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
  if (!config) throw new Error(`AITUNNEL_API_KEY and AITUNNEL_NARRATION_MODEL=${AITUNNEL_DEFAULT_NARRATION_MODEL} are required`);
  // The local FlClashX adapter has an intermittent IPv6 TLS path to
  // AITUNNEL. Node's IPv4-first transport reaches the same endpoint.
  setDefaultResultOrder("ipv4first");
  // The prototype cost gate accounts for one attempt per stage. The SDK's
  // default retries would otherwise create hidden additional paid requests.
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: aitunnelRequestTimeoutMs(env),
    maxRetries: 0,
    // When explicitly configured, node-fetch bypasses an invalid desktop
    // HTTP(S)_PROXY and pins just this gateway to a verified IPv4 edge while
    // preserving api.aitunnel.ru as the TLS server name.
    fetch: createAitunnelFetch(env) as never,
  });
}

export function aitunnelForcedIpv4(env: EnvLike = process.env) {
  const value = env.AITUNNEL_FORCE_IPV4?.trim();
  return value && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) ? value : undefined;
}

export function createAitunnelFetch(env: EnvLike = process.env) {
  const forcedIpv4 = aitunnelForcedIpv4(env);
  if (!forcedIpv4) return fetch;
  const agent = forcedIpv4
    ? new Agent({
      lookup(hostname, _options, callback) {
        if (hostname === "api.aitunnel.ru") {
          if (_options.all) {
            return (callback as unknown as (error: Error | null, addresses: Array<{ address: string; family: number }>) => void)(null, [{ address: forcedIpv4, family: 4 }]);
          }
          return callback(null, forcedIpv4, 4);
        }
        return callback(new Error(`Unexpected AITUNNEL transport host: ${hostname}`), "0.0.0.0", 4);
      },
    })
    : undefined;
  return (url: string | URL, init?: RequestInit) => nodeFetch(url, {
    ...(init || {}),
    ...(agent ? { agent } : {}),
  });
}

export function aitunnelRequestTimeoutMs(env: EnvLike = process.env) {
  const configured = Number(env.AITUNNEL_REQUEST_TIMEOUT_MS);
  return Number.isFinite(configured) ? Math.min(Math.max(Math.trunc(configured), 30_000), 180_000) : AITUNNEL_DEFAULT_REQUEST_TIMEOUT_MS;
}

export function aitunnelSearchConfig(env: EnvLike = process.env): AitunnelSearchConfig | undefined {
  const apiKey = env.AITUNNEL_API_KEY?.trim();
  const searchModel = (env.AITUNNEL_SEARCH_MODEL === undefined ? AITUNNEL_DEFAULT_SEARCH_MODEL : env.AITUNNEL_SEARCH_MODEL).trim();
  if (!apiKey || !isApprovedAitunnelModel(searchModel)) return undefined;
  return {
    apiKey,
    baseURL: env.AITUNNEL_BASE_URL?.trim() || AITUNNEL_DEFAULT_BASE_URL,
    searchModel,
  };
}

export function createAitunnelSearchClient(env: EnvLike = process.env) {
  const config = aitunnelSearchConfig(env);
  if (!config) throw new Error("AITUNNEL_API_KEY and a valid AITUNNEL_SEARCH_MODEL are required");
  return new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
}

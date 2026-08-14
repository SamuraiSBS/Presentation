import "server-only";

import { auth } from "@/auth";
import { devAuthAllowed } from "@studydeck/shared";

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class InternalApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "InternalApiError";
    this.status = status;
    this.body = body;
  }
}

export type InternalApiResponse<T> = {
  data: T;
  status: number;
  headers: Headers;
};

export async function requireUserId(): Promise<string> {
  const session = await auth();
  if (session?.user?.id) return session.user.id;

  // This is deliberately server-only. It is useful for a local production-like
  // container too, but can only be enabled by the exact private env flag.
  if (devAuthAllowed()) {
    return process.env.TEMP_USER_ID?.trim() || "local-user";
  }

  throw new InternalApiError(401, {
    code: "UNAUTHENTICATED",
    message: "Нужно войти в аккаунт",
  });
}

export async function internalRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<InternalApiResponse<T>> {
  const method = (init.method || "GET").toUpperCase();
  const demoPreviewEnabled = process.env.NEXT_PUBLIC_DEMO_PREVIEW === "true";

  if (demoPreviewEnabled && method === "GET") {
    const demo = await demoPreviewResponse(path);
    if (demo) return { data: demo as T, status: 200, headers: new Headers() };
  }

  const userId = await requireUserId();
  const baseUrl = (process.env.INTERNAL_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const headers = new Headers(init.headers);
  headers.set("x-user-id", userId);
  headers.set("x-internal-token", process.env.INTERNAL_API_TOKEN || "");

  const response = await fetch(`${baseUrl}/v1${path}`, {
    ...init,
    method,
    cache: "no-store",
    headers,
  });

  const data = await readResponseBody(response);
  if (!response.ok) {
    throw new InternalApiError(response.status, normalizeApiError(response.status, data));
  }

  return { data: data as T, status: response.status, headers: response.headers };
}

async function demoPreviewResponse(path: string): Promise<unknown | null> {
  const {
    demoDashboard,
    demoDefenseProject,
    demoDefenseWorkspace,
    demoFolders,
    demoProfile,
    demoProject,
    demoProjectList,
    demoScriptReviewProject,
  } = await import("./demo-project");

  if (path === "/projects/demo") return demoProject;
  if (path === "/projects/defense-demo") return demoDefenseProject;
  if (path === "/projects/defense-demo/defense") return demoDefenseWorkspace;
  if (path === "/projects/script-review-demo") return demoScriptReviewProject;
  if (path === "/dashboard") return demoDashboard;
  if (path === "/folders") return demoFolders;
  if (path === "/users/me") return demoProfile;
  if (path === "/projects" || path.startsWith("/projects?")) return demoProjectList;
  return null;
}

export async function internalFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return (await internalRequest<T>(path, init)).data;
}

export function normalizeUnknownApiError(error: unknown): InternalApiError {
  if (error instanceof InternalApiError) return error;
  return new InternalApiError(500, {
    code: "INTERNAL_ERROR",
    message: "Сервис временно недоступен. Попробуйте ещё раз.",
  });
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json") || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Fall through to the safe text mapping below.
    }
  }
  return text;
}

function normalizeApiError(status: number, value: unknown): ApiErrorBody {
  if (isRecord(value)) {
    const details = isRecord(value.details) ? value.details : undefined;
    const code = typeof value.code === "string" ? value.code : statusCode(status);
    const message = readableMessage(value.message, status);
    return { code, message, ...(details ? { details } : {}) };
  }

  return {
    code: statusCode(status),
    message: readableMessage(value, status),
  };
}

function readableMessage(value: unknown, status: number): string {
  const candidate = Array.isArray(value)
    ? value.find((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value
      : undefined;

  if (candidate && /[А-Яа-яЁё]/.test(candidate) && !/<[^>]+>/.test(candidate)) {
    return candidate.slice(0, 500);
  }

  const knownMessage = localizedApiMessage(candidate);
  if (knownMessage) return knownMessage;

  const defaults: Record<number, string> = {
    400: "Проверьте введённые данные",
    401: "Нужно войти в аккаунт",
    403: "Для этого действия не хватает прав",
    404: "Запрошенные данные не найдены",
    409: "Данные изменились. Обновите страницу и попробуйте снова.",
    429: "Лимит на этот месяц исчерпан",
  };
  return defaults[status] || "Сервис временно недоступен. Попробуйте ещё раз.";
}

function localizedApiMessage(message: string | undefined): string | undefined {
  if (!message) return undefined;

  const normalized = message.trim().toLowerCase();
  if (normalized === "defense workspace not found") return "Рабочее пространство защиты не найдено.";
  if (normalized === "project not found") return "Презентация не найдена.";
  if (normalized === "parent source not found") return "Не найден связанный материал проекта.";
  if (normalized === "presentation not generated yet") return "Презентация ещё не собрана.";
  if (/^cannot (get|post|put|patch|delete) \/v1\//.test(normalized)) {
    return "Сервис ещё не поддерживает это действие. Обновите приложение и попробуйте снова.";
  }

  return undefined;
}

function statusCode(status: number) {
  return ({
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    429: "TOO_MANY_REQUESTS",
  } as Record<number, string>)[status] || "INTERNAL_ERROR";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

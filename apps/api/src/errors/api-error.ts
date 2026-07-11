import { HttpException, HttpStatus } from "@nestjs/common";
import type { infer as ZodInfer, ZodTypeAny } from "zod";

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};

export class ApiError extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details?: Record<string, unknown>) {
    const body: ApiErrorBody = details ? { code, message, details } : { code, message };
    super(body, status);
  }
}

export function unauthenticated(message = "Требуется авторизация") {
  return new ApiError(HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED", message);
}

export function forbidden(message = "Недостаточно прав для этого действия") {
  return new ApiError(HttpStatus.FORBIDDEN, "FORBIDDEN", message);
}

export function projectNotFound() {
  return new ApiError(HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND", "Презентация не найдена");
}

export function resourceNotFound(message = "Ресурс не найден") {
  return new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", message);
}

export function conflict(code: string, message: string, details?: Record<string, unknown>) {
  return new ApiError(HttpStatus.CONFLICT, code, message, details);
}

export function badRequest(code: string, message: string, details?: Record<string, unknown>) {
  return new ApiError(HttpStatus.BAD_REQUEST, code, message, details);
}

export function parseInput<TSchema extends ZodTypeAny>(schema: TSchema, value: unknown): ZodInfer<TSchema> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw badRequest("VALIDATION_ERROR", "Некорректные данные", {
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
}

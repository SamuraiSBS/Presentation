import { ArgumentsHost, Catch, HttpException } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { captureApiError } from "./observability.js";

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<{ method?: string; route?: { path?: string }; url?: string }>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;

    captureApiError(exception, {
      method: request?.method,
      path: request?.route?.path || request?.url?.split("?")[0],
      statusCode,
    });

    super.catch(exception, host);
  }
}

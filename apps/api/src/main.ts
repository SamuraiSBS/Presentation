import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";
import { initSentry, initTracing, logger } from "./observability.js";
import { SentryExceptionFilter } from "./sentry-exception.filter.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { ApiRateLimitGuard } from "./security/api-rate-limit.guard.js";
import { assertProductionConfiguration } from "@studydeck/shared";

assertProductionConfiguration();
initTracing();
initSentry();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });
  const config = app.get(ConfigService);
  const httpAdapter = app.get(HttpAdapterHost);
  const express = app.getHttpAdapter().getInstance();
  // The API is private in production and receives client IPs only from the
  // single Caddy hop. This makes req.ip safe to use as a rate-limit key.
  express.set("trust proxy", Number(config.get<string>("TRUST_PROXY_HOPS") || 1));
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalGuards(app.get(ApiRateLimitGuard));
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter.httpAdapter, app.get(PrismaService)));

  const port = Number(config.get("API_PORT") || 4000);
  await app.listen(port, "0.0.0.0");
  logger.info({ port }, "studydeck api listening");
}

void bootstrap();

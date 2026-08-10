import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";
import { initSentry, initTracing, logger } from "./observability.js";
import { SentryExceptionFilter } from "./sentry-exception.filter.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { assertProductionConfiguration } from "@studydeck/shared";

assertProductionConfiguration();
initTracing();
initSentry();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });
  const config = app.get(ConfigService);
  const httpAdapter = app.get(HttpAdapterHost);
  app.enableShutdownHooks(["SIGTERM", "SIGINT"]);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter.httpAdapter, app.get(PrismaService)));

  const port = Number(config.get("API_PORT") || 4000);
  await app.listen(port, "0.0.0.0");
  logger.info({ port }, "studydeck api listening");
}

void bootstrap();

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });
  const config = app.get(ConfigService);
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = Number(config.get("API_PORT") || 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`StudyDeck API listening on http://localhost:${port}`);
}

void bootstrap();

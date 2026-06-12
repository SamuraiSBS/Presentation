import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BillingModule } from "./billing/billing.module.js";
import { ExportsModule } from "./exports/exports.module.js";
import { HealthModule } from "./health/health.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { PresentationsModule } from "./presentations/presentations.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { SourcesModule } from "./sources/sources.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL") || "redis://localhost:6379",
        },
      }),
    }),
    PrismaModule,
    HealthModule,
    ProjectsModule,
    SourcesModule,
    JobsModule,
    PresentationsModule,
    ExportsModule,
    BillingModule,
  ],
})
export class AppModule {}

import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { BillingModule } from "./billing/billing.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { CollaborationModule } from "./collaboration/collaboration.module.js";
import { DashboardModule } from "./dashboard/dashboard.module.js";
import { DefenseModule } from "./defense/defense.module.js";
import { ExportsModule } from "./exports/exports.module.js";
import { FoldersModule } from "./folders/folders.module.js";
import { HealthModule } from "./health/health.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { PresentationsModule } from "./presentations/presentations.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { ProjectsModule } from "./projects/projects.module.js";
import { SourcesModule } from "./sources/sources.module.js";
import { UsersModule } from "./users/users.module.js";
import { ObservabilityShutdownService } from "./observability-shutdown.service.js";
import { SecurityModule } from "./security/security.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SecurityModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          url: config.get<string>("REDIS_URL") || "redis://localhost:6379",
        },
      }),
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    HealthModule,
    ProjectsModule,
    SourcesModule,
    JobsModule,
    PresentationsModule,
    ExportsModule,
    BillingModule,
    DashboardModule,
    DefenseModule,
    FoldersModule,
    CollaborationModule,
    UsersModule,
  ],
  providers: [ObservabilityShutdownService],
})
export class AppModule {}

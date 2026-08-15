import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { ProjectStorageModule } from "../storage/project-storage.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { ProductAnalyticsModule } from "../analytics/product-analytics.module.js";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

@Module({
  imports: [
    BullModule.registerQueue({ name: "generation" }),
    ProjectAccessModule,
    ProjectStorageModule,
    UsageModule,
    ProductAnalyticsModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

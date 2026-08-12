import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { ProductAnalyticsModule } from "../analytics/product-analytics.module.js";
import { SourcesController } from "./sources.controller.js";
import { SourcesService } from "./sources.service.js";

@Module({
  imports: [ProjectAccessModule, ProductAnalyticsModule],
  controllers: [SourcesController],
  providers: [SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}

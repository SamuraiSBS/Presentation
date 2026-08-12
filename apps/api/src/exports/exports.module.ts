import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { ProductAnalyticsModule } from "../analytics/product-analytics.module.js";
import { ExportsController } from "./exports.controller.js";
import { ExportsService } from "./exports.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "exports" }), ProjectAccessModule, ProductAnalyticsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}

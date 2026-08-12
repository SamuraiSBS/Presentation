import { Module } from "@nestjs/common";
import { ProductAnalyticsService } from "./product-analytics.service.js";

@Module({
  providers: [ProductAnalyticsService],
  exports: [ProductAnalyticsService],
})
export class ProductAnalyticsModule {}

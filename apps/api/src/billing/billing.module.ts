import { Module } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";
import { ProductAnalyticsModule } from "../analytics/product-analytics.module.js";

@Module({
  imports: [ProductAnalyticsModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}

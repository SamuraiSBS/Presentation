import { Module } from "@nestjs/common";
import { UsageModule } from "../usage/usage.module.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";

@Module({
  imports: [UsageModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

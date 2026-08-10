import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { HealthStorageService } from "./health-storage.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "generation" }, { name: "exports" }, { name: "admin-maintenance" })],
  controllers: [HealthController],
  providers: [HealthService, HealthStorageService],
})
export class HealthModule {}

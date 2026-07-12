import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProjectStorageModule } from "../storage/project-storage.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "generation" }), BullModule.registerQueue({ name: "exports" }), ProjectStorageModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}

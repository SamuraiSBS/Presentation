import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ExportsController } from "./exports.controller.js";
import { ExportsService } from "./exports.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "exports" })],
  controllers: [ExportsController],
  providers: [ExportsService],
})
export class ExportsModule {}

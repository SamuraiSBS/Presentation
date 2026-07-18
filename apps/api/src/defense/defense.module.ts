import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { DefenseController } from "./defense.controller.js";
import { DefenseService } from "./defense.service.js";

@Module({
  imports: [
    BullModule.registerQueue({ name: "generation" }, { name: "exports" }),
    ProjectAccessModule,
    SourcesModule,
    UsageModule,
  ],
  controllers: [DefenseController],
  providers: [DefenseService],
  exports: [DefenseService],
})
export class DefenseModule {}

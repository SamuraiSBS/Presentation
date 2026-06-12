import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ProjectsController } from "./projects.controller.js";
import { ProjectsService } from "./projects.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "generation" })],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

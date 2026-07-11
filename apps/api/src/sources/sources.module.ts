import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { SourcesController } from "./sources.controller.js";
import { SourcesService } from "./sources.service.js";

@Module({
  imports: [ProjectAccessModule],
  controllers: [SourcesController],
  providers: [SourcesService],
})
export class SourcesModule {}

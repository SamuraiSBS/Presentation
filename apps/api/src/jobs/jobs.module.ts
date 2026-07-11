import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { JobsController } from "./jobs.controller.js";

@Module({ imports: [ProjectAccessModule], controllers: [JobsController] })
export class JobsModule {}

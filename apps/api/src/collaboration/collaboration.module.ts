import { Module } from "@nestjs/common";
import { ProjectAccessModule } from "../access/project-access.module.js";
import { InvitationsController, ProjectCollaborationController } from "./collaboration.controller.js";
import { CollaborationService } from "./collaboration.service.js";

@Module({
  imports: [ProjectAccessModule],
  controllers: [ProjectCollaborationController, InvitationsController],
  providers: [CollaborationService],
})
export class CollaborationModule {}

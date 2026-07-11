import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { createProjectInvitationInputSchema, updateProjectMemberInputSchema } from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { parseInput } from "../errors/api-error.js";
import { CollaborationService } from "./collaboration.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("projects/:projectId")
export class ProjectCollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get("members")
  getMembers(@Req() request: InternalRequest, @Param("projectId") projectId: string) {
    return this.collaboration.getMembers(request.userId, projectId);
  }

  @Post("invitations")
  createInvitation(@Req() request: InternalRequest, @Param("projectId") projectId: string, @Body() body: unknown) {
    const input = parseInput(createProjectInvitationInputSchema, body);
    return this.collaboration.createInvitation(request.userId, projectId, input.role);
  }

  @Delete("invitations/:invitationId")
  revokeInvitation(
    @Req() request: InternalRequest,
    @Param("projectId") projectId: string,
    @Param("invitationId") invitationId: string,
  ) {
    return this.collaboration.revokeInvitation(request.userId, projectId, invitationId);
  }

  @Patch("members/:memberId")
  updateMember(
    @Req() request: InternalRequest,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
    @Body() body: unknown,
  ) {
    const input = parseInput(updateProjectMemberInputSchema, body);
    return this.collaboration.updateMember(request.userId, projectId, memberId, input.role);
  }

  @Delete("members/me")
  leaveProject(@Req() request: InternalRequest, @Param("projectId") projectId: string) {
    return this.collaboration.leaveProject(request.userId, projectId);
  }

  @Delete("members/:memberId")
  removeMember(
    @Req() request: InternalRequest,
    @Param("projectId") projectId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.collaboration.removeMember(request.userId, projectId, memberId);
  }
}

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("invitations")
export class InvitationsController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get(":token/preview")
  preview(@Param("token") token: string) {
    return this.collaboration.previewInvitation(token);
  }

  @Post(":token/accept")
  accept(@Req() request: InternalRequest, @Param("token") token: string) {
    return this.collaboration.acceptInvitation(request.userId, token);
  }
}

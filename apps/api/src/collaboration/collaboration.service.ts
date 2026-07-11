import crypto from "node:crypto";
import { HttpStatus, Injectable } from "@nestjs/common";
import type { ProjectMemberRole } from "@studydeck/shared";
import { ProjectAccessService } from "../access/project-access.service.js";
import { ApiError, forbidden, resourceNotFound } from "../errors/api-error.js";
import { PrismaService } from "../prisma/prisma.service.js";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class CollaborationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async getMembers(userId: string, projectId: string) {
    const access = await this.access.requireViewer(userId, projectId);
    const now = new Date();
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        user: { select: { id: true, name: true, image: true, telegramUsername: true } },
        members: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: { select: { id: true, name: true, image: true, telegramUsername: true } },
          },
        },
        invitations: access.role === "owner"
          ? {
              where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
              orderBy: { createdAt: "desc" },
              select: { id: true, role: true, createdAt: true, expiresAt: true },
            }
          : false,
      },
    });

    return {
      owner: project.user,
      members: project.members,
      ...(access.role === "owner" ? { invitations: project.invitations } : {}),
    };
  }

  async createInvitation(userId: string, projectId: string, role: ProjectMemberRole) {
    await this.access.requireOwner(userId, projectId);
    const inviteUrlToken = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const invitation = await this.prisma.projectInvitation.create({
      data: {
        projectId,
        role,
        createdById: userId,
        tokenHash: invitationHash(inviteUrlToken),
        expiresAt,
      },
      select: { id: true, role: true, expiresAt: true },
    });
    return { ...invitation, inviteUrlToken };
  }

  async revokeInvitation(userId: string, projectId: string, invitationId: string) {
    await this.access.requireOwner(userId, projectId);
    const revoked = await this.prisma.projectInvitation.updateMany({
      where: { id: invitationId, projectId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw resourceNotFound("Приглашение не найдено");
    return { id: invitationId, revoked: true };
  }

  async previewInvitation(token: string) {
    const invitation = await this.prisma.projectInvitation.findUnique({
      where: { tokenHash: invitationHash(token) },
      select: {
        role: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        project: {
          select: {
            id: true,
            title: true,
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
    });
    if (!invitation) throw invitationNotFound();
    return {
      status: invitationState(invitation),
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      projectId: invitation.project.id,
      projectTitle: invitation.project.title,
      owner: invitation.project.user,
    };
  }

  async acceptInvitation(userId: string, token: string) {
    const tokenHash = invitationHash(token);
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.projectInvitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          projectId: true,
          role: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
          project: { select: { userId: true } },
        },
      });
      if (!invitation) throw invitationNotFound();
      throwForInactiveInvitation(invitation);
      if (invitation.project.userId === userId) {
        throw forbidden("Владелец уже имеет доступ к своей презентации");
      }

      const now = new Date();
      const accepted = await tx.projectInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now, acceptedById: userId },
      });
      if (accepted.count === 0) {
        const current = await tx.projectInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
        throwForInactiveInvitation(current);
        throw invitationUsed();
      }

      await tx.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
      const member = await tx.projectMember.upsert({
        where: { projectId_userId: { projectId: invitation.projectId, userId } },
        create: { projectId: invitation.projectId, userId, role: invitation.role },
        update: { role: invitation.role },
        select: { id: true, role: true },
      });
      return { projectId: invitation.projectId, accessRole: member.role };
    });
  }

  async updateMember(userId: string, projectId: string, memberId: string, role: ProjectMemberRole) {
    const access = await this.access.requireOwner(userId, projectId);
    if (memberId === access.project.userId) throw forbidden("Нельзя изменить роль владельца");
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      select: { id: true, userId: true },
    });
    if (!member) throw resourceNotFound("Участник не найден");
    if (member.userId === access.project.userId) throw forbidden("Нельзя изменить роль владельца");
    return this.prisma.projectMember.update({
      where: { id: member.id },
      data: { role },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, image: true, telegramUsername: true } },
      },
    });
  }

  async removeMember(userId: string, projectId: string, memberId: string) {
    const access = await this.access.requireOwner(userId, projectId);
    if (memberId === access.project.userId) throw forbidden("Нельзя удалить владельца");
    const member = await this.prisma.projectMember.findFirst({
      where: { id: memberId, projectId },
      select: { id: true, userId: true },
    });
    if (!member) throw resourceNotFound("Участник не найден");
    if (member.userId === access.project.userId) throw forbidden("Нельзя удалить владельца");
    await this.prisma.projectMember.delete({ where: { id: member.id } });
    return { id: member.id, revoked: true };
  }

  async leaveProject(userId: string, projectId: string) {
    const access = await this.access.requireViewer(userId, projectId);
    if (access.role === "owner") throw forbidden("Владелец не может покинуть свою презентацию");
    await this.prisma.projectMember.delete({
      where: { projectId_userId: { projectId, userId } },
    });
    return { projectId, left: true };
  }
}

function invitationHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function invitationState(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (invitation.revokedAt) return "revoked" as const;
  if (invitation.acceptedAt) return "used" as const;
  if (invitation.expiresAt.getTime() <= Date.now()) return "expired" as const;
  return "active" as const;
}

function throwForInactiveInvitation(invitation: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }) {
  if (invitation.revokedAt) {
    throw new ApiError(HttpStatus.GONE, "INVITATION_REVOKED", "Приглашение отозвано");
  }
  if (invitation.acceptedAt) throw invitationUsed();
  if (invitation.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(HttpStatus.GONE, "INVITATION_EXPIRED", "Срок приглашения истёк");
  }
}

function invitationUsed() {
  return new ApiError(HttpStatus.CONFLICT, "INVITATION_USED", "Приглашение уже использовано");
}

function invitationNotFound() {
  return new ApiError(HttpStatus.NOT_FOUND, "INVITATION_NOT_FOUND", "Приглашение не найдено");
}

import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ProjectAccessService } from "../access/project-access.service.js";
import { resourceNotFound } from "../errors/api-error.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("jobs")
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  @Get(":id")
  async get(@Req() request: InternalRequest, @Param("id") id: string) {
    const job = await this.prisma.generationJob.findUnique({ where: { id } });
    if (!job) throw resourceNotFound("Задача не найдена");
    await this.access.requireViewer(request.userId, job.projectId);
    return job;
  }
}

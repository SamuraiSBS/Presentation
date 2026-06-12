import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@UseGuards(InternalAuthGuard)
@Controller("jobs")
export class JobsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(":id")
  async get(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.prisma.generationJob.findFirstOrThrow({
      where: { id, project: { userId: request.userId } },
    });
  }
}

import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { exportTypeSchema } from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { parseInput } from "../errors/api-error.js";
import { ExportsService } from "./exports.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("projects/:projectId/exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post()
  create(@Req() request: InternalRequest, @Param("projectId") projectId: string, @Body() body: { type?: string }) {
    return this.exportsService.enqueue(request.userId, projectId, parseInput(exportTypeSchema, body?.type || "pptx"));
  }

  @Get(":exportId")
  get(@Req() request: InternalRequest, @Param("projectId") projectId: string, @Param("exportId") exportId: string) {
    return this.exportsService.get(request.userId, projectId, exportId);
  }

  @Get(":exportId/download-url")
  getDownloadUrl(@Req() request: InternalRequest, @Param("projectId") projectId: string, @Param("exportId") exportId: string) {
    return this.exportsService.getDownloadUrl(request.userId, projectId, exportId);
  }
}

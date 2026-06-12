import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { exportTypeSchema } from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { ExportsService } from "./exports.service.js";

@UseGuards(InternalAuthGuard)
@Controller("projects/:projectId/exports")
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @Post()
  create(@Req() request: InternalRequest, @Param("projectId") projectId: string, @Body() body: { type?: string }) {
    return this.exportsService.enqueue(request.userId, projectId, exportTypeSchema.parse(body?.type || "pptx"));
  }

  @Get(":exportId")
  get(@Req() request: InternalRequest, @Param("exportId") exportId: string) {
    return this.exportsService.get(request.userId, exportId);
  }

  @Get(":exportId/download-url")
  getDownloadUrl(@Req() request: InternalRequest, @Param("exportId") exportId: string) {
    return this.exportsService.getDownloadUrl(request.userId, exportId);
  }
}

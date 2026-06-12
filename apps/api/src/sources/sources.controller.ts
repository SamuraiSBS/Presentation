import { Controller, Param, Post, Req, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { SourcesService } from "./sources.service.js";

@UseGuards(InternalAuthGuard)
@Controller("projects/:projectId/uploads")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Post()
  @UseInterceptors(FilesInterceptor("files", 8))
  upload(@Req() request: InternalRequest, @Param("projectId") projectId: string, @UploadedFiles() files: Express.Multer.File[]) {
    return this.sources.upload(request.userId, projectId, files || []);
  }
}

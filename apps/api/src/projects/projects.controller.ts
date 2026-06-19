import { Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createProjectInputSchema,
  generatePresentationInputSchema,
  updateNarrationInputSchema,
  updateSlideInputSchema,
} from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { ProjectsService } from "./projects.service.js";

@UseGuards(InternalAuthGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() request: InternalRequest) {
    return this.projects.list(request.userId);
  }

  @Post()
  create(@Req() request: InternalRequest, @Body() body: unknown) {
    return this.projects.create(request.userId, createProjectInputSchema.parse(body));
  }

  @Get(":id")
  get(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.getOwned(request.userId, id);
  }

  @Post(":id/narration")
  generateNarration(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.enqueueNarration(request.userId, id);
  }

  @Patch(":id/narration")
  updateNarration(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.updateNarrationDraft(request.userId, id, updateNarrationInputSchema.parse(body));
  }

  @Post(":id/generate")
  generate(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.enqueueGeneration(request.userId, id, generatePresentationInputSchema.parse(body || {}));
  }

  @Patch(":id/slides/:slideId")
  updateSlide(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("slideId") slideId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateSlide(request.userId, projectId, slideId, updateSlideInputSchema.parse(body));
  }

  @Post(":id/slides/:slideId/assets")
  @UseInterceptors(FileInterceptor("file"))
  uploadSlideAsset(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("slideId") slideId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.projects.uploadSlideAsset(request.userId, projectId, slideId, file);
  }

  @Get(":id/slides/:slideId/assets/:elementId")
  getSlideAsset(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("slideId") slideId: string,
    @Param("elementId") elementId: string,
  ) {
    return this.projects.getSlideAssetDownloadUrl(request.userId, projectId, slideId, elementId);
  }
}

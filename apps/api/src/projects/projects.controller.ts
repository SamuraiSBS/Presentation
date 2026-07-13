import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  createProjectInputSchema,
  duplicateProjectInputSchema,
  generatePresentationInputSchema,
  projectListQuerySchema,
  updateNarrationInputSchema,
  updateProjectMetadataInputSchema,
  updateSourceReviewInputSchema,
  updateSlideInputSchema,
} from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { parseInput } from "../errors/api-error.js";
import { ProjectsService } from "./projects.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() request: InternalRequest, @Query() query: unknown) {
    return this.projects.list(request.userId, parseInput(projectListQuerySchema, query));
  }

  @Post()
  create(@Req() request: InternalRequest, @Body() body: unknown) {
    return this.projects.create(request.userId, parseInput(createProjectInputSchema, body));
  }

  @Get(":id")
  get(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.getAccessible(request.userId, id);
  }

  @Patch(":id")
  updateMetadata(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.updateMetadata(request.userId, id, parseInput(updateProjectMetadataInputSchema, body));
  }

  @Post(":id/duplicate")
  duplicate(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.duplicate(request.userId, id, parseInput(duplicateProjectInputSchema, body || {}));
  }

  @Delete(":id")
  remove(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.remove(request.userId, id);
  }

  @Post(":id/narration")
  generateNarration(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.enqueueNarration(request.userId, id);
  }

  @Patch(":id/narration")
  updateNarration(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.updateNarrationDraft(request.userId, id, parseInput(updateNarrationInputSchema, body));
  }

  @Post(":id/generate")
  generate(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.projects.enqueueGeneration(request.userId, id, parseInput(generatePresentationInputSchema, body || {}));
  }

  @Patch(":id/sources/:sourceId")
  updateSourceReview(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("sourceId") sourceId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateSourceReview(
      request.userId,
      projectId,
      sourceId,
      parseInput(updateSourceReviewInputSchema, body),
    );
  }

  @Patch(":id/slides/:slideId")
  updateSlide(
    @Req() request: InternalRequest,
    @Param("id") projectId: string,
    @Param("slideId") slideId: string,
    @Body() body: unknown,
  ) {
    return this.projects.updateSlide(request.userId, projectId, slideId, parseInput(updateSlideInputSchema, body));
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

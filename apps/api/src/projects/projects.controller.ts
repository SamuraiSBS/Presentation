import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { createProjectInputSchema, updateSlideInputSchema } from "@studydeck/shared";
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

  @Post(":id/generate")
  generate(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.projects.enqueueGeneration(request.userId, id);
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
}

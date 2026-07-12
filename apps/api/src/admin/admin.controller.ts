import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { adminListQuerySchema, adminPlanOverrideSchema, adminReasonSchema } from "@studydeck/shared";
import { AdminAccessGuard } from "../auth/admin-access.guard.js";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { parseInput } from "../errors/api-error.js";
import { AdminService } from "./admin.service.js";

@UseGuards(InternalAuthGuard, AdminAccessGuard)
@Controller("admin")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview") overview(@Query() query: Record<string, string>) { return this.admin.overview(parseInput(adminListQuerySchema, query)); }
  @Get("users") users(@Query() query: Record<string, string>) { return this.admin.users(parseInput(adminListQuerySchema, query)); }
  @Get("users/:id") user(@Param("id") id: string) { return this.admin.user(id); }
  @Get("users/:id/activity") async activity(@Param("id") id: string) { return (await this.admin.user(id)).activity; }
  @Get("revenue") revenue(@Query() query: Record<string, string>) { return this.admin.revenue(parseInput(adminListQuerySchema, query)); }
  @Get("costs") costs(@Query() query: Record<string, string>) { return this.admin.costs(parseInput(adminListQuerySchema, query)); }
  @Get("generations") generations(@Query() query: Record<string, string>) { return this.admin.generations(parseInput(adminListQuerySchema, query)); }
  @Get("errors") errors(@Query() query: Record<string, string>) { return this.admin.events(parseInput(adminListQuerySchema, { ...query, status: "_errors" })); }
  @Get("logs") logs(@Query() query: Record<string, string>) { return this.admin.events(parseInput(adminListQuerySchema, query)); }
  @Get("audit") audit(@Query() query: Record<string, string>) { return this.admin.audit(parseInput(adminListQuerySchema, query)); }
  @Get("alerts") alerts() { return this.admin.alerts(); }

  @Post("users/:id/block") block(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) { return this.admin.block(request.userId, id, parseInput(adminReasonSchema, body).reason); }
  @Post("users/:id/unblock") unblock(@Req() request: InternalRequest, @Param("id") id: string) { return this.admin.unblock(request.userId, id); }
  @Put("users/:id/plan-override") setPlan(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) { return this.admin.setPlanOverride(request.userId, id, parseInput(adminPlanOverrideSchema, body)); }
  @Delete("users/:id/plan-override") clearPlan(@Req() request: InternalRequest, @Param("id") id: string) { return this.admin.clearPlanOverride(request.userId, id); }
  @Post("generations/:id/retry") retryGeneration(@Req() request: InternalRequest, @Param("id") id: string) { return this.admin.retryGeneration(request.userId, id); }
  @Post("generations/:id/cancel") cancelGeneration(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) { return this.admin.cancelGeneration(request.userId, id, parseInput(adminReasonSchema, body).reason); }
  @Post("exports/:id/retry") retryExport(@Req() request: InternalRequest, @Param("id") id: string) { return this.admin.retryExport(request.userId, id); }
  @Delete("projects/:id") deleteProject(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) { return this.admin.deleteProject(request.userId, id, parseInput(adminReasonSchema, body).reason); }
}

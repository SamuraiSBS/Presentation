import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { DashboardService } from "./dashboard.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@Req() request: InternalRequest) {
    return this.dashboard.get(request.userId);
  }
}

import { Body, Controller, Delete, Get, Req, UseGuards } from "@nestjs/common";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { UsersService } from "./users.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  getMe(@Req() request: InternalRequest) {
    return this.users.getMe(request.userId);
  }

  @Delete("me")
  removeMe(@Req() request: InternalRequest, @Body() body: { confirmation?: unknown; confirmed?: unknown } | undefined) {
    return this.users.removeMe(request.userId, body?.confirmation ?? body?.confirmed);
  }
}

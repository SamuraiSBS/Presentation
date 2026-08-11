import { Body, Controller, Delete, Get, Req, UseGuards } from "@nestjs/common";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { UsersService } from "./users.service.js";

@UseGuards(InternalAuthGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get("me")
  @UseGuards(BlockedUserGuard)
  getMe(@Req() request: InternalRequest) {
    return this.users.getMe(request.userId);
  }

  @Delete("me")
  removeMe(@Req() request: InternalRequest, @Body() body: { confirmation?: unknown; confirmed?: unknown } | undefined) {
    return this.users.removeMe(request.userId, body?.confirmation ?? body?.confirmed);
  }

  @Get("me/deletion")
  getDeletionStatus(@Req() request: InternalRequest) {
    return this.users.getDeletionStatus(request.userId);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { createFolderInputSchema, updateFolderInputSchema } from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { parseInput } from "../errors/api-error.js";
import { FoldersService } from "./folders.service.js";

@UseGuards(InternalAuthGuard, BlockedUserGuard)
@Controller("folders")
export class FoldersController {
  constructor(private readonly folders: FoldersService) {}

  @Get()
  list(@Req() request: InternalRequest) {
    return this.folders.list(request.userId);
  }

  @Post()
  create(@Req() request: InternalRequest, @Body() body: unknown) {
    return this.folders.create(request.userId, parseInput(createFolderInputSchema, body));
  }

  @Patch(":id")
  update(@Req() request: InternalRequest, @Param("id") id: string, @Body() body: unknown) {
    return this.folders.update(request.userId, id, parseInput(updateFolderInputSchema, body));
  }

  @Delete(":id")
  remove(@Req() request: InternalRequest, @Param("id") id: string) {
    return this.folders.remove(request.userId, id);
  }
}

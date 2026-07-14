import { Module } from "@nestjs/common";
import { ProjectStorageModule } from "../storage/project-storage.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [ProjectStorageModule, UsageModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}

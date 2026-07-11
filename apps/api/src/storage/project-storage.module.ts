import { Module } from "@nestjs/common";
import { ProjectStorageService } from "./project-storage.service.js";

@Module({
  providers: [ProjectStorageService],
  exports: [ProjectStorageService],
})
export class ProjectStorageModule {}

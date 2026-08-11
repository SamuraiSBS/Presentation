import { Global, Module } from "@nestjs/common";
import { ApiRateLimitGuard } from "./api-rate-limit.guard.js";
import { MalwareScanService } from "./malware-scan.service.js";

@Global()
@Module({
  providers: [ApiRateLimitGuard, MalwareScanService],
  exports: [ApiRateLimitGuard, MalwareScanService],
})
export class SecurityModule {}

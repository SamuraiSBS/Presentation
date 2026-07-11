import { Global, Module } from "@nestjs/common";
import { BlockedUserGuard } from "./blocked-user.guard.js";
import { InternalAuthGuard } from "./internal-auth.guard.js";

@Global()
@Module({
  providers: [InternalAuthGuard, BlockedUserGuard],
  exports: [InternalAuthGuard, BlockedUserGuard],
})
export class AuthModule {}

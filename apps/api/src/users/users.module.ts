import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BillingModule } from "../billing/billing.module.js";
import { UsageModule } from "../usage/usage.module.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  imports: [BullModule.registerQueue({ name: "admin-maintenance" }), BillingModule, UsageModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}

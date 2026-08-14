import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { paidPlanCodes, type PaidPlanCode } from "@studydeck/shared";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { BillingService } from "./billing.service.js";

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("yookassa/webhook")
  yooKassaWebhook(@Body() body: unknown, @Req() _request: Request) {
    return this.billing.handleYooKassaWebhook(body);
  }

  @UseGuards(InternalAuthGuard, BlockedUserGuard)
  @Post("checkout")
  createCheckout(@Req() request: InternalRequest, @Body() body: { plan?: PaidPlanCode; idempotencyKey?: string }) {
    const plan = body?.plan;
    if (!plan || !(paidPlanCodes as readonly string[]).includes(plan)) {
      throw new BadRequestException("Недоступный тариф");
    }
    return this.billing.createCheckoutSession(request.userId, plan, body?.idempotencyKey);
  }

  @UseGuards(InternalAuthGuard, BlockedUserGuard)
  @Post("portal")
  createPortal(@Req() request: InternalRequest) {
    return this.billing.createPortalSession(request.userId);
  }
}

import { Body, Controller, Headers, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { InternalAuthGuard, type InternalRequest } from "../auth/internal-auth.guard.js";
import { BlockedUserGuard } from "../auth/blocked-user.guard.js";
import { BillingService } from "./billing.service.js";

@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("stripe/webhook")
  stripeWebhook(@Req() request: Request, @Headers("stripe-signature") signature?: string) {
    return this.billing.handleStripeWebhook((request as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(""), signature || "");
  }

  @UseGuards(InternalAuthGuard, BlockedUserGuard)
  @Post("checkout")
  createCheckout(@Req() request: InternalRequest, @Body() body: { plan?: "student" | "pro" }) {
    return this.billing.createCheckoutSession(request.userId, body?.plan || "student");
  }
}

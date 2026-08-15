import { z } from "zod";
export const planCodeSchema = z.enum(["free", "student", "plus", "pro"]);
export type PlanCode = z.infer<typeof planCodeSchema>;

export const planLimits = {
  free: {
    generationLimit: 3,
    reset: "month",
    allowedSlideCounts: [6],
    maxSlides: 6,
    maxProjectBytes: 50 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
  student: {
    generationLimit: 4,
    reset: "week",
    allowedSlideCounts: [6, 8, 10],
    maxSlides: 10,
    maxProjectBytes: 100 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
  plus: {
    generationLimit: 10,
    reset: "week",
    allowedSlideCounts: [6, 8, 10, 12],
    maxSlides: 12,
    maxProjectBytes: 150 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
  pro: {
    generationLimit: 15,
    reset: "week",
    allowedSlideCounts: [6, 8, 10, 12, 14],
    maxSlides: 14,
    maxProjectBytes: 250 * 1024 * 1024,
    exports: ["pdf", "pptx"],
  },
} as const;

export const paidPlanCodes = ["student", "plus", "pro"] as const;
export type PaidPlanCode = (typeof paidPlanCodes)[number];

export const planPricesRub: Record<PaidPlanCode, number> = {
  student: 590,
  plus: 1290,
  pro: 1999,
};

export const planRank: Record<PlanCode, number> = {
  free: 0,
  student: 1,
  plus: 2,
  pro: 3,
};

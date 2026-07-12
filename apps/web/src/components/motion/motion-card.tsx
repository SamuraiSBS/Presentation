"use client";

import { motion } from "motion/react";
import { fadeSlideVariants } from "@/components/motion/motion-presets";
import { cn } from "@/lib/utils";

export function MotionCard({
  children,
  className,
  as = "div",
  layout = false,
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "article" | "section";
  layout?: boolean;
}) {
  const shared = {
    className: cn("motion-card", className),
    layout: layout ? "position" as const : false as const,
    variants: fadeSlideVariants,
    initial: "hidden" as const,
    animate: "visible" as const,
  };
  if (as === "article") return <motion.article {...shared}>{children}</motion.article>;
  if (as === "section") return <motion.section {...shared}>{children}</motion.section>;
  return <motion.div {...shared}>{children}</motion.div>;
}

"use client";

import { motion } from "motion/react";
import { listItemVariants } from "@/components/motion/motion-presets";
import { cn } from "@/lib/utils";

type MotionListProps = {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section";
  "aria-label"?: string;
};

export function MotionList({ children, className, as = "div", ...props }: MotionListProps) {
  const shared = { className, initial: "hidden", animate: "visible", ...props } as const;
  if (as === "section") return <motion.section {...shared}>{children}</motion.section>;
  return <motion.div {...shared}>{children}</motion.div>;
}

export function MotionListItem({
  children,
  className,
  index = 0,
  layout = false,
}: {
  children: React.ReactNode;
  className?: string;
  index?: number;
  layout?: boolean;
}) {
  return (
    <motion.div
      className={cn(className)}
      custom={index}
      variants={listItemVariants}
      layout={layout ? "position" : false}
    >
      {children}
    </motion.div>
  );
}


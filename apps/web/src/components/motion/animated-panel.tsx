"use client";

import { AnimatePresence, motion } from "motion/react";
import { panelVariants } from "@/components/motion/motion-presets";
import { cn } from "@/lib/utils";

export function AnimatedPanel({
  present,
  children,
  className,
  panelKey = "panel",
}: {
  present: boolean;
  children: React.ReactNode;
  className?: string;
  panelKey?: React.Key;
}) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {present ? (
        <motion.div
          key={panelKey}
          className={cn(className)}
          variants={panelVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          layout="position"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}


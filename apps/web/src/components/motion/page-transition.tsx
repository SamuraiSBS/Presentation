"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { motionEase, motionDuration } from "@/components/motion/motion-presets";

export function PageTransition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const firstRender = useRef(true);
  const isFirstRender = firstRender.current;

  useEffect(() => {
    firstRender.current = false;
  }, []);

  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div
        key={routeKey}
        className="motion-page"
        initial={isFirstRender ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: isFirstRender ? motionDuration.page : motionDuration.pageReturn,
          ease: motionEase,
        }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

import type { Transition, Variants } from "motion/react";

export const motionDuration = {
  control: 0.14,
  surface: 0.2,
  page: 0.3,
  pageReturn: 0.18,
  slide: 0.2,
} as const;

export const motionEase = [0.22, 1, 0.36, 1] as const;

export const transitions = {
  control: { duration: motionDuration.control, ease: motionEase },
  surface: { duration: motionDuration.surface, ease: motionEase },
  page: { duration: motionDuration.page, ease: motionEase },
  pageReturn: { duration: motionDuration.pageReturn, ease: motionEase },
  exit: { duration: 0.12, ease: motionEase },
} satisfies Record<string, Transition>;

export const fadeSlideVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.surface },
  exit: { opacity: 0, transition: transitions.exit },
} satisfies Variants;

export const panelVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: transitions.surface },
  exit: { opacity: 0, y: 6, transition: transitions.exit },
} satisfies Variants;

export const menuVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: { opacity: 1, scale: 1, transition: transitions.control },
  exit: { opacity: 0, scale: 0.99, transition: transitions.exit },
} satisfies Variants;

export const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  visible: (index = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitions.surface, delay: index < 8 ? index * 0.035 : 0 },
  }),
  exit: { opacity: 0, y: -4, transition: transitions.exit },
} satisfies Variants;


"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@studydeck/auth/react";
import { captureProductAnalytics, identifyProductAnalytics } from "@studydeck/shared";

const anonymousIdKey = "studydeck.analytics.anonymous_id";

function anonymousId() {
  try {
    const existing = window.localStorage.getItem(anonymousIdKey);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(anonymousIdKey, created);
    return created;
  } catch {
    return "anonymous-browser";
  }
}

/** Page-level events only; mutation outcomes are captured on trusted servers. */
export function ProductAnalyticsPageView() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) return;
    void identifyProductAnalytics({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      anonymousId: anonymousId(),
      distinctId: userId,
    });
  }, [userId]);

  useEffect(() => {
    const event = pathname === "/"
      ? "landing_viewed"
      : /^\/projects\/[^/]+\/editor$/.test(pathname)
        ? "editor_opened"
        : null;
    if (!event) return;

    void captureProductAnalytics({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      distinctId: userId || anonymousId(),
      event,
    });
  }, [pathname, userId]);

  return null;
}

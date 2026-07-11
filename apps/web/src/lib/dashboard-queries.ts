"use client";

import { useQuery } from "@tanstack/react-query";
import type { DashboardSummary, ProfileSummary } from "@/lib/account-types";
import { apiJson } from "@/lib/project-queries";

export const dashboardKeys = {
  all: ["dashboard"] as const,
  profile: ["profile"] as const,
};

export function useDashboard(initialData?: DashboardSummary) {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => apiJson<DashboardSummary>("/api/dashboard"),
    initialData,
    refetchInterval: (query) => query.state.data?.activeProjects.length ? 3000 : false,
  });
}

export function useProfile(initialData?: ProfileSummary) {
  return useQuery({
    queryKey: dashboardKeys.profile,
    queryFn: () => apiJson<ProfileSummary>("/api/users/me"),
    initialData,
  });
}

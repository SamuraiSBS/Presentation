"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminOverview, AdminUserDetail, AdminUsersResponse } from "@studydeck/shared";

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Не удалось загрузить данные админки");
  return data as T;
}

export function useAdminOverview(search: string) {
  return useQuery({ queryKey: ["admin", "overview", search], queryFn: () => adminFetch<AdminOverview>(`overview${search}`), refetchInterval: 60_000 });
}

export function useAdminUsers(search: string) {
  return useQuery({ queryKey: ["admin", "users", search], queryFn: () => adminFetch<AdminUsersResponse>(`users${search}`) });
}

export function useAdminUser(id: string) {
  return useQuery({ queryKey: ["admin", "user", id], queryFn: () => adminFetch<AdminUserDetail>(`users/${id}`) });
}

export function useAdminSection(section: string, search: string) {
  return useQuery({ queryKey: ["admin", section, search], queryFn: () => adminFetch<Record<string, unknown>>(`${section}${search}`), refetchInterval: section === "errors" || section === "logs" ? 30_000 : false });
}

export function useAdminAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method = "POST", body }: { path: string; method?: string; body?: unknown }) => adminFetch<{ ok: true; message: string }>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["admin"] }); },
  });
}

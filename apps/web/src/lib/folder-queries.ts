"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FolderColor, FolderSummary } from "@/lib/account-types";
import { apiJson, projectKeys } from "@/lib/project-queries";

export const folderKeys = { all: ["folders"] as const };

export function useFolders(initialData?: FolderSummary[]) {
  return useQuery({
    queryKey: folderKeys.all,
    queryFn: async () => (await apiJson<{ items: FolderSummary[] }>("/api/folders")).items,
    initialData,
  });
}

export function useCreateFolder() {
  return useFolderMutation((payload: { name: string; color: FolderColor }) =>
    apiJson<FolderSummary>("/api/folders", jsonInit("POST", payload)),
  );
}

export function useUpdateFolder(folderId: string) {
  return useFolderMutation((payload: { name?: string; color?: FolderColor; sortOrder?: number }) =>
    apiJson<FolderSummary>(`/api/folders/${folderId}`, jsonInit("PATCH", payload)),
  );
}

export function useDeleteFolder(folderId: string) {
  return useFolderMutation(() => apiJson<unknown>(`/api/folders/${folderId}`, { method: "DELETE" }));
}

function useFolderMutation<TVariables, TResult>(mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: folderKeys.all });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

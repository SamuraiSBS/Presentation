"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type ExportItem = {
  id: string;
  type: string;
  status: string;
  objectKey?: string | null;
  error?: string | null;
};

export type ProjectPayload = {
  id: string;
  title: string;
  status: string;
  error?: string | null;
  speechDraft?: string | null;
  exports?: ExportItem[];
  presentation?: unknown;
  slideCount?: number;
  updatedAt?: string;
};

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  detail: (projectId: string) => [...projectKeys.all, "detail", projectId] as const,
  export: (projectId: string, exportId: string) => [...projectKeys.detail(projectId), "exports", exportId] as const,
};

const activeProjectStatuses = new Set(["uploading", "script_queued", "script_generating", "queued", "generating"]);
const activeExportStatuses = new Set(["queued", "processing"]);

export function isActiveProjectStatus(status: string | undefined) {
  return Boolean(status && activeProjectStatuses.has(status));
}

export function isActiveExportStatus(status: string | undefined) {
  return Boolean(status && activeExportStatuses.has(status));
}

export function useProjects(initialData?: ProjectPayload[]) {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: () => apiJson<ProjectPayload[]>("/api/projects"),
    initialData,
  });
}

export function useProject(projectId: string, initialData?: ProjectPayload) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => apiJson<ProjectPayload>(`/api/projects/${projectId}`),
    initialData,
    refetchInterval: (query) => (isActiveProjectStatus(query.state.data?.status) ? 2500 : false),
  });
}

export function useGenerationJob(projectId: string, initialData?: ProjectPayload) {
  return useProject(projectId, initialData);
}

export function useExportJob(projectId: string, exportId: string | undefined) {
  return useQuery({
    queryKey: exportId ? projectKeys.export(projectId, exportId) : [...projectKeys.detail(projectId), "exports", "missing"],
    queryFn: () => apiJson<ExportItem>(`/api/projects/${projectId}/exports/${exportId}`),
    enabled: Boolean(exportId),
    refetchInterval: (query) => (isActiveExportStatus(query.state.data?.status) ? 1500 : false),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: unknown) =>
      apiJson<ProjectPayload>("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

export function useStartNarration(projectId: string) {
  return useProjectMutation(projectId, () =>
    apiJson<ProjectPayload>(`/api/projects/${projectId}/narration`, { method: "POST" }),
  );
}

export function useSaveSpeechDraft(projectId: string) {
  return useProjectMutation(projectId, (speechDraft: string) =>
    apiJson<ProjectPayload>(`/api/projects/${projectId}/narration`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speechDraft }),
    }),
  );
}

export function useAcceptSpeechAndGenerate(projectId: string) {
  return useProjectMutation(projectId, (speechDraft: string) =>
    apiJson<ProjectPayload>(`/api/projects/${projectId}/narration`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speechDraft, accept: true }),
    }),
  );
}

export function useStartGeneration(projectId: string) {
  return useProjectMutation(projectId, (payload: unknown = {}) =>
    apiJson<ProjectPayload>(`/api/projects/${projectId}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export function useRequestExport(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (type: "pptx" | "pdf" = "pptx") =>
      apiJson<ExportItem>(`/api/projects/${projectId}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type }),
      }),
    onSuccess: (created) => {
      queryClient.setQueryData(projectKeys.export(projectId, created.id), created);
      queryClient.setQueryData<ProjectPayload | undefined>(projectKeys.detail(projectId), (current) =>
        current ? { ...current, exports: [created, ...(current.exports || [])] } : current,
      );
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });
}

export function useSavePresentationEdits(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ slideId, payload }: { slideId: string; payload: unknown }) =>
      apiJson<ProjectPayload>(`/api/projects/${projectId}/slides/${slideId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project);
    },
  });
}

function useProjectMutation<TVariables>(
  projectId: string,
  mutationFn: (variables: TVariables) => Promise<ProjectPayload>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

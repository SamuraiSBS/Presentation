"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateExportInput, ExportType } from "@studydeck/shared";
import type {
  ExportSummary,
  ProjectDetail,
  ProjectListResponse,
} from "@/lib/account-types";

export type ExportItem = ExportSummary;
export type ProjectPayload = ProjectDetail;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export const projectKeys = {
  all: ["projects"] as const,
  lists: () => [...projectKeys.all, "list"] as const,
  list: (query: string) => [...projectKeys.lists(), query] as const,
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

export function useProjectList(query: URLSearchParams, initialData?: ProjectListResponse) {
  const normalized = normalizedQuery(query);
  return useInfiniteQuery({
    queryKey: projectKeys.list(normalized),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(normalized);
      if (pageParam) params.set("cursor", pageParam);
      return apiJson<ProjectListResponse>(`/api/projects?${params.toString()}`);
    },
    initialPageParam: "" as string,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    initialData: initialData
      ? { pages: [initialData], pageParams: [""] }
      : undefined,
  });
}

// Compatibility for the old dashboard list while callers migrate to /dashboard.
export function useProjects(initialData?: ProjectDetail[]) {
  return useQuery({
    queryKey: projectKeys.list("limit=24"),
    queryFn: async () => (await apiJson<ProjectListResponse>("/api/projects?limit=24")).items as unknown as ProjectDetail[],
    initialData,
  });
}

export function useProject(projectId: string, initialData?: ProjectDetail) {
  return useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => apiJson<ProjectDetail>(`/api/projects/${projectId}`),
    initialData,
    refetchInterval: (query) => (isActiveProjectStatus(query.state.data?.status) ? 2500 : false),
  });
}

export function useGenerationJob(projectId: string, initialData?: ProjectDetail) {
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
    mutationFn: (payload: unknown) => apiJson<ProjectDetail>("/api/projects", jsonInit("POST", payload)),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      invalidateAccountLists(queryClient);
    },
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title?: string; folderId?: string | null }) =>
      apiJson<ProjectDetail>(`/api/projects/${projectId}`, jsonInit("PATCH", payload)),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      invalidateAccountLists(queryClient);
    },
  });
}

export function useDuplicateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { title?: string; folderId?: string | null } = {}) =>
      apiJson<ProjectDetail>(`/api/projects/${projectId}/duplicate`, jsonInit("POST", payload)),
    onSuccess: () => invalidateAccountLists(queryClient),
  });
}

export function useDeleteProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<unknown>(`/api/projects/${projectId}`, { method: "DELETE" }),
    onSuccess: () => invalidateAccountLists(queryClient),
  });
}

export function useStartNarration(projectId: string) {
  return useProjectMutation(projectId, () => apiJson<ProjectDetail>(`/api/projects/${projectId}/narration`, { method: "POST" }));
}

export function useSaveSpeechDraft(projectId: string) {
  return useProjectMutation(projectId, (speechDraft: string) =>
    apiJson<ProjectDetail>(`/api/projects/${projectId}/narration`, jsonInit("PATCH", { speechDraft })),
  );
}

export function useAcceptSpeechAndGenerate(projectId: string) {
  return useProjectMutation(projectId, (speechDraft: string) =>
    apiJson<ProjectDetail>(`/api/projects/${projectId}/narration`, jsonInit("PATCH", { speechDraft, accept: true })),
  );
}

export function useUpdateSourceReview(projectId: string) {
  return useProjectMutation(projectId, ({ sourceId, included }: { sourceId: string; included: boolean }) =>
    apiJson<ProjectDetail>(
      `/api/projects/${projectId}/sources/${sourceId}`,
      jsonInit("PATCH", { included }),
    ),
  );
}

export function useStartGeneration(projectId: string) {
  return useProjectMutation(projectId, (payload: unknown = {}) =>
    apiJson<ProjectDetail>(`/api/projects/${projectId}/generate`, jsonInit("POST", payload)),
  );
}

export function useRequestExport(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ExportType | CreateExportInput = "pptx") =>
      apiJson<ExportItem>(`/api/projects/${projectId}/exports`, jsonInit("POST", typeof input === "string" ? { type: input } : input)),
    onSuccess: (created) => {
      queryClient.setQueryData(projectKeys.export(projectId, created.id), created);
      queryClient.setQueryData<ProjectDetail | undefined>(projectKeys.detail(projectId), (current) =>
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
      apiJson<ProjectDetail>(`/api/projects/${projectId}/slides/${slideId}`, jsonInit("PATCH", payload)),
    onSuccess: (project) => queryClient.setQueryData(projectKeys.detail(projectId), project),
  });
}

function useProjectMutation<TVariables>(projectId: string, mutationFn: (variables: TVariables) => Promise<ProjectDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(projectId), project);
      invalidateAccountLists(queryClient);
    },
  });
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    throw new ApiClientError(
      response.status,
      typeof value.code === "string" ? value.code : "REQUEST_FAILED",
      typeof value.message === "string" ? value.message : "Не удалось выполнить действие",
      value.details && typeof value.details === "object" ? value.details as Record<string, unknown> : undefined,
    );
  }
  return payload as T;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

function normalizedQuery(query: URLSearchParams) {
  const normalized = new URLSearchParams(query);
  normalized.delete("cursor");
  if (!normalized.has("limit")) normalized.set("limit", "24");
  normalized.sort();
  return normalized.toString();
}

function invalidateAccountLists(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  void queryClient.invalidateQueries({ queryKey: ["folders"] });
}

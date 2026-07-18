"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ComplianceReportSummary,
  ComplianceReport,
  ConfirmDefensePlanInput,
  DefensePlan,
  DefenseWorkspace,
  ProjectAccessRole,
  ProjectConflict,
  ProjectFact,
  ProjectRequirement,
  PatchDefenseConfigInput,
  RebuildDefensePlanInput,
  ResolveConflictInput,
  Source,
  StartComplianceCheckInput,
  UpdateDefenseAssetInput,
  UpdateFactInput,
  UpdateRequirementInput,
} from "@studydeck/shared";
import { apiJson } from "@/lib/project-queries";

export type DefenseSource = Source & { status?: string };

export type DefenseComplianceReport = ComplianceReportSummary;

export type DefenseCompliancePdfRequest = {
  report: ComplianceReport;
  queueJobId?: string | null;
};

export type DefenseWorkspacePayload = {
  workspace: DefenseWorkspace;
  sources: DefenseSource[];
  facts: ProjectFact[];
  requirements: ProjectRequirement[];
  conflicts: ProjectConflict[];
  reports: DefenseComplianceReport[];
  presentationRevision: number;
  accessRole: ProjectAccessRole;
};

export const defenseKeys = {
  workspace: (projectId: string) => ["projects", "detail", projectId, "defense"] as const,
};

export function useDefenseWorkspace(projectId: string, initialData?: DefenseWorkspacePayload, enabled = true) {
  return useQuery({
    queryKey: defenseKeys.workspace(projectId),
    queryFn: () => apiJson<DefenseWorkspacePayload>(`/api/projects/${projectId}/defense`),
    initialData,
    enabled: enabled && Boolean(projectId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      if (["queued", "analyzing"].includes(data.workspace.analysisStatus)) return 2200;
      return data.reports.some((report) => ["queued", "processing"].includes(report.status)) ? 2200 : false;
    },
  });
}

export function usePatchDefenseConfig(projectId: string) {
  return useDefenseMutation(projectId, (payload: PatchDefenseConfigInput) => apiJson<DefenseWorkspacePayload>(`/api/projects/${projectId}/defense/config`, json("PATCH", payload)));
}

export function useStartDefenseAnalysis(projectId: string) {
  return useDefenseMutation(projectId, () => apiJson(`/api/projects/${projectId}/defense/analyze`, json("POST", { confirmCost: true })));
}

export function useCreateDefenseFact(projectId: string) {
  return useDefenseMutation(projectId, (statement: string) => apiJson(`/api/projects/${projectId}/defense/facts`, json("POST", {
    statement,
    evidence: [{ confirmation: "user" }],
  })));
}

export function useUpdateDefenseFact(projectId: string) {
  return useDefenseMutation(projectId, ({ factId, patch }: { factId: string; patch: UpdateFactInput }) =>
    apiJson(`/api/projects/${projectId}/defense/facts/${encodeURIComponent(factId)}`, json("PATCH", patch)));
}

export function useDeleteDefenseFact(projectId: string) {
  return useDefenseMutation(projectId, (factId: string) =>
    apiJson(`/api/projects/${projectId}/defense/facts/${encodeURIComponent(factId)}`, { method: "DELETE" }));
}

export function useUpdateDefenseRequirement(projectId: string) {
  return useDefenseMutation(projectId, ({ requirementId, patch }: { requirementId: string; patch: UpdateRequirementInput }) =>
    apiJson(`/api/projects/${projectId}/defense/requirements/${encodeURIComponent(requirementId)}`, json("PATCH", patch)));
}

export function useUpdateDefenseAsset(projectId: string) {
  return useDefenseMutation(projectId, ({ sourceId, patch }: { sourceId: string; patch: UpdateDefenseAssetInput }) =>
    apiJson(`/api/projects/${projectId}/defense/assets/${encodeURIComponent(sourceId)}`, json("PATCH", patch)));
}

export function useResolveDefenseConflict(projectId: string) {
  return useDefenseMutation(projectId, ({ conflictId, input }: { conflictId: string; input: ResolveConflictInput }) =>
    apiJson(`/api/projects/${projectId}/defense/conflicts/${encodeURIComponent(conflictId)}/resolve`, json("POST", input)));
}

export function useSaveDefensePlan(projectId: string) {
  return useDefenseMutation(projectId, ({ plan, expectedPlanRevision }: { plan: DefensePlan; expectedPlanRevision: number }) =>
    apiJson(`/api/projects/${projectId}/defense/plan`, json("PUT", { plan, expectedPlanRevision })));
}

export function useRebuildDefensePlan(projectId: string) {
  return useDefenseMutation(projectId, (input: RebuildDefensePlanInput) => apiJson(`/api/projects/${projectId}/defense/plan/rebuild`, json("POST", input)));
}

export function useConfirmDefensePlan(projectId: string) {
  return useDefenseMutation(projectId, (input: ConfirmDefensePlanInput) => apiJson(`/api/projects/${projectId}/defense/plan/confirm`, json("POST", input)));
}

export function useStartComplianceCheck(projectId: string) {
  return useDefenseMutation(projectId, (input: StartComplianceCheckInput) =>
    apiJson(`/api/projects/${projectId}/defense/compliance-checks`, json("POST", input)));
}

export function useRequestCompliancePdf(projectId: string) {
  return useDefenseMutation(projectId, ({ reportId, expectedPresentationRevision }: { reportId: string; expectedPresentationRevision: number }) =>
    apiJson<DefenseCompliancePdfRequest>(`/api/projects/${projectId}/defense/compliance-reports/${encodeURIComponent(reportId)}/pdf`, json("POST", { expectedPresentationRevision })));
}

function useDefenseMutation<TVariables, TResult = unknown>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: defenseKeys.workspace(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["projects", "detail", projectId] });
    },
  });
}

function json(method: string, payload: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) };
}

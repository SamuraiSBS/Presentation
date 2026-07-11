"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  InvitationPreview,
  ProjectDetail,
  ProjectMemberRole,
  ProjectMembersResponse,
} from "@/lib/account-types";
import { apiJson, projectKeys } from "@/lib/project-queries";

export const collaborationKeys = {
  members: (projectId: string) => [...projectKeys.detail(projectId), "members"] as const,
  invitation: (token: string) => ["invitations", token] as const,
};

export function useProjectMembers(projectId: string, enabled = true) {
  return useQuery({
    queryKey: collaborationKeys.members(projectId),
    queryFn: () => apiJson<ProjectMembersResponse>(`/api/projects/${projectId}/members`),
    enabled,
  });
}

export function useCreateInvitation(projectId: string) {
  return useCollaborationMutation(projectId, (role: ProjectMemberRole) =>
    apiJson<{ inviteUrlToken: string; expiresAt: string }>(
      `/api/projects/${projectId}/invitations`,
      jsonInit("POST", { role }),
    ),
  );
}

export function useRevokeInvitation(projectId: string) {
  return useCollaborationMutation(projectId, (invitationId: string) =>
    apiJson<unknown>(`/api/projects/${projectId}/invitations/${invitationId}`, { method: "DELETE" }),
  );
}

export function useUpdateMember(projectId: string) {
  return useCollaborationMutation(projectId, ({ memberId, role }: { memberId: string; role: ProjectMemberRole }) =>
    apiJson<unknown>(`/api/projects/${projectId}/members/${memberId}`, jsonInit("PATCH", { role })),
  );
}

export function useRemoveMember(projectId: string) {
  return useCollaborationMutation(projectId, (memberId: string) =>
    apiJson<unknown>(`/api/projects/${projectId}/members/${memberId}`, { method: "DELETE" }),
  );
}

export function useLeaveProject(projectId: string) {
  return useCollaborationMutation(projectId, () =>
    apiJson<unknown>(`/api/projects/${projectId}/members/me`, { method: "DELETE" }),
  );
}

export function useInvitationPreview(token: string, initialData?: InvitationPreview) {
  return useQuery({
    queryKey: collaborationKeys.invitation(token),
    queryFn: () => apiJson<InvitationPreview>(`/api/invitations/${encodeURIComponent(token)}/preview`),
    initialData,
  });
}

export function useAcceptInvitation(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiJson<{ projectId: string }>(`/api/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(result.projectId) });
    },
  });
}

function useCollaborationMutation<TVariables, TResult>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: collaborationKeys.members(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

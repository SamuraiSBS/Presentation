import type {
  DashboardSummary as SharedDashboardSummary,
  FolderColor,
  FolderSummary as SharedFolderSummary,
  PlanCode,
  PresentationDocument,
  ProjectAccessRole,
  ProjectMember as SharedProjectMember,
  ProjectMemberRole,
  ProjectStatus,
  ProjectSummary,
  ProjectWorkflow,
  Source,
  UsageSummary as SharedUsageSummary,
  UserIdentitySummary,
} from "@studydeck/shared";

export type { FolderColor, ProjectAccessRole, ProjectMemberRole, ProjectSummary };

export type UsageSummary = SharedUsageSummary & { canCreate?: boolean };
export type UserSummary = UserIdentitySummary;

export type ExportSummary = {
  id: string;
  type: "pdf" | "pptx" | string;
  status: string;
  objectKey?: string | null;
  error?: string | null;
  presentationRevision?: number;
};

export type FolderSummary = SharedFolderSummary & {
  scope: "mine" | "shared";
};

export type ProjectListResponse = {
  items: ProjectSummary[];
  nextCursor: string | null;
  usage: UsageSummary;
};

export type ProjectDetail = {
  id: string;
  title: string;
  status: ProjectStatus;
  error?: string | null;
  speechDraft?: string | null;
  prompt?: string;
  mode?: string;
  workflow?: ProjectWorkflow;
  level?: string;
  sources?: Source[];
  exports?: ExportSummary[];
  presentation?: { document: PresentationDocument } | null;
  slideCount?: number;
  updatedAt?: string;
  accessRole: ProjectAccessRole;
  presentationRevision: number;
  owner?: UserSummary;
  folder?: Pick<FolderSummary, "id" | "name" | "color"> | null;
};

export type DashboardSummary = Omit<SharedDashboardSummary, "usage"> & { usage: UsageSummary };

export type ProfileSummary = UserSummary & {
  telegramUsername: string | null;
  telegramId?: string | null;
  createdAt: string;
  planCode: PlanCode;
  usage: UsageSummary;
};

export type ProjectMember = SharedProjectMember;

export type ProjectInvitation = {
  id: string;
  role: ProjectMemberRole;
  expiresAt: string;
  createdAt?: string;
  status?: string;
};

export type ProjectMembersResponse = {
  members: ProjectMember[];
  invitations?: ProjectInvitation[];
};

export type InvitationPreview = {
  projectId?: string;
  projectTitle: string;
  owner: UserSummary;
  role: ProjectMemberRole;
  expiresAt?: string;
  status?: "active" | "expired" | "used" | "revoked";
};

export function canCreateProject(usage: UsageSummary) {
  return usage.canCreate ?? (!usage.exhausted && usage.used < usage.limit);
}

export type ProjectAccessRole = "owner" | "editor" | "viewer";

export type ProjectAccess = {
  project: {
    id: string;
    userId: string;
  };
  role: ProjectAccessRole;
};

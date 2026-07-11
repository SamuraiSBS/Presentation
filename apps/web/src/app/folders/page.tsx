import { FoldersManager } from "@/components/folders/folders-manager";
import type { FolderSummary } from "@/lib/account-types";
import { internalFetch } from "@/lib/internal-api";

export const dynamic = "force-dynamic";

export default async function FoldersPage() {
  const response = await internalFetch<{ items: FolderSummary[] }>("/folders");
  return <FoldersManager initialFolders={response.items} />;
}

import { AdminShell } from "@/components/admin/admin-shell";
import { requireAdminSession } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAdminSession({ redirectToLogin: true });
  return <AdminShell localAccess={access.localAccess}>{children}</AdminShell>;
}

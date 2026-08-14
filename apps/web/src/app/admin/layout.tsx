import "../private.css";
import "../styles/admin.css";
import { AdminShell } from "@/components/admin/admin-shell";
import { PrivateRouteLayout } from "@/components/private-route-layout";
import { requireAdminSession } from "@/lib/admin-auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const access = await requireAdminSession({ redirectToLogin: true });

  return (
    <PrivateRouteLayout>
      <AdminShell localAccess={access.localAccess}>{children}</AdminShell>
    </PrivateRouteLayout>
  );
}

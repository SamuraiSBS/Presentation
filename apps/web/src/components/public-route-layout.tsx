import { PublicFooter } from "@/components/landing/public-footer";
import { PublicHeader } from "@/components/landing/public-header";

export function PublicRouteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <div className="app-content app-content-public">{children}</div>
      <PublicFooter />
    </>
  );
}

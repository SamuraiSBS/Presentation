import "./legal.css";
import { PublicRouteLayout } from "@/components/public-route-layout";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <PublicRouteLayout>{children}</PublicRouteLayout>;
}

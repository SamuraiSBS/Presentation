import "../private.css";
import "../styles/dashboard-projects.css";
import "../styles/new-project-shell.css";
import "../styles/pricing.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

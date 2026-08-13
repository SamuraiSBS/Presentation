import "../private.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

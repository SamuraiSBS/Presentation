import "../private.css";
import "../styles/dashboard-projects.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

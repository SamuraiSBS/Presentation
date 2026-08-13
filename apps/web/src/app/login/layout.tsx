import "../private.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

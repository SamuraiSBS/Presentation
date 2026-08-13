import "../private.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function FoldersLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

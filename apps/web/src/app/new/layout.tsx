import "../private.css";
import "../styles/creation-mode.css";
import "../styles/new-project-foundation.css";
import "../styles/new-project-shell.css";
import "../styles/new-project.css";
import { PrivateRouteLayout } from "@/components/private-route-layout";

export default function NewLayout({ children }: { children: React.ReactNode }) {
  return <PrivateRouteLayout>{children}</PrivateRouteLayout>;
}

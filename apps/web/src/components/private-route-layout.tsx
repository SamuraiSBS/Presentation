import { headers } from "next/headers";
import { auth } from "@/auth";
import { PrivateAppRuntime } from "@/components/private-app-runtime";
import { classifyAppRoute } from "@/lib/app-route-classification";

export async function PrivateRouteLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get("x-studydeck-pathname") ?? "/login";
  const route = classifyAppRoute(pathname);
  const session = await auth();

  if (route === "public") {
    throw new Error(`Private route layout received a public pathname: ${pathname}`);
  }

  return (
    <PrivateAppRuntime pathname={pathname} route={route} session={session}>
      {children}
    </PrivateAppRuntime>
  );
}

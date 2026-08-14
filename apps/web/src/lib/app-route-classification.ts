export type AppRouteKind = "public" | "auth" | "account" | "editor" | "admin";

const publicRoutes = new Set(["/", "/privacy", "/terms", "/support"]);
const accountPrefixes = ["/dashboard", "/projects", "/new", "/folders", "/pricing", "/profile", "/billing", "/invite"];

export function classifyAppRoute(pathname: string): AppRouteKind {
  if (publicRoutes.has(pathname)) return "public";
  if (pathname === "/login") return "auth";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";
  if (/^\/projects\/[^/]+\/(editor|script|export)\/?$/.test(pathname)) return "editor";
  if (accountPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return "account";
  return "account";
}

export function usesAccountNavigation(route: AppRouteKind) {
  return route === "account" || route === "editor" || route === "admin";
}

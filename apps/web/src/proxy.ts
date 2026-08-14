import NextAuth from "@studydeck/auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";
import { devAuthAllowed } from "@studydeck/shared";

const { auth } = NextAuth(authConfig);

export const proxy = auth((request) => {
  const pathname = request.nextUrl.pathname;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-studydeck-pathname", pathname);

  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  const requiresAuth = /^(?:\/dashboard|\/projects|\/new|\/folders|\/profile|\/invite|\/admin)(?:\/|$)/.test(pathname);

  if (!requiresAuth || devAuthAllowed() || request.auth) return next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/new/:path*",
    "/folders/:path*",
    "/profile/:path*",
    "/invite/:path*",
    "/admin/:path*",
    "/billing/:path*",
    "/pricing",
    "/login",
  ],
};

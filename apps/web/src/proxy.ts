import NextAuth from "@studydeck/auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";
import { devAuthAllowed } from "@studydeck/shared";

const { auth } = NextAuth(authConfig);

export const proxy = auth((request) => {
  if (devAuthAllowed() || request.auth) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("callbackUrl", `${request.nextUrl.pathname}${request.nextUrl.search}`);
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
  ],
};

import { NextResponse } from "next/server";

// Keep the web process readiness probe independent of page compilation,
// authentication, and the internal API.  This route is intentionally small so
// local Playwright can distinguish "Next is listening" from "the landing
// page has finished its first development compilation".
export function GET() {
  return NextResponse.json({ ok: true, service: "studydeck-web" });
}

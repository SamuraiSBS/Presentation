import { NextResponse } from "next/server";
import { internalFetch } from "@/lib/internal-api";

export async function POST(request: Request) {
  const result = await internalFetch("/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(await request.json()),
  });
  return NextResponse.json(result);
}

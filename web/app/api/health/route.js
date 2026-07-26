import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "archero-observer" },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

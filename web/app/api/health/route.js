import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { ok: true, service: "archero-guild", version: process.env.APP_VERSION ?? "development" },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}

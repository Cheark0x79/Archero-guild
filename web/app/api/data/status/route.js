import { NextResponse } from "next/server";
import { hasDashboardActionHeader, runCommand } from "../actions.js";

export async function GET(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  const result = await runCommand("adb", ["devices"]);
  if (!result.ok) {
    return NextResponse.json({ ok: true, adb: { connected: false, devices: [], error: result.error } });
  }

  const devices = result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state)
    .map(([serial, state]) => ({ serial, state }));

  return NextResponse.json({
    ok: true,
    adb: {
      connected: devices.some((device) => device.state === "device"),
      devices,
      error: null,
    },
  });
}

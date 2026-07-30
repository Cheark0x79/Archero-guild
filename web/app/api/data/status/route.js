import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { hasDashboardActionHeader, runCommand } from "../actions.js";

export async function GET(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  const bridgeDir = process.env.ARCHERO_CAPTURE_BRIDGE_DIR?.trim();
  if (bridgeDir) {
    try {
      const status = JSON.parse(await fs.readFile(path.join(bridgeDir, "status.json"), "utf8"));
      const age = Date.now() - Date.parse(status.updatedAt);
      if (!Number.isFinite(age) || age > 10_000) {
        throw new Error("BlueStacks capture agent status is stale");
      }
      return NextResponse.json({
        ok: true,
        adb: {
          connected: status.connected === true,
          devices: Array.isArray(status.devices) ? status.devices : status.devices ? [status.devices] : [],
          error: typeof status.error === "string" ? status.error : null,
        },
      });
    } catch (error) {
      return NextResponse.json({
        ok: true,
        adb: {
          connected: false,
          devices: [],
          error: error instanceof Error ? error.message : "BlueStacks capture agent is unavailable",
        },
      });
    }
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

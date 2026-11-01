import { createHash } from "node:crypto";
import { chartPointsForRange } from "./chart-points.js";

// This explicit projection is the complete public PNG contract. Never serialize
// dashboard data, administration records, or raw OCR captures into an image.
export function shareImageModel(profile) {
  const boss = profile.bossProgressions?.[0];
  // Next/og fetches remote fonts for unsupported scripts. Use the stable player
  // ID instead; the HTML profile retains the full Unicode display name.
  const latinName = String(profile.member.name ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
  return {
    version: 1,
    name: latinName && /^[\x20-\x7E]+$/.test(latinName) ? latinName.slice(0, 80) : `Player ${profile.member.playerId}`,
    playerId: profile.member.playerId,
    checkpointDate: profile.checkpointDate,
    power: profile.member.metrics.power,
    powerHistory: chartPointsForRange(profile.powerHistory, "all"),
    bossName: boss?.name ?? "Boss",
    bossHistory: chartPointsForRange(boss?.points, "all"),
    records: profile.personalBests.slice(0, 7).map((record) => ({
      name: String(record.boss.name).slice(0, 60),
      damage: record.bestDamage,
      date: record.bestDate,
    })),
  };
}

export function shareImageVersion(model) {
  return createHash("sha256").update(JSON.stringify(model)).digest("hex");
}

export function shareImagePath(code, profile) {
  return `/s/${code}/image?version=${shareImageVersion(shareImageModel(profile))}`;
}

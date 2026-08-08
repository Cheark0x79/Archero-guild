import { createDemoData } from "./lib/demo-data.js";

const demo = createDemoData({
  seed: process.env.ARCHERO_DEMO_SEED ?? "archero-web-demo-v1",
  anchorDate: process.env.ARCHERO_DEMO_ANCHOR_DATE ?? "2026-08-09",
  scenario: process.env.ARCHERO_DEMO_SCENARIO ?? "baseline",
});

export const {
  captures,
  changes,
  dailyBossRawSnapshots,
  dailyRawSnapshots,
  guildRoster,
  memberSnapshots,
  previousMemberSnapshots,
  rules,
  ocrQueue,
} = demo;

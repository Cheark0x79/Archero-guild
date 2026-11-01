import test from "node:test";
import assert from "node:assert/strict";
import { guildExperienceDetail } from "../lib/guild-xp.js";

const previous = { date: "2026-10-25", level: 12, xpCurrent: 1000, xpRequired: 20000 };
const latest = { date: "2026-10-27", level: 12, xpCurrent: 1450, xpRequired: 20000 };

test("guild XP retains progress and compares the previous captured game date, not import time", () => {
  assert.equal(guildExperienceDetail(latest, [{ ...latest, importedAt: "2026-10-28" }, { ...previous, importedAt: "2026-10-29" }]), "1,450 / 20,000 XP · +450 since 2026-10-25");
});

test("same-level unchanged and declining counters retain their signed difference", () => {
  assert.match(guildExperienceDetail({ ...latest, xpCurrent: 1000 }, [previous]), /\+0 since/);
  assert.match(guildExperienceDetail({ ...latest, xpCurrent: 900 }, [previous]), /-100 since/);
});

test("level changes are unknown even when the counter increases or several levels are crossed", () => {
  for (const level of [11, 13, 15]) {
    for (const xpCurrent of [50, 2000]) {
      assert.equal(guildExperienceDetail({ ...latest, level, xpCurrent }, [previous]), `${xpCurrent.toLocaleString("en-US")} / 20,000 XP · Level changed; gain unknown`);
    }
  }
});

test("missing history or fields do not invent a comparison or skip an incomplete previous capture", () => {
  for (const history of [[], [latest], [{ ...previous, xpCurrent: null }], [{ ...previous, level: null }], [previous, { date: "2026-10-26" }]]) {
    assert.match(guildExperienceDetail(latest, history), /No daily comparison$/);
  }
  for (const xpCurrent of [null, undefined, NaN, Infinity, -1, "1450"]) {
    assert.equal(guildExperienceDetail({ ...latest, xpCurrent }, [previous]), "Experience not captured · No daily comparison");
  }
  assert.match(guildExperienceDetail({ ...latest, date: undefined }, [previous]), /No daily comparison$/);
});

test("duplicate imports never compare a game day against itself and current accepted snapshot wins", () => {
  assert.equal(guildExperienceDetail(latest, [previous, latest, { ...latest, xpCurrent: 9999 }, previous]), guildExperienceDetail(latest, [previous]));
  assert.match(guildExperienceDetail(latest, [previous, { ...previous, xpCurrent: 1200 }, latest]), /\+250 since/);
  assert.match(guildExperienceDetail(latest, [latest, latest]), /No daily comparison$/);
});

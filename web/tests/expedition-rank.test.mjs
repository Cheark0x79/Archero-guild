import assert from "node:assert/strict";
import test from "node:test";

import {
  expeditionRankBands,
  expeditionRankIconPath,
  expeditionRankScore,
  formatExpeditionRank,
} from "../lib/expedition-rank.js";

test("expedition rank combines the OCR name and Roman tier", () => {
  assert.equal(formatExpeditionRank({ expeditionName: "Firebound Soul", expeditionRank: "I" }), "Firebound Soul I");
  assert.equal(formatExpeditionRank({ expeditionName: "Firebloom Soul", expeditionRank: "1" }), "Firebound Soul I");
});

test("expedition rank keeps legacy full labels and rejects an isolated tier", () => {
  assert.equal(formatExpeditionRank({ expeditionRank: "Firebound Soul II" }), "Firebound Soul II");
  assert.equal(formatExpeditionRank({ expeditionRank: "I" }), null);
});

test("expedition rank displays an unknown OCR family without inventing its progression order", () => {
  assert.equal(formatExpeditionRank({ expeditionName: "Crystal Crown", expeditionRank: "II" }), "Crystal Crown II");
  assert.equal(expeditionRankScore("Crystal Crown II"), null);
});

test("expedition rank score orders known families and tiers", () => {
  assert.ok(expeditionRankScore("Firebound Soul I") > expeditionRankScore("Firebound Soul II"));
  assert.ok(expeditionRankScore("Firebound Soul II") > expeditionRankScore("Firebound Soul III"));
  assert.ok(expeditionRankScore("Thunderbound Oath III") > expeditionRankScore("Firebound Soul I"));
});

test("expedition rank bands preserve the point order shown by the game", () => {
  assert.deepEqual(expeditionRankBands(), [
    { name: "Woodbound Pact", minPoints: 200, maxPoints: 299 },
    { name: "Ironbound Oath", minPoints: 300, maxPoints: 599 },
    { name: "Firebound Soul", minPoints: 600, maxPoints: 899 },
    { name: "Thunderbound Oath", minPoints: 900, maxPoints: 1199 },
    { name: "Dragonbound Glory", minPoints: 1200, maxPoints: null },
  ]);
});

test("expedition rank icons resolve only for known game families", () => {
  assert.equal(expeditionRankIconPath("Firebound Soul I"), "/expedition-ranks/firebound-soul.png");
  assert.equal(expeditionRankIconPath("Dragonbound Glory"), "/expedition-ranks/dragonbound-glory.png");
  assert.equal(expeditionRankIconPath("Crystal Crown II"), null);
});

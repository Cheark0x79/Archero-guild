const RANK_FAMILIES = [
  { name: "Woodbound Pact", slug: "woodbound-pact", minPoints: 200, maxPoints: 299 },
  { name: "Ironbound Oath", slug: "ironbound-oath", minPoints: 300, maxPoints: 599 },
  { name: "Firebound Soul", slug: "firebound-soul", minPoints: 600, maxPoints: 899 },
  { name: "Thunderbound Oath", slug: "thunderbound-oath", minPoints: 900, maxPoints: 1199 },
  { name: "Dragonbound Glory", slug: "dragonbound-glory", minPoints: 1200, maxPoints: null },
];

export function formatExpeditionRank(stats = {}) {
  const name = canonicalRankFamily(stats.expeditionName);
  const rawRank = cleanText(stats.expeditionRank);

  if (name) {
    const tier = canonicalTier(rawRank);
    return tier ? `${name} ${tier}` : name;
  }

  if (!rawRank || expeditionRankScore(rawRank) == null) return null;
  return canonicalFullRank(rawRank);
}

export function expeditionRankScore(value) {
  const normalized = normalize(value);
  const rankIndex = RANK_FAMILIES.findIndex((rank) => normalized.startsWith(normalize(rank.name)));
  if (rankIndex < 0) return null;
  const suffix = normalized.slice(normalize(RANK_FAMILIES[rankIndex].name).length).trim();
  // Point progression runs III -> II -> I inside a ranked family. For example,
  // 825 points is Firebound Soul I, near the top of the 600-899 band.
  const tiers = { "": 0, "3": 1, iii: 1, "2": 2, ii: 2, "1": 3, i: 3 };
  return Object.hasOwn(tiers, suffix) ? rankIndex * 10 + tiers[suffix] : null;
}

export function expeditionRankBands() {
  return RANK_FAMILIES.map(({ slug: _slug, ...rank }) => rank);
}

export function expeditionRankIconPath(value) {
  const normalized = normalize(value);
  const family = RANK_FAMILIES.find((rank) => normalized.startsWith(normalize(rank.name)));
  return family ? `/expedition-ranks/${family.slug}.png` : null;
}

function canonicalFullRank(value) {
  const normalized = normalize(value);
  const family = RANK_FAMILIES.find((rank) => normalized.startsWith(normalize(rank.name)));
  if (!family) return null;
  const suffix = normalized.slice(normalize(family.name).length).trim();
  const tier = canonicalTier(suffix);
  return tier ? `${family.name} ${tier}` : family.name;
}

function canonicalRankFamily(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const normalized = normalize(cleaned);
  return RANK_FAMILIES.find((rank) => normalized === normalize(rank.name))?.name
    ?? cleaned.replace(/firebloom/gi, "Firebound");
}

function canonicalTier(value) {
  const normalized = normalize(value);
  return { "1": "I", i: "I", "2": "II", ii: "II", "3": "III", iii: "III" }[normalized] ?? null;
}

function normalize(value) {
  return cleanText(value).toLowerCase().replaceAll("firebloom", "firebound");
}

function cleanText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

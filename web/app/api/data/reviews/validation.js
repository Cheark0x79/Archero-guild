import { validateCaptureDate } from "../date.js";

const REVIEW_KEY = /^\d{4}-\d{2}-\d{2}:[^\u0000-\u001f\u007f]{1,200}$/;
const REVIEW_FIELDS = new Set(["identity", "role", "power", "bossAttacks", "contribution7d", "bossRank", "bossDamageToday"]);

export function normalizeReviews(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("reviews must be an object");
  const normalized = {};
  for (const [key, review] of Object.entries(value)) {
    if (!REVIEW_KEY.test(key)) throw new Error(`invalid review key: ${key}`);
    if (!validateCaptureDate(key.slice(0, 10))) throw new Error(`invalid review date: ${key.slice(0, 10)}`);
    if (review === "valid" || review === "invalid") {
      normalized[key] = review;
      continue;
    }
    if (!review || typeof review !== "object" || Array.isArray(review) || (review.status !== "valid" && review.status !== "invalid")) {
      throw new Error(`invalid review status for ${key}`);
    }
    const rawFields = review.fields ?? {};
    if (!rawFields || typeof rawFields !== "object" || Array.isArray(rawFields)) throw new Error(`invalid review fields for ${key}`);
    const fields = {};
    for (const [field, label] of Object.entries(rawFields)) {
      if (!REVIEW_FIELDS.has(field)) throw new Error(`invalid review field: ${field}`);
      if (typeof label !== "string" || label.trim().length === 0 || label.length > 80) throw new Error(`invalid review field label: ${field}`);
      fields[field] = label.trim();
    }
    if (review.status === "invalid" && Object.keys(fields).length === 0) throw new Error(`invalid review requires a field for ${key}`);
    normalized[key] = { status: review.status, fields };
  }
  return normalized;
}

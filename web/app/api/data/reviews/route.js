import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { projectRoot } from "../actions.js";
import { normalizeReviews } from "./validation.js";

function reviewsPath() {
  return path.join(projectRoot(), "data", "reviews.json");
}

async function readReviews() {
  try {
    const parsed = JSON.parse(await fs.readFile(reviewsPath(), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, reviews: await readReviews() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const payload = await request.json();
    const reviews = normalizeReviews(payload.reviews);
    const destination = reviewsPath();
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(reviews, null, 2)}\n`, { flag: "wx" });
    await fs.rename(temporary, destination);
    return NextResponse.json({ ok: true, reviews });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "save failed" }, { status: 400 });
  }
}

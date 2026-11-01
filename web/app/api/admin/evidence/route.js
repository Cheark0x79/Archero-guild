import { handleEvidence } from "../../../../lib/private-evidence.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) { return handleEvidence(request); }
export async function POST(request) { return handleEvidence(request); }
export async function DELETE(request) { return handleEvidence(request); }

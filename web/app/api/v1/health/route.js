import { apiSuccess } from "../_lib/responses.js";

export async function GET() {
  return apiSuccess({ status: "ok" }, { cacheControl: "public, max-age=30" });
}

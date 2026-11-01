import { ImageResponse } from "next/og";
import { shareImageResponse } from "../../../../lib/share-image-response.js";
import { renderShareImage } from "../../../../lib/share-image-render.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const { code } = await context.params;
  return shareImageResponse(request, code, {
    renderPng: (model, headers) => new ImageResponse(renderShareImage(model), { width: 1200, height: 900, headers }).arrayBuffer(),
  });
}

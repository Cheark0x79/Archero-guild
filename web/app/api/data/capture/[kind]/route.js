import { NextResponse } from "next/server";
import { CAPTURE_KINDS, hasDashboardActionHeader, runObserverModule, screenshotUrl } from "../../actions.js";

export async function POST(request, context) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  const { kind } = await context.params;
  if (!CAPTURE_KINDS.has(kind)) {
    return NextResponse.json({ ok: false, error: `unknown capture kind: ${kind}` }, { status: 400 });
  }

  const result = await runObserverModule("observer.capture", [kind]);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    capture: {
      ...result.data,
      imageUrl: result.data?.path ? screenshotUrl(result.data.path) : null,
    },
  });
}

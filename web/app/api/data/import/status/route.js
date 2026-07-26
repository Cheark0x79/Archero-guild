import { NextResponse } from "next/server";
import { hasDashboardActionHeader } from "../../actions.js";
import { getImportJob, listImportJobs, publicJob } from "../jobs.js";

export async function GET(request) {
  if (!hasDashboardActionHeader(request)) {
    return NextResponse.json({ ok: false, error: "missing dashboard action header" }, { status: 403 });
  }

  const url = new URL(request.url);
  const job = getImportJob(url.searchParams.get("id"));
  if (!job) {
    return NextResponse.json({ ok: true, job: null, jobs: listImportJobs() });
  }

  return NextResponse.json({ ok: true, job: publicJob(job), jobs: listImportJobs() });
}

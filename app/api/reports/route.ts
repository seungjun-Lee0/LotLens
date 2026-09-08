// GET /api/reports?q=&filter=&cursor= — the next page of the caller's own
// reports, for the list's "Load more". Same query as the server-rendered
// first page (lib/reports), so the cards never disagree.

import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { listUserReports, parseReportListFilter } from "@/lib/reports";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }
  const url = new URL(req.url);
  const page = await listUserReports(user.id, {
    q: url.searchParams.get("q") ?? "",
    filter: parseReportListFilter(url.searchParams.get("filter")),
    cursor: url.searchParams.get("cursor"),
  });
  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}

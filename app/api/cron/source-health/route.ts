// GET /api/cron/source-health
//
// Daily source health check (vercel.json `crons`). Runs every upstream
// probe in lib/source-health and emails the admins (ADMIN_EMAILS) when
// anything fails: a council re-publishing its scheme under a new path, a
// state layer going dark, the imagery exporter timing out. Silent when all
// is well: an inbox full of "all healthy" mails trains people to ignore
// the one that matters.
//
// Vercel calls cron routes with `Authorization: Bearer ${CRON_SECRET}`;
// anything else is refused so the endpoint can't be used to make us
// hammer upstream services on demand.

import { NextResponse } from "next/server";

import { emailConfigured, sendEmail } from "@/lib/email";
import { formatHealthReport, runSourceHealthCheck } from "@/lib/source-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ~60 probes against council and state servers: allow the full Hobby limit.
export const maxDuration = 300;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const results = await runSourceHealthCheck();
  const failed = results.filter((r) => !r.ok);
  const report = formatHealthReport(results);
  console.log(`[source-health] ${results.length - failed.length}/${results.length} healthy`);
  if (failed.length > 0) console.error(report);

  let notified = false;
  const admins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (failed.length > 0 && emailConfigured() && admins.length > 0) {
    const rows = failed
      .map(
        (f) =>
          `<tr><td style="padding:4px 10px 4px 0;font-family:monospace">${f.name}</td><td style="padding:4px 0;color:#b91c1c">${escapeHtml(f.error ?? "failed")}</td></tr>`,
      )
      .join("");
    try {
      await sendEmail({
        to: admins.join(","),
        subject: `LotLens source health: ${failed.length} of ${results.length} failing`,
        html:
          `<p>The daily source check found ${failed.length} failing source${failed.length > 1 ? "s" : ""}.</p>` +
          `<table>${rows}</table>` +
          `<p style="color:#64748b;font-size:12px">Full log:</p><pre style="font-size:11px">${escapeHtml(report)}</pre>`,
      });
      notified = true;
    } catch (err) {
      console.error("[source-health] alert email failed:", err);
    }
  }

  return NextResponse.json({
    healthy: results.length - failed.length,
    total: results.length,
    failed: failed.map((f) => ({ name: f.name, error: f.error })),
    notified,
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

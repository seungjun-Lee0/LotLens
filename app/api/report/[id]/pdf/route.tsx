// GET /api/report/[id]/pdf
//
// Pre-renders each module's map PNG (OSM tiles + polygon overlays + pin)
// in parallel, then streams the React-PDF document. Node runtime required
// for both @react-pdf/renderer and staticmaps' sharp dependency.

import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

import {
  ReportPDF,
  type ModuleMapPng,
  type ReportBranding,
} from "@/components/report/report-pdf";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { extractOverlays } from "@/lib/overlays";
import { loadReportPayload } from "@/lib/pipeline";
import { renderModuleMapPNG } from "@/lib/static-map";

// Branding of the report's owner (subscriber feature). The logo is
// fetched here — React-PDF can't fetch mid-render — with a size cap so a
// hostile URL can't balloon the render. Any failure degrades to the
// unbranded fact pack.
async function loadBranding(reportId: string): Promise<ReportBranding | null> {
  try {
    const sql = getDb();
    const rows = (await sql`
      SELECT u.brand_name, u.brand_color, u.brand_logo_url, u.plan, u.subscription_status
      FROM reports r JOIN users u ON u.id = r.user_id
      WHERE r.id = ${reportId} LIMIT 1
    `) as Array<{
      brand_name: string | null;
      brand_color: string | null;
      brand_logo_url: string | null;
      plan: string;
      subscription_status: string | null;
    }>;
    const u = rows[0];
    if (!u) return null;
    const subscribed =
      u.plan !== "free" &&
      (u.subscription_status === "active" || u.subscription_status === "trialing");
    if (!subscribed || (!u.brand_name && !u.brand_color && !u.brand_logo_url)) {
      return null;
    }
    let logo: Buffer | null = null;
    if (u.brand_logo_url && /^https:\/\//i.test(u.brand_logo_url)) {
      try {
        const res = await fetch(u.brand_logo_url, {
          signal: AbortSignal.timeout(5000),
        });
        const type = res.headers.get("content-type") ?? "";
        if (res.ok && /image\/(png|jpe?g)/i.test(type)) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length <= 2_000_000) logo = buf;
        }
      } catch {
        /* logo is optional */
      }
    }
    return { name: u.brand_name, color: u.brand_color, logo };
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Static map renders can take ~10-30 s when OSM tiles are cold. Bump the
// route timeout so we don't get axed mid-render on a slow upstream.
export const maxDuration = 60;

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const [payload, branding] = await Promise.all([
    loadReportPayload(id),
    loadBranding(id),
  ]);
  if (!payload) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }
  // The report page only hides the download button for unpaid reports —
  // enforce the paywall here too so the URL can't be hit directly.
  // Admins (ADMIN_EMAILS) always pass.
  if (!payload.paid && !isAdmin(await getSessionUser())) {
    return NextResponse.json(
      { error: "report not unlocked" },
      { status: 403 },
    );
  }

  // Render map PNGs in parallel — but only for modules that get a full
  // page (flagged or failed); clear modules collapse to the summary page
  // and never show a map.
  const needsMap = payload.modules.filter(
    (row) =>
      row.hasConsideration ||
      (!!row.raw &&
        typeof row.raw === "object" &&
        (row.raw as Record<string, unknown>).fetchFailed === true),
  );
  const maps: ModuleMapPng[] = await Promise.all(
    needsMap.map(async (row) => {
      const overlays = extractOverlays(row.module, row.raw);
      try {
        const png = await renderModuleMapPNG({
          lat: payload.address.lat,
          lng: payload.address.lng,
          overlays,
          propertyPolygon: payload.propertyPolygon,
          // Lot lines only benefit the zoning map (per-lot read of the
          // dissolved zone fill). Skip them on every other module.
          lotLines: row.module === "zoning" ? payload.parcelLines : null,
        });
        return { module: row.module, png };
      } catch (err) {
        console.error(`[pdf] static-map failed for ${row.module}:`, err);
        return { module: row.module, png: null };
      }
    }),
  );

  const buffer = await renderToBuffer(
    <ReportPDF payload={payload} maps={maps} branding={branding} />,
  );

  const safeAddr = payload.address.address_text
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const filename = `lotlens-${safeAddr || payload.report.id.slice(0, 8)}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

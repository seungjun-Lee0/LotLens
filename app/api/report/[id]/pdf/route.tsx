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
import { ESSENTIAL_MODULES, getDb } from "@/lib/db";
import { formatAuAddress } from "@/lib/format-address";
import { extractOverlays } from "@/lib/overlays";
import { loadReportPayload } from "@/lib/pipeline";
import { renderCoverAerial, renderModuleMapPNG } from "@/lib/static-map";

// Branding of the report's owner (subscriber feature). The logo is
// fetched here: React-PDF can't fetch mid-render: with a size cap so a
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
    const m = u.brand_logo_url
      ? /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(u.brand_logo_url)
      : null;
    if (m) {
      // Uploaded from the account page: the image bytes ARE the value.
      // Cap matches the branding API's 4M-char base64 ceiling (~3 MB).
      try {
        const buf = Buffer.from(m[1], "base64");
        if (buf.length > 0 && buf.length <= 3_000_000) logo = buf;
      } catch {
        /* logo is optional */
      }
    } else if (u.brand_logo_url && /^https:\/\//i.test(u.brand_logo_url)) {
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
    // warmImagery: start the ~2 s QLD aerial fetches while the multi-MB
    // council_data transfer is still streaming, instead of after it.
    loadReportPayload(id, { warmImagery: true }),
    loadBranding(id),
  ]);
  if (!payload) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }
  // The report page only hides the download button for unpaid reports -
  // enforce the paywall here too so the URL can't be hit directly.
  // Admins (ADMIN_EMAILS) always pass.
  if (!payload.paid && !isAdmin(await getSessionUser())) {
    return NextResponse.json(
      { error: "report not unlocked" },
      { status: 403 },
    );
  }

  // Render map PNGs in parallel: only for modules that get a full page -
  // flagged, failed, or an essential hazard check that came back clear (it
  // keeps a "No issues found" page). The other clear checks collapse to the
  // summary strip and never show a map.
  const needsMap = payload.modules.filter(
    (row) =>
      row.hasConsideration ||
      ESSENTIAL_MODULES.has(row.module) ||
      (!!row.raw &&
        typeof row.raw === "object" &&
        (row.raw as Record<string, unknown>).fetchFailed === true),
  );
  // Cover aerial: full-page portrait in the landing-hero light style -
  // washed imagery, white veil baked in, lot outline + pin.
  const coverPromise = renderCoverAerial({
    lat: payload.address.lat,
    lng: payload.address.lng,
    propertyPolygon: payload.propertyPolygon,
  }).catch(() => null);
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
          // Transport stops are points spread up to ~2 km out: widen the
          // frame to include them (mirrors the web map's fitPoints).
          fitPoints: row.module === "transport",
        });
        return { module: row.module, png };
      } catch (err) {
        console.error(`[pdf] static-map failed for ${row.module}:`, err);
        return { module: row.module, png: null };
      }
    }),
  );

  const buffer = await renderToBuffer(
    <ReportPDF
      payload={payload}
      maps={maps}
      branding={branding}
      coverPng={await coverPromise}
    />,
  );

  const safeAddr = formatAuAddress(payload.address.address_text, payload.postcode)
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

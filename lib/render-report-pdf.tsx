// Shared report → PDF renderer.
//
// Extracted from /api/report/[id]/pdf so both the single-report download
// route AND the admin bulk-ZIP route render byte-identical PDFs from one
// code path. Node runtime only (@react-pdf/renderer + staticmaps/sharp).

import { renderToBuffer } from "@react-pdf/renderer";

import {
  ReportPDF,
  type ModuleMapPng,
  type ReportBranding,
} from "@/components/report/report-pdf";
import { ESSENTIAL_MODULES, GOOD_TO_KNOW_MODULES, getDb } from "@/lib/db";
import { formatAuAddress } from "@/lib/format-address";
import { extractOverlays } from "@/lib/overlays";
import { loadReportPayload } from "@/lib/pipeline";
import { isFlagged } from "@/lib/risk-style";
import { renderCoverAerial, renderModuleMapPNG } from "@/lib/static-map";

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
    const m = u.brand_logo_url
      ? /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(u.brand_logo_url)
      : null;
    if (m) {
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

/**
 * Run async tasks with a bounded number in flight at once. Used to cap how
 * many sharp composites run concurrently: each decodes its source imagery
 * to a raw bitmap (a 1200×720 map ≈ 3.4 MB raw, the full-page cover ≈
 * 14 MB), so firing all of a report's maps at once spikes to 100 MB+ and,
 * across a bulk run, OOMs. A small cap keeps peak memory bounded — the
 * upstream imagery fetch dominates each render anyway, so throughput barely
 * moves.
 */
async function runPool(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const i = next++;
        await tasks[i]();
      }
    },
  );
  await Promise.all(workers);
}

export type RenderedReportPdf = {
  buffer: Buffer;
  filename: string;
  /** True when the caller must enforce the paywall (report is unpaid). */
  paid: boolean;
};

/**
 * Render a report to a PDF buffer. Returns null when the report doesn't
 * exist. Does NOT enforce the paywall — the caller decides (the single
 * download route 403s unpaid non-admins; the admin bulk route is already
 * admin-gated). `paid` is surfaced so callers can gate.
 */
export async function renderReportPdf(
  reportId: string,
): Promise<RenderedReportPdf | null> {
  const [payload, branding] = await Promise.all([
    loadReportPayload(reportId, { warmImagery: true }),
    loadBranding(reportId),
  ]);
  if (!payload) return null;

  // Render map PNGs in parallel: only for modules that get a full page —
  // flagged, failed, a core hazard check that came back clear, or a "Good to
  // know" fact module. The minor clear checks collapse into the evidence
  // strip and need no map.
  const needsMap = payload.modules.filter(
    (row) =>
      isFlagged(row.riskLevel, row.hasConsideration) ||
      ESSENTIAL_MODULES.has(row.module) ||
      GOOD_TO_KNOW_MODULES.has(row.module) ||
      (!!row.raw &&
        typeof row.raw === "object" &&
        (row.raw as Record<string, unknown>).fetchFailed === true),
  );
  // Render the cover aerial and every module map through one shared pool so
  // the heavy full-page cover never overlaps with all ~8-10 module maps at
  // once (see runPool). Cap of 3 keeps per-report peak memory bounded, the
  // key to surviving a large bulk-ZIP run.
  let coverPng: Buffer | null = null;
  const maps: ModuleMapPng[] = new Array(needsMap.length);
  const tasks: Array<() => Promise<void>> = [
    async () => {
      coverPng = await renderCoverAerial({
        lat: payload.address.lat,
        lng: payload.address.lng,
        propertyPolygon: payload.propertyPolygon,
      }).catch(() => null);
    },
    ...needsMap.map((row, idx) => async () => {
      const overlays = extractOverlays(row.module, row.raw);
      try {
        const png = await renderModuleMapPNG({
          lat: payload.address.lat,
          lng: payload.address.lng,
          overlays,
          propertyPolygon: payload.propertyPolygon,
          lotLines: row.module === "zoning" ? payload.parcelLines : null,
          fitPoints: row.module === "transport",
        });
        maps[idx] = { module: row.module, png };
      } catch (err) {
        console.error(`[pdf] static-map failed for ${row.module}:`, err);
        maps[idx] = { module: row.module, png: null };
      }
    }),
  ];
  await runPool(tasks, 3);

  const buffer = await renderToBuffer(
    <ReportPDF
      payload={payload}
      maps={maps}
      branding={branding}
      coverPng={coverPng}
    />,
  );

  const safeAddr = formatAuAddress(payload.address.address_text, payload.postcode)
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const filename = `lotlens-${safeAddr || payload.report.id.slice(0, 8)}.pdf`;

  return { buffer, filename, paid: payload.paid };
}

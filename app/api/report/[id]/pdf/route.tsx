// GET /api/report/[id]/pdf
//
// Pre-renders each module's map PNG (OSM tiles + polygon overlays + pin)
// in parallel, then streams the React-PDF document. Node runtime required
// for both @react-pdf/renderer and staticmaps' sharp dependency.

import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

import { ReportPDF, type ModuleMapPng } from "@/components/report/report-pdf";
import { MODULE_META } from "@/lib/module-meta";
import { extractOverlays } from "@/lib/overlays";
import { loadReportPayload } from "@/lib/pipeline";
import { renderModuleMapPNG } from "@/lib/static-map";

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
  const payload = await loadReportPayload(id);
  if (!payload) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  // Render each module's map PNG in parallel. Failed renders fall back to
  // a null entry so the PDF still ships without that map.
  const maps: ModuleMapPng[] = await Promise.all(
    payload.modules.map(async (row) => {
      const meta = MODULE_META[row.module];
      const overlays = extractOverlays(row.module, row.raw);
      try {
        const png = await renderModuleMapPNG({
          lat: payload.address.lat,
          lng: payload.address.lng,
          tint: meta.tintHex,
          overlays,
        });
        return { module: row.module, png };
      } catch (err) {
        console.error(`[pdf] static-map failed for ${row.module}:`, err);
        return { module: row.module, png: null };
      }
    }),
  );

  const buffer = await renderToBuffer(<ReportPDF payload={payload} maps={maps} />);

  const safeAddr = payload.address.address_text
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
  const filename = `propai-${safeAddr || payload.report.id.slice(0, 8)}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

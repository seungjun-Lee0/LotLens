// GET /api/report/[id]/pdf
//
// Streams the React-PDF document for a report. Forced to the Node runtime
// because @react-pdf/renderer needs Node APIs (Edge can't run it).

import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";

import { ReportPDF } from "@/components/report/report-pdf";
import { loadReportPayload } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const payload = await loadReportPayload(id);
  if (!payload) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  const buffer = await renderToBuffer(<ReportPDF payload={payload} />);

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

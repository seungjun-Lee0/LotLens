// POST /api/admin/bulk-pdf — admin-only: bundle several reports' PDFs into
// one ZIP. Body: { reportIds: string[] }. The streaming protocol lives in
// lib/bulk-pdf-stream (shared with the user-facing /api/reports/bulk-pdf).

import { getSessionUser, isAdmin } from "@/lib/auth";
import {
  BULK_PDF_MAX_BATCH,
  jsonError,
  parseReportIds,
  streamBulkPdfZip,
} from "@/lib/bulk-pdf-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps serverless functions at 300 s. Warm renders run ~4-5 s
// per report, so the 60-report batch cap fits; a cold batch that can't
// finish in time should be split client-side.
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!isAdmin(user)) return jsonError("admin only", 403);

  const reportIds = await parseReportIds(req);
  if (!reportIds) return jsonError("invalid body", 400);
  if (reportIds.length === 0) return jsonError("no report ids", 400);
  if (reportIds.length > BULK_PDF_MAX_BATCH) {
    return jsonError(
      `too many reports (${reportIds.length}); max ${BULK_PDF_MAX_BATCH} per ZIP — split the batch`,
      400,
    );
  }
  return streamBulkPdfZip(reportIds);
}

// POST /api/reports/bulk-pdf — "My reports" multi-select download: bundle
// the caller's own UNLOCKED reports into one ZIP. Body: { reportIds }.
//
// Authorisation happens up front (downloadableReportIds), not per render:
// ids that aren't the caller's, or are still previews, are silently
// dropped rather than failing the whole batch. Admins may bundle any
// report, mirroring the single-PDF route's paywall bypass.

import { getSessionUser, isAdmin } from "@/lib/auth";
import {
  BULK_PDF_MAX_BATCH,
  jsonError,
  parseReportIds,
  streamBulkPdfZip,
} from "@/lib/bulk-pdf-stream";
import { downloadableReportIds } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("sign in required", 401);

  const requested = await parseReportIds(req);
  if (!requested) return jsonError("invalid body", 400);
  if (requested.length === 0) return jsonError("no report ids", 400);
  if (requested.length > BULK_PDF_MAX_BATCH) {
    return jsonError(
      `too many reports (${requested.length}); max ${BULK_PDF_MAX_BATCH} per download`,
      400,
    );
  }

  const reportIds = await downloadableReportIds(requested, user.id, isAdmin(user));
  if (reportIds.length === 0) {
    return jsonError("none of the selected reports are unlocked", 403);
  }
  return streamBulkPdfZip(reportIds);
}

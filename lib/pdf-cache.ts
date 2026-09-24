// Rendered-PDF cache in Vercel Blob.
//
// A report's PDF is the most expensive thing the app produces (aerial
// imagery fetches, ~10 sharp composites, react-pdf: tens of seconds) and
// its inputs are immutable once the run exists, so it is rendered once and
// the bytes are kept. Every later download, and every bulk ZIP, is a blob
// read. The cache is best-effort: no BLOB_READ_WRITE_TOKEN (local dev, or
// the store not provisioned yet) means every call renders, exactly as
// before. Invalidated when the run is retried (new data) or the owner's
// branding changes (the cover and footer carry it).
//
// Blobs are public-by-URL with a random suffix, and the route still
// proxies the bytes through its own auth rather than redirecting, so the
// URL is never handed to the browser.

import { del, put } from "@vercel/blob";

import { getDb } from "@/lib/db";
import { renderReportPdf, type RenderedReportPdf } from "@/lib/render-report-pdf";

export function pdfCacheEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

type CachedRow = {
  pdf_url: string | null;
  pdf_filename: string | null;
  paid_at: string | null;
};

/**
 * The report's PDF: from the blob when cached, else rendered (and stored
 * for next time). Same result shape as renderReportPdf; null when the
 * report does not exist. Does not enforce the paywall: callers gate.
 */
export async function getReportPdf(reportId: string): Promise<RenderedReportPdf | null> {
  const sql = getDb();
  if (pdfCacheEnabled()) {
    const rows = (await sql`
      SELECT pdf_url, pdf_filename, paid_at FROM reports WHERE id = ${reportId}::uuid LIMIT 1
    `) as CachedRow[];
    const row = rows[0];
    if (!row) return null;
    if (row.pdf_url && row.pdf_filename) {
      try {
        const res = await fetch(row.pdf_url, { signal: AbortSignal.timeout(20_000) });
        if (res.ok) {
          return {
            buffer: Buffer.from(await res.arrayBuffer()),
            filename: row.pdf_filename,
            paid: Boolean(row.paid_at),
          };
        }
        console.warn(`[pdf-cache] blob read ${res.status} for ${reportId}; re-rendering`);
      } catch (err) {
        console.warn(`[pdf-cache] blob read failed for ${reportId}; re-rendering:`, (err as Error).message);
      }
    }
  }

  const rendered = await renderReportPdf(reportId);
  if (!rendered || !pdfCacheEnabled()) return rendered;

  // Store for next time. Failure here must not fail the download.
  try {
    const blob = await put(`reports/${reportId}/${rendered.filename}`, rendered.buffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/pdf",
    });
    await sql`
      UPDATE reports
      SET pdf_url = ${blob.url}, pdf_filename = ${rendered.filename}, pdf_rendered_at = now()
      WHERE id = ${reportId}::uuid
    `;
  } catch (err) {
    console.warn(`[pdf-cache] store failed for ${reportId}:`, (err as Error).message);
  }
  return rendered;
}

/** Drop the cached PDF for one report (its data changed). */
export async function invalidateReportPdf(reportId: string): Promise<void> {
  const sql = getDb();
  const rows = (await sql`
    SELECT pdf_url FROM reports WHERE id = ${reportId}::uuid AND pdf_url IS NOT NULL
  `) as Array<{ pdf_url: string }>;
  if (rows.length === 0) return;
  await sql`
    UPDATE reports SET pdf_url = NULL, pdf_filename = NULL, pdf_rendered_at = NULL
    WHERE id = ${reportId}::uuid
  `;
  await deleteBlobs(rows.map((r) => r.pdf_url));
}

/** Drop every cached PDF a user owns (their branding changed). */
export async function invalidateUserReportPdfs(userId: string): Promise<void> {
  const sql = getDb();
  const rows = (await sql`
    SELECT id, pdf_url FROM reports WHERE user_id = ${userId}::uuid AND pdf_url IS NOT NULL
  `) as Array<{ id: string; pdf_url: string }>;
  if (rows.length === 0) return;
  await sql`
    UPDATE reports SET pdf_url = NULL, pdf_filename = NULL, pdf_rendered_at = NULL
    WHERE user_id = ${userId}::uuid AND pdf_url IS NOT NULL
  `;
  await deleteBlobs(rows.map((r) => r.pdf_url));
}

async function deleteBlobs(urls: Array<string | null>): Promise<void> {
  const live = urls.filter((u): u is string => Boolean(u));
  if (live.length === 0 || !pdfCacheEnabled()) return;
  try {
    await del(live);
  } catch (err) {
    // An orphaned blob costs cents; a failed invalidation must not throw.
    console.warn("[pdf-cache] blob delete failed:", (err as Error).message);
  }
}

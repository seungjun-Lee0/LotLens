"use client";

// "My reports" list: search + status filters (URL-driven, so the server
// renders the first page and a link is shareable), cursor "Load more",
// multi-select → one ZIP of PDFs, and per-run delete.
//
// The page remounts this component (key = q|filter) whenever the URL
// changes, so `initial` is always the first page for the current query
// and local state starts clean.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  Columns3,
  FileArchive,
  FileText,
  Loader2,
  Search,
  X,
} from "lucide-react";

import { ReportCard } from "@/components/reports/report-card";
import {
  downloadBulkPdfZip,
  triggerDownload,
  type BulkPdfProgress,
} from "@/lib/bulk-pdf-client";
import type {
  ReportListFilter,
  ReportListItem,
  ReportListPage,
} from "@/lib/reports";

const FILTERS: Array<{ id: ReportListFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "full", label: "Full" },
  { id: "preview", label: "Preview" },
  { id: "attention", label: "Needs attention" },
];

type ZipState =
  | { phase: "idle" }
  | (BulkPdfProgress & {})
  | { phase: "ready"; url: string; filename: string; rendered: number; failed: number }
  | { phase: "error"; message: string };

function listHref(q: string, filter: ReportListFilter): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (filter !== "all") p.set("filter", filter);
  const s = p.toString();
  return s ? `/reports?${s}` : "/reports";
}

export function ReportList({
  initial,
  q,
  filter,
  canDownloadPreviews,
}: {
  initial: ReportListPage;
  q: string;
  filter: ReportListFilter;
  /** Admins bypass the PDF paywall, so their previews are bundle-able. */
  canDownloadPreviews: boolean;
}) {
  const router = useRouter();
  const [navPending, startNav] = useTransition();

  const [items, setItems] = useState<ReportListItem[]>(initial.items);
  const [nextCursor, setNextCursor] = useState<string | null>(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zip, setZip] = useState<ZipState>({ phase: "idle" });
  const zipAbort = useRef<AbortController | null>(null);
  const zipUrl = useRef<string | null>(null);

  // ── Search (debounced → URL) ─────────────────────────────────────────
  const [text, setText] = useState(q);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigate = (nextQ: string, nextFilter: ReportListFilter) =>
    startNav(() => router.replace(listHref(nextQ.trim(), nextFilter)));
  useEffect(() => {
    if (text.trim() === q) return;
    searchTimer.current = setTimeout(() => navigate(text, filter), 350);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    return () => {
      zipAbort.current?.abort();
      if (zipUrl.current) URL.revokeObjectURL(zipUrl.current);
    };
  }, []);

  // ── Selection ────────────────────────────────────────────────────────
  const downloadable = (it: ReportListItem) => it.paid || canDownloadPreviews;
  const downloadableIds = items.filter(downloadable).map((it) => it.id);
  const allSelected =
    downloadableIds.length > 0 && downloadableIds.every((id) => selected.has(id));
  const zipBusy = zip.phase === "rendering" || zip.phase === "zipping";

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(downloadableIds));

  // ── Bulk ZIP ─────────────────────────────────────────────────────────
  async function downloadZip() {
    const ids = items.filter((it) => selected.has(it.id)).map((it) => it.id);
    if (ids.length === 0 || zipBusy) return;
    if (zipUrl.current) {
      URL.revokeObjectURL(zipUrl.current);
      zipUrl.current = null;
    }
    const ac = new AbortController();
    zipAbort.current = ac;
    setZip({ phase: "rendering", done: 0, total: ids.length });
    try {
      const out = await downloadBulkPdfZip({
        endpoint: "/api/reports/bulk-pdf",
        reportIds: ids,
        signal: ac.signal,
        onProgress: setZip,
      });
      zipUrl.current = out.url;
      triggerDownload(out.url, out.filename);
      setZip({ phase: "ready", ...out });
    } catch (err) {
      setZip(
        (err as Error).name === "AbortError"
          ? { phase: "idle" }
          : { phase: "error", message: (err as Error).message },
      );
    } finally {
      zipAbort.current = null;
    }
  }

  // ── Delete one run ───────────────────────────────────────────────────
  async function deleteRun(runId: string) {
    const res = await fetch(`/api/report/${runId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Delete failed (${res.status})`);
    }
    setSelected((prev) => {
      if (!prev.has(runId)) return prev;
      const next = new Set(prev);
      next.delete(runId);
      return next;
    });
    // The card is an ADDRESS: dropping its latest run promotes the next one;
    // dropping the only run removes the card.
    setItems((prev) =>
      prev.flatMap((it) => {
        if (!it.runs.some((r) => r.id === runId)) return [it];
        const runs = it.runs.filter((r) => r.id !== runId);
        if (runs.length === 0) return [];
        return [{ ...it, runs, id: runs[0].id, generatedAt: runs[0].generatedAt }];
      }),
    );
  }

  // ── Load more ────────────────────────────────────────────────────────
  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setLoadError(null);
    try {
      const p = new URLSearchParams({ cursor: nextCursor });
      if (q) p.set("q", q);
      if (filter !== "all") p.set("filter", filter);
      const res = await fetch(`/api/reports?${p.toString()}`);
      if (!res.ok) throw new Error(`Couldn't load more (${res.status})`);
      const page = (await res.json()) as ReportListPage;
      setItems((prev) => {
        const seen = new Set(prev.map((it) => it.addressId));
        return [...prev, ...page.items.filter((it) => !seen.has(it.addressId))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setLoadError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = q !== "" || filter !== "all";
  const selectedCount = [...selected].filter((id) => items.some((it) => it.id === id)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filters */}
      <div className="flex flex-col gap-3">
        <label className="glass flex h-11 items-center gap-2 rounded-full px-4">
          {navPending ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" />
          )}
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (searchTimer.current) clearTimeout(searchTimer.current);
                navigate(text, filter);
              }
            }}
            placeholder="Search by address or suburb"
            aria-label="Search reports"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                setText("");
                if (searchTimer.current) clearTimeout(searchTimer.current);
                navigate("", filter);
              }}
              aria-label="Clear search"
              className="text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => {
            const on = f.id === filter;
            return (
              <Link
                key={f.id}
                href={listHref(q, f.id)}
                replace
                aria-current={on ? "page" : undefined}
                className={`inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium transition ${
                  on
                    ? "bg-foreground text-background"
                    : "glass text-foreground/70 hover:text-foreground"
                }`}
              >
                {f.label}
              </Link>
            );
          })}
          {downloadableIds.length > 0 && (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-muted-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="size-3.5 accent-[var(--apple-blue)]"
              />
              Select all downloadable ({downloadableIds.length})
            </label>
          )}
        </div>
      </div>

      {/* List */}
      {items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-12 text-center">
          <FileText className="size-6 text-muted-foreground" />
          {filtered ? (
            <>
              <p className="text-[14px] text-muted-foreground">No reports match.</p>
              <Link
                href="/reports"
                replace
                className="text-[13px] font-medium text-foreground underline underline-offset-2"
              >
                Clear search and filters
              </Link>
            </>
          ) : (
            <>
              <p className="text-[14px] text-muted-foreground">
                No reports yet. Run your first one from the home page.
              </p>
              <Link
                href="/"
                className="mt-1 inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-white"
                style={{
                  background:
                    "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
                }}
              >
                Run a report <ArrowRight className="size-4" />
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((it) => (
            <ReportCard
              key={it.addressId}
              item={it}
              selectable={downloadable(it)}
              selected={selected.has(it.id)}
              onToggle={toggle}
              onDelete={deleteRun}
            />
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="glass inline-flex h-10 items-center gap-2 rounded-full px-5 text-[13.5px] font-medium text-foreground/80 transition hover:text-foreground disabled:opacity-70"
          >
            {loadingMore && <Loader2 className="size-4 animate-spin" />}
            Load more
          </button>
          {loadError && <p className="text-[12px] text-[var(--apple-red)]">{loadError}</p>}
        </div>
      )}

      {/* Selection bar: sticks to the bottom while something's ticked. */}
      {(selectedCount > 0 || zip.phase !== "idle") && (
        <div className="sticky bottom-4 z-20 mt-2">
          <div className="glass-strong flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 shadow-xl">
            <span className="text-[13px] font-medium">
              {zip.phase === "rendering"
                ? `Rendering ${zip.done} / ${zip.total}…`
                : zip.phase === "zipping"
                  ? `Zipping ${zip.count} ${zip.count === 1 ? "PDF" : "PDFs"}…`
                  : zip.phase === "ready"
                    ? `${zip.rendered} ${zip.rendered === 1 ? "PDF" : "PDFs"} bundled${
                        zip.failed ? ` · ${zip.failed} skipped` : ""
                      }`
                    : zip.phase === "error"
                      ? zip.message
                      : `${selectedCount} selected`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {zip.phase === "ready" && (
                <a
                  href={zip.url}
                  download={zip.filename}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-white"
                  style={{ background: "var(--apple-green)" }}
                >
                  <FileArchive className="size-4" />
                  Save ZIP
                </a>
              )}
              {/* Side-by-side view of two or three ticked reports. */}
              {!zipBusy && selectedCount >= 2 && selectedCount <= 3 && (
                <Link
                  href={`/reports/compare?ids=${items.filter((it) => selected.has(it.id)).map((it) => it.id).join(",")}`}
                  className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold"
                >
                  <Columns3 className="size-4" />
                  Compare {selectedCount}
                </Link>
              )}
              {zipBusy ? (
                <button
                  type="button"
                  onClick={() => zipAbort.current?.abort()}
                  className="glass inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium"
                >
                  <Loader2 className="size-4 animate-spin" />
                  Cancel
                </button>
              ) : (
                selectedCount > 0 && (
                  <button
                    type="button"
                    onClick={downloadZip}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-white"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
                    }}
                  >
                    <FileArchive className="size-4" />
                    Download {selectedCount} as ZIP
                  </button>
                )
              )}
              {!zipBusy && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(new Set());
                    setZip({ phase: "idle" });
                  }}
                  aria-label="Clear selection"
                  className="glass flex size-9 items-center justify-center rounded-full text-foreground/70 transition hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

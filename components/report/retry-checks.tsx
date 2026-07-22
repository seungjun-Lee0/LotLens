"use client";

// Shown at the top of a report when one or more module sources were
// unreachable during the last run (fetchFailed rows). One click re-runs
// the fetch pipeline server-side against the SAME report — no new report,
// no credit spend — then refreshes the page with whatever now succeeded.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, TriangleAlert } from "lucide-react";

export function RetryChecks({
  reportId,
  failedCount,
}: {
  reportId: string;
  failedCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const running = busy || pending;

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/report/${reportId}/retry`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(body?.error ?? `retry failed (${res.status})`);
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-3xl border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-4"
      style={{
        borderColor: "color-mix(in oklab, var(--apple-orange) 35%, transparent)",
        background: "color-mix(in oklab, var(--apple-orange) 7%, var(--card))",
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: "color-mix(in oklab, var(--apple-orange) 16%, transparent)",
            color: "var(--apple-orange)",
          }}
        >
          <TriangleAlert className="size-4" />
        </span>
        <div>
          <p className="text-[14px] font-semibold tracking-tight">
            {failedCount} check{failedCount > 1 ? "s" : ""} couldn&apos;t reach{" "}
            {failedCount > 1 ? "their sources" : "its source"}
          </p>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Government map servers are occasionally briefly unavailable.
            {error
              ? ` Retry failed: ${error}`
              : " Re-run the failed checks. The rest of the report is unaffected."}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={retry}
        disabled={running}
        className="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 self-start rounded-full px-4 text-[13px] font-semibold text-white transition disabled:cursor-default disabled:opacity-60 sm:self-auto"
        style={{ background: "var(--apple-orange)" }}
      >
        <RefreshCw className={`size-4 ${running ? "animate-spin" : ""}`} />
        {running ? "Re-running checks…" : "Re-run checks"}
      </button>
    </section>
  );
}

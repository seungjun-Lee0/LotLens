"use client";

// One address in "My reports": aerial thumbnail, address, run date, the
// risk verdict (worst severity + flagged-module icons, the same numbers the
// report's At-a-glance shows) and row actions. `compact` is the account
// page's recent-reports hub: no thumbnail, selection or actions.

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Loader2,
  Lock,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { DownloadPdfButton } from "@/components/report/download-pdf-button";
import { heroAerialUrl } from "@/lib/aerial";
import { formatAuAddress } from "@/lib/format-address";
import { MODULE_META } from "@/lib/module-meta";
import type { ReportListItem } from "@/lib/reports";
import { RISK_STYLE } from "@/lib/risk-style";

// Fixed zone so the server render and the browser agree on the day (a
// UTC-evening timestamp is "tomorrow" in Brisbane) — a locale-only format
// would hydrate with a mismatch for any viewer outside AEST.
export function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });
}

function PaidPill({ paid }: { paid: boolean }) {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
      style={{
        background: paid
          ? "color-mix(in oklab, var(--apple-green) 14%, transparent)"
          : "color-mix(in oklab, var(--apple-blue) 12%, transparent)",
        color: paid ? "var(--apple-green)" : "var(--apple-blue)",
      }}
    >
      {paid ? "Full" : "Preview"}
    </span>
  );
}

/** "High · 3 considerations" chip + the flagged modules' icons, or a green
 * "All clear". Severity is colour-only (RISK_STYLE), module identity is
 * the icon — same rule as the report body. */
function RiskSummary({ item, dense = false }: { item: ReportListItem; dense?: boolean }) {
  if (item.flagged === 0 || !item.worst) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[12px] font-medium"
        style={{ color: "var(--apple-green)" }}
      >
        <Check className="size-3.5" />
        All clear
      </span>
    );
  }
  const style = RISK_STYLE[item.worst];
  const icons = item.flaggedModules.slice(0, dense ? 3 : 6);
  const extra = item.flaggedModules.length - icons.length;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
        style={{
          background: `color-mix(in oklab, ${style.cssVar} 14%, transparent)`,
          color: style.cssVar,
        }}
      >
        <TriangleAlert className="size-3.5" />
        {style.label} · {item.flagged} {item.flagged === 1 ? "consideration" : "considerations"}
      </span>
      {!dense && (
        <span className="inline-flex items-center gap-1">
          {icons.map((m) => {
            const meta = MODULE_META[m];
            if (!meta) return null;
            const Icon = meta.icon;
            return (
              <span
                key={m}
                title={meta.name}
                className="flex size-5 items-center justify-center rounded-md"
                style={{
                  background: `color-mix(in oklab, ${meta.tint} 16%, transparent)`,
                  color: meta.tint,
                }}
              >
                <Icon className="size-3" />
              </span>
            );
          })}
          {extra > 0 && (
            <span className="text-[11px] text-muted-foreground">+{extra}</span>
          )}
        </span>
      )}
    </span>
  );
}

export function ReportCard({
  item,
  compact = false,
  selectable = false,
  selected = false,
  onToggle,
  onDelete,
}: {
  item: ReportListItem;
  compact?: boolean;
  /** Whether the checkbox is enabled (unlocked, or the viewer is admin). */
  selectable?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
  /** Called after the user confirms; resolves when the server has deleted
   * the run (the parent updates its list). Absent = no delete control. */
  onDelete?: (runId: string) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const address = formatAuAddress(item.addressText, item.postcode);
  const href = `/report/${item.id}`;
  const earlier = item.runs.slice(1);

  async function confirmDelete(runId: string) {
    if (!onDelete) return;
    setDeleting(runId);
    setDeleteError(null);
    try {
      await onDelete(runId);
      setConfirming(null);
    } catch (err) {
      setDeleteError((err as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  if (compact) {
    return (
      <Link
        href={href}
        className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition hover:bg-foreground/5"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{address}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
            <span>{formatRunDate(item.generatedAt)}</span>
            <RiskSummary item={item} dense />
          </div>
        </div>
        <PaidPill paid={item.paid} />
        <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  return (
    <li
      className={`glass rounded-2xl p-3 transition sm:p-4 ${
        selected ? "ring-2 ring-[var(--apple-blue)]" : ""
      }`}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Selection: previews can't be bundled (the PDF route's paywall),
            so their box is disabled with the reason in the tooltip. */}
        {onToggle && (
          <label
            className={`mt-1 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition sm:mt-5 ${
              selectable
                ? selected
                  ? "border-[var(--apple-blue)] bg-[var(--apple-blue)] text-white"
                  : "border-border bg-background/60 hover:border-foreground/40"
                : "cursor-not-allowed border-border/60 opacity-40"
            }`}
            title={selectable ? "Select for download" : "Unlock this report to download it"}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={selected}
              disabled={!selectable}
              onChange={() => onToggle(item.id)}
              aria-label={`Select ${address}`}
            />
            {selected && <Check className="size-3.5" />}
          </label>
        )}

        <Link
          href={href}
          className="hidden shrink-0 overflow-hidden rounded-xl bg-foreground/[0.06] sm:block"
          style={{ width: 112, height: 72 }}
          tabIndex={-1}
          aria-hidden
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={heroAerialUrl(item.lat, item.lng, 336, 216)}
            alt=""
            width={112}
            height={72}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        </Link>

        <div className="min-w-0 flex-1">
          <Link href={href} className="block truncate text-[14.5px] font-medium hover:underline">
            {address}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
            <span>{formatRunDate(item.generatedAt)}</span>
            <PaidPill paid={item.paid} />
            {item.lga && (
              <span className="truncate rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[10.5px] font-medium">
                {item.lga}
              </span>
            )}
            {item.runs.length > 1 && (
              <span className="text-[11.5px]">
                {item.runs.length} runs
              </span>
            )}
          </div>
          <div className="mt-2">
            <RiskSummary item={item} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:mt-3">
          {item.paid ? (
            <DownloadPdfButton reportId={item.id} iconOnly small />
          ) : (
            <Link
              href={href}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
              }}
            >
              <Lock className="size-3.5" />
              Unlock
            </Link>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => setConfirming(confirming === item.id ? null : item.id)}
              aria-label="Delete report"
              title="Delete report"
              className="glass flex size-9 items-center justify-center rounded-full text-foreground/60 transition hover:text-[var(--apple-red)]"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Earlier runs of the same address, collapsed: the card IS the latest
          run, these are the versions behind it. */}
      {earlier.length > 0 && (
        <details className="group mt-2 sm:ml-[136px]">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-muted-foreground transition hover:text-foreground">
            <ChevronDown className="size-3.5 transition group-open:rotate-180" />
            {earlier.length} earlier {earlier.length === 1 ? "run" : "runs"}
          </summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {earlier.map((run) => (
              <li key={run.id} className="flex items-center gap-2 text-[12.5px]">
                <Link
                  href={`/report/${run.id}`}
                  className="text-foreground/80 underline-offset-2 hover:underline"
                >
                  {formatRunDate(run.generatedAt)}
                </Link>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => setConfirming(confirming === run.id ? null : run.id)}
                    aria-label="Delete this run"
                    className="text-muted-foreground transition hover:text-[var(--apple-red)]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {confirming && onDelete && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] sm:ml-[136px]"
          style={{ background: "color-mix(in oklab, var(--apple-red) 8%, transparent)" }}
        >
          <span className="font-medium">
            Delete {confirming === item.id ? "this report" : "this run"}? This can&rsquo;t be undone.
          </span>
          <button
            type="button"
            onClick={() => confirmDelete(confirming)}
            disabled={deleting !== null}
            className="inline-flex h-7 items-center gap-1 rounded-full px-3 font-semibold text-white disabled:opacity-70"
            style={{ background: "var(--apple-red)" }}
          >
            {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Delete
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(null);
              setDeleteError(null);
            }}
            disabled={deleting !== null}
            className="h-7 rounded-full px-3 font-medium text-foreground/70 hover:text-foreground"
          >
            Cancel
          </button>
          {deleteError && (
            <span className="w-full text-[var(--apple-red)]">{deleteError}</span>
          )}
        </div>
      )}
    </li>
  );
}

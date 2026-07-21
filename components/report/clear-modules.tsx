// "Checked & clear" strip — the clear-module diet. A module with nothing
// on the lot doesn't earn a full section with a map; it earns a compact
// evidence row (what was checked, against which source, verdict). Keeps
// the "15 layers checked" completeness value without 12 screens of
// nothing-to-see.

import { Check } from "lucide-react";

import { MODULE_META } from "@/lib/module-meta";
import type { ModuleNarrative } from "@/lib/anthropic";
import type { ReportModuleRow } from "@/lib/pipeline";
import type { Module } from "@/lib/db";

export function ClearModules({
  rows,
  narrative,
}: {
  rows: ReportModuleRow[];
  narrative: Partial<Record<Module, ModuleNarrative>>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm">
      <div className="px-5 py-6 sm:px-10 sm:py-9">
        <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          Checked &amp; clear
        </h2>
        <p className="mt-2 max-w-xl text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">
          These {rows.length} checks ran against the same council and
          Queensland Government layers and found nothing on the lot.
        </p>
        <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {rows.map((m) => {
            const meta = MODULE_META[m.module];
            const Icon = meta.icon;
            const summary = narrative[m.module]?.summary;
            return (
              <li
                key={m.module}
                className="flex items-start gap-3 rounded-2xl border border-border/40 bg-background/40 px-3.5 py-3"
              >
                <div
                  className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl"
                  style={{
                    background: `color-mix(in oklab, ${meta.tint} 14%, transparent)`,
                    color: meta.tint,
                  }}
                >
                  <Icon className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13.5px] font-semibold tracking-tight">
                      {meta.name}
                    </span>
                    <Check
                      className="size-3.5 shrink-0"
                      strokeWidth={3}
                      style={{ color: "var(--apple-green)" }}
                    />
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">
                    {summary ?? meta.sourceLabel}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// Consolidated "Next steps" — every flagged module's questions-to-ask in
// one checklist the buyer can forward to their conveyancer, instead of
// leaving them scattered across module sections.

import { ListChecks } from "lucide-react";

import { MODULE_META } from "@/lib/module-meta";
import { RISK_STYLE, riskOf } from "@/lib/risk-style";
import type { ModuleNarrative } from "@/lib/anthropic";
import type { ReportModuleRow } from "@/lib/pipeline";
import type { Module } from "@/lib/db";

export function NextSteps({
  rows,
  narrative,
}: {
  /** Flagged modules, already in severity order. */
  rows: ReportModuleRow[];
  narrative: Partial<Record<Module, ModuleNarrative>>;
}) {
  const groups = rows
    .map((m) => ({
      module: m.module,
      level: riskOf(m.riskLevel, m.hasConsideration),
      questions: (narrative[m.module]?.questions_to_ask ?? []).slice(0, 4),
    }))
    .filter((g) => g.questions.length > 0);
  if (groups.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/60 bg-card/85 backdrop-blur-sm">
      <div className="px-5 py-6 sm:px-10 sm:py-9">
        <div className="flex items-center gap-3">
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
            style={{
              background: "color-mix(in oklab, var(--apple-blue) 14%, transparent)",
              color: "var(--apple-blue)",
            }}
          >
            <ListChecks className="size-5" />
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Next steps
          </h2>
        </div>
        <p className="mt-3 max-w-xl text-pretty text-[13.5px] leading-relaxed text-muted-foreground sm:text-[14px]">
          Every question raised by the flagged checks, in one place. Hand
          this list to your conveyancer, building inspector or the Council.
        </p>
        <div className="mt-5 flex flex-col gap-5">
          {groups.map((g) => {
            const meta = MODULE_META[g.module];
            return (
              <div key={g.module}>
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: RISK_STYLE[g.level].cssVar }}
                  />
                  <span className="text-[13px] font-semibold tracking-tight">
                    {meta.name}
                  </span>
                  <span
                    className="text-[10.5px] font-semibold uppercase tracking-[0.12em]"
                    style={{ color: RISK_STYLE[g.level].cssVar }}
                  >
                    {RISK_STYLE[g.level].label}
                  </span>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {g.questions.map((q, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-foreground/85"
                    >
                      <span
                        aria-hidden
                        className="mt-1.5 size-[13px] shrink-0 rounded-[4px] border border-border"
                      />
                      {q}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

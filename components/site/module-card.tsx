import type { LucideIcon } from "lucide-react";

export type ModuleStatus = "none" | "low" | "medium" | "high";

const statusCopy: Record<ModuleStatus, string> = {
  none: "No consideration",
  low: "Low",
  medium: "Medium",
  high: "High",
};

const statusTint: Record<ModuleStatus, string> = {
  none: "var(--apple-green)",
  low: "var(--apple-teal)",
  medium: "var(--apple-orange)",
  high: "var(--apple-red)",
};

export function ModuleCard({
  icon: Icon,
  name,
  source,
  blurb,
  tint,
  status,
}: {
  icon: LucideIcon;
  name: string;
  source: string;
  blurb: string;
  tint: string; // CSS color expression
  status: ModuleStatus;
}) {
  return (
    <div
      className="group relative flex flex-col gap-4 rounded-3xl border border-border/60 bg-card/80 p-6 shadow-[0_1px_0_0_rgba(255,255,255,0.6)_inset,0_8px_24px_-12px_rgba(15,23,42,0.12)] backdrop-blur-sm transition hover:shadow-[0_1px_0_0_rgba(255,255,255,0.7)_inset,0_18px_40px_-18px_rgba(15,23,42,0.2)]"
    >
      <div className="flex items-center justify-between">
        <div
          className="flex size-10 items-center justify-center rounded-2xl"
          style={{
            background: `linear-gradient(135deg, color-mix(in oklab, ${tint} 22%, transparent), color-mix(in oklab, ${tint} 6%, transparent))`,
            color: tint,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tint} 25%, transparent)`,
          }}
        >
          <Icon className="size-5" />
        </div>
        <span
          className="glass-tint rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ ["--tint" as string]: statusTint[status] }}
        >
          {statusCopy[status]}
        </span>
      </div>
      <div>
        <div className="text-[15px] font-semibold tracking-tight">{name}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {source}
        </div>
      </div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground text-pretty">
        {blurb}
      </p>
    </div>
  );
}

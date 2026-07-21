import type { RiskLevel } from "@/lib/db";
import { RISK_STYLE } from "@/lib/risk-style";

export function RiskBadge({
  level,
  size = "md",
}: {
  level: RiskLevel;
  size?: "sm" | "md";
}) {
  const s = RISK_STYLE[level];
  const label = level === "none" ? "No consideration" : s.label;
  return (
    <span
      className={
        "glass-tint inline-flex items-center gap-1.5 rounded-full font-medium " +
        (size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]")
      }
      style={{ ["--tint" as string]: s.cssVar }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: s.cssVar }}
      />
      {label}
    </span>
  );
}

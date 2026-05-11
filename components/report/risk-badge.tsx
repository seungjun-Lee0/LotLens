import type { RiskLevel } from "@/lib/supabase";

const STYLE: Record<RiskLevel, { label: string; tint: string }> = {
  high:     { label: "High",          tint: "var(--apple-red)" },
  medium:   { label: "Medium",        tint: "var(--apple-orange)" },
  low:      { label: "Low",           tint: "var(--apple-teal)" },
  very_low: { label: "Very low",      tint: "var(--apple-yellow)" },
  none:     { label: "No consideration", tint: "var(--apple-green)" },
};

export function RiskBadge({
  level,
  size = "md",
}: {
  level: RiskLevel;
  size?: "sm" | "md";
}) {
  const s = STYLE[level];
  return (
    <span
      className={
        "glass-tint inline-flex items-center gap-1.5 rounded-full font-medium " +
        (size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]")
      }
      style={{ ["--tint" as string]: s.tint }}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full"
        style={{ background: s.tint }}
      />
      {s.label}
    </span>
  );
}

// ONE severity scale for every consideration/warning surface — web report,
// at-a-glance, PDF. A "Considerations" chip must read the same colour
// whether the module is flooding (blue) or heritage (purple): severity is
// encoded by colour alone, module identity stays on the icon/tint.
//
// Ramp is monotonic hot→cold: red > orange > gold > teal > green.

import type { RiskLevel } from "@/lib/db";

export type RiskStyle = {
  label: string;
  /** CSS colour for web surfaces (theme-aware via custom properties). */
  cssVar: string;
  /** Print-legible hex for React-PDF (dark enough to read on white). */
  hex: string;
};

export const RISK_STYLE: Record<RiskLevel, RiskStyle> = {
  high:     { label: "High",      cssVar: "var(--apple-red)",    hex: "#e02d24" },
  medium:   { label: "Medium",    cssVar: "var(--apple-orange)", hex: "#e08700" },
  // Apple yellow is unreadable as text on light surfaces — the web uses a
  // dedicated --risk-low custom property (darker gold in light mode,
  // bright yellow in dark), print uses a dark gold.
  low:      { label: "Low",       cssVar: "var(--risk-low)",     hex: "#b08a00" },
  very_low: { label: "Very low",  cssVar: "var(--apple-teal)",   hex: "#1f8fc4" },
  none:     { label: "All clear", cssVar: "var(--apple-green)",  hex: "#248a3d" },
};

/** Effective severity for a module row — rows written before risk levels
 * existed have NULL; a flagged row without a level reads as Medium. */
export function riskOf(
  riskLevel: RiskLevel | null | undefined,
  hasConsideration: boolean,
): RiskLevel {
  return riskLevel ?? (hasConsideration ? "medium" : "none");
}

/** Sort weight, most severe first. */
export const RISK_RANK: Record<RiskLevel, number> = {
  high: 4,
  medium: 3,
  low: 2,
  very_low: 1,
  none: 0,
};

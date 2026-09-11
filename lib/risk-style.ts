// ONE severity scale for every consideration/warning surface: web report,
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
  // Apple yellow is unreadable as text on light surfaces: the web uses a
  // dedicated --risk-low custom property (darker gold in light mode,
  // bright yellow in dark), print uses a dark gold.
  low:      { label: "Low",       cssVar: "var(--risk-low)",     hex: "#b08a00" },
  very_low: { label: "Very low",  cssVar: "var(--apple-teal)",   hex: "#1f8fc4" },
  // Deliberately OFF the hot→cold ramp: neutral grey, so an informational
  // finding can never be misread as "the mildest warning". It sits in its
  // own lane with its own heading, so it doesn't compete for ramp colours.
  informational: { label: "For information", cssVar: "var(--apple-gray)", hex: "#6b7280" },
  none:     { label: "All clear", cssVar: "var(--apple-green)",  hex: "#248a3d" },
};

/** Effective severity for a module row: rows written before risk levels
 * existed have NULL; a flagged row without a level reads as Medium. */
export function riskOf(
  riskLevel: RiskLevel | null | undefined,
  hasConsideration: boolean,
): RiskLevel {
  return riskLevel ?? (hasConsideration ? "medium" : "none");
}

/**
 * The module found something, but that something is not a warning -
 * a school catchment, the zone code, the nearest bus stop.
 *
 * These rows keep `hasConsideration: true` so they still get a full
 * report section and PDF page (that flag is what allocates them). This
 * predicate is what everything ELSE must branch on: the consideration
 * count, the "Needs attention" list, Next steps, and the ⚠ chip.
 */
export function isInformational(
  riskLevel: RiskLevel | null | undefined,
  hasConsideration: boolean,
): boolean {
  return hasConsideration && riskOf(riskLevel, hasConsideration) === "informational";
}

/** A genuine warning: the module found something AND it's a risk. */
export function isFlagged(
  riskLevel: RiskLevel | null | undefined,
  hasConsideration: boolean,
): boolean {
  return hasConsideration && !isInformational(riskLevel, hasConsideration);
}

/**
 * The module's source layer does not exist / is not integrated for this
 * LGA (`available: false` from unavailableForLga). NOT a clear result:
 * nothing was checked, so the report must say "No source information
 * available" rather than fold it into "Checked & clear" with a green tick.
 * Distinct from `fetchFailed` (source exists but was unreachable this run).
 */
export function isUnavailable(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { available?: unknown }).available === false
  );
}

/** Copy for the unavailable state: the same wording on the web pill, the
 * PDF page and the At-a-glance strip. */
export const NO_SOURCE_LABEL = "No source information available";

/** True when a narrative or note is just the generic no-source line, so
 * the section can drop it: the status pill already says it once, and the
 * summary, "For this property" box and facts panel each echoing it read
 * as four copies of the same sentence. A SPECIFIC note ("Pipe locations
 * only: …") is still worth a row. */
export function isNoSourceText(s: unknown): boolean {
  return (
    typeof s === "string" &&
    s.trim().replace(/\.$/, "").toLowerCase() === NO_SOURCE_LABEL.toLowerCase()
  );
}

/** Sort weight, most severe first. Informational is off the ramp. */
export const RISK_RANK: Record<RiskLevel, number> = {
  high: 4,
  medium: 3,
  low: 2,
  very_low: 1,
  informational: 0,
  none: 0,
};

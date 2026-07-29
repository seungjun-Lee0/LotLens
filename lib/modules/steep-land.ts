// Steep land / landslide module — council landslide & steep-land overlays.
//
// Develo's "Steep Land" page. Landslide hazard is a council planning-scheme
// matter (there is NO statewide landslide REST layer — verified 2026-07),
// so this module runs through per-council adapters:
//   Brisbane        City Plan 2014 Landslide overlay (OVL2_DESC)
//   Moreton Bay     Landslide Hazard Overlay
//   Sunshine Coast  Landslide Hazard and Steep Land Overlay (slope classes)
//   Redland         Landslide Hazard Overlay (CLASS)
//
// The overlay half of the module is therefore Brisbane + 4. The ELEVATION
// half is statewide: Queensland publishes LiDAR contours for the whole
// state, so every address gets a measured high/low/fall across the lot even
// where no council overlay exists. That turns "not integrated for this
// council" from an empty page into a page with the number buyers actually
// asked for.

import type { Geometry } from "geojson";
import {
  councilOf,
  overlayLabels,
  queryOverlayAdapter,
  STEEP_ADAPTERS,
} from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";
import {
  fetchElevationProfile,
  QLD_CONTOUR_DOC,
  type ElevationProfile,
} from "@/lib/modules/elevation";
import { RISK_RANK } from "@/lib/risk-style";
import { unavailableForLga, type Region } from "@/lib/region";

export type SteepLandResult = {
  riskLevel: RiskLevel;
  /** Overlay label at the point, e.g. "Landslide hazard area" / slope class. */
  category: string | null;
  /** Measured elevation range over the lot. null when no contour layer has
   * coverage. Present independently of the council overlay. */
  elevation: ElevationProfile | null;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

const EMPTY_FC = { type: "FeatureCollection", features: [] } as const;

function classifySteep(label: string | null, hit: boolean): RiskLevel {
  if (!hit) return "none";
  const s = (label ?? "").toLowerCase();
  if (s.includes("very high") || s.includes("high")) return "high";
  if (s.includes("moderate") || s.includes("medium")) return "medium";
  if (s.includes("low")) return "low";
  // Presence in a landslide/steep overlay without a graded label is a
  // geotech-report trigger either way.
  return "medium";
}

export async function fetchSteepLandData(
  lat: number,
  lng: number,
  region?: Region,
  lot?: Geometry | null,
): Promise<SteepLandResult> {
  // No `?? "brisbane"` fallback here — unlike the other adapter tables this
  // one HAS a brisbane entry, so an unknown LGA must not silently query
  // Brisbane's overlay and report a false "clear".
  const councilId = councilOf(region);
  const adapter = councilId ? STEEP_ADAPTERS[councilId] : undefined;

  // Contours are statewide and independent of the overlay, so fetch them
  // for every address — including the ones with no council adapter. A
  // contour miss is "not measurable here", not a module failure, so this
  // never rejects the whole module.
  const elevationPromise = fetchElevationProfile(lat, lng, lot).catch(() => null);

  if (!adapter) {
    const elevation = await elevationPromise;
    // With elevation in hand the page is no longer empty, so don't mark it
    // unavailable — say plainly that the hazard overlay is the missing
    // half. Without it, fall back to the old "not integrated" page.
    if (!elevation) {
      return {
        riskLevel: "none",
        category: null,
        elevation: null,
        hasConsideration: false,
        sources: [
          {
            name: "Council planning scheme — landslide/steep land overlay",
            url: "https://planning.statedevelopment.qld.gov.au/planning-framework/mapping",
            layer: "",
          },
        ],
        raw: EMPTY_FC,
        context: EMPTY_FC,
        ...unavailableForLga(
          region ?? { lga: null, isBrisbane: false },
          "The landslide / steep land overlay",
        ),
      };
    }
    return {
      // Elevation alone never grades a severity. Turning "6 m of fall" into
      // a warning would need a slope threshold we can't validate against
      // any council's rules, and inventing one re-creates exactly the
      // false-alarm problem the informational lane exists to solve.
      riskLevel: "informational",
      category: null,
      elevation,
      hasConsideration: true,
      sources: [
        {
          name: "Queensland Government — LiDAR contours",
          url: QLD_CONTOUR_DOC,
          layer: "",
        },
      ],
      raw: { overlay: EMPTY_FC, contours: elevation.contours },
      context: { overlay: EMPTY_FC, contours: elevation.contextContours },
      available: true,
      availabilityNote: `Elevation is measured from statewide ${elevation.interval} contours. The council landslide / steep land overlay has not been integrated for this local government area yet — treat the hazard question as an open item.`,
    };
  }

  const [{ point, context }, elevation] = await Promise.all([
    queryOverlayAdapter(adapter, lat, lng, lot),
    elevationPromise,
  ]);
  const hit = point.features.length > 0;
  // Worst band across all returned features — feature order isn't stable.
  // (classifySteep(null, true) grades "medium", so rank the null seed -1.)
  const RANK = RISK_RANK;
  const label = overlayLabels(point, adapter.labelFields).reduce<string | null>(
    (worst, l) =>
      RANK[classifySteep(l, true)] > (worst === null ? -1 : RANK[classifySteep(worst, true)])
        ? l
        : worst,
    null,
  );
  const overlayRisk = classifySteep(label, hit);
  // The overlay drives severity when it fires. When it doesn't, a measured
  // elevation range still keeps the page worth reading — as a fact.
  const riskLevel: RiskLevel =
    overlayRisk !== "none" ? overlayRisk : elevation ? "informational" : "none";

  return {
    riskLevel,
    category: label ?? (hit ? "Landslide / steep land overlay area" : null),
    elevation,
    hasConsideration: riskLevel !== "none",
    sources: [
      { name: adapter.sourceName, url: adapter.docUrl, layer: adapter.url },
      ...(elevation
        ? [
            {
              name: `Queensland Government — ${elevation.interval} contours`,
              url: QLD_CONTOUR_DOC,
              layer: "",
            },
          ]
        : []),
    ],
    raw: { overlay: point, contours: elevation?.contours ?? EMPTY_FC },
    context: { overlay: context, contours: elevation?.contextContours ?? EMPTY_FC },
    available: true,
  };
}

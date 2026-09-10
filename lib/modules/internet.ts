// Internet availability module: the nbn access-technology footprint.
//
// Develo's "Internet Availability" page. Source: the Commonwealth
// Department of Infrastructure's NBN coverage footprints map service
// (spatial.infrastructure.gov.au), the March 2024 fixed-line and fixed-
// wireless polygons NBN Co supplied to the Department. Published on
// data.gov.au under CC BY 4.0 (copyright NBN Co), so it can be reproduced
// in a paid report with attribution.
//
// What it answers: which nbn access network serves this area: fixed line
// (FTTP/FTTN/HFC/FTTC, not distinguished in this dataset), fixed wireless,
// or neither (satellite territory). What it does NOT answer: the
// per-premises technology or speed tier, which sits behind nbn's
// address-lookup API and is licensed to retailers only. So the module is
// a facts page: `informational`, never a warning.

import type { Geometry } from "geojson";

import { queryOverlayAdapter, type OverlayAdapter } from "@/lib/councils";
import type { RiskLevel } from "@/lib/db";

const NBN_BASE =
  "https://spatial.infrastructure.gov.au/server/rest/services/NBN_Coverage_Footprints_2024/MapServer";
const NBN_DOC = "https://data.gov.au/data/dataset/national-broadband-network";

// The footprints are per-area polygons of a few km across, and small on
// the wire (2-9 KB generalised at every metro point checked), so the
// context is NOT clipped: a footprint sliced to the ~500 m fetch window
// drew as a neat square around the lot the moment the reader zoomed out,
// which read as the footprint's real edge.
const FOOTPRINTS: Array<OverlayAdapter & { kind: "fixed_line" | "fixed_wireless" }> = [
  {
    kind: "fixed_line",
    url: `${NBN_BASE}/2/query`,
    sourceName: "nbn fixed line footprint (March 2024)",
    docUrl: NBN_DOC,
    labelFields: ["polygon_id"],
  },
  {
    kind: "fixed_wireless",
    url: `${NBN_BASE}/3/query`,
    sourceName: "nbn fixed wireless footprint (March 2024)",
    docUrl: NBN_DOC,
    labelFields: ["FID_Grid"],
  },
];

export type InternetResult = {
  riskLevel: RiskLevel;
  /** "Fixed line" | "Fixed wireless" | null (outside both footprints). */
  accessNetwork: string | null;
  /** True when the lot sits inside the fixed-line footprint. */
  fixedLine: boolean;
  fixedWireless: boolean;
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
  available: boolean;
  availabilityNote?: string;
};

export async function fetchInternetData(
  lat: number,
  lng: number,
  lot?: Geometry | null,
): Promise<InternetResult> {
  const results = await Promise.all(
    FOOTPRINTS.map((a) => queryOverlayAdapter(a, lat, lng, lot)),
  );
  const hit = (kind: "fixed_line" | "fixed_wireless") =>
    results[FOOTPRINTS.findIndex((a) => a.kind === kind)].point.features.length > 0;
  const fixedLine = hit("fixed_line");
  const fixedWireless = hit("fixed_wireless");
  const accessNetwork = fixedLine ? "Fixed line" : fixedWireless ? "Fixed wireless" : null;

  const fc = (key: "point" | "context", kind: "fixed_line" | "fixed_wireless") => ({
    ...results[FOOTPRINTS.findIndex((a) => a.kind === kind)][key],
    features: results[FOOTPRINTS.findIndex((a) => a.kind === kind)][key].features.map((f) => ({
      ...f,
      properties: { ...(f.properties ?? {}), nbnKind: kind },
    })),
  });

  return {
    // Always a fact: inside a footprint or not, there is nothing to warn
    // about, only something to know before signing up with a provider.
    riskLevel: "informational",
    accessNetwork,
    fixedLine,
    fixedWireless,
    hasConsideration: true,
    sources: FOOTPRINTS.map((a) => ({ name: a.sourceName, url: a.docUrl, layer: a.url })),
    raw: { fixedLine: fc("point", "fixed_line"), fixedWireless: fc("point", "fixed_wireless") },
    context: {
      fixedLine: fc("context", "fixed_line"),
      fixedWireless: fc("context", "fixed_wireless"),
    },
    available: true,
    availabilityNote: accessNetwork
      ? undefined
      : "This address sits outside both the nbn fixed line and fixed wireless footprints in the March 2024 dataset, which usually means satellite (Sky Muster) is the nbn option. Confirm at nbnco.com.au/check-address.",
  };
}

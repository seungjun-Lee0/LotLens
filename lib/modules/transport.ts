// Public Transport module — TransLink stops, via the Queensland Government
// spatial service.
//
// Develo sources this from the raw GTFS feed. We don't need to: TMR
// republishes the same TransLink stops as queryable ArcGIS point layers on
// the host this codebase already talks to, so there's no zip to download,
// no CSV import and no table to keep in sync — one point query per mode.
//
// Endpoint: Transportation/OtherTransport/MapServer
//   101 Train station    102 Bus stop    103 Ferry terminal    104 Tram stops
//   Fields: stop_name, stop_code, identifier, wheelchair_boarding, zone_id
//
// Verified live 2026-07.
//
// This is a lifestyle fact, never a risk: it reports `informational`.

import type { Feature, Geometry, Position } from "geojson";

import { queryArcGIS } from "@/lib/arcgis";
import type { RiskLevel } from "@/lib/db";

const BASE =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/Transportation/OtherTransport/MapServer";

const TRANSLINK_DOC = "https://translink.com.au/";

/**
 * One query per mode. The search radii differ on purpose: a bus stop two
 * suburbs away tells you nothing, while a train station 2 km away is still
 * the reason people buy in a suburb. Values are degrees of latitude
 * (0.009° ≈ 1 km at Brisbane's latitude).
 */
const MODES = [
  { layer: 101, kind: "Train station", radiusDegrees: 0.018 },
  { layer: 103, kind: "Ferry terminal", radiusDegrees: 0.018 },
  { layer: 104, kind: "Tram stop", radiusDegrees: 0.018 },
  { layer: 102, kind: "Bus stop", radiusDegrees: 0.007 },
] as const;

export type TransportStop = {
  kind: string;
  name: string | null;
  code: string | null;
  /** Straight-line metres from the property. Not walking distance. */
  distanceM: number;
  wheelchair: boolean | null;
};

export type TransportResult = {
  riskLevel: RiskLevel;
  /** Nearest stop per mode, closest mode first. */
  stops: TransportStop[];
  hasConsideration: boolean;
  sources: Array<{ name: string; url: string; layer: string }>;
  raw: unknown;
  context: unknown;
};

const EARTH_RADIUS_M = 6_371_000;

function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** First coordinate pair of a point feature, or null for anything else. */
function pointOf(f: Feature<Geometry | null, unknown>): Position | null {
  const g = f.geometry;
  if (!g || g.type !== "Point") return null;
  const c = g.coordinates;
  return Array.isArray(c) && c.length >= 2 ? c : null;
}

export async function fetchTransportData(
  lat: number,
  lng: number,
): Promise<TransportResult> {
  const point = { x: lng, y: lat, spatialReference: 4326 } as const;

  const results = await Promise.all(
    MODES.map((mode) =>
      queryArcGIS(`${BASE}/${mode.layer}/query`, {
        geometry: point,
        geometryType: "esriGeometryPoint",
        inSR: 4326,
        outFields: "stop_name,stop_code,wheelchair_boarding",
        returnGeometry: true,
        bufferDegrees: mode.radiusDegrees,
      }),
    ),
  );

  const stops: TransportStop[] = [];
  results.forEach((fc, i) => {
    const mode = MODES[i];
    let best: TransportStop | null = null;
    for (const f of fc.features) {
      const c = pointOf(f);
      if (!c) continue;
      const distanceM = haversineM({ lat, lng }, { lat: c[1], lng: c[0] });
      if (best && distanceM >= best.distanceM) continue;
      const a = (f.properties ?? {}) as Record<string, unknown>;
      // GTFS encodes wheelchair_boarding as 0 unknown / 1 yes / 2 no, and
      // the layer surfaces it as either a number or its string form.
      const wc = Number(a.wheelchair_boarding);
      best = {
        kind: mode.kind,
        name: str(a.stop_name),
        code: str(a.stop_code),
        distanceM: Math.round(distanceM),
        wheelchair: wc === 1 ? true : wc === 2 ? false : null,
      };
    }
    if (best) stops.push(best);
  });

  stops.sort((a, b) => a.distanceM - b.distanceM);

  return {
    // Proximity to transport is a fact about the address, never a warning.
    riskLevel: stops.length > 0 ? "informational" : "none",
    stops,
    hasConsideration: stops.length > 0,
    sources: [
      {
        name: "TransLink public transport stops (Queensland Government)",
        url: TRANSLINK_DOC,
        layer: `${BASE}/102`,
      },
    ],
    // Every mode's full result set doubles as the map layer.
    raw: Object.fromEntries(MODES.map((m, i) => [m.kind, results[i]])),
    context: Object.fromEntries(MODES.map((m, i) => [m.kind, results[i]])),
  };
}

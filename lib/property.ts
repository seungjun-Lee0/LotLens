// Property parcel lookup — the real cadastre lot polygon + metadata.
//
// Source: Queensland DCDB (Land Parcel Property Framework) on QSpatial —
// statewide, nightly-updated, so any Queensland address resolves, not just
// Brisbane. Layer 4 = all cadastral parcels.
//
// Field highlights (lowercase in this service):
//   lot, plan, lotplan (e.g. "1RP84598")
//   lot_area (m²), tenure ("Freehold" etc.), parcel_typ
//   locality (suburb), shire_name (LGA, e.g. "Gold Coast City") — this is
//   how the pipeline decides which council overlay adapter applies.

import type { FeatureCollection, Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";

const PARCEL_LAYER =
  "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query";

export type ParcelInfo = {
  polygon: Geometry | null;
  lotPlan: string | null; // "1RP84598"
  lotNumber: string | null;
  planNumber: string | null;
  areaM2: number | null; // freehold land area
  tenure: string | null; // "Freehold" etc.
  suburb: string | null; // DCDB locality
  /** Local government area, e.g. "Brisbane City", "Noosa Shire". */
  lga: string | null;
  /** Kept for backward compatibility with older BCC-sourced rows. */
  houseNumber: string | null;
  street: string | null;
  postcode: string | null;
  ward: string | null;
};

const EMPTY: ParcelInfo = {
  polygon: null,
  lotPlan: null,
  lotNumber: null,
  planNumber: null,
  areaM2: null,
  tenure: null,
  suburb: null,
  lga: null,
  houseNumber: null,
  street: null,
  postcode: null,
  ward: null,
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function fetchPropertyParcel(
  lat: number,
  lng: number,
): Promise<ParcelInfo> {
  try {
    const fc = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "lot,plan,lotplan,lot_area,tenure,parcel_typ,locality,shire_name",
      returnGeometry: true,
      // Tiny simplification — the lot is already a 5–8 vertex rectangle.
      maxAllowableOffset: 0.00001,
    });
    // Road/rail/water reserves come back with null lotplan — prefer a real
    // lot if the point straddles boundaries.
    const f =
      fc.features.find((x) => (x.properties as { lotplan?: unknown })?.lotplan) ??
      fc.features[0];
    if (!f || !f.geometry) return EMPTY;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    return {
      ...EMPTY,
      polygon: f.geometry,
      lotPlan: str(p.lotplan),
      lotNumber: str(p.lot),
      planNumber: str(p.plan),
      areaM2: num(p.lot_area),
      tenure: str(p.tenure),
      suburb: str(p.locality),
      lga: str(p.shire_name),
    };
  } catch (err) {
    console.error("[property] parcel lookup failed:", err);
    return EMPTY;
  }
}

/**
 * Fetch every cadastre lot polygon within ~155 m of the point so a map can
 * draw the individual lot boundary lines (Develo-style).
 *
 * Zoning polygons are dissolved by zone-precinct — a single polygon spans a
 * whole block of lots — so on their own they read as one flat colour wash.
 * Overlaying the real per-lot cadastre outlines restores the "each lot is
 * distinct" look of the reference planning map. Geometry only; we don't
 * need attributes for boundary lines.
 */
export async function fetchParcelLinesNear(
  lat: number,
  lng: number,
): Promise<FeatureCollection<Geometry> | null> {
  try {
    const fc = await queryArcGIS(PARCEL_LAYER, {
      geometry: { x: lng, y: lat, spatialReference: 4326 },
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      outFields: "lotplan",
      returnGeometry: true,
      bufferDegrees: 0.0014, // ~155 m — comfortably covers the ~115 m viewport
      maxAllowableOffset: 0.00001,
    });
    const features = fc.features.filter(
      (f): f is typeof f & { geometry: Geometry } => f.geometry != null,
    );
    if (features.length === 0) return null;
    return { type: "FeatureCollection", features };
  } catch (err) {
    console.error("[property] parcel-lines lookup failed:", err);
    return null;
  }
}

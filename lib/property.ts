// Property parcel lookup — the real cadastre lot polygon + metadata.
//
// Brisbane City Council publishes the per-lot cadastre at
// `property_boundaries_parcel`. Each polygon is a single freehold lot
// (typical Brisbane suburban lot ~600 m², 20×30 m), not a whole zone
// area. Replaces the misleadingly-named "zoning polygon" we used to draw
// the yellow "selected property" highlight (zoning polygons span entire
// zone-precinct areas — hundreds of metres across).
//
// Field highlights:
//   LOT, PLAN_, LOTPLAN (e.g. "1RP84598" — same shape as Develo's "1/RP84598")
//   LOT_AREA, LOT_VOLUME, TENURE ("FH" = freehold)
//   HOUSE_NUMBER, CORRIDOR_NAME, SUBURB, POSTCODE, WARD_NAME

import type { Geometry } from "geojson";
import { queryArcGIS } from "@/lib/arcgis";

const PARCEL_LAYER =
  "https://services2.arcgis.com/dEKgZETqwmDAh1rP/ArcGIS/rest/services/property_boundaries_parcel/FeatureServer/0/query";

export type ParcelInfo = {
  polygon: Geometry | null;
  lotPlan: string | null;     // "1RP84598"
  lotNumber: string | null;
  planNumber: string | null;
  areaM2: number | null;       // freehold land area
  tenure: string | null;       // "Freehold" etc.
  houseNumber: string | null;
  street: string | null;
  suburb: string | null;
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
  houseNumber: null,
  street: null,
  suburb: null,
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
      outFields:
        "LOT,PLAN_,LOTPLAN,LOT_AREA,TENURE_DESC,HOUSE_NUMBER,CORRIDOR_NAME,CORRIDOR_SUFFIX_CODE,SUBURB,POSTCODE,WARD_NAME",
      returnGeometry: true,
      // Tiny simplification — the lot is already a 5–8 vertex rectangle.
      maxAllowableOffset: 0.00001,
    });
    const f = fc.features[0];
    if (!f || !f.geometry) return EMPTY;
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const street = [str(p.CORRIDOR_NAME), str(p.CORRIDOR_SUFFIX_CODE)]
      .filter(Boolean)
      .join(" ");
    return {
      polygon: f.geometry,
      lotPlan: str(p.LOTPLAN),
      lotNumber: str(p.LOT),
      planNumber: str(p.PLAN_),
      areaM2: num(p.LOT_AREA),
      tenure: str(p.TENURE_DESC),
      houseNumber: str(p.HOUSE_NUMBER) ?? (typeof p.HOUSE_NUMBER === "number" ? String(p.HOUSE_NUMBER) : null),
      street: street || null,
      suburb: str(p.SUBURB),
      postcode: str(p.POSTCODE) ?? (typeof p.POSTCODE === "number" ? String(p.POSTCODE) : null),
      ward: str(p.WARD_NAME),
    };
  } catch (err) {
    console.error("[property] parcel lookup failed:", err);
    return EMPTY;
  }
}

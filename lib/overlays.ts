// Extract module-specific overlay polygons from a council_data row's
// raw_response and tag each feature with a `fillColor` property so the
// MapLibre layer can paint everything in one source with a `get` expression.
//
// The per-module fetchers (lib/modules/*) embed the raw GeoJSON
// FeatureCollections they get from ArcGIS under their result's `raw` field.
// Shape varies per module:
//   flooding:  raw = { overall: FC, historic2022: FC, historic2011: FC }
//   bushfire:  raw = FC
//   heritage:  raw = { state: FC, local: FC, character: FC }
//   easements: raw = FC
//   zoning:    raw = FC

import type { Feature, FeatureCollection, Geometry } from "geojson";

import { APPLE_HEX } from "@/lib/module-meta";
import type { Module } from "@/lib/supabase";

export type OverlayFeature = Feature<
  Geometry,
  { fillColor: string; legendLabel: string }
>;

function isFC(v: unknown): v is FeatureCollection<Geometry, Record<string, unknown>> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "FeatureCollection"
  );
}

function pushFC(
  out: OverlayFeature[],
  fc: unknown,
  classify: (props: Record<string, unknown>) => { fillColor: string; legendLabel: string },
) {
  if (!isFC(fc)) return;
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const { fillColor, legendLabel } = classify(props);
    out.push({
      type: "Feature",
      geometry: f.geometry,
      properties: { fillColor, legendLabel },
    });
  }
}

function floodColor(props: Record<string, unknown>) {
  const r = String(props.FLOOD_RISK ?? "").toLowerCase();
  if (r === "high")    return { fillColor: APPLE_HEX.red,    legendLabel: "High risk" };
  if (r === "medium")  return { fillColor: APPLE_HEX.orange, legendLabel: "Medium risk" };
  if (r === "low")     return { fillColor: APPLE_HEX.teal,   legendLabel: "Low risk" };
  if (r === "very low") return { fillColor: APPLE_HEX.yellow, legendLabel: "Very low risk" };
  return { fillColor: APPLE_HEX.gray, legendLabel: "Unclassified" };
}

function bushfireColor(props: Record<string, unknown>) {
  const d = String(props.OVL2_DESC ?? "").toLowerCase();
  if (d.includes("very high"))       return { fillColor: APPLE_HEX.red,    legendLabel: "Very high potential" };
  if (d.includes("high hazard area")) return { fillColor: APPLE_HEX.orange, legendLabel: "High hazard area" };
  if (d.includes("high hazard"))     return { fillColor: APPLE_HEX.yellow, legendLabel: "High hazard buffer" };
  if (d.includes("medium"))          return { fillColor: APPLE_HEX.teal,   legendLabel: "Medium hazard area" };
  return { fillColor: APPLE_HEX.gray, legendLabel: String(props.OVL2_DESC ?? "Hazard area") };
}

function zoningColor(props: Record<string, unknown>) {
  const f = String(props.LVL1_ZONE ?? "").toLowerCase();
  if (f.startsWith("centre"))             return { fillColor: APPLE_HEX.red,    legendLabel: "Centre" };
  if (f.startsWith("mixed"))              return { fillColor: APPLE_HEX.orange, legendLabel: "Mixed use" };
  if (f.includes("residential"))          return { fillColor: APPLE_HEX.yellow, legendLabel: "General residential" };
  if (f.includes("open space") || f.includes("recreation"))
                                          return { fillColor: APPLE_HEX.green,  legendLabel: "Open space / Recreation" };
  return { fillColor: APPLE_HEX.indigo, legendLabel: String(props.LVL1_ZONE ?? "Other") };
}

export function extractOverlays(module: Module, raw: unknown): OverlayFeature[] {
  const out: OverlayFeature[] = [];
  if (!raw || typeof raw !== "object") return out;
  // Prefer `context` (envelope query — ~280 m around property, always has
  // features when any exist nearby) over `raw` (point query — only has
  // features the property is inside).
  const r = raw as Record<string, unknown>;
  const inner = r.context ?? r.raw;
  if (inner === undefined) return out;

  switch (module) {
    case "flooding": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.overall, floodColor);
      pushFC(out, i.historic2022, () => ({
        fillColor: APPLE_HEX.blue,
        legendLabel: "Feb 2022 historic flood",
      }));
      pushFC(out, i.historic2011, () => ({
        fillColor: APPLE_HEX.indigo,
        legendLabel: "Jan 2011 historic flood",
      }));
      return out;
    }
    case "bushfire":
      pushFC(out, inner, bushfireColor);
      return out;
    case "heritage": {
      const i = inner as Record<string, unknown>;
      pushFC(out, i.state, () => ({
        fillColor: APPLE_HEX.purple,
        legendLabel: "State heritage area",
      }));
      pushFC(out, i.local, () => ({
        fillColor: APPLE_HEX.pink,
        legendLabel: "Local heritage area",
      }));
      pushFC(out, i.character, () => ({
        fillColor: APPLE_HEX.indigo,
        legendLabel: "Character (pre-1947)",
      }));
      return out;
    }
    case "easements":
      pushFC(out, inner, () => ({
        fillColor: APPLE_HEX.teal,
        legendLabel: "High-voltage easement",
      }));
      return out;
    case "zoning":
      pushFC(out, inner, zoningColor);
      return out;
  }
}

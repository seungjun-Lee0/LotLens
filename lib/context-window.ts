// How far around the property each module's CONTEXT query reaches.
//
// Every module map fetches the overlay polygons in an envelope around the
// geocoded point so the reader sees the surroundings, not just the lot.
// That envelope was a fixed ±0.0025° (~280 m), which is right for a house
// block and wrong for a big lot: the map frames the WHOLE parcel, so for
// Rocklea Markets (~470 m across) the headline band ("Brisbane River flood
// planning area 1") sat on the lot but outside the fetch window, and the
// map and legend never showed it.
//
// The window now grows with the lot: it always covers the parcel's bbox
// plus a margin, measured from the geocoded point (which need not be the
// lot's centroid). A house lot gets the old ±0.0025°; nothing changes for
// it. Capped so a rural holding can't request half a shire.

import type { Geometry } from "geojson";

/** ±degrees for an ordinary suburban lot (~280 m at Brisbane's latitude). */
export const CONTEXT_BUFFER_MIN = 0.0025;
/** Margin past the lot's bbox so the frame's edge still shows context. */
const CONTEXT_MARGIN = 0.0015;
/** ±2.2 km: beyond this the map is a district, not a property. */
const CONTEXT_BUFFER_MAX = 0.02;

/**
 * Half-width (degrees) of the context envelope centred on `lng, lat` that
 * covers the lot's bounding box with a margin, never less than the
 * suburban default.
 */
export function contextBuffer(
  lot: Geometry | null | undefined,
  lat: number,
  lng: number,
): number {
  if (!lot) return CONTEXT_BUFFER_MIN;
  const rings: number[][][] =
    lot.type === "Polygon"
      ? (lot.coordinates as number[][][])
      : lot.type === "MultiPolygon"
        ? (lot.coordinates as number[][][][]).flat()
        : [];
  let reach = 0;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      // Longitude degrees are shorter than latitude degrees; a square
      // envelope in degrees is what every query uses, so measure both
      // axes in degrees and let the wider one govern.
      reach = Math.max(reach, Math.abs(x - lng), Math.abs(y - lat));
    }
  }
  if (!Number.isFinite(reach) || reach === 0) return CONTEXT_BUFFER_MIN;
  return Math.min(CONTEXT_BUFFER_MAX, Math.max(CONTEXT_BUFFER_MIN, reach + CONTEXT_MARGIN));
}

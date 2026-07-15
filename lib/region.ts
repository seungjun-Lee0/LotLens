// Region framework — which council (LGA) a point belongs to, and which
// data sources apply there.
//
// LotLens layers come from two kinds of sources:
//   - STATEWIDE Queensland Government services (QSpatial DCDB cadastre,
//     QFD Bushfire Prone Area, Queensland Heritage Register, regulated
//     vegetation, coastal hazards, koala plan, acid sulfate soils, mining
//     tenures, state school catchments). These work for any QLD address.
//   - COUNCIL planning-scheme overlays (detailed flood risk bands, flood
//     planning areas, overland flow, transport noise, zoning precincts).
//     Each LGA publishes its own service with its own schema; Brisbane
//     City Council is the first council adapter. Modules that depend on a
//     council overlay report `available: false` outside adapted LGAs
//     (Develo does the same — their reports drop pages per-LGA).
//
// The LGA itself comes from the DCDB parcel lookup (`shire_name`, e.g.
// "Brisbane City", "Gold Coast City", "Noosa Shire"), with a bbox check
// as fallback when the point misses a parcel (road reserves etc.).

export type Region = {
  /** DCDB `shire_name`, e.g. "Brisbane City" / "Gold Coast City". */
  lga: string | null;
  /** True when the Brisbane City Council planning-scheme adapter applies. */
  isBrisbane: boolean;
};

/** Queensland-wide bbox — the geocoder gate. */
export const QLD_BBOX = {
  lonMin: 137.99,
  latMin: -29.18,
  lonMax: 153.56,
  latMax: -8.9,
};

/** Brisbane LGA bbox — fallback LGA detection when no parcel is found. */
export const BRISBANE_BBOX = {
  lonMin: 152.65,
  latMin: -27.75,
  lonMax: 153.3,
  latMax: -27.2,
};

export function regionFromParcel(
  shireName: string | null | undefined,
  lat?: number,
  lng?: number,
): Region {
  if (shireName) {
    return { lga: shireName, isBrisbane: /brisbane/i.test(shireName) };
  }
  const inBrisbaneBbox =
    lat !== undefined &&
    lng !== undefined &&
    lat >= BRISBANE_BBOX.latMin &&
    lat <= BRISBANE_BBOX.latMax &&
    lng >= BRISBANE_BBOX.lonMin &&
    lng <= BRISBANE_BBOX.lonMax;
  return { lga: null, isBrisbane: inBrisbaneBbox };
}

/** Human name for report copy: "Brisbane City Council", "Noosa Shire Council". */
export function councilDisplayName(region: Region): string {
  if (!region.lga) return "the local council";
  return /council/i.test(region.lga) ? region.lga : `${region.lga} Council`;
}

/**
 * Shared shape for a module whose data comes from a council overlay that
 * hasn't been integrated for this LGA yet. Fetchers spread this into their
 * result so the report can render an honest "not available here" state
 * instead of a false "no considerations identified".
 */
export type ModuleAvailability = {
  /** False = the source overlay doesn't exist / isn't integrated for this LGA. */
  available: boolean;
  availabilityNote?: string;
};

export function unavailableForLga(region: Region, what: string): ModuleAvailability {
  return {
    available: false,
    availabilityNote: `${what} is published per-council and has not been integrated for ${councilDisplayName(region)} yet. Check the council's planning scheme mapping directly.`,
  };
}

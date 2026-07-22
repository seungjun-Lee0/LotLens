// Postcode lookup.
//
// The QLD composite locator returns an EMPTY Postal field, and QLD's own
// locality boundary layer only carries a locality code, not a postcode.
// The authoritative free source is the ABS 2021 Postal Areas (POA) layer:
// a keyless national point-query that returns poa_code_2021 (e.g. "4122").
//
// Used for DISPLAY only, fetched alongside the parcel lookup at report
// load — the stored address_text is never mutated, so existing reports
// gain a postcode too.

const ABS_POA_QUERY =
  "https://geo.abs.gov.au/arcgis/rest/services/ASGS2021/POA/MapServer/0/query";

/** The 4-digit postcode covering (lat, lng), or null on any failure. */
export async function fetchPostcode(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const url = new URL(ABS_POA_QUERY);
    url.searchParams.set(
      "geometry",
      JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
    );
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "poa_code_2021");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: Array<{ attributes?: { poa_code_2021?: unknown } }>;
    };
    const code = json.features?.[0]?.attributes?.poa_code_2021;
    return typeof code === "string" && /^\d{4}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

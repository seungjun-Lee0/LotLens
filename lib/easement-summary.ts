// Easement parcels, grouped for display.
//
// The DCDB returns one ROW per easement polygon, and a single registered
// easement is often drawn as several pieces (where a road or another lot
// cuts through it). Listing the rows verbatim printed "ARP91468, ARP91468,
// ARP91468, BRP99926, CRP99926, ARP91468, ARP91468, ARP91468" for one
// Chelmer lot: eight entries, three easements. Group by lot/plan so the web
// panel, the PDF and the narrative all name each easement once.
//
// Pure (no server imports): safe from client components and React-PDF.

export type EasementParcel = { lotplan?: string | null; areaSqm?: number | null };

export type EasementGroup = {
  /** null = the source row carried no lot/plan. */
  lotplan: string | null;
  /** Polygon pieces drawn for this easement. */
  parts: number;
  /** Combined area when every piece reports one, else null. */
  areaSqm: number | null;
};

export function groupEasementParcels(rows: EasementParcel[]): EasementGroup[] {
  const groups = new Map<string, EasementGroup & { areaKnown: boolean }>();
  let anon = 0;
  for (const r of rows) {
    const lotplan = typeof r.lotplan === "string" && r.lotplan.length > 0 ? r.lotplan : null;
    // Rows without a lot/plan can't be matched to each other: keep each.
    const key = lotplan ?? `\u0000anon-${anon++}`;
    const area = typeof r.areaSqm === "number" && r.areaSqm > 0 ? r.areaSqm : null;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { lotplan, parts: 1, areaSqm: area, areaKnown: area !== null });
    } else {
      g.parts += 1;
      g.areaKnown = g.areaKnown && area !== null;
      g.areaSqm = g.areaKnown ? (g.areaSqm ?? 0) + (area ?? 0) : null;
    }
  }
  return [...groups.values()].map(({ lotplan, parts, areaSqm }) => ({ lotplan, parts, areaSqm }));
}

/** "BRP99926 · 43 m²", "ARP91468 (6 parts)", "Easement parcel". */
export function formatEasementGroup(g: EasementGroup): string {
  const name = g.lotplan ?? "Easement parcel";
  const bits = [
    g.areaSqm ? `${Math.round(g.areaSqm)} m²` : null,
    g.parts > 1 ? `${g.parts} parts` : null,
  ].filter(Boolean);
  if (bits.length === 0) return name;
  // Area reads as a fact about the easement; a bare part count reads
  // better in brackets.
  return g.areaSqm ? `${name} · ${bits.join(" · ")}` : `${name} (${bits.join(", ")})`;
}

/** Distinct lot/plans, in first-seen order. */
export function distinctLotplans(rows: EasementParcel[]): string[] {
  return groupEasementParcels(rows)
    .map((g) => g.lotplan)
    .filter((l): l is string => l !== null);
}

// One short line per module from its stored result: the value a reader
// would quote ("Creek/waterway flood planning area 1", "Springwood SHS",
// "ferry 131 m"). Used by the compare view, where a module gets one cell
// per property and the AI summary sentence is too long to line up.
//
// Pure: no React, no server imports. Works on the raw_response object a
// council_data row stores (the module fetcher's result).

import type { Module } from "@/lib/db";

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export function moduleHeadline(module: Module, raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Raw;
  if (r.fetchFailed === true) return "Verification pending";
  if (r.available === false) return "No source information";
  switch (module) {
    case "flooding": {
      const ev = arr<{ event: string }>(r.historicEvents).map((e) => e.event);
      const t = str(r.floodType);
      if (!t && ev.length === 0) return null;
      return [t, ev.length ? `flooded ${ev.join(", ")}` : null].filter(Boolean).join(" · ");
    }
    case "flood_planning":
      return [r.riverArea, r.creekArea, r.overlandArea].map(str).filter(Boolean).join(" + ") || null;
    case "overland_flow":
    case "storm_tide":
      return str(r.floodType);
    case "bushfire":
      return str(r.hazardCategory) ?? str(r.councilCategory);
    case "vegetation":
    case "environment":
    case "mining":
      return str(r.category);
    case "steep_land": {
      const cat = str(r.category);
      const elev = r.elevation as { fallM?: number | null } | null | undefined;
      const fall = elev && typeof elev.fallM === "number" ? `~${elev.fallM} m fall` : null;
      return [cat, fall].filter(Boolean).join(" · ") || null;
    }
    case "heritage": {
      const types = [...new Set(arr<{ type: string }>(r.entries).map((e) => e.type))];
      const label: Record<string, string> = {
        state: "State heritage",
        local: "Local heritage",
        character: "Traditional character",
        dwelling_character: "Dwelling house character",
      };
      return types.map((t) => label[t] ?? t).join(" + ") || null;
    }
    case "easements": {
      const parts: string[] = [];
      if (r.hasHighVoltageEasement === true) parts.push("High-voltage");
      const n = arr(r.cadastralEasements).length;
      if (n > 0) parts.push(`${n} registered`);
      if (parts.length === 0 && arr(r.adjoiningEasements).length > 0) parts.push("Adjoining only");
      return parts.join(" · ") || null;
    }
    case "noise":
      return [str(r.transportCorridor), str(r.anefCategory)].filter(Boolean).join(" · ") || null;
    case "acid_sulfate":
      return str(r.meaning) ?? str(r.mapCode);
    case "stormwater": {
      const n = arr<{ public?: boolean }>(r.assets).filter((a) => a.public).length;
      return r.hasPublicAssetOnLot === true ? `${n} Council asset${n === 1 ? "" : "s"} on lot` : null;
    }
    case "water_sewer":
      return r.hasTrunkOrPressureMainOnLot === true
        ? "Trunk / pressure main on lot"
        : r.hasMainOnLot === true
          ? "Main crosses lot"
          : null;
    case "power":
      return r.hasSubTransmissionOnLot === true
        ? "Sub-transmission on lot"
        : r.hasHvOnLot === true
          ? "11kV feeder on lot"
          : null;
    case "schools": {
      const s = arr<{ name: string }>(r.schools).map((x) => x.name);
      return s.join(" · ") || null;
    }
    case "transport": {
      const s = arr<{ kind: string; distanceM: number }>(r.stops)[0];
      return s ? `${s.kind} ${km(s.distanceM)}` : null;
    }
    case "local_plans": {
      const plan = str(r.planName);
      const prec = arr<{ name: string }>(r.precincts).map((p) => p.name);
      return [plan, prec.length ? prec.join(", ") : null].filter(Boolean).join(" · ") || null;
    }
    case "zoning":
      return str(r.zonePrecinct) ?? str(r.lvl2Zone) ?? str(r.lvl1Zone);
    case "internet":
      return str(r.accessNetwork) ?? "Outside footprints";
    case "boundary": {
      const a = typeof r.areaM2 === "number" ? `${r.areaM2.toLocaleString()} m²` : null;
      const n = arr(r.edges).length;
      return [a, n ? `${n} sides` : null].filter(Boolean).join(" · ") || null;
    }
  }
}

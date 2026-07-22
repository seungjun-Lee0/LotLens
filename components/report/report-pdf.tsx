// Print PDF rendered server-side via @react-pdf/renderer. Premium /
// Apple-system aesthetic: warm off-white page background (Apple's #f5f5f7),
// near-black text, muted secondary, hairline dividers, sparing colour use
// (module tints only on the status pill, legend swatches, and the
// "for this property" accent). One module = one A4 page.

import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

import type { ModuleNarrative } from "@/lib/anthropic";
import { formatAuAddress } from "@/lib/format-address";
import { MODULE_META, APPLE_HEX } from "@/lib/module-meta";
import { extractOverlays, type OverlayFeature } from "@/lib/overlays";
import type { ReportPayload } from "@/lib/pipeline";
import { SELECTED_PROPERTY_STYLE } from "@/lib/property-style";
import { RISK_RANK, RISK_STYLE, riskOf } from "@/lib/risk-style";
import type { Module, RiskLevel } from "@/lib/db";
import { prettyUrl } from "@/lib/url";

// ── Print tokens — corporate property-report palette (CoreLogic /
// valuation-firm register: white pages, slate ink, one navy accent that
// customer branding may override, hairline rules everywhere) ────────────

const TEXT_PRIMARY = "#0f172a"; // slate-900
const TEXT_BODY = "#334155";    // slate-700
const TEXT_MUTED = "#64748b";   // slate-500
const PAGE_BG = "#ffffff";      // white — print-first
const SURFACE = "#ffffff";
const HAIRLINE = "#e2e8f0";     // slate-200 rule
const PANEL_BG = "#f8fafc";     // slate-50 callout fill
const ACCENT_DEFAULT = "#1e3a8a"; // navy — overridden by brand colour

/** Every page reserves this band at the bottom; the fixed footer paints
 * an opaque strip over it, so body content can NEVER visually collide
 * with the pagination line no matter how long it runs. */
const FOOTER_BAND = 38;
const HEADER_BAND = 46;

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

/** One per module — null when the map render fails on that module. */
export type ModuleMapPng = { module: Module; png: Buffer | null };

/** Customer branding (subscriber feature) — replaces the plain LotLens
 * identity on the cover/footers and adds an accent rule to every page.
 * `logo` is pre-fetched to a Buffer by the route (React-PDF must not
 * fetch mid-render). */
export type ReportBranding = {
  name: string | null;
  color: string | null;
  logo: Buffer | null;
};

Font.registerHyphenationCallback((w) => [w]);

// ── Helpers ───────────────────────────────────────────────────────────────

const BRISBANE_CBD = { lat: -27.4694, lng: 153.0235 };
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

type RawAttrs = Record<string, unknown>;
function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Cover one-liner from a module summary: the AI lead restates the full
 * address ("Westfield Chermside, Gympie Rd, … carries high flood risk…"),
 * which wastes the whole line on the cover — strip it, uppercase the
 * first letter, and truncate at a WORD boundary (mid-word "registered
 * c…" reads broken). */
function coverLine(
  summary: string | undefined,
  address: string,
): string | null {
  if (!summary) return null;
  let s = summary.trim();
  const addr = address.trim();
  if (addr && s.toLowerCase().startsWith(addr.toLowerCase())) {
    s = s.slice(addr.length).replace(/^[\s,—–-]+/, "");
  }
  if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);
  const MAX = 95;
  if (s.length > MAX) {
    const cut = s.slice(0, MAX);
    const atWord = cut.slice(0, Math.max(40, cut.lastIndexOf(" ")));
    s = `${atWord.replace(/[\s,;:—–-]+$/, "")}…`;
  }
  return s || null;
}

function legendItemsFromOverlays(overlays: OverlayFeature[]): { color: string; label: string }[] {
  const seen = new Set<string>();
  const items: { color: string; label: string }[] = [];
  for (const f of overlays) {
    const key = `${f.properties.fillColor}|${f.properties.legendLabel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      color: f.properties.fillColor,
      label: f.properties.legendLabel,
    });
  }
  return items;
}

function splitLegendItems(
  visibleOverlays: OverlayFeature[],
  applicableOverlays: OverlayFeature[],
) {
  const applicableKeys = new Set(
    applicableOverlays.map((f) => `${f.properties.fillColor}|${f.properties.legendLabel}`),
  );
  const visibleItems = legendItemsFromOverlays(visibleOverlays);
  return {
    applies: visibleItems.filter((item) => applicableKeys.has(`${item.color}|${item.label}`)),
    nearby: visibleItems.filter((item) => !applicableKeys.has(`${item.color}|${item.label}`)),
  };
}

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    // Top/bottom padding clears the fixed running header / footer bands.
    paddingTop: HEADER_BAND + 16,
    paddingBottom: FOOTER_BAND + 14,
    paddingHorizontal: 42,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: TEXT_PRIMARY,
    lineHeight: 1.5,
    backgroundColor: PAGE_BG,
    // @react-pdf/layout 4.6 shrinks a page to its content height, which
    // floats the fixed footer band up the page — pin every page to true
    // A4 height.
    minHeight: 841.89,
  },

  // ── Eyebrow + headline ────────────────────────────────────────────
  eyebrow: {
    fontSize: 7.5,
    letterSpacing: 1.6,
    color: TEXT_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  question: {
    marginTop: 5,
    fontSize: 10,
    color: TEXT_BODY,
    lineHeight: 1.4,
  },

  // ── Map ────────────────────────────────────────────────────────────
  heroMap: {
    width: "100%",
    height: 220,
    borderRadius: 10,
    marginTop: 14,
    objectFit: "cover",
  },

  // ── Status + sources strip ─────────────────────────────────────────
  metaRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  // Fixed pill height + lineHeight 1 keeps the uppercase label optically
  // centred in the chip (react-pdf's font-default line box sits the
  // glyphs high otherwise); the sources line shares the same baseline
  // treatment so the row reads level.
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    height: 17,
    paddingHorizontal: 9,
    borderRadius: 999,
    marginRight: 8,
  },
  statusDot: { width: 6, height: 6, borderRadius: 999, marginRight: 5 },
  statusLabel: {
    fontSize: 8,
    lineHeight: 1,
    marginTop: 1.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sourceLine: {
    fontSize: 7.5,
    lineHeight: 1,
    marginTop: 1.5,
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: "uppercase",
  },

  // ── Lead-in (AI summary) ───────────────────────────────────────────
  lead: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: TEXT_PRIMARY,
    marginTop: 10,
    lineHeight: 1.3,
    letterSpacing: -0.1,
  },

  // ── Section labels ────────────────────────────────────────────────
  sectionLabel: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    color: TEXT_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 5,
  },

  para: {
    fontSize: 8.5,
    color: TEXT_BODY,
    marginBottom: 3,
    lineHeight: 1.4,
  },

  // ── "For this property" callout ───────────────────────────────────
  forProperty: {
    marginTop: 8,
    paddingLeft: 10,
    borderLeftWidth: 2,
  },
  forPropertyLabel: {
    fontSize: 7,
    letterSpacing: 1.6,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  forPropertyText: {
    fontSize: 8.5,
    color: TEXT_BODY,
    lineHeight: 1.4,
  },

  // ── Facts panel ───────────────────────────────────────────────────
  factsPanel: {
    marginTop: 8,
    padding: 9,
    borderRadius: 6,
    backgroundColor: PANEL_BG,
    borderWidth: 0.5,
    borderColor: HAIRLINE,
  },
  factRow: { flexDirection: "row", marginBottom: 2 },
  factKey: { width: 92, color: TEXT_MUTED, fontSize: 8.5 },
  factVal: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 8.5, color: TEXT_PRIMARY },

  // ── Note ─────────────────────────────────────────────────────────
  noteWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    flexDirection: "row",
  },
  noteLabel: { fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY, fontSize: 8 },
  noteText: { flex: 1, fontSize: 8, color: TEXT_BODY, lineHeight: 1.4 },

  // ── Bullets / lists ───────────────────────────────────────────────
  bullet: { flexDirection: "row", marginBottom: 3 },
  bulletDot: { width: 9, fontSize: 8.5 },
  bulletTxt: { flex: 1, fontSize: 8.5, color: TEXT_PRIMARY, lineHeight: 1.4 },

  // ── Legend ────────────────────────────────────────────────────────
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 3.5 },
  legendSwatch: { width: 9, height: 9, borderRadius: 2.5, marginRight: 7 },
  legendLabel: { fontSize: 8.5, color: TEXT_BODY },

  // Plain text, not a Link: a printed report's references shouldn't look
  // clickable.
  link: { fontSize: 7.5, color: TEXT_MUTED, textDecoration: "none", marginBottom: 1.5 },

  // ── Body grid ─────────────────────────────────────────────────────
  body: { flexDirection: "row", marginTop: 12 },
  leftCol: { width: "62%", paddingRight: 16 },
  rightCol: { width: "38%" },

  // ── At-a-glance bits ──────────────────────────────────────────────
  glanceRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 0.5,
    borderColor: HAIRLINE,
    marginBottom: 6,
  },
  glanceSwatch: {
    width: 14,
    height: 14,
    borderRadius: 4,
    marginRight: 11,
  },
  glanceName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: TEXT_PRIMARY,
    letterSpacing: -0.1,
  },
  glanceSource: { fontSize: 7.5, color: TEXT_MUTED, marginTop: 1, letterSpacing: 0.4 },

  metaBlock: { marginBottom: 11 },
  metaLabel: {
    fontSize: 7,
    letterSpacing: 1.4,
    color: TEXT_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: { fontSize: 9.5, color: TEXT_PRIMARY, lineHeight: 1.4 },

  // ── Disclaimer page ───────────────────────────────────────────────
  disclaimerBox: {
    marginTop: 14,
    padding: 16,
    borderRadius: 10,
    backgroundColor: SURFACE,
    borderWidth: 0.5,
    borderColor: HAIRLINE,
  },
  disclaimerLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: TEXT_PRIMARY,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  disclaimerText: { fontSize: 9.5, color: TEXT_BODY, lineHeight: 1.55 },

  divider: { height: 0.5, backgroundColor: HAIRLINE, marginVertical: 12 },

  // ── Fixed page chrome ─────────────────────────────────────────────
  runningHeader: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: HEADER_BAND,
    paddingHorizontal: 42,
    paddingTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: HAIRLINE,
    backgroundColor: PAGE_BG,
  },
  runningBrand: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: TEXT_PRIMARY,
    letterSpacing: 0.2,
  },
  runningAddress: {
    fontSize: 7,
    color: TEXT_MUTED,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  footerBand: {
    // Opaque strip: paints OVER any body overflow, so content can never
    // collide with the pagination line.
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: FOOTER_BAND,
    paddingHorizontal: 42,
    paddingTop: 9,
    backgroundColor: PAGE_BG,
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: TEXT_MUTED,
    letterSpacing: 0.4,
  },
});

// ── Per-module facts ──────────────────────────────────────────────────────

function factsRows(module: Module, raw: RawAttrs | undefined): { key: string; val: string }[] {
  if (!raw) return [];
  // The source didn't respond when the report ran — one explanatory row,
  // distinct from "not integrated for this LGA" below.
  if (raw.fetchFailed === true) {
    return [
      {
        key: "Not checked",
        val: "This source didn't respond when the report ran. No finding here means \"not checked\", not \"clear\". Re-run the checks to retry.",
      },
    ];
  }
  // Council-overlay modules outside adapted LGAs mark themselves
  // unavailable — one explanatory row instead of module facts.
  if (raw.available === false) {
    return [
      {
        key: "Not available",
        val:
          typeof raw.availabilityNote === "string"
            ? raw.availabilityNote
            : "This overlay has not been integrated for this council area yet.",
      },
    ];
  }
  switch (module) {
    case "flooding": {
      const rows: { key: string; val: string }[] = [];
      if (raw.floodType) rows.push({ key: "Flood type", val: String(raw.floodType) });
      const events = asArr<RawAttrs>(raw.historicEvents);
      if (events.length > 0) rows.push({ key: "Historic events", val: events.map((e) => String(e.event)).join(", ") });
      return rows;
    }
    case "overland_flow":
    case "storm_tide": {
      const rows: { key: string; val: string }[] = [];
      if (raw.riskLevel) rows.push({ key: "Risk level", val: String(raw.riskLevel) });
      if (raw.floodType) rows.push({ key: "Type", val: String(raw.floodType) });
      return rows;
    }
    case "bushfire": {
      const rows: { key: string; val: string }[] = [];
      if (raw.hazardCategory) rows.push({ key: "Hazard category", val: String(raw.hazardCategory) });
      if (raw.hazardCode) rows.push({ key: "Code", val: String(raw.hazardCode) });
      return rows;
    }
    case "vegetation": {
      const rows: { key: string; val: string }[] = [];
      if (raw.category) rows.push({ key: "Category", val: String(raw.category) });
      if (raw.code) rows.push({ key: "Code", val: String(raw.code) });
      return rows;
    }
    case "flood_planning": {
      const rows: { key: string; val: string }[] = [];
      if (raw.riverArea) rows.push({ key: "River area", val: String(raw.riverArea) });
      if (raw.creekArea) rows.push({ key: "Creek area", val: String(raw.creekArea) });
      return rows;
    }
    case "noise": {
      const rows: { key: string; val: string }[] = [];
      if (raw.transportCorridor) rows.push({ key: "Transport", val: String(raw.transportCorridor) });
      if (raw.anefCategory) rows.push({ key: "Aircraft", val: String(raw.anefCategory) });
      return rows;
    }
    case "schools": {
      const schools = asArr<{ name: string; type: string; yearLevels: string[] }>(raw.schools);
      return schools.map((s, i) => ({
        key: `Catchment ${i + 1}`,
        val: `${s.name} · ${s.type} (years ${s.yearLevels.join(", ")})`,
      }));
    }
    case "heritage": {
      const entries = asArr<RawAttrs>(raw.entries);
      return entries.map((e, i) => ({ key: `Entry ${i + 1}`, val: `[${e.type}] ${e.description ?? "No description recorded"}` }));
    }
    case "easements": {
      const rows: { key: string; val: string }[] = [];
      if (raw.description) rows.push({ key: "High-voltage", val: String(raw.description) });
      const cadastral = asArr<{ lotplan?: string | null; areaSqm?: number | null }>(
        raw.cadastralEasements,
      );
      cadastral.forEach((e, i) => {
        const parts = [
          e.lotplan ?? "Easement parcel",
          e.areaSqm ? `${Math.round(e.areaSqm)} m²` : null,
        ].filter(Boolean);
        rows.push({ key: `Cadastral ${i + 1}`, val: parts.join(" · ") });
      });
      return rows;
    }
    case "environment": {
      const rows: { key: string; val: string }[] = [];
      if (raw.category) rows.push({ key: "Habitat", val: String(raw.category) });
      return rows;
    }
    case "steep_land": {
      const rows: { key: string; val: string }[] = [];
      if (raw.category) rows.push({ key: "Overlay", val: String(raw.category) });
      return rows;
    }
    case "acid_sulfate": {
      const rows: { key: string; val: string }[] = [];
      if (raw.meaning) rows.push({ key: "Classification", val: String(raw.meaning) });
      if (raw.mapCode)
        rows.push({
          key: "Map code",
          val: `${raw.mapCode}${raw.scale ? ` · ${raw.scale}` : ""}`,
        });
      return rows;
    }
    case "mining": {
      const rows: { key: string; val: string }[] = [];
      if (raw.category) rows.push({ key: "Finding", val: String(raw.category) });
      const tenements = asArr<{ type?: string | null; status?: string | null; owner?: string | null }>(
        raw.tenements,
      );
      tenements.slice(0, 3).forEach((t, i) => {
        rows.push({
          key: `Tenure ${i + 1}`,
          val: [t.type ?? "Resource authority", t.status, t.owner].filter(Boolean).join(" · "),
        });
      });
      return rows;
    }
    case "zoning": {
      const rows: { key: string; val: string }[] = [];
      if (raw.zonePrecinct) rows.push({ key: "Zone", val: String(raw.zonePrecinct) });
      if (raw.lvl2Zone) rows.push({ key: "Specific", val: String(raw.lvl2Zone) });
      if (raw.lvl1Zone) rows.push({ key: "Family", val: String(raw.lvl1Zone) });
      return rows;
    }
  }
}

// ── Module page ───────────────────────────────────────────────────────────

function ModulePage({
  module,
  hasConsideration,
  riskLevel,
  narrative,
  raw,
  mapPng,
  address,
  branding,
}: {
  module: Module;
  hasConsideration: boolean;
  riskLevel: RiskLevel | null;
  narrative: ModuleNarrative | undefined;
  raw: RawAttrs | undefined;
  mapPng: Buffer | null;
  address: string;
  branding: ReportBranding | null;
}) {
  const meta = MODULE_META[module];
  // ONE page per module: lists are capped below and the page never wraps,
  // so a heritage lot with 30 register entries can't spill a second page.
  const allFacts = factsRows(module, raw);
  const facts = allFacts.slice(0, 8);
  const factsMore = allFacts.length - facts.length;
  const questions = (narrative?.questions_to_ask ?? []).slice(0, 4);
  const sources = Array.from(new Set(narrative?.sources ?? [])).slice(0, 4);
  const failed = raw?.fetchFailed === true;
  // Severity colour rides the SHARED risk scale (lib/risk-style.ts) — the
  // same red/orange/gold everywhere, never the module tint, so relative
  // seriousness is readable at a flip-through.
  const level = riskOf(riskLevel, hasConsideration);
  const statusColor = failed ? APPLE_HEX.orange : RISK_STYLE[level].hex;
  const statusLabel = failed
    ? "Not checked · source unavailable"
    : hasConsideration
      ? `Considerations · ${RISK_STYLE[level].label}`
      : "No considerations identified";
  const legendAll = splitLegendItems(
    extractOverlays(module, raw),
    extractOverlays(module, raw, { scope: "property" }),
  );
  const legendItems = {
    applies: legendAll.applies.slice(0, 7),
    nearby: legendAll.nearby.slice(0, Math.max(0, 9 - Math.min(7, legendAll.applies.length))),
  };
  const legendMore =
    legendAll.applies.length + legendAll.nearby.length -
    (legendItems.applies.length + legendItems.nearby.length);

  return (
    <Page size="A4" style={styles.page} wrap={false}>
      <ChromeTop branding={branding} address={address} />
      {/* Header */}
      <View>
        <Text style={styles.eyebrow}>0{moduleIndex(module)} · {meta.name.toUpperCase()}</Text>
        <Text style={styles.title}>{meta.name}</Text>
        <Text style={styles.question}>{meta.question}</Text>
      </View>

      {/* Hero map */}
      {/* eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image has no alt prop. */}
      {mapPng && <Image src={mapPng} style={styles.heroMap} />}

      {/* Status + source */}
      <View style={styles.metaRow}>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: `${statusColor}24` },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <Text style={styles.sourceLine}>Sources · {meta.sourceLabel}</Text>
      </View>

      {narrative?.summary && <Text style={styles.lead}>{narrative.summary}</Text>}

      {/* Two-column body */}
      <View style={styles.body}>
        <View style={styles.leftCol}>
          <Text style={styles.sectionLabel}>Things to know</Text>
          {meta.thingsToKnow.map((p, i) => (
            <Text key={i} style={styles.para}>{p}</Text>
          ))}

          {narrative?.detail && (
            <View
              style={[
                styles.forProperty,
                { borderLeftColor: meta.tintHex },
              ]}
            >
              <Text style={[styles.forPropertyLabel, { color: meta.tintHex }]}>
                For this property
              </Text>
              <Text style={styles.forPropertyText}>{narrative.detail}</Text>
            </View>
          )}

          {facts.length > 0 && (
            <View style={styles.factsPanel}>
              {facts.map((f, i) => (
                <View key={i} style={styles.factRow}>
                  <Text style={styles.factKey}>{f.key}</Text>
                  <Text style={styles.factVal}>{f.val}</Text>
                </View>
              ))}
              {factsMore > 0 && (
                <Text style={{ fontSize: 8, color: TEXT_MUTED, marginTop: 2 }}>
                  +{factsMore} more. See the online report for the full list.
                </Text>
              )}
            </View>
          )}

          <View style={styles.noteWrap}>
            <Text style={styles.noteLabel}>Note · </Text>
            <Text style={styles.noteText}>{meta.note}</Text>
          </View>
        </View>

        <View style={styles.rightCol}>
          {questions.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Questions to ask</Text>
              {questions.map((q, i) => (
                <View key={i} style={styles.bullet}>
                  <Text style={styles.bulletDot}>·</Text>
                  <Text style={styles.bulletTxt}>{q}</Text>
                </View>
              ))}
              <View style={{ height: 12 }} />
            </>
          ) : null}

          <Text style={styles.sectionLabel}>Legend</Text>
          <View style={styles.legendRow}>
            <View
              style={[
                styles.legendSwatch,
                { backgroundColor: SELECTED_PROPERTY_STYLE.colorHex },
              ]}
            />
            <Text style={styles.legendLabel}>{SELECTED_PROPERTY_STYLE.label}</Text>
          </View>
          {legendItems.applies.map((item) => (
            <View key={`applies-${item.color}-${item.label}`} style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{item.label}</Text>
            </View>
          ))}
          {legendItems.nearby.map((item) => (
            <View key={`nearby-${item.color}-${item.label}`} style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: item.color, opacity: 0.55 }]} />
              <Text style={[styles.legendLabel, { color: TEXT_MUTED }]}>
                {item.label} (nearby only)
              </Text>
            </View>
          ))}
          {legendMore > 0 && (
            <Text style={{ fontSize: 8, color: TEXT_MUTED }}>
              +{legendMore} more layers on the online map.
            </Text>
          )}

          {sources.length > 0 && (
            <>
              <View style={{ height: 12 }} />
              <Text style={styles.sectionLabel}>References</Text>
              {sources.map((url) => (
                <Text key={url} style={styles.link}>
                  {prettyUrl(url)}
                </Text>
              ))}
            </>
          )}
        </View>
      </View>

      <ChromeBottom branding={branding} />
    </Page>
  );
}

const MODULE_ORDER: Module[] = [
  "flooding",
  "flood_planning",
  "overland_flow",
  "storm_tide",
  "bushfire",
  "vegetation",
  "environment",
  "heritage",
  "easements",
  "noise",
  "steep_land",
  "acid_sulfate",
  "mining",
  "schools",
  "zoning",
];
function moduleIndex(m: Module): number {
  return MODULE_ORDER.indexOf(m) + 1;
}

// ── At a glance page ──────────────────────────────────────────────────────

function pdfIsFailed(m: ReportPayload["modules"][number]): boolean {
  return (
    !!m.raw &&
    typeof m.raw === "object" &&
    (m.raw as RawAttrs).fetchFailed === true
  );
}

/** Flagged/failed modules in reading order: most severe first, failed
 * checks last. Shared by the cover, the page-number references and the
 * document's module-page order so "p. N" on the cover stays truthful. */
function attentionOrder(modules: ReportPayload["modules"]) {
  return modules
    .filter((m) => m.hasConsideration || pdfIsFailed(m))
    .sort((a, b) => {
      const fa = pdfIsFailed(a) ? 1 : 0;
      const fb = pdfIsFailed(b) ? 1 : 0;
      if (fa !== fb) return fa - fb;
      return (
        RISK_RANK[riskOf(b.riskLevel, b.hasConsideration)] -
        RISK_RANK[riskOf(a.riskLevel, a.hasConsideration)]
      );
    });
}

function AtAGlancePage({
  payload,
  branding,
}: {
  payload: ReportPayload;
  branding: ReportBranding | null;
}) {
  const { report, address, modules, considerationCount } = payload;
  const attention = attentionOrder(modules);
  const clear = modules.filter((m) => !m.hasConsideration && !pdfIsFailed(m));
  const distanceKm = haversineKm(BRISBANE_CBD, { lat: address.lat, lng: address.lng });
  const zoningRow = modules.find((m) => m.module === "zoning");
  const zRaw =
    zoningRow?.raw && typeof zoningRow.raw === "object"
      ? (zoningRow.raw as RawAttrs)
      : null;
  const zoneText = (zRaw?.zonePrecinct as string | null) ?? (zRaw?.zoneCode as string | null) ?? null;
  const zoneSpecific = (zRaw?.lvl2Zone as string | null) ?? null;
  const zoneFamily = (zRaw?.lvl1Zone as string | null) ?? null;

  return (
    // wrap={false}: the summary must stay ONE page — the attention rows'
    // "p. N" references count from it. Rows are compacted above so even a
    // 10-flag report fits.
    <Page size="A4" style={styles.page} wrap={false}>
      <ChromeTop branding={branding} address={formatAuAddress(address.address_text, payload.postcode)} />
      <Text style={styles.eyebrow}>At a glance</Text>
      <Text style={styles.title}>{formatAuAddress(address.address_text, payload.postcode)}</Text>
      <Text style={styles.question}>
        {modules.length} public-data modules.{" "}
        {considerationCount === 0
          ? "Nothing of concern across the address."
          : `${considerationCount} module${considerationCount > 1 ? "s have" : " has"} something worth reading.`}
      </Text>

      <View style={styles.divider} />

      <View style={styles.body}>
        <View style={styles.leftCol}>
          {/* Verdict layer — editorial hairline list, not boxes: severity
              dot + name + one address-stripped summary line, severity
              label and page ref on the right. Compact enough that a
              10-flag report plus the full clear list fits one page. */}
          {attention.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginBottom: 4 }]}>
                Needs attention ({attention.length})
              </Text>
              <View style={{ borderTopWidth: 0.5, borderTopColor: HAIRLINE }}>
                {attention.map((m, idx) => {
                  const meta = MODULE_META[m.module];
                  const failed = pdfIsFailed(m);
                  const level = riskOf(m.riskLevel, m.hasConsideration);
                  const statusColor = failed ? APPLE_HEX.orange : RISK_STYLE[level].hex;
                  const statusLabel = failed ? "Not checked" : RISK_STYLE[level].label;
                  const line = failed
                    ? "Source unreachable this run. Re-run the checks."
                    : coverLine(
                        report.narrative[m.module]?.summary,
                        address.address_text,
                      ) ?? meta.sourceLabel;
                  return (
                    <View
                      key={m.module}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: 6,
                        borderBottomWidth: 0.5,
                        borderBottomColor: HAIRLINE,
                      }}
                    >
                      <View
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          backgroundColor: statusColor,
                          marginRight: 8,
                        }}
                      />
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY }}>
                          {meta.name}
                        </Text>
                        <Text style={{ fontSize: 7.5, color: TEXT_MUTED, lineHeight: 1.35 }}>
                          {line}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", width: 62 }}>
                        <Text
                          style={{
                            fontSize: 7.5,
                            fontFamily: "Helvetica-Bold",
                            color: statusColor,
                            letterSpacing: 0.8,
                            textTransform: "uppercase",
                          }}
                        >
                          {statusLabel}
                        </Text>
                        <Text style={{ fontSize: 6.5, color: TEXT_MUTED, marginTop: 1.5 }}>
                          p. {idx + 3}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* Every clear check is NAMED on the cover — "safe" must be
              visible without flipping to the evidence page. Inline names
              stay compact at any count. */}
          {clear.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 12, marginBottom: 3 }]}>
                Checked &amp; clear ({clear.length})
              </Text>
              <Text style={{ fontSize: 8, color: TEXT_BODY, lineHeight: 1.6 }}>
                {clear.map((m) => MODULE_META[m.module].name).join("  ·  ")}
              </Text>
              <Text style={{ fontSize: 7, color: TEXT_MUTED, marginTop: 3 }}>
                Nothing found on the lot. Evidence is on the Checked &amp; clear page.
              </Text>
            </>
          )}
        </View>

        <View style={styles.rightCol}>
          <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Details</Text>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Date of report</Text>
            <Text style={styles.metaValue}>{formatDate(report.generated_at)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Address</Text>
            <Text style={styles.metaValue}>{formatAuAddress(address.address_text, payload.postcode)}</Text>
          </View>
          {payload.parcel?.lotPlan && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Lot / Plan</Text>
              <Text style={[styles.metaValue, { fontFamily: "Helvetica" }]}>
                {payload.parcel.lotNumber ?? payload.parcel.lotPlan} / {payload.parcel.planNumber ?? ""}
              </Text>
            </View>
          )}
          {payload.parcel?.areaM2 && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Lot area</Text>
              <Text style={styles.metaValue}>
                {payload.parcel.areaM2.toLocaleString("en-AU")} m²{payload.parcel.tenure ? ` · ${payload.parcel.tenure}` : ""}
              </Text>
            </View>
          )}
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Council</Text>
            <Text style={styles.metaValue}>
              {payload.parcel?.lga
                ? /council/i.test(payload.parcel.lga)
                  ? payload.parcel.lga
                  : `${payload.parcel.lga} Council`
                : "Not identified"}
            </Text>
          </View>
          {payload.parcel?.suburb && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Locality</Text>
              <Text style={styles.metaValue}>{payload.parcel.suburb}</Text>
            </View>
          )}
          {zoneText && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Zoning</Text>
              <Text style={styles.metaValue}>{zoneText}</Text>
              {zoneSpecific && zoneSpecific !== zoneText && (
                <Text style={[styles.metaValue, { color: TEXT_MUTED, fontSize: 8.5 }]}>{zoneSpecific}</Text>
              )}
              {zoneFamily && zoneFamily !== zoneText && (
                <Text style={[styles.metaValue, { color: TEXT_MUTED, fontSize: 8.5 }]}>{zoneFamily}</Text>
              )}
            </View>
          )}
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Coordinates</Text>
            <Text style={[styles.metaValue, { fontFamily: "Helvetica" }]}>
              {address.lat.toFixed(4)}, {address.lng.toFixed(4)}
            </Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Distance to CBD</Text>
            <Text style={styles.metaValue}>{distanceKm.toFixed(1)} km</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Report id</Text>
            <Text style={[styles.metaValue, { fontFamily: "Helvetica", fontSize: 8.5 }]}>
              {report.id.slice(0, 8)}
            </Text>
          </View>
        </View>
      </View>

      <ChromeBottom branding={branding} />
    </Page>
  );
}

// ── Next steps page ───────────────────────────────────────────────────────

function NextStepsPage({
  modules,
  narrative,
  address,
  branding,
}: {
  /** Flagged modules in severity order (failed checks excluded). */
  modules: ReportPayload["modules"];
  narrative: ReportPayload["report"]["narrative"];
  address: string;
  branding: ReportBranding | null;
}) {
  const groups = modules
    .map((m) => ({
      module: m.module,
      level: riskOf(m.riskLevel, m.hasConsideration),
      questions: (narrative[m.module]?.questions_to_ask ?? []).slice(0, 4),
    }))
    .filter((g) => g.questions.length > 0);
  if (groups.length === 0) return null;

  return (
    // Wrapping ALLOWED: a many-flag report paginates naturally, and the
    // fixed chrome (header + opaque footer band) repeats on every page.
    <Page size="A4" style={styles.page}>
      <ChromeTop branding={branding} address={address} />
      <Text style={styles.eyebrow}>Take this to your conveyancer</Text>
      <Text style={styles.title}>Next steps</Text>
      <Text style={styles.question}>
        Every question raised by the flagged checks, in one checklist
        for your conveyancer, building inspector or the Council.
      </Text>
      <View style={{ marginTop: 14 }}>
        {groups.map((g) => (
          <View key={g.module} style={{ marginBottom: 12 }} wrap={false}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  backgroundColor: RISK_STYLE[g.level].hex,
                  marginRight: 6,
                }}
              />
              <Text style={{ fontSize: 10.5, fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY }}>
                {MODULE_META[g.module].name}
              </Text>
              <Text
                style={{
                  fontSize: 7.5,
                  fontFamily: "Helvetica-Bold",
                  color: RISK_STYLE[g.level].hex,
                  marginLeft: 6,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                }}
              >
                {RISK_STYLE[g.level].label}
              </Text>
            </View>
            {g.questions.map((q, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 3.5, paddingLeft: 1 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderWidth: 0.8,
                    borderColor: HAIRLINE,
                    borderRadius: 2,
                    marginRight: 7,
                    marginTop: 1.5,
                  }}
                />
                <Text style={{ flex: 1, fontSize: 9, color: TEXT_BODY, lineHeight: 1.4 }}>
                  {q}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      <ChromeBottom branding={branding} />
    </Page>
  );
}

// ── Checked & clear page ─────────────────────────────────────────────────

function ClearPage({
  modules,
  narrative,
  address,
  branding,
}: {
  modules: ReportPayload["modules"];
  narrative: ReportPayload["report"]["narrative"];
  address: string;
  branding: ReportBranding | null;
}) {
  if (modules.length === 0) return null;
  return (
    // Wrapping allowed — the fixed chrome repeats on any spill page.
    <Page size="A4" style={styles.page}>
      <ChromeTop branding={branding} address={address} />
      <Text style={styles.eyebrow}>Evidence of checks run</Text>
      <Text style={styles.title}>Checked &amp; clear</Text>
      <Text style={styles.question}>
        These {modules.length} checks ran against the same council and
        Queensland Government layers and found nothing on the lot.
      </Text>
      <View style={{ marginTop: 12 }}>
        {modules.map((m) => {
          const meta = MODULE_META[m.module];
          const summary = narrative[m.module]?.summary;
          return (
            <View
              key={m.module}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: SURFACE,
                borderWidth: 0.5,
                borderColor: HAIRLINE,
                borderRadius: 8,
                paddingVertical: 7,
                paddingHorizontal: 10,
                marginBottom: 5,
              }}
            >
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: meta.tintHex,
                  marginRight: 8,
                }}
              />
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 9.5, fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY }}>
                  {meta.name}
                </Text>
                <Text style={{ fontSize: 7.5, color: TEXT_MUTED }}>
                  {summary
                    ? summary.length > 120
                      ? `${summary.slice(0, 117)}…`
                      : summary
                    : meta.sourceLabel}
                </Text>
              </View>
              <View style={[styles.statusPill, { backgroundColor: `${RISK_STYLE.none.hex}24`, marginRight: 0 }]}>
                <View style={[styles.statusDot, { backgroundColor: RISK_STYLE.none.hex }]} />
                <Text style={[styles.statusLabel, { color: RISK_STYLE.none.hex }]}>All clear</Text>
              </View>
            </View>
          );
        })}
      </View>
      <ChromeBottom branding={branding} />
    </Page>
  );
}

// ── Disclaimer page ───────────────────────────────────────────────────────

function DisclaimerPage({
  address,
  branding,
}: {
  address: string;
  branding: ReportBranding | null;
}) {
  return (
    <Page size="A4" style={styles.page}>
      <ChromeTop branding={branding} address={address} />
      <Text style={styles.eyebrow}>End of report</Text>
      <Text style={styles.title}>Use this responsibly.</Text>
      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerLabel}>Disclaimer</Text>
        <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
      </View>
      <View style={[styles.disclaimerBox, { marginTop: 10 }]}>
        <Text style={styles.disclaimerLabel}>Public data only</Text>
        <Text style={styles.disclaimerText}>
          No valuation. No QLD Title Search. Drainage, sewerage, access, and
          private covenants are recorded on title and are not captured here.
          Order a current title search via a conveyancer.
        </Text>
      </View>
      <ChromeBottom branding={branding} />
    </Page>
  );
}

// ── Cover page — full-bleed aerial in the landing-hero (light) style:
// the washed near-grayscale aerial with the white veil baked into the
// jpeg (see renderCoverAerial) IS the page background, slate ink over
// the veiled zones, brand identity up top, prepared-by strip along the
// bottom. Nothing can overlap: the type never competes with the photo. ──

function CoverPage({
  payload,
  branding,
  coverPng,
}: {
  payload: ReportPayload;
  branding: ReportBranding | null;
  coverPng: Buffer | null;
}) {
  const { report, address } = payload;
  const accent = branding?.color ?? ACCENT_DEFAULT;
  const who = branding?.name ?? "LotLens";
  const subLine = [
    payload.parcel?.suburb,
    payload.parcel?.lotPlan
      ? `Lot ${payload.parcel.lotNumber ?? ""} ${payload.parcel.planNumber ?? payload.parcel.lotPlan}`.replace(/\s+/g, " ")
      : null,
    payload.parcel?.areaM2 ? `${payload.parcel.areaM2.toLocaleString("en-AU")} m²` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <Page size="A4" style={{ backgroundColor: PAGE_BG, fontFamily: "Helvetica" }} wrap={false}>
      {/* Full-A4 flow canvas: a wrap={false} page shrinks to its content
        * height and drops top-anchored absolutes when everything is
        * absolute — this View pins the page to true A4 and anchors the
        * absolute children below. */}
      <View style={{ width: "100%", height: 841.89 }}>
      {/* Full-bleed washed aerial (veil gradient baked into the jpeg) */}
      {coverPng && (
        // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image has no alt prop.
        <Image
          src={coverPng}
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      )}
      <View
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 6, backgroundColor: accent }}
      />

      {/* Brand block + the property, over the heavy top veil */}
      <View style={{ position: "absolute", top: 58, left: 48, right: 48 }}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {branding?.logo && (
            // eslint-disable-next-line jsx-a11y/alt-text -- React-PDF Image has no alt prop.
            <Image
              src={branding.logo}
              style={{ height: 30, width: 110, objectFit: "contain", objectPosition: "left", marginRight: 10 }}
            />
          )}
          <Text style={{ fontSize: 19, fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY, letterSpacing: -0.2 }}>
            {who}
          </Text>
        </View>
        <Text style={{ fontSize: 8.5, color: TEXT_MUTED, marginTop: 4, letterSpacing: 0.3 }}>
          Property due diligence from public council &amp; Queensland Government data
        </Text>

        <View style={{ width: 34, height: 3, backgroundColor: accent, marginTop: 24, marginBottom: 24 }} />

        <Text style={styles.eyebrow}>Property fact pack</Text>
        <Text style={{ fontSize: 26, fontFamily: "Helvetica-Bold", lineHeight: 1.12, color: TEXT_PRIMARY, letterSpacing: -0.4 }}>
          {formatAuAddress(address.address_text, payload.postcode)}
        </Text>
        {subLine && (
          <Text style={{ fontSize: 9, color: TEXT_MUTED, marginTop: 7, letterSpacing: 0.2 }}>
            {subLine}
          </Text>
        )}
      </View>

      {/* Prepared-by strip, over the heavy bottom veil */}
      <View
        style={{
          position: "absolute",
          bottom: 44,
          left: 48,
          right: 48,
          borderTopWidth: 0.5,
          // Solid 6-digit hex only: react-pdf paints rgba()/8-digit-hex
          // BORDER colors as red (backgrounds are fine).
          borderTopColor: "#94a3b8",
          paddingTop: 12,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <View>
          <Text style={styles.metaLabel}>Prepared by</Text>
          <Text style={{ fontSize: 9, color: TEXT_PRIMARY, fontFamily: "Helvetica-Bold" }}>
            {who}
            {branding?.name ? "  ·  with LotLens" : ""}
          </Text>
        </View>
        <View>
          <Text style={styles.metaLabel}>Date</Text>
          <Text style={{ fontSize: 9, color: TEXT_PRIMARY }}>{formatDate(report.generated_at)}</Text>
        </View>
        <View>
          <Text style={styles.metaLabel}>Checks run</Text>
          <Text style={{ fontSize: 9, color: TEXT_PRIMARY }}>{payload.modules.length} public-data modules</Text>
        </View>
        <View>
          <Text style={styles.metaLabel}>Report id</Text>
          <Text style={{ fontSize: 9, color: TEXT_PRIMARY }}>{report.id.slice(0, 8)}</Text>
        </View>
      </View>
      </View>
    </Page>
  );
}

/** Fixed page chrome, industry-report style: a thin accent strip, then a
 * running header naming the preparer (left) and the property (right) on
 * EVERY page. Render FIRST inside a Page. */
function ChromeTop({
  branding,
  address,
}: {
  branding: ReportBranding | null;
  address: string;
}) {
  const accent = branding?.color ?? ACCENT_DEFAULT;
  const who = branding?.name ?? "LotLens";
  const addr = address.length > 58 ? `${address.slice(0, 55)}…` : address;
  return (
    <>
      <View
        fixed
        style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, backgroundColor: accent }}
      />
      <View fixed style={styles.runningHeader}>
        <Text style={styles.runningBrand}>{who}</Text>
        <Text style={styles.runningAddress}>{addr}</Text>
      </View>
    </>
  );
}

/** Fixed footer band with an OPAQUE background — rendered LAST inside a
 * Page so it paints over any body overflow; the pagination line can
 * never be collided with. */
function ChromeBottom({ branding }: { branding: ReportBranding | null }) {
  const who = branding?.name
    ? `${branding.name} · prepared with LotLens`
    : "LotLens · Property Fact Pack";
  return (
    <View style={styles.footerBand} fixed>
      <Text>{who}</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

// ── Document ──────────────────────────────────────────────────────────────

export function ReportPDF({
  payload,
  maps = [],
  branding = null,
  coverPng = null,
}: {
  payload: ReportPayload;
  /** Pre-rendered module map PNGs, one per module (Buffer or null). */
  maps?: ModuleMapPng[];
  /** Customer branding (subscriber feature) — null renders plain LotLens. */
  branding?: ReportBranding | null;
  /** Overlay-free aerial with the lot outline, for the cover page. */
  coverPng?: Buffer | null;
}) {
  const { report, address, modules } = payload;
  const mapByModule = new Map<Module, Buffer | null>();
  for (const m of maps) mapByModule.set(m.module, m.png);
  // Conventional AU form for every place the address is shown as a label.
  // The raw address_text (with its LGA) is kept only where it must match
  // AI-generated summary text (coverLine's prefix strip).
  const displayAddress = formatAuAddress(address.address_text, payload.postcode);
  const docTitle = branding?.name
    ? `${branding.name} Fact Pack · ${displayAddress}`
    : `LotLens Fact Pack · ${displayAddress}`;

  // Clear-module diet: full pages only for flagged/failed checks, in the
  // same severity order the cover lists them (so its "p. N" references
  // hold). Clear checks collapse to the one-page evidence summary.
  const attention = attentionOrder(modules);
  const clear = modules.filter((m) => !m.hasConsideration && !pdfIsFailed(m));

  return (
    <Document title={docTitle}>
      <CoverPage payload={payload} branding={branding} coverPng={coverPng} />
      <AtAGlancePage payload={payload} branding={branding} />
      {attention.map((m) => {
        const raw =
          m.raw && typeof m.raw === "object" ? (m.raw as RawAttrs) : undefined;
        return (
          <ModulePage
            key={m.module}
            module={m.module}
            hasConsideration={m.hasConsideration}
            riskLevel={m.riskLevel}
            narrative={report.narrative[m.module]}
            raw={raw}
            mapPng={mapByModule.get(m.module) ?? null}
            address={displayAddress}
            branding={branding}
          />
        );
      })}
      <NextStepsPage
        modules={attention.filter((m) => !pdfIsFailed(m))}
        narrative={report.narrative}
        address={displayAddress}
        branding={branding}
      />
      <ClearPage
        modules={clear}
        narrative={report.narrative}
        address={displayAddress}
        branding={branding}
      />
      <DisclaimerPage address={displayAddress} branding={branding} />
    </Document>
  );
}

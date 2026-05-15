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
  Link,
  Font,
} from "@react-pdf/renderer";

import type { ModuleNarrative } from "@/lib/anthropic";
import { MODULE_META, APPLE_HEX } from "@/lib/module-meta";
import type { ReportPayload } from "@/lib/pipeline";
import type { Module, RiskLevel } from "@/lib/supabase";
import { prettyUrl } from "@/lib/url";

// ── Apple-ish tokens (mirrors apple.com / iCloud system surfaces) ────────

const TEXT_PRIMARY = "#1d1d1f"; // Apple primary label
const TEXT_BODY = "#3c3c43";    // Apple secondary label on light
const TEXT_MUTED = "#86868b";   // Apple tertiary / hint
const PAGE_BG = "#f5f5f7";      // apple.com page bg
const SURFACE = "#ffffff";
const HAIRLINE = "#d2d2d7";     // Apple separator
const PANEL_BG = "#fbfbfd";     // very light surface for callouts

const RISK_STYLE: Record<RiskLevel, { label: string; tint: string }> = {
  high:     { label: "High",             tint: APPLE_HEX.red },
  medium:   { label: "Medium",           tint: APPLE_HEX.orange },
  low:      { label: "Low",              tint: APPLE_HEX.teal },
  very_low: { label: "Very low",         tint: APPLE_HEX.yellow },
  none:     { label: "No consideration", tint: APPLE_HEX.green },
};

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

/** One per module — null when staticmaps render fails on that module. */
export type ModuleMapPng = { module: Module; png: Buffer | null };

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

// ── Styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    paddingTop: 44,
    paddingBottom: 44,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: TEXT_PRIMARY,
    lineHeight: 1.5,
    backgroundColor: PAGE_BG,
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
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.05,
    color: TEXT_PRIMARY,
    letterSpacing: -0.4,
  },
  question: {
    marginTop: 6,
    fontSize: 11,
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
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    marginRight: 8,
  },
  statusDot: { width: 6, height: 6, borderRadius: 999, marginRight: 5 },
  statusLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  sourceLine: {
    fontSize: 7.5,
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

  link: { fontSize: 7.5, color: APPLE_HEX.blue, textDecoration: "none", marginBottom: 1.5 },

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

  divider: { height: 0.5, backgroundColor: HAIRLINE, marginVertical: 16 },

  // ── Footer ────────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: TEXT_MUTED,
    letterSpacing: 0.4,
  },
});

// ── Per-module facts ──────────────────────────────────────────────────────

function factsRows(module: Module, raw: RawAttrs | undefined): { key: string; val: string }[] {
  if (!raw) return [];
  switch (module) {
    case "flooding": {
      const rows: { key: string; val: string }[] = [];
      if (raw.floodType) rows.push({ key: "Flood type", val: String(raw.floodType) });
      const events = asArr<RawAttrs>(raw.historicEvents);
      if (events.length > 0) rows.push({ key: "Historic events", val: events.map((e) => String(e.event)).join(", ") });
      return rows;
    }
    case "bushfire": {
      const rows: { key: string; val: string }[] = [];
      if (raw.hazardCategory) rows.push({ key: "Hazard category", val: String(raw.hazardCategory) });
      if (raw.hazardCode) rows.push({ key: "Code", val: String(raw.hazardCode) });
      return rows;
    }
    case "heritage": {
      const entries = asArr<RawAttrs>(raw.entries);
      return entries.map((e, i) => ({ key: `Entry ${i + 1}`, val: `[${e.type}] ${e.description ?? "—"}` }));
    }
    case "easements": {
      const rows: { key: string; val: string }[] = [];
      if (raw.description) rows.push({ key: "Layer", val: String(raw.description) });
      return rows;
    }
    case "zoning": {
      const rows: { key: string; val: string }[] = [];
      if (raw.zonePrecinct) rows.push({ key: "Zone", val: String(raw.zonePrecinct) });
      if (raw.lvl1Zone) rows.push({ key: "Family", val: String(raw.lvl1Zone) });
      return rows;
    }
  }
}

// ── Module page ───────────────────────────────────────────────────────────

function ModulePage({
  module,
  riskLevel,
  hasConsideration,
  narrative,
  raw,
  mapPng,
  address,
}: {
  module: Module;
  riskLevel: RiskLevel;
  hasConsideration: boolean;
  narrative: ModuleNarrative | undefined;
  raw: RawAttrs | undefined;
  mapPng: Buffer | null;
  address: string;
}) {
  const meta = MODULE_META[module];
  const risk = RISK_STYLE[riskLevel];
  const facts = factsRows(module, raw);
  const sources = Array.from(new Set(narrative?.sources ?? []));
  const statusColor = hasConsideration ? meta.tintHex : APPLE_HEX.green;
  const statusLabel = hasConsideration ? "Considerations identified" : "No considerations identified";

  return (
    <Page size="A4" style={styles.page}>
      {/* Header */}
      <View>
        <Text style={styles.eyebrow}>0{moduleIndex(module)} · {meta.name.toUpperCase()}</Text>
        <Text style={styles.title}>{meta.name}</Text>
        <Text style={styles.question}>{meta.question}</Text>
      </View>

      {/* Hero map */}
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
            </View>
          )}

          <View style={styles.noteWrap}>
            <Text style={styles.noteLabel}>Note · </Text>
            <Text style={styles.noteText}>{meta.note}</Text>
          </View>
        </View>

        <View style={styles.rightCol}>
          {narrative?.questions_to_ask?.length ? (
            <>
              <Text style={styles.sectionLabel}>Questions to ask</Text>
              {narrative.questions_to_ask.map((q, i) => (
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
            <View style={[styles.legendSwatch, { backgroundColor: meta.tintHex }]} />
            <Text style={styles.legendLabel}>Selected property</Text>
          </View>
          {meta.legend.map((l) => (
            <View key={l.label} style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: l.colorHex }]} />
              <Text style={styles.legendLabel}>{l.label}</Text>
            </View>
          ))}

          {sources.length > 0 && (
            <>
              <View style={{ height: 12 }} />
              <Text style={styles.sectionLabel}>References</Text>
              {sources.map((url) => (
                <Link key={url} src={url} style={styles.link}>
                  {prettyUrl(url)}
                </Link>
              ))}
            </>
          )}
        </View>
      </View>

      <Footer address={address} />
    </Page>
  );
}

const MODULE_ORDER: Module[] = ["flooding", "bushfire", "heritage", "easements", "zoning"];
function moduleIndex(m: Module): number {
  return MODULE_ORDER.indexOf(m) + 1;
}

// ── At a glance page ──────────────────────────────────────────────────────

function AtAGlancePage({ payload }: { payload: ReportPayload }) {
  const { report, address, modules, considerationCount } = payload;
  const distanceKm = haversineKm(BRISBANE_CBD, { lat: address.lat, lng: address.lng });
  const zoningRow = modules.find((m) => m.module === "zoning");
  const zRaw =
    zoningRow?.raw && typeof zoningRow.raw === "object"
      ? (zoningRow.raw as RawAttrs)
      : null;
  const zoneText = (zRaw?.zonePrecinct as string | null) ?? (zRaw?.zoneCode as string | null) ?? null;
  const zoneFamily = (zRaw?.lvl1Zone as string | null) ?? null;

  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.eyebrow}>Property fact pack</Text>
      <Text style={styles.title}>{address.address_text}</Text>
      <Text style={styles.question}>
        Five public-data modules.{" "}
        {considerationCount === 0
          ? "Nothing of concern across the address."
          : `${considerationCount} module${considerationCount > 1 ? "s have" : " has"} something worth reading.`}
      </Text>

      <View style={styles.divider} />

      <View style={styles.body}>
        <View style={styles.leftCol}>
          <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>At a glance</Text>
          {modules.map((m) => {
            const meta = MODULE_META[m.module];
            const statusColor = m.hasConsideration ? meta.tintHex : APPLE_HEX.green;
            const statusLabel = m.hasConsideration ? "Considerations" : "All clear";
            return (
              <View key={m.module} style={styles.glanceRow}>
                <View style={[styles.glanceSwatch, { backgroundColor: meta.tintHex }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.glanceName}>{meta.name}</Text>
                  <Text style={styles.glanceSource}>{meta.sourceLabel}</Text>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${statusColor}24` }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.rightCol}>
          <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Details</Text>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Date of report</Text>
            <Text style={styles.metaValue}>{formatDate(report.generated_at)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Address</Text>
            <Text style={styles.metaValue}>{address.address_text}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Council</Text>
            <Text style={styles.metaValue}>Brisbane City Council</Text>
          </View>
          {zoneText && (
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Zoning</Text>
              <Text style={styles.metaValue}>{zoneText}</Text>
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

      <Footer address={address.address_text} />
    </Page>
  );
}

// ── Disclaimer page ───────────────────────────────────────────────────────

function DisclaimerPage({ address }: { address: string }) {
  return (
    <Page size="A4" style={styles.page}>
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
          private covenants are recorded on title and are not captured here —
          order a current title search via a conveyancer.
        </Text>
      </View>
      <Footer address={address} />
    </Page>
  );
}

function Footer({ address }: { address: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>PropAI · {address.length > 60 ? address.slice(0, 57) + "…" : address}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

// ── Document ──────────────────────────────────────────────────────────────

export function ReportPDF({
  payload,
  maps = [],
}: {
  payload: ReportPayload;
  /** Pre-rendered module map PNGs, one per module (Buffer or null). */
  maps?: ModuleMapPng[];
}) {
  const { report, address, modules } = payload;
  const mapByModule = new Map<Module, Buffer | null>();
  for (const m of maps) mapByModule.set(m.module, m.png);

  return (
    <Document title={`PropAI Fact Pack · ${address.address_text}`}>
      <AtAGlancePage payload={payload} />
      {modules.map((m) => {
        const raw =
          m.raw && typeof m.raw === "object" ? (m.raw as RawAttrs) : undefined;
        return (
          <ModulePage
            key={m.module}
            module={m.module}
            riskLevel={(m.riskLevel ?? "none") as RiskLevel}
            hasConsideration={m.hasConsideration}
            narrative={report.narrative[m.module]}
            raw={raw}
            mapPng={mapByModule.get(m.module) ?? null}
            address={address.address_text}
          />
        );
      })}
      <DisclaimerPage address={address.address_text} />
    </Document>
  );
}

// Print PDF rendered server-side via @react-pdf/renderer. Mirrors the
// information structure of the web /report/[id] page (Develo's per-module
// layout: title + question, status, AI summary, Things to know, Note,
// Questions to ask, Legend) while keeping our Apple-glass visual identity
// in print-appropriate form (solid surfaces — no backdrop-filter in PDF).
//
// Maps are intentionally absent: ArcGIS queries currently use
// returnGeometry=false, so we have no polygons to draw, and a pin-only
// static map adds nothing in print.

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Link,
  Font,
} from "@react-pdf/renderer";

import type { ModuleNarrative } from "@/lib/anthropic";
import { MODULE_META, APPLE_HEX } from "@/lib/module-meta";
import type { ReportPayload } from "@/lib/pipeline";
import type { Module, RiskLevel } from "@/lib/supabase";

// ── Tokens ────────────────────────────────────────────────────────────────

const TEXT_PRIMARY = "#0f1116";
const TEXT_BODY = "#3a3a44";
const TEXT_MUTED = APPLE_HEX.gray;
const PAGE_BG = "#fafafa";
const SURFACE = "#ffffff";
const BORDER = "#e6e7eb";

const RISK_STYLE: Record<RiskLevel, { label: string; tint: string }> = {
  high:     { label: "High",             tint: APPLE_HEX.red },
  medium:   { label: "Medium",           tint: APPLE_HEX.orange },
  low:      { label: "Low",              tint: APPLE_HEX.teal },
  very_low: { label: "Very low",         tint: APPLE_HEX.yellow },
  none:     { label: "No consideration", tint: APPLE_HEX.green },
};

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

Font.registerHyphenationCallback((w) => [w]);

// ── Tiny helpers ──────────────────────────────────────────────────────────

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
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: TEXT_PRIMARY,
    lineHeight: 1.5,
    backgroundColor: PAGE_BG,
  },

  // Eyebrow + big title
  eyebrow: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: TEXT_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
    color: TEXT_PRIMARY,
  },
  question: {
    marginTop: 4,
    fontSize: 12,
    color: TEXT_BODY,
  },

  // Status pill (Considerations identified / All clear)
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 0.8,
    marginRight: 8,
  },
  statusDot: { width: 8, height: 8, borderRadius: 999, marginRight: 6 },
  statusLabel: {
    fontSize: 8.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  riskPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 0.6,
  },
  riskLabel: { fontSize: 8, fontFamily: "Helvetica-Bold" },

  sourceLine: {
    fontSize: 8,
    letterSpacing: 1.2,
    color: TEXT_MUTED,
    textTransform: "uppercase",
  },

  surface: {
    backgroundColor: SURFACE,
    borderRadius: 8,
    borderWidth: 0.5,
    borderColor: BORDER,
    padding: 14,
  },

  sectionLabel: {
    fontSize: 8,
    letterSpacing: 1.4,
    color: TEXT_MUTED,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 6,
  },

  para: {
    fontSize: 10,
    color: TEXT_BODY,
    marginBottom: 6,
  },

  leadInSummary: {
    fontSize: 12.5,
    fontFamily: "Helvetica-Bold",
    color: TEXT_PRIMARY,
    marginTop: 10,
    marginBottom: 4,
    lineHeight: 1.35,
  },

  forProperty: {
    marginTop: 10,
    padding: 10,
    borderRadius: 6,
    borderWidth: 0.5,
  },
  forPropertyLabel: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  forPropertyText: { fontSize: 9.5, color: TEXT_BODY },

  factsPanel: {
    marginTop: 10,
    padding: 10,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
  },
  factRow: { flexDirection: "row", marginBottom: 2 },
  factKey: { width: 110, color: TEXT_MUTED, fontSize: 9 },
  factVal: { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 9, color: TEXT_PRIMARY },

  noteRow: { marginTop: 10, flexDirection: "row" },
  noteLabel: { fontFamily: "Helvetica-Bold", color: TEXT_PRIMARY, fontSize: 9 },
  noteText: { flex: 1, fontSize: 9, color: TEXT_BODY },

  bullet: { flexDirection: "row", marginBottom: 4 },
  bulletDot: { width: 10, fontSize: 9 },
  bulletTxt: { flex: 1, fontSize: 9.5, color: TEXT_PRIMARY },

  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  legendSwatch: { width: 10, height: 10, borderRadius: 2, marginRight: 6 },
  legendLabel: { fontSize: 9, color: TEXT_BODY },

  link: { fontSize: 8.5, color: APPLE_HEX.blue, textDecoration: "none", marginBottom: 2 },

  // Two-column grid wrappers
  twoCol: { flexDirection: "row", marginTop: 14 },
  leftCol: { width: "62%", paddingRight: 14 },
  rightCol: { width: "38%", paddingLeft: 14, borderLeftWidth: 0.5, borderLeftColor: BORDER },

  // At-a-glance
  glanceRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 8,
    backgroundColor: SURFACE,
    borderWidth: 0.5,
    borderColor: BORDER,
    marginBottom: 6,
  },
  glanceSwatch: { width: 18, height: 18, borderRadius: 5, marginRight: 10 },
  glanceName: { fontFamily: "Helvetica-Bold", fontSize: 11.5, color: TEXT_PRIMARY },
  glanceSource: { fontSize: 8, color: TEXT_MUTED, marginTop: 1 },

  metaBlock: { marginBottom: 8 },
  metaLabel: {
    fontSize: 7.5,
    letterSpacing: 1.4,
    color: TEXT_PRIMARY,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  metaValue: { fontSize: 10, color: TEXT_PRIMARY },

  disclaimerBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
  },
  disclaimerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: TEXT_PRIMARY,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  disclaimerText: { fontSize: 9, color: TEXT_BODY },

  divider: { height: 1, backgroundColor: BORDER, marginVertical: 14 },

  footer: {
    position: "absolute",
    bottom: 22,
    left: 48,
    right: 48,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: TEXT_MUTED,
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
}: {
  module: Module;
  riskLevel: RiskLevel;
  hasConsideration: boolean;
  narrative: ModuleNarrative | undefined;
  raw: RawAttrs | undefined;
}) {
  const meta = MODULE_META[module];
  const risk = RISK_STYLE[riskLevel];
  const facts = factsRows(module, raw);
  const sources = Array.from(new Set(narrative?.sources ?? []));
  const statusColor = hasConsideration ? meta.tintHex : APPLE_HEX.green;
  const statusLabel = hasConsideration ? "Considerations identified" : "No considerations identified";

  return (
    <Page size="A4" style={styles.page} wrap>
      {/* Header */}
      <View>
        <Text style={styles.eyebrow}>{meta.name.toUpperCase()}</Text>
        <Text style={styles.title}>{meta.name}</Text>
        <Text style={styles.question}>{meta.question}</Text>
      </View>

      {/* Status + source */}
      <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", flexWrap: "wrap" }}>
        <View
          style={[
            styles.statusPill,
            { borderColor: statusColor, backgroundColor: SURFACE },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <View
          style={[
            styles.riskPill,
            { borderColor: risk.tint, backgroundColor: SURFACE, marginRight: 8 },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: risk.tint }]} />
          <Text style={[styles.riskLabel, { color: risk.tint }]}>{risk.label}</Text>
        </View>
        <Text style={styles.sourceLine}>Sources: {meta.sourceLabel}</Text>
      </View>

      {narrative?.summary && <Text style={styles.leadInSummary}>{narrative.summary}</Text>}

      {/* Two-column body */}
      <View style={styles.twoCol}>
        <View style={styles.leftCol}>
          <Text style={styles.sectionLabel}>Things to know</Text>
          {meta.thingsToKnow.map((p, i) => (
            <Text key={i} style={styles.para}>{p}</Text>
          ))}

          {narrative?.detail && (
            <View
              style={[
                styles.forProperty,
                {
                  backgroundColor: "#fbfcfe",
                  borderColor: meta.tintHex + "33", // ~20% alpha when supported
                },
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

          <View style={styles.noteRow}>
            <Text style={styles.noteLabel}>Note:&nbsp;</Text>
            <Text style={styles.noteText}>{meta.note}</Text>
          </View>
        </View>

        <View style={styles.rightCol}>
          {narrative?.questions_to_ask?.length ? (
            <>
              <Text style={styles.sectionLabel}>Questions to ask</Text>
              {narrative.questions_to_ask.map((q, i) => (
                <View key={i} style={styles.bullet}>
                  <Text style={styles.bulletDot}>•</Text>
                  <Text style={styles.bulletTxt}>{q}</Text>
                </View>
              ))}
              <View style={{ height: 10 }} />
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
              <View style={{ height: 10 }} />
              <Text style={styles.sectionLabel}>Source links</Text>
              {sources.map((url) => (
                <Link key={url} src={url} style={styles.link}>{url}</Link>
              ))}
            </>
          )}
        </View>
      </View>

      <Footer />
    </Page>
  );
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
    <Page size="A4" style={styles.page} wrap>
      <Text style={styles.eyebrow}>Property Fact Pack</Text>
      <Text style={styles.title}>{address.address_text}</Text>
      <Text style={styles.question}>
        Five public-data modules.{" "}
        {considerationCount === 0
          ? "Nothing of concern across the address."
          : `${considerationCount} module${considerationCount > 1 ? "s have" : " has"} something worth reading.`}
      </Text>

      <View style={styles.divider} />

      <Text style={[styles.sectionLabel, { fontSize: 9 }]}>At a glance</Text>

      <View style={styles.twoCol}>
        <View style={styles.leftCol}>
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
                <View style={[styles.statusPill, { borderColor: statusColor, backgroundColor: SURFACE }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                  <Text style={[styles.statusLabel, { color: statusColor }]}>{statusLabel}</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.rightCol}>
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
              <Text style={styles.metaValue}>• {zoneText}</Text>
              {zoneFamily && zoneFamily !== zoneText && (
                <Text style={styles.metaValue}>• {zoneFamily}</Text>
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
            <Text style={styles.metaValue}>{report.id.slice(0, 8)}</Text>
          </View>
        </View>
      </View>

      <Footer />
    </Page>
  );
}

// ── Disclaimer page ───────────────────────────────────────────────────────

function DisclaimerPage() {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.eyebrow}>Disclaimer</Text>
      <Text style={styles.title}>Use this report responsibly.</Text>
      <View style={styles.disclaimerBox}>
        <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
      </View>
      <View style={[styles.disclaimerBox, { marginTop: 10 }]}>
        <Text style={styles.disclaimerLabel}>Public data only</Text>
        <Text style={styles.disclaimerText}>
          No valuation. No QLD Title Search. Drainage, sewerage, access, and
          private covenants are recorded on title and not captured here — order
          a current title search via a conveyancer.
        </Text>
      </View>
      <Footer />
    </Page>
  );
}

function Footer() {
  return (
    <View style={styles.footer} fixed>
      <Text>PropAI - Brisbane DD prototype</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
    </View>
  );
}

// ── Document ──────────────────────────────────────────────────────────────

export function ReportPDF({ payload }: { payload: ReportPayload }) {
  const { report, address, modules } = payload;
  return (
    <Document title={`PropAI Fact Pack - ${address.address_text}`}>
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
          />
        );
      })}
      <DisclaimerPage />
    </Document>
  );
}

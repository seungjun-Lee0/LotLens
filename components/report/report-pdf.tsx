// Print-friendly PDF document rendered server-side via @react-pdf/renderer.
//
// Maps are intentionally absent — our ArcGIS queries use returnGeometry=false
// so we have no polygons to draw, and a pin-only static map adds nothing in
// print. The PDF leads with narrative + risk + sources, mirroring the
// content but not the visual chrome of the web view.
//
// Styling: React-PDF only supports a subset of CSS (flex, color, padding,
// borders, simple typography). No gradients, no backdrop-filter — print
// surfaces use solid Apple-tinted accents instead.

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
import type { ReportPayload } from "@/lib/pipeline";
import type { Module, RiskLevel } from "@/lib/supabase";

// ── Colour tokens (mirror app/globals.css ":root" hex values) ─────────────

const APPLE = {
  blue:   "#007aff",
  green:  "#34c759",
  indigo: "#5856d6",
  orange: "#ff9500",
  pink:   "#ff2d55",
  purple: "#af52de",
  red:    "#ff3b30",
  teal:   "#5ac8fa",
  yellow: "#ffcc00",
  gray:   "#8e8e93",
};

const RISK_STYLE: Record<RiskLevel, { label: string; tint: string }> = {
  high:     { label: "High",             tint: APPLE.red },
  medium:   { label: "Medium",           tint: APPLE.orange },
  low:      { label: "Low",              tint: APPLE.teal },
  very_low: { label: "Very low",         tint: APPLE.yellow },
  none:     { label: "No consideration", tint: APPLE.green },
};

const MODULE_META: Record<
  Module,
  { name: string; tint: string; source: string }
> = {
  flooding:  { name: "Flooding",             tint: APPLE.blue,   source: "BCC Flood Awareness Mapping" },
  bushfire:  { name: "Bushfire",             tint: APPLE.orange, source: "BCC City Plan — Bushfire overlay" },
  heritage:  { name: "Heritage & Character", tint: APPLE.purple, source: "BCC heritage + character overlays" },
  easements: { name: "Easements",            tint: APPLE.teal,   source: "BCC HV easements overlay (public only)" },
  zoning:    { name: "Zoning",               tint: APPLE.indigo, source: "BCC City Plan — Zoning" },
};

const DISCLAIMER =
  "This report aggregates public data for informational purposes only. It is not legal, financial, or planning advice. Confirm all details with a qualified professional, conveyancer, or the relevant Council before making decisions.";

// React-PDF ships with Helvetica baked in — use it for safety. No webfont
// download means generation stays offline and fast.
Font.registerHyphenationCallback((w) => [w]); // disable hyphenation

const styles = StyleSheet.create({
  page: {
    paddingTop: 56,
    paddingBottom: 56,
    paddingHorizontal: 56,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#1c1c24",
    lineHeight: 1.45,
  },

  // ── Header card on page 1 ──────────────────────────────────────────
  headerEyebrow: {
    fontSize: 8,
    letterSpacing: 1.6,
    color: APPLE.gray,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.15,
    marginBottom: 10,
    color: "#0f1116",
  },
  headerMeta: {
    fontSize: 9,
    color: APPLE.gray,
    marginBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 0.5,
    marginRight: 10,
  },
  badgeDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    marginRight: 5,
  },
  badgeLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
  },
  headerSummary: {
    fontSize: 10,
    color: "#3a3a44",
  },
  divider: {
    marginVertical: 18,
    height: 1,
    backgroundColor: "#e5e7eb",
  },

  // ── Module section ─────────────────────────────────────────────────
  module: {
    marginTop: 14,
  },
  moduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  moduleLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  moduleSwatch: {
    width: 14,
    height: 14,
    borderRadius: 3,
    marginRight: 8,
  },
  moduleName: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    color: "#0f1116",
  },
  moduleSource: {
    fontSize: 8,
    color: APPLE.gray,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 1,
  },
  summary: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "#0f1116",
    marginTop: 10,
    marginBottom: 4,
  },
  detail: {
    fontSize: 10,
    color: "#3a3a44",
    marginBottom: 8,
  },
  factsBlock: {
    backgroundColor: "#f6f7f9",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  factRow: { flexDirection: "row", marginBottom: 2 },
  factKey:  { width: 110, color: APPLE.gray, fontSize: 9 },
  factVal:  { flex: 1, fontFamily: "Helvetica-Bold", fontSize: 9, color: "#1c1c24" },
  sectionLabel: {
    fontSize: 8,
    color: APPLE.gray,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 4,
  },
  bullet:    { flexDirection: "row", marginBottom: 2 },
  bulletDot: { width: 10, fontSize: 10, color: APPLE.gray },
  bulletTxt: { flex: 1, fontSize: 9.5, color: "#1c1c24" },
  link:      { fontSize: 8.5, color: APPLE.blue, textDecoration: "none" },

  disclaimerBox: {
    marginTop: 18,
    padding: 12,
    borderRadius: 6,
    backgroundColor: "#f6f7f9",
  },
  disclaimerLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#3a3a44",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  disclaimerText: { fontSize: 9, color: "#3a3a44" },

  footer: {
    position: "absolute",
    bottom: 28,
    left: 56,
    right: 56,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: APPLE.gray,
  },
});

// ── Facts renderer per module ─────────────────────────────────────────────

type RawAttrs = Record<string, unknown>;

function asArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function moduleFactsRows(module: Module, raw: RawAttrs | undefined): { key: string; val: string }[] {
  if (!raw) return [];
  switch (module) {
    case "flooding": {
      const rows: { key: string; val: string }[] = [];
      if (raw.floodType) rows.push({ key: "Flood type", val: String(raw.floodType) });
      const events = asArr<RawAttrs>(raw.historicEvents);
      if (events.length > 0) {
        rows.push({
          key: "Historic events",
          val: events.map((e) => String(e.event)).join(", "),
        });
      }
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
      if (entries.length === 0) return [];
      return entries.map((e, i) => ({
        key: `Entry ${i + 1}`,
        val: `[${e.type}] ${e.description ?? "—"}`,
      }));
    }
    case "easements": {
      const rows: { key: string; val: string }[] = [];
      if (raw.description) rows.push({ key: "Layer", val: String(raw.description) });
      return rows;
    }
    case "zoning": {
      const rows: { key: string; val: string }[] = [];
      if (raw.zonePrecinct) rows.push({ key: "Zone", val: String(raw.zonePrecinct) });
      if (raw.lvl1Zone)     rows.push({ key: "Family", val: String(raw.lvl1Zone) });
      return rows;
    }
  }
}

function ModuleBlock({
  module,
  riskLevel,
  narrative,
  raw,
  scopeNote,
}: {
  module: Module;
  riskLevel: RiskLevel;
  narrative: ModuleNarrative | undefined;
  raw: RawAttrs | undefined;
  scopeNote?: string | null;
}) {
  const meta = MODULE_META[module];
  const risk = RISK_STYLE[riskLevel];
  const facts = moduleFactsRows(module, raw);
  const sources = Array.from(new Set(narrative?.sources ?? []));

  return (
    // wrap=false avoids splitting a module across page breaks where possible
    // but allows it when content is long.
    <View style={styles.module} break={module !== "flooding"}>
      <View style={styles.moduleHeader}>
        <View style={styles.moduleLeft}>
          <View style={[styles.moduleSwatch, { backgroundColor: meta.tint }]} />
          <View>
            <Text style={styles.moduleName}>{meta.name}</Text>
            <Text style={styles.moduleSource}>{meta.source}</Text>
          </View>
        </View>
        <View style={[styles.badgePill, { borderColor: risk.tint, backgroundColor: "white" }]}>
          <View style={[styles.badgeDot, { backgroundColor: risk.tint }]} />
          <Text style={[styles.badgeLabel, { color: risk.tint }]}>{risk.label}</Text>
        </View>
      </View>

      {narrative && (
        <>
          <Text style={styles.summary}>{narrative.summary}</Text>
          <Text style={styles.detail}>{narrative.detail}</Text>
        </>
      )}

      {facts.length > 0 && (
        <View style={styles.factsBlock}>
          {facts.map((f, i) => (
            <View key={i} style={styles.factRow}>
              <Text style={styles.factKey}>{f.key}</Text>
              <Text style={styles.factVal}>{f.val}</Text>
            </View>
          ))}
          {scopeNote && (
            <Text style={[styles.factVal, { fontFamily: "Helvetica", color: APPLE.gray, marginTop: 6 }]}>
              {scopeNote}
            </Text>
          )}
        </View>
      )}

      {narrative?.questions_to_ask?.length ? (
        <>
          <Text style={styles.sectionLabel}>Questions to ask</Text>
          {narrative.questions_to_ask.map((q, i) => (
            <View key={i} style={styles.bullet}>
              <Text style={styles.bulletDot}>•</Text>
              <Text style={styles.bulletTxt}>{q}</Text>
            </View>
          ))}
        </>
      ) : null}

      {sources.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>Sources</Text>
          {sources.map((url) => (
            <Link key={url} src={url} style={styles.link}>
              {url}
            </Link>
          ))}
        </>
      )}
    </View>
  );
}

// ── Document ──────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-AU", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function ReportPDF({ payload }: { payload: ReportPayload }) {
  const { report, address, modules, considerationCount } = payload;
  const headlineRisk: RiskLevel =
    considerationCount === 0
      ? "none"
      : modules.find((m) => m.riskLevel === "high")
        ? "high"
        : modules.find((m) => m.riskLevel === "medium")
          ? "medium"
          : "low";
  const headlineStyle = RISK_STYLE[headlineRisk];

  return (
    <Document title={`PropAI DD — ${address.address_text}`}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <Text style={styles.headerEyebrow}>Due Diligence Report</Text>
        <Text style={styles.headerTitle}>{address.address_text}</Text>
        <Text style={styles.headerMeta}>
          Generated {formatTime(report.generated_at)}  ·  Report id {report.id.slice(0, 8)}
        </Text>
        <View style={styles.headerRow}>
          <View style={[styles.badgePill, { borderColor: headlineStyle.tint, backgroundColor: "white" }]}>
            <View style={[styles.badgeDot, { backgroundColor: headlineStyle.tint }]} />
            <Text style={[styles.badgeLabel, { color: headlineStyle.tint }]}>
              {headlineStyle.label}
            </Text>
          </View>
          <Text style={styles.headerSummary}>
            {considerationCount === 0
              ? "No considerations identified across the 5 modules."
              : `${considerationCount} consideration${considerationCount > 1 ? "s" : ""} identified across the 5 modules.`}
          </Text>
        </View>

        <View style={styles.divider} />

        {/* Module sections */}
        {modules.map((row) => {
          const raw =
            row.raw && typeof row.raw === "object"
              ? (row.raw as RawAttrs)
              : undefined;
          const scope = raw && typeof raw.scopeNote === "string" ? raw.scopeNote : null;
          return (
            <ModuleBlock
              key={row.module}
              module={row.module}
              riskLevel={(row.riskLevel ?? "none") as RiskLevel}
              narrative={report.narrative[row.module]}
              raw={raw}
              scopeNote={scope}
            />
          );
        })}

        {/* Disclaimer (on its own page if needed) */}
        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerLabel}>Disclaimer</Text>
          <Text style={styles.disclaimerText}>{DISCLAIMER}</Text>
        </View>

        {/* Footer on every page */}
        <View style={styles.footer} fixed>
          <Text>© PropAI — Brisbane DD prototype</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} / ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

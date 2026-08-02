// Transport-stop map badges: a mode-coloured circle with a white lucide
// glyph, shared by the web map (MapLibre symbol images) and the PDF
// renderer (SVG fragments composited by sharp) so both draw the identical
// marker.
//
// Keyed by the LEGEND LABEL the overlay extractor tags each stop with -
// the one string both renderers already carry per feature.
//
// Glyph path data is copied from lucide (ISC licence, same package this
// app already ships) rather than imported: lucide-react exports React
// components, and the PDF path needs raw geometry to embed in an SVG
// string on the server.

import { DEVELO_HEX } from "@/lib/overlays";

type IconNode =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; w: number; h: number; rx?: number };

// lucide train-front / bus / ship / tram-front, 24×24 viewBox.
const TRAIN: IconNode[] = [
  { tag: "path", d: "M8 3.1V7a4 4 0 0 0 8 0V3.1" },
  { tag: "path", d: "m9 15-1-1" },
  { tag: "path", d: "m15 15 1-1" },
  { tag: "path", d: "M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z" },
  { tag: "path", d: "m8 19-2 3" },
  { tag: "path", d: "m16 19 2 3" },
];
const BUS: IconNode[] = [
  { tag: "path", d: "M8 6v6" },
  { tag: "path", d: "M15 6v6" },
  { tag: "path", d: "M2 12h19.6" },
  { tag: "path", d: "M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5C20.1 6.8 19.1 6 18 6H4a2 2 0 0 0-2 2v10h3" },
  { tag: "circle", cx: 7, cy: 18, r: 2 },
  { tag: "path", d: "M9 18h5" },
  { tag: "circle", cx: 16, cy: 18, r: 2 },
];
const SHIP: IconNode[] = [
  { tag: "path", d: "M12 10.189V14" },
  { tag: "path", d: "M12 2v3" },
  { tag: "path", d: "M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6" },
  { tag: "path", d: "M19.38 20A11.6 11.6 0 0 0 21 14l-8.188-3.639a2 2 0 0 0-1.624 0L3 14a11.6 11.6 0 0 0 2.81 7.76" },
  { tag: "path", d: "M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" },
];
const TRAM: IconNode[] = [
  { tag: "rect", x: 4, y: 3, w: 16, h: 16, rx: 2 },
  { tag: "path", d: "M4 11h16" },
  { tag: "path", d: "M12 3v8" },
  { tag: "path", d: "m8 19-2 3" },
  { tag: "path", d: "m18 22-2-3" },
  { tag: "path", d: "M8 15h.01" },
  { tag: "path", d: "M16 15h.01" },
];

const STOP_ICONS: Record<string, { hex: string; nodes: IconNode[] }> = {
  "Train station": { hex: DEVELO_HEX.stopTrain, nodes: TRAIN },
  "Ferry terminal": { hex: DEVELO_HEX.stopFerry, nodes: SHIP },
  "Bus stop": { hex: DEVELO_HEX.stopBus, nodes: BUS },
  "Tram stop": { hex: DEVELO_HEX.stopTram, nodes: TRAM },
};

export function hasStopIcon(legendLabel: string): boolean {
  return legendLabel in STOP_ICONS;
}

function nodeSVG(n: IconNode): string {
  switch (n.tag) {
    case "path":
      return `<path d="${n.d}"/>`;
    case "circle":
      return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}"/>`;
    case "rect":
      return `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${n.rx ?? 0}"/>`;
  }
}

/**
 * SVG fragment for one stop badge centred on (cx, cy): mode-coloured
 * disc, white ring, white glyph. Returns null for labels without a glyph
 * (callers fall back to a plain dot).
 *
 * Glyph strokes use 2.4 (vs lucide's 2) in the 24-unit space: at the small
 * sizes these badges render: and after the PDF's ~0.44× downscale: the
 * stock weight thins into illegibility.
 */
export function stopBadgeFragment(
  legendLabel: string,
  cx: number,
  cy: number,
  diameter: number,
): string | null {
  const def = STOP_ICONS[legendLabel];
  if (!def) return null;
  const ring = Math.max(1.5, diameter * 0.07);
  const r = diameter / 2 - ring / 2;
  const glyph = diameter * 0.58;
  const scale = glyph / 24;
  return (
    `<g>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${def.hex}" stroke="#ffffff" stroke-width="${ring}"/>` +
    `<g transform="translate(${cx - glyph / 2} ${cy - glyph / 2}) scale(${scale})"` +
    ` fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
    def.nodes.map(nodeSVG).join("") +
    `</g></g>`
  );
}

/** Standalone badge SVG document, for MapLibre's addImage via data URI. */
export function stopBadgeSVG(legendLabel: string, size: number): string | null {
  const frag = stopBadgeFragment(legendLabel, size / 2, size / 2, size);
  if (!frag) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${frag}</svg>`;
}

// Fit a report module page's two-column body into its fixed height.
//
// The PDF gives every module ONE page (wrap={false}) with a hard ceiling on
// the body. When a module carries a lot of content (three "Things to know"
// paragraphs, a long property narrative and eight facts rows) the column
// simply did not fit: React-PDF squeezed the blocks, which drew paragraphs
// over each other, and clipped whatever ran past the ceiling (the end of
// "For this property", the Note). Nothing can be allowed to overflow, so
// this measures the text up front and trims to a budget BEFORE layout.
//
// Priority when space runs out, most valuable first:
//   facts (this property's data)  >  "For this property" narrative  >
//   "Things to know" (generic, the same on every report)  >  Note
// On the right: questions  >  on-lot legend rows  >  nearby legend rows  >
// references.
//
// Measurement uses the standard Helvetica AFM advance widths (the PDF uses
// the built-in Helvetica), with a greedy word wrap that mirrors React-PDF's
// (hyphenation is disabled in report-pdf, so words never split).

/** Helvetica advance widths, per 1000 units of font size. */
const HELVETICA: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
  "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556,
  "8": 556, "9": 556, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556,
  "@": 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278,
  "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556,
  o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500,
  y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
  "’": 222, "‘": 222, "“": 333, "”": 333, "–": 556, "—": 1000, "·": 278, "²": 333,
  "…": 1000, "•": 350,
};
const DEFAULT_ADVANCE = 556;
/** Helvetica-Bold runs ~6% wider across ordinary prose. */
const BOLD_FACTOR = 1.06;

export function textWidth(s: string, fontSize: number, bold = false): number {
  let units = 0;
  for (const ch of s) units += HELVETICA[ch] ?? DEFAULT_ADVANCE;
  return (units / 1000) * fontSize * (bold ? BOLD_FACTOR : 1);
}

/** Lines the text occupies at `width`, greedy word wrap. */
export function lineCount(text: string, width: number, fontSize: number, bold = false): number {
  const space = textWidth(" ", fontSize, bold);
  let lines = 0;
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    lines += 1;
    let cur = 0;
    for (const w of words) {
      const ww = textWidth(w, fontSize, bold);
      if (cur === 0) cur = ww;
      else if (cur + space + ww <= width) cur += space + ww;
      else {
        lines += 1;
        cur = ww;
      }
    }
  }
  return lines;
}

// ── Page geometry (must track styles in report-pdf.tsx) ──────────────────

const A4_WIDTH = 595.28;
const PAGE_PADDING_X = 42;
const CONTENT_W = A4_WIDTH - 2 * PAGE_PADDING_X;
/** leftCol: 62% wide, 16 pt right padding. */
export const LEFT_W = CONTENT_W * 0.62 - 16;
/** rightCol: 38% wide. */
export const RIGHT_W = CONTENT_W * 0.38;
/** styles.body maxHeight. */
export const BODY_H = 328;
/** Headroom for measurement error: a clipped last line is the failure this
 * whole module exists to prevent, so under-fill slightly instead. */
const SAFETY = 10;

const PARA_SIZE = 8.5;
const PARA_LINE = PARA_SIZE * 1.4;
const PARA_GAP = 3;
const SECTION_LABEL_H = 7.5 * 1.5 + 5;
/** forProperty: 2 pt rule + 10 pt padding. */
const DETAIL_W = LEFT_W - 12;
const DETAIL_HEAD = 8 + (7 * 1.5 + 3);
const DETAIL_PARA_GAP = 5;
/** factsPanel: 9 pt padding + 0.5 pt border each side, 92 pt key column. */
const FACT_VAL_W = LEFT_W - 2 * 9.5 - 92;
const FACT_LINE = PARA_SIZE * 1.5;
const FACTS_CHROME = 8 + 2 * 9.5;
const NOTE_LINE = 8 * 1.4;
const NOTE_MAX_LINES = 3;

export type FittedText = { text: string; maxLines?: number };

export type LeftFit = {
  thingsToKnow: FittedText[];
  /** null = no "For this property" block on this page. */
  detail: FittedText[] | null;
  noteLines: number;
};

const paraLines = (t: string, w: number) => lineCount(t, w, PARA_SIZE);

/** Take paragraphs in order until `budget` pt is spent; the paragraph that
 * crosses the line is clamped to the lines that still fit (minimum 2, so a
 * lone orphan line never prints). `gap` separates paragraphs. */
function takeParagraphs(
  paras: string[],
  width: number,
  budget: number,
  gap: number,
): { out: FittedText[]; used: number } {
  const out: FittedText[] = [];
  let used = 0;
  for (const text of paras) {
    const lines = paraLines(text, width);
    const lead = out.length > 0 ? gap : 0;
    const full = lead + lines * PARA_LINE;
    if (used + full <= budget) {
      out.push({ text });
      used += full;
      continue;
    }
    const room = Math.floor((budget - used - lead) / PARA_LINE);
    if (room >= 2) {
      out.push({ text, maxLines: room });
      used += lead + room * PARA_LINE;
    }
    break;
  }
  return { out, used };
}

export function fitLeftColumn(input: {
  thingsToKnow: string[];
  /** "For this property" narrative, already split into paragraphs. */
  detail: string[] | null;
  facts: Array<{ key: string; val: string }>;
  /** True when a "+N more" line follows the facts rows. */
  factsMore: boolean;
  note: string;
}): LeftFit {
  const factsH =
    input.facts.length === 0
      ? 0
      : FACTS_CHROME +
        input.facts.reduce(
          (h, f) => h + lineCount(f.val, FACT_VAL_W, PARA_SIZE, true) * FACT_LINE + 2,
          0,
        ) +
        (input.factsMore ? 8 * 1.5 + 2 : 0);

  // "Note · " is set bold at 8 pt beside the text.
  const noteW = LEFT_W - textWidth("Note · ", 8, true);
  const noteFull = Math.min(NOTE_MAX_LINES, lineCount(input.note, noteW, 8));
  const noteH = (lines: number) => (lines > 0 ? 16 + lines * NOTE_LINE : 0);

  // Everything except the two prose blocks is fixed; they share the rest.
  const proseBudget = (noteLines: number) =>
    BODY_H - SAFETY - SECTION_LABEL_H - factsH - noteH(noteLines);

  const detailParas = input.detail?.filter((p) => p.trim().length > 0) ?? [];
  const detailNeed =
    detailParas.length === 0
      ? 0
      : DETAIL_HEAD +
        detailParas.reduce((h, p) => h + paraLines(p, DETAIL_W) * PARA_LINE, 0) +
        DETAIL_PARA_GAP * (detailParas.length - 1);
  const tkNeed = input.thingsToKnow.reduce(
    (h, p) => h + paraLines(p, LEFT_W) * PARA_LINE + PARA_GAP,
    0,
  );

  // The note gives way (3 → 1 line) before any prose is cut.
  let noteLines = noteFull;
  while (noteLines > 1 && detailNeed + tkNeed > proseBudget(noteLines)) noteLines -= 1;
  const budget = proseBudget(noteLines);

  if (detailNeed + tkNeed <= budget) {
    return {
      thingsToKnow: input.thingsToKnow.map((text) => ({ text })),
      detail: detailParas.length > 0 ? detailParas.map((text) => ({ text })) : null,
      noteLines,
    };
  }

  // Over budget. The generic paragraphs yield first, but never entirely:
  // two lines of the first one keep the section from being an empty label.
  const TK_FLOOR = 2 * PARA_LINE + PARA_GAP;
  const detailBudget = Math.max(0, budget - TK_FLOOR);
  let detail: FittedText[] | null = null;
  let detailUsed = 0;
  if (detailParas.length > 0) {
    const taken = takeParagraphs(
      detailParas,
      DETAIL_W,
      detailBudget - DETAIL_HEAD,
      DETAIL_PARA_GAP,
    );
    if (taken.out.length > 0) {
      detail = taken.out;
      detailUsed = DETAIL_HEAD + taken.used;
    }
  }
  const tk = takeParagraphs(input.thingsToKnow, LEFT_W, budget - detailUsed, PARA_GAP);
  // Paragraphs are cut at whole lines, so a few points usually remain:
  // hand them back to the note rather than leave it at one clipped line.
  let spare = budget - detailUsed - tk.used - PARA_GAP * tk.out.length;
  while (noteLines < noteFull && spare >= NOTE_LINE) {
    noteLines += 1;
    spare -= NOTE_LINE;
  }
  return { thingsToKnow: tk.out, detail, noteLines };
}

// ── Right column ─────────────────────────────────────────────────────────

const LEGEND_ROW = 9 + 3.5;
const LINK_LINE = 7.5 * 1.5 + 1.5;
const BULLET_W = RIGHT_W - 9;

export type RightFit = {
  questions: number;
  legendApplies: number;
  legendNearby: number;
  references: number;
};

/**
 * How many of each right-column list fit. `fixedLegendH` is the height of
 * legend content that is always drawn (the "Selected property" row, and
 * Steep Land's elevation ramp). Lists are trimmed from the least valuable
 * end until the column fits.
 */
export function fitRightColumn(input: {
  questions: string[];
  legendApplies: number;
  legendNearby: number;
  references: number;
  fixedLegendH: number;
}): RightFit {
  const fit: RightFit = {
    questions: input.questions.length,
    legendApplies: input.legendApplies,
    legendNearby: input.legendNearby,
    references: input.references,
  };
  const height = () => {
    const q =
      fit.questions === 0
        ? 0
        : SECTION_LABEL_H +
          input.questions
            .slice(0, fit.questions)
            .reduce((h, t) => h + lineCount(t, BULLET_W, PARA_SIZE) * PARA_LINE + 3, 0) +
          12;
    const shown = fit.legendApplies + fit.legendNearby;
    const hidden = input.legendApplies + input.legendNearby - shown;
    const legend =
      SECTION_LABEL_H + input.fixedLegendH + shown * LEGEND_ROW + (hidden > 0 ? 8 * 1.5 : 0);
    const refs = fit.references === 0 ? 0 : 12 + SECTION_LABEL_H + fit.references * LINK_LINE;
    return q + legend + refs;
  };
  const limit = BODY_H - SAFETY;
  while (height() > limit) {
    if (fit.references > 1) fit.references -= 1;
    else if (fit.legendNearby > 0) fit.legendNearby -= 1;
    else if (fit.references > 0) fit.references -= 1;
    else if (fit.questions > 2) fit.questions -= 1;
    else if (fit.legendApplies > 1) fit.legendApplies -= 1;
    else if (fit.questions > 0) fit.questions -= 1;
    else break;
  }
  return fit;
}

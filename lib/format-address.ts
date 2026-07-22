// Display-only address formatting.
//
// The QLD composite locator stores a label that bundles the LOCAL
// GOVERNMENT AREA between the suburb and the state, e.g.
//   "91 Middleton Street, Mount Gravatt, Brisbane City, QLD"
// The LGA ("Brisbane City") is useful internally (parcel / council lookup)
// but is NOT part of a conventional Australian postal address. This helper
// renders the stored label in the everyday form
//   "91 Middleton Street, Mount Gravatt QLD"
// grouping "Suburb STATE [postcode]" with spaces the way Australians write
// it. It runs at DISPLAY time only — the stored address_text is untouched,
// so existing reports get the tidy format too.

const STATE_TOKENS: Record<string, string> = {
  qld: "QLD",
  queensland: "QLD",
  nsw: "NSW",
  "new south wales": "NSW",
  vic: "VIC",
  victoria: "VIC",
  sa: "SA",
  "south australia": "SA",
  wa: "WA",
  "western australia": "WA",
  tas: "TAS",
  tasmania: "TAS",
  nt: "NT",
  "northern territory": "NT",
  act: "ACT",
  "australian capital territory": "ACT",
};

/** The normalised state code if `part` is a bare state token, else null. */
function stateCode(part: string): string | null {
  return STATE_TOKENS[part.trim().toLowerCase()] ?? null;
}

/**
 * If `part` is a trailing state group — "QLD", "QLD 4122" or "Queensland
 * 4122" — return its normalised state and any postcode. Else null. Lets
 * the LGA strip fire whether or not the stored label already carries a
 * postcode after the state.
 */
function stateTail(part: string): { state: string; postcode: string } | null {
  const m = part.trim().match(/^(.*?)\s*(\d{4})$/);
  const base = m ? m[1] : part;
  const state = stateCode(base);
  if (!state) return null;
  return { state, postcode: m ? m[2] : "" };
}

/**
 * Format a stored address label into the conventional Australian form for
 * display: "91 Middleton Street, Mount Gravatt QLD 4122". The LGA is
 * dropped, and the suburb/state/postcode are grouped with spaces.
 *
 * `postcode` (from the ABS POA lookup) is injected when the stored label
 * has none — QLD's locator omits it. Idempotent and safe on labels that
 * are already conventional (Google's "…, Mount Gravatt QLD 4122,
 * Australia", test fixtures): the state group already carries the
 * postcode, so nothing is duplicated.
 */
export function formatAuAddress(
  raw: string | null | undefined,
  postcode?: string | null,
): string {
  if (!raw) return "";
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    // Drop a trailing country token.
    .filter((p) => !/^(australia|aus)$/i.test(p));
  if (parts.length === 0) return raw.trim();

  const pc = typeof postcode === "string" && /^\d{4}$/.test(postcode) ? postcode : "";
  const tail = stateTail(parts[parts.length - 1]);

  // No bare-state comma part (Google-style "Suburb STATE postcode" is
  // already grouped). Leave the parts, only appending a postcode if one is
  // known and none is present anywhere in the label.
  if (!tail) {
    let result = parts.join(", ");
    if (pc && !/\b\d{4}\b/.test(result)) result = `${result} ${pc}`;
    return result;
  }

  // The locator's signature: a bare state (optionally + postcode) as the
  // final comma part, with the LGA directly before it. Drop the LGA.
  if (parts.length >= 3) parts.splice(parts.length - 2, 1);

  // Regroup "suburb STATE postcode" with spaces.
  parts.pop(); // the raw state part — rebuilt from `tail` below
  const suburb = parts.length >= 1 ? (parts.pop() as string) : "";
  const grouped = [suburb, tail.state, tail.postcode || pc]
    .filter(Boolean)
    .join(" ");
  parts.push(grouped);

  return parts.join(", ");
}

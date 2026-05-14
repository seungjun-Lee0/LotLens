// Human-readable URL for the References / Source links list.
//
// `https://www.brisbane.qld.gov.au/clean-and-green/.../flood-awareness-map`
//   →  `brisbane.qld.gov.au · flood awareness map`
//
// The full URL stays the link target; only the visible label changes.

export function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const segments = u.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return host;
    const label = last
      .replace(/\.(html?|aspx?|pdf|json)$/i, "")
      .replace(/[-_]+/g, " ");
    return `${host} · ${label}`;
  } catch {
    return url;
  }
}

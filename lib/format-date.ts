// Report run dates, formatted the same on the server and in the browser.
//
// Fixed zone so the two agree on the day (a UTC-evening timestamp is
// "tomorrow" in Brisbane): a locale-only format hydrated with a mismatch
// for any viewer outside AEST. Plain module (no "use client") so server
// components can call it too.

export function formatRunDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Australia/Brisbane",
  });
}

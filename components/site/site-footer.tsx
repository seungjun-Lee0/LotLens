import Link from "next/link";

// Shared site footer — brand line, legal links, scope tagline. Used on the
// landing page, report pages and the legal pages so the links (and the
// "public data only" framing) are visible everywhere.
export function SiteFooter() {
  return (
    <footer className="border-t border-border/40 bg-background/40">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-center text-[11.5px] text-muted-foreground sm:flex-row sm:px-6 sm:text-left sm:text-[12px]">
        <span>LotLens — Queensland Due Diligence</span>
        <nav className="flex items-center gap-4">
          <Link href="/privacy" className="transition hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="transition hover:text-foreground">
            Terms
          </Link>
          <Link href="/attribution" className="transition hover:text-foreground">
            Data sources
          </Link>
        </nav>
        <span>Public data only · No valuation · No title search</span>
      </div>
    </footer>
  );
}

// Instant skeleton for /report/[id] — shown by the App Router the moment
// navigation commits, while loadReportPayload (DB + cadastre fetches) runs
// on the server. Mirrors the real page's layout so the swap doesn't jump.

import { SiteHeader } from "@/components/site/site-header";

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-2xl bg-foreground/[0.07] ${className}`}
    />
  );
}

export default function ReportLoading() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 pb-16 pt-8 sm:gap-10 sm:px-6 sm:pt-16">
        {/* Title block */}
        <div className="flex flex-col gap-3">
          <Shimmer className="h-3 w-36" />
          <Shimmer className="h-10 w-4/5 max-w-xl sm:h-14" />
        </div>

        {/* At-a-glance card */}
        <div className="rounded-3xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm sm:p-8">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-[1.2fr_1fr]">
            <Shimmer className="h-48 sm:h-64" />
            <div className="flex flex-col gap-3">
              <Shimmer className="h-4 w-1/2" />
              <Shimmer className="h-4 w-2/3" />
              <Shimmer className="h-4 w-1/2" />
              <Shimmer className="h-4 w-3/5" />
              <Shimmer className="h-4 w-2/5" />
            </div>
          </div>
        </div>

        {/* Two module-section placeholders */}
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-3xl border border-border/60 bg-card/60 p-5 backdrop-blur-sm sm:p-8"
          >
            <div className="flex items-center gap-3">
              <Shimmer className="size-10 rounded-2xl" />
              <Shimmer className="h-6 w-44" />
            </div>
            <Shimmer className="mt-5 h-48 sm:h-64" />
            <div className="mt-5 flex flex-col gap-2.5">
              <Shimmer className="h-4 w-11/12" />
              <Shimmer className="h-4 w-4/5" />
              <Shimmer className="h-4 w-2/3" />
            </div>
          </div>
        ))}

        <p className="pb-6 text-center text-[13px] text-muted-foreground">
          Assembling your report…
        </p>
      </main>
    </>
  );
}

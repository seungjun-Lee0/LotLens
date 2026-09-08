// Skeleton for the /reports list while listUserReports (a council_data
// join for the risk summary) runs. Rendered inside a Suspense boundary
// placed AFTER the auth check, so a signed-out visitor still gets a hard
// redirect instead of a flash of placeholder cards.

function Shimmer({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded-2xl bg-foreground/[0.07] ${className}`} />
  );
}

export function ReportListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Loading reports">
      <div className="flex flex-col gap-3">
        <Shimmer className="h-11 w-full rounded-full" />
        <div className="flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <Shimmer key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass flex items-start gap-4 rounded-2xl p-4">
            <Shimmer className="hidden h-[72px] w-28 rounded-xl sm:block" />
            <div className="flex flex-1 flex-col gap-2.5">
              <Shimmer className="h-4 w-3/5" />
              <Shimmer className="h-3 w-2/5" />
              <Shimmer className="h-5 w-44 rounded-full" />
            </div>
            <Shimmer className="size-9 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

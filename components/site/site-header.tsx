import Link from "next/link";
import { ThemeToggle } from "@/components/site/theme-toggle";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 w-full px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="glass-strong mx-auto flex h-[52px] w-full max-w-6xl items-center justify-between rounded-full px-4 sm:h-14 sm:px-5">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[16px] font-semibold tracking-tight sm:text-[18px]"
        >
          <span
            aria-hidden
            className="inline-block size-3 rounded-full"
            style={{
              background:
                "linear-gradient(135deg, var(--apple-blue), var(--apple-purple))",
              boxShadow: "0 0 12px color-mix(in oklab, var(--apple-blue) 50%, transparent)",
            }}
          />
          PropAI
          <span className="ml-1 hidden text-[11px] font-normal text-muted-foreground sm:inline">
            Brisbane DD prototype
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <a
            href="#modules"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Modules
          </a>
          <a
            href="#disclaimer"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Disclaimer
          </a>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

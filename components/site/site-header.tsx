import Link from "next/link";

import { ThemeToggle } from "@/components/site/theme-toggle";
import { getSessionUser } from "@/lib/auth";

export async function SiteHeader() {
  const user = await getSessionUser();

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
          LotLens
          <span className="ml-1 hidden text-[11px] font-normal text-muted-foreground sm:inline">
            Brisbane
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Link
            href="/#modules"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Modules
          </Link>
          <Link
            href="/#pricing"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Pricing
          </Link>
          <Link
            href="/#faq"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground md:inline"
          >
            FAQ
          </Link>

          {user ? (
            <>
              <Link
                href="/reports"
                className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
              >
                My reports
              </Link>
              <Link
                href="/account"
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3 transition hover:bg-foreground/5 hover:text-foreground"
              >
                <span
                  aria-hidden
                  className="flex size-7 items-center justify-center rounded-full text-[12px] font-semibold text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--apple-blue), var(--apple-purple))",
                  }}
                >
                  {(user.name ?? user.email).slice(0, 1).toUpperCase()}
                </span>
                <span className="hidden max-w-[120px] truncate sm:inline">
                  Account
                </span>
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-full px-3.5 py-1.5 font-medium text-white transition hover:brightness-105"
                style={{
                  background:
                    "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
                }}
              >
                Sign up
              </Link>
            </>
          )}

          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

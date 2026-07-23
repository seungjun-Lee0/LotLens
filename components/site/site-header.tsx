import Link from "next/link";

import { NavAnchor } from "@/components/site/nav-anchor";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { UserMenu } from "@/components/site/user-menu";
import { getSessionUser, isActiveSubscriber, isAdmin } from "@/lib/auth";

export async function SiteHeader() {
  const user = await getSessionUser();
  const showCredits = isActiveSubscriber(user);
  const admin = isAdmin(user);

  return (
    <header className="sticky top-0 z-30 w-full px-3 pt-3 sm:px-4 sm:pt-4">
      <div className="glass-strong mx-auto flex h-[60px] w-full max-w-6xl items-center justify-between rounded-full px-4 sm:h-14 sm:px-5">
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
            Queensland
          </span>
        </Link>
        <nav className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <NavAnchor
            href="/#modules"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Modules
          </NavAnchor>
          <NavAnchor
            href="/#pricing"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
          >
            Pricing
          </NavAnchor>
          <NavAnchor
            href="/#faq"
            className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground md:inline"
          >
            FAQ
          </NavAnchor>

          {user ? (
            <>
              {admin && (
                <Link
                  href="/admin"
                  className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
                >
                  Admin
                </Link>
              )}
              <Link
                href="/reports"
                className="hidden rounded-full px-3 py-1.5 transition hover:bg-foreground/5 hover:text-foreground sm:inline"
              >
                My reports
              </Link>
              {/* Phones: the inline links above are hidden — the report
                  list, account and sign-out all live in the avatar menu. */}
              {showCredits && user && (
                <Link
                  href="/account"
                  title="Report credits left this cycle"
                  className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold sm:inline-flex"
                  style={{
                    background:
                      "color-mix(in oklab, var(--apple-blue) 12%, transparent)",
                    color: "var(--apple-blue)",
                  }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ background: "currentColor" }}
                  />
                  {user.credits} credits
                </Link>
              )}
              {/* Theme toggle sits to the LEFT of the avatar so the
                  profile stays hard right. */}
              <ThemeToggle />
              <UserMenu
                label={user.name ?? user.email}
                initial={(user.name ?? user.email).slice(0, 1).toUpperCase()}
                isAdmin={admin}
                showCredits={showCredits}
                credits={user.credits}
              />
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
              <ThemeToggle />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

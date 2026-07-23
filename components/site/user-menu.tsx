"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileText, LogOut, Shield, UserRound } from "lucide-react";

/**
 * Account avatar with a tap-to-open dropdown (Account, My reports, Admin,
 * Log out). On phones this is the only way to reach those destinations —
 * the header's inline text links are hidden below `sm`. On desktop the
 * inline links stay, and this menu adds one-tap sign-out.
 */
export function UserMenu({
  label,
  initial,
  isAdmin,
  showCredits,
  credits,
}: {
  /** Name or email shown at the top of the menu. */
  label: string;
  /** Single-character avatar glyph. */
  initial: string;
  isAdmin: boolean;
  showCredits: boolean;
  credits: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-foreground/80 transition hover:bg-foreground/5 hover:text-foreground";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition hover:bg-foreground/5 hover:text-foreground sm:pr-3"
      >
        <span
          aria-hidden
          className="flex size-8.5 items-center justify-center rounded-full text-[12px] font-semibold text-white"
          style={{
            background:
              "linear-gradient(135deg, var(--apple-blue), var(--apple-purple))",
          }}
        >
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate sm:inline">Account</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 w-56 origin-top-right rounded-2xl border border-border bg-popover p-1.5 text-left shadow-xl"
        >
          {/* Who's signed in (+ credits on phones, where the pill is hidden) */}
          <div className="px-3 pb-2 pt-1.5">
            <div className="truncate text-[13px] font-semibold text-foreground">
              {label}
            </div>
            {showCredits && (
              <div className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--apple-blue)" }}>
                {credits} credits left
              </div>
            )}
          </div>
          <div className="my-1 h-px bg-border/60" />

          <Link role="menuitem" href="/account" className={itemClass} onClick={() => setOpen(false)}>
            <UserRound className="size-[17px]" />
            Account
          </Link>
          <Link role="menuitem" href="/reports" className={itemClass} onClick={() => setOpen(false)}>
            <FileText className="size-[17px]" />
            My reports
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" className={itemClass} onClick={() => setOpen(false)}>
              <Shield className="size-[17px]" />
              Admin
            </Link>
          )}

          <div className="my-1 h-px bg-border/60" />
          <form action="/api/auth/logout" method="post">
            <button type="submit" role="menuitem" className={itemClass}>
              <LogOut className="size-[17px]" />
              Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

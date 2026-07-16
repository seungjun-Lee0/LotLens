"use client";

// Header anchor link with smooth, nicely-framed scrolling. On the home
// page a click smooth-scrolls so the target section sits CENTRED in the
// viewport (sections taller than the viewport align near the top with
// breathing room instead — centring those would cut their heading off).
// On any other page it falls through to normal navigation to /#hash.

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavAnchor({
  href,
  className,
  children,
}: {
  /** "/#section-id" */
  href: string;
  className?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (pathname !== "/") return;
        const id = href.split("#")[1];
        const el = id ? document.getElementById(id) : null;
        if (!el) return;
        e.preventDefault();

        // Force content-visibility sections to lay out at their real size
        // before measuring, or targets below a skipped section land off.
        document.documentElement.classList.add("nav-scroll");
        void document.body.offsetHeight;

        const vh = window.innerHeight;
        const rect = el.getBoundingClientRect();
        const top =
          rect.height < vh * 0.85
            ? window.scrollY + rect.top - (vh - rect.height) / 2
            : window.scrollY + rect.top - vh * 0.14;
        const reduced = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        window.scrollTo({
          top: Math.max(0, top),
          behavior: reduced ? "auto" : "smooth",
        });
        window.history.replaceState(null, "", `#${id}`);
        window.setTimeout(
          () => document.documentElement.classList.remove("nav-scroll"),
          1500,
        );
      }}
    >
      {children}
    </Link>
  );
}

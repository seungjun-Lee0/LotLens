"use client";

// FAQ accordion that plays itself as you scroll — each question opens in
// turn (and the previous one closes) while the section moves through the
// viewport. The first manual click takes over for good: from then on it's
// a normal accordion. Reduced-motion users get the plain accordion too.

import { useEffect, useRef, useState } from "react";

export type FaqItem = { q: string; a: string };

export function FaqScroller({ items }: { items: FaqItem[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const manualRef = useRef(false);
  const [openIdx, setOpenIdx] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let listening = false;
    const onScroll = () => {
      if (raf || manualRef.current) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const node = ref.current;
        if (!node || manualRef.current) return;
        const rect = node.getBoundingClientRect();
        const vh = window.innerHeight;
        // 0 → section top reaches 80% of the viewport; 1 → section has
        // scrolled its own height plus a bit past that line.
        const p = (vh * 0.8 - rect.top) / (rect.height + vh * 0.35);
        const clamped = Math.min(1, Math.max(0, p));
        setOpenIdx(Math.min(items.length - 1, Math.floor(clamped * items.length)));
      });
    };
    // Only pay for the scroll handler while the FAQ is near the viewport.
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !listening) {
          listening = true;
          window.addEventListener("scroll", onScroll, { passive: true });
          onScroll();
        } else if (!entry.isIntersecting && listening) {
          listening = false;
          window.removeEventListener("scroll", onScroll);
        }
      },
      { rootMargin: "60% 0px 60% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      if (listening) window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items.length]);

  return (
    <div ref={ref} className="mx-auto w-full max-w-2xl border-t border-border/60">
      {items.map((f, i) => (
        <details
          key={f.q}
          className="faq-item group border-b border-border/60"
          open={openIdx === i}
        >
          <summary
            className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium tracking-tight [&::-webkit-details-marker]:hidden"
            onClick={(e) => {
              e.preventDefault();
              manualRef.current = true;
              setOpenIdx((prev) => (prev === i ? -1 : i));
            }}
          >
            {f.q}
            <span
              className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
              style={{ color: "var(--apple-blue)" }}
            >
              +
            </span>
          </summary>
          <p className="max-w-[62ch] pb-4 text-[13.5px] leading-relaxed text-muted-foreground">
            {f.a}
          </p>
        </details>
      ))}
    </div>
  );
}

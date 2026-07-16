"use client";

// FAQ accordion that plays itself as you scroll — a scroll-spy on the
// viewport centre: each question unfolds as its row crosses the middle of
// the screen, and STAYS open while the next ones reveal below. Keeping
// passed answers open is what makes the choreography smooth: nothing above
// the centre line ever collapses, so rows never yank upward mid-read, and
// each next question sits a full answer's height further down (~150px of
// scroll per item instead of one 57px row). The first manual click takes
// over for good: from then on it's a classic one-open accordion.
// Reduced-motion users get the plain accordion too.
//
// Answers animate via the grid-rows 0fr→1fr trick (see .faq-answer in
// globals.css) — works in every browser, unlike <details> +
// interpolate-size which is Chromium-only and left phones snapping open
// with no transition at all.

import { useEffect, useRef, useState } from "react";

export type FaqItem = { q: string; a: string };

export function FaqScroller({ items }: { items: FaqItem[] }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const manualRef = useRef(false);
  // Scroll mode: items 0..idx are open. Manual mode: only idx is open.
  const [sel, setSel] = useState<{ manual: boolean; idx: number }>({ manual: false, idx: -1 });

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
        // Open everything whose question row has crossed the centre line.
        const line = window.innerHeight * 0.55;
        let idx = -1;
        node.querySelectorAll<HTMLElement>("[data-faq-q]").forEach((row, i) => {
          if (row.getBoundingClientRect().top <= line) idx = i;
        });
        setSel((s) => (s.manual || s.idx === idx ? s : { manual: false, idx }));
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
      {items.map((f, i) => {
        const open = sel.manual ? sel.idx === i : i <= sel.idx;
        return (
          <div key={f.q} className="border-b border-border/60">
            <button
              type="button"
              data-faq-q
              aria-expanded={open}
              onClick={() => {
                manualRef.current = true;
                setSel({ manual: true, idx: open ? -1 : i });
              }}
              className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left text-[15px] font-medium tracking-tight"
            >
              {f.q}
              <span
                aria-hidden
                className={`shrink-0 transition-transform duration-300 ${open ? "rotate-45" : ""}`}
                style={{ color: "var(--apple-blue)" }}
              >
                +
              </span>
            </button>
            {/* Answer text stays in the DOM whether open or not (SEO/find-
                in-page); the grid wrapper collapses it visually. */}
            <div className="faq-answer" data-open={open ? "" : undefined}>
              <div className="min-h-0 overflow-hidden">
                <p className="max-w-[62ch] pb-4 text-[13.5px] leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

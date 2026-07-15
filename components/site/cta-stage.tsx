"use client";

// Sticky stage for the final CTA. Instead of scrubbing the growth to the
// scroll position (which mirrors every notch of the wheel and feels
// stuttery), scrolling merely TRIGGERS a focus state: entering the middle
// of the stage plays a smooth time-based grow transition and dims the
// rest of the page; leaving it releases both. Hysteresis on the
// thresholds prevents flicker at the boundaries.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function CtaStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let listening = false;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const node = ref.current;
        if (!node) return;
        const r = node.getBoundingClientRect();
        const vh = window.innerHeight;
        // 0 → stage entering at the bottom, 1 → stage gone past the top.
        // With the 130vh runway the sticky pin spans roughly p 0.44–0.57,
        // so focus arms just before the pin engages and releases the moment
        // the card starts sliding out — no dead scroll before the footer.
        const p = (vh - r.top) / (r.height + vh);
        setFocus((cur) =>
          cur ? p > 0.3 && p < 0.6 : p > 0.38 && p < 0.56,
        );
      });
    };
    // Only pay for the scroll handler while the stage is anywhere near the
    // viewport — elsewhere on the page it costs nothing per frame.
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
  }, []);

  return (
    <div ref={ref} className={`cta-stage${focus ? " is-focus" : ""}`}>
      <div className="cta-pin">
        <div className="cta-dim" aria-hidden />
        {children}
      </div>
    </div>
  );
}

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
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight;
        // 0 → stage entering at the bottom, 1 → stage gone past the top.
        const p = (vh - r.top) / (r.height + vh);
        setFocus((cur) =>
          cur ? p > 0.26 && p < 0.84 : p > 0.33 && p < 0.78,
        );
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
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

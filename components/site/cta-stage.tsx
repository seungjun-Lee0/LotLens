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
    // Previous card-centre position (phone branch) — arming keys off the
    // centre CROSSING the trigger line between two ticks, so a fast flick
    // that jumps hundreds of px between scroll events can't skip it.
    let prevMid: number | null = null;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const node = ref.current;
        if (!node) return;
        const vh = window.innerHeight;
        if (window.matchMedia("(max-width: 767.98px)").matches) {
          // Phones track the CARD itself (it rides in flow, then sticks
          // just under the header — see globals.css): arm when the card's
          // centre crosses the middle of the screen, hold while it rides
          // up to and sits at its stick point, release once the dwell end
          // shoves it past the stick line (top < 72) or the user scrolls
          // back up. The HOLD test uses the card's TOP, not its centre —
          // growing shifts the centre far down, so a centre-based hold
          // released itself the moment the card expanded.
          const card = node.querySelector(".cta-card");
          if (!card) return;
          const c = card.getBoundingClientRect();
          const mid = c.top + c.height / 2;
          const line = vh * 0.62;
          // Downward crossing only: the post-fold reland (the shrunk card
          // settling near the stick line, already BELOW the trigger line)
          // never crosses it, so the grow can't pump itself back on.
          const crossed = prevMid !== null && prevMid > line && mid <= line;
          prevMid = mid;
          setFocus((cur) =>
            cur ? c.top > 72 && c.top < vh * 0.7 : crossed,
          );
          return;
        }
        const r = node.getBoundingClientRect();
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

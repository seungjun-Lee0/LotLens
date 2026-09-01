"use client";

// Two-line summary that reveals the rest on click. The "Show more" control
// only appears when the text actually overflows the clamp (measured after
// layout, re-checked on resize), so a short summary shows no button.

import { useEffect, useRef, useState, type ReactNode } from "react";

export function ClampText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expandable, setExpandable] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // While expanded the clamp is off, so scrollHeight == clientHeight and
      // measuring would wrongly hide the toggle — skip it and keep the button.
      if (expanded) return;
      setExpandable(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, expanded]);

  return (
    <div>
      <div
        ref={ref}
        className={[className, expanded ? "" : "line-clamp-2"]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
      {expandable && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 text-[11px] font-medium text-foreground/55 transition hover:text-foreground/90"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

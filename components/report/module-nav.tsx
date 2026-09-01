"use client";

// Floating "jump to module" nav for the report. When a report has many
// flagged modules the body gets long: this FAB (bottom-right) expands to a
// list of the rendered module sections so you can jump straight to one
// instead of scrolling. Highlights the section currently in view.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { List, X } from "lucide-react";

import { MODULE_META } from "@/lib/module-meta";
import { RISK_STYLE, riskOf } from "@/lib/risk-style";
import type { Module, RiskLevel } from "@/lib/db";

export type ModuleNavItem = {
  module: Module;
  riskLevel: RiskLevel | null;
  hasConsideration: boolean;
  failed: boolean;
};

export function ModuleNav({
  items,
  action,
}: {
  items: ModuleNavItem[];
  /** Optional control rendered in the floating stack, directly above the
      FAB (e.g. the Download PDF button). */
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<Module | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Track which module section is currently in view for the active marker.
  useEffect(() => {
    const sections = items
      .map((it) => document.getElementById(`module-${it.module}`))
      .filter((el): el is HTMLElement => el != null);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        // The topmost section intersecting the upper half of the viewport
        // wins: matches what the reader is actually looking at.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) {
          setActive(visible.target.id.replace("module-", "") as Module);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  // Close the panel on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const jump = (module: Module) => {
    document
      .getElementById(`module-${module}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    setOpen(false);
  };

  if (items.length < 3) return null;

  return (
    <div
      ref={panelRef}
      className="fixed bottom-5 right-4 z-40 flex flex-col items-end gap-2 sm:bottom-7 sm:right-7"
    >
      {open && (
        <div className="glass-strong glass-scroll max-h-[min(60vh,26rem)] w-[248px] overflow-y-auto rounded-2xl p-1.5 shadow-xl">
          <div className="px-2.5 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Jump to module
          </div>
          <ul className="flex flex-col">
            {items.map((it) => {
              const meta = MODULE_META[it.module];
              const Icon = meta.icon;
              const level = riskOf(it.riskLevel, it.hasConsideration);
              const dot = it.failed
                ? "var(--apple-orange)"
                : RISK_STYLE[level].cssVar;
              const isActive = active === it.module;
              return (
                <li key={it.module}>
                  <button
                    type="button"
                    onClick={() => jump(it.module)}
                    className={
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition " +
                      (isActive ? "bg-foreground/[0.07]" : "hover:bg-foreground/5")
                    }
                  >
                    <Icon className="size-4 shrink-0" style={{ color: meta.tint }} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {meta.name}
                    </span>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: dot }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {action}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close module nav" : "Jump to a module"}
        aria-expanded={open}
        className="glass-strong flex size-12 items-center justify-center rounded-full text-foreground shadow-xl transition hover:brightness-105 active:scale-95"
      >
        {open ? <X className="size-5" /> : <List className="size-5" />}
      </button>
    </div>
  );
}

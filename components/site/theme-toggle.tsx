"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

// Theme lives in the <html> class, which the server can't see. Report null on the
// server so we render nothing until the browser tells us — this avoids a hydration
// mismatch without a setState-in-effect.
const getSnapshot = () => document.documentElement.classList.contains("dark");
const getServerSnapshot = (): boolean | null => null;

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = !isDark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className="glass inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 transition hover:text-foreground"
    >
      {isDark === null ? null : isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

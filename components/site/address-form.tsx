"use client";

import { ArrowRight, MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Visual-only for now. Submit wiring lands in Task 7 (geocode → fetch-overlays
// → generate-narrative → redirect /report/[id]).
export function AddressForm() {
  return (
    <form
      className="glass-strong flex w-full max-w-2xl items-center gap-2 rounded-full p-2 pl-5"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Input
        type="text"
        placeholder="e.g. 12 Oxley Rd, Graceville QLD 4075"
        className="h-11 flex-1 border-0 bg-transparent px-2 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
        aria-label="Brisbane LGA address"
      />
      <Button
        type="submit"
        size="lg"
        className="h-11 rounded-full px-5 text-[14px] font-medium text-white"
        style={{
          background:
            "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
          boxShadow:
            "0 8px 20px -8px color-mix(in oklab, var(--apple-blue) 70%, transparent)",
        }}
      >
        Run report
        <ArrowRight className="ml-1 size-4" />
      </Button>
    </form>
  );
}

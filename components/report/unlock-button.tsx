"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";

export function UnlockButton({
  addressId,
  reportId,
  priceLabel = "$29",
}: {
  addressId: string;
  reportId: string;
  priceLabel?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addressId, reportId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "checkout failed");
      if (body.alreadyPaid) {
        window.location.reload();
        return;
      }
      if (!body.redirectUrl) throw new Error("missing redirect URL");
      window.location.assign(body.redirectUrl);
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={go}
        disabled={loading}
        className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-[14.5px] font-semibold text-white shadow-[0_10px_28px_-10px_color-mix(in_oklab,var(--apple-blue)_70%,transparent)] disabled:opacity-70"
        style={{
          background:
            "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
        }}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Lock className="size-4" />
        )}
        Unlock the full report for {priceLabel}
      </button>
      <p className="text-[11.5px] text-muted-foreground">
        Stripe Checkout · secure card payment · all 8 modules instantly
      </p>
      {error && (
        <p className="text-[12px] text-[var(--apple-red)]">{error}</p>
      )}
    </div>
  );
}

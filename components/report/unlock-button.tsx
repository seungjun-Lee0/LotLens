"use client";

import { useState } from "react";
import { Loader2, Lock } from "lucide-react";

/** Unlocks the report with one of the viewer's credits: no Checkout, the
 * credit was paid for when it was granted. */
export function UnlockWithCreditButton({
  reportId,
  creditsLeft,
}: {
  reportId: string;
  creditsLeft: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/report/${reportId}/unlock`, { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "unlock failed");
      window.location.reload();
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
        Unlock with 1 credit
      </button>
      <p className="text-[11.5px] text-muted-foreground">
        {creditsLeft} credit{creditsLeft === 1 ? "" : "s"} available · Every
        module unlocked instantly
      </p>
      {error && (
        <p className="text-[12px] text-[var(--apple-red)]">{error}</p>
      )}
    </div>
  );
}

export function UnlockButton({
  addressId,
  reportId,
  priceLabel = "$19",
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
      {/* No module count here: MODULE_ORDER lives in lib/db, which pulls the
          Neon driver into the client bundle, and the hardcoded copy this
          replaced still said "15 modules" long after the report grew past it. */}
      <p className="text-[11.5px] text-muted-foreground">
        One-off payment · Secure checkout via Stripe · Every module unlocked
        instantly
      </p>
      {error && (
        <p className="text-[12px] text-[var(--apple-red)]">{error}</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Starts a subscription Checkout for a plan. Sends signed-out users to login. */
export function SubscribeButton({
  plan,
  label,
  variant = "primary",
  className = "",
}: {
  plan: "basic" | "pro";
  label: string;
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await res.json()) as {
        redirectUrl?: string;
        loginUrl?: string;
        error?: string;
      };
      if (res.status === 401 && body.loginUrl) {
        router.push(body.loginUrl);
        return;
      }
      if (!res.ok || !body.redirectUrl) {
        setError(body.error ?? "Checkout failed. Please try again.");
        return;
      }
      window.location.href = body.redirectUrl;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const base =
    "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium transition disabled:opacity-70";
  const styles =
    variant === "primary"
      ? { className: `${base} text-white hover:brightness-105 ${className}` }
      : {
          className: `${base} border border-border/70 bg-background/50 text-foreground hover:bg-foreground/5 ${className}`,
        };

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        {...styles}
        style={
          variant === "primary"
            ? {
                background:
                  "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
              }
            : undefined
        }
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : label}
      </button>
      {error && (
        <p className="text-center text-[12px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

const PRIMARY_BG =
  "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))";

/** Buys a credit pack through Checkout. `reportId` brings the buyer back
 * to the report they were locked out of instead of the account page. */
export function BuyCreditsButton({
  pack,
  label,
  reportId,
  variant = "ghost",
}: {
  pack: "small" | "large";
  label: string;
  reportId?: string;
  variant?: "primary" | "ghost";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack, ...(reportId ? { reportId } : {}) }),
      });
      const body = (await res.json()) as {
        redirectUrl?: string;
        loginUrl?: string;
        error?: string;
      };
      if (res.status === 401 && body.loginUrl) {
        router.push(body.loginUrl);
        return;
      }
      if (!res.ok || !body.redirectUrl) {
        setError(body.error ?? "Checkout failed. Please try again.");
        return;
      }
      window.location.href = body.redirectUrl;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className={
          variant === "primary"
            ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium text-white transition hover:brightness-105 disabled:opacity-70"
            : "inline-flex h-11 w-full items-center justify-center gap-2 rounded-full border border-border/70 bg-background/50 text-[14px] font-medium text-foreground transition hover:bg-foreground/5 disabled:opacity-70"
        }
        style={variant === "primary" ? { background: PRIMARY_BG } : undefined}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : label}
      </button>
      {error && (
        <p className="text-center text-[12px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Basic to Pro on the existing subscription (prorated, charged now). Asks
 * once before charging: there is no Checkout page in between. */
export function UpgradeToProButton({
  label,
  priceNote,
}: {
  label: string;
  priceNote: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/upgrade", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Upgrade failed. Please try again.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-background/50 p-3">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            {priceNote}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={go}
              disabled={busy}
              className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] font-medium text-white transition hover:brightness-105 disabled:opacity-70"
              style={{ background: PRIMARY_BG }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : "Confirm upgrade"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="inline-flex h-10 items-center justify-center rounded-full border border-border/70 px-4 text-[13.5px] font-medium transition hover:bg-foreground/5 disabled:opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium text-white transition hover:brightness-105"
          style={{ background: PRIMARY_BG }}
        >
          {label}
        </button>
      )}
      {error && (
        <p className="text-center text-[12px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Opens the Stripe customer portal (update card, switch plan, cancel). */
export function ManageBillingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !body.redirectUrl) {
        setError(body.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = body.redirectUrl;
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-border/70 bg-background/50 px-5 text-[13.5px] font-medium transition hover:bg-foreground/5 disabled:opacity-70"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Manage billing"}
      </button>
      {error && (
        <p className="text-[12px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

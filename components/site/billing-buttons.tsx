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

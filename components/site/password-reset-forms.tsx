"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CTA_GRADIENT = {
  background:
    "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
} as const;

/** Request-a-reset-link form (/forgot-password). */
export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSent(body.message ?? "Check your inbox for the reset link.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[14px] leading-relaxed text-muted-foreground">{sent}</p>
        <Link
          href="/login"
          className="text-[13px] font-medium underline underline-offset-2"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      <Input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoComplete="email"
        className="h-11 rounded-xl bg-background/60"
        aria-label="Email"
      />
      {error && (
        <p className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy}
        className="h-11 rounded-full text-[14px] font-medium text-white"
        style={CTA_GRADIENT}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}
      </Button>
    </form>
  );
}

/** Choose-a-new-password form (/reset-password?token=…). */
export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      <Input
        type="password"
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="New password (8+ characters)"
        autoComplete="new-password"
        className="h-11 rounded-xl bg-background/60"
        aria-label="New password"
      />
      {error && (
        <p className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={busy || password.length < 8}
        className="h-11 rounded-full text-[14px] font-medium text-white"
        style={CTA_GRADIENT}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Set new password"}
      </Button>
    </form>
  );
}

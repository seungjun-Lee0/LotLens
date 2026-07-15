"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthForm({
  mode,
  googleEnabled,
  next = "/",
}: {
  mode: "login" | "signup";
  googleEnabled: boolean;
  /** Where to send the user after auth (e.g. /#pricing). */
  next?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = mode === "signup";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${isSignup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isSignup ? { email, password, name: name || undefined } : { email, password },
        ),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-strong w-full max-w-sm rounded-3xl p-7">
      <h1 className="text-[22px] font-semibold tracking-tight">
        {isSignup ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {isSignup
          ? "Track your reports and unlock monthly plans."
          : "Log in to your LotLens account."}
      </p>

      {googleEnabled && (
        <>
          <a
            href="/api/auth/google"
            className="mt-5 flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-border/70 bg-background/60 text-[14px] font-medium transition hover:bg-foreground/5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.02.15 3.5 2.7.24.03c2.2-2.1 3.5-5.1 3.5-8.6z" />
              <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2a7.2 7.2 0 0 1-6.8-5l-.14.01-3.7 2.8-.05.13A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.2 14.4A7.4 7.4 0 0 1 4.8 12c0-.8.1-1.6.4-2.4l-.01-.16-3.7-2.9-.12.06A12 12 0 0 0 0 12c0 1.9.5 3.8 1.3 5.4l3.9-3z" />
              <path fill="#EB4335" d="M12 4.6c2.3 0 3.8 1 4.7 1.8l3.4-3.3C18 1.2 15.2 0 12 0 7.3 0 3.3 2.7 1.4 6.6l3.9 3A7.2 7.2 0 0 1 12 4.6z" />
            </svg>
            Continue with Google
          </a>
          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form
        className={`flex flex-col gap-3 ${googleEnabled ? "" : "mt-5"}`}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) submit();
        }}
      >
        {isSignup && (
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            autoComplete="name"
            className="h-11 rounded-xl bg-background/60"
            aria-label="Name"
          />
        )}
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
        <Input
          type="password"
          required
          minLength={isSignup ? 8 : 1}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={isSignup ? "Password (8+ characters)" : "Password"}
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="h-11 rounded-xl bg-background/60"
          aria-label="Password"
        />

        {!isSignup && (
          <Link
            href="/forgot-password"
            className="-mt-1 self-end text-[12px] text-muted-foreground underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
        )}

        {error && (
          <p className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={busy}
          className="h-11 rounded-full text-[14px] font-medium text-white"
          style={{
            background:
              "linear-gradient(135deg, var(--apple-blue), color-mix(in oklab, var(--apple-blue) 70%, var(--apple-purple)))",
          }}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isSignup ? (
            "Create account"
          ) : (
            "Log in"
          )}
        </Button>
      </form>

      <p className="mt-5 text-center text-[12.5px] text-muted-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-2">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to LotLens?{" "}
            <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-foreground underline underline-offset-2">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

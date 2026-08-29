"use client";

// Danger-zone account deletion. Two-step: click reveals a confirm box that
// requires typing the account email, so it can't fire on a stray click.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function DeleteAccount({ email }: { email: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirm.trim().toLowerCase() === email.trim().toLowerCase();

  const remove = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/delete", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Delete failed (${res.status})`);
      }
      // Account and session are gone — land on the marketing page.
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section
      className="flex flex-col gap-3 rounded-3xl border p-6"
      style={{
        borderColor: "color-mix(in oklab, var(--apple-red) 30%, transparent)",
        background: "color-mix(in oklab, var(--apple-red) 5%, transparent)",
      }}
    >
      <div>
        <div
          className="text-[11px] font-medium uppercase tracking-[0.18em]"
          style={{ color: "var(--apple-red)" }}
        >
          Danger zone
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
          Deleting your account cancels any active subscription and removes
          your profile permanently. This can&rsquo;t be undone.
        </p>
      </div>

      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="self-start rounded-full px-4 py-2 text-[13px] font-semibold transition"
          style={{
            background: "color-mix(in oklab, var(--apple-red) 12%, transparent)",
            color: "var(--apple-red)",
          }}
        >
          Delete account
        </button>
      ) : (
        <div className="flex flex-col gap-2.5">
          <label className="text-[12.5px] text-muted-foreground">
            Type <b className="font-semibold text-foreground">{email}</b> to
            confirm.
          </label>
          <input
            type="email"
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={email}
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-[14px] outline-none focus-visible:border-ring sm:max-w-sm sm:text-[13.5px]"
          />
          {error && (
            <p className="text-[12.5px]" style={{ color: "var(--apple-red)" }}>
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={!matches || busy}
              className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: "var(--apple-red)" }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setArmed(false);
                setConfirm("");
                setError(null);
              }}
              disabled={busy}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

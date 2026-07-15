"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Feedback({ ok, msg }: { ok: boolean; msg: string | null }) {
  if (!msg) return null;
  return (
    <p
      className="text-[12.5px]"
      style={{ color: ok ? "var(--apple-green)" : "var(--apple-red)" }}
    >
      {msg}
    </p>
  );
}

/** Display-name editor. */
export function NameForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json()) as { error?: string };
      setOk(res.ok);
      setMsg(res.ok ? "Name updated." : (body.error ?? "Update failed."));
      if (res.ok) router.refresh();
    } catch {
      setOk(false);
      setMsg("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && name.trim()) submit();
      }}
    >
      <label className="text-[12px] font-medium text-muted-foreground" htmlFor="acct-name">
        Display name
      </label>
      <div className="flex gap-2">
        <Input
          id="acct-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={120}
          className="h-10 rounded-xl bg-background/60"
        />
        <Button
          type="submit"
          disabled={busy || !name.trim() || name.trim() === initialName}
          className="h-10 rounded-full px-4 text-[13px]"
          variant="secondary"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
      <Feedback ok={ok} msg={msg} />
    </form>
  );
}

/** Change password — or set one for Google-only accounts. */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          hasPassword
            ? { currentPassword: current, newPassword: next }
            : { newPassword: next },
        ),
      });
      const body = (await res.json()) as { error?: string };
      setOk(res.ok);
      setMsg(
        res.ok
          ? hasPassword
            ? "Password updated."
            : "Password set — you can now log in with email too."
          : (body.error ?? "Update failed."),
      );
      if (res.ok) {
        setCurrent("");
        setNext("");
      }
    } catch {
      setOk(false);
      setMsg("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) submit();
      }}
    >
      <label className="text-[12px] font-medium text-muted-foreground">
        {hasPassword ? "Change password" : "Set a password"}
      </label>
      {!hasPassword && (
        <p className="text-[12px] text-muted-foreground">
          You signed up with Google. Add a password to also log in with email.
        </p>
      )}
      {hasPassword && (
        <Input
          type="password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder="Current password"
          autoComplete="current-password"
          className="h-10 rounded-xl bg-background/60"
          aria-label="Current password"
        />
      )}
      <div className="flex gap-2">
        <Input
          type="password"
          required
          minLength={8}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder="New password (8+ characters)"
          autoComplete="new-password"
          className="h-10 rounded-xl bg-background/60"
          aria-label="New password"
        />
        <Button
          type="submit"
          disabled={busy || next.length < 8 || (hasPassword && !current)}
          className="h-10 rounded-full px-4 text-[13px]"
          variant="secondary"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : hasPassword ? "Update" : "Set"}
        </Button>
      </div>
      <Feedback ok={ok} msg={msg} />
    </form>
  );
}

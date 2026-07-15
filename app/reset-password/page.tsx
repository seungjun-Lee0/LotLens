import Link from "next/link";

import { SiteHeader } from "@/components/site/site-header";
import { ResetPasswordForm } from "@/components/site/password-reset-forms";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const token = sp.token ?? "";
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-24 pt-16 sm:pt-24">
        <div className="glass-strong w-full max-w-sm rounded-3xl p-7">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Choose a new password
          </h1>
          {token ? (
            <>
              <p className="mb-5 mt-1 text-[13px] text-muted-foreground">
                You&rsquo;ll be logged in straight after.
              </p>
              <ResetPasswordForm token={token} />
            </>
          ) : (
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
              This page needs the link from your reset email.{" "}
              <Link
                href="/forgot-password"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Request a new link
              </Link>
              .
            </p>
          )}
        </div>
      </main>
    </>
  );
}

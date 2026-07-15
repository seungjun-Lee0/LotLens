import { SiteHeader } from "@/components/site/site-header";
import { ForgotPasswordForm } from "@/components/site/password-reset-forms";
import { emailConfigured } from "@/lib/email";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  const canSend = emailConfigured();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-24 pt-16 sm:pt-24">
        <div className="glass-strong w-full max-w-sm rounded-3xl p-7">
          <h1 className="text-[22px] font-semibold tracking-tight">
            Reset your password
          </h1>
          <p className="mb-5 mt-1 text-[13px] text-muted-foreground">
            Enter your account email and we&rsquo;ll send a single-use reset
            link (valid for 1 hour).
          </p>
          {canSend ? (
            <ForgotPasswordForm />
          ) : (
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              Email delivery isn&rsquo;t set up on this deployment yet. Contact{" "}
              <a
                href="mailto:hello@lotlens.au"
                className="font-medium text-foreground underline underline-offset-2"
              >
                hello@lotlens.au
              </a>{" "}
              and we&rsquo;ll reset it for you.
            </p>
          )}
        </div>
      </main>
    </>
  );
}

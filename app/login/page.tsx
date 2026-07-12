import { SiteHeader } from "@/components/site/site-header";
import { AuthForm } from "@/components/site/auth-form";
import { googleOAuthConfigured } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string; error?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-4 pb-24 pt-16 sm:pt-24">
        {sp.error === "google" && (
          <p className="mb-4 text-[13px]" style={{ color: "var(--apple-red)" }}>
            Google sign-in failed — please try again or use email.
          </p>
        )}
        <AuthForm
          mode="login"
          googleEnabled={googleOAuthConfigured()}
          next={sp.next ?? "/"}
        />
      </main>
    </>
  );
}

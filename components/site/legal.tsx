import type { ReactNode } from "react";

// Typography shell for the legal pages (/privacy, /terms, /attribution).
// Plain server components — no interactivity, just consistent prose styling.

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-2">
      <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="text-[12.5px] text-muted-foreground">Last updated: {updated}</p>
      <div className="mt-4 flex flex-col gap-8">{children}</div>
    </article>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold tracking-tight">{heading}</h2>
      <div className="flex flex-col gap-3 text-[14px] leading-relaxed text-foreground/80 [&_a]:underline [&_a]:underline-offset-2 [&_li]:leading-relaxed [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

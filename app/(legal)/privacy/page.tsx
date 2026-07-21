import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — LotLens",
  description:
    "How LotLens collects, uses and protects your information when you generate Queensland property reports.",
};

const CONTACT_EMAIL = "hello@lotlens.au";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="19 July 2026">
      <LegalSection heading="Who we are">
        <p>
          LotLens (&ldquo;we&rdquo;, &ldquo;us&rdquo;) provides property
          due-diligence reports for Queensland addresses, built from publicly
          available government and council data. This policy explains what
          information we collect and how we handle it. We handle personal
          information in accordance with the Privacy Act 1988 (Cth) and the
          Australian Privacy Principles.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul>
          <li>
            <strong>Account details</strong> — your email address, display name
            and a hashed password, or your Google account identifier if you
            sign in with Google. We never see or store your Google password.
          </li>
          <li>
            <strong>Payment records</strong> — payments are processed by
            Stripe. We store the transaction reference, plan and credit
            balance; we never store your card number.
          </li>
          <li>
            <strong>Addresses and reports</strong> — the addresses you search
            and the reports generated for them, so you can revisit unlocked
            reports.
          </li>
          <li>
            <strong>Technical data</strong> — IP address and basic request
            logs, used for rate limiting and abuse prevention.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use it">
        <p>
          We use this information to generate and deliver your reports, manage
          your account and credits, process payments, prevent abuse of the
          service, and improve the product. We do not sell personal
          information, and we do not use your data for third-party
          advertising.
        </p>
      </LegalSection>

      <LegalSection heading="Services we rely on">
        <p>
          Generating a report involves sending the searched address (and the
          coordinates it resolves to) to the data services the report is built
          from. The third parties we use are:
        </p>
        <ul>
          <li>
            <strong>Queensland Government and council mapping services</strong>{" "}
            — spatial queries for the searched location (QSpatial, Brisbane
            City Council, City of Gold Coast, City of Moreton Bay, Sunshine
            Coast Council, Redland City Council and related services).
          </li>
          <li>
            <strong>Stripe</strong> — payment processing and subscription
            billing.
          </li>
          <li>
            <strong>Google</strong> — sign-in (if you choose Google OAuth) and
            optional address geocoding / autocomplete.
          </li>
          <li>
            <strong>Anthropic</strong> — the searched address and the public
            overlay results are used to generate the written narrative in your
            report.
          </li>
          <li>
            <strong>Vercel and Neon</strong> — application hosting and
            database storage.
          </li>
          <li>
            <strong>Mapbox</strong> — map rendering, where enabled.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          We use a single essential session cookie to keep you signed in.
          We do not use advertising or cross-site tracking cookies.
        </p>
      </LegalSection>

      <LegalSection heading="Retention and deletion">
        <p>
          Account data and generated reports are kept while your account is
          active so your unlocked reports remain available. You can ask us to
          delete your account and associated personal information at any time
          by emailing{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Payment
          records are retained as required for tax and accounting purposes.
        </p>
      </LegalSection>

      <LegalSection heading="Access, correction and complaints">
        <p>
          You may request access to, or correction of, the personal
          information we hold about you by contacting{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. If you are
          not satisfied with our response, you can complain to the Office of
          the Australian Information Commissioner (oaic.gov.au).
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          We may update this policy from time to time. Material changes will
          be reflected on this page with a new &ldquo;last updated&rdquo;
          date.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

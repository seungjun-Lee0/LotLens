import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Terms of Service — LotLens",
  description:
    "The terms that apply when you use LotLens Queensland property reports.",
};

const CONTACT_EMAIL = "sjun0500@gmail.com";

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="19 July 2026">
      <LegalSection heading="What LotLens is">
        <p>
          LotLens aggregates publicly available Queensland Government and
          local-council spatial data into a property report for an address you
          choose. By using the service you agree to these terms.
        </p>
      </LegalSection>

      <LegalSection heading="Not professional advice">
        <p>
          Reports are provided for general information only. They are{" "}
          <strong>
            not legal, financial, planning, engineering or valuation advice
          </strong>
          , and they are not a substitute for a title search, building and
          pest inspection, survey, or advice from a conveyancer or solicitor.
          Always verify anything material to a decision with the relevant
          council, the Queensland Government, or a qualified professional.
        </p>
        <p>
          Where a report shows that a check was unavailable or could not be
          completed, that means <strong>not checked — not clear</strong>.
        </p>
      </LegalSection>

      <LegalSection heading="Data accuracy and availability">
        <p>
          Reports reflect the publishers&rsquo; datasets as they stood at the
          time the report was generated. Government and council data can be
          incomplete, out of date, generalised in scale, or temporarily
          unavailable, and coverage differs between council areas. We do not
          warrant that any dataset is accurate, complete or current, and map
          overlays are indicative only — boundaries are not survey-accurate.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts">
        <p>
          You are responsible for keeping your sign-in credentials secure and
          for activity under your account. Provide accurate account
          information and keep it up to date.
        </p>
      </LegalSection>

      <LegalSection heading="Payments, credits and refunds">
        <p>
          Paid reports are unlocked either by a one-off payment or by credits
          included in a subscription plan. Prices are in Australian dollars
          and are processed by Stripe. Credits reset with each billing period
          as described on the pricing page.
        </p>
        <p>
          Nothing in these terms excludes the consumer guarantees under the
          Australian Consumer Law. If a report fails to generate or is
          materially defective, contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> and we will
          re-run it or refund the purchase.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <ul>
          <li>No scraping, bulk automated querying, or reselling of the service or its output as a data feed.</li>
          <li>No attempting to circumvent rate limits, paywalls or access controls.</li>
          <li>No use of the service to harass, defame or unlawfully surveil any person.</li>
        </ul>
        <p>We may suspend accounts that breach these rules.</p>
      </LegalSection>

      <LegalSection heading="Intellectual property">
        <p>
          The LotLens name, report design and software are ours. The
          underlying government and council data remains subject to its own
          licences — see the{" "}
          <a href="/attribution">Data sources &amp; attribution</a> page.
          Reports you purchase are for your own use in connection with the
          relevant property.
        </p>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          To the maximum extent permitted by law, we exclude liability for
          loss arising from reliance on a report, including decisions to buy,
          sell, develop or insure property. Where liability cannot be
          excluded, it is limited to re-supplying the report or refunding the
          amount paid for it. Nothing in these terms limits rights you have
          under the Australian Consumer Law that cannot be excluded.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>
          These terms are governed by the laws of Queensland, Australia, and
          you submit to the non-exclusive jurisdiction of its courts.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

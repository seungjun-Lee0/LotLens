import type { Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/site/legal";

export const metadata: Metadata = {
  title: "Data sources & attribution — LotLens",
  description:
    "The open government datasets LotLens reports are built from, and their licences.",
};

export default function AttributionPage() {
  return (
    <LegalPage title="Data sources & attribution" updated="19 July 2026">
      <LegalSection heading="How reports are built">
        <p>
          Every LotLens report is assembled live from open government data.
          Each module queries the publisher&rsquo;s own mapping service at the
          moment the report is generated, so results reflect the dataset as
          the publisher served it at that time. The sources below are used
          under the licences stated, most commonly{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            Creative Commons Attribution 4.0 (CC BY 4.0)
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection heading="Queensland Government">
        <ul>
          <li>
            Cadastral boundaries, lot/plan and tenure — Land Parcel Property
            Framework (DCDB), © State of Queensland (Department of
            Resources), CC BY 4.0.
          </li>
          <li>
            Coastal hazard areas (storm tide inundation, erosion prone areas)
            — © State of Queensland (Department of the Environment, Tourism,
            Science and Innovation), CC BY 4.0.
          </li>
          <li>
            Bushfire Prone Area mapping — © State of Queensland (Queensland
            Fire Department / State Planning Policy), CC BY 4.0.
          </li>
          <li>
            Regulated vegetation management map and essential habitat — ©
            State of Queensland, CC BY 4.0.
          </li>
          <li>
            Koala Plan mapping and Matters of State Environmental
            Significance — © State of Queensland, CC BY 4.0.
          </li>
          <li>
            Queensland Heritage Register boundaries — © State of Queensland,
            CC BY 4.0.
          </li>
          <li>
            Acid sulfate soils mapping — © State of Queensland (Department of
            Resources), CC BY 4.0.
          </li>
          <li>
            Mineral and resource tenures, Key Resource Areas — © State of
            Queensland (Department of Resources), CC BY 4.0.
          </li>
          <li>
            State school catchments — © State of Queensland (Department of
            Education), CC BY 4.0.
          </li>
          <li>
            ShapingSEQ 2023 regional land use categories — © State of
            Queensland, CC BY 4.0.
          </li>
          <li>
            Address search — Queensland Government composite address locator.
          </li>
          <li>
            Aerial imagery — © State of Queensland (Latest State Program
            imagery).
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Local councils">
        <ul>
          <li>
            Brisbane City Council — City Plan 2014 overlays (flood planning,
            heritage and character, biodiversity, transport noise, landslide,
            high-voltage easements, zoning) and Flood Awareness mapping, ©
            Brisbane City Council, CC BY 4.0.
          </li>
          <li>
            City of Gold Coast — City Plan zoning and Flood Risk Overlay, ©
            City of Gold Coast, CC BY 4.0.
          </li>
          <li>
            City of Moreton Bay — planning scheme zones and overlay mapping,
            © City of Moreton Bay, CC BY 4.0.
          </li>
          <li>
            Sunshine Coast Council — planning scheme zones and overlay
            mapping, © Sunshine Coast Regional Council, CC BY 4.0.
          </li>
          <li>
            Redland City Council — Redland City Plan zoning and overlay
            mapping, © Redland City Council, CC BY 4.0.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Other services">
        <ul>
          <li>
            Optional geocoding and address autocomplete — Google Maps
            Platform.
          </li>
          <li>
            Map rendering — MapLibre GL; basemap tiles © Mapbox and ©
            OpenStreetMap contributors where the Mapbox basemap is active.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Important note">
        <p>
          LotLens is not endorsed by, or affiliated with, the State of
          Queensland or any local government. Datasets are reproduced without
          modification beyond format conversion and map styling; any errors
          introduced by aggregation are ours. If you are a data custodian and
          believe an attribution is missing or incorrect, please contact us
          and we will fix it promptly.
        </p>
      </LegalSection>
    </LegalPage>
  );
}

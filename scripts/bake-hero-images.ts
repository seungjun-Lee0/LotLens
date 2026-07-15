// npx tsx scripts/bake-hero-images.ts
//
// Bakes the landing-hero aerials into /public with the CSS effects
// pre-applied, so the page serves identical pixels WITHOUT any runtime
// CSS `blur()` (a full-bleed filter re-rasterises on scroll and was a
// jank source) and without depending on the QLD imagery server for LCP.
//
//   public/hero-aerial.jpg  wide crop, gaussian blur σ=2 (≡ CSS blur(2px))
//   public/hero-loupe.jpg   tight crop, unfiltered
//
// Re-run after `generate-hero-demo.ts` whenever the demo lot moves —
// the bboxes are read from lib/hero-demo-data.json.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

import fixture from "../lib/hero-demo-data.json";

const QLD_EXPORT =
  "https://spatial-img.information.qld.gov.au/arcgis/rest/services/Basemaps/LatestStateProgram_AllUsers/ImageServer/exportImage";

type Bbox = { xmin: number; ymin: number; xmax: number; ymax: number };

const url = (b: Bbox, size: string) =>
  `${QLD_EXPORT}?bbox=${b.xmin},${b.ymin},${b.xmax},${b.ymax}&bboxSR=3857&imageSR=3857&size=${size}&format=jpeg&transparent=false&f=image`;

async function fetchImage(u: string): Promise<Buffer> {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`imagery fetch ${res.status} for ${u}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const pub = join(process.cwd(), "public");

  const [heroRaw, loupeRaw] = await Promise.all([
    fetchImage(url(fixture.heroBbox as Bbox, "1600,900")),
    fetchImage(url(fixture.loupeBbox as Bbox, "900,900")),
  ]);

  const hero = await sharp(heroRaw)
    .blur(2) // σ=2 ≈ the old CSS blur(2px)
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(pub, "hero-aerial.jpg"), hero);

  const loupe = await sharp(loupeRaw)
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  writeFileSync(join(pub, "hero-loupe.jpg"), loupe);

  console.log(
    `Wrote public/hero-aerial.jpg (${(hero.length / 1024).toFixed(0)} KB) + public/hero-loupe.jpg (${(loupe.length / 1024).toFixed(0)} KB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

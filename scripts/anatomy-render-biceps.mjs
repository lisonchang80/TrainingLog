#!/usr/bin/env node
// Render biceps overlay variants for visual comparison.
// Output: docs/audit/anatomy/png/biceps-{a2,b-bbox-mid,b-mass,b-medial-5,b-lateral-5}.png
//
// Uses puppeteer headless to rasterise an inline SVG with the package's front
// body silhouette + biceps slug fill + each candidate overlay on top. Each
// variant is a separate PNG so they can be flipped through side-by-side.

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'docs/audit/anatomy/png');
mkdirSync(OUT_DIR, { recursive: true });

// Package front body — load all slugs verbatim from package
const { bodyFront } = await import('../node_modules/react-native-body-highlighter/dist/assets/bodyFront.js');
const PACKAGE_BICEP_L = 'M189.52 492.51c-2.43.62-7.38.57-7.51-3.08-.56-16.01-.42-35.49 5.11-50.26 3.19-8.54 13.89-30.22 23.27-32.72 10.08-2.68 12.68 16.59 12.6 22.8-.22 15.98-7.51 34.79-15.05 48.71-4.29 7.94-9.95 12.38-18.42 14.55z';
const PACKAGE_BICEP_R = 'M526.69 486.31c-9.9-8.61-17.75-33.21-20.65-47.73-1.41-7.06-1.34-29.61 8.58-32.16 10.33-2.66 23.81 25.34 26.6 32.91q2.6 7.04 3.6 16.13 1.62 14.66 1.66 32.28c.03 11.04-16.45 1.48-19.79-1.43z';

const PATH_BICEP_L_LATERAL_HALF = 'M150 395 L218.6 395 L177.2 510 L150 510 Z';
const PATH_BICEP_L_MEDIAL_HALF  = 'M218.6 395 L250 395 L250 510 L177.2 510 Z';
const PATH_BICEP_R_MEDIAL_HALF  = 'M480 395 L509.4 395 L550.8 510 L480 510 Z';
const PATH_BICEP_R_LATERAL_HALF = 'M509.4 395 L580 395 L580 510 L550.8 510 Z';

const LONG_COLOR = '#F26B3A';   // primary
const SHORT_COLOR = '#7CB6E0';  // secondary
const BODY_BASE = '#FAFAFA';
const OUTLINE = '#9CA3AF';
const PACKAGE_FILL = '#E5E5E5'; // skin grey (matches MuscleBodyTagger default base)

// Render every package slug at the SKIN colour so the bicep stands out in its
// real anatomical context (delt, chest, forearm, etc. all visible faintly).
function packageSlugsSvg() {
  const slugs = bodyFront.filter(s => s.slug !== 'biceps');
  let out = '';
  for (const s of slugs) {
    const paths = [...(s.path?.left || []), ...(s.path?.right || []), ...(s.path?.center || [])];
    for (const d of paths) {
      out += `<path d="${d}" fill="${PACKAGE_FILL}" stroke="${OUTLINE}" stroke-width="0.5" stroke-opacity="0.4"/>`;
    }
  }
  return out;
}

// Empty (un-highlighted) bicep silhouette so we can see where the partition sits
function bicepSilhouetteSvg(fillColor = PACKAGE_FILL) {
  return `<path d="${PACKAGE_BICEP_L}" fill="${fillColor}" stroke="${OUTLINE}" stroke-width="0.6"/>
          <path d="${PACKAGE_BICEP_R}" fill="${fillColor}" stroke="${OUTLINE}" stroke-width="0.6"/>`;
}

function overlayA2() {
  return `
    <defs>
      <clipPath id="bl"><path d="${PACKAGE_BICEP_L}"/></clipPath>
      <clipPath id="br"><path d="${PACKAGE_BICEP_R}"/></clipPath>
    </defs>
    <path d="${PATH_BICEP_L_LATERAL_HALF}" fill="${LONG_COLOR}" clip-path="url(#bl)"/>
    <path d="${PATH_BICEP_L_MEDIAL_HALF}" fill="${SHORT_COLOR}" clip-path="url(#bl)"/>
    <path d="${PATH_BICEP_R_MEDIAL_HALF}" fill="${SHORT_COLOR}" clip-path="url(#br)"/>
    <path d="${PATH_BICEP_R_LATERAL_HALF}" fill="${LONG_COLOR}" clip-path="url(#br)"/>
  `;
}

function overlayBVertical(splitL, splitR) {
  return `
    <defs>
      <clipPath id="bl"><path d="${PACKAGE_BICEP_L}"/></clipPath>
      <clipPath id="br"><path d="${PACKAGE_BICEP_R}"/></clipPath>
    </defs>
    <!-- LEFT arm: west of SPLIT = long (lateral), east = short (medial) -->
    <rect x="0" y="0" width="${splitL}" height="1448" fill="${LONG_COLOR}" clip-path="url(#bl)"/>
    <rect x="${splitL}" y="0" width="${724 - splitL}" height="1448" fill="${SHORT_COLOR}" clip-path="url(#bl)"/>
    <!-- RIGHT arm: west of SPLIT = short (medial), east = long (lateral) -->
    <rect x="0" y="0" width="${splitR}" height="1448" fill="${SHORT_COLOR}" clip-path="url(#br)"/>
    <rect x="${splitR}" y="0" width="${724 - splitR}" height="1448" fill="${LONG_COLOR}" clip-path="url(#br)"/>
  `;
}

const VARIANTS = [
  { id: 'a2',          label: 'A2 (diagonal — current ship)',     overlay: overlayA2() },
  { id: 'b-bbox-mid',  label: 'B vertical @ bbox-mid (L=202.4, R=525.9)', overlay: overlayBVertical(202.4, 525.9) },
  { id: 'b-mass',      label: 'B vertical @ mass-center (L=202.0, R=526.2)', overlay: overlayBVertical(202.0, 526.2) },
  { id: 'b-medial-5',  label: 'B vertical shifted 5u medial (L=207.4, R=520.9 — long head 2/3)', overlay: overlayBVertical(207.4, 520.9) },
  { id: 'b-lateral-5', label: 'B vertical shifted 5u lateral (L=197.4, R=530.9 — short head 2/3)', overlay: overlayBVertical(197.4, 530.9) },
];

// Render at 4x scale for crisp PNG; crop to upper-torso area to fill frame
const VB = '90 320 540 230';   // x=90..630, y=320..550 — focuses on shoulders + biceps
const PNG_W = 1080;
const PNG_H = 460;

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: PNG_W, height: PNG_H, deviceScaleFactor: 2 });

for (const v of VARIANTS) {
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#FFFFFF;">
  <svg xmlns="http://www.w3.org/2000/svg" width="${PNG_W}" height="${PNG_H}" viewBox="${VB}">
    <rect x="0" y="0" width="724" height="1448" fill="#FFFFFF"/>
    ${packageSlugsSvg()}
    ${bicepSilhouetteSvg()}
    ${v.overlay}
    <!-- caption -->
    <text x="100" y="345" font-family="-apple-system, sans-serif" font-size="11" fill="#222">${v.label}</text>
  </svg>
</body></html>`;
  await page.setContent(html);
  const buf = await page.screenshot({ type: 'png', omitBackground: false });
  const fname = `biceps-${v.id}.png`;
  writeFileSync(resolve(OUT_DIR, fname), buf);
  console.log(`Wrote ${fname}`);
}

await browser.close();
console.log('\nAll variants rendered to', OUT_DIR);

#!/usr/bin/env node
/**
 * Zoomed-in render of just the back-view triceps + surrounding muscles to
 * make the horseshoe strokes easier to inspect. Crops to the upper-arm
 * region so each pixel covers more of the muscle.
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const packagePath =
  '/Users/hao800922/code/TrainingLog-worktrees/slice-10c-set-logger-and-menu/node_modules/react-native-body-highlighter/dist/assets/bodyBack.js';
const { bodyBack } = require(packagePath);

const PATH_TRICEP_EXT_LATERAL_BACK_L = 'M925 395 C910 430 905 490 920 525';
const PATH_TRICEP_EXT_MEDIAL_BACK_L = 'M940 395 C955 430 953 490 935 525';
const PATH_TRICEP_EXT_LATERAL_BACK_R = 'M1242.4 395 C1257.4 430 1262.4 490 1247.4 525';
const PATH_TRICEP_EXT_MEDIAL_BACK_R = 'M1227.4 395 C1212.4 430 1214.4 490 1232.4 525';

const COLOR_BODY_BASE = '#FAFAFA';
const COLOR_OUTLINE = '#9CA3AF';
const COLOR_SKIN = '#E5E5E5';
const COLOR_PRIMARY = '#F26B3A';
const COLOR_PRIMARY_DARK = '#7C2D12';

const SKIN_SLUGS = new Set(['head', 'hair', 'hands', 'feet']);

// Zoom to upper-arm region: triceps bbox L [899, 960] × [383, 534],
// R [1206, 1268] × [381, 534]. Plus deltoid+lat context y ∈ [300, 580].
// Full back x = [724, 1448]. We focus x ∈ [870, 1300] y ∈ [300, 580].
const ZOOM_VIEWBOX = '870 300 430 280';

function buildSvg() {
  const slugFills = bodyBack
    .map((slug) => {
      const subs = [];
      const fill =
        slug.slug === 'triceps'
          ? COLOR_PRIMARY
          : SKIN_SLUGS.has(slug.slug)
            ? COLOR_SKIN
            : COLOR_BODY_BASE;
      for (const side of ['left', 'right']) {
        const arr = slug.path[side] ?? [];
        for (const d of arr) {
          subs.push(
            `<path d="${d}" fill="${fill}" stroke="${COLOR_OUTLINE}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`
          );
        }
      }
      return subs.join('\n');
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${ZOOM_VIEWBOX}" width="860" height="560">
  ${slugFills}
  <path d="${PATH_TRICEP_EXT_LATERAL_BACK_L}" fill="none" stroke="${COLOR_PRIMARY_DARK}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  <path d="${PATH_TRICEP_EXT_MEDIAL_BACK_L}" fill="none" stroke="${COLOR_PRIMARY_DARK}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  <path d="${PATH_TRICEP_EXT_LATERAL_BACK_R}" fill="none" stroke="${COLOR_PRIMARY_DARK}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  <path d="${PATH_TRICEP_EXT_MEDIAL_BACK_R}" fill="none" stroke="${COLOR_PRIMARY_DARK}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
</svg>`;
}

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    const svg = buildSvg();
    const html = `<!DOCTYPE html><html><head><style>body{margin:0;padding:16px;background:#fff;}</style></head><body>
      <div style="font-family:sans-serif;font-size:14px;margin-bottom:8px;">ZOOM · upper-arm region · triceps primary + horseshoe strokes</div>
      ${svg}
    </body></html>`;
    await page.setContent(html, { waitUntil: 'load' });
    await page.setViewport({ width: 900, height: 620 });
    const outDir = resolve(root, 'docs/audit/anatomy/png');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, 'triceps-pattern-c-zoom.png');
    await page.screenshot({ path: outPath, fullPage: true });
    console.log('wrote', outPath);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

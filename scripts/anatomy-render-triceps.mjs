#!/usr/bin/env node
/**
 * Render the back-view body with the triceps Pattern C horseshoe stroke
 * overlay to PNG for visual self-eval. Three states:
 *   - triceps-pattern-c-primary.png   (M_TRICEP highlighted as primary)
 *   - triceps-pattern-c-secondary.png (M_TRICEP highlighted as secondary)
 *   - triceps-pattern-c-inactive.png  (no highlight — strokes hidden)
 *
 * Strategy: spin up an HTML page that inlines the package body paths +
 * our overlay strokes, then puppeteer screenshots it. The HTML mirrors
 * the runtime SVG composition order in body-heatmap.tsx / muscle-body-
 * tagger.tsx (package fills first, then overlay strokes on top).
 */
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Load package body assets from sibling worktree (this worktree has no node_modules).
const packagePath =
  '/Users/hao800922/code/TrainingLog-worktrees/slice-10c-set-logger-and-menu/node_modules/react-native-body-highlighter/dist/assets/bodyBack.js';
const { bodyBack } = require(packagePath);

// Stroke paths (copied from body-overlay-paths.ts so the script is
// self-contained and verifiable without React Native transpilation).
const PATH_TRICEP_EXT_LATERAL_BACK_L = 'M925 395 C910 430 905 490 920 525';
const PATH_TRICEP_EXT_MEDIAL_BACK_L = 'M940 395 C955 430 953 490 935 525';
const PATH_TRICEP_EXT_LATERAL_BACK_R = 'M1242.4 395 C1257.4 430 1262.4 490 1247.4 525';
const PATH_TRICEP_EXT_MEDIAL_BACK_R = 'M1227.4 395 C1212.4 430 1214.4 490 1232.4 525';

const COLOR_BODY_BASE = '#FAFAFA';
const COLOR_OUTLINE = '#9CA3AF';
const COLOR_SKIN = '#E5E5E5';
const COLOR_PRIMARY = '#F26B3A';
const COLOR_PRIMARY_DARK = '#7C2D12';
const COLOR_SECONDARY = '#7CB6E0';
const COLOR_SECONDARY_DARK = '#1E3A8A';

const SKIN_SLUGS = new Set(['head', 'hair', 'hands', 'feet']);

function buildSvg({ tricepsFill, strokeColor, showStrokes }) {
  const slugFills = bodyBack
    .map((slug) => {
      const subs = [];
      const fill =
        slug.slug === 'triceps'
          ? tricepsFill
          : SKIN_SLUGS.has(slug.slug)
            ? COLOR_SKIN
            : COLOR_BODY_BASE;
      for (const side of ['left', 'right']) {
        const arr = slug.path[side] ?? [];
        for (const d of arr) {
          subs.push(`<path d="${d}" fill="${fill}" stroke="${COLOR_OUTLINE}" stroke-width="1.2" vector-effect="non-scaling-stroke"/>`);
        }
      }
      return subs.join('\n');
    })
    .join('\n');

  const strokes = showStrokes
    ? `
    <path d="${PATH_TRICEP_EXT_LATERAL_BACK_L}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${PATH_TRICEP_EXT_MEDIAL_BACK_L}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${PATH_TRICEP_EXT_LATERAL_BACK_R}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <path d="${PATH_TRICEP_EXT_MEDIAL_BACK_R}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
  `
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="724 0 724 1448" width="400" height="800">
  ${slugFills}
  ${strokes}
</svg>`;
}

function buildHtml(svg, label) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #fff; font-family: sans-serif; }
    .label { text-align: center; font-size: 14px; color: #374151; margin-bottom: 8px; }
    .frame { border: 1px solid #E5E7EB; padding: 8px; display: inline-block; background: #fafafa; }
  </style></head><body>
    <div class="label">${label}</div>
    <div class="frame">${svg}</div>
  </body></html>`;
}

async function renderOne({ filename, label, tricepsFill, strokeColor, showStrokes }) {
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    const svg = buildSvg({ tricepsFill, strokeColor, showStrokes });
    const html = buildHtml(svg, label);
    await page.setContent(html, { waitUntil: 'load' });
    await page.setViewport({ width: 440, height: 870 });
    const outDir = resolve(root, 'docs/audit/anatomy/png');
    mkdirSync(outDir, { recursive: true });
    const outPath = resolve(outDir, filename);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log('wrote', outPath);
  } finally {
    await browser.close();
  }
}

(async () => {
  await renderOne({
    filename: 'triceps-pattern-c-primary.png',
    label: 'BACK · triceps M_TRICEP highlight=primary',
    tricepsFill: COLOR_PRIMARY,
    strokeColor: COLOR_PRIMARY_DARK,
    showStrokes: true,
  });
  await renderOne({
    filename: 'triceps-pattern-c-secondary.png',
    label: 'BACK · triceps M_TRICEP highlight=secondary',
    tricepsFill: COLOR_SECONDARY,
    strokeColor: COLOR_SECONDARY_DARK,
    showStrokes: true,
  });
  await renderOne({
    filename: 'triceps-pattern-c-inactive.png',
    label: 'BACK · triceps M_TRICEP no highlight (strokes hidden)',
    tricepsFill: COLOR_BODY_BASE,
    strokeColor: COLOR_OUTLINE,
    showStrokes: false,
  });
  console.log('done');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

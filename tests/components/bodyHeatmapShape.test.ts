/**
 * Body Heatmap M-layer shape invariant tests.
 *
 * Jest config (jest.config in package.json) runs in `testEnvironment: node`
 * and matches only `*.test.ts`, so we cannot mount the React Native SVG
 * component here. Instead we parse the source file for the 19 stable M_*
 * constant references and assert each muscle ID is wired into at least one
 * `fill={f(M_*)}` call — guarding against accidentally dropping a muscle in
 * future visual edits.
 *
 * Also verifies the BodyHeatmap public API contract (mQuintile prop name,
 * Quintile type export) hasn't drifted away from what stats-panel.tsx
 * passes in.
 *
 * Added overnight 5/23 alongside the M-level body heatmap upgrade.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  MUSCLE_SEEDS,
  M_ABS,
  M_BACK,
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_CALF,
  M_FOREARM,
  M_FRONT_DELT,
  M_HAMSTRING,
  M_LOWER_BACK,
  M_LOWER_CHEST,
  M_LOWER_GLUTE,
  M_MID_DELT,
  M_OBLIQUE,
  M_QUAD,
  M_REAR_DELT,
  M_TRAP,
  M_TRICEP,
  M_UPPER_CHEST,
  M_UPPER_GLUTE,
} from '../../src/db/seed/v006ExerciseLibrary';

const HEATMAP_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../../components/body-heatmap.tsx'),
  'utf8'
);

describe('BodyHeatmap M-layer shape invariants', () => {
  it('imports all 19 M_* constants from v006ExerciseLibrary', () => {
    // Defensive: if a new muscle is added to the seed, this test will
    // alert the dev that the heatmap should be updated to paint it.
    const importedIds = [
      M_ABS,
      M_BACK,
      M_BICEP_LONG,
      M_BICEP_SHORT,
      M_CALF,
      M_FOREARM,
      M_FRONT_DELT,
      M_HAMSTRING,
      M_LOWER_BACK,
      M_LOWER_CHEST,
      M_LOWER_GLUTE,
      M_MID_DELT,
      M_OBLIQUE,
      M_QUAD,
      M_REAR_DELT,
      M_TRAP,
      M_TRICEP,
      M_UPPER_CHEST,
      M_UPPER_GLUTE,
    ];
    // 19 M_* IDs (per ADR-0010 anatomical muscle layer).
    expect(importedIds).toHaveLength(19);
    // All MUSCLE_SEEDS IDs covered by our imports.
    const seedIds = new Set(MUSCLE_SEEDS.map((m) => m.id));
    const importedSet = new Set(importedIds);
    for (const id of seedIds) {
      expect(importedSet.has(id)).toBe(true);
    }
  });

  it('fills each of the 19 muscles via fill={f(M_*)} expression', () => {
    // The heatmap source paints each muscle path with a `fill={f(M_*)}`
    // expression that runs the quintile lookup. Verify every M_* import
    // appears at least once in such a fill expression.
    //
    // (Body silhouette/skin paths use literal hex colors, so the f()
    // function call is exclusive to the per-muscle paths.)
    const importNames = [
      'M_ABS',
      'M_BACK',
      'M_BICEP_LONG',
      'M_BICEP_SHORT',
      'M_CALF',
      'M_FOREARM',
      'M_FRONT_DELT',
      'M_HAMSTRING',
      'M_LOWER_BACK',
      'M_LOWER_CHEST',
      'M_LOWER_GLUTE',
      'M_MID_DELT',
      'M_OBLIQUE',
      'M_QUAD',
      'M_REAR_DELT',
      'M_TRAP',
      'M_TRICEP',
      'M_UPPER_CHEST',
      'M_UPPER_GLUTE',
    ];
    for (const name of importNames) {
      const pattern = new RegExp(`fill=\\{f\\(${name}\\)\\}`);
      expect(HEATMAP_SOURCE).toMatch(pattern);
    }
  });

  it('exposes BodyHeatmap with mQuintile + mCount props (not legacy mgQuintile)', () => {
    expect(HEATMAP_SOURCE).toMatch(/mQuintile:\s*Map<string,\s*Quintile>/);
    expect(HEATMAP_SOURCE).toMatch(/mCount\?:\s*Map<string,\s*number>/);
    // Legacy MG-layer prop names should be gone.
    expect(HEATMAP_SOURCE).not.toMatch(/mgQuintile:\s*Map/);
    expect(HEATMAP_SOURCE).not.toMatch(/mgCount\?:\s*Map/);
  });

  it('uses bilingual page.bodyFront/bodyBack keys (not literal "正面"/"背面")', () => {
    expect(HEATMAP_SOURCE).toMatch(/t\('page',\s*'bodyFront'\)/);
    expect(HEATMAP_SOURCE).toMatch(/t\('page',\s*'bodyBack'\)/);
    // Old TODO(i18n) markers should be cleared.
    expect(HEATMAP_SOURCE).not.toMatch(/TODO\(i18n\)/);
  });

  it('quintile color palette retains 5 entries + zero-grey', () => {
    // The 5 quintile colors are a stable contract — the stats-panel
    // percentileBucketize emits indices 0..4 expecting QUINTILE_COLORS[i]
    // to resolve. Guarding against accidental palette trimming.
    expect(HEATMAP_SOURCE).toMatch(/QUINTILE_COLORS/);
    // Locate the QUINTILE_COLORS array definition and count hex literals
    // until the closing `];`. Robust against varying comments/whitespace.
    const startIdx = HEATMAP_SOURCE.indexOf('QUINTILE_COLORS');
    expect(startIdx).toBeGreaterThan(-1);
    const arrEnd = HEATMAP_SOURCE.indexOf('];', startIdx);
    expect(arrEnd).toBeGreaterThan(startIdx);
    const block = HEATMAP_SOURCE.slice(startIdx, arrEnd);
    const hexes = block.match(/'#[0-9A-Fa-f]{6}'/g) ?? [];
    expect(hexes).toHaveLength(5);
    // Zero-frequency color is a separate constant.
    expect(HEATMAP_SOURCE).toMatch(/COLOR_ZERO\s*=\s*'#[0-9A-Fa-f]{6}'/);
  });
});

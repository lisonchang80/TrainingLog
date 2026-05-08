import { detectPRBreaks, aggregateBucketPRs } from '../../src/domain/pr/prEngine';
import { classifyBucket, BUCKETS, sortBreaksForDisplay } from '../../src/domain/pr/buckets';
import type { SetForPR } from '../../src/domain/pr/types';

const A_LOADED = (weight_kg: number, reps: number): SetForPR => ({
  weight_kg,
  reps,
  load_type: 'loaded',
  bw_snapshot_kg: null,
});

const B_BW = (weight_kg: number, reps: number): SetForPR => ({
  weight_kg,
  reps,
  load_type: 'bodyweight',
  bw_snapshot_kg: null,
});

const C_ASSIST = (weight_kg: number, reps: number, bw: number | null): SetForPR => ({
  weight_kg,
  reps,
  load_type: 'assisted',
  bw_snapshot_kg: bw,
});

describe('classifyBucket — 5 buckets boundaries', () => {
  it('1, 2, 3 → max_strength', () => {
    expect(classifyBucket(1)).toBe('max_strength');
    expect(classifyBucket(3)).toBe('max_strength');
  });

  it('4, 5, 6 → strength', () => {
    expect(classifyBucket(4)).toBe('strength');
    expect(classifyBucket(6)).toBe('strength');
  });

  it('7, 8, 9, 10 → hypertrophy', () => {
    expect(classifyBucket(7)).toBe('hypertrophy');
    expect(classifyBucket(10)).toBe('hypertrophy');
  });

  it('11–15 → muscle_endurance', () => {
    expect(classifyBucket(11)).toBe('muscle_endurance');
    expect(classifyBucket(15)).toBe('muscle_endurance');
  });

  it('16+ → endurance (open-ended)', () => {
    expect(classifyBucket(16)).toBe('endurance');
    expect(classifyBucket(50)).toBe('endurance');
    expect(classifyBucket(200)).toBe('endurance');
  });

  it('reps ≤ 0 / null / NaN → null', () => {
    expect(classifyBucket(0)).toBeNull();
    expect(classifyBucket(-1)).toBeNull();
    expect(classifyBucket(null)).toBeNull();
    expect(classifyBucket(undefined)).toBeNull();
    expect(classifyBucket(NaN)).toBeNull();
  });

  it('exactly 5 buckets exposed by Constants Provider', () => {
    expect(BUCKETS).toHaveLength(5);
  });
});

describe('Module #2 — PR Engine — load_type A (loaded)', () => {
  it('first set in a bucket → first PR (prior_best=null) for both weight + volume', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(80, 8),
      prior_sets: [],
    });
    expect(delta.breaks).toHaveLength(2);
    expect(delta.breaks.every((b) => b.bucket === 'hypertrophy')).toBe(true);
    expect(delta.breaks.every((b) => b.prior_best === null)).toBe(true);
    expect(delta.is_all_time_weight_pr).toBe(true);
    expect(delta.is_all_time_volume_pr).toBe(true);
  });

  it('higher weight in same bucket → weight PR only (volume might tie)', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(85, 8), // 85×8 = 680
      prior_sets: [
        A_LOADED(80, 8), // 80×8 = 640
      ],
    });
    const types = delta.breaks.map((b) => b.type);
    expect(types).toContain('weight');
    expect(types).toContain('volume'); // 680 > 640 too
    const wPR = delta.breaks.find((b) => b.type === 'weight')!;
    expect(wPR.bucket).toBe('hypertrophy');
    expect(wPR.new_value).toBe(85);
    expect(wPR.prior_best).toBe(80);
  });

  it('volume break without weight break — heavier reps in same bucket', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(80, 10), // weight 80, vol 800
      prior_sets: [
        A_LOADED(85, 8), // weight 85 (higher), vol 680 (lower)
        A_LOADED(80, 9), // vol 720
      ],
    });
    const types = delta.breaks.map((b) => b.type);
    expect(types).not.toContain('weight'); // 80 < 85
    expect(types).toContain('volume'); // 800 > 720
  });

  it('PR is bucket-scoped: a 5-rep set does not break a 10-rep set bucket', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(100, 5), // strength bucket
      prior_sets: [
        A_LOADED(80, 10), // hypertrophy bucket — different bucket
      ],
    });
    // Both PR types should fire (first in 'strength' bucket)
    expect(delta.breaks).toHaveLength(2);
    expect(delta.breaks.every((b) => b.bucket === 'strength')).toBe(true);
    expect(delta.breaks.every((b) => b.prior_best === null)).toBe(true);
    // Cross-bucket: 100kg > 80kg → all-time weight PR; 100×5=500 < 80×10=800 → not all-time volume
    expect(delta.is_all_time_weight_pr).toBe(true);
    expect(delta.is_all_time_volume_pr).toBe(false);
  });

  it('no break when new set is weaker than prior in same bucket', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(70, 8),
      prior_sets: [A_LOADED(80, 8), A_LOADED(75, 8)],
    });
    expect(delta.breaks).toHaveLength(0);
    expect(delta.is_all_time_weight_pr).toBe(false);
    expect(delta.is_all_time_volume_pr).toBe(false);
  });

  it('exact equality is NOT a PR (strict greater-than)', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(80, 8),
      prior_sets: [A_LOADED(80, 8)],
    });
    expect(delta.breaks).toHaveLength(0);
    expect(delta.is_all_time_weight_pr).toBe(false);
  });
});

describe('Module #2 — PR Engine — load_type B (bodyweight)', () => {
  it('weighted bodyweight (+10×8) is a PR like loaded', () => {
    const delta = detectPRBreaks({
      new_set: B_BW(10, 8),
      prior_sets: [B_BW(5, 8)],
    });
    const wPR = delta.breaks.find((b) => b.type === 'weight');
    expect(wPR?.new_value).toBe(10);
    expect(wPR?.prior_best).toBe(5);
  });

  it('純徒手 (weight=0) skips PR check entirely', () => {
    const delta = detectPRBreaks({
      new_set: B_BW(0, 20),
      prior_sets: [], // no priors
    });
    expect(delta.breaks).toHaveLength(0);
    expect(delta.is_all_time_weight_pr).toBe(false);
    expect(delta.is_all_time_volume_pr).toBe(false);
  });

  it('prior 純徒手 sets are excluded from baselines', () => {
    const delta = detectPRBreaks({
      new_set: B_BW(5, 8), // first weighted set
      prior_sets: [B_BW(0, 10), B_BW(0, 12)], // pure bw — ignored
    });
    expect(delta.breaks).toHaveLength(2); // first PR (no priors)
    expect(delta.breaks.every((b) => b.prior_best === null)).toBe(true);
  });
});

describe('Module #2 — PR Engine — load_type C (assisted)', () => {
  it('uses (bw − weight) for both PR types', () => {
    // bw 75, assist 30 → eff 45; reps 8 → vol 360
    // prior: bw 75, assist 35 → eff 40; reps 8 → vol 320
    const delta = detectPRBreaks({
      new_set: C_ASSIST(30, 8, 75),
      prior_sets: [C_ASSIST(35, 8, 75)],
    });
    const wPR = delta.breaks.find((b) => b.type === 'weight');
    expect(wPR?.new_value).toBe(45);
    expect(wPR?.prior_best).toBe(40);
    const vPR = delta.breaks.find((b) => b.type === 'volume');
    expect(vPR?.new_value).toBe(360);
    expect(vPR?.prior_best).toBe(320);
  });

  it('new set without bw_snapshot → skip', () => {
    const delta = detectPRBreaks({
      new_set: C_ASSIST(30, 8, null),
      prior_sets: [C_ASSIST(35, 8, 75)],
    });
    expect(delta.breaks).toHaveLength(0);
  });

  it('prior sets without bw_snapshot are excluded from baselines', () => {
    const delta = detectPRBreaks({
      new_set: C_ASSIST(30, 8, 75),
      prior_sets: [
        C_ASSIST(20, 8, null), // null bw → skip
        C_ASSIST(40, 8, 75), // eff 35 → vol 280
      ],
    });
    const wPR = delta.breaks.find((b) => b.type === 'weight');
    expect(wPR?.prior_best).toBe(35); // not 55 (which would be eff for 20-assist if bw was used)
  });

  it('weight ≥ bw → invalid → skip', () => {
    const delta = detectPRBreaks({
      new_set: C_ASSIST(80, 5, 75),
      prior_sets: [],
    });
    expect(delta.breaks).toHaveLength(0);
  });
});

describe('Module #2 — PR Engine — multi-bucket prior aggregation', () => {
  it('cross-bucket all-time flags use the heaviest/best across all priors', () => {
    const delta = detectPRBreaks({
      new_set: A_LOADED(120, 3), // max_strength bucket; weight 120, vol 360
      prior_sets: [
        A_LOADED(80, 10), // hypertrophy; weight 80, vol 800
        A_LOADED(100, 5), // strength; weight 100, vol 500
      ],
    });
    expect(delta.is_all_time_weight_pr).toBe(true); // 120 > 100
    expect(delta.is_all_time_volume_pr).toBe(false); // 360 < 800
  });
});

describe('sortBreaksForDisplay — UI priority order', () => {
  it('heaviest bucket first, weight before volume', () => {
    const breaks = [
      { bucket: 'endurance' as const, type: 'volume' as const },
      { bucket: 'max_strength' as const, type: 'volume' as const },
      { bucket: 'max_strength' as const, type: 'weight' as const },
      { bucket: 'hypertrophy' as const, type: 'weight' as const },
    ];
    const sorted = sortBreaksForDisplay(breaks);
    expect(sorted.map((b) => `${b.bucket}-${b.type}`)).toEqual([
      'max_strength-weight',
      'max_strength-volume',
      'hypertrophy-weight',
      'endurance-volume',
    ]);
  });
});

describe('aggregateBucketPRs — Exercise History header source', () => {
  it('returns one snapshot per bucket that has at least one qualifying set', () => {
    const sets: SetForPR[] = [
      A_LOADED(100, 5), // strength
      A_LOADED(105, 5), // strength — beats prev
      A_LOADED(80, 10), // hypertrophy
      A_LOADED(85, 8), // hypertrophy — heavier weight, but volume 680 < 800
      B_BW(0, 20), // pure bw — excluded
    ];
    const snaps = aggregateBucketPRs(sets);
    expect(snaps).toHaveLength(2);
    const byKey = Object.fromEntries(snaps.map((s) => [s.bucket, s]));
    expect(byKey.strength.weight_best).toBe(105);
    expect(byKey.strength.volume_best).toBe(525);
    expect(byKey.hypertrophy.weight_best).toBe(85);
    expect(byKey.hypertrophy.volume_best).toBe(800);
    expect(byKey.hypertrophy.volume_best_weight).toBe(80);
    expect(byKey.hypertrophy.volume_best_reps).toBe(10);
  });

  it('output ordered max_strength → endurance', () => {
    const sets: SetForPR[] = [
      A_LOADED(50, 20), // endurance
      A_LOADED(120, 3), // max_strength
      A_LOADED(80, 10), // hypertrophy
    ];
    const snaps = aggregateBucketPRs(sets);
    expect(snaps.map((s) => s.bucket)).toEqual([
      'max_strength',
      'hypertrophy',
      'endurance',
    ]);
  });

  it('empty input → empty array', () => {
    expect(aggregateBucketPRs([])).toEqual([]);
  });
});

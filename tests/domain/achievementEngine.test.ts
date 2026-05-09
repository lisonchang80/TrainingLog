import { evaluate } from '../../src/domain/achievement/achievementEngine';
import type {
  AchievementDefinitionRow,
  CumulativePRCounts,
  SessionEval,
  SessionEvalSet,
} from '../../src/domain/achievement/types';
import type { BucketKey } from '../../src/domain/pr/types';

// Helpers ---------------------------------------------------------

const def = (
  id: number,
  o: Partial<AchievementDefinitionRow>
): AchievementDefinitionRow => ({
  id,
  code: `def-${id}`,
  category: 'session_count',
  display_name: '',
  description: null,
  mg_id: null,
  bucket_id: null,
  pr_type: null,
  threshold: null,
  tier: 1,
  ...o,
});

const set = (o: Partial<SessionEvalSet> & { set_id: string }): SessionEvalSet => ({
  mg_id: 'mg-chest',
  bucket: 'hypertrophy',
  is_logged: true,
  weight_pr_broken: false,
  volume_pr_broken: false,
  ...o,
});

const session = (sets: SessionEvalSet[], session_id = 'sess-1'): SessionEval => ({
  session_id,
  sets,
});

const noPRs = (): CumulativePRCounts => ({
  per_mg: new Map(),
  per_bucket: new Map(),
});

// ---- 1. first_combo ---------------------------------------------

describe('evaluate — first_combo', () => {
  it('unlocks first (mg, bucket) tuple anchored to first logged set', () => {
    const defs = [
      def(1, {
        category: 'first_combo',
        mg_id: 'mg-chest',
        bucket_id: 'hypertrophy',
      }),
    ];
    const out = evaluate({
      session: session([
        set({ set_id: 's1', mg_id: 'mg-chest', bucket: 'hypertrophy' }),
        set({ set_id: 's2', mg_id: 'mg-chest', bucket: 'hypertrophy' }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out).toEqual([
      { definition_id: 1, session_id: 'sess-1', set_id: 's1' },
    ]);
  });

  it('does NOT re-unlock a tuple already in unlockedIds', () => {
    const defs = [
      def(1, {
        category: 'first_combo',
        mg_id: 'mg-chest',
        bucket_id: 'hypertrophy',
      }),
    ];
    const out = evaluate({
      session: session([set({ set_id: 's1' })]),
      defs,
      unlockedIds: new Set([1]),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('ignores skipped sets and sets without mg/bucket', () => {
    const defs = [
      def(1, {
        category: 'first_combo',
        mg_id: 'mg-chest',
        bucket_id: 'hypertrophy',
      }),
    ];
    const out = evaluate({
      session: session([
        set({ set_id: 's1', is_logged: false }),
        set({ set_id: 's2', mg_id: null }),
        set({ set_id: 's3', bucket: null }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('one session can unlock multiple combos (chest hyper + back strength)', () => {
    const defs = [
      def(1, {
        category: 'first_combo',
        mg_id: 'mg-chest',
        bucket_id: 'hypertrophy',
      }),
      def(2, {
        category: 'first_combo',
        mg_id: 'mg-back',
        bucket_id: 'strength',
      }),
    ];
    const out = evaluate({
      session: session([
        set({ set_id: 's1', mg_id: 'mg-chest', bucket: 'hypertrophy' }),
        set({ set_id: 's2', mg_id: 'mg-back', bucket: 'strength' }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out.map((r) => r.definition_id).sort()).toEqual([1, 2]);
  });
});

// ---- 2. pr_per_mg -----------------------------------------------

describe('evaluate — pr_per_mg', () => {
  it('unlocks tier matching cumulative count when this session breaks a PR', () => {
    const defs = [
      def(10, {
        category: 'pr_per_mg',
        mg_id: 'mg-chest',
        pr_type: 'weight',
        threshold: 1,
      }),
      def(11, {
        category: 'pr_per_mg',
        mg_id: 'mg-chest',
        pr_type: 'weight',
        threshold: 10,
      }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map([['mg-chest', { weight: 5, volume: 0 }]]),
      per_bucket: new Map(),
    };
    const out = evaluate({
      session: session([set({ set_id: 's1', weight_pr_broken: true })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 5,
    });
    // Tier 1 unlocks (5 ≥ 1); Tier 10 doesn't yet.
    expect(out).toEqual([
      { definition_id: 10, session_id: 'sess-1', set_id: 's1' },
    ]);
  });

  it('does not trigger tier when this session has no PR break for that type', () => {
    const defs = [
      def(10, {
        category: 'pr_per_mg',
        mg_id: 'mg-chest',
        pr_type: 'weight',
        threshold: 1,
      }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map([['mg-chest', { weight: 99, volume: 0 }]]),
      per_bucket: new Map(),
    };
    const out = evaluate({
      session: session([set({ set_id: 's1', weight_pr_broken: false })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('weight + volume PR on same set anchors both', () => {
    const defs = [
      def(10, {
        category: 'pr_per_mg',
        mg_id: 'mg-chest',
        pr_type: 'weight',
        threshold: 1,
      }),
      def(11, {
        category: 'pr_per_mg',
        mg_id: 'mg-chest',
        pr_type: 'volume',
        threshold: 1,
      }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map([['mg-chest', { weight: 1, volume: 1 }]]),
      per_bucket: new Map(),
    };
    const out = evaluate({
      session: session([
        set({ set_id: 's1', weight_pr_broken: true, volume_pr_broken: true }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    expect(out.map((r) => r.definition_id).sort()).toEqual([10, 11]);
  });
});

// ---- 3. pr_per_bucket -------------------------------------------

describe('evaluate — pr_per_bucket', () => {
  it('unlocks per-bucket ladder independently from per-mg', () => {
    const bucket: BucketKey = 'hypertrophy';
    const defs = [
      def(20, {
        category: 'pr_per_bucket',
        bucket_id: bucket,
        pr_type: 'weight',
        threshold: 10,
      }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map(),
      per_bucket: new Map([[bucket, { weight: 12, volume: 0 }]]),
    };
    const out = evaluate({
      session: session([set({ set_id: 's1', bucket, weight_pr_broken: true })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    expect(out).toEqual([
      { definition_id: 20, session_id: 'sess-1', set_id: 's1' },
    ]);
  });
});

// ---- 4. session_count -------------------------------------------

describe('evaluate — session_count', () => {
  it('unlocks every threshold ≤ total session count not yet unlocked', () => {
    const defs = [
      def(30, { category: 'session_count', threshold: 1, tier: 1 }),
      def(31, { category: 'session_count', threshold: 5, tier: 2 }),
      def(32, { category: 'session_count', threshold: 10, tier: 3 }),
    ];
    const out = evaluate({
      session: session([set({ set_id: 's1' })]),
      defs,
      unlockedIds: new Set([30]),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 5,
    });
    expect(out).toEqual([
      { definition_id: 31, session_id: 'sess-1', set_id: null },
    ]);
  });

  it('empty session (no logged sets) does not unlock session_count', () => {
    const defs = [def(30, { category: 'session_count', threshold: 1 })];
    const out = evaluate({
      session: session([set({ set_id: 's1', is_logged: false })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('multiple thresholds satisfied in one jump unlock together', () => {
    const defs = [
      def(30, { category: 'session_count', threshold: 1, tier: 1 }),
      def(31, { category: 'session_count', threshold: 5, tier: 2 }),
      def(32, { category: 'session_count', threshold: 10, tier: 3 }),
      def(33, { category: 'session_count', threshold: 25, tier: 4 }),
    ];
    const out = evaluate({
      session: session([set({ set_id: 's1' })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 10,
    });
    expect(out.map((r) => r.definition_id).sort()).toEqual([30, 31, 32]);
  });
});

// ---- 5. edge cases ----------------------------------------------

describe('evaluate — edge cases', () => {
  it('completely empty session.sets unlocks nothing', () => {
    const defs = [
      def(1, { category: 'first_combo', mg_id: 'mg-chest', bucket_id: 'hypertrophy' }),
      def(30, { category: 'session_count', threshold: 1 }),
    ];
    const out = evaluate({
      session: session([]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: noPRs(),
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('session with all-skipped sets unlocks nothing across all categories', () => {
    const defs = [
      def(1, { category: 'first_combo', mg_id: 'mg-chest', bucket_id: 'hypertrophy' }),
      def(10, { category: 'pr_per_mg', mg_id: 'mg-chest', pr_type: 'weight', threshold: 1 }),
      def(20, { category: 'pr_per_bucket', bucket_id: 'hypertrophy', pr_type: 'weight', threshold: 1 }),
      def(30, { category: 'session_count', threshold: 1 }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map([['mg-chest', { weight: 1, volume: 0 }]]),
      per_bucket: new Map([['hypertrophy', { weight: 1, volume: 0 }]]),
    };
    const out = evaluate({
      session: session([
        set({ set_id: 's1', is_logged: false, weight_pr_broken: true }),
        set({ set_id: 's2', is_logged: false }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    expect(out).toEqual([]);
  });

  it('multi-bucket simultaneous PRs in one session anchor each to its own set', () => {
    const defs = [
      def(40, {
        category: 'pr_per_bucket',
        bucket_id: 'hypertrophy',
        pr_type: 'weight',
        threshold: 1,
      }),
      def(41, {
        category: 'pr_per_bucket',
        bucket_id: 'strength',
        pr_type: 'weight',
        threshold: 1,
      }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map(),
      per_bucket: new Map([
        ['hypertrophy', { weight: 1, volume: 0 }],
        ['strength', { weight: 1, volume: 0 }],
      ]),
    };
    const out = evaluate({
      session: session([
        set({ set_id: 'hyp', bucket: 'hypertrophy', weight_pr_broken: true }),
        set({ set_id: 'str', bucket: 'strength', weight_pr_broken: true }),
      ]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    expect(out).toEqual(
      expect.arrayContaining([
        { definition_id: 40, session_id: 'sess-1', set_id: 'hyp' },
        { definition_id: 41, session_id: 'sess-1', set_id: 'str' },
      ])
    );
    expect(out).toHaveLength(2);
  });

  it('multiple per_mg ladder thresholds satisfied at once unlock together', () => {
    const defs = [
      def(50, { category: 'pr_per_mg', mg_id: 'mg-chest', pr_type: 'weight', threshold: 1 }),
      def(51, { category: 'pr_per_mg', mg_id: 'mg-chest', pr_type: 'weight', threshold: 5 }),
      def(52, { category: 'pr_per_mg', mg_id: 'mg-chest', pr_type: 'weight', threshold: 10 }),
    ];
    const cumul: CumulativePRCounts = {
      per_mg: new Map([['mg-chest', { weight: 5, volume: 0 }]]),
      per_bucket: new Map(),
    };
    const out = evaluate({
      session: session([set({ set_id: 's1', weight_pr_broken: true })]),
      defs,
      unlockedIds: new Set(),
      cumulativePRCounts: cumul,
      totalSessionCount: 1,
    });
    // count=5 unlocks tiers 1 and 5; tier 10 not yet
    expect(out.map((r) => r.definition_id).sort()).toEqual([50, 51]);
  });
});

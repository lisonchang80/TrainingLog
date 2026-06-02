import { replayPRs, type ReplaySetRecord } from '../../src/domain/achievement/prReplay';

const rec = (o: Partial<ReplaySetRecord> & { set_id: string }): ReplaySetRecord => ({
  session_id: 'sess-1',
  exercise_id: 'ex-bench',
  mg_id: 'mg-chest',
  load_type: 'loaded',
  weight_kg: 50,
  reps: 8,
  bw_snapshot_kg: null,
  is_logged: true,
  created_at: 1000,
  ...o,
});

describe('replayPRs', () => {
  it('first qualified set in a bucket counts as both weight + volume PR', () => {
    const r = replayPRs([rec({ set_id: 'a', weight_kg: 50, reps: 8 })]);
    const f = r.flagsBySetId.get('a')!;
    expect(f.weight_pr_broken).toBe(true);
    expect(f.volume_pr_broken).toBe(true);
    expect(r.cumulative.per_mg.get('mg-chest')).toEqual({ weight: 1, volume: 1 });
    expect(r.cumulative.per_bucket.get('hypertrophy')).toEqual({ weight: 1, volume: 1 });
  });

  it('subsequent set lower in weight + volume → no PR break', () => {
    const r = replayPRs([
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 1000 }),
      rec({ set_id: 'b', weight_kg: 40, reps: 8, created_at: 2000 }),
    ]);
    expect(r.flagsBySetId.get('b')!.weight_pr_broken).toBe(false);
    expect(r.flagsBySetId.get('b')!.volume_pr_broken).toBe(false);
    expect(r.cumulative.per_mg.get('mg-chest')).toEqual({ weight: 1, volume: 1 });
  });

  it('beating weight only → 1 PR (weight); beating volume only via more reps → 1 PR', () => {
    const r = replayPRs([
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 1000 }),
      // Same bucket (hypertrophy 7-10), heavier weight, fewer reps → both might break
      rec({ set_id: 'b', weight_kg: 60, reps: 7, created_at: 2000 }),
      // Same bucket, much higher reps but lower weight → potentially breaks volume only
      rec({ set_id: 'c', weight_kg: 55, reps: 10, created_at: 3000 }),
    ]);
    // a: w=50 v=400 → both PR
    // b: w=60>50 ✓; v=420>400 ✓ → both PR
    // c: w=55<60 ✗; v=550>420 ✓ → only volume PR
    expect(r.flagsBySetId.get('c')!.weight_pr_broken).toBe(false);
    expect(r.flagsBySetId.get('c')!.volume_pr_broken).toBe(true);
    expect(r.cumulative.per_mg.get('mg-chest')).toEqual({ weight: 2, volume: 3 });
  });

  it('skipped sets do not count', () => {
    const r = replayPRs([rec({ set_id: 'a', is_logged: false })]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
  });

  it('different buckets tracked independently', () => {
    const r = replayPRs([
      // hypertrophy bucket
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 1000 }),
      // strength bucket (4-6 reps) — first ever in that bucket → both PR
      rec({ set_id: 'b', weight_kg: 80, reps: 5, created_at: 2000 }),
    ]);
    expect(r.flagsBySetId.get('b')!.weight_pr_broken).toBe(true);
    expect(r.flagsBySetId.get('b')!.volume_pr_broken).toBe(true);
    expect(r.cumulative.per_bucket.get('hypertrophy')).toEqual({ weight: 1, volume: 1 });
    expect(r.cumulative.per_bucket.get('strength')).toEqual({ weight: 1, volume: 1 });
    expect(r.cumulative.per_mg.get('mg-chest')).toEqual({ weight: 2, volume: 2 });
  });

  it('different exercises tracked independently within same bucket + mg', () => {
    const r = replayPRs([
      rec({ set_id: 'a', exercise_id: 'ex-bench', weight_kg: 50, reps: 8, created_at: 1000 }),
      // Different exercise, same mg + bucket — first time → both PR for ex-incline
      rec({ set_id: 'b', exercise_id: 'ex-incline', weight_kg: 40, reps: 8, created_at: 2000 }),
    ]);
    expect(r.flagsBySetId.get('b')!.weight_pr_broken).toBe(true);
    expect(r.flagsBySetId.get('b')!.volume_pr_broken).toBe(true);
    expect(r.cumulative.per_mg.get('mg-chest')).toEqual({ weight: 2, volume: 2 });
  });

  it('sorts by created_at then set_id for deterministic replay', () => {
    const r = replayPRs([
      rec({ set_id: 'b', weight_kg: 60, reps: 8, created_at: 2000 }),
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 1000 }),
    ]);
    // Should replay a (50) before b (60), so a is the first PR.
    expect(r.flagsBySetId.get('a')!.weight_pr_broken).toBe(true);
    expect(r.flagsBySetId.get('b')!.weight_pr_broken).toBe(true);
  });

  it('breaks created_at ties by set_id ascending (deterministic, both orderings)', () => {
    // Equal created_at exercises the set_id tie-break ternary (line 94) — both
    // the a<b (-1) and a>b (+1) arms — which the created_at-only test above never
    // reaches. The lighter weight (50, set_id "a") must be processed first so it
    // is the baseline PR and the heavier (60, "b") breaks weight PR against it.
    const lowerThenHigher = replayPRs([
      rec({ set_id: 'b', weight_kg: 60, reps: 8, created_at: 5000 }),
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 5000 }),
    ]);
    expect(lowerThenHigher.flagsBySetId.get('a')!.weight_pr_broken).toBe(true);
    expect(lowerThenHigher.flagsBySetId.get('b')!.weight_pr_broken).toBe(true);

    // Input order reversed → identical replay outcome (proves determinism).
    const reversedInput = replayPRs([
      rec({ set_id: 'a', weight_kg: 50, reps: 8, created_at: 5000 }),
      rec({ set_id: 'b', weight_kg: 60, reps: 8, created_at: 5000 }),
    ]);
    expect(reversedInput.flagsBySetId.get('a')!.weight_pr_broken).toBe(true);
    expect(reversedInput.flagsBySetId.get('b')!.weight_pr_broken).toBe(true);
    // Cumulative counts match between the two input orderings.
    expect(reversedInput.cumulative.per_mg.get('mg-chest')).toEqual(
      lowerThenHigher.cumulative.per_mg.get('mg-chest')
    );
  });
});

describe('replayPRs — qualification edge cases', () => {
  it('assisted with null bw_snapshot is skipped cleanly (no PR, no cumulative)', () => {
    const r = replayPRs([
      rec({
        set_id: 'a',
        load_type: 'assisted',
        weight_kg: 20,
        reps: 8,
        bw_snapshot_kg: null,
      }),
    ]);
    const f = r.flagsBySetId.get('a')!;
    expect(f.qualified).toBe(false);
    expect(f.weight_pr_broken).toBe(false);
    expect(f.volume_pr_broken).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
    expect(r.cumulative.per_bucket.size).toBe(0);
  });

  it('bodyweight with weight_kg=0 is skipped', () => {
    const r = replayPRs([
      rec({ set_id: 'a', load_type: 'bodyweight', weight_kg: 0, reps: 8 }),
    ]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
  });

  it('NaN weight_kg is unqualified (Number.isFinite guard, line 104)', () => {
    const r = replayPRs([rec({ set_id: 'a', weight_kg: NaN, reps: 8 })]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
  });

  it('assisted with NaN bw_snapshot is unqualified (eff==null at line 108)', () => {
    // NaN survives the line-106 `== null` check but makes effectiveLoad return
    // null via its own !Number.isFinite guard — a distinct path from a literal
    // null snapshot.
    const r = replayPRs([
      rec({
        set_id: 'a',
        load_type: 'assisted',
        weight_kg: 20,
        reps: 8,
        bw_snapshot_kg: NaN,
      }),
    ]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
  });

  it('assisted with non-positive effective load is unqualified (line 109 eff<=0)', () => {
    // bw_snapshot present (so the null guard passes) but weight >= bw → eff <= 0.
    const r = replayPRs([
      rec({
        set_id: 'a',
        load_type: 'assisted',
        weight_kg: 80,
        reps: 8,
        bw_snapshot_kg: 75,
      }),
    ]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.cumulative.per_mg.size).toBe(0);
  });

  it.each([
    [null],
    [0],
    [-1],
  ])('invalid reps (%p) yields unqualified', (reps) => {
    const r = replayPRs([rec({ set_id: 'a', weight_kg: 50, reps })]);
    expect(r.flagsBySetId.get('a')!.qualified).toBe(false);
    expect(r.flagsBySetId.get('a')!.bucket).toBeNull();
  });
});

describe('replayPRs — bucket boundary transitions', () => {
  // Boundaries (per src/domain/pr/buckets.ts):
  //   max_strength 1-3, strength 4-6, hypertrophy 7-10,
  //   muscle_endurance 11-15, endurance 16+
  it.each([
    ['3 vs 4', 3, 4, 'max_strength', 'strength'],
    ['6 vs 7', 6, 7, 'strength', 'hypertrophy'],
    ['10 vs 11', 10, 11, 'hypertrophy', 'muscle_endurance'],
    ['15 vs 16', 15, 16, 'muscle_endurance', 'endurance'],
  ])(
    'reps boundary %s falls in different buckets (each is first PR in its bucket)',
    (_label, lowReps, highReps, lowBucket, highBucket) => {
      const r = replayPRs([
        rec({ set_id: 'lo', weight_kg: 50, reps: lowReps, created_at: 1000 }),
        rec({ set_id: 'hi', weight_kg: 50, reps: highReps, created_at: 2000 }),
      ]);
      expect(r.flagsBySetId.get('lo')!.bucket).toBe(lowBucket);
      expect(r.flagsBySetId.get('hi')!.bucket).toBe(highBucket);
      // Each is first qualified set in its own (exercise, bucket) → both PR
      expect(r.flagsBySetId.get('lo')!.weight_pr_broken).toBe(true);
      expect(r.flagsBySetId.get('hi')!.weight_pr_broken).toBe(true);
      expect(r.cumulative.per_bucket.get(lowBucket as never)).toEqual({
        weight: 1,
        volume: 1,
      });
      expect(r.cumulative.per_bucket.get(highBucket as never)).toEqual({
        weight: 1,
        volume: 1,
      });
    }
  );
});

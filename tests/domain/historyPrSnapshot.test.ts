import { computePRs } from '../../src/domain/pr/historyPrSnapshot';
import type { ExerciseHistorySession } from '../../src/adapters/sqlite/exerciseHistoryRepository';

/**
 * computePRs — per-exercise history PR aggregation, extracted from
 * app/exercise-history/[id].tsx (#8 big-file health, 2026-06-02). Behaviour
 * pinned here so the extraction is provably 0-change. Primitive semantics
 * (verified against e1rmEngine / volumeEngine / buckets):
 *   effectiveLoad('loaded', w)    = w
 *   effectiveLoad('bodyweight',w) = w
 *   effectiveLoad('assisted',w,bw)= bw - w  (null if bw null)
 *   setVolume                     = eff * reps  (assisted eff<=0 → null)
 *   classifyBucket                = 1-3 max_strength / 4-6 strength /
 *                                   7-10 hypertrophy / 11-15 muscle_endurance / 16+ endurance
 */

type HistorySet = ExerciseHistorySession['sets'][number];

let setSeq = 0;
function makeSet(partial: Partial<HistorySet>): HistorySet {
  setSeq += 1;
  return {
    set_id: `set-${setSeq}`,
    session_id: 'sess-1',
    session_started_at: 1000,
    session_ended_at: null,
    bw_snapshot_kg: null,
    weight_kg: 100,
    reps: 5,
    ordering: setSeq,
    display_rank: null,
    created_at: setSeq,
    load_type: 'loaded',
    set_kind: 'working',
    parent_set_id: null,
    is_in_cluster: false,
    cluster_partner_exercise_id: null,
    ...partial,
  };
}

function makeSession(
  startedAt: number,
  sets: Partial<HistorySet>[]
): ExerciseHistorySession {
  return {
    session_id: `sess-${startedAt}`,
    session_started_at: startedAt,
    session_ended_at: null,
    bw_snapshot_kg: null,
    template_id: null,
    program_id: null,
    sub_tag: null,
    sets: sets.map((s) => makeSet({ session_started_at: startedAt, ...s })),
  };
}

const pick = (snaps: ReturnType<typeof computePRs>, key: string) =>
  snaps.find((s) => s.key === key);

describe('computePRs', () => {
  it('returns [] for no sessions', () => {
    expect(computePRs([], 'loaded')).toEqual([]);
  });

  it('aggregates a single loaded working set into all + its rep bucket', () => {
    // reps 5 → strength bucket (4-6)
    const snaps = computePRs(
      [makeSession(1000, [{ weight_kg: 100, reps: 5 }])],
      'loaded'
    );
    const keys = snaps.map((s) => s.key);
    expect(keys).toContain('all');
    expect(keys).toContain('strength');
    expect(keys).not.toContain('hypertrophy');

    const all = pick(snaps, 'all')!;
    expect(all.weight_best).toBe(100);
    expect(all.weight_best_raw).toBe(100);
    expect(all.weight_best_reps).toBe(5);
    expect(all.weight_best_at).toBe(1000);
    expect(all.volume_best).toBe(500); // 100 * 5
    expect(all.volume_best_weight).toBe(100);
    expect(all.volume_best_reps).toBe(5);
    expect(all.volume_best_at).toBe(1000);
  });

  it('excludes warmup + dropset sets (ADR-0012: PR only counts working)', () => {
    expect(
      computePRs(
        [makeSession(1000, [{ set_kind: 'warmup', weight_kg: 999, reps: 5 }])],
        'loaded'
      )
    ).toEqual([]);
    expect(
      computePRs(
        [makeSession(1000, [{ set_kind: 'dropset', weight_kg: 999, reps: 5 }])],
        'loaded'
      )
    ).toEqual([]);
  });

  it('skips sets with null weight or null reps', () => {
    expect(
      computePRs(
        [
          makeSession(1000, [
            { weight_kg: null, reps: 5 },
            { weight_kg: 100, reps: null },
          ]),
        ],
        'loaded'
      )
    ).toEqual([]);
  });

  it('tracks weight-PR and volume-PR independently', () => {
    // A: 120kg×2 → vol 240 (weight winner). B: 60kg×10 → vol 600 (volume winner).
    const snaps = computePRs(
      [
        makeSession(1000, [
          { weight_kg: 120, reps: 2 },
          { weight_kg: 60, reps: 10 },
        ]),
      ],
      'loaded'
    );
    const all = pick(snaps, 'all')!;
    expect(all.weight_best).toBe(120);
    expect(all.weight_best_reps).toBe(2);
    expect(all.volume_best).toBe(600);
    expect(all.volume_best_weight).toBe(60);
    expect(all.volume_best_reps).toBe(10);
  });

  it('threads per-PR session timestamps across sessions', () => {
    // weight PR in the earlier session, volume PR in the later one.
    const snaps = computePRs(
      [
        makeSession(1000, [{ weight_kg: 120, reps: 2 }]), // vol 240
        makeSession(2000, [{ weight_kg: 60, reps: 10 }]), // vol 600
      ],
      'loaded'
    );
    const all = pick(snaps, 'all')!;
    expect(all.weight_best).toBe(120);
    expect(all.weight_best_at).toBe(1000);
    expect(all.volume_best).toBe(600);
    expect(all.volume_best_at).toBe(2000);
  });

  it('returns buckets in PR_ORDER and only those with data', () => {
    // reps 2 → max_strength, reps 12 → muscle_endurance. No strength/hyper/endurance.
    const snaps = computePRs(
      [
        makeSession(1000, [
          { weight_kg: 100, reps: 2 },
          { weight_kg: 50, reps: 12 },
        ]),
      ],
      'loaded'
    );
    expect(snaps.map((s) => s.key)).toEqual([
      'all',
      'max_strength',
      'muscle_endurance',
    ]);
  });

  describe('bodyweight load type', () => {
    it('excludes weight_kg === 0 (no added load)', () => {
      expect(
        computePRs(
          [makeSession(1000, [{ load_type: 'bodyweight', weight_kg: 0, reps: 8 }])],
          'bodyweight'
        )
      ).toEqual([]);
    });

    it('includes added-weight bodyweight sets (eff = weight_kg)', () => {
      const snaps = computePRs(
        [makeSession(1000, [{ load_type: 'bodyweight', weight_kg: 10, reps: 8 }])],
        'bodyweight'
      );
      const all = pick(snaps, 'all')!;
      expect(all.weight_best).toBe(10);
      expect(all.volume_best).toBe(80); // 10 * 8
    });
  });

  describe('assisted load type', () => {
    it('excludes sets with null bw_snapshot_kg', () => {
      expect(
        computePRs(
          [makeSession(1000, [{ load_type: 'assisted', weight_kg: 30, reps: 8, bw_snapshot_kg: null }])],
          'assisted'
        )
      ).toEqual([]);
    });

    it('uses effective load bw - assistance, excludes eff <= 0', () => {
      const snaps = computePRs(
        [
          makeSession(1000, [
            { load_type: 'assisted', weight_kg: 50, reps: 8, bw_snapshot_kg: 70 }, // eff 20 ✓
            { load_type: 'assisted', weight_kg: 70, reps: 8, bw_snapshot_kg: 70 }, // eff 0 ✗
          ]),
        ],
        'assisted'
      );
      const all = pick(snaps, 'all')!;
      expect(all.weight_best).toBe(20); // 70 - 50
      expect(all.weight_best_raw).toBe(50); // raw assistance amount
      expect(all.volume_best).toBe(160); // 20 * 8
    });
  });
});

import { computePRSnapshot, type PRQueryInput } from '../../src/domain/pr/prQuery';

/**
 * All-time PR query (ADR-0019 Q5, slice 10c Phase 3 commit 15).
 */

function s(weight_kg: number | null, reps: number | null): PRQueryInput {
  return { weight_kg, reps };
}

describe('computePRSnapshot', () => {
  it('empty input → empty frontier + null volume + null top sets', () => {
    expect(computePRSnapshot([])).toEqual({
      weightPRs: [],
      volumePR: null,
      topWeightSet: null,
      topVolumeSet: null,
    });
  });

  it('filters out null/zero/negative rows', () => {
    const sets = [s(null, 8), s(60, null), s(0, 8), s(60, 0), s(60, -1)];
    expect(computePRSnapshot(sets)).toEqual({
      weightPRs: [],
      volumePR: null,
      topWeightSet: null,
      topVolumeSet: null,
    });
  });

  it('single valid set → single PR + volume + same top sets', () => {
    expect(computePRSnapshot([s(100, 8)])).toEqual({
      weightPRs: [{ weight_kg: 100, reps: 8 }],
      volumePR: 800,
      topWeightSet: { weight_kg: 100, reps: 8 },
      topVolumeSet: { weight_kg: 100, reps: 8 },
    });
  });

  it('deduplicates exact (weight, reps) pairs', () => {
    expect(computePRSnapshot([s(80, 10), s(80, 10)])).toEqual({
      weightPRs: [{ weight_kg: 80, reps: 10 }],
      volumePR: 800,
      topWeightSet: { weight_kg: 80, reps: 10 },
      topVolumeSet: { weight_kg: 80, reps: 10 },
    });
  });

  it('dominated point is removed: (60,8) loses to (70,8)', () => {
    const result = computePRSnapshot([s(60, 8), s(70, 8)]);
    expect(result.weightPRs).toEqual([{ weight_kg: 70, reps: 8 }]);
  });

  it('dominated point removed even if reps lower: (60,10) loses to (60,12)', () => {
    const result = computePRSnapshot([s(60, 10), s(60, 12)]);
    expect(result.weightPRs).toEqual([{ weight_kg: 60, reps: 12 }]);
  });

  it('Pareto: 100×8 AND 85×12 both kept (neither dominates)', () => {
    const result = computePRSnapshot([s(100, 8), s(85, 12)]);
    expect(result.weightPRs).toEqual([
      { weight_kg: 100, reps: 8 },
      { weight_kg: 85, reps: 12 },
    ]);
    expect(result.volumePR).toBe(85 * 12); // 1020 > 800
  });

  it('frontier sorted by weight DESC then reps DESC', () => {
    const result = computePRSnapshot([
      s(60, 12),
      s(100, 5),
      s(80, 8),
      s(80, 10),
    ]);
    expect(result.weightPRs).toEqual([
      { weight_kg: 100, reps: 5 },
      { weight_kg: 80, reps: 10 },
      { weight_kg: 60, reps: 12 },
    ]);
    // 80×8 is dominated by 80×10; not in result.
  });

  it('volumePR is the max single-set volume across all valid sets', () => {
    const result = computePRSnapshot([
      s(60, 10), // 600
      s(80, 8), // 640
      s(100, 5), // 500
      s(50, 15), // 750
    ]);
    expect(result.volumePR).toBe(750);
  });

  it('5 sets across the Pareto front — all 5 kept', () => {
    const result = computePRSnapshot([
      s(100, 3),
      s(85, 6),
      s(75, 8),
      s(60, 12),
      s(40, 20),
    ]);
    expect(result.weightPRs).toHaveLength(5);
    expect(result.weightPRs[0]).toEqual({ weight_kg: 100, reps: 3 });
    expect(result.weightPRs[4]).toEqual({ weight_kg: 40, reps: 20 });
  });

  // ── Q5 amend (2026-05-16 ultra-late) — single top sets for card display ───

  describe('topWeightSet / topVolumeSet (ADR-0019 Q5 amend)', () => {
    it('topWeightSet = the heaviest single set; topVolumeSet = max w×r set', () => {
      const result = computePRSnapshot([
        s(100, 5), // 500 — heaviest weight
        s(85, 12), // 1020 — highest volume
        s(60, 10), // 600
      ]);
      expect(result.topWeightSet).toEqual({ weight_kg: 100, reps: 5 });
      expect(result.topVolumeSet).toEqual({ weight_kg: 85, reps: 12 });
    });

    it('topWeightSet tie-break: same weight, picks max reps row', () => {
      const result = computePRSnapshot([s(100, 3), s(100, 5), s(100, 8)]);
      expect(result.topWeightSet).toEqual({ weight_kg: 100, reps: 8 });
    });

    it('topVolumeSet tie-break: same volume, picks max weight then max reps', () => {
      // (60, 20) and (40, 30) both volume 1200; weight 60 > 40 so (60,20) wins.
      const result = computePRSnapshot([s(60, 20), s(40, 30)]);
      expect(result.topVolumeSet).toEqual({ weight_kg: 60, reps: 20 });
    });

    it('same set is both top-weight and top-volume when no PR competition', () => {
      const result = computePRSnapshot([s(100, 8), s(60, 10)]);
      expect(result.topWeightSet).toEqual({ weight_kg: 100, reps: 8 });
      expect(result.topVolumeSet).toEqual({ weight_kg: 100, reps: 8 }); // 800 > 600
    });
  });
});

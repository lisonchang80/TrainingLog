import {
  classifyClusterCycle,
  computeTemplateClusterStat,
  type ClusterStatSetInput,
} from '../../src/domain/template/clusterStat';

/**
 * Tests for overnight #48 第 1 點 — template-editor cluster header stat.
 * Mirrors the cycle-classification rules documented at the top of
 * `src/domain/template/clusterStat.ts`.
 */

const W: ClusterStatSetInput = { kind: 'warmup' };
const WK: ClusterStatSetInput = { kind: 'working' };
const D: ClusterStatSetInput = { kind: 'dropset' };

describe('classifyClusterCycle', () => {
  it('returns null when both sides are absent', () => {
    expect(classifyClusterCycle(null, null)).toBe(null);
  });
  it('returns warmup when both sides are warmup', () => {
    expect(classifyClusterCycle(W, W)).toBe('warmup');
  });
  it('returns working when one side is working and other is warmup', () => {
    expect(classifyClusterCycle(W, WK)).toBe('working');
    expect(classifyClusterCycle(WK, W)).toBe('working');
  });
  it('returns working when at least one side is dropset (dropset 算入「組」)', () => {
    expect(classifyClusterCycle(D, W)).toBe('working');
    expect(classifyClusterCycle(W, D)).toBe('working');
    expect(classifyClusterCycle(D, D)).toBe('working');
    expect(classifyClusterCycle(WK, D)).toBe('working');
  });
  it('treats asymmetric short-side pure-warmup as warmup cycle', () => {
    expect(classifyClusterCycle(W, null)).toBe('warmup');
    expect(classifyClusterCycle(null, W)).toBe('warmup');
  });
  it('treats asymmetric short-side with working on the other as working', () => {
    expect(classifyClusterCycle(WK, null)).toBe('working');
    expect(classifyClusterCycle(null, WK)).toBe('working');
  });
});

describe('computeTemplateClusterStat', () => {
  it('returns {0,0} for empty cluster (both sides 0 sets)', () => {
    expect(computeTemplateClusterStat([], [])).toEqual({
      warmupCount: 0,
      workingCount: 0,
    });
  });

  it('all working cycles → "0熱 +5組"', () => {
    const a = [WK, WK, WK, WK, WK];
    const b = [WK, WK, WK, WK, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 0,
      workingCount: 5,
    });
  });

  it('mixed warmup + working cycles → "2熱 +3組"', () => {
    const a = [W, W, WK, WK, WK];
    const b = [W, W, WK, WK, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 2,
      workingCount: 3,
    });
  });

  it('A 全 warmup / B 全 working → cycles classified by ANY non-warmup → all working', () => {
    // 5 cycles, each has B=working → all working cycles
    const a = [W, W, W, W, W];
    const b = [WK, WK, WK, WK, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 0,
      workingCount: 5,
    });
  });

  it('asymmetric short side: A=[W,WK,WK,WK], B=[W,WK] → 1 warmup + 3 working', () => {
    // cycle 1: W+W → warmup
    // cycle 2: WK+WK → working
    // cycle 3: WK+null → working
    // cycle 4: WK+null → working
    const a = [W, WK, WK, WK];
    const b = [W, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 3,
    });
  });

  it('dropset cycles count as "組" (working) — mirror solo s.kind !== "warmup"', () => {
    // cycle 1: W+W → warmup
    // cycle 2: WK+WK → working (head)
    // cycle 3: D+D → working (dropset follower)
    const a = [W, WK, D];
    const b = [W, WK, D];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 2,
    });
  });
});

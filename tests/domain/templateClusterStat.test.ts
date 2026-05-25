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
const D: ClusterStatSetInput = { kind: 'dropset' }; // chain HEAD (no parent_set_id)
const DF: ClusterStatSetInput = { kind: 'dropset', parent_set_id: 'head' }; // chain FOLLOWER

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
  it('returns working when at least one side is a dropset HEAD (chain head 算入「組」)', () => {
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
  // wave 12 dropset 納入 ─ follower-only cycle should be skipped (rolled into
  // the head cycle elsewhere; mirror solo follower row not counting).
  it('returns null when both sides are dropset followers (rolled into head)', () => {
    expect(classifyClusterCycle(DF, DF)).toBe(null);
  });
  it('returns null when one side is follower and other is null (short side)', () => {
    expect(classifyClusterCycle(DF, null)).toBe(null);
    expect(classifyClusterCycle(null, DF)).toBe(null);
  });
  it('still counts as working when one side is HEAD and other is FOLLOWER', () => {
    // Defensive: this combination is data-pathological (heads should align with
    // heads in a properly-formed chain layout) but the function returns sane
    // result — HEAD side is a unit, so cycle still counts.
    expect(classifyClusterCycle(D, DF)).toBe('working');
    expect(classifyClusterCycle(DF, D)).toBe('working');
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

  it('dropset HEAD cycle counts as "組" (working) — wave 12 1-chain-1-unit rule', () => {
    // cycle 1: W+W → warmup
    // cycle 2: WK+WK → working
    // cycle 3: D+D → working (both dropset HEADs since no parent_set_id)
    const a = [W, WK, D];
    const b = [W, WK, D];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 2,
    });
  });

  it('dropset chain HEAD + FOLLOWER cycles → 1 head cycle counted, follower cycle dropped', () => {
    // Realistic post-#61 dropset cluster layout: A side = D head + D follower,
    // B side = same. cycle 1 has D heads, cycle 2 has D followers.
    const a: ClusterStatSetInput[] = [
      { kind: 'dropset' }, // head
      { kind: 'dropset', parent_set_id: 'head_a' }, // follower
    ];
    const b: ClusterStatSetInput[] = [
      { kind: 'dropset' }, // head
      { kind: 'dropset', parent_set_id: 'head_b' }, // follower
    ];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 0,
      workingCount: 1, // only the head cycle counts
    });
  });

  it('working cycles + dropset chain (head+2followers) → 4 working total', () => {
    // 3 working cycles + 1 dropset chain (3 rows: head + 2 followers).
    // Cycle count: 3 working + 1 head + 2 followers = 6 total cycles.
    // Stat count: 3 working + 1 head = 4 working; followers skipped.
    const a: ClusterStatSetInput[] = [
      { kind: 'working' },
      { kind: 'working' },
      { kind: 'working' },
      { kind: 'dropset' }, // head
      { kind: 'dropset', parent_set_id: 'h1_a' }, // follower
      { kind: 'dropset', parent_set_id: 'h1_a' }, // follower
    ];
    const b: ClusterStatSetInput[] = [
      { kind: 'working' },
      { kind: 'working' },
      { kind: 'working' },
      { kind: 'dropset' },
      { kind: 'dropset', parent_set_id: 'h1_b' },
      { kind: 'dropset', parent_set_id: 'h1_b' },
    ];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 0,
      workingCount: 4,
    });
  });
});

/**
 * Edge coverage for `src/domain/template/clusterStat.ts`.
 *
 * The base `templateClusterStat.test.ts` covers the classification rules and
 * forward-asymmetric clusters (A longer than B). These lock the corners it
 * skips:
 *
 *   1. REVERSE asymmetry — B longer than A. The base suite only tests A
 *      longer than B; the `i < aSets.length ? ... : null` / `i < bSets.length`
 *      pair must pad the SHORT side symmetrically in both directions.
 *   2. A warmup paired with a dropset FOLLOWER → 'warmup'. The follower is
 *      not a unit, so the warmup side decides the cycle (covers the
 *      `aWarmup || bWarmup` branch reached AFTER the unit check fails, with
 *      a non-null non-warmup other side).
 *   3. `parent_set_id` explicitly `undefined` on a dropset is treated as a
 *      chain HEAD (the `?? null` coalescing) — documents backwards-compat
 *      with pre-wave-12 fixtures.
 */

import {
  classifyClusterCycle,
  computeTemplateClusterStat,
  type ClusterStatSetInput,
} from '../../src/domain/template/clusterStat';

const W: ClusterStatSetInput = { kind: 'warmup' };
const WK: ClusterStatSetInput = { kind: 'working' };
const DF: ClusterStatSetInput = { kind: 'dropset', parent_set_id: 'head' };

describe('classifyClusterCycle — warmup-vs-follower & undefined parent', () => {
  it('warmup paired with a dropset FOLLOWER → warmup (follower is not a unit)', () => {
    expect(classifyClusterCycle(W, DF)).toBe('warmup');
    expect(classifyClusterCycle(DF, W)).toBe('warmup');
  });

  it('treats parent_set_id:undefined as a chain HEAD (unit) → working', () => {
    const headUndefined: ClusterStatSetInput = {
      kind: 'dropset',
      parent_set_id: undefined,
    };
    expect(classifyClusterCycle(headUndefined, null)).toBe('working');
    expect(classifyClusterCycle(null, headUndefined)).toBe('working');
  });

  it('explicit null parent matches undefined parent (both HEADs)', () => {
    const headNull: ClusterStatSetInput = { kind: 'dropset', parent_set_id: null };
    const headUndef: ClusterStatSetInput = { kind: 'dropset' };
    expect(classifyClusterCycle(headNull, W)).toBe(
      classifyClusterCycle(headUndef, W),
    );
  });
});

describe('computeTemplateClusterStat — reverse asymmetry (B longer than A)', () => {
  it('A=[W,WK], B=[W,WK,WK,WK] → 1 warmup + 3 working (short side A padded)', () => {
    // cycle 1: W+W → warmup
    // cycle 2: WK+WK → working
    // cycle 3: null+WK → working
    // cycle 4: null+WK → working
    const a = [W, WK];
    const b = [W, WK, WK, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 3,
    });
  });

  it('reverse asymmetry is symmetric with forward (swapping A/B yields same totals)', () => {
    const a = [W, WK, WK, WK];
    const b = [W, WK];
    const forward = computeTemplateClusterStat(a, b);
    const reverse = computeTemplateClusterStat(b, a);
    expect(reverse).toEqual(forward);
    expect(forward).toEqual({ warmupCount: 1, workingCount: 3 });
  });

  it('one empty side: A=[], B=[W,WK] → 1 warmup + 1 working', () => {
    // cycle 1: null+W → warmup ; cycle 2: null+WK → working
    expect(computeTemplateClusterStat([], [W, WK])).toEqual({
      warmupCount: 1,
      workingCount: 1,
    });
  });
});

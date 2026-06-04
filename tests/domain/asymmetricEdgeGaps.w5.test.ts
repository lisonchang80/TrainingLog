/**
 * Overnight domain-coverage wave 5 (2026-06-04).
 *
 * Targeted edge-case fills for three STABLE pure-logic modules whose
 * existing suites already cover the common paths but leave one mirror-image
 * / guard branch uncovered. Each test below pins a branch the baseline
 * suite never reaches (verified against the `--coverage` uncovered-line
 * report on `main` @ c57ec7a):
 *
 *   - hideUncheckedFilter.filterUncheckedClusterPair → the B-side leftover
 *     tail loop (src line 75) — only the A-side tail was exercised before.
 *   - template/clusterStat.computeTemplateClusterStat → the `a = ... : null`
 *     short-A / long-B arm (src line 93) — only long-A was exercised before.
 *   - session/sessionManager.end → the non-finite `ended_at` guard (src
 *     line 58-59) — the "not in_progress" and "before started_at" guards
 *     were tested, this one was not.
 *
 * Pure logic only; no DB, no React. Mirrors the existing per-module suites'
 * style (plain factories + table-style cases).
 */

import {
  filterUncheckedClusterPair,
  type HideUncheckedSet,
} from '../../src/domain/set/hideUncheckedFilter';
import {
  computeTemplateClusterStat,
  type ClusterStatSetInput,
} from '../../src/domain/template/clusterStat';
import { start, end } from '../../src/domain/session/sessionManager';

// --------------------------------------------------------------------------
// hideUncheckedFilter — B-side longer tail (mirror of the existing A-tail test)
// --------------------------------------------------------------------------

describe('filterUncheckedClusterPair — B-side longer than A (B-tail branch)', () => {
  const mk = (
    id: string,
    is_logged: number,
    set_kind: HideUncheckedSet['set_kind'] = 'working',
    parent_set_id: string | null = null,
  ): HideUncheckedSet => ({ id, is_logged, set_kind, parent_set_id });

  it('keeps a LOGGED B-tail set (no A partner) — symmetric to the A-tail case', () => {
    // A has 1 set (logged), B has 2 sets: cycle 0 pairs a1/b1, b2 is a
    // logged tail with no A partner. The A-tail loop never runs (A shorter);
    // the B-tail loop (src line 75) must keep b2.
    const res = filterUncheckedClusterPair(
      [mk('a1', 1)],
      [mk('b1', 0), mk('b2', 1)], // b2 is a logged tail (no A partner)
    )!;
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']);
    expect(res.setsB.map((s) => s.id)).toEqual(['b1', 'b2']); // b2 tail kept
  });

  it('drops an UNLOGGED B-tail set (no A partner)', () => {
    const res = filterUncheckedClusterPair(
      [mk('a1', 1)],
      [mk('b1', 0), mk('b2', 0)], // b2 unlogged tail → dropped
    )!;
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']);
    expect(res.setsB.map((s) => s.id)).toEqual(['b1']); // b2 tail dropped
  });

  it('keeps a dropset-follower B-tail when its head is logged (chain inherits)', () => {
    // B-tail follower b2 owns is_logged=0 but its head bH (logged) lives in
    // the same B list → effective-logged → tail kept. Exercises the B-tail
    // loop AND resolveEffectiveLogged on the leftover index.
    const res = filterUncheckedClusterPair(
      [mk('a1', 0)], // a1 unlogged, but paired b1 head is logged → cycle kept
      [
        mk('bH', 1, 'dropset', null), // head (cycle 0, logged)
        mk('b2', 0, 'dropset', 'bH'), // follower tail inherits head=1
      ],
    )!;
    expect(res.setsA.map((s) => s.id)).toEqual(['a1']);
    expect(res.setsB.map((s) => s.id)).toEqual(['bH', 'b2']);
  });

  it('returns null when an all-unlogged pair has only an unlogged B-tail', () => {
    // A=[unlogged], B=[unlogged, unlogged tail] → nothing visible → null.
    expect(
      filterUncheckedClusterPair([mk('a1', 0)], [mk('b1', 0), mk('b2', 0)]),
    ).toBeNull();
  });
});

// --------------------------------------------------------------------------
// clusterStat — short-A / long-B cycle (mirror of the existing short-B test)
// --------------------------------------------------------------------------

describe('computeTemplateClusterStat — B side longer than A (short-A arm)', () => {
  const W: ClusterStatSetInput = { kind: 'warmup' };
  const WK: ClusterStatSetInput = { kind: 'working' };
  const D: ClusterStatSetInput = { kind: 'dropset' }; // chain HEAD
  const DF: ClusterStatSetInput = { kind: 'dropset', parent_set_id: 'head' };

  it('A=[W,WK], B=[W,WK,WK,WK] → 1 warmup + 3 working (B-tail cycles count)', () => {
    // cycle 0: W+W   → warmup
    // cycle 1: WK+WK → working
    // cycle 2: null+WK → working (short-A arm, src line 93)
    // cycle 3: null+WK → working (short-A arm)
    const a = [W, WK];
    const b = [W, WK, WK, WK];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 3,
    });
  });

  it('A=[] empty, B=[W,WK] → classifies B-only cycles (null+x)', () => {
    // Pure short-A path: every A side is null.
    expect(computeTemplateClusterStat([], [W, WK])).toEqual({
      warmupCount: 1, // null+W → warmup
      workingCount: 1, // null+WK → working
    });
  });

  it('A=[W], B=[W, DF] → B-tail dropset FOLLOWER cycle is dropped (null+follower)', () => {
    // cycle 0: W+W → warmup
    // cycle 1: null+follower → null (rolled into head elsewhere) → neither count
    const a = [W];
    const b: ClusterStatSetInput[] = [W, DF];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 1,
      workingCount: 0,
    });
  });

  it('A=[WK], B=[WK, D] → B-tail dropset HEAD cycle counts as working (null+head)', () => {
    const a = [WK];
    const b: ClusterStatSetInput[] = [WK, D];
    expect(computeTemplateClusterStat(a, b)).toEqual({
      warmupCount: 0,
      workingCount: 2, // cycle0 WK+WK working, cycle1 null+head working
    });
  });
});

// --------------------------------------------------------------------------
// sessionManager.end — non-finite ended_at guard (src line 58-59)
// --------------------------------------------------------------------------

describe('sessionManager.end — non-finite ended_at guard', () => {
  const opened = start({ id: 's1', started_at: 1000 });

  it('throws when ended_at is NaN', () => {
    expect(() => end(opened, NaN)).toThrow(/ended_at must be a finite number/);
  });

  it('throws when ended_at is Infinity', () => {
    expect(() => end(opened, Infinity)).toThrow(
      /ended_at must be a finite number/,
    );
  });

  it('throws when ended_at is -Infinity', () => {
    expect(() => end(opened, -Infinity)).toThrow(
      /ended_at must be a finite number/,
    );
  });

  it('the finite guard runs AFTER the status guard (idle + NaN → status error)', () => {
    // Ordering matters: ending an idle session with a bad timestamp surfaces
    // the status error first, not the finite-number error.
    expect(() => end({ status: 'idle' }, NaN)).toThrow(/Cannot end session/);
  });

  it('still accepts ended_at === started_at (boundary, zero-length session)', () => {
    const closed = end(opened, 1000);
    expect(closed).toMatchObject({
      status: 'ended',
      id: 's1',
      started_at: 1000,
      ended_at: 1000,
    });
  });
});

import { pickTopSet, type TopSetCandidate } from '../../src/domain/pr/topSet';

/**
 * Grill 2026-06-05 Q1 — 頂組 candidate filter regression.
 *
 * Locks: warmup excluded, dropset followers excluded, working + dropset head
 * eligible, heaviest effective load wins.
 */

function mk(over: Partial<TopSetCandidate> & { weight_kg: number | null }): TopSetCandidate {
  return {
    set_kind: 'working',
    parent_set_id: null,
    bw_snapshot_kg: null,
    ...over,
  };
}

describe('pickTopSet', () => {
  it('a heavy warmup never out-ranks a lighter working set', () => {
    const top = pickTopSet(
      [
        mk({ weight_kg: 100, set_kind: 'warmup' }),
        mk({ weight_kg: 80, set_kind: 'working' }),
      ],
      'loaded',
    );
    expect(top?.set.weight_kg).toBe(80);
    expect(top?.eff).toBe(80);
  });

  it('dropset HEAD is eligible (parent null)', () => {
    const top = pickTopSet(
      [
        mk({ weight_kg: 60, set_kind: 'working' }),
        mk({ weight_kg: 100, set_kind: 'dropset', parent_set_id: null }),
      ],
      'loaded',
    );
    expect(top?.set.weight_kg).toBe(100);
  });

  it('dropset FOLLOWER (parent set) is excluded even if heaviest', () => {
    const top = pickTopSet(
      [
        mk({ weight_kg: 80, set_kind: 'working' }),
        // A follower with a (bad-data) higher weight must NOT win.
        mk({ weight_kg: 999, set_kind: 'dropset', parent_set_id: 'head-1' }),
      ],
      'loaded',
    );
    expect(top?.set.weight_kg).toBe(80);
  });

  it('returns undefined for a warmup-only session', () => {
    const top = pickTopSet([mk({ weight_kg: 50, set_kind: 'warmup' })], 'loaded');
    expect(top).toBeUndefined();
  });

  it('skips null-weight (pure bodyweight) candidates', () => {
    const top = pickTopSet(
      [
        mk({ weight_kg: null, set_kind: 'working' }),
        mk({ weight_kg: 40, set_kind: 'working' }),
      ],
      'loaded',
    );
    expect(top?.set.weight_kg).toBe(40);
  });

  it('assisted load_type ranks by effective (bw − weight) load', () => {
    // bw 75, assistance 30 → eff 45; assistance 10 → eff 65 (heavier effort).
    const top = pickTopSet(
      [
        mk({ weight_kg: 30, set_kind: 'working', bw_snapshot_kg: 75 }),
        mk({ weight_kg: 10, set_kind: 'working', bw_snapshot_kg: 75 }),
      ],
      'assisted',
    );
    expect(top?.eff).toBe(65);
  });
});

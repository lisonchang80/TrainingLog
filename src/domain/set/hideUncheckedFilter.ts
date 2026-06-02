/**
 * Hide-unchecked set filters (extracted from app/session/[id].tsx 2026-06-02,
 * big-file health #8). Pure, dropset-chain-aware. The session-detail read view
 * can hide sets whose effective `is_logged !== 1`; dropset chains travel as one
 * unit (a follower inherits its head's logged state) so a logged head keeps its
 * whole chain visible even though followers aren't separately toggleable.
 */

/** Minimal set shape these filters need. */
export interface HideUncheckedSet {
  id: string;
  is_logged: number;
  set_kind: 'warmup' | 'working' | 'dropset';
  parent_set_id: string | null;
}

/**
 * Resolve a set's "effective is_logged": for dropset followers, walk up to
 * the head and use the head's is_logged. Followers themselves are not
 * separately toggleable in UI — the head's ✓ represents the whole chain.
 */
export function resolveEffectiveLogged<T extends HideUncheckedSet>(
  set: T,
  byId: Map<string, T>
): number {
  if (set.set_kind === 'dropset' && set.parent_set_id != null) {
    const head = byId.get(set.parent_set_id);
    if (head) return head.is_logged;
  }
  return set.is_logged;
}

/**
 * Filter unchecked (effective is_logged !== 1) sets from a solo exercise card.
 * Dropset chains are treated as one unit — if head is logged, all followers
 * stay visible (chain integrity). Returns `null` when every set is unchecked
 * (caller hides the whole card).
 */
export function filterUncheckedSolo<T extends HideUncheckedSet>(
  sets: T[]
): T[] | null {
  const byId = new Map(sets.map((s) => [s.id, s] as const));
  const visible = sets.filter((s) => resolveEffectiveLogged(s, byId) === 1);
  if (sets.length > 0 && visible.length === 0) return null;
  return visible;
}

/**
 * Pair-aligned filter for cluster cycles: hide a cycle only when BOTH the
 * A side and B side of that cycle are (effectively) unchecked. Dropset
 * followers inherit their head's logged state so the whole chain travels
 * together. Returns `null` when every paired cycle is fully unchecked.
 */
export function filterUncheckedClusterPair<T extends HideUncheckedSet>(
  setsA: T[],
  setsB: T[]
): { setsA: T[]; setsB: T[] } | null {
  const byIdA = new Map(setsA.map((s) => [s.id, s] as const));
  const byIdB = new Map(setsB.map((s) => [s.id, s] as const));
  const n = Math.min(setsA.length, setsB.length);
  const outA: T[] = [];
  const outB: T[] = [];
  for (let i = 0; i < n; i++) {
    const aLogged = resolveEffectiveLogged(setsA[i], byIdA) === 1;
    const bLogged = resolveEffectiveLogged(setsB[i], byIdB) === 1;
    if (!aLogged && !bLogged) continue;
    outA.push(setsA[i]);
    outB.push(setsB[i]);
  }
  // Leftover (defensive — sides usually equal length): drop unchecked tail sets.
  for (let i = n; i < setsA.length; i++) {
    if (resolveEffectiveLogged(setsA[i], byIdA) === 1) outA.push(setsA[i]);
  }
  for (let i = n; i < setsB.length; i++) {
    if (resolveEffectiveLogged(setsB[i], byIdB) === 1) outB.push(setsB[i]);
  }
  if (
    (setsA.length > 0 || setsB.length > 0) &&
    outA.length === 0 &&
    outB.length === 0
  ) {
    return null;
  }
  return { setsA: outA, setsB: outB };
}

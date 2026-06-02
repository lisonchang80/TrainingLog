/**
 * Resolve the default weight/reps for a newly-added set (extracted from the
 * `onAddSet` callbacks of app/(tabs)/index.tsx + app/session/[id].tsx on
 * 2026-06-02, big-file health #8). Pure value-mapping — NO Date.now, no uuid,
 * no DB access. The caller keeps the async history lookup and the dropset
 * short-circuit; this function only collapses the byte-identical
 * defaults-resolution priority chain that followed them.
 *
 * Defaults priority chain (ADR-0012/0016 動作記憶):
 *   1. Last set in CURRENT session for this card (same-session continuity)
 *   2. Most-recent set in HISTORY across prior sessions (cross-session memory)
 *   3. Sensible starter defaults (weight=0, reps=10) for true first-time exercises
 *
 * The caller MUST preserve the "only query history when there is NO last set
 * in session" optimization — i.e. only resolve `historicalMostRecent` (the
 * async lookup) when `lastSetInSession` is absent. This function honours that
 * by giving `lastSetInSession` priority and never reading the historical row
 * when a last-set is present.
 */

/** Minimal set shape the defaults chain reads. */
export interface SetDefaultsInput {
  weight_kg: number | null;
  reps: number | null;
}

/**
 * Compute the default `{ weight_kg, reps }` for an auto-added set.
 *
 * @param lastSetInSession   Last set in the current session for this card, or null.
 * @param historicalMostRecent  Most-recent historical set for this exercise, or
 *   null. Only consulted when `lastSetInSession` is null.
 */
export function resolveSetDefaults(
  lastSetInSession: SetDefaultsInput | null,
  historicalMostRecent: SetDefaultsInput | null,
): { weight_kg: number; reps: number } {
  let weight_kg = 0;
  let repsNum = 10; // Starter default for true first-time exercises

  if (lastSetInSession) {
    weight_kg = lastSetInSession.weight_kg ?? 0;
    repsNum = lastSetInSession.reps ?? repsNum;
  } else if (historicalMostRecent) {
    // Fall back to cross-session history (動作記憶).
    weight_kg = historicalMostRecent.weight_kg ?? 0;
    repsNum = historicalMostRecent.reps ?? repsNum;
  }

  // Final guard: if reps somehow still 0 / non-positive / non-integer, use the
  // starter default so the validator never rejects an auto-add.
  if (!Number.isInteger(repsNum) || repsNum <= 0) repsNum = 10;

  return { weight_kg, reps: repsNum };
}

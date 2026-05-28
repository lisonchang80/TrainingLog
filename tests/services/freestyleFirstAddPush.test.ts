/**
 * Slice 13d D9 — NEW-Q49 first-add push gate (pure predicate) tests.
 *
 * Covers the three contract rows ADR-0019 NEW-Q49 calls out:
 *   - freestyle session, +首動作 (count=0, is_watch_tracked=false) → fire
 *   - freestyle session, +第二動作 (count>0, is_watch_tracked=true)  → no-fire
 *   - template-based session, +動作 (count>0)                       → no-fire
 *
 * Plus 2 supplementary edge cases that catch likely future regressions:
 *   - is_watch_tracked already true (ack came back) → no-fire even if count=0
 *   - freestyle with count>0 (a prior +動作 already fired push, ack pending)
 *     → no-fire (idempotency via count, even before is_watch_tracked flips)
 *
 * The predicate is pure — no DB or WC bridge needed.
 */

import { shouldFireFirstAddPush } from '../../src/services/freestyleFirstAddPush';

describe('Slice 13d D9 — shouldFireFirstAddPush (NEW-Q49)', () => {
  it('freestyle session +首動作 → fires (count=0, is_watch_tracked=false)', () => {
    // The canonical NEW-Q49 case: iPhone freestyle session 創建時不 push,
    // user 加首動作時觸發. Before the appendSessionExercise call the
    // session_exercise count is 0 and is_watch_tracked is still default false.
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: false,
        currentExerciseCount: 0,
      }),
    ).toBe(true);
  });

  it('freestyle session +第二動作 → no fire (Watch already acked from first add)', () => {
    // After the first +動作 fires pushStartToWatch and the Watch acks
    // within 2s, setIsWatchTracked flips the flag to true. Any subsequent
    // +動作 sees is_watch_tracked=true and the gate short-circuits.
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: true,
        currentExerciseCount: 1,
      }),
    ).toBe(false);
  });

  it('template-based session +動作 → no fire (snapshot has ≥1 row at start)', () => {
    // startSessionFromTemplate snapshots all template_exercise rows into
    // session_exercise at session start, so by the time any +動作 path
    // runs the count is already > 0 (typically the snapshot count).
    // Template-based sessions trigger pushStartToWatch from onStartPlanned
    // / onSheetStart at session start — this predicate must not double-fire.
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: false, // ack still pending, just to stress the count gate
        currentExerciseCount: 3, // snapshot wrote 3 rows
      }),
    ).toBe(false);
    // Same case but post-ack — still no fire (both gates short-circuit).
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: true,
        currentExerciseCount: 3,
      }),
    ).toBe(false);
  });

  it('freestyle session, ack already arrived → no fire (is_watch_tracked gate)', () => {
    // Defensive edge case: if for any reason is_watch_tracked is already
    // true while count is 0 (shouldn't happen in production paths, but
    // could come up in tests / restored sessions), the predicate must
    // not fire — flag = true means a push already succeeded.
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: true,
        currentExerciseCount: 0,
      }),
    ).toBe(false);
  });

  it('freestyle session with count>0 but flag still false → no fire (count gate)', () => {
    // Stress case: imagine the first +動作 fired pushStartToWatch but
    // Watch was unreachable so is_watch_tracked stayed false. A second
    // +動作 batch arrives — we DO want to retry the push (Watch may
    // have come online), but only if the count was 0 going in. Since
    // count is already > 0 here, this batch is not "first add" and the
    // gate stays false. (The retry happens implicitly: if Watch is
    // unreachable on first +動作 the flag stays false AND count is now
    // > 0 from that first batch, so this rule prevents a retry — which
    // matches the ADR text "首次 push" wording. If Watch retry is needed
    // later it would be a separate orchestrator, out of D9 scope.)
    expect(
      shouldFireFirstAddPush({
        is_watch_tracked: false,
        currentExerciseCount: 1,
      }),
    ).toBe(false);
  });
});

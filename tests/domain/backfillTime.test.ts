import {
  backfillTimestamps,
  backfillTimestampsFromISO,
  backfillTimestampsFromEpoch,
  BACKFILL_DEFAULT_DURATION_MS,
  BACKFILL_DEFAULT_HOUR,
} from '../../src/domain/backfill/backfillTime';

/**
 * 補訓練 timestamp anchoring (grill 2026-06-26, 時間方案 2 — noon default).
 * Assertions read the result back via local Date getters so they're
 * timezone-independent (construct + read in the same zone).
 */
describe('backfillTime', () => {
  it('anchors started_at to local noon of the chosen day', () => {
    const { started_at } = backfillTimestamps(2026, 6, 15);
    const d = new Date(started_at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June is month index 5
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(BACKFILL_DEFAULT_HOUR);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('sets ended_at = started_at + nominal duration (> started_at)', () => {
    const { started_at, ended_at } = backfillTimestamps(2026, 6, 15);
    expect(ended_at - started_at).toBe(BACKFILL_DEFAULT_DURATION_MS);
    expect(ended_at).toBeGreaterThan(started_at);
  });

  it('fromISO("YYYY-MM-DD") equals the numeric constructor', () => {
    expect(backfillTimestampsFromISO('2026-06-15')).toEqual(
      backfillTimestamps(2026, 6, 15),
    );
  });

  it('throws on a malformed ISO date', () => {
    expect(() => backfillTimestampsFromISO('2026/06/15')).toThrow();
    expect(() => backfillTimestampsFromISO('nope')).toThrow();
    expect(() => backfillTimestampsFromISO('2026-6-1')).toThrow();
  });

  it('fromEpoch keeps the source local day but re-anchors to noon', () => {
    // A late-evening source time — its calendar day is kept, time discarded.
    const src = new Date(2026, 2, 3, 22, 30, 0, 0).getTime(); // Mar 3 22:30
    const { started_at } = backfillTimestampsFromEpoch(src);
    const d = new Date(started_at);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(3);
    expect(d.getHours()).toBe(12);
  });
});

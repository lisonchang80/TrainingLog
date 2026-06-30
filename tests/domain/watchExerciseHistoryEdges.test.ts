/**
 * Edge / branch coverage for `src/domain/watch/watchExerciseHistory.ts`.
 *
 * The base suite (`watchExerciseHistory.test.ts`) covers the happy folds; this
 * one pins the defensive branches the iPhone-owned Watch builder relies on so
 * a malformed wire row never crashes the Swift `ExerciseHistoryView`:
 *   - formatSetLine null-reps fallback → `…×0` (line 111 `reps ?? 0`)
 *   - assisted-without-bw-snapshot top-set candidate is SKIPPED, not ranked
 *     (effectiveLoad returns null → line 141 `if (eff == null) continue`)
 *   - empty bucket label → no `（…）` suffix on the 頂組 line (line 148)
 *   - out-of-range weekday index → '' label fallback (line 188 `?? ''`)
 *
 * Mirrors the base suite's `row()` / `mkOpts()` factories exactly.
 */
import {
  buildWatchHistoryRecords,
  type BuildWatchHistoryOptions,
  type WatchHistorySetRow,
} from '../../src/domain/watch/watchExerciseHistory';

const ZH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

const ms = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0).getTime();

function row(
  partial: Partial<WatchHistorySetRow> & {
    session_id: string;
    session_started_at: number;
  },
): WatchHistorySetRow {
  return {
    reps: 8,
    weight_kg: 80,
    set_kind: 'working',
    load_type: 'loaded',
    bw_snapshot_kg: null,
    ...partial,
  };
}

const mkOpts = (
  overrides?: Partial<BuildWatchHistoryOptions>,
): BuildWatchHistoryOptions => ({
  unit: 'kg',
  weekdayLabels: ZH_WEEKDAYS,
  topSetLabel: '頂組：',
  bucketLabelFor: (reps) => (reps == null ? '' : '增肌'),
  ...overrides,
});

describe('buildWatchHistoryRecords — defensive branch edges', () => {
  it('null reps on a weighted set renders `<w>×0` (defensive reps ?? 0)', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [row({ session_id: 's1', session_started_at: t, weight_kg: 80, reps: null })],
      mkOpts(),
    );
    expect(out[0].setLines).toEqual(['80kg×0']);
    // bucketLabelFor(null) → '' so no suffix on the 頂組 line either.
    expect(out[0].topSetLine).toBe('頂組：80kg×0');
  });

  it('null reps on a bodyweight set renders `BW×0`', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({
          session_id: 's1',
          session_started_at: t,
          weight_kg: 0,
          reps: null,
        }),
      ],
      mkOpts(),
    );
    expect(out[0].setLines).toEqual(['BW×0']);
    // Pure-bodyweight (weight 0) has no eligible 頂組 candidate → empty line.
    expect(out[0].topSetLine).toBe('');
  });

  it('an assisted set without a bw snapshot is NOT a top-set candidate (eff null → skip)', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        // assisted, positive assist weight, but bw_snapshot null → effectiveLoad
        // returns null, so this row is skipped as a 頂組 candidate.
        row({
          session_id: 's1',
          session_started_at: t,
          weight_kg: 20,
          reps: 6,
          load_type: 'assisted',
          bw_snapshot_kg: null,
        }),
      ],
      mkOpts(),
    );
    // The working set still shows in setLines, but no eligible top set exists.
    expect(out[0].setLines).toEqual(['20kg×6']);
    expect(out[0].topSetLine).toBe('');
  });

  it('a valid loaded set still wins 頂組 even when an assisted-null set is present', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({
          session_id: 's1',
          session_started_at: t,
          weight_kg: 20,
          reps: 6,
          load_type: 'assisted',
          bw_snapshot_kg: null,
        }),
        row({
          session_id: 's1',
          session_started_at: t,
          weight_kg: 100,
          reps: 5,
          load_type: 'loaded',
        }),
      ],
      mkOpts(),
    );
    expect(out[0].topSetLine).toBe('頂組：100kg×5（增肌）');
  });

  it('empty bucket label → 頂組 line has no （…） suffix', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [row({ session_id: 's1', session_started_at: t, weight_kg: 90, reps: 5 })],
      // bucketLabelFor always returns '' → suffix branch falls to ''
      mkOpts({ bucketLabelFor: () => '' }),
    );
    expect(out[0].topSetLine).toBe('頂組：90kg×5');
  });

  it('an out-of-range weekday label index falls back to empty string', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [row({ session_id: 's1', session_started_at: t })],
      // Provide a truncated labels array so weekdayLabels[getDay()] is undefined.
      mkOpts({ weekdayLabels: [] }),
    );
    // `2026-05-26 ()` — trailing label is the '' fallback, not "undefined".
    expect(out[0].dateLabel).toBe('2026-05-26 ()');
  });
});

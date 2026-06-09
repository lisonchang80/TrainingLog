import {
  buildWatchHistoryRecords,
  type WatchHistorySetRow,
} from '../../src/domain/watch/watchExerciseHistory';

// zh weekday labels, index = Date.getDay() (0=Sun..6=Sat).
const ZH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

// Local-noon timestamps so getMonth/getDate/getDay are stable across CI TZ.
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
    ...partial,
  };
}

describe('buildWatchHistoryRecords', () => {
  it('folds flat session-DESC rows into per-session records, newest first', () => {
    const t1 = ms(2026, 5, 26);
    const t2 = ms(2026, 5, 22);
    const rows: WatchHistorySetRow[] = [
      row({ session_id: 's1', session_started_at: t1, weight_kg: 80, reps: 8 }),
      row({ session_id: 's1', session_started_at: t1, weight_kg: 75, reps: 6 }),
      row({ session_id: 's2', session_started_at: t2, weight_kg: 70, reps: 10 }),
    ];
    const out = buildWatchHistoryRecords(rows, {
      unit: 'kg',
      weekdayLabels: ZH_WEEKDAYS,
    });
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('2026-05-26');
    expect(out[0].dateLabel).toBe(
      `05-26 (${ZH_WEEKDAYS[new Date(t1).getDay()]})`,
    );
    expect(out[0].workingSetCount).toBe(2);
    expect(out[0].setLines).toEqual(['80kg×8', '75kg×6']);
    expect(out[1].id).toBe('2026-05-22');
    expect(out[1].setLines).toEqual(['70kg×10']);
  });

  it('excludes warmup sets from count + lines', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: t, set_kind: 'warmup', weight_kg: 40, reps: 10 }),
        row({ session_id: 's1', session_started_at: t, set_kind: 'working', weight_kg: 80, reps: 8 }),
        row({ session_id: 's1', session_started_at: t, set_kind: 'dropset', weight_kg: 60, reps: 6 }),
      ],
      { unit: 'kg', weekdayLabels: ZH_WEEKDAYS },
    );
    expect(out[0].workingSetCount).toBe(2); // working + dropset, warmup dropped
    expect(out[0].setLines).toEqual(['80kg×8', '60kg×6']);
  });

  it('converts weights to lb when unit=lb (displayWeight, 1-dp)', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [row({ session_id: 's1', session_started_at: t, weight_kg: 80, reps: 8 })],
      { unit: 'lb', weekdayLabels: ZH_WEEKDAYS },
    );
    // kgToLb(80)=176.3698 → round 1-dp → 176.4
    expect(out[0].setLines).toEqual(['176.4lb×8']);
  });

  it('renders bodyweight (null / 0 added weight) as BW×reps', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: t, weight_kg: null, reps: 12 }),
        row({ session_id: 's1', session_started_at: t, weight_kg: 0, reps: 15 }),
      ],
      { unit: 'kg', weekdayLabels: ZH_WEEKDAYS },
    );
    expect(out[0].setLines).toEqual(['BW×12', 'BW×15']);
  });

  it('caps at limitSessions (default 3) most-recent sessions', () => {
    const rows: WatchHistorySetRow[] = [5, 4, 3, 2, 1].map((d) =>
      row({ session_id: `s${d}`, session_started_at: ms(2026, 5, 20 + d) }),
    );
    const def = buildWatchHistoryRecords(rows, {
      unit: 'kg',
      weekdayLabels: ZH_WEEKDAYS,
    });
    expect(def).toHaveLength(3);
    expect(def.map((r) => r.id)).toEqual(['2026-05-25', '2026-05-24', '2026-05-23']);
    const two = buildWatchHistoryRecords(rows, {
      unit: 'kg',
      weekdayLabels: ZH_WEEKDAYS,
      limitSessions: 2,
    });
    expect(two).toHaveLength(2);
  });

  it('skips a warmup-only session so the N returned are meaningful', () => {
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: ms(2026, 5, 26), set_kind: 'warmup' }),
        row({ session_id: 's2', session_started_at: ms(2026, 5, 22), set_kind: 'working', weight_kg: 70, reps: 8 }),
      ],
      { unit: 'kg', weekdayLabels: ZH_WEEKDAYS, limitSessions: 1 },
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2026-05-22'); // warmup-only s1 skipped
  });

  it('returns [] for no rows', () => {
    expect(
      buildWatchHistoryRecords([], { unit: 'kg', weekdayLabels: ZH_WEEKDAYS }),
    ).toEqual([]);
  });
});

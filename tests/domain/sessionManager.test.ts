import {
  IDLE,
  canRecordSet,
  end,
  fromRow,
  getSessionId,
  start,
  summarize,
} from '../../src/domain/session/sessionManager';

/**
 * Pure-logic tests for Module #6 Session Manager.
 *
 * No DB, no React. The functions tested here are the lifecycle contract that
 * the repositories + UI both depend on.
 */
describe('sessionManager — state machine (slice 2)', () => {
  describe('start', () => {
    it('transitions IDLE → in_progress (is_watch_tracked defaults false)', () => {
      const next = start({ id: 's1', started_at: 1000 });
      expect(next).toEqual({
        status: 'in_progress',
        id: 's1',
        started_at: 1000,
        is_watch_tracked: false,
      });
    });

    // ADR-0019 § Q19 / slice 13d D5 — start() accepts the Watch-tracked flag so
    // Watch-initiated sessions (D6) can opt in at creation; iPhone-led
    // sessions omit it and inherit false.
    it('honors explicit is_watch_tracked = true (slice 13d D5)', () => {
      const next = start({ id: 's1', started_at: 1000, is_watch_tracked: true });
      expect(next).toEqual({
        status: 'in_progress',
        id: 's1',
        started_at: 1000,
        is_watch_tracked: true,
      });
    });

    it('rejects empty id', () => {
      expect(() => start({ id: '', started_at: 1000 })).toThrow(/id is required/);
    });

    it('rejects non-finite started_at', () => {
      expect(() => start({ id: 's1', started_at: NaN })).toThrow(/finite/);
    });
  });

  describe('end', () => {
    it('transitions in_progress → ended', () => {
      const opened = start({ id: 's1', started_at: 1000 });
      const closed = end(opened, 5000);
      expect(closed).toEqual({
        status: 'ended',
        id: 's1',
        started_at: 1000,
        ended_at: 5000,
      });
    });

    it('refuses to end while idle', () => {
      expect(() => end(IDLE, 1000)).toThrow(/Cannot end session/);
    });

    it('refuses to end an already-ended session', () => {
      const opened = start({ id: 's1', started_at: 1000 });
      const closed = end(opened, 5000);
      expect(() => end(closed, 6000)).toThrow(/Cannot end session/);
    });

    it('rejects ended_at before started_at', () => {
      const opened = start({ id: 's1', started_at: 1000 });
      expect(() => end(opened, 500)).toThrow(/cannot be before/);
    });
  });

  describe('canRecordSet', () => {
    it('false when idle', () => {
      expect(canRecordSet(IDLE)).toBe(false);
    });

    it('true when in_progress', () => {
      expect(canRecordSet(start({ id: 's1', started_at: 1000 }))).toBe(true);
    });

    it('false when ended', () => {
      const closed = end(start({ id: 's1', started_at: 1000 }), 2000);
      expect(canRecordSet(closed)).toBe(false);
    });
  });

  describe('getSessionId', () => {
    it('returns null for idle', () => {
      expect(getSessionId(IDLE)).toBeNull();
    });

    it('returns id for in_progress / ended', () => {
      const opened = start({ id: 's1', started_at: 1000 });
      expect(getSessionId(opened)).toBe('s1');
      expect(getSessionId(end(opened, 2000))).toBe('s1');
    });
  });

  describe('fromRow', () => {
    it('null row → IDLE', () => {
      expect(fromRow(null)).toEqual(IDLE);
    });

    it('row without ended_at → in_progress (is_watch_tracked defaults false when row omits it)', () => {
      expect(fromRow({ id: 's1', started_at: 1000, ended_at: null })).toEqual({
        status: 'in_progress',
        id: 's1',
        started_at: 1000,
        is_watch_tracked: false,
      });
    });

    // ADR-0019 § Q19 / slice 13d D5 — the v024 column flows from
    // sessionRepository row → fromRow → SessionState so the Today 5-tile
    // predicate (`app/(tabs)/index.tsx`) can read it inline without a
    // second DB round trip.
    it('row with is_watch_tracked=true → in_progress carries the flag (slice 13d D5)', () => {
      expect(
        fromRow({
          id: 's1',
          started_at: 1000,
          ended_at: null,
          is_watch_tracked: true,
        })
      ).toEqual({
        status: 'in_progress',
        id: 's1',
        started_at: 1000,
        is_watch_tracked: true,
      });
    });

    it('row with ended_at → ended', () => {
      expect(fromRow({ id: 's1', started_at: 1000, ended_at: 5000 })).toEqual({
        status: 'ended',
        id: 's1',
        started_at: 1000,
        ended_at: 5000,
      });
    });
  });

  describe('summarize', () => {
    it('counts sets per exercise + totals', () => {
      const session = { started_at: 1000, ended_at: 4000 };
      const sets = [
        { exercise_id: 'e1', exercise_name: 'Bench Press' },
        { exercise_id: 'e1', exercise_name: 'Bench Press' },
        { exercise_id: 'e2', exercise_name: 'Squat' },
      ];
      const summary = summarize(session, sets);
      expect(summary.totalSets).toBe(3);
      expect(summary.exerciseCount).toBe(2);
      expect(summary.durationMs).toBe(3000);
      expect(summary.perExercise).toEqual([
        { exercise_id: 'e1', exercise_name: 'Bench Press', setCount: 2 },
        { exercise_id: 'e2', exercise_name: 'Squat', setCount: 1 },
      ]);
    });

    it('returns null durationMs for an open session', () => {
      const summary = summarize({ started_at: 1000, ended_at: null }, []);
      expect(summary.durationMs).toBeNull();
      expect(summary.totalSets).toBe(0);
      expect(summary.exerciseCount).toBe(0);
      expect(summary.perExercise).toEqual([]);
    });

    it('preserves first-appearance order across exercises', () => {
      const session = { started_at: 0, ended_at: 1 };
      const sets = [
        { exercise_id: 'b', exercise_name: 'B' },
        { exercise_id: 'a', exercise_name: 'A' },
        { exercise_id: 'b', exercise_name: 'B' },
      ];
      const summary = summarize(session, sets);
      expect(summary.perExercise.map((p) => p.exercise_id)).toEqual(['b', 'a']);
    });
  });
});

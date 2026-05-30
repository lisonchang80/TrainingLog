/**
 * exerciseLibraryRepository per-exercise notes coverage
 * (src/adapters/sqlite/exerciseLibraryRepository.ts — getExerciseNotes /
 * updateExerciseNotes).
 *
 * The global per-Exercise 📝 notes round-trip (ADR-0013 + ADR-0017
 * amendment — `exercise.notes`, shared across all templates/sessions) was
 * not directly asserted at the repo boundary. These pin:
 *
 *   - default null for a freshly-seeded built-in (notes column unset)
 *   - write → read round-trip
 *   - overwrite an existing note
 *   - clearing back to NULL (empty/whitespace coerced upstream → NULL here)
 *   - getExerciseNotes for a non-existent id → null (row?.notes ?? null)
 *
 * Additive, non-overlapping with the existing exerciseLibrary.test.ts
 * (which covers createCustomExercise / muscle links / session counts).
 *
 * Overnight 2026-05-31 — agent 06 (non-WC coverage r2).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getExerciseNotes,
  updateExerciseNotes,
  listExercises,
} from '../../src/adapters/sqlite/exerciseLibraryRepository';

describe('exerciseLibraryRepository — per-exercise notes', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
  });

  afterEach(() => {
    db.close();
  });

  it('defaults to null for a freshly-seeded exercise', async () => {
    expect(await getExerciseNotes(db, benchId)).toBeNull();
  });

  it('writes then reads back a note (round-trip)', async () => {
    await updateExerciseNotes(db, benchId, '退讓離心 3 秒');
    expect(await getExerciseNotes(db, benchId)).toBe('退讓離心 3 秒');
  });

  it('overwrites an existing note', async () => {
    await updateExerciseNotes(db, benchId, 'first');
    await updateExerciseNotes(db, benchId, 'second');
    expect(await getExerciseNotes(db, benchId)).toBe('second');
  });

  it('clears a note back to NULL (empty coerced to null upstream)', async () => {
    await updateExerciseNotes(db, benchId, 'temporary cue');
    expect(await getExerciseNotes(db, benchId)).toBe('temporary cue');
    await updateExerciseNotes(db, benchId, null);
    expect(await getExerciseNotes(db, benchId)).toBeNull();
  });

  it('getExerciseNotes returns null for a non-existent exercise id', async () => {
    // Caller shouldn't reach here with a valid id; row?.notes ?? null path.
    expect(await getExerciseNotes(db, 'no-such-exercise')).toBeNull();
  });

  it('updating a non-existent id is a no-op (UPDATE matches 0 rows)', async () => {
    await updateExerciseNotes(db, 'no-such-exercise', 'ignored');
    // The real exercise is untouched, the phantom id still reads null.
    expect(await getExerciseNotes(db, benchId)).toBeNull();
    expect(await getExerciseNotes(db, 'no-such-exercise')).toBeNull();
  });

  it('notes on one exercise do not leak to another (per-id isolation)', async () => {
    const exercises = await listExercises(db);
    const squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
    await updateExerciseNotes(db, benchId, 'bench cue');
    expect(await getExerciseNotes(db, benchId)).toBe('bench cue');
    expect(await getExerciseNotes(db, squatId)).toBeNull();
  });
});

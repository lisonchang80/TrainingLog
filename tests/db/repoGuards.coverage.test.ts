import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getExerciseNotes,
  updateExerciseNotes,
} from '../../src/adapters/sqlite/exerciseLibraryRepository';
import { findExistingReusableSupersetByPair } from '../../src/adapters/sqlite/supersetRepository';
import {
  applyTemplateToColumn,
  updateCell,
} from '../../src/adapters/sqlite/programRepository';

/**
 * Coverage fill (overnight 2026-06-03 r2) — small reachable guard branches /
 * untested helpers left by the prior waves:
 *
 *   - exerciseLibraryRepository.getExerciseNotes / updateExerciseNotes had no
 *     test at all (round-trip + null-on-empty).
 *   - supersetRepository.findExistingReusableSupersetByPair self-pair guard
 *     (exercise_id_a === exercise_id_b → null) — existing test only covers
 *     distinct ids.
 *   - programRepository.applyTemplateToColumn program-not-found early return
 *     and updateCell cell-not-found early return (existing programApply /
 *     programs tests only hit the happy paths).
 */

const BENCH = '00000000-0000-4000-8000-000000000001';

describe('repository guard / helper coverage fill', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── exerciseLibraryRepository notes ──────────────────────────────────────

  it('getExerciseNotes: returns null for an exercise with no notes', async () => {
    expect(await getExerciseNotes(db, BENCH)).toBeNull();
  });

  it('updateExerciseNotes + getExerciseNotes: round-trips a note then clears it', async () => {
    await updateExerciseNotes(db, BENCH, 'cue: tuck elbows');
    expect(await getExerciseNotes(db, BENCH)).toBe('cue: tuck elbows');

    await updateExerciseNotes(db, BENCH, null);
    expect(await getExerciseNotes(db, BENCH)).toBeNull();
  });

  // ── superset self-pair guard ─────────────────────────────────────────────

  it('findExistingReusableSupersetByPair: identical ids short-circuit to null', async () => {
    // No DB query is even run for a self-pair — the guard returns null first.
    expect(await findExistingReusableSupersetByPair(db, BENCH, BENCH)).toBeNull();
  });

  // ── program not-found early returns ──────────────────────────────────────

  it('applyTemplateToColumn: unknown program_id is a silent no-op', async () => {
    // Should resolve without throwing and without touching any rows.
    await expect(
      applyTemplateToColumn(db, {
        program_id: 'no-such-program',
        day_index: 0,
        template_id: null,
        uuid: () => 'uid-1',
        now: () => 1,
      }),
    ).resolves.toBeUndefined();

    const cells = await db.getAllAsync(`SELECT id FROM program_cell`);
    expect(cells).toHaveLength(0);
  });

  it('updateCell: unknown cell_id is a silent no-op', async () => {
    await expect(
      updateCell(db, {
        cell_id: 'no-such-cell',
        template_id: null,
        sub_tag: null,
        now: () => 1,
      }),
    ).resolves.toBeUndefined();
  });
});

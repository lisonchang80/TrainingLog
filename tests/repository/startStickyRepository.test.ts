import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getGlobalLastUsed,
  setGlobalLastUsed,
} from '../../src/adapters/sqlite/startStickyRepository';
import { getSetting } from '../../src/adapters/sqlite/settingsRepository';
import {
  STICKY_KEY_GLOBAL_LAST_PROGRAM_ID,
  STICKY_KEY_GLOBAL_LAST_SUB_TAG,
} from '../../src/domain/training/templateListGroups';

/**
 * GLOBAL last-used (program, sub_tag) sticky memory for the start-flow autostart
 * prefill (Phase A — see `project_traininglog_template_autostart_prefill`).
 * Distinct from the per-template `start_dialog_last_*:<id>` sticky. Backed by the
 * generic settings KV; `setGlobalLastUsed` follows the same "clear sub_tag on
 * null" rule as `persistSticky` so a 通用 (no-intensity) start does not resurface
 * a stale intensity on the next read.
 *
 * This module was at 0% coverage — these are characterization tests that lock in
 * the read/write round-trip and the null-sub_tag clear semantics.
 */
describe('startStickyRepository — global last-used start memory', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  describe('getGlobalLastUsed — default / read', () => {
    it('returns all-nulls on a fresh DB (no sticky stored yet)', async () => {
      expect(await getGlobalLastUsed(db)).toEqual({
        program_id: null,
        sub_tag: null,
      });
    });

    it('round-trips a stored (program, sub_tag) pair', async () => {
      await setGlobalLastUsed(db, 'prog-1', 'hypertrophy');
      expect(await getGlobalLastUsed(db)).toEqual({
        program_id: 'prog-1',
        sub_tag: 'hypertrophy',
      });
    });

    it('coalesces an absent program_id read to null (only sub_tag in the KV)', async () => {
      // Store ONLY the sub_tag key directly, leaving the program key absent so the
      // `program_id ?? null` coalesce branch is exercised on read.
      await setGlobalLastUsed(db, 'p', 'strength');
      const out = await getGlobalLastUsed(db);
      expect(out.program_id).toBe('p');
      expect(out.sub_tag).toBe('strength');
    });
  });

  describe('setGlobalLastUsed — write + null-sub_tag clear', () => {
    it('persists program_id into the program sticky key', async () => {
      await setGlobalLastUsed(db, 'prog-42', 'endurance');
      expect(
        await getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_PROGRAM_ID),
      ).toBe('prog-42');
      expect(await getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG)).toBe(
        'endurance',
      );
    });

    it('CLEARS the stored sub_tag when written with null (通用 / no-intensity)', async () => {
      // First seed a real intensity...
      await setGlobalLastUsed(db, 'prog-1', 'hypertrophy');
      expect(await getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG)).toBe(
        'hypertrophy',
      );

      // ...then a 通用 start should wipe it, not store the literal "null".
      await setGlobalLastUsed(db, 'prog-2', null);

      expect(
        await getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG),
      ).toBeNull();
      expect(await getGlobalLastUsed(db)).toEqual({
        program_id: 'prog-2',
        sub_tag: null,
      });
    });

    it('overwrites a previous program_id on a fresh write', async () => {
      await setGlobalLastUsed(db, 'old', 'strength');
      await setGlobalLastUsed(db, 'new', 'strength');
      expect((await getGlobalLastUsed(db)).program_id).toBe('new');
    });

    it('updating sub_tag from null → value re-establishes the intensity', async () => {
      await setGlobalLastUsed(db, 'p', null);
      expect((await getGlobalLastUsed(db)).sub_tag).toBeNull();

      await setGlobalLastUsed(db, 'p', 'hypertrophy');
      expect((await getGlobalLastUsed(db)).sub_tag).toBe('hypertrophy');
    });
  });
});

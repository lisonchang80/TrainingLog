import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  getBackupMetadata,
  getBackupMode,
  recordBackupFailure,
  recordBackupSuccess,
  setBackupMode,
} from '../../src/adapters/sqlite/settingsRepository';
import { shouldEscalateBackupFailure } from '../../src/domain/backup/backupPolicy';

/**
 * Slice 15 C2 — backup metadata `app_settings` keys (grill Q16-A: existing
 * table, NO migration). Round-trips + the success-heals-streak /
 * failure-anchors-streak contracts the escalation gate depends on.
 */
describe('Slice 15 C2 — backup metadata settings', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('backup_mode defaults to auto (ADR Q14.8 預設 ON) and round-trips', async () => {
    expect(await getBackupMode(db)).toBe('auto');
    await setBackupMode(db, 'manual');
    expect(await getBackupMode(db)).toBe('manual');
    await setBackupMode(db, 'auto');
    expect(await getBackupMode(db)).toBe('auto');
  });

  it('fresh install metadata is all-null with auto mode', async () => {
    expect(await getBackupMetadata(db)).toEqual({
      mode: 'auto',
      lastSuccessAtMs: null,
      lastAttemptAtMs: null,
      lastSizeBytes: null,
      lastError: null,
      firstErrorAtMs: null,
    });
  });

  it('recordBackupSuccess stamps success/attempt/size and heals the failure streak', async () => {
    await recordBackupFailure(db, { atMs: 1000, message: 'disk full' });
    await recordBackupSuccess(db, { atMs: 2000, sizeBytes: 384_000 });

    const meta = await getBackupMetadata(db);
    expect(meta.lastSuccessAtMs).toBe(2000);
    expect(meta.lastAttemptAtMs).toBe(2000);
    expect(meta.lastSizeBytes).toBe(384_000);
    expect(meta.lastError).toBeNull();
    expect(meta.firstErrorAtMs).toBeNull();
  });

  it('success with unknown size keeps the previous size readout', async () => {
    await recordBackupSuccess(db, { atMs: 1000, sizeBytes: 100 });
    await recordBackupSuccess(db, { atMs: 2000, sizeBytes: null });
    const meta = await getBackupMetadata(db);
    expect(meta.lastSuccessAtMs).toBe(2000);
    expect(meta.lastSizeBytes).toBe(100);
  });

  it('repeated failures keep the FIRST streak anchor, refresh last_error', async () => {
    await recordBackupFailure(db, { atMs: 1000, message: 'network' });
    await recordBackupFailure(db, { atMs: 5000, message: 'quota' });

    const meta = await getBackupMetadata(db);
    expect(meta.firstErrorAtMs).toBe(1000);
    expect(meta.lastError).toEqual({ message: 'quota', atMs: 5000 });
    expect(meta.lastAttemptAtMs).toBe(5000);
  });

  it('a new streak after a success re-anchors first_error_at', async () => {
    await recordBackupFailure(db, { atMs: 1000, message: 'a' });
    await recordBackupSuccess(db, { atMs: 2000, sizeBytes: 1 });
    await recordBackupFailure(db, { atMs: 3000, message: 'b' });

    const meta = await getBackupMetadata(db);
    expect(meta.firstErrorAtMs).toBe(3000);
  });

  it('metadata feeds the escalation gate end-to-end (3-day auto threshold)', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    await recordBackupFailure(db, { atMs: 0, message: 'x' });
    const meta = await getBackupMetadata(db);

    const gate = (nowMs: number) =>
      shouldEscalateBackupFailure({
        mode: meta.mode,
        nowMs,
        lastSuccessAtMs: meta.lastSuccessAtMs,
        lastErrorAtMs: meta.lastError?.atMs ?? null,
        firstErrorAtMs: meta.firstErrorAtMs,
      });

    expect(gate(3 * DAY - 1)).toBe(false);
    expect(gate(3 * DAY)).toBe(true);
  });
});

import type { Database } from './types';
import { v001_initial } from './schema/v001_initial';

/**
 * Migration runner using PRAGMA user_version.
 *
 * Each migration is wrapped in a transaction so partial failure rolls back
 * cleanly. Add new migrations to the `migrations` map below.
 *
 * Convention: migration version numbers are 1-indexed. PRAGMA user_version
 * starts at 0 on fresh DBs.
 */

type MigrationFn = (db: Database) => Promise<void>;

const migrations: Record<number, MigrationFn> = {
  1: v001_initial,
};

export async function migrate(db: Database): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const current = row?.user_version ?? 0;
  const target = Math.max(...Object.keys(migrations).map(Number));

  for (let v = current + 1; v <= target; v++) {
    const fn = migrations[v];
    if (!fn) {
      throw new Error(`Missing migration for version ${v}`);
    }
    await db.withTransactionAsync(async () => {
      await fn(db);
      // PRAGMA user_version doesn't accept bound params — interpolate safely
      // (v is a number from our own controlled map, not user input).
      await db.execAsync(`PRAGMA user_version = ${v}`);
    });
  }
}

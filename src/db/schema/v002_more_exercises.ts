import type { Database } from '../types';

/**
 * v002 — seed additional built-in compound lifts.
 *
 * Slice 2 introduces multi-exercise Sessions, so the picker needs more than
 * one option. UUIDs are stable + hand-picked so test assertions and future
 * migrations stay deterministic.
 *
 * INSERT OR IGNORE keeps this idempotent — a re-run after partial failure
 * won't double-seed.
 */

const SEEDS: { id: string; name: string; load_type: 'loaded' | 'bodyweight' }[] = [
  { id: '00000000-0000-4000-8000-000000000002', name: 'Back Squat', load_type: 'loaded' },
  { id: '00000000-0000-4000-8000-000000000003', name: 'Deadlift', load_type: 'loaded' },
  { id: '00000000-0000-4000-8000-000000000004', name: 'Overhead Press', load_type: 'loaded' },
  { id: '00000000-0000-4000-8000-000000000005', name: 'Barbell Row', load_type: 'loaded' },
  { id: '00000000-0000-4000-8000-000000000006', name: 'Pull-up', load_type: 'bodyweight' },
  { id: '00000000-0000-4000-8000-000000000007', name: 'Push-up', load_type: 'bodyweight' },
];

export async function v002_more_exercises(db: Database): Promise<void> {
  for (const seed of SEEDS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO exercise (id, name, load_type, is_builtin)
       VALUES (?, ?, ?, ?)`,
      seed.id,
      seed.name,
      seed.load_type,
      1
    );
  }
}

/**
 * Slice 13d / D6-D7 — sessionRepository `setIsWatchTracked` setter scaffold.
 *
 * Scaffold built by Agent Z 2026-05-27, following V's coverage-audit
 * report `24-overnight-V-coverage-audit.md` item #2 (high priority).
 *
 * Context — as of main `8ca6671` the **read** path for
 * `session.is_watch_tracked` (v024 schema column) is land and covered
 * by `tests/db/sessionRepositoryIsWatchTracked.test.ts` (6 cases). The
 * **write** path — flipping the column false→true / true→false from
 * either the WC handshake ack (D7) or a Watch-initiated session start
 * (D6) — is NOT yet land in `src/adapters/sqlite/sessionRepository.ts`.
 *
 * Expected setter signature (per V's report + D1 reader pattern):
 *   export async function setIsWatchTracked(
 *     db: Database,
 *     id: string,
 *     value: boolean,
 *   ): Promise<void>;
 *
 * The setter MUST:
 *   1. Translate `boolean` → `INTEGER 0/1` at the write boundary
 *      (mirror of `mapSessionRow` translation on the read side).
 *   2. No-op gracefully when `id` doesn't exist (no throw) OR throw a
 *      typed error — TBD by D6/D7 implementer; both are reasonable.
 *      The test scaffold below documents BOTH branches as separate
 *      it.todo so the implementer picks one.
 *   3. Be idempotent — calling with the same value twice produces no
 *      observable difference.
 *
 * This file is **scaffold-only**. Implementers should:
 *   1. Replace the commented import once the setter lands.
 *   2. Flip `it.skip` → `it` and fill the bodies.
 *
 * File location note — `tests/database/` does not currently exist;
 * placing the scaffold here per the overnight prompt's allow-list.
 * (Sibling reader tests live at `tests/db/sessionRepositoryIsWatchTracked.test.ts`
 * — once `database/` is folded in or the test lands, consider co-locating.)
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  getSession,
} from '../../src/adapters/sqlite/sessionRepository';

// TODO: import once setIsWatchTracked ships in src/adapters/sqlite/sessionRepository.ts:
//   import { setIsWatchTracked } from '../../src/adapters/sqlite/sessionRepository';

describe('Slice 13d D6/D7 — sessionRepository.setIsWatchTracked setter (scaffold)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    // In-memory SQLite + v024 schema applied — same setup pattern as
    // the reader test (sessionRepositoryIsWatchTracked.test.ts).
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // -----------------------------------------------------------------
  // (a) Round-trip false → true via the setter
  // -----------------------------------------------------------------
  it.skip(
    'flips a freshly-created session is_watch_tracked false → true and getSession reflects the new value',
    async () => {
      // TODO:
      //   await createSession(db, { id: 'sess-1', started_at: 1_000 });
      //   const before = await getSession(db, 'sess-1');
      //   expect(before?.is_watch_tracked).toBe(false);
      //
      //   await setIsWatchTracked(db, 'sess-1', true);
      //   const after = await getSession(db, 'sess-1');
      //   expect(after?.is_watch_tracked).toBe(true);
    },
  );

  // -----------------------------------------------------------------
  // (b) Round-trip true → false (un-track path, e.g. D9 reconcile timeout)
  // -----------------------------------------------------------------
  it.skip(
    'flips back true → false when iPhone reconcile-timeout marks the session no-longer-watch-driven',
    async () => {
      // TODO: insert raw row with is_watch_tracked=1, call setter with
      // false, then re-read via getSession and assert boolean === false.
    },
  );

  // -----------------------------------------------------------------
  // (c) Idempotent — repeat calls with the same value are a no-op
  // -----------------------------------------------------------------
  it.skip(
    'is idempotent — calling with value=true twice leaves the row unchanged',
    async () => {
      // TODO: assert the row's `is_watch_tracked` value AND any
      // updated_at-style audit field (if added) is stable across two
      // consecutive same-value writes.
    },
  );

  // -----------------------------------------------------------------
  // (d) Unknown session id — TBD branch
  // -----------------------------------------------------------------
  it.todo(
    'TBD — unknown session id: silently no-ops (preferred) OR throws (alt) — D6/D7 implementer picks',
  );

  // -----------------------------------------------------------------
  // (e) Translates boolean → INTEGER 0/1 on the wire
  // -----------------------------------------------------------------
  it.skip(
    'persists boolean true as raw INTEGER 1 in the session table',
    async () => {
      // TODO:
      //   await createSession(db, { id: 'sess-int', started_at: 1_000 });
      //   await setIsWatchTracked(db, 'sess-int', true);
      //   const raw = await db.getFirstAsync<{ is_watch_tracked: number }>(
      //     'SELECT is_watch_tracked FROM session WHERE id = ?',
      //     'sess-int',
      //   );
      //   expect(raw?.is_watch_tracked).toBe(1);
    },
  );

  it.skip(
    'persists boolean false as raw INTEGER 0 (no NULL leakage)',
    async () => {
      // TODO: same pattern as above but assert === 0 (not null, not undefined).
    },
  );

  // -----------------------------------------------------------------
  // (f) Does not touch other columns
  // -----------------------------------------------------------------
  it.skip(
    'leaves started_at / ended_at / title / bodyweight_snapshot_kg untouched',
    async () => {
      // TODO: createSession with explicit title + bw, mutate is_watch_tracked
      //       via setter, re-read and deep-equal everything except the flag.
    },
  );

  // -----------------------------------------------------------------
  // (g) Works against an ended session (D9 reconcile-timeout path)
  // -----------------------------------------------------------------
  it.skip(
    'flips is_watch_tracked on an already-ended session (post-finalize correction)',
    async () => {
      // TODO: createSession → endSession → setIsWatchTracked(true).
      // Useful when D9 reconcile-timeout runs after the user finalized
      // on iPhone-side and we retroactively confirm watch tracked it.
    },
  );
});

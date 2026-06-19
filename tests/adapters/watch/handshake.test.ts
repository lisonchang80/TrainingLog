/**
 * Slice 13d / D9 + NEW-Q50 D28 — handshake module tests.
 *
 * Layout (D9 wire-in full coverage → NEW-Q50 D28 rewrite):
 *
 *   1. Pure builders (Stage 1 fat-tree reply, matchesPendingRequest,
 *      buildStartFromIphone). No DB, no native mocks.
 *
 *   2. Impure helpers (loadActiveSessionSummary, loadTemplatesFullTree,
 *      loadProgramsPrefetchList, loadTodayPlanned, fetchSessionSnapshot)
 *      against an in-memory BetterSqliteDatabase with migrate() applied
 *      — same pattern as `tests/db/setIsWatchTracked.test.ts`.
 *
 *   3. Orchestrators (onHandshakeRequest, onStartFromWatch) — exercise
 *      the new NEW-Q50 reconcile contract end-to-end without going
 *      through the WC native bridge. Reverse-TUI replies captured via
 *      a fake `sendReverseTUI` closure.
 *
 * Run under `testEnvironment: node` — the WC bridge is never loaded.
 *
 * NEW-Q50 D28 changes (vs pre-Q50 D9 tests):
 *   - All `Stage1TemplateSummary` (thin) → `Stage1TemplateFullSummary`
 *     (fat tree with exercises[]).
 *   - `loadTemplatePrefetchList` cases → `loadTemplatesFullTree` cases
 *     (JOIN against template_exercise + exercise).
 *   - `onStartFromWatch` signature now `(db, env, sendReverseTUI)`;
 *     sessionId comes from `env.payload.sessionId`, dedup via INSERT
 *     OR IGNORE-style logic. New conflict-reply case.
 */

import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
  endSession,
  getActiveSession,
  getSession,
} from '../../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../../src/adapters/sqlite/setRepository';
import { setAppMode } from '../../../src/adapters/sqlite/settingsRepository';
import { makeEnvelope } from '../../../src/adapters/watch';
import type {
  HandshakePayload,
  StartFromWatchPayload,
  WCMessage,
} from '../../../src/adapters/watch';
import {
  buildStage1Reply,
  buildStartFromIphone,
  fetchSessionSnapshot,
  loadActiveSessionSummary,
  loadProgramsPrefetchList,
  loadTemplatesFullTree,
  loadTodayPlanned,
  matchesPendingRequest,
  onHandshakeRequest,
  onStartFromWatch,
  type SessionSnapshot,
  type Stage1BucketRange,
  type Stage1ProgramSummary,
  type Stage1ReplyPayload,
  type Stage1SessionSummary,
  type Stage1TemplateFullSummary,
  type StartFromWatchReconcile,
} from '../../../src/adapters/watch/handshake';
import {
  applyBucketRanges,
  getBucketBoundaries,
  resetBucketRanges,
} from '../../../src/domain/pr/buckets';
import type { BucketBoundary } from '../../../src/domain/pr/types';
import { getLocale, setLocale } from '../../../src/i18n/strings';

// The Bench Press row seeded by v001_initial — used as a stable
// `exercise_id` foreign key in session_exercise / set seeds. Other
// exercises require explicit insert + `migrate` doesn't seed them.
const BENCH = '00000000-0000-4000-8000-000000000001';

// =====================================================================
// Stage 1 reply (pure builder)
// =====================================================================

describe('WC handshake — Stage 1 reply (pure builder, NEW-Q50 D28 fat tree)', () => {
  const sampleRequest: HandshakePayload = {
    requestId: 'req-abc',
    clientVersion: '13d.0',
  };

  // -------------------------------------------------------------------
  // (a) absent-session variant
  // -------------------------------------------------------------------
  it('replies with hasActiveSession=false when activeSession is null', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);

    expect(reply.hasActiveSession).toBe(false);
    expect(reply.requestId).toBe('req-abc');
    expect(reply.prefetch.templates).toEqual([]);
    // Discriminated union — no `session` field on the false variant.
    expect((reply as { session?: unknown }).session).toBeUndefined();
  });

  // -------------------------------------------------------------------
  // (b) present-session variant
  // -------------------------------------------------------------------
  it('replies with hasActiveSession=true and minimal summary when activeSession present', () => {
    const active: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 4,
    };
    const reply = buildStage1Reply(sampleRequest, active, []);

    expect(reply.hasActiveSession).toBe(true);
    if (reply.hasActiveSession) {
      expect(reply.session.sessionId).toBe('sess-1');
      expect(reply.session.startedAt).toBe(1_700_000_000_000);
      expect(reply.session.title).toBe('Push Day');
      expect(reply.session.exerciseCount).toBe(4);
    }
  });

  // -------------------------------------------------------------------
  // (c) requestId echo
  // -------------------------------------------------------------------
  it('echoes the original requestId so the Watch can match the reply to its pending request', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);
    expect(reply.requestId).toBe(sampleRequest.requestId);
  });

  // -------------------------------------------------------------------
  // (d) NEW-Q50 D28 — fat-tree templates carry-through
  // -------------------------------------------------------------------
  it('carries the provided fat-tree templates list (with exercises[]) into the reply prefetch field', () => {
    const templates: Stage1TemplateFullSummary[] = [
      {
        templateId: 'tpl-1',
        name: 'Push',
        exercises: [
          {
            templateExerciseId: 'te-1',
            exerciseId: BENCH,
            exerciseName: 'Bench Press',
            ordering: 1,
            defaultSets: 3,
            defaultReps: 8,
            defaultWeightKg: 60,
            // 2026-05-29 SetLogger sets[] fix — required field; empty
            // here because this carry-through test doesn't seed
            // template_set rows. Real loader path covered separately.
            sets: [],
          },
        ],
      },
      { templateId: 'tpl-2', name: 'Pull', exercises: [] },
    ];
    const reply = buildStage1Reply(sampleRequest, null, templates);

    expect(reply.prefetch.templates).toHaveLength(2);
    expect(reply.prefetch.templates[0]).toEqual({
      templateId: 'tpl-1',
      name: 'Push',
      exercises: [
        {
          templateExerciseId: 'te-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 1,
          defaultSets: 3,
          defaultReps: 8,
          defaultWeightKg: 60,
          sets: [],
        },
      ],
    });
    expect(reply.prefetch.templates[1].exercises).toEqual([]);
  });

  // -------------------------------------------------------------------
  // (e) NEW-Q50 D28 — fat-tree size budget. Estimated 20 templates ×
  //     ~10 exercises ≈ 30 KB; we assert under 40 KB to leave envelope
  //     wrap headroom but well under the 64 KB WC ceiling.
  // -------------------------------------------------------------------
  it('reply payload JSON-stringified size stays under WC envelope cap with 20 fat-tree templates × 10 exercises × 3 sets and an active session', () => {
    const active: Stage1SessionSummary = {
      sessionId: 'sess-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 10,
    };
    const templates: Stage1TemplateFullSummary[] = Array.from(
      { length: 20 },
      (_, i) => ({
        templateId: `tpl-${i}-aaaa-bbbb-cccc-deadbeef${i}`,
        name: `Template ${i}`,
        exercises: Array.from({ length: 10 }, (_, j) => ({
          templateExerciseId: `te-${i}-${j}-aaaa-bbbb-deadbeef`,
          exerciseId: `ex-${i}-${j}-aaaa-bbbb-deadbeef`,
          exerciseName: `Exercise ${i}-${j}`,
          ordering: j,
          defaultSets: 3,
          defaultReps: 8,
          defaultWeightKg: 60,
          // 2026-05-29 SetLogger sets[] fix — size budget test now
          // also covers the per-set tax. Realistic average user
          // template has 2-4 working sets per exercise; we seed 3
          // here to model the high end of the common case (20 ×
          // 10 × 3 = 600 sets ≈ 30 KB JSON on top of the ~30 KB
          // template/exercise wrap → total ~60 KB). Threshold
          // tightened from < 40 KB (pre-fix, no sets[]) to
          // < 60 KB (with sets[]) but kept under the 64 KB WC
          // envelope hard ceiling.
          sets: Array.from({ length: 3 }, () => ({
            k: 'working' as const,
            r: 8,
            w: 60,
          })),
        })),
        // Stage1 prefetch v3 (2026-06-13 Y-dup) worst case — every entry is
        // ALSO a name group whose variants each carry a full triple
        // (programId UUID + subTag). The dedup keeps the total exercise-tree
        // count at the 20-variant budget (representative tree rides
        // top-level `exercises`, so the variant entry here omits its tree),
        // but the per-variant WRAPPER (templateId + triple) is a genuine new
        // tax over the pre-v3 flat shape. Modelling it with a full triple on
        // every variant is the largest the wrapper can get.
        variants: [
          {
            templateId: `tpl-${i}-aaaa-bbbb-cccc-deadbeef${i}`,
            programId: `prog-${i}-aaaa-bbbb-cccc-deadbeef${i}`,
            subTag: '12RM',
          },
        ],
      }),
    );
    const reply = buildStage1Reply(sampleRequest, active, templates);
    const size = JSON.stringify(reply).length;
    // 2026-06-13 — soft threshold raised 60 KB → 62 KB to absorb the v3
    // variant-wrapper tax (20 variant entries × ~80 B of templateId +
    // triple ≈ 1.6 KB on top of the 2026-05-29 ~60 KB sets[] baseline).
    // Still leaves ~2 KB headroom under the hard ceiling — the dedup
    // (representative tree NOT duplicated into variants[0]) is what keeps
    // total exercise trees at the 20-variant budget rather than ~40.
    expect(size).toBeLessThan(62_000);
    // The real gate: stay under the 64 KB WC envelope ceiling. Q8 rejected
    // raising the cap precisely because worst case crowds this line.
    expect(size).toBeLessThan(64_000);
  });

  // -------------------------------------------------------------------
  // (f) NEW-Q50 D28 — sanity: fat-tree shape JSON round-trips cleanly
  //     (no Map / Set / Date leakage in the projection).
  // -------------------------------------------------------------------
  it('fat-tree reply JSON.parse(JSON.stringify()) round-trips identical', () => {
    const templates: Stage1TemplateFullSummary[] = [
      {
        templateId: 'tpl-rt',
        name: 'RoundTrip',
        exercises: [
          {
            templateExerciseId: 'te-rt-1',
            exerciseId: BENCH,
            exerciseName: 'Bench Press',
            ordering: 1,
            defaultSets: 3,
            // F5 (2026-06-12) — open reps/weight are now ABSENT keys on
            // the wire (never explicit null); the fixture mirrors what
            // the loader emits.
            // 2026-05-29 SetLogger sets[] fix — seed one row so the
            // round-trip also exercises the per-set projection.
            sets: [
              { k: 'working', r: 8, w: 60 },
            ],
          },
        ],
      },
    ];
    const reply = buildStage1Reply(sampleRequest, null, templates);
    const rt = JSON.parse(JSON.stringify(reply));
    expect(rt).toEqual(reply);
  });

  // -------------------------------------------------------------------
  // (g) Slice 17 (ADR-0027 D5) — bucketRanges carry-through.
  //     The reply mirrors the user's edited rep-bucket ranges onto the
  //     Watch so its bucket labels match the iPhone.
  // -------------------------------------------------------------------
  it('omits prefetch.bucketRanges when not provided (forward-compat with pre-slice-17 callers)', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);
    expect(reply.prefetch.bucketRanges).toBeUndefined();
  });

  it('projects provided bucketRanges, OMITTING the open-ended top bucket max (wire null rule)', () => {
    const boundaries: BucketBoundary[] = [
      { key: 'max_strength', min: 1, max: 3 },
      { key: 'strength', min: 4, max: 6 },
      { key: 'hypertrophy', min: 7, max: 10 },
      { key: 'muscle_endurance', min: 11, max: 15 },
      { key: 'endurance', min: 16, max: null },
    ];
    const reply = buildStage1Reply(sampleRequest, null, [], [], undefined, boundaries);
    expect(reply.prefetch.bucketRanges).toEqual([
      { key: 'max_strength', min: 1, max: 3 },
      { key: 'strength', min: 4, max: 6 },
      { key: 'hypertrophy', min: 7, max: 10 },
      { key: 'muscle_endurance', min: 11, max: 15 },
      // Top bucket: NULL max → ABSENT key (never explicit null). A JS null
      // inside this reply-dict array would risk an NSNull → WCSession reject.
      { key: 'endurance', min: 16 },
    ]);
    const top = reply.prefetch.bucketRanges?.[4] as Stage1BucketRange;
    expect(top).not.toHaveProperty('max');
  });

  it('carries USER-EDITED ranges verbatim (the whole point — Watch labels match the phone)', () => {
    // User shifted 增肌 to 6-12 etc. The wire must reflect THESE bounds.
    const edited: BucketBoundary[] = [
      { key: 'max_strength', min: 1, max: 2 },
      { key: 'strength', min: 3, max: 5 },
      { key: 'hypertrophy', min: 6, max: 12 },
      { key: 'muscle_endurance', min: 13, max: 20 },
      { key: 'endurance', min: 21, max: null },
    ];
    const reply = buildStage1Reply(sampleRequest, null, [], [], undefined, edited);
    expect(reply.prefetch.bucketRanges).toEqual([
      { key: 'max_strength', min: 1, max: 2 },
      { key: 'strength', min: 3, max: 5 },
      { key: 'hypertrophy', min: 6, max: 12 },
      { key: 'muscle_endurance', min: 13, max: 20 },
      { key: 'endurance', min: 21 },
    ]);
  });

  it('bucketRanges reply JSON round-trips clean (no null leakage in the array)', () => {
    const boundaries: BucketBoundary[] = [
      { key: 'max_strength', min: 1, max: 3 },
      { key: 'strength', min: 4, max: 6 },
      { key: 'hypertrophy', min: 7, max: 10 },
      { key: 'muscle_endurance', min: 11, max: 15 },
      { key: 'endurance', min: 16, max: null },
    ];
    const reply = buildStage1Reply(sampleRequest, null, [], [], undefined, boundaries);
    const json = JSON.stringify(reply);
    // No `"max":null` anywhere in the serialised reply (wire null rule).
    expect(json).not.toContain('"max":null');
    expect(JSON.parse(json)).toEqual(reply);
  });
});

// =====================================================================
// matchesPendingRequest (pure predicate)
// =====================================================================

describe('WC handshake — matchesPendingRequest', () => {
  it('returns true when the reply requestId matches the Watch-side pending nonce', () => {
    const reply = buildStage1Reply(
      { requestId: 'pending-1', clientVersion: '13d.0' },
      null,
      [],
    );
    expect(matchesPendingRequest(reply, 'pending-1')).toBe(true);
  });

  it('returns false when a stale reply lands after the Watch moved on to a new nonce', () => {
    const reply = buildStage1Reply(
      { requestId: 'stale', clientVersion: '13d.0' },
      null,
      [],
    );
    expect(matchesPendingRequest(reply, 'fresh-nonce')).toBe(false);
  });
});

// =====================================================================
// buildStartFromIphone (pure projection)
// =====================================================================

describe('WC handshake — buildStartFromIphone', () => {
  it('projects a SessionSnapshot into a JSON-primitive-clean wire payload', () => {
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-wire',
      title: 'Pull Day',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 1,
          plannedSets: 3,
          parentId: null,
          reusableSupersetId: null,
          sets: [
            {
              setId: 'set-1',
              ordinal: 1,
              weight: 100,
              reps: 5,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'working',
              is_logged: true,
            },
          ],
        },
      ],
    };
    const out = buildStartFromIphone(snapshot);
    expect(out.sessionId).toBe('sess-wire');
    expect(out.snapshot).toEqual({
      sessionId: 'sess-wire',
      title: 'Pull Day',
      startedAt: 1_700_000_000_000,
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 1,
          plannedSets: 3,
          parentId: null,
          reusableSupersetId: null,
          sets: [
            {
              setId: 'set-1',
              ordinal: 1,
              weight: 100,
              reps: 5,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'working',
              is_logged: true,
              parent_set_id: null,
            },
          ],
        },
      ],
    });
    // Legacy snapshot omits the bidirectional fields → wire stays clean.
    expect(out.snapshot).not.toHaveProperty('rev');
    expect(out.snapshot).not.toHaveProperty('originator');
    expect(out.snapshot).not.toHaveProperty('deletedIds');
  });

  it('projects rev / originator / deletedIds when present (bidirectional sync)', () => {
    const snapshot: SessionSnapshot = {
      sessionId: 'sess-bi',
      title: '',
      startedAt: 1_700_000_000_000,
      exercises: [],
      rev: 7,
      originator: 'iphone',
      deletedIds: { exerciseIds: ['se-gone'], setIds: ['set-gone'] },
    };
    const out = buildStartFromIphone(snapshot);
    expect(out.snapshot).toMatchObject({
      rev: 7,
      originator: 'iphone',
      deletedIds: { exerciseIds: ['se-gone'], setIds: ['set-gone'] },
    });
  });
});

// =====================================================================
// Impure helpers — in-memory SQLite
// =====================================================================

describe('WC handshake — impure helpers (in-memory SQLite)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------
  // loadActiveSessionSummary
  // -------------------------------------------------------------------

  describe('loadActiveSessionSummary', () => {
    it('returns null when no in-progress session exists', async () => {
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toBeNull();
    });

    it('returns minimal summary with exerciseCount=0 for a bare freestyle session', async () => {
      await createSession(db, {
        id: 'sess-bare',
        started_at: 1_700_000_000_000,
      });
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toEqual({
        sessionId: 'sess-bare',
        startedAt: 1_700_000_000_000,
        title: '',
        exerciseCount: 0,
      });
    });

    it('counts session_exercise rows for the active session', async () => {
      await createSession(db, {
        id: 'sess-plan',
        started_at: 1_700_000_000_000,
        title: 'Push Day',
      });
      // Seed 3 session_exercise rows; appendSessionExercise refuses
      // dup solo exercise so each row uses a different exercise_id.
      await db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, ?, ?)`,
        '00000000-0000-4000-8000-000000000099',
        'TestEx2',
        'loaded',
        0,
      );
      await db.runAsync(
        `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, ?, ?)`,
        '00000000-0000-4000-8000-00000000009a',
        'TestEx3',
        'loaded',
        0,
      );
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-plan',
        exercise_id: BENCH,
      });
      await appendSessionExercise(db, {
        id: 'se-2',
        session_id: 'sess-plan',
        exercise_id: '00000000-0000-4000-8000-000000000099',
      });
      await appendSessionExercise(db, {
        id: 'se-3',
        session_id: 'sess-plan',
        exercise_id: '00000000-0000-4000-8000-00000000009a',
      });

      const summary = await loadActiveSessionSummary(db);
      expect(summary?.exerciseCount).toBe(3);
      expect(summary?.title).toBe('Push Day');
    });

    it('skips ended sessions (ended_at IS NOT NULL)', async () => {
      await createSession(db, {
        id: 'sess-done',
        started_at: 1_700_000_000_000,
      });
      await endSession(db, { id: 'sess-done', ended_at: 1_700_000_100_000 });
      const summary = await loadActiveSessionSummary(db);
      expect(summary).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // NEW-Q50 D28 — loadTemplatesFullTree
  // -------------------------------------------------------------------

  describe('loadTemplatesFullTree (NEW-Q50 D28)', () => {
    it('returns empty array when no templates exist', async () => {
      const list = await loadTemplatesFullTree(db);
      expect(list).toEqual([]);
    });

    it('returns templates with empty exercises[] when a template has no template_exercise rows', async () => {
      const now = 1_700_000_000_000;
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-empty',
        'Empty',
        now,
        now,
      );
      const list = await loadTemplatesFullTree(db);
      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        templateId: 'tpl-empty',
        name: 'Empty',
        exercises: [],
        // v3 — representative stub (tree rides top-level, triple all-NULL
        // so both keys are omitted per the wire null rule).
        variants: [{ templateId: 'tpl-empty' }],
      });
    });

    it('hydrates the full exercise tree with JOINed exercise.name + defaultSets/defaultReps/defaultWeightKg', async () => {
      const now = 1_700_000_000_000;
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-rich',
        'Rich Template',
        now,
        now,
      );
      // Two template_exercise rows referencing the seeded Bench Press
      // exercise. Different defaults to assert column projection.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-1',
        'tpl-rich',
        BENCH,
        1,
        3,
        8,
        60,
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-2',
        'tpl-rich',
        BENCH,
        2,
        4,
        null,
        null,
      );
      const list = await loadTemplatesFullTree(db);
      expect(list).toHaveLength(1);
      expect(list[0].exercises).toHaveLength(2);
      expect(list[0].exercises[0]).toEqual({
        templateExerciseId: 'te-1',
        exerciseId: BENCH,
        // Bug Y (task #271) — localised at the wire boundary. Default
        // test locale is 'zh' (strings.ts currentLocale), so the seed
        // 'Bench Press' surfaces as its zh label.
        exerciseName: '槓鈴臥推',
        ordering: 1,
        defaultSets: 3,
        defaultReps: 8,
        defaultWeightKg: 60,
        // F5 (2026-06-12) — solo row: parentId / reusableSupersetId are
        // ABSENT keys (not explicit null) per the wire null rule.
        // 2026-05-29 SetLogger sets[] fix — no template_set rows
        // seeded, so the loader returns an empty array (consumer
        // falls back to default_* path).
        sets: [],
      });
      // Second row exercises the omitted-defaults projection (F5: NULL
      // columns → absent keys, surfaced as undefined on the TS side).
      expect(list[0].exercises[1].defaultReps).toBeUndefined();
      expect(list[0].exercises[1].defaultWeightKg).toBeUndefined();
      expect(list[0].exercises[1].ordering).toBe(2);
      expect(list[0].exercises[1].sets).toEqual([]);
    });

    // D15 superset card — the fat tree must carry the cluster linkage
    // (reusable_superset_id + parent_id) so the Watch can fold an adjacent
    // same-RS pair into one superset card when it builds the local
    // SessionSnapshot. A = parent (parent_id NULL), B = child (parent_id = A).
    it('carries reusable_superset_id + parent_id linkage for a superset pair', async () => {
      const now = 1_700_000_000_000;
      const ROW = '00000000-0000-4000-8000-000000000002';
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-ss',
        'Superset Template',
        now,
        now,
      );
      // RS entity the two rows are exploded from (FK target of
      // template_exercise.reusable_superset_id).
      await db.runAsync(
        `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
         VALUES (?, ?, NULL, 0, ?, ?)`,
        'rs-1',
        'Bench + Row',
        now,
        now,
      );
      // A side — parent (parent_id NULL), carries the RS id.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps,
            default_weight_kg, parent_id, reusable_superset_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
        'te-a',
        'tpl-ss',
        BENCH,
        1,
        3,
        8,
        60,
        'rs-1',
      );
      // B side — child (parent_id = A's te id), same RS id, adjacent ordering.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps,
            default_weight_kg, parent_id, reusable_superset_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        'te-b',
        'tpl-ss',
        ROW,
        2,
        3,
        10,
        40,
        'te-a',
        'rs-1',
      );
      const list = await loadTemplatesFullTree(db);
      expect(list).toHaveLength(1);
      expect(list[0].exercises).toHaveLength(2);
      const [a, b] = list[0].exercises;
      // A side: RS id present, no parent (F5: absent key → undefined).
      expect(a.templateExerciseId).toBe('te-a');
      expect(a.parentId).toBeUndefined();
      expect(a.reusableSupersetId).toBe('rs-1');
      // B side: RS id present (same as A → groups), parent points at A.
      expect(b.templateExerciseId).toBe('te-b');
      expect(b.parentId).toBe('te-a');
      expect(b.reusableSupersetId).toBe('rs-1');
    });

    // 2026-05-29 SetLogger sets[] fix — happy path
    it('hydrates template_set rows into exercises[].sets ordered by position ASC', async () => {
      const now = 1_700_000_000_000;
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-sets',
        'Sets',
        now,
        now,
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-sets-1',
        'tpl-sets',
        BENCH,
        1,
        3,
        null, // intentionally null — sets[] should still hydrate
        null, // intentionally null — sets[] should still hydrate
      );
      // Seed 3 template_set rows OUT of position order to exercise
      // the ORDER BY position ASC projection. Mix set_kind values
      // to assert kind projection too.
      const seedSet = async (
        id: string,
        position: number,
        kind: string,
        reps: number,
        weight: number,
      ) => {
        await db.runAsync(
          `INSERT INTO template_set
             (id, template_exercise_id, position, set_kind, reps, weight)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id,
          'te-sets-1',
          position,
          kind,
          reps,
          weight,
        );
      };
      await seedSet('s-2', 2, 'working', 8, 80);
      await seedSet('s-0', 0, 'warmup', 10, 40);
      await seedSet('s-1', 1, 'working', 8, 70);

      const list = await loadTemplatesFullTree(db);
      const ex = list[0].exercises[0];
      expect(ex.sets).toHaveLength(3);
      // Order by position ASC (NOT insert order) — array index 0
      // corresponds to the position=0 row, etc. `position` field is
      // intentionally not on the wire — array order IS the order.
      // Wire field names: k = setKind, r = reps, w = weightKg
      // (compacted for the WC envelope cap).
      expect(ex.sets[0]).toEqual({
        k: 'warmup',
        r: 10,
        w: 40,
      });
      expect(ex.sets[1]).toEqual({
        k: 'working',
        r: 8,
        w: 70,
      });
      expect(ex.sets[2]).toEqual({
        k: 'working',
        r: 8,
        w: 80,
      });
      // Defaults stay ABSENT on the wire (F5: omitted key, never null —
      // consumer prefers sets[] when non-empty; defaults kept only for
      // back-compat fallback).
      expect(ex.defaultReps).toBeUndefined();
      expect(ex.defaultWeightKg).toBeUndefined();
    });

    // 2026-05-29 SetLogger sets[] fix — defensive: unknown set_kind
    // is normalised to 'working' (schema CHECK enforces the union
    // but the wire projection narrows defensively, in case of
    // historic backfill artefacts).
    it('coerces unrecognised set_kind values to working in the wire projection', async () => {
      const now = 1_700_000_000_000;
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-coerce',
        'Coerce',
        now,
        now,
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-coerce-1',
        'tpl-coerce',
        BENCH,
        1,
        1,
        8,
        60,
      );
      // Insert a 'dropset' row — valid per schema. We're verifying
      // the wire projection accepts the three valid kinds verbatim
      // (the defensive coercion only kicks in for genuinely unknown
      // values, which v009 CHECK normally prevents).
      await db.runAsync(
        `INSERT INTO template_set
           (id, template_exercise_id, position, set_kind, reps, weight)
         VALUES (?, ?, ?, ?, ?, ?)`,
        's-drop',
        'te-coerce-1',
        0,
        'dropset',
        5,
        50,
      );
      const list = await loadTemplatesFullTree(db);
      expect(list[0].exercises[0].sets[0]).toEqual({
        k: 'dropset',
        r: 5,
        w: 50,
      });
    });

    it('orders templates by listTemplates() (updated_at DESC) and caps to the limit', async () => {
      const now = 1_700_000_000_000;
      for (let i = 0; i < 5; i++) {
        await db.runAsync(
          `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
          `tpl-${i}`,
          `Template ${i}`,
          now + i,
          now + i,
        );
      }
      const list = await loadTemplatesFullTree(db, 3);
      expect(list).toHaveLength(3);
      // listTemplates orders by updated_at DESC → tpl-4 first.
      expect(list[0].templateId).toBe('tpl-4');
      expect(list[2].templateId).toBe('tpl-2');
    });

    it('defaults to 20 templates max (fat-tree size-budget invariant)', async () => {
      const now = 1_700_000_000_000;
      for (let i = 0; i < 25; i++) {
        await db.runAsync(
          `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
           VALUES (?, ?, ?, ?, NULL, NULL)`,
          `tpl-${i}`,
          `Template ${i}`,
          now + i,
          now + i,
        );
      }
      const list = await loadTemplatesFullTree(db);
      expect(list).toHaveLength(20);
    });

    it('exercises arrive in template_exercise.ordering ASC even when inserted in reverse order', async () => {
      const now = 1_700_000_000_000;
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
         VALUES (?, ?, ?, ?, NULL, NULL)`,
        'tpl-ord',
        'Order',
        now,
        now,
      );
      // Insert ordering=2 first, ordering=1 second.
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-second',
        'tpl-ord',
        BENCH,
        2,
        3,
        null,
        null,
      );
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-first',
        'tpl-ord',
        BENCH,
        1,
        3,
        null,
        null,
      );
      const list = await loadTemplatesFullTree(db);
      expect(list[0].exercises.map((e) => e.templateExerciseId)).toEqual([
        'te-first',
        'te-second',
      ]);
    });
  });

  // -------------------------------------------------------------------
  // fetchSessionSnapshot
  // -------------------------------------------------------------------

  describe('fetchSessionSnapshot', () => {
    it('returns null when sessionId does not exist (Watch held stale id)', async () => {
      const snap = await fetchSessionSnapshot(db, 'sess-missing');
      expect(snap).toBeNull();
    });

    it('returns empty exercises[] for a bare freestyle session with no plan', async () => {
      await createSession(db, {
        id: 'sess-bare',
        started_at: 1_700_000_000_000,
      });
      const snap = await fetchSessionSnapshot(db, 'sess-bare');
      expect(snap).not.toBeNull();
      expect(snap?.sessionId).toBe('sess-bare');
      expect(snap?.title).toBe('');
      expect(snap?.exercises).toEqual([]);
    });

    it('hydrates exercises + sets (with column renames at the wire boundary)', async () => {
      await createSession(db, {
        id: 'sess-full',
        started_at: 1_700_000_000_000,
        title: 'Pull Day',
      });
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-full',
        exercise_id: BENCH,
      });
      // Seed two sets attached to se-1.
      await insertSessionSet(db, {
        id: 'set-1',
        session_id: 'sess-full',
        exercise_id: BENCH,
        weight_kg: 100,
        reps: 5,
        is_skipped: 0,
        ordering: 1,
        created_at: 1_700_000_000_001,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: 'se-1',
      });
      await insertSessionSet(db, {
        id: 'set-2',
        session_id: 'sess-full',
        exercise_id: BENCH,
        weight_kg: 105,
        reps: 4,
        is_skipped: 0,
        ordering: 2,
        created_at: 1_700_000_000_002,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: 'se-1',
      });

      const snap = await fetchSessionSnapshot(db, 'sess-full');
      expect(snap?.title).toBe('Pull Day');
      expect(snap?.exercises).toHaveLength(1);
      const ex = snap?.exercises[0];
      expect(ex?.exerciseId).toBe(BENCH);
      // Bug Y (task #271) — localised at the wire boundary (zh default).
      expect(ex?.exerciseName).toBe('槓鈴臥推');
      expect(ex?.sets).toHaveLength(2);
      // Column renames at the wire boundary:
      //   weight_kg → weight
      //   ordering  → ordinal
      //   is_logged (number 0/1) → is_logged (boolean)
      expect(ex?.sets[0].weight).toBe(100);
      expect(ex?.sets[0].ordinal).toBe(1);
      expect(ex?.sets[0].is_logged).toBe(false);
      expect(ex?.sets[1].weight).toBe(105);
      expect(ex?.sets[1].ordinal).toBe(2);
      // rpe + rest_sec defaults — no schema column for rpe yet; rest_sec
      // denormalises from session_exercise (null when unset).
      expect(ex?.sets[0].rpe).toBeNull();
      expect(ex?.sets[0].rest_sec).toBeNull();
    });

    it('drops sets whose session_exercise_id is null (legacy backfill miss)', async () => {
      await createSession(db, {
        id: 'sess-orphan',
        started_at: 1_700_000_000_000,
      });
      await appendSessionExercise(db, {
        id: 'se-orphan',
        session_id: 'sess-orphan',
        exercise_id: BENCH,
      });
      // Orphan set — has session_exercise_id explicitly NULL.
      await insertSessionSet(db, {
        id: 'set-orphan',
        session_id: 'sess-orphan',
        exercise_id: BENCH,
        weight_kg: 50,
        reps: 5,
        is_skipped: 0,
        ordering: 1,
        created_at: 1_700_000_000_001,
        set_kind: 'working',
        parent_set_id: null,
        session_exercise_id: null,
      });
      const snap = await fetchSessionSnapshot(db, 'sess-orphan');
      // Exercise card hydrates with empty sets[] — the orphan set is dropped.
      expect(snap?.exercises[0].sets).toEqual([]);
    });

    it('handles null-valued set fields (placeholder rows pre-logging)', async () => {
      await createSession(db, {
        id: 'sess-warmup',
        started_at: 1_700_000_000_000,
      });
      await appendSessionExercise(db, {
        id: 'se-1',
        session_id: 'sess-warmup',
        exercise_id: BENCH,
      });
      await insertSessionSet(db, {
        id: 'set-warm',
        session_id: 'sess-warmup',
        exercise_id: BENCH,
        weight_kg: null,
        reps: null,
        is_skipped: 0,
        ordering: 1,
        created_at: 1_700_000_000_001,
        set_kind: 'warmup',
        parent_set_id: null,
        session_exercise_id: 'se-1',
      });
      const snap = await fetchSessionSnapshot(db, 'sess-warmup');
      const set0 = snap?.exercises[0].sets[0];
      expect(set0?.weight).toBeNull();
      expect(set0?.reps).toBeNull();
      expect(set0?.set_kind).toBe('warmup');
    });
  });
});

// =====================================================================
// Orchestrators — onHandshakeRequest (wire-in)
// =====================================================================

describe('WC handshake — onHandshakeRequest (orchestrator, NEW-Q50 fat-tree)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (requestId = 'req-1'): WCMessage & {
    kind: 'handshake';
    payload: HandshakePayload;
  } =>
    makeEnvelope('handshake', {
      requestId,
      clientVersion: '13d.0',
    } satisfies HandshakePayload);

  it('replies with hasActiveSession=false on an empty DB', async () => {
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    expect(replies).toHaveLength(1);
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.requestId).toBe('req-1');
    expect(reply.hasActiveSession).toBe(false);
    expect(reply.prefetch.templates).toEqual([]);
  });

  it('replies with hasActiveSession=true + session summary + fat-tree templates when both are present', async () => {
    await createSession(db, {
      id: 'sess-x',
      started_at: 1_700_000_000_000,
      title: 'Push',
    });
    await appendSessionExercise(db, {
      id: 'se-1',
      session_id: 'sess-x',
      exercise_id: BENCH,
    });
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-1',
      'My Template',
      1_700_000_000_000,
      1_700_000_000_000,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-x',
      'tpl-1',
      BENCH,
      1,
      3,
      8,
      60,
    );

    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv('req-X'), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;

    expect(reply.requestId).toBe('req-X');
    expect(reply.hasActiveSession).toBe(true);
    if (reply.hasActiveSession) {
      expect(reply.session.sessionId).toBe('sess-x');
      expect(reply.session.title).toBe('Push');
      expect(reply.session.exerciseCount).toBe(1);
    }
    expect(reply.prefetch.templates).toHaveLength(1);
    expect(reply.prefetch.templates[0].templateId).toBe('tpl-1');
    expect(reply.prefetch.templates[0].name).toBe('My Template');
    // Fat tree — exercises[] populated from JOIN.
    expect(reply.prefetch.templates[0].exercises).toHaveLength(1);
    expect(reply.prefetch.templates[0].exercises[0]).toEqual({
      templateExerciseId: 'te-x',
      exerciseId: BENCH,
      // Bug Y (task #271) — localised at the wire boundary (zh default).
      exerciseName: '槓鈴臥推',
      ordering: 1,
      defaultSets: 3,
      defaultReps: 8,
      defaultWeightKg: 60,
      // F5 (2026-06-12) — solo row: parentId / reusableSupersetId are
      // absent keys (wire null rule).
      // 2026-05-29 SetLogger sets[] fix — loader returns empty
      // sets[] when no template_set rows exist for this exercise.
      sets: [],
    });
  });

  it('silently drops the request when replyHandler is undefined (lib bug / TUI fallback)', async () => {
    await expect(
      onHandshakeRequest(db, buildEnv(), undefined),
    ).resolves.toBeUndefined();
  });

  // Slice 17 (ADR-0027 D5) — the reply mirrors the user's edited rep-bucket
  // ranges from the live in-memory cache so the Watch's bucket labels match
  // the iPhone. The cache is module-global, so reset after the edit case to
  // avoid leaking into sibling suites.
  describe('Slice 17 — bucketRanges in the reply (live cache)', () => {
    afterEach(() => {
      resetBucketRanges();
    });

    it('includes the live (default) bucketRanges in the reply prefetch', async () => {
      const replies: Record<string, unknown>[] = [];
      await onHandshakeRequest(db, buildEnv('req-bk'), (r) => replies.push(r));
      const reply = replies[0] as unknown as Stage1ReplyPayload;
      // Default v1 ranges, top bucket max OMITTED per the wire null rule.
      expect(reply.prefetch.bucketRanges).toEqual([
        { key: 'max_strength', min: 1, max: 3 },
        { key: 'strength', min: 4, max: 6 },
        { key: 'hypertrophy', min: 7, max: 10 },
        { key: 'muscle_endurance', min: 11, max: 15 },
        { key: 'endurance', min: 16 },
      ]);
    });

    it('reflects USER edits applied to the live cache (the core slice-17 contract)', async () => {
      // Simulate the Settings editor having shifted the ranges.
      applyBucketRanges([
        { key: 'max_strength', min: 1, max: 2 },
        { key: 'strength', min: 3, max: 5 },
        { key: 'hypertrophy', min: 6, max: 12 },
        { key: 'muscle_endurance', min: 13, max: 20 },
        { key: 'endurance', min: 21, max: null },
      ]);
      // Sanity — the cache took the edit.
      expect(getBucketBoundaries()[2]).toEqual({
        key: 'hypertrophy',
        min: 6,
        max: 12,
      });

      const replies: Record<string, unknown>[] = [];
      await onHandshakeRequest(db, buildEnv('req-edited'), (r) =>
        replies.push(r),
      );
      const reply = replies[0] as unknown as Stage1ReplyPayload;
      expect(reply.prefetch.bucketRanges).toEqual([
        { key: 'max_strength', min: 1, max: 2 },
        { key: 'strength', min: 3, max: 5 },
        { key: 'hypertrophy', min: 6, max: 12 },
        { key: 'muscle_endurance', min: 13, max: 20 },
        { key: 'endurance', min: 21 },
      ]);
    });

    it('still carries the live ranges on the degraded (DB-throw) fallback reply', async () => {
      // getBucketBoundaries() is a pure in-memory read → survives a DB throw.
      db.close();
      const replies: Record<string, unknown>[] = [];
      await onHandshakeRequest(db, buildEnv('req-bk-err'), (r) =>
        replies.push(r),
      );
      const reply = replies[0] as unknown as Stage1ReplyPayload;
      expect(reply.hasActiveSession).toBe(false);
      expect(reply.prefetch.bucketRanges).toEqual([
        { key: 'max_strength', min: 1, max: 3 },
        { key: 'strength', min: 4, max: 6 },
        { key: 'hypertrophy', min: 7, max: 10 },
        { key: 'muscle_endurance', min: 11, max: 15 },
        { key: 'endurance', min: 16 },
      ]);
      // Re-open before afterEach.close() runs (harmless re-close otherwise).
      db = new BetterSqliteDatabase(':memory:');
      await migrate(db);
    });
  });

  it('falls back to empty fat-tree reply when the DB read throws (best-effort semantics)', async () => {
    db.close();
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv('req-err'), (r) => replies.push(r));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toEqual({
      requestId: 'req-err',
      hasActiveSession: false,
      prefetch: {
        templates: [],
        programs: [],
        todayPlanned: { kind: 'noActiveProgram' },
        // Slice 17 (ADR-0027 D5) — bucketRanges ride the degraded fallback
        // too (pure in-memory read survives the DB throw). Default v1 ranges
        // here (no test in this block mutates the live cache without reset).
        bucketRanges: [
          { key: 'max_strength', min: 1, max: 3 },
          { key: 'strength', min: 4, max: 6 },
          { key: 'hypertrophy', min: 7, max: 10 },
          { key: 'muscle_endurance', min: 11, max: 15 },
          { key: 'endurance', min: 16 },
        ],
      },
    });
    // Re-open before afterEach.close() runs (harmless re-close otherwise).
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
});

// =====================================================================
// Orchestrators — onStartFromWatch (NEW-Q50 D28 rewrite)
// =====================================================================

describe('WC handshake — onStartFromWatch (NEW-Q50 D28 reverse-TUI reconcile)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (
    payload: StartFromWatchPayload,
  ): WCMessage & {
    kind: 'start-from-watch';
    payload: StartFromWatchPayload;
  } => makeEnvelope('start-from-watch', payload);

  it('NEW-Q50 happy path — inserts a new session with the Watch-supplied id + replies created', async () => {
    const reconciles: StartFromWatchReconcile[] = [];
    const watchUuid = 'W-deadbeef-0001';
    await onStartFromWatch(
      db,
      buildEnv({
        templateId: null,
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
    );

    // Reverse-TUI reply.
    expect(reconciles).toEqual([
      { status: 'created', sessionId: watchUuid },
    ]);
    // DB landed the Watch-supplied id verbatim + flipped tracking flag.
    const active = await getActiveSession(db);
    expect(active?.id).toBe(watchUuid);
    expect(active?.is_watch_tracked).toBe(true);
  });

  it('NEW-Q50 dedup — same Watch-supplied sessionId arriving twice is a no-op INSERT (idempotent)', async () => {
    const reconciles: StartFromWatchReconcile[] = [];
    const watchUuid = 'W-deadbeef-dedup';

    // First delivery: creates the row.
    await onStartFromWatch(
      db,
      buildEnv({
        templateId: null,
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
    );

    // Second delivery (TUI at-least-once replay or applicationContext
    // race): MUST not create a duplicate row, MUST reply 'created'.
    await onStartFromWatch(
      db,
      buildEnv({
        templateId: null,
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
    );

    expect(reconciles).toEqual([
      { status: 'created', sessionId: watchUuid },
      { status: 'created', sessionId: watchUuid },
    ]);
    // Exactly one row exists for that id.
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM session WHERE id = ?`,
      watchUuid,
    );
    expect(rows).toHaveLength(1);
    // is_watch_tracked still true (idempotent flip).
    const session = await getSession(db, watchUuid);
    expect(session?.is_watch_tracked).toBe(true);
  });

  it('NEW-Q50 conflict — iPhone already has a different active session → reply conflict, no INSERT', async () => {
    await createSession(db, {
      id: 'I-existing-001',
      started_at: 1_700_000_000_000,
      title: 'Existing iPhone Session',
    });
    const watchUuid = 'W-deadbeef-loser';
    const reconciles: StartFromWatchReconcile[] = [];
    await onStartFromWatch(
      db,
      buildEnv({
        templateId: null,
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
    );

    // Reverse-TUI 'conflict' with existing session metadata so the
    // Watch can render its alert sheet (D31).
    expect(reconciles).toEqual([
      {
        status: 'conflict',
        sessionId: watchUuid,
        existingSessionId: 'I-existing-001',
        existingTitle: 'Existing iPhone Session',
        existingStartedAt: 1_700_000_000_000,
      },
    ]);
    // Watch-supplied session NOT inserted.
    const lostRow = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM session WHERE id = ?`,
      watchUuid,
    );
    // getFirstAsync returns null for no-row (better-sqlite3 + expo-sqlite
    // both follow this convention).
    expect(lostRow).toBeNull();
    // Pre-existing session untouched — is_watch_tracked stays false
    // (still iPhone-only).
    const pre = await getSession(db, 'I-existing-001');
    expect(pre?.is_watch_tracked).toBe(false);
  });

  it('NEW-Q50 race recovery — if the supplied id IS the already-active session (e.g. applicationContext mirror beat TUI to insert), reply created + flip tracked', async () => {
    const watchUuid = 'W-deadbeef-mirror-race';
    // Simulate: applicationContext mirror landed first and inserted
    // the row, leaving is_watch_tracked at default 0. The subsequent
    // start-from-watch TUI delivery for the same id must:
    //   - not throw
    //   - reply 'created'
    //   - flip is_watch_tracked to true
    await createSession(db, {
      id: watchUuid,
      started_at: 1_700_000_000_000,
      title: '',
    });
    const reconciles: StartFromWatchReconcile[] = [];
    await onStartFromWatch(
      db,
      buildEnv({
        templateId: null,
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
    );
    expect(reconciles).toEqual([
      { status: 'created', sessionId: watchUuid },
    ]);
    const session = await getSession(db, watchUuid);
    expect(session?.is_watch_tracked).toBe(true);
  });

  it('NEW-Q50 degraded wire — empty/missing payload.sessionId logs + replies created with empty id, no DB write', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const reconciles: StartFromWatchReconcile[] = [];
      await onStartFromWatch(
        db,
        buildEnv({
          templateId: null,
          programCycleId: null,
          intensityId: null,
          sessionId: '',
        }),
        (r) => reconciles.push(r),
      );
      expect(reconciles).toEqual([{ status: 'created', sessionId: '' }]);
      expect(warnSpy).toHaveBeenCalled();
      // No active session was created.
      const active = await getActiveSession(db);
      expect(active).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('NEW-Q50 best-effort — DB throw on the create path does NOT send a misleading created reply', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      db.close();
      const reconciles: StartFromWatchReconcile[] = [];
      await onStartFromWatch(
        db,
        buildEnv({
          templateId: null,
          programCycleId: null,
          intensityId: null,
          sessionId: 'W-after-close',
        }),
        (r) => reconciles.push(r),
      );
      // No reconcile reply (can't truthfully claim 'created' after a throw).
      expect(reconciles).toEqual([]);
      expect(warnSpy).toHaveBeenCalled();
      // Re-open before afterEach.close() runs.
      db = new BetterSqliteDatabase(':memory:');
      await migrate(db);
    } finally {
      warnSpy.mockRestore();
    }
  });

  // -------------------------------------------------------------------
  // 2026-05-29 deep-night smoke fix (B2) — templateId branch coverage.
  // Pre-fix: onStartFromWatch ignored env.payload.templateId entirely
  // and always createSession with title=''. iPhone in-progress banner
  // displayed 「空白訓練」 even when the Watch picked a real template.
  // Post-fix: when templateId + uuid factory are both supplied, the
  // orchestrator delegates to startSessionFromTemplate which:
  //   - sets session.title = template.name
  //   - inserts session_exercise rows from template_exercise
  //   - inserts session_set rows from template_set
  // All keyed on the Watch-supplied sessionId (first-write-wins).
  // -------------------------------------------------------------------
  it('NEW-Q50 B2 fix — templateId + uuid supplied → session.title = template.name + session_exercise rows materialised', async () => {
    // Seed a template with 2 template_exercise rows so we can assert
    // the session_exercise tree gets copied verbatim.
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-pushday',
      '推日（A）',
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-1',
      'tpl-pushday',
      BENCH,
      1,
      3,
      8,
      60,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-2',
      'tpl-pushday',
      BENCH,
      2,
      4,
      6,
      80,
    );

    const watchUuid = 'W-pushday-001';
    const reconciles: StartFromWatchReconcile[] = [];
    // Deterministic uuid sequence for asserting session_exercise IDs.
    let counter = 0;
    const fakeUuid = () => `uuid-${++counter}`;

    await onStartFromWatch(
      db,
      makeEnvelope('start-from-watch', {
        templateId: 'tpl-pushday',
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
      fakeUuid,
    );

    // Reverse-TUI ack uses the Watch-supplied sessionId.
    expect(reconciles).toEqual([
      { status: 'created', sessionId: watchUuid },
    ]);

    // Session header — title pulled from template.name (NOT '').
    const active = await getActiveSession(db);
    expect(active?.id).toBe(watchUuid);
    expect(active?.title).toBe('推日（A）');
    expect(active?.is_watch_tracked).toBe(true);

    // session_exercise rows materialised from template_exercise.
    const seRows = await db.getAllAsync<{
      id: string;
      exercise_id: string;
      ordering: number;
    }>(
      `SELECT id, exercise_id, ordering
         FROM session_exercise
        WHERE session_id = ?
        ORDER BY ordering ASC`,
      watchUuid,
    );
    expect(seRows).toHaveLength(2);
    expect(seRows[0].exercise_id).toBe(BENCH);
    expect(seRows[0].ordering).toBe(1);
    expect(seRows[1].ordering).toBe(2);
  });

  it('NEW-Q50 B2 fix — templateId supplied but uuid factory omitted → falls back to empty freestyle session (no throw)', async () => {
    // Test the defensive fallback path. If wire-in forgets to pass
    // uuid, we must NOT throw; just create an empty freestyle row
    // so the Watch UI flow doesn't hang (degraded UX, but stable).
    const watchUuid = 'W-degraded-001';
    const reconciles: StartFromWatchReconcile[] = [];
    await onStartFromWatch(
      db,
      makeEnvelope('start-from-watch', {
        templateId: 'tpl-anything',
        programCycleId: null,
        intensityId: null,
        sessionId: watchUuid,
      }),
      (r) => reconciles.push(r),
      // uuid intentionally omitted
    );
    expect(reconciles).toEqual([
      { status: 'created', sessionId: watchUuid },
    ]);
    const active = await getActiveSession(db);
    expect(active?.id).toBe(watchUuid);
    expect(active?.title).toBe('');
  });

  // -------------------------------------------------------------------
  // Sample envelope kept for typing — exercise the protocol surface.
  // -------------------------------------------------------------------
  it('typed StartFromWatchPayload sample envelope round-trips through makeEnvelope', () => {
    const sample: StartFromWatchPayload = {
      templateId: 'tpl-1',
      programCycleId: 'cyc-1',
      intensityId: 'int-1',
      sessionId: 'W-roundtrip',
    };
    const env = makeEnvelope('start-from-watch', sample);
    expect(env.kind).toBe('start-from-watch');
    expect(env.payload).toEqual(sample);
  });
});

// =====================================================================
// Phase 2.5 — Stage 1 reply extension (programs + intensities + todayPlanned)
// =====================================================================

describe('Phase 2.5 — buildStage1Reply with programs + todayPlanned (pure)', () => {
  const sampleRequest: HandshakePayload = {
    requestId: 'req-25',
    clientVersion: '13d.0',
  };

  it('omits programs / todayPlanned from prefetch when not provided (forward-compat with pre-2.5 callers)', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);
    expect(reply.prefetch.templates).toEqual([]);
    expect(reply.prefetch.programs).toBeUndefined();
    expect(reply.prefetch.todayPlanned).toBeUndefined();
  });

  it('carries programs with inline intensities verbatim into the prefetch', () => {
    const programs: Stage1ProgramSummary[] = [
      {
        id: 'p1',
        name: 'Linear progression',
        intensities: [
          { id: '12RM', name: '12RM' },
          { id: '10RM', name: '10RM' },
        ],
      },
      {
        id: 'p2',
        name: 'PPL',
        intensities: [],
      },
    ];
    const reply = buildStage1Reply(sampleRequest, null, [], programs);
    expect(reply.prefetch.programs).toHaveLength(2);
    expect(reply.prefetch.programs?.[0]).toEqual({
      id: 'p1',
      name: 'Linear progression',
      intensities: [
        { id: '12RM', name: '12RM' },
        { id: '10RM', name: '10RM' },
      ],
    });
    expect(reply.prefetch.programs?.[1].intensities).toEqual([]);
  });

  it('carries todayPlanned discriminated-union variants verbatim (NEW-Q50 fat tree)', () => {
    const planned = buildStage1Reply(sampleRequest, null, [], [], {
      kind: 'planned',
      label: '推日 W3D1（今日）',
      // #7 — structured 2-line fields.
      templateName: '推日',
      programName: 'PPL',
      intensity: '12RM',
      programDayId: 'cell-1',
      templateId: 'tpl-1',
      exercises: [
        {
          templateExerciseId: 'te-p-1',
          exerciseId: BENCH,
          exerciseName: 'Bench Press',
          ordering: 1,
          defaultSets: 3,
          defaultReps: 8,
          defaultWeightKg: 60,
          // 2026-05-29 SetLogger sets[] fix — required field; empty
          // here (todayPlanned fixture path doesn't seed sets).
          sets: [],
        },
      ],
    });
    expect(planned.prefetch.todayPlanned?.kind).toBe('planned');
    if (planned.prefetch.todayPlanned?.kind === 'planned') {
      expect(planned.prefetch.todayPlanned.label).toBe('推日 W3D1（今日）');
      expect(planned.prefetch.todayPlanned.programDayId).toBe('cell-1');
      expect(planned.prefetch.todayPlanned.templateId).toBe('tpl-1');
      expect(planned.prefetch.todayPlanned.exercises).toHaveLength(1);
    }

    const restDay = buildStage1Reply(sampleRequest, null, [], [], {
      kind: 'restDay',
    });
    expect(restDay.prefetch.todayPlanned).toEqual({ kind: 'restDay' });

    const noProgram = buildStage1Reply(sampleRequest, null, [], [], {
      kind: 'noActiveProgram',
    });
    expect(noProgram.prefetch.todayPlanned).toEqual({
      kind: 'noActiveProgram',
    });
  });
});

describe('Slice 16 / ADR-0026 D2 — buildStage1Reply appMode flag (pure)', () => {
  const sampleRequest: HandshakePayload = {
    requestId: 'req-16',
    clientVersion: '16.0',
  };

  it('omits appMode from prefetch when the param is absent (forward-compat → Watch defaults to plan)', () => {
    const reply = buildStage1Reply(sampleRequest, null, []);
    expect(reply.prefetch.appMode).toBeUndefined();
  });

  it("carries appMode: 'minimal' into the prefetch verbatim", () => {
    // Integration 2026-06-20: appMode is the 7th positional arg (slice 17's
    // bucketRanges is the 6th, landed on main first); pass `undefined` for the
    // bucketRanges slot.
    const reply = buildStage1Reply(
      sampleRequest,
      null,
      [],
      undefined,
      undefined,
      undefined,
      'minimal',
    );
    expect(reply.prefetch.appMode).toBe('minimal');
  });

  it("carries appMode: 'plan' into the prefetch verbatim", () => {
    const reply = buildStage1Reply(
      sampleRequest,
      null,
      [],
      undefined,
      undefined,
      undefined,
      'plan',
    );
    expect(reply.prefetch.appMode).toBe('plan');
  });

  it('preserves appMode alongside an active session (hasActiveSession branch)', () => {
    const active: Stage1SessionSummary = {
      sessionId: 's-1',
      startedAt: 1_700_000_000_000,
      title: 'Push Day',
      exerciseCount: 0,
    };
    const reply = buildStage1Reply(
      sampleRequest,
      active,
      [],
      undefined,
      undefined,
      undefined,
      'minimal',
    );
    expect(reply.hasActiveSession).toBe(true);
    expect(reply.prefetch.appMode).toBe('minimal');
  });
});

describe('Slice 16 / ADR-0026 D2 — onHandshakeRequest wires appMode (orchestrator)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (requestId = 'req-1'): WCMessage & {
    kind: 'handshake';
    payload: HandshakePayload;
  } =>
    makeEnvelope('handshake', {
      requestId,
      clientVersion: '16.0',
    } satisfies HandshakePayload);

  it("defaults reply prefetch appMode to 'plan' on an unset (fresh) DB", async () => {
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.prefetch.appMode).toBe('plan');
  });

  it("reply prefetch carries appMode: 'minimal' when the DB is in minimal mode", async () => {
    await setAppMode(db, 'minimal');
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.prefetch.appMode).toBe('minimal');
  });

  it("reply prefetch carries appMode: 'plan' when the DB is explicitly in plan mode", async () => {
    await setAppMode(db, 'plan');
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.prefetch.appMode).toBe('plan');
  });
});

describe('Phase 2.5 — loadProgramsPrefetchList (impure, in-memory SQLite)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty array when only the reserved「無」 program exists (v017 seed)', async () => {
    const list = await loadProgramsPrefetchList(db);
    expect(list).toEqual([]);
  });

  it('projects programs with sub_tags UNIONed from templates + dictionary', async () => {
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-user',
      'My Program',
      null,
      7,
      4,
      '2025-01-01',
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-1',
      'Push',
      now,
      now,
      'p-user',
      '12RM',
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-2',
      'Pull',
      now,
      now,
      'p-user',
      '10RM',
    );
    await db.runAsync(
      `INSERT INTO program_sub_tag (program_id, sub_tag, created_at) VALUES (?, ?, ?)`,
      'p-user',
      '8RM',
      now,
    );

    const list = await loadProgramsPrefetchList(db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('p-user');
    expect(list[0].name).toBe('My Program');
    expect(list[0].intensities.map((i) => i.id)).toEqual(['10RM', '12RM', '8RM']);
  });

  it('dedupes sub_tags that appear in BOTH the template scan and the dictionary', async () => {
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-x',
      'X',
      null,
      7,
      1,
      '2025-01-01',
      0,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-dup',
      'Dup',
      now,
      now,
      'p-x',
      'DupTag',
    );
    await db.runAsync(
      `INSERT INTO program_sub_tag (program_id, sub_tag, created_at) VALUES (?, ?, ?)`,
      'p-x',
      'DupTag',
      now,
    );
    const list = await loadProgramsPrefetchList(db);
    expect(list[0].intensities).toEqual([{ id: 'DupTag', name: 'DupTag' }]);
  });

  it('respects the limit parameter (caps to N most-recent)', async () => {
    const now = 1_700_000_000_000;
    for (let i = 0; i < 15; i++) {
      await db.runAsync(
        `INSERT INTO program
           (id, name, main_tag, cycle_length, cycle_count, start_date,
            is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        `p-${i}`,
        `Program ${i}`,
        null,
        7,
        1,
        '2025-01-01',
        0,
        now + i,
        now + i,
      );
    }
    const list = await loadProgramsPrefetchList(db, 10);
    expect(list).toHaveLength(10);
  });
});

describe('Phase 2.5 + NEW-Q50 D28 — loadTodayPlanned (impure, fat tree)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns noActiveProgram when no user program is active', async () => {
    const today = await loadTodayPlanned(db);
    expect(today).toEqual({ kind: 'noActiveProgram' });
  });

  it('returns restDay when the active program has no cell for today', async () => {
    const now = 1_700_000_000_000;
    const todayIso = '2025-06-15';
    const todayMs = Date.UTC(2025, 5, 15);
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-active',
      'Active',
      null,
      7,
      1,
      todayIso,
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'c-1',
      'p-active',
      0,
      2,
    );
    const today = await loadTodayPlanned(db, todayMs);
    expect(today).toEqual({ kind: 'restDay' });
  });

  it('NEW-Q50 D28 — returns planned with label + programDayId + templateId + fat exercise tree', async () => {
    const now = 1_700_000_000_000;
    const todayIso = '2025-06-15';
    const todayMs = Date.UTC(2025, 5, 15);
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-act',
      'Act',
      null,
      7,
      1,
      todayIso,
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-push',
      '推日',
      now,
      now,
      'p-act',
      '12RM',
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-push-1',
      'tpl-push',
      BENCH,
      1,
      4,
      8,
      70,
    );
    // Cell at cycle 0 / day 0 (today) — pointing at tpl-push.
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'cell-today',
      'p-act',
      0,
      0,
      'tpl-push',
      '12RM',
    );
    const today = await loadTodayPlanned(db, todayMs);
    expect(today.kind).toBe('planned');
    if (today.kind === 'planned') {
      expect(today.programDayId).toBe('cell-today');
      expect(today.templateId).toBe('tpl-push');
      expect(today.label).toContain('推日');
      expect(today.label).toContain('（今日）');
      expect(today.label).toContain('W1D1');
      expect(today.label).toContain('12RM');
      // #7 — structured 2-line fields (templateName / programName / intensity).
      expect(today.templateName).toBe('推日');
      expect(today.programName).toBe('Act');
      expect(today.intensity).toBe('12RM');
      // NEW-Q50 D28 — fat exercise tree projected onto the planned variant.
      expect(today.exercises).toHaveLength(1);
      expect(today.exercises[0]).toEqual({
        templateExerciseId: 'te-push-1',
        exerciseId: BENCH,
        // Bug Y (task #271) — localised at the wire boundary (zh default).
        exerciseName: '槓鈴臥推',
        ordering: 1,
        defaultSets: 4,
        defaultReps: 8,
        defaultWeightKg: 70,
        // F5 (2026-06-12) — solo row: parentId / reusableSupersetId are
        // absent keys (wire null rule).
        // 2026-05-29 SetLogger sets[] fix — no template_set rows
        // seeded for this fixture, so loader returns sets: [].
        sets: [],
      });
    }
  });

  it('falls back to restDay when the today cell points at a deleted template', async () => {
    const now = 1_700_000_000_000;
    const todayIso = '2025-06-15';
    const todayMs = Date.UTC(2025, 5, 15);
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-ghost',
      'Ghost',
      null,
      7,
      1,
      todayIso,
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-will-die',
      'Doomed',
      now,
      now,
      'p-ghost',
      null,
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'cell-ghost',
      'p-ghost',
      0,
      0,
      'tpl-will-die',
      null,
    );
    await db.runAsync(`PRAGMA foreign_keys = OFF`);
    await db.runAsync(`DELETE FROM template WHERE id = ?`, 'tpl-will-die');
    await db.runAsync(`PRAGMA foreign_keys = ON`);
    const today = await loadTodayPlanned(db, todayMs);
    expect(today).toEqual({ kind: 'restDay' });
  });
});

describe('Phase 2.5 — onHandshakeRequest wires programs + todayPlanned (orchestrator)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const buildEnv = (requestId = 'req-1'): WCMessage & {
    kind: 'handshake';
    payload: HandshakePayload;
  } =>
    makeEnvelope('handshake', {
      requestId,
      clientVersion: '13d.0',
    } satisfies HandshakePayload);

  it('reply prefetch carries programs: [] + todayPlanned: noActiveProgram on an empty DB', async () => {
    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.prefetch.programs).toEqual([]);
    expect(reply.prefetch.todayPlanned).toEqual({ kind: 'noActiveProgram' });
  });

  it('reply prefetch carries real programs (from DB) — todayPlanned shape always present', async () => {
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'p-real',
      'Real Program',
      null,
      7,
      1,
      '2025-01-01',
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'tpl-r',
      'PushDay',
      now,
      now,
      'p-real',
      'A',
    );

    const replies: Record<string, unknown>[] = [];
    await onHandshakeRequest(db, buildEnv(), (r) => replies.push(r));
    const reply = replies[0] as unknown as Stage1ReplyPayload;
    expect(reply.prefetch.programs).toHaveLength(1);
    expect(reply.prefetch.programs?.[0]).toEqual({
      id: 'p-real',
      name: 'Real Program',
      intensities: [{ id: 'A', name: 'A' }],
    });
    expect(reply.prefetch.todayPlanned).toBeDefined();
    expect(['planned', 'restDay', 'noActiveProgram']).toContain(
      reply.prefetch.todayPlanned?.kind,
    );
  });
});

// =====================================================================
// Bug Y (task #271) — exercise-name localisation at the wire boundary
// =====================================================================
//
// The DB stores v001 seed exercise names as English literals; the iPhone
// app localises via `tExercise()` at render time. The Watch has no i18n
// table for seed names, so before this fix the raw English value crossed
// the WC handshake wire and the Watch picker showed English names even
// when the iPhone was in 中文. The fix localises in the iPhone wire
// builders (`loadTemplateExerciseTree` → Stage 1 prefetch, and
// `fetchSessionSnapshot` → dormant snapshot push). These tests lock the
// behaviour for BOTH locales (the other cases above only prove the zh
// default) + the custom-name passthrough.
describe('WC handshake — Bug Y exercise-name localisation (task #271)', () => {
  let db: BetterSqliteDatabase;
  let savedLocale: ReturnType<typeof getLocale>;
  // A custom (non-seed) exercise name has no entry in the i18n dict, so
  // `tExercise` falls back to the verbatim value in EVERY locale.
  const CUSTOM = '00000000-0000-4000-8000-0000000000ff';
  const CUSTOM_NAME = 'Zercher Carry (custom)';

  beforeEach(async () => {
    savedLocale = getLocale();
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin) VALUES (?, ?, ?, ?)`,
      CUSTOM,
      CUSTOM_NAME,
      'loaded',
      0,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-locale',
      'Locale Template',
      now,
      now,
    );
    // ex 0 = seeded Bench Press (in the i18n dict), ex 1 = custom.
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-bench',
      'tpl-locale',
      BENCH,
      1,
      3,
      8,
      60,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      'te-custom',
      'tpl-locale',
      CUSTOM,
      2,
      3,
      8,
      60,
    );
  });

  afterEach(() => {
    // Locale is module-global — restore so a flipped 'en' never leaks
    // into a later test in this file.
    setLocale(savedLocale);
  });

  it('zh locale — seed name is localised, custom name passes through', async () => {
    setLocale('zh');
    const list = await loadTemplatesFullTree(db);
    expect(list[0].exercises[0].exerciseName).toBe('槓鈴臥推');
    expect(list[0].exercises[1].exerciseName).toBe(CUSTOM_NAME);
  });

  it('en locale — seed name stays English, custom name passes through', async () => {
    setLocale('en');
    const list = await loadTemplatesFullTree(db);
    expect(list[0].exercises[0].exerciseName).toBe('Bench Press');
    expect(list[0].exercises[1].exerciseName).toBe(CUSTOM_NAME);
  });

  it('fetchSessionSnapshot localises the same way (dormant push path)', async () => {
    setLocale('zh');
    await createSession(db, {
      id: 'sess-locale',
      started_at: 1_700_000_000_000,
      title: 'Push',
    });
    await appendSessionExercise(db, {
      id: 'se-locale',
      session_id: 'sess-locale',
      exercise_id: BENCH,
      planned_sets: 3,
    });
    const snap = await fetchSessionSnapshot(db, 'sess-locale');
    expect(snap?.exercises[0].exerciseName).toBe('槓鈴臥推');
  });
});

// =====================================================================
// F5 (2026-06-12, audit F5 後半) — Stage1 reply wire null-safety.
//
// The wire null rule (`wc-add-envelope-kind` skill): reply builders must
// never emit an explicit `null` — nullable fields use '' sentinels or
// OMIT the key. Dict-field nulls only survive today because RN's JSI
// dict conversion drops them (feature-flag dependent: a flipped default
// would turn every explicit null into NSNull → WCSession 7010 reject —
// and the handshake reply is the Watch picker's lifeline). These tests
// pin the builder outputs so a reintroduced `null` fails CI instead of
// waiting for an RN upgrade to detonate it.
// =====================================================================

describe('F5 — Stage1 reply wire null-safety (recursive no-null scan)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  /** Collect JSONPath-ish locations of every `null` value in a tree. */
  const collectNullPaths = (
    value: unknown,
    path = '$',
    out: string[] = [],
  ): string[] => {
    if (value === null) {
      out.push(path);
      return out;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => collectNullPaths(v, `${path}[${i}]`, out));
      return out;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        collectNullPaths(v, `${path}.${k}`, out);
      }
    }
    return out;
  };

  it('onHandshakeRequest reply contains NO null value anywhere under a maximal-null DB fixture', async () => {
    const now = 1_700_000_000_000;
    // --- Active session with empty title (schema declares title NOT
    //     NULL, so the loader's `title ?? ''` is defensive-only; ''
    //     is the realistic minimal value and stays plist-clean). ---
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, title)
       VALUES (?, ?, NULL, '')`,
      'sess-null',
      now,
    );
    // --- Template whose exercise rows carry every nullable column as
    //     NULL: default_reps / default_weight_kg / parent_id /
    //     reusable_superset_id. ---
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-null',
      'Nullable Tpl',
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          default_reps, default_weight_kg, parent_id, reusable_superset_id)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
      'te-null',
      'tpl-null',
      BENCH,
      1,
      3,
    );
    // --- Active program whose today-cell points at the template with a
    //     NULL sub_tag → planned variant must OMIT `intensity`. ---
    const todayIso = '2025-06-15';
    const todayMs = Date.UTC(2025, 5, 15);
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      'p-null',
      'Null Program',
      7,
      1,
      todayIso,
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      'cell-null',
      'p-null',
      0,
      0,
      'tpl-null',
    );

    // loadTodayPlanned is wired with Date.now() inside onHandshakeRequest;
    // pin "today" by spying so the seeded cell (cycle 0 / day 0 of a
    // program starting 2025-06-15) is the resolved cell.
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(todayMs);
    try {
      const replies: Record<string, unknown>[] = [];
      await onHandshakeRequest(
        db,
        makeEnvelope('handshake', {
          requestId: 'req-null-scan',
          clientVersion: '13d.0',
        }),
        (r) => replies.push(r),
      );
      expect(replies).toHaveLength(1);
      const reply = replies[0] as unknown as Stage1ReplyPayload;

      // The fixture actually exercised the nullable paths…
      expect(reply.hasActiveSession).toBe(true);
      expect(reply.prefetch.templates).toHaveLength(1);
      expect(reply.prefetch.todayPlanned?.kind).toBe('planned');
      // …and the wire shape carries ZERO null values, recursively.
      expect(collectNullPaths(replies[0])).toEqual([]);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('loadTemplatesFullTree OMITS the key (not explicit null/undefined) for NULL nullable columns', async () => {
    const now = 1_700_000_000_000;
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, NULL, NULL)`,
      'tpl-omit',
      'Omit',
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets,
          default_reps, default_weight_kg, parent_id, reusable_superset_id)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)`,
      'te-omit',
      'tpl-omit',
      BENCH,
      1,
      3,
    );
    const list = await loadTemplatesFullTree(db);
    const ex = list[0].exercises[0] as unknown as Record<string, unknown>;
    // Key-absence (stricter than `toBeUndefined()` — an explicit
    // `{ defaultReps: undefined }` would also stringify clean, but the
    // wire rule is "omit the key", so pin exactly that).
    expect(Object.prototype.hasOwnProperty.call(ex, 'defaultReps')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ex, 'defaultWeightKg')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ex, 'parentId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(ex, 'reusableSupersetId')).toBe(false);
    // Non-null columns still present.
    expect(ex.defaultSets).toBe(3);
    expect(collectNullPaths(list)).toEqual([]);
  });

  it('loadTodayPlanned OMITS intensity when the cell sub_tag is NULL', async () => {
    const now = 1_700_000_000_000;
    const todayIso = '2025-06-15';
    const todayMs = Date.UTC(2025, 5, 15);
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      'p-no-tag',
      'NoTag',
      7,
      1,
      todayIso,
      1,
      now,
      now,
    );
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      'tpl-no-tag',
      '腿日',
      now,
      now,
      'p-no-tag',
    );
    await db.runAsync(
      `INSERT INTO program_cell
         (id, program_id, cycle_index, day_index, template_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      'cell-no-tag',
      'p-no-tag',
      0,
      0,
      'tpl-no-tag',
    );
    const today = await loadTodayPlanned(db, todayMs);
    expect(today.kind).toBe('planned');
    expect(
      Object.prototype.hasOwnProperty.call(today, 'intensity'),
    ).toBe(false);
    // Label has no dangling「· null」suffix either.
    if (today.kind === 'planned') {
      expect(today.label).toBe('腿日 W1D1（今日）');
    }
    expect(collectNullPaths(today)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Stage1 prefetch v3 — grouped + variants[] (2026-06-13 Y-dup grill)
// ---------------------------------------------------------------------------

describe('loadTemplatesFullTree — Stage1 v3 grouped + variants (2026-06-13 Y-dup)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  const seedProgram = async (id: string, now: number) => {
    await db.runAsync(
      `INSERT INTO program
         (id, name, main_tag, cycle_length, cycle_count, start_date,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      `Prog ${id}`,
      null,
      7,
      4,
      '2025-01-01',
      0,
      now,
      now,
    );
  };

  const seedTemplate = async (args: {
    id: string;
    name: string;
    updatedAt: number;
    programId?: string;
    subTag?: string;
    withExercise?: boolean;
  }) => {
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag)
       VALUES (?, ?, ?, ?, ?, ?)`,
      args.id,
      args.name,
      args.updatedAt,
      args.updatedAt,
      args.programId ?? null,
      args.subTag ?? null,
    );
    if (args.withExercise) {
      await db.runAsync(
        `INSERT INTO template_exercise
           (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `te-${args.id}`,
        args.id,
        BENCH,
        1,
        3,
        8,
        60,
      );
    }
  };

  it('groups same-name variants into ONE entry; representative = newest updated_at; variants newest-first', async () => {
    const base = 1_700_000_000_000;
    await seedProgram('p-1', base);
    await seedTemplate({ id: 'tpl-old', name: 'Y', updatedAt: base + 1_000, subTag: '12RM' });
    await seedTemplate({ id: 'tpl-new', name: 'Y', updatedAt: base + 9_000, programId: 'p-1', subTag: '5RM', withExercise: true });
    await seedTemplate({ id: 'tpl-mid', name: 'Y', updatedAt: base + 5_000 });
    await seedTemplate({ id: 'tpl-other', name: 'Z', updatedAt: base + 2_000 });

    const list = await loadTemplatesFullTree(db);
    expect(list.map((t) => t.name)).toEqual(['Y', 'Z']);
    const y = list[0];
    // Representative = tpl-new (largest updated_at) and its tree rides top-level.
    expect(y.templateId).toBe('tpl-new');
    expect(y.exercises).toHaveLength(1);
    expect(y.variants?.map((v) => v.templateId)).toEqual(['tpl-new', 'tpl-mid', 'tpl-old']);
  });

  it('variants carry strict-NULL triple via key omission; representative omits exercises (top-level dedup); siblings carry their own tree', async () => {
    const base = 1_700_000_000_000;
    await seedProgram('p-1', base);
    await seedTemplate({ id: 'tpl-rep', name: 'Y', updatedAt: base + 9_000, programId: 'p-1', subTag: '5RM', withExercise: true });
    await seedTemplate({ id: 'tpl-nil', name: 'Y', updatedAt: base + 1_000, withExercise: true });

    const [y] = await loadTemplatesFullTree(db);
    const [rep, nil] = y.variants!;
    // Representative: triple present, tree omitted (rides top-level).
    expect(rep).toEqual({ templateId: 'tpl-rep', programId: 'p-1', subTag: '5RM' });
    expect('exercises' in rep).toBe(false);
    // 通用×通用 sibling: BOTH triple keys omitted (wire null rule), own tree present.
    expect('programId' in nil).toBe(false);
    expect('subTag' in nil).toBe(false);
    expect(nil.exercises).toHaveLength(1);
    expect(nil.templateId).toBe('tpl-nil');
  });

  it('spends the global variant budget group-first — a name group is never split, scan ends at the first non-fitting group', async () => {
    const base = 1_700_000_000_000;
    // Group A (newest, 2 variants), group B (3 variants), group C (1 variant).
    await seedTemplate({ id: 'a-1', name: 'A', updatedAt: base + 9_000, subTag: 'x' });
    await seedTemplate({ id: 'a-2', name: 'A', updatedAt: base + 8_000 });
    await seedTemplate({ id: 'b-1', name: 'B', updatedAt: base + 7_000, subTag: 'x' });
    await seedTemplate({ id: 'b-2', name: 'B', updatedAt: base + 6_000, subTag: 'y' });
    await seedTemplate({ id: 'b-3', name: 'B', updatedAt: base + 5_000 });
    await seedTemplate({ id: 'c-1', name: 'C', updatedAt: base + 4_000 });

    // Budget 4: A (2) fits; B (3) does not fit the remaining 2 → scan ends.
    // C is NOT skip-ahead-admitted even though it would fit.
    const list = await loadTemplatesFullTree(db, 4);
    expect(list.map((t) => t.name)).toEqual(['A']);
    expect(list[0].variants).toHaveLength(2);
  });

  it('admits the first group even when it alone exceeds the budget (degenerate guard — empty reply is worse)', async () => {
    const base = 1_700_000_000_000;
    await seedTemplate({ id: 'y-1', name: 'Y', updatedAt: base + 3_000, subTag: 'a' });
    await seedTemplate({ id: 'y-2', name: 'Y', updatedAt: base + 2_000, subTag: 'b' });
    await seedTemplate({ id: 'y-3', name: 'Y', updatedAt: base + 1_000 });

    const list = await loadTemplatesFullTree(db, 2);
    expect(list).toHaveLength(1);
    expect(list[0].variants).toHaveLength(3);
  });

  it('keeps the Q12 back-compat top-level shape (templateId/name/exercises) pointing at the representative', async () => {
    const base = 1_700_000_000_000;
    await seedTemplate({ id: 'tpl-rep', name: 'Y', updatedAt: base + 9_000, subTag: '5RM', withExercise: true });
    await seedTemplate({ id: 'tpl-old', name: 'Y', updatedAt: base + 1_000 });

    const [y] = await loadTemplatesFullTree(db);
    // An older Watch build that ignores `variants` sees exactly the
    // pre-v3 representative behaviour: newest variant's id + tree.
    expect(y.templateId).toBe('tpl-rep');
    expect(y.name).toBe('Y');
    expect(y.exercises).toHaveLength(1);
  });
});

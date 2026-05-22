/**
 * Tests for `attachTemplateToProgram` — the single-statement helper that
 * sets a Template's (program_id, sub_tag) pair and bumps updated_at.
 *
 * Indirect coverage exists in `getSessionLinkedTemplateTriple.test.ts`,
 * `listDistinctSubTagsByProgram.test.ts`, `overwriteProgram.test.ts`, and
 * `programs.test.ts` — all of which exercise the function only as a
 * setup convenience. This file pins the helper's own contract:
 *
 *   - first attach: links a free template to (program, sub_tag) + ticks updated_at
 *   - repeat attach (same args): idempotent on (program_id, sub_tag) + ticks updated_at
 *   - null sub_tag: stored as NULL
 *   - re-attach to a DIFFERENT program: replaces program_id (not additive)
 *   - detach (program_id = null + sub_tag = null): clears both columns
 *   - non-existent template_id: silent no-op (no throw)
 *   - does NOT mutate other templates
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  attachTemplateToProgram,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';

interface TemplateRow {
  id: string;
  name: string;
  program_id: string | null;
  sub_tag: string | null;
  updated_at: number;
}

async function fetchTemplate(
  db: BetterSqliteDatabase,
  id: string,
): Promise<TemplateRow | null> {
  return db.getFirstAsync<TemplateRow>(
    `SELECT id, name, program_id, sub_tag, updated_at
       FROM template
      WHERE id = ?`,
    id,
  );
}

describe('attachTemplateToProgram', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await createProgram(db, {
      program: {
        id: 'prog-A',
        name: 'Program A',
        main_tag: '增肌',
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createProgram(db, {
      program: {
        id: 'prog-B',
        name: 'Program B',
        main_tag: '減脂',
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('attaches a free template to (program_id, sub_tag) + ticks updated_at', async () => {
    await createTemplate(db, { id: 'tpl-1', name: 'Push', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-1',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 500,
    });

    const row = await fetchTemplate(db, 'tpl-1');
    expect(row).not.toBeNull();
    expect(row!.program_id).toBe('prog-A');
    expect(row!.sub_tag).toBe('5x5');
    expect(row!.updated_at).toBe(500);
  });

  it('idempotent on (program_id, sub_tag) when called twice — only updated_at ticks', async () => {
    await createTemplate(db, { id: 'tpl-i', name: 'Push', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-i',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 500,
    });
    const first = await fetchTemplate(db, 'tpl-i');

    await attachTemplateToProgram(db, {
      template_id: 'tpl-i',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 900,
    });
    const second = await fetchTemplate(db, 'tpl-i');

    expect(second!.program_id).toBe(first!.program_id);
    expect(second!.sub_tag).toBe(first!.sub_tag);
    expect(second!.updated_at).toBe(900);
    expect(second!.updated_at).toBeGreaterThan(first!.updated_at);
  });

  it('stores NULL sub_tag verbatim', async () => {
    await createTemplate(db, { id: 'tpl-null', name: 'Free', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-null',
      program_id: 'prog-A',
      sub_tag: null,
      now: () => 500,
    });

    const row = await fetchTemplate(db, 'tpl-null');
    expect(row!.program_id).toBe('prog-A');
    expect(row!.sub_tag).toBeNull();
  });

  it('re-attaching to a different program replaces program_id (not additive)', async () => {
    await createTemplate(db, { id: 'tpl-move', name: 'Push', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-move',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 500,
    });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-move',
      program_id: 'prog-B',
      sub_tag: '8x3',
      now: () => 900,
    });

    const row = await fetchTemplate(db, 'tpl-move');
    expect(row!.program_id).toBe('prog-B');
    expect(row!.sub_tag).toBe('8x3');
    expect(row!.updated_at).toBe(900);
  });

  it('detach (program_id=null + sub_tag=null) clears both columns', async () => {
    await createTemplate(db, { id: 'tpl-d', name: 'Push', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-d',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 500,
    });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-d',
      program_id: null,
      sub_tag: null,
      now: () => 900,
    });

    const row = await fetchTemplate(db, 'tpl-d');
    expect(row!.program_id).toBeNull();
    expect(row!.sub_tag).toBeNull();
    expect(row!.updated_at).toBe(900);
  });

  it('non-existent template_id is a silent no-op (does not throw, does not affect existing rows)', async () => {
    await createTemplate(db, { id: 'tpl-real', name: 'Real', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-real',
      program_id: 'prog-A',
      sub_tag: '5x5',
      now: () => 500,
    });

    await expect(
      attachTemplateToProgram(db, {
        template_id: 'tpl-ghost-does-not-exist',
        program_id: 'prog-B',
        sub_tag: '8x3',
        now: () => 900,
      }),
    ).resolves.toBeUndefined();

    const realRow = await fetchTemplate(db, 'tpl-real');
    expect(realRow!.program_id).toBe('prog-A');
    expect(realRow!.sub_tag).toBe('5x5');
    expect(realRow!.updated_at).toBe(500);

    const ghostRow = await fetchTemplate(db, 'tpl-ghost-does-not-exist');
    expect(ghostRow).toBeNull();
  });

  it('attaching template X does not touch template Y in the same program', async () => {
    await createTemplate(db, { id: 'tpl-x', name: 'X', now: () => 100 });
    await createTemplate(db, { id: 'tpl-y', name: 'Y', now: () => 100 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-y',
      program_id: 'prog-A',
      sub_tag: 'pre-existing',
      now: () => 200,
    });

    await attachTemplateToProgram(db, {
      template_id: 'tpl-x',
      program_id: 'prog-A',
      sub_tag: 'new',
      now: () => 500,
    });

    const yRow = await fetchTemplate(db, 'tpl-y');
    expect(yRow!.program_id).toBe('prog-A');
    expect(yRow!.sub_tag).toBe('pre-existing');
    expect(yRow!.updated_at).toBe(200);

    const xRow = await fetchTemplate(db, 'tpl-x');
    expect(xRow!.program_id).toBe('prog-A');
    expect(xRow!.sub_tag).toBe('new');
    expect(xRow!.updated_at).toBe(500);
  });
});

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import {
  attachTemplateToProgram,
  classifyTemplate,
  createTemplate,
  listTemplates,
} from '../../src/adapters/sqlite/templateRepository';
import {
  clearActiveProgram,
  createProgram,
  deleteProgram,
  getActiveProgram,
  getProgram,
  listPrograms,
  setActiveProgram,
  updateCell,
} from '../../src/adapters/sqlite/programRepository';
import { migrate } from '../../src/db/migrate';
import { expandWizardDraft } from '../../src/domain/program/programManager';
import type { ProgramCore } from '../../src/domain/program/types';

let counter = 0;
const uuid = () => `u${counter++}`;

const buildProgram = (over: Partial<ProgramCore> = {}): ProgramCore => ({
  id: uuid(),
  name: '增肌-Q1',
  main_tag: '增肌',
  cycle_length: 7,
  cycle_count: 2,
  start_date: '2026-05-01',
  is_active: 0,
  ...over,
});

describe('programRepository', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    counter = 0;
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('createProgram + getProgram round-trips header + cells', async () => {
    const program = buildProgram();
    const cells = expandWizardDraft({
      program,
      dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
      uuid,
    });
    await createProgram(db, { program, cells });
    const got = await getProgram(db, program.id);
    expect(got).not.toBeNull();
    expect(got?.program.name).toBe('增肌-Q1');
    expect(got?.cells).toHaveLength(2 * 7);
    expect(got?.cells[0]?.cycle_index).toBe(0);
    expect(got?.cells[0]?.day_index).toBe(0);
  });

  it('listPrograms returns active first, ordered by updated_at desc', async () => {
    const oldProg = buildProgram({ name: 'Old' });
    const newProg = buildProgram({ name: 'New' });
    await createProgram(db, { program: oldProg, now: () => 1 });
    await createProgram(db, { program: newProg, now: () => 2 });
    const list = await listPrograms(db);
    expect(list.map((p) => p.name)).toEqual(['New', 'Old']);

    await setActiveProgram(db, { id: oldProg.id, now: () => 3 });
    const list2 = await listPrograms(db);
    expect(list2[0]?.name).toBe('Old'); // active goes first
    expect(list2[0]?.is_active).toBe(1);
  });

  it('setActiveProgram is mutually exclusive', async () => {
    const a = buildProgram({ name: 'A' });
    const b = buildProgram({ name: 'B' });
    await createProgram(db, { program: a });
    await createProgram(db, { program: b });
    await setActiveProgram(db, { id: a.id });
    expect((await getActiveProgram(db))?.program.id).toBe(a.id);
    await setActiveProgram(db, { id: b.id });
    expect((await getActiveProgram(db))?.program.id).toBe(b.id);
    // a should now be inactive
    const ap = await getProgram(db, a.id);
    expect(ap?.program.is_active).toBe(0);
  });

  it('clearActiveProgram zeroes every is_active', async () => {
    const p = buildProgram();
    await createProgram(db, { program: p });
    await setActiveProgram(db, { id: p.id });
    expect(await getActiveProgram(db)).not.toBeNull();
    await clearActiveProgram(db);
    expect(await getActiveProgram(db)).toBeNull();
  });

  it('deleteProgram orphans attached templates back to free', async () => {
    const program = buildProgram();
    await createProgram(db, { program });
    const tplId = uuid();
    await createTemplate(db, { id: tplId, name: '胸日' });
    await attachTemplateToProgram(db, {
      template_id: tplId,
      program_id: program.id,
      sub_tag: '10RM',
    });
    let templates = await listTemplates(db);
    expect(templates.find((t) => t.id === tplId)?.program_id).toBe(program.id);
    expect(templates.find((t) => t.id === tplId)?.sub_tag).toBe('10RM');

    await deleteProgram(db, program.id);
    templates = await listTemplates(db);
    expect(templates.find((t) => t.id === tplId)?.program_id).toBeNull();
    expect(templates.find((t) => t.id === tplId)?.sub_tag).toBeNull();
    expect(await getProgram(db, program.id)).toBeNull();
  });

  it('updateCell modifies a single cell without touching siblings', async () => {
    const program = buildProgram({ cycle_count: 1 });
    const cells = expandWizardDraft({
      program,
      dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
      uuid,
    });
    await createProgram(db, { program, cells });
    const tplId = uuid();
    await createTemplate(db, { id: tplId, name: '胸日' });
    const targetCellId = cells[3].id;
    await updateCell(db, {
      cell_id: targetCellId,
      template_id: tplId,
      sub_tag: '12RM',
    });
    const got = await getProgram(db, program.id);
    const target = got?.cells.find((c) => c.id === targetCellId);
    expect(target?.template_id).toBe(tplId);
    expect(target?.sub_tag).toBe('12RM');
    // Siblings stay null.
    const others = got?.cells.filter((c) => c.id !== targetCellId) ?? [];
    expect(others.every((c) => c.template_id === null)).toBe(true);
  });
});

describe('templateRepository — classifyTemplate', () => {
  it('returns free when no program', () => {
    expect(
      classifyTemplate({ program_id: null, sameNameSiblingCount: 1 })
    ).toBe('free');
  });

  it('returns main when in program with no siblings', () => {
    expect(
      classifyTemplate({ program_id: 'p1', sameNameSiblingCount: 1 })
    ).toBe('main');
  });

  it('returns sub when in program with same-name siblings', () => {
    expect(
      classifyTemplate({ program_id: 'p1', sameNameSiblingCount: 2 })
    ).toBe('sub');
  });
});

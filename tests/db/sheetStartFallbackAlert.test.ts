/**
 * Bug #308 決策 A1（alert-and-proceed）驗收測試。
 *
 * Fix：`app/(tabs)/index.tsx` onSheetStart 在 closeSheet 後補
 * `if (resolved.alert) Alert.alert(...)` —— 與同檔 onSheetEdit 既有寫法
 * 一致（mirror）。語意 = 告知型 alert、不阻斷：fallback 時仍照常
 * `startSessionFromTemplate` 開始訓練（A1，非 A2 block）。
 *
 * jest 跑 `testEnvironment: node`、無 RN renderer，component 不能 render
 * 直測（見 skill rn-component-behavior-split；A1 新增邏輯僅一行 if，低於
 * 抽 behavior 模組的門檻）。故驗收拆兩層：
 *
 *   1. 行為層（in-memory DB）：鎖定 `resolved.alert` 的觸發/靜默條件與
 *      proceed 不被 block —— A1 的 `if (resolved.alert)` 閘門吃的就是
 *      planResolveTarget 的回傳，這裡鎖死「何時有 alert、何時沒有」。
 *   2. source guard（fs，前例 tests/domain/templatesTabRemoval.test.ts）：
 *      鎖定 onSheetStart 區塊真的含 alert 顯示、且順序在
 *      startSessionFromTemplate 之後（= alert-and-proceed，回歸防 A2 化
 *      或再度被刪）。
 *
 * 決策 B 維持 B2（副標題吃 linked-template、零改動）—— 本檔最後一條
 * 重申鎖定；probe tests/db/planResolveFallback.probe308.test.ts 亦續鎖。
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createTemplate,
  attachTemplateToProgram,
  addTemplateExercise,
  findTemplateByTriple,
  getSessionLinkedTemplateTriple,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import { planResolveTarget } from '../../src/domain/template/resolveTargetTemplate';

const REPO_ROOT = resolve(__dirname, '..', '..');
const NOW = 1_700_000_000_000;

describe('#308 A1 — onSheetStart fallback alert（行為層）', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let uuidCounter: number;
  const uuid = () => `a1-uuid-${++uuidCounter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;

    // 同 probe seed：兩 program、name X日 唯一變體 = (計畫B, 強度B)。
    await createProgram(db, {
      program: {
        id: 'prog-B',
        name: '計畫B',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createProgram(db, {
      program: {
        id: 'prog-E',
        name: '計畫E',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-bb', name: 'X日', now: () => NOW });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-bb',
      program_id: 'prog-B',
      sub_tag: '強度B',
    });
    await addTemplateExercise(db, {
      template_id: 'tpl-bb',
      exercise_id: benchId,
      default_sets: 3,
      default_reps: 8,
      default_weight_kg: 60,
      uuid,
      now: () => NOW,
    });
  });

  afterEach(() => {
    db.close();
  });

  /** 同 probe：模擬 index.tsx resolveTargetTemplateId 的 lookup-or-fallback。 */
  async function resolveLikeIndexTsx(selection: {
    wanted_program_id: string | null;
    wanted_sub_tag: string | null;
  }) {
    const source = {
      id: 'tpl-bb',
      name: 'X日',
      program_id: 'prog-B' as string | null,
      sub_tag: '強度B' as string | null,
    };
    const matchesSelf =
      source.program_id === selection.wanted_program_id &&
      source.sub_tag === selection.wanted_sub_tag;
    const found = matchesSelf
      ? null
      : await findTemplateByTriple(db, {
          name: source.name,
          program_id: selection.wanted_program_id,
          sub_tag: selection.wanted_sub_tag,
        });
    return planResolveTarget(source, selection, found);
  }

  it('fallback 觸發 → resolved 帶 alert（A1 的 if 閘門會開、文案＝planner 定案文案）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('unreachable');
    // onSheetStart 顯示的就是這兩個字串（與 onSheetEdit 同一來源、零新文案）。
    expect(plan.alert).toEqual({ title: '尚未建立模板', body: '啟用最新模板' });
  });

  it('非 fallback（use_self）→ 無 alert 欄位（A1 的 if 閘門保持靜默）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-B',
      wanted_sub_tag: '強度B',
    });
    expect(plan).toEqual({ kind: 'use_self', template_id: 'tpl-bb' });
    expect('alert' in plan).toBe(false);
  });

  it('非 fallback（use_sibling，變體存在）→ 無 alert 欄位', async () => {
    // 補建 E·E sibling 後再選 E·E → lookup hit、不該有任何警告。
    await createTemplate(db, { id: 'tpl-ee', name: 'X日', now: () => NOW });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-ee',
      program_id: 'prog-E',
      sub_tag: '強度E',
    });
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan).toEqual({ kind: 'use_sibling', template_id: 'tpl-ee' });
    expect('alert' in plan).toBe(false);
  });

  it('proceed 不被 block：fallback 後 session 照常開始、內容＝fallback 模板（B·B）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan.kind).toBe('fallback_with_alert');

    // A1 語意：alert 只是告知，session 一樣用 fallback template_id 開起來。
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: plan.template_id,
      uuid,
      now: () => NOW,
      program_id: 'prog-E', // decorative（probe 第 5 測已證）
      sub_tag: '強度E',
    });

    const session = await db.getFirstAsync<{ id: string; ended_at: number | null }>(
      `SELECT id, ended_at FROM session WHERE id = ?`,
      session_id,
    );
    expect(session).toEqual({ id: session_id, ended_at: null });

    const exercises = await db.getAllAsync<{ template_id: string }>(
      `SELECT template_id FROM session_exercise WHERE session_id = ?`,
      session_id,
    );
    expect(exercises).toEqual([{ template_id: 'tpl-bb' }]);
  });

  it('B2 維持：fallback session 的副標題 triple 仍吃 linked-template（B·B、誠實陳述）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan.kind).toBe('fallback_with_alert');
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: plan.template_id,
      uuid,
      now: () => NOW,
    });
    const triple = await getSessionLinkedTemplateTriple(db, session_id);
    expect(triple).toEqual({
      template_id: 'tpl-bb',
      template_name: 'X日',
      program_id: 'prog-B',
      program_name: '計畫B',
      sub_tag: '強度B',
    });
  });
});

describe('#308 A1 — onSheetStart source guard（alert-and-proceed 回歸鎖）', () => {
  const src = readFileSync(
    join(REPO_ROOT, 'app', '(tabs)', 'index.tsx'),
    'utf8',
  );

  /** 切出一個 handler 的函式區塊文字（從宣告到下一個同層 `const xxx =`）。 */
  function sliceHandler(name: string): string {
    const start = src.indexOf(`const ${name} = async`);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf('\n  const ', start + 1);
    expect(next).toBeGreaterThan(start);
    return src.slice(start, next);
  }

  it('onSheetStart 含 fallback alert 顯示（mirror onSheetEdit 寫法）', () => {
    const block = sliceHandler('onSheetStart');
    expect(block).toContain('if (resolved.alert)');
    expect(block).toContain(
      'Alert.alert(resolved.alert.title, resolved.alert.body)',
    );
  });

  it('A1 非 A2：alert 在 startSessionFromTemplate 之後（告知型、不阻斷開始）', () => {
    const block = sliceHandler('onSheetStart');
    const startIdx = block.indexOf('startSessionFromTemplate');
    const alertIdx = block.indexOf('if (resolved.alert)');
    expect(startIdx).toBeGreaterThan(-1);
    expect(alertIdx).toBeGreaterThan(startIdx);
  });

  it('一致性鎖：onSheetEdit 既有 alert 寫法仍在（兩 handler 同款）', () => {
    const block = sliceHandler('onSheetEdit');
    expect(block).toContain('if (resolved.alert)');
    expect(block).toContain(
      'Alert.alert(resolved.alert.title, resolved.alert.body)',
    );
  });
});

/**
 * #50 / #308 fallback-alert 分流驗收測試。
 *
 * 2026-06-26 option 1 推廣翻盤：原本 onSheetStart（開始訓練）對 miss 的
 * selection 會走 planResolveTarget fallback + #308 A1「告知型 alert + 照常
 * 開始」。現在 onSheetStart 對「所有」selection 改走
 * `ensureTemplateVariantReady` 自動建立該 (program, sub_tag) 變體 + prefill
 * —— START 路徑不再 fallback、不再跳「尚未建立模板」alert（反 #50 no-spawn，
 * 僅 start 路徑）。fallback + 告示只剩 onSheetEdit（編輯模板）保留：首次 start
 * 把列建出來後，編輯路徑的告示也自然消失。
 *
 * jest 跑 `testEnvironment: node`、無 RN renderer，component 不能 render
 * 直測（見 skill rn-component-behavior-split）。故驗收拆兩層：
 *
 *   1. 行為層（in-memory DB）：鎖定 planResolveTarget 的 fallback/靜默條件 ——
 *      onSheetEdit 的 `if (resolved.alert)` 閘門吃的就是這個回傳。
 *   2. source guard（fs，前例 tests/domain/templatesTabRemoval.test.ts）：
 *      鎖定 onSheetStart 走 ensureTemplateVariantReady 自建（無 fallback alert）、
 *      且 onSheetEdit 仍保留 fallback alert 顯示。
 *
 * 決策 B 維持 B2（副標題吃 linked-template）—— probe
 * tests/db/planResolveFallback.probe308.test.ts 續鎖。
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
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import { planResolveTarget } from '../../src/domain/template/resolveTargetTemplate';

const REPO_ROOT = resolve(__dirname, '..', '..');
const NOW = 1_700_000_000_000;

describe('#50/#308 — planResolveTarget fallback 語意（onSheetEdit 行為層）', () => {
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

  it('fallback 觸發 → resolved 帶 alert（onSheetEdit 的 if 閘門會開、文案＝planner 定案文案）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('unreachable');
    // onSheetEdit 顯示的就是這兩個字串。
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

  // 註：原「proceed 不被 block」「B2 副標題」兩條鎖的是 onSheetStart fallback 後
  // 開 session 的行為；2026-06-26 起 START 路徑改自建（不再 fallback 開 session），
  // 該情境已不存在。B2 副標題誠實陳述續由 probe
  // tests/db/planResolveFallback.probe308.test.ts 鎖定。
});

describe('START 自建 vs 編輯 fallback — source guard（2026-06-26 option 1 推廣）', () => {
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

  it('onSheetStart：所有 selection 走 ensureTemplateVariantReady 自建（含分類變體）', () => {
    const block = sliceHandler('onSheetStart');
    // 通用 + 任何分類變體都自建/prefill 其 (program, sub_tag) 列。
    expect(block).toContain('ensureTemplateVariantReady');
  });

  it('onSheetStart：START 路徑不再 fallback／告示（反 #50 no-spawn）', () => {
    const block = sliceHandler('onSheetStart');
    // 不再「呼叫」resolveTargetTemplateId、也不再有 resolvedAlert 告示分支。
    // 註：sliceHandler 會把下一個 handler 的 JSDoc 一起切進來，該 docstring 含
    // 「resolveTargetTemplateId 路徑」字樣（無括號），故鎖呼叫形式 `(` 才精準。
    expect(block).not.toContain('resolveTargetTemplateId(');
    expect(block).not.toContain('resolvedAlert');
  });

  it('onStartMinimalTemplate：極簡 start 也走 ensureTemplateVariantReady(null,null)', () => {
    const block = sliceHandler('onStartMinimalTemplate');
    expect(block).toContain('ensureTemplateVariantReady');
  });

  it('一致性鎖：onSheetEdit 仍保留 fallback alert（編輯路徑維持 #50 fallback+告示）', () => {
    const block = sliceHandler('onSheetEdit');
    expect(block).toContain('if (resolved.alert)');
    expect(block).toContain(
      'Alert.alert(resolved.alert.title, resolved.alert.body)',
    );
  });
});

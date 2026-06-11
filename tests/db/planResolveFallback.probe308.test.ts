/**
 * Bug #308 probe — 乾淨資料重現（task 點 C）。
 *
 * 實機症狀：模板訓練 sheet 選 (計畫 E, 強度 E) → [開始訓練] → in-session
 * 副標題顯示「B · B」。本檔在 in-memory DB 上以最小 seed 重現整條因果鏈，
 * 證明這是**邏輯行為、不是資料污染**：
 *
 *   1. 同名模板只有一個變體存在：name X @ (計畫B, 強度B)。
 *      使用者在 sheet 選 (計畫E, 強度E) —— 該變體不存在。
 *   2. `findTemplateByTriple(X, E, 強度E)` → miss。
 *   3. `planResolveTarget` → `fallback_with_alert`，template_id 落回
 *      representative（= B·B 變體），並附 alert「尚未建立模板/啟用最新模板」。
 *      → onSheetEdit 會顯示這個 alert；onSheetStart（app/(tabs)/index.tsx
 *      ~L1050）pre-A1 **丟棄 resolved.alert** —— 根因 1（靜默 fallback）。
 *      ✅ A1 已修（slice/308-a1-fallback-alert）：onSheetStart 現在 mirror
 *      onSheetEdit 顯示 alert（alert-and-proceed）；驗收測試見
 *      tests/db/sheetStartFallbackAlert.test.ts。
 *   4. `startSessionFromTemplate` 收到 caller 傳的 (program_id=E,
 *      sub_tag=強度E) 但（doc 自述 decorative）**不寫進任何表**；
 *      session 表 schema 也根本沒有 program_id / sub_tag 欄位
 *      —— 重大事實：task 描述「session 本身有存選的 program_id/sub_tag」
 *      與現碼不符，見〈session schema has NO program_id/sub_tag〉測試。
 *   5. `getSessionLinkedTemplateTriple` 走 session_exercise.template_id →
 *      模板自身的 (program_name, sub_tag) → 回「計畫B/強度B」
 *      —— in-session 副標題（index.tsx ~L2340）顯示「B · B」＝根因 2。
 *
 * 本檔為 probe（診斷鎖定現行行為），不是 fix 的驗收測試。若未來修 #308
 * 改變了 fallback 或副標題語意，請改寫（而非刪除）對應斷言。
 */

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

const NOW = 1_700_000_000_000;

describe('bug #308 probe — fallback alert dropped + subtitle reads linked template', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let uuidCounter: number;
  const uuid = () => `probe-uuid-${++uuidCounter}`;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    uuidCounter = 0;
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;

    // ---- 乾淨 seed：兩個 program，同名模板只有 B·B 變體存在 ----
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
    // name X 唯一變體 = (計畫B, 強度B)。E·E 變體刻意不建。
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

  /** 模擬 index.tsx resolveTargetTemplateId 的 lookup-or-fallback 流程。 */
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

  it('選不存在的 (計畫E, 強度E) → planResolveTarget 走 fallback_with_alert、落回 B·B 變體', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });

    // fallback 確實帶 alert —— onSheetEdit 顯示它、onSheetStart pre-A1 丟棄它
    //（根因 1；A1 後兩者皆顯示）。
    expect(plan).toEqual({
      kind: 'fallback_with_alert',
      template_id: 'tpl-bb',
      alert: { title: '尚未建立模板', body: '啟用最新模板' },
    });
  });

  it('對照組：選存在的 (計畫B, 強度B) → use_self、無 alert', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-B',
      wanted_sub_tag: '強度B',
    });
    expect(plan).toEqual({ kind: 'use_self', template_id: 'tpl-bb' });
  });

  it('fallback 後開 session → getSessionLinkedTemplateTriple 回連結模板的 B·B（副標題顯示來源＝根因 2）', async () => {
    const plan = await resolveLikeIndexTsx({
      wanted_program_id: 'prog-E',
      wanted_sub_tag: '強度E',
    });
    expect(plan.kind).toBe('fallback_with_alert');

    // onSheetStart 等價呼叫：把使用者選的 (E, 強度E) 傳進去 ——
    // doc 自述 decorative，實際不落任何表。
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: plan.template_id,
      uuid,
      now: () => NOW,
      program_id: 'prog-E',
      sub_tag: '強度E',
    });

    const triple = await getSessionLinkedTemplateTriple(db, session_id);
    // 副標題資料源回的是連結模板自身的分類（B·B），不是使用者選的（E·E）。
    expect(triple).toEqual({
      template_id: 'tpl-bb',
      template_name: 'X日',
      program_id: 'prog-B',
      program_name: '計畫B',
      sub_tag: '強度B',
    });
  });

  it('重大事實鎖定：session 表 schema 沒有 program_id / sub_tag 欄位（使用者的選擇無處持久化）', async () => {
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(session)`,
    );
    const names = cols.map((c) => c.name);
    // 現行欄位（v001 + v016 + v023 + v024）——沒有任何分類欄位。
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'started_at',
        'ended_at',
        'bodyweight_snapshot_kg',
        'healthkit_workout_uuid',
        'avg_hr_bpm',
        'kcal',
        'title',
        'is_watch_tracked',
      ]),
    );
    expect(names).not.toContain('program_id');
    expect(names).not.toContain('sub_tag');
  });

  it('startSessionFromTemplate 的 program_id/sub_tag 參數不影響任何持久化列（decorative 證明）', async () => {
    // 兩次開 session（中間結束第一場），一次帶 E·E、一次完全不帶 ——
    // 斷言兩場 session 的 session/session_exercise 持久化內容（撇開
    // id/時間戳）逐欄一致 → 參數確實 decorative。
    const a = await startSessionFromTemplate(db, {
      template_id: 'tpl-bb',
      uuid,
      now: () => NOW,
      program_id: 'prog-E',
      sub_tag: '強度E',
    });
    await db.runAsync(
      `UPDATE session SET ended_at = ? WHERE id = ?`,
      NOW + 1000,
      a.session_id,
    );
    const b = await startSessionFromTemplate(db, {
      template_id: 'tpl-bb',
      uuid,
      now: () => NOW,
    });

    const rowOf = async (sid: string) =>
      db.getFirstAsync<Record<string, unknown>>(
        `SELECT title, bodyweight_snapshot_kg, is_watch_tracked
           FROM session WHERE id = ?`,
        sid,
      );
    const seOf = async (sid: string) =>
      db.getAllAsync<Record<string, unknown>>(
        `SELECT exercise_id, ordering, planned_sets, planned_reps,
                planned_weight_kg, template_id
           FROM session_exercise WHERE session_id = ? ORDER BY ordering`,
        sid,
      );

    expect(await rowOf(a.session_id)).toEqual(await rowOf(b.session_id));
    expect(await seOf(a.session_id)).toEqual(await seOf(b.session_id));
  });
});

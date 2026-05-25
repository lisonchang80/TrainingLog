/**
 * Pure decision tree for "lookup-or-fallback" used by `app/(tabs)/templates.tsx`
 * onStart + onEdit (start-template-sheet 兩按鈕). overnight #48 第 2 點、
 * #50 簡化拍板。
 *
 * **Background**: ADR-0003 三元組 (name, program_id, sub_tag) identity 保留、
 * #41 UI 層 dedupe by name 後一個 name 只有一 representative row。當用戶在
 * start-template-sheet 選 (program=X, sub_tag=Y) radio 後按 [編輯模板] /
 * [開始訓練]，需要：
 *
 *   1. 若 selection 三元組 === sheetTpl 自身 → 用 sheetTpl.id 直接走
 *   2. 否則先 `findTemplateByTriple(name, P, S)` 查 sibling：
 *      - hit → 用 sibling.id（無論 P/S 是否為 NULL）
 *      - miss → fallback to sheetTpl.id (representative, MAX(updated_at)) +
 *        flag Alert「尚未建立模板，啟用最新模板」(不分通用/非通用)
 *
 * **#50 簡化**: pre-#50 非通用 miss 會 auto-spawn (`cloneTemplateWithSubTag`
 * +「立即新增該變體」)。用戶反饋簡化：所有 miss 都走 fallback、不 spawn。
 * 建立新 sibling 路徑改成只由 sheet「+新增強度 / +新增計畫」inline 按
 * 「建立」明示觸發（`handleCloneTemplateWithNewSubTag`），本 planner 只
 * 處理「lookup-or-fallback」。
 *
 * **#48 bug fixed**: #48 之前 `wantedProgramId === null` 直接 short-circuit
 * 返回 representative.id、跳過 lookup。導致用戶選通用 radio 時永遠開到
 * representative。修法：所有 miss 都做 lookup、然後 fallback。
 *
 * **Pure**: 本檔不 import DB / router。Caller 提供 lookup 結果 (sibling? id),
 * 本檔回 Plan 描述「下一步做什麼」。Caller 執行 effect (router.push)。
 */

/** Input identity of the row currently focused in start-template-sheet
 *  (the representative of its name-group, post-#41 dedupe). */
export interface TargetTemplateSource {
  id: string;
  name: string;
  program_id: string | null;
  sub_tag: string | null;
}

/** User's radio selection in the sheet. `period_id` may be the reserved
 *  「通用」program sentinel — caller maps that to NULL before calling. */
export interface TargetTemplateSelection {
  /** Resolved program_id (NULL = 通用 program). Caller already mapped the
   *  RESERVED_NONE_PROGRAM_ID sentinel to NULL. */
  wanted_program_id: string | null;
  /** Resolved sub_tag (NULL = no intensity). */
  wanted_sub_tag: string | null;
}

/** Discriminated-union plan describing what the caller should do next.
 *  Each variant is a leaf of the decision tree; no overlap. */
export type ResolveTargetPlan =
  | {
      /** Selection matches sheet template's own triple — use as-is. */
      kind: 'use_self';
      template_id: string;
    }
  | {
      /** A sibling matching (name, P, S) already exists — use its id. */
      kind: 'use_sibling';
      template_id: string;
    }
  | {
      /** No sibling found — fall back to sheet template's representative id
       *  (MAX updated_at sibling, post-#41 dedupe) AND signal Alert so the UI
       *  can tell the user the requested variant doesn't yet exist.
       *  Applies to BOTH 通用 and 非通用 cases (#50 simplification). */
      kind: 'fallback_with_alert';
      template_id: string;
      alert: {
        title: string;
        body: string;
      };
    };

/**
 * Branch entry — decide what action to take given (source, selection,
 * sibling_lookup_result). Caller does the DB lookup beforehand and feeds
 * the result in (NULL = miss, { id } = hit).
 *
 *   matchesSelf check uses strict NULL equality — `(null, null)` matches
 *   `(null, null)` (a 通用 template selecting 通用 radio is `use_self`).
 *
 *   The fallback alert message includes the wanted (program_id, sub_tag)
 *   pair as opaque strings (caller resolves to human-readable program name
 *   if it wants; this layer stays DB-free).
 */
export function planResolveTarget(
  source: TargetTemplateSource,
  selection: TargetTemplateSelection,
  sibling_lookup_result: { id: string } | null,
): ResolveTargetPlan {
  const matchesSelf =
    source.program_id === selection.wanted_program_id &&
    source.sub_tag === selection.wanted_sub_tag;
  if (matchesSelf) {
    return { kind: 'use_self', template_id: source.id };
  }

  if (sibling_lookup_result) {
    return { kind: 'use_sibling', template_id: sibling_lookup_result.id };
  }

  // No sibling found — uniform fallback (#50 simplification, was branched
  // on 通用/非通用 with spawn for the latter pre-#50).
  return {
    kind: 'fallback_with_alert',
    template_id: source.id,
    alert: {
      title: '尚未建立模板',
      body: '啟用最新模板',
    },
  };
}

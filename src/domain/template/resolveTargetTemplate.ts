/**
 * Pure decision tree for "lookup-or-spawn" used by `app/(tabs)/templates.tsx`
 * onStart + onEdit (start-template-sheet 兩按鈕). overnight #48 第 2 點.
 *
 * **Background**: ADR-0003 三元組 (name, program_id, sub_tag) identity 保留、
 * #41 UI 層 dedupe by name 後一個 name 只有一 representative row。當用戶在
 * start-template-sheet 選 (program=X, sub_tag=Y) radio 後按 [編輯模板] /
 * [開始訓練]，需要：
 *
 *   1. 若 selection 三元組 === sheetTpl 自身 → 用 sheetTpl.id 直接走
 *   2. 否則先 `findTemplateByTriple(name, P, S)` 查 sibling：
 *      - hit → 用 sibling.id（無論 P/S 是否為 NULL）
 *      - miss + 通用 case (P=NULL) → fallback to sheetTpl.id + flag Alert
 *        告知用戶「通用變體尚未建立、開啟最近編輯的變體」(memory #38 規則：
 *        通用 case 略過 spawn 避免擴散)
 *      - miss + 非通用 case → 'spawn'（caller 執行 cloneTemplateWithSubTag）
 *
 * **Bug fixed**: #48 之前 `wantedProgramId === null` 直接 short-circuit 返回
 * representative.id，跳過 lookup。導致用戶選通用 radio 時永遠開到 representative
 * 那個變體（e.g. 選 Smoke 通用 → 開 (Smoke, TEST_id, TEST-4) 而非
 * (Smoke, NULL, NULL)）。修法：通用 case 也做 lookup、只在 miss 時 fallback。
 *
 * 為什麼通用 case miss 不 spawn：memory ledger #38 拍板「通用 program 略過
 * spawn 避免擴散」。通用 variants 不該無限增生—一個 (name, NULL, *) sibling
 * 就夠。Fallback to representative + Alert 讓用戶知道狀況、可手動編輯後存。
 *
 * **Pure**: 本檔不 import DB / router。Caller 提供 lookup 結果 (sibling? id),
 * 本檔回 Plan 描述「下一步做什麼」。Caller 執行 effect (router.push / spawn DB)。
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
      /** 通用 case (wanted_program_id === NULL) AND no sibling found —
       *  fall back to sheet template's representative id AND signal Alert
       *  so the UI can tell the user the 通用 variant doesn't yet exist. */
      kind: 'fallback_with_alert';
      template_id: string;
      alert: {
        title: string;
        body: string;
      };
    }
  | {
      /** Non-通用 case + no sibling — caller should spawn a new sibling
       *  via `cloneTemplateWithSubTag`. */
      kind: 'spawn';
      source_id: string;
      new_program_id: string;
      new_sub_tag: string | null;
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

  // No sibling found. Branch on 通用 case.
  if (selection.wanted_program_id === null) {
    return {
      kind: 'fallback_with_alert',
      template_id: source.id,
      alert: {
        title: '通用變體尚未建立',
        body: `(計畫=通用, 強度=${selection.wanted_sub_tag ?? '通用'}) 的變體尚未建立，開啟最近編輯的變體。如需建立，請在編輯器中另存。`,
      },
    };
  }

  // Non-通用 case + miss → spawn.
  return {
    kind: 'spawn',
    source_id: source.id,
    new_program_id: selection.wanted_program_id,
    new_sub_tag: selection.wanted_sub_tag,
  };
}

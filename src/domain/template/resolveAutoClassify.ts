/**
 * Pure logic — decide whether a FRESH (unclassified) template, started via the
 * editor's 「開始訓練」 button, should auto-adopt the user's GLOBAL last-used
 * (program, sub_tag) BEFORE the session starts. Phase A of the
 * 「未建立/通用模板開始訓練自動帶資料」 spec (2026-06-25 grill 拍板).
 *
 * The caller reads the global last-used sticky (the 計劃-mode start sheet writes
 * it on every start — see `startStickyRepository`) and resolves a few facts
 * against the live DB / available program list, then asks this function for the
 * attach decision. It returns the (program_id, sub_tag) to hand to
 * `attachTemplateToProgram`, or `null` = leave the template 通用 (no
 * classification — the session simply starts unclassified).
 *
 * Every fallback resolves to `null` (= 通用) and NEVER blocks the start:
 *   - no global sticky recorded yet (first ever start)        → null
 *   - the stored program is the reserved 「無」/通用 sentinel  → null
 *   - the stored program was since deleted (not in the list)   → null
 *   - adopting it would COLLIDE with an existing sibling
 *     template already owning (name, program, sub_tag)         → null
 *
 * The last rule honours the dup-triple boundary 拍板 (2026-06-25): auto-classify
 * must never silently mint a duplicate (name, program_id, sub_tag) triple —
 * when it would, we quietly start 通用 instead of blocking the user.
 *
 * Pure — no DB, no React, no router. The caller owns all the async lookups and
 * passes their results in as plain booleans.
 */
export interface AutoClassifyInput {
  /**
   * GLOBAL last-used program id in `period_id` space (may be the reserved
   * 「無」/通用 sentinel). `null` = nothing recorded yet.
   */
  storedProgramId: string | null;
  /** GLOBAL last-used sub_tag; `null` = no intensity. */
  storedSubTag: string | null;
  /** `true` when `storedProgramId` is the reserved 「無」/通用 program. */
  isNoneProgram: boolean;
  /** `true` when `storedProgramId` still exists in the available programs list. */
  programExists: boolean;
  /**
   * `true` when a DIFFERENT template already owns the triple
   * (templateName, storedProgramId, storedSubTag).
   */
  tripleCollision: boolean;
}

export interface AutoClassifyTarget {
  program_id: string;
  sub_tag: string | null;
}

export function resolveAutoClassify(
  input: AutoClassifyInput,
): AutoClassifyTarget | null {
  const {
    storedProgramId,
    storedSubTag,
    isNoneProgram,
    programExists,
    tripleCollision,
  } = input;

  if (storedProgramId == null) return null;
  if (isNoneProgram) return null;
  if (!programExists) return null;
  if (tripleCollision) return null;

  return { program_id: storedProgramId, sub_tag: storedSubTag };
}

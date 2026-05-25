/**
 * Pure setLabel computation — extracted from
 * `components/template-editor/template-editor-view.tsx` (computeExMeta)
 * so the session set logger card can compute the same labels without
 * duplicating the logic.
 *
 * Rules (from ADR-0016 + ADR-0019 Q7):
 *   - kind === 'warmup'  → '熱'
 *   - kind === 'working' → ordinal among working sets, 1-indexed ('1', '2', ...)
 *   - kind === 'dropset'
 *       - parent_set_id === null   → 'D{n}' where n is dropset-head ordinal
 *       - parent_set_id !== null   → '' (follower row, label hidden)
 *
 * The two ordinals (workIdx, clusterIdx) are independent of each other,
 * so a sequence like [warmup, working, working, dropset-head, dropset-
 * follower, working] labels to ['熱','1','2','D1','','3'].
 *
 * Slice 10c Phase 2 commit 6: pulled out for reuse by the session card
 * (per ADR-0019 Q7 "set row 採模板 col 1=熱/N/DN"). Generic over the
 * input set type via `S extends SetLabelInput` so both `TemplateSet`
 * (template editor) and `SessionSetRow` (session logger, mapped via
 * `set_kind` → `kind`) work.
 */

export type SetKind = 'warmup' | 'working' | 'dropset';

export interface SetLabelInput {
  kind: SetKind;
  parent_set_id: string | null;
}

/**
 * Compute display labels for a sequence of sets, aligned 1:1 with the
 * input array (sets[i] → labels[i]).
 */
export function computeSetLabels<S extends SetLabelInput>(sets: S[]): string[] {
  let workIdx = 0;
  let clusterIdx = 0;
  return sets.map((s) => {
    if (s.kind === 'warmup') return '熱';
    if (s.kind === 'dropset') {
      if ((s.parent_set_id ?? null) === null) {
        clusterIdx += 1;
        return `D${clusterIdx}`;
      }
      return '';
    }
    workIdx += 1;
    return String(workIdx);
  });
}

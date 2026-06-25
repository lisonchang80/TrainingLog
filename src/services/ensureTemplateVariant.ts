import type { Database } from '../db/types';
import {
  attachTemplateToProgram,
  convertSessionToTemplate,
  createTemplate,
  findTemplateByTriple,
  getTemplateFull,
} from '../adapters/sqlite/templateRepository';
import { findLastSessionWithExercises } from '../adapters/sqlite/sessionRepository';

/**
 * Resolve (or create) the (name, program_id, sub_tag) template variant the user
 * picked, then prefill an empty one from their last workout. Returns the variant
 * id, ready to start a session from.
 *
 * Autostart-prefill spec, option 1 推廣 (2026-06-26 拍板). Generalises the earlier
 * 通用-only `ensureGeneralTemplateReady` to ANY classification. Starting a variant
 * that has no row yet (e.g. the group only has A-1/A-1 and the user picks 計畫A·
 * 強度A, or picks 通用 when only classified variants exist) MATERIALISES that
 * exact (program, sub_tag) row — reversing #50's "no-spawn-on-miss" FOR THE START
 * PATH ONLY — and prefills it, instead of `planResolveTarget` falling back to a
 * classified sibling + 「尚未建立模板」alert (#308). The session's 計劃·強度
 * subtitle then derives honestly from this freshly-classified linked template.
 *
 * 通用 is `(program_id=null, sub_tag=null)`. 編輯模板 (onSheetEdit) keeps the old
 * fallback+alert — the alert self-resolves once the first start materialises the
 * row.
 *
 * Idempotent:
 *   - existing NON-empty variant row → returned as-is (no re-prefill, no churn)
 *   - existing EMPTY variant row → prefilled in place (keeps id/identity)
 *   - no variant row → created; classified (program_id≠null OR sub_tag≠null) rows
 *     get `attachTemplateToProgram` so they carry the classification + register
 *     the Programs label pair; then prefilled
 *   - no prior workout → created/left empty (caller starts blank, as before)
 *
 * The prefill copies the most recent session-with-exercises' exercises + sets via
 * `convertSessionToTemplate` overwrite mode — keeps the variant row's identity and
 * does NOT touch the source session.
 *
 * `uuid` is REQUIRED (Hermes lacks crypto.randomUUID) — production passes
 * expo-crypto's randomUUID, tests pass a deterministic stub.
 */
export async function ensureTemplateVariantReady(
  db: Database,
  args: {
    name: string;
    program_id: string | null;
    sub_tag: string | null;
    uuid: () => string;
    now?: () => number;
  },
): Promise<string> {
  // lookup-or-create the (name, program_id, sub_tag) variant of this name-group.
  const existing = await findTemplateByTriple(db, {
    name: args.name,
    program_id: args.program_id,
    sub_tag: args.sub_tag,
  });
  let variantId = existing?.id ?? null;
  if (variantId == null) {
    variantId = args.uuid();
    // createTemplate leaves program_id / sub_tag NULL (= 通用) + colours the row
    // by name. For a classified selection, attach the (program, sub_tag) right
    // after so the new row carries the classification (and recordProgramSubTag
    // registers the pair for the Programs tab chip).
    await createTemplate(db, { id: variantId, name: args.name, now: args.now });
    if (args.program_id != null || args.sub_tag != null) {
      await attachTemplateToProgram(db, {
        template_id: variantId,
        program_id: args.program_id,
        sub_tag: args.sub_tag,
        now: args.now,
      });
    }
  }

  // Prefill an empty body from the user's last workout (overwrite in place →
  // keeps the variant identity, persists for next time). No history → stays empty.
  const full = await getTemplateFull(db, variantId);
  if (full && full.exercises.length === 0) {
    const lastSessionId = await findLastSessionWithExercises(db);
    if (lastSessionId) {
      await convertSessionToTemplate(db, {
        session_id: lastSessionId,
        template_name: full.name,
        mode: 'update',
        overwriteTemplateId: variantId,
        uuid: args.uuid,
        now: args.now,
      });
    }
  }
  return variantId;
}

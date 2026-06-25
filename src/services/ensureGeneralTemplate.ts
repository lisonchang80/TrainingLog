import type { Database } from '../db/types';
import {
  convertSessionToTemplate,
  createTemplate,
  findTemplateByTriple,
  getTemplateFull,
} from '../adapters/sqlite/templateRepository';
import { findLastSessionWithExercises } from '../adapters/sqlite/sessionRepository';

/**
 * Resolve (or create) the 通用 (program_id=null, sub_tag=null) template for a
 * name-group, then prefill its empty body from the user's last workout. Returns
 * the 通用 template id, ready to start a session from.
 *
 * Phase B+ of the autostart-prefill spec (2026-06-25 拍板). 通用 is the
 * always-available baseline: starting 通用 when the group has only classified
 * variants (e.g. only A-1/A-1 exists, no 通用 row) MATERIALISES a real 通用 row
 * — reversing #50's "no-spawn-on-miss" FOR THE 通用 CASE ONLY — and prefills it,
 * instead of falling back to a classified sibling + 「尚未建立模板」alert
 * (`planResolveTarget`'s fallback). Used by both 計劃-mode 通用 start and
 * 極簡-mode start.
 *
 * Idempotent:
 *   - existing NON-empty 通用 row → returned as-is (no re-prefill, no churn)
 *   - existing EMPTY 通用 row → prefilled in place (keeps id/identity)
 *   - no 通用 row → created (program/sub_tag NULL) then prefilled
 *   - no prior workout → created/left empty (caller starts blank, as before)
 *
 * The prefill copies the most recent session-with-exercises' exercises + sets
 * via `convertSessionToTemplate` overwrite mode — which keeps the 通用 row's
 * identity and does NOT touch the source session.
 *
 * `uuid` is REQUIRED (Hermes lacks crypto.randomUUID) — production passes
 * expo-crypto's randomUUID, tests pass a deterministic stub.
 */
export async function ensureGeneralTemplateReady(
  db: Database,
  args: { name: string; uuid: () => string; now?: () => number },
): Promise<string> {
  // lookup-or-create the 通用 (null, null) variant of this name-group.
  const existing = await findTemplateByTriple(db, {
    name: args.name,
    program_id: null,
    sub_tag: null,
  });
  let generalId = existing?.id ?? null;
  if (generalId == null) {
    generalId = args.uuid();
    // createTemplate leaves program_id / sub_tag NULL = a 通用 row; color
    // defaults to colorForTemplateName(name) so it shares the group color.
    await createTemplate(db, { id: generalId, name: args.name, now: args.now });
  }

  // Prefill an empty 通用 body from the user's last workout (overwrite in place
  // → keeps the 通用 identity, persists for next time). No history → stays empty.
  const full = await getTemplateFull(db, generalId);
  if (full && full.exercises.length === 0) {
    const lastSessionId = await findLastSessionWithExercises(db);
    if (lastSessionId) {
      await convertSessionToTemplate(db, {
        session_id: lastSessionId,
        template_name: full.name,
        mode: 'update',
        overwriteTemplateId: generalId,
        uuid: args.uuid,
        now: args.now,
      });
    }
  }
  return generalId;
}

import type { Database } from '../../db/types';
import { getSetting, setSetting, deleteSetting } from './settingsRepository';
import {
  STICKY_KEY_GLOBAL_LAST_PROGRAM_ID,
  STICKY_KEY_GLOBAL_LAST_SUB_TAG,
} from '../../domain/training/templateListGroups';

/**
 * GLOBAL last-used (program, sub_tag) memory for the start flow — distinct from
 * the per-template sticky (`start_dialog_last_*:<id>`). Backs Phase A of the
 * autostart-prefill spec: a fresh template's 開始訓練 reads this to auto-adopt
 * the user's most-recently-used 計劃·強度.
 *
 * `program_id` is stored in `period_id` space (通用 → the reserved 「無」
 * sentinel), mirroring how the per-template `persistSticky` stores the raw
 * picker selection. `sub_tag` follows the same clear-on-null rule as the
 * per-template sticky so a 通用 (no-intensity) start doesn't resurface a stale
 * intensity on the next read.
 */
export async function getGlobalLastUsed(
  db: Database,
): Promise<{ program_id: string | null; sub_tag: string | null }> {
  const [program_id, sub_tag] = await Promise.all([
    getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_PROGRAM_ID),
    getSetting<string>(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG),
  ]);
  return { program_id: program_id ?? null, sub_tag: sub_tag ?? null };
}

export async function setGlobalLastUsed(
  db: Database,
  program_id: string,
  sub_tag: string | null,
): Promise<void> {
  await setSetting<string>(db, STICKY_KEY_GLOBAL_LAST_PROGRAM_ID, program_id);
  if (sub_tag != null) {
    await setSetting<string>(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG, sub_tag);
  } else {
    // 通用 / no intensity — clear any stored value so the next read defaults
    // back to 通用 rather than resurfacing a stale intensity.
    await deleteSetting(db, STICKY_KEY_GLOBAL_LAST_SUB_TAG);
  }
}

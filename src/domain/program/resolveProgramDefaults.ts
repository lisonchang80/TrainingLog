/**
 * Pure logic — resolve default (period, intensity) selection for the start
 * dialog's 週期 / 強度 pickers (ADR-0019 §Q9.1a + Q9.2 FB1 / N1).
 *
 * The dialog opens with the user's last-used (program_id, sub_tag) pair so
 * starting another session with the same parameters is a 2-tap path. First
 * run (no recorded last-use) falls back to the reserved 「無」 program entity
 * + null sub_tag (per N1's "always a real entity, never NULL on program_id"
 * invariant — see `RESERVED_NONE_PROGRAM_ID` in v017ProgramNone seed).
 *
 * If the last-used program_id is no longer in the available list (user deleted
 * the program), we treat the stored value as stale and fall back the same way.
 * The intensity dropdown handles deletion similarly — a stale sub_tag string
 * collapses to null.
 *
 * Output is the resolved `(period_id, intensity_id)` that the picker should
 * pre-select on open. Caller (start sheet UI) writes this back through the
 * `setSetting` helper on confirm so next session opens at the new sticky.
 */
import { RESERVED_NONE_PROGRAM_ID } from '../../db/seed/v017ProgramNone';

export interface ProgramOption {
  /** Program entity UUID; '無' uses RESERVED_NONE_PROGRAM_ID. */
  id: string;
  name: string;
}

export interface ResolveProgramDefaultsInput {
  /** Available period options (programs). MUST include the reserved 「無」 entity. */
  programs: ProgramOption[];
  /** Available intensity options (free-form sub_tag strings). May be empty. */
  subTags: string[];
  /** Last-used program_id read from app_settings; null = first run / never set. */
  lastUsedProgramId: string | null;
  /** Last-used sub_tag read from app_settings; null = first run / no intensity. */
  lastUsedSubTag: string | null;
}

export interface ProgramDefaults {
  /** Resolved program_id to pre-select. Always a real id (never null). */
  period_id: string;
  /** Resolved sub_tag to pre-select; null when no intensity applies / no last-use. */
  intensity_id: string | null;
}

/**
 * Pick the picker defaults for the start dialog.
 *
 * Rules:
 *   1. `period_id` = lastUsedProgramId when it's still in `programs`, else
 *      `RESERVED_NONE_PROGRAM_ID` (per Q9.2 FB1 fallback). If `RESERVED_NONE_PROGRAM_ID`
 *      isn't in the programs list (shouldn't normally happen post-v017 seed),
 *      we still return the constant — caller is expected to render it as a
 *      fixed option regardless.
 *   2. `intensity_id` = lastUsedSubTag when it's still in `subTags`, else null.
 *      Selecting 「無」 period hides the intensity picker entirely per spec —
 *      caller decides whether to honour the resolved intensity in that case;
 *      this function still returns it so re-picking a non-無 period restores it.
 */
export function resolveProgramDefaults(
  input: ResolveProgramDefaultsInput,
): ProgramDefaults {
  const { programs, subTags, lastUsedProgramId, lastUsedSubTag } = input;

  const programStillExists =
    lastUsedProgramId != null &&
    programs.some((p) => p.id === lastUsedProgramId);

  const period_id = programStillExists
    ? (lastUsedProgramId as string)
    : RESERVED_NONE_PROGRAM_ID;

  const subTagStillExists =
    lastUsedSubTag != null && subTags.includes(lastUsedSubTag);

  const intensity_id = subTagStillExists ? lastUsedSubTag : null;

  return { period_id, intensity_id };
}

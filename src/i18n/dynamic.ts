/**
 * i18n dynamic helpers — function form for strings with `${var}` interpolation.
 *
 * Why functions instead of templated strings:
 *   - TypeScript can type-check the argument shape (number vs string vs object).
 *   - No need for an i18next-style `{{var}}` token + runtime substitution.
 *   - Each helper bundles zh + en together, so swapping locale never goes out
 *     of sync at the call site.
 *
 * Each helper switches on `getLocale()` at call time. Locale is module-level
 * (see `strings.ts`), so a `setLocale('en')` propagates to every subsequent
 * `tCycleN(...)` automatically.
 *
 * Coverage: 52 templates from `/tmp/i18n-extraction-report.md` section 6,
 * plus the inline `{count} 次` library badges. Achievement strings (~7 in
 * `v008Achievements.ts`) intentionally skipped — see Phase 2 user decision.
 */

import { getLocale } from './strings';

const isEn = (): boolean => getLocale() === 'en';

// ---------------------------------------------------------------------------
// Cycle / day / week count templates
// ---------------------------------------------------------------------------

/** Wizard step 4 column header. `週期 3` / `Cycle 3`. */
export function tCycleN(n: number): string {
  return isEn() ? `Cycle ${n}` : `週期 ${n}`;
}

/** Day label (1-indexed). `第 3 天` / `Day 3`. */
export function tDayN(n: number): string {
  return isEn() ? `Day ${n}` : `第 ${n} 天`;
}

/** Week label (1-indexed). `第 3 週` / `Week 3`. */
export function tWeekN(n: number): string {
  return isEn() ? `Week ${n}` : `第 ${n} 週`;
}

/** Cycle length picker label. `3 天` / `3 days`. */
export function tNDays(n: number): string {
  return isEn() ? `${n} days` : `${n} 天`;
}

/** Cycle count picker label. `4 週期` / `4 cycles`. */
export function tNCycles(n: number): string {
  return isEn() ? `${n} cycles` : `${n} 週期`;
}

/** Session count badge on library cards. `5 次` / `5 sessions`. */
export function tNSessions(n: number): string {
  return isEn() ? `${n} sessions` : `${n} 次`;
}

/** Used-N-times badge on superset detail header. `· 已使用 5 次` / `· Used in 5 sessions`. */
export function tUsedNSessions(n: number): string {
  return isEn() ? `· Used in ${n} sessions` : `· 已使用 ${n} 次`;
}

/**
 * 訓練 tab 計劃訓練 row 的「N 個動作」副標 (ADR-0024 § 2.a)。
 * Plural form left as singular `exercise` only when n === 1 in en.
 */
export function tExerciseCount(n: number): string {
  if (isEn()) return n === 1 ? `${n} exercise` : `${n} exercises`;
  return `${n} 個動作`;
}

/**
 * 訓練 tab 計劃訓練 row 的 accessibilityLabel (ADR-0024 § 2.a)。
 * 例：`開始今天計劃：PPL Push` / `Start today's plan: PPL Push`.
 */
export function tA11yStartPlanned(name: string): string {
  return isEn() ? `Start today's plan: ${name}` : `開始今天計劃：${name}`;
}

/** Inline month-only label on stats x-axis. `5月` / `May`. */
export function tMonthOfYear(month1To12: number): string {
  if (isEn()) {
    const names = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    return names[month1To12 - 1] ?? `${month1To12}`;
  }
  return `${month1To12}月`;
}

// ---------------------------------------------------------------------------
// Weekday array (used in wizard preview list & calendar headers)
// ---------------------------------------------------------------------------

/** Localized 7-element array, index 0 = Mon, 6 = Sun — matches `app/program/[id].tsx:12`. */
export function tWeekdayLabels(): readonly string[] {
  return isEn()
    ? (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const)
    : (['一', '二', '三', '四', '五', '六', '日'] as const);
}

/** Single weekday label by 0-indexed Mon-first index. `· 三` / `· Wed`. */
export function tWeekdayWithDot(monIndex0to6: number): string {
  const labels = tWeekdayLabels();
  const label = labels[monIndex0to6] ?? '';
  return `· ${label}`;
}

// ---------------------------------------------------------------------------
// Delete / remove confirmation prompts
// ---------------------------------------------------------------------------

/** Generic delete confirmation. `刪除「Bench Press」？` / `Delete "Bench Press"?`. */
export function tDeletePrompt(name: string): string {
  return isEn() ? `Delete "${name}"?` : `刪除「${name}」？`;
}

/**
 * Exercise-delete confirmation including library-side warning.
 * Used by `app/exercise/[id].tsx:151`.
 */
export function tDeleteExerciseFromLibrary(name: string): string {
  return isEn()
    ? `Delete "${name}"? History will be preserved, but the exercise will be removed from the library.`
    : `確認刪除「${name}」？歷史紀錄會保留，但動作會從動作庫移除。`;
}

/** Superset delete confirmation. `app/superset/[id].tsx:110`. */
export function tDeleteSupersetPrompt(name: string): string {
  return isEn()
    ? `Delete "${name}"? Copies already added to Templates will be preserved.`
    : `確認刪除「${name}」？已加進 Template 的副本會保留。`;
}

/** Remove exercise from session — used in supersetNew & cluster ⚙️ menus. */
export function tRemoveExercise(name: string): string {
  return isEn() ? `Remove ${name}` : `移除 ${name}`;
}

/** Remove intensity chip. `移除強度 X` / `Remove intensity X`. */
export function tRemoveIntensity(tag: string): string {
  return isEn() ? `Remove intensity ${tag}` : `移除強度 ${tag}`;
}

// ---------------------------------------------------------------------------
// Session-removal compound prompts (cluster + solo, with set-count warning)
// ---------------------------------------------------------------------------

/**
 * `要從這次訓練中移除「Bench Press」？{warning}` — solo path.
 * `warningSuffix` already pre-formatted by caller (uses helpers below).
 */
export function tRemoveExerciseFromSessionPrompt(name: string, warningSuffix: string): string {
  return isEn()
    ? `Remove "${name}" from this session?${warningSuffix}`
    : `要從這次訓練中移除「${name}」？${warningSuffix}`;
}

/** `要從這次訓練中移除整個超級組「A + B」？{warning}` — cluster path. */
export function tRemoveSupersetFromSessionPrompt(
  aName: string,
  bName: string,
  warningSuffix: string,
): string {
  return isEn()
    ? `Remove the entire superset "${aName} + ${bName}" from this session?${warningSuffix}`
    : `要從這次訓練中移除整個超級組「${aName} + ${bName}」？${warningSuffix}`;
}

/**
 * Warning fragment when the cluster being removed has both total + logged counts.
 * Renders e.g. `\n\n將連同 6 組記錄一起刪除（其中 4 組已標完成）。`
 */
export function tWarningTotalSetsWithLogged(totalSets: number, loggedCount: number): string {
  return isEn()
    ? `\n\nThis will also delete ${totalSets} sets (${loggedCount} marked done).`
    : `\n\n將連同 ${totalSets} 組記錄一起刪除（其中 ${loggedCount} 組已標完成）。`;
}

/** Warning fragment with total-only (no sets logged). */
export function tWarningTotalSetsUnfinished(totalSets: number): string {
  return isEn()
    ? `\n\nThis will also delete ${totalSets} unfinished sets.`
    : `\n\n將連同 ${totalSets} 組未完成記錄一起刪除。`;
}

/** Per-exercise variant of the with-logged warning. */
export function tWarningPerExerciseSetsWithLogged(setsForExercise: number, loggedCount: number): string {
  return isEn()
    ? `\n\n⚠️ This will also delete ${setsForExercise} sets for this exercise (${loggedCount} marked done).`
    : `\n\n⚠️ 將連同此動作的 ${setsForExercise} 組記錄一起刪除（其中 ${loggedCount} 組已標完成）。`;
}

/** Per-exercise variant with no logged sets. */
export function tWarningPerExerciseSetsUnfinished(setsForExercise: number): string {
  return isEn()
    ? `\n\nThis will also delete ${setsForExercise} unfinished sets for this exercise.`
    : `\n\n將連同此動作的 ${setsForExercise} 組未完成記錄一起刪除。`;
}

// ---------------------------------------------------------------------------
// Program / template wizard / cell actions
// ---------------------------------------------------------------------------

/** Apply-template-to-day picker title (0-indexed day input). */
export function tApplyTemplateToDay(dayIndex0Based: number): string {
  return isEn()
    ? `Apply template to Day ${dayIndex0Based + 1}`
    : `套用 template 到第 ${dayIndex0Based + 1} 天`;
}

/** Apply-intensity-to-cycle picker title (0-indexed cycle input). */
export function tApplyIntensityToCycle(cycleIndex0Based: number): string {
  return isEn()
    ? `Apply intensity to Cycle ${cycleIndex0Based + 1}`
    : `套用強度到第 ${cycleIndex0Based + 1} 週期`;
}

/** Wizard preview column header. `週期 1` / `Cycle 1`. (alias of `tCycleN`, kept for callsite clarity) */
export function tCycleHeader(cycleIndex0Based: number): string {
  return tCycleN(cycleIndex0Based + 1);
}

/** Shrink program resize confirmation. */
export function tDiscardFilledCells(lost: number): string {
  return isEn()
    ? `${lost} filled cells (template + intensity) will be discarded. This cannot be undone.`
    : `將砍掉 ${lost} 格已填內容（template + 強度）。此動作無法復原。`;
}

// ---------------------------------------------------------------------------
// Replay session prompts (history → current card)
// ---------------------------------------------------------------------------

/** Replay solo card from a historical session. */
export function tReplaySoloPrompt(setCount: number): string {
  return isEn()
    ? `All sets on the current card will be discarded and rebuilt from this session's ${setCount} sets.\n\n(is_logged is reset to unchecked; weight / reps / set_kind copy over; notes do not.)`
    : `將砍掉目前這張卡片所有 sets，依該 session 的 ${setCount} 組記錄重新建立。\n\n（is_logged 會重置為未 ✓ 狀態，weight / reps / set_kind 會複製，notes 不複製）`;
}

/** Replay cluster (A+B) from a historical session. */
export function tReplayClusterPrompt(setCount: number): string {
  return isEn()
    ? `All sets on both A+B sides of the current superset will be discarded and rebuilt from this session's ${setCount} sets.\n\n(is_logged is reset to unchecked; weight / reps / set_kind copy over; notes do not.)`
    : `將砍掉目前這組超級組 A+B 兩側所有 sets，依該 session 的 ${setCount} 組記錄重新建立。\n\n（is_logged 會重置為未 ✓ 狀態，weight / reps / set_kind 會複製，notes 不複製）`;
}

// ---------------------------------------------------------------------------
// Template / save-as-template feedback
// ---------------------------------------------------------------------------

/** Template-created toast / Alert body. */
export function tTemplateCreated(name: string): string {
  return isEn() ? `Template "${name}" created.` : `模板「${name}」已建立。`;
}

/** Template-updated toast / Alert body. */
export function tTemplateUpdated(name: string): string {
  return isEn() ? `Template "${name}" updated.` : `模板「${name}」已更新。`;
}

/** Duplicate-triple Alert when saving template with an existing (name, program, intensity). */
export function tDuplicateTemplateTriple(name: string): string {
  return isEn()
    ? `The combination of "${name}" + this program + this intensity already exists. Rename or pick a different variant.`
    : `「${name}」+ 該計畫 + 該強度的組合已存在。請改名或選不同變體。`;
}

/** Permanent-delete Alert for a single template variant. */
export function tDeleteTemplateVariant(name: string, tripleLines: string): string {
  // tripleLines is already pre-formatted by caller — see templates.tsx:226
  return isEn()
    ? `"${name}" (${tripleLines}) will be permanently deleted. This cannot be undone.\n\nHistorical session records are unaffected.`
    : `將永久刪除「${name}」(${tripleLines})。此操作無法復原。\n\n歷史 session 紀錄不受影響。`;
}

/** Permanent-delete Alert for all variants of a template name. */
export function tDeleteAllTemplateVariants(name: string, variantCount: number, tripleLines: string): string {
  return isEn()
    ? `All ${variantCount} variants of "${name}" will be permanently deleted:\n${tripleLines}\n\nThis cannot be undone. Historical session records are unaffected.`
    : `將永久刪除「${name}」的全部 ${variantCount} 個變體：\n${tripleLines}\n\n此操作無法復原。歷史 session 紀錄不受影響。`;
}

// ---------------------------------------------------------------------------
// Misc inline templates
// ---------------------------------------------------------------------------

/** Filter chip count. `3 副` / `3 intensities`. */
export function tIntensityFilterCount(n: number): string {
  return isEn() ? `${n} intensities` : `${n} 副`;
}

/** Rest-seconds cluster-action header. `⏱️ 休息秒數 · Bench Press` / `⏱️ Rest Seconds · Bench Press`. */
export function tRestSecondsHeader(exerciseName: string): string {
  return isEn() ? `⏱️ Rest Seconds · ${exerciseName}` : `⏱️ 休息秒數 · ${exerciseName}`;
}

/** Exercise-note cluster-action header. */
export function tExerciseNoteHeader(exerciseName: string): string {
  return isEn() ? `📝 ${exerciseName} Note` : `📝 ${exerciseName} 備註`;
}

/** Last-bodyweight reminder line in today-page Alert. */
export function tLastBodyweightLine(formatted: string): string {
  return isEn() ? `\nLast record: ${formatted}` : `\n上次紀錄：${formatted}`;
}

/** View-exercise-details link from superset detail page. */
export function tViewExerciseDetails(exerciseName: string): string {
  return isEn() ? `View ${exerciseName} details` : `查看 ${exerciseName} 詳情`;
}

/** Cluster A/B switcher button label. */
export function tSwitchToPartner(partnerName: string): string {
  return isEn() ? `Switch to ${partnerName}` : `切換到 ${partnerName}`;
}

/** Bodyweight history row label. */
export function tBodyweightWithValue(formatted: string): string {
  return isEn() ? `Bodyweight ${formatted}` : `體重 ${formatted}`;
}

/** Bodyweight column header with unit. `體重 (kg)` / `Bodyweight (kg)`. */
export function tBodyweightWithUnit(unit: string): string {
  return isEn() ? `Bodyweight (${unit})` : `體重 (${unit})`;
}

/** PR delta line: `· 從 100 → 120`. */
export function tPrDeltaLine(priorFormatted: string, newFormatted: string): string {
  return isEn()
    ? `· From ${priorFormatted} → ${newFormatted}`
    : `· 從 ${priorFormatted} → ${newFormatted}`;
}

/** Effective + raw assisted weight display. `100 kg (助力 20 kg)` / `100 kg (assisted 20 kg)`. */
export function tAssistedEffective(effectiveFormatted: string, rawFormatted: string): string {
  return isEn()
    ? `${effectiveFormatted} (assisted ${rawFormatted})`
    : `${effectiveFormatted}（助力 ${rawFormatted}）`;
}

/** Body metrics section header with row count. `歷史 (5)` / `History (5)`. */
export function tHistoryWithCount(count: number): string {
  return isEn() ? `History (${count})` : `歷史 (${count})`;
}

/** Validation thrown-Error including offending muscle groups. */
export function tMuscleGroupOverlapError(overlap: string[]): string {
  return isEn()
    ? `A muscle group cannot be both primary and secondary: ${overlap.join(', ')}`
    : `肌群不可同時為主要與次要：${overlap.join(', ')}`;
}

/** Save / saving ternary helper — both branches in one call. */
export function tSaveOrSaving(busy: boolean): string {
  if (busy) {
    return isEn() ? 'Saving…' : '儲存中…';
  }
  return isEn() ? 'Save' : '儲存';
}

/** Duplicate RS pair thrown-Error message — includes existing RS id for dev. */
export function tDuplicateRsPairError(existingId: string): string {
  return isEn()
    ? `duplicate RS pair: a superset with this exercise pair already exists (existing id: ${existingId})`
    : `duplicate RS pair: 已有同樣動作組合的超級組 (existing id: ${existingId})`;
}

/** Main-tag legacy display on program detail page. */
export function tMainTagLine(mainTag: string): string {
  return isEn() ? `Main tag: ${mainTag}` : `主標籤：${mainTag}`;
}

/**
 * Wave 18g (Phase 6) — same-name overwrite UX. Banner title shown
 * inline in Step 1 + Step 6 confirm panel when the typed name matches
 * an existing program. The matched program's sub_tags are auto-prefilled
 * into draft.sub_tags so they appear in the strength chip row directly.
 */
export function tOverwriteBannerTitle(programName: string): string {
  return isEn()
    ? `Will overwrite existing program "${programName}"`
    : `將覆蓋既有計劃「${programName}」`;
}

/**
 * Wave 18g — Alert body shown when overwriteProgram throws
 * PROGRAM_HAS_ACTIVE_SESSION. Tells the user to finish or discard
 * the in-progress session before overwriting the program.
 */
export function tOverwriteBlockedByActiveSession(programName: string): string {
  return isEn()
    ? `"${programName}" has an in-progress session. Please finish or discard it first.`
    : `「${programName}」有進行中的 session，請先完成或捨棄。`;
}

// ---------------------------------------------------------------------------
// Muscle (M layer) label translator — overnight 5/23 anatomy M-level heatmap.
//
// Maps the 18 stable M_* IDs from `src/db/seed/v006ExerciseLibrary.ts` to a
// short display label suitable for body-heatmap callouts. zh literal mirrors
// the MUSCLE_SEEDS `name` column (same source-of-truth as the DB seed); en
// uses a short anatomical label tuned for the SVG label column width.
//
// Unknown IDs pass through unchanged so legacy / custom rows never crash.
// ---------------------------------------------------------------------------

const M_LABELS_ZH: Record<string, string> = {
  'm-upper-chest': '上胸',
  'm-lower-chest': '中下胸',
  'm-back': '背部',
  'm-lower-back': '下背',
  'm-quad': '股四',
  'm-hamstring': '膕繩',
  'm-upper-glute': '上臀',
  'm-lower-glute': '下臀',
  'm-front-delt': '前束',
  'm-mid-delt': '中束',
  'm-rear-delt': '後束',
  'm-trap': '斜方',
  'm-bicep-long': '二頭外',
  'm-bicep-short': '二頭內',
  'm-tricep': '三頭',
  'm-calf': '小腿',
  'm-forearm': '小臂',
  'm-oblique': '側腹',
  'm-abs': '腹肌',
};

const M_LABELS_EN: Record<string, string> = {
  'm-upper-chest': 'Upper Chest',
  'm-lower-chest': 'Lower Chest',
  'm-back': 'Back',
  'm-lower-back': 'Lower Back',
  'm-quad': 'Quads',
  'm-hamstring': 'Hamstring',
  'm-upper-glute': 'Upper Glute',
  'm-lower-glute': 'Lower Glute',
  'm-front-delt': 'Front Delt',
  'm-mid-delt': 'Side Delt',
  'm-rear-delt': 'Rear Delt',
  'm-trap': 'Trap',
  'm-bicep-long': 'Bicep Outer',
  'm-bicep-short': 'Bicep Inner',
  'm-tricep': 'Tricep',
  'm-calf': 'Calf',
  'm-forearm': 'Forearm',
  'm-oblique': 'Obliques',
  'm-abs': 'Abs',
};

/**
 * Muscle (M layer) ID → localized short label. Unknown IDs pass through.
 *
 * @example
 *   tMuscle('m-quad') // zh → '股四', en → 'Quads'
 *   tMuscle('m-unknown') // 'm-unknown' (pass-through)
 */
export function tMuscle(mId: string): string {
  const table = isEn() ? M_LABELS_EN : M_LABELS_ZH;
  return table[mId] ?? mId;
}

/**
 * Phase 4.5 final sweep — History list exercise-count badge.
 * `5動` / `5 ex`. Compact suffix appended to subtitle line.
 */
export function tNExerciseCount(n: number): string {
  return isEn() ? `${n} ex` : `${n}動`;
}

/**
 * Phase 4.5 final sweep — Calendar grid header title.
 * `2026年5月` / `May 2026`. Uses tMonthOfYear under the hood for EN month names.
 */
export function tYearMonthTitle(year: number, month1To12: number): string {
  if (isEn()) {
    return `${tMonthOfYear(month1To12)} ${year}`;
  }
  return `${year}年${month1To12}月`;
}

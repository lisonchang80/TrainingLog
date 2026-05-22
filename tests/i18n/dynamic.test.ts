/**
 * Tests for `src/i18n/dynamic.ts`.
 *
 * Each helper is exercised in both zh + en to catch typos and interpolation
 * regressions. Includes boundary cases for numeric input (0) and string input
 * (quotes / cjk / empty).
 */

import { setLocale } from '../../src/i18n/strings';
import {
  tCycleN,
  tDayN,
  tWeekN,
  tNDays,
  tNCycles,
  tNSessions,
  tUsedNSessions,
  tMonthOfYear,
  tWeekdayLabels,
  tWeekdayWithDot,
  tDeletePrompt,
  tDeleteExerciseFromLibrary,
  tDeleteSupersetPrompt,
  tRemoveExercise,
  tRemoveIntensity,
  tRemoveExerciseFromSessionPrompt,
  tRemoveSupersetFromSessionPrompt,
  tWarningTotalSetsWithLogged,
  tWarningTotalSetsUnfinished,
  tWarningPerExerciseSetsWithLogged,
  tWarningPerExerciseSetsUnfinished,
  tApplyTemplateToDay,
  tApplyIntensityToCycle,
  tCycleHeader,
  tDiscardFilledCells,
  tReplaySoloPrompt,
  tReplayClusterPrompt,
  tTemplateCreated,
  tTemplateUpdated,
  tDuplicateTemplateTriple,
  tDeleteTemplateVariant,
  tDeleteAllTemplateVariants,
  tIntensityFilterCount,
  tRestSecondsHeader,
  tExerciseNoteHeader,
  tLastBodyweightLine,
  tViewExerciseDetails,
  tSwitchToPartner,
  tBodyweightWithValue,
  tBodyweightWithUnit,
  tPrDeltaLine,
  tAssistedEffective,
  tHistoryWithCount,
  tMuscleGroupOverlapError,
  tSaveOrSaving,
  tDuplicateRsPairError,
  tMainTagLine,
} from '../../src/i18n/dynamic';

afterEach(() => {
  setLocale('zh');
});

describe('cycle / day / week / count helpers', () => {
  test('tCycleN — zh + en', () => {
    expect(tCycleN(3)).toBe('週期 3');
    setLocale('en');
    expect(tCycleN(3)).toBe('Cycle 3');
  });

  test('tDayN — zh + en', () => {
    expect(tDayN(2)).toBe('第 2 天');
    setLocale('en');
    expect(tDayN(2)).toBe('Day 2');
  });

  test('tWeekN — zh + en', () => {
    expect(tWeekN(4)).toBe('第 4 週');
    setLocale('en');
    expect(tWeekN(4)).toBe('Week 4');
  });

  test('tNDays / tNCycles / tNSessions — zh + en', () => {
    expect(tNDays(7)).toBe('7 天');
    expect(tNCycles(3)).toBe('3 週期');
    expect(tNSessions(12)).toBe('12 次');
    setLocale('en');
    expect(tNDays(7)).toBe('7 days');
    expect(tNCycles(3)).toBe('3 cycles');
    expect(tNSessions(12)).toBe('12 sessions');
  });

  test('tUsedNSessions — keeps dot prefix', () => {
    expect(tUsedNSessions(5)).toBe('· 已使用 5 次');
    setLocale('en');
    expect(tUsedNSessions(5)).toBe('· Used in 5 sessions');
  });

  test('boundary: n=0 still renders cleanly', () => {
    expect(tCycleN(0)).toBe('週期 0');
    expect(tNDays(0)).toBe('0 天');
    setLocale('en');
    expect(tCycleN(0)).toBe('Cycle 0');
    expect(tNDays(0)).toBe('0 days');
  });

  test('tMonthOfYear — index 1..12', () => {
    expect(tMonthOfYear(5)).toBe('5月');
    setLocale('en');
    expect(tMonthOfYear(5)).toBe('May');
    expect(tMonthOfYear(1)).toBe('Jan');
    expect(tMonthOfYear(12)).toBe('Dec');
  });
});

describe('weekday helpers', () => {
  test('tWeekdayLabels — Mon-first ordering matches app/program/[id].tsx:12', () => {
    expect(tWeekdayLabels()).toEqual(['一', '二', '三', '四', '五', '六', '日']);
    setLocale('en');
    expect(tWeekdayLabels()).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  test('tWeekdayWithDot — picks correct index', () => {
    expect(tWeekdayWithDot(0)).toBe('· 一'); // Mon
    expect(tWeekdayWithDot(6)).toBe('· 日'); // Sun
    setLocale('en');
    expect(tWeekdayWithDot(0)).toBe('· Mon');
    expect(tWeekdayWithDot(6)).toBe('· Sun');
  });
});

describe('delete / remove prompts', () => {
  test('tDeletePrompt — wraps name in 「」 (zh) or "" (en)', () => {
    expect(tDeletePrompt('Bench Press')).toBe('刪除「Bench Press」？');
    setLocale('en');
    expect(tDeletePrompt('Bench Press')).toBe('Delete "Bench Press"?');
  });

  test('tDeletePrompt — CJK name', () => {
    expect(tDeletePrompt('深蹲')).toBe('刪除「深蹲」？');
  });

  test('tDeletePrompt — empty name still renders without crash', () => {
    expect(tDeletePrompt('')).toBe('刪除「」？');
    setLocale('en');
    expect(tDeletePrompt('')).toBe('Delete ""?');
  });

  test('tDeletePrompt — name containing quote chars survives interpolation', () => {
    // ES template literal just concatenates — no escaping needed at the helper level.
    setLocale('en');
    expect(tDeletePrompt('My "fav" exercise')).toBe('Delete "My "fav" exercise"?');
  });

  test('tDeleteExerciseFromLibrary', () => {
    setLocale('en');
    expect(tDeleteExerciseFromLibrary('Bench Press')).toContain('Bench Press');
    expect(tDeleteExerciseFromLibrary('Bench Press')).toContain('History will be preserved');
  });

  test('tDeleteSupersetPrompt', () => {
    expect(tDeleteSupersetPrompt('Chest Day')).toBe(
      '確認刪除「Chest Day」？已加進 Template 的副本會保留。',
    );
    setLocale('en');
    expect(tDeleteSupersetPrompt('Chest Day')).toBe(
      'Delete "Chest Day"? Copies already added to Templates will be preserved.',
    );
  });

  test('tRemoveExercise / tRemoveIntensity', () => {
    expect(tRemoveExercise('Bench Press')).toBe('移除 Bench Press');
    expect(tRemoveIntensity('10-12RM')).toBe('移除強度 10-12RM');
    setLocale('en');
    expect(tRemoveExercise('Bench Press')).toBe('Remove Bench Press');
    expect(tRemoveIntensity('10-12RM')).toBe('Remove intensity 10-12RM');
  });
});

describe('session-removal compound prompts', () => {
  test('tRemoveExerciseFromSessionPrompt — interpolation with warning suffix', () => {
    const warning = '\n\nThis will also delete 3 unfinished sets for this exercise.';
    setLocale('en');
    expect(tRemoveExerciseFromSessionPrompt('Bench Press', warning)).toBe(
      'Remove "Bench Press" from this session?\n\nThis will also delete 3 unfinished sets for this exercise.',
    );
  });

  test('tRemoveSupersetFromSessionPrompt — both partner names render', () => {
    setLocale('en');
    expect(tRemoveSupersetFromSessionPrompt('A', 'B', '')).toBe(
      'Remove the entire superset "A + B" from this session?',
    );
  });

  test('warning fragments — both variants', () => {
    expect(tWarningTotalSetsWithLogged(6, 4)).toBe(
      '\n\n將連同 6 組記錄一起刪除（其中 4 組已標完成）。',
    );
    expect(tWarningTotalSetsUnfinished(5)).toBe('\n\n將連同 5 組未完成記錄一起刪除。');
    setLocale('en');
    expect(tWarningTotalSetsWithLogged(6, 4)).toBe(
      '\n\nThis will also delete 6 sets (4 marked done).',
    );
    expect(tWarningTotalSetsUnfinished(5)).toBe('\n\nThis will also delete 5 unfinished sets.');
  });

  test('per-exercise warning fragments', () => {
    expect(tWarningPerExerciseSetsWithLogged(4, 2)).toContain('4 組記錄');
    expect(tWarningPerExerciseSetsUnfinished(3)).toContain('3 組未完成');
    setLocale('en');
    expect(tWarningPerExerciseSetsWithLogged(4, 2)).toContain('4 sets for this exercise');
    expect(tWarningPerExerciseSetsUnfinished(3)).toContain('3 unfinished sets for this exercise');
  });
});

describe('program / template cell actions', () => {
  test('tApplyTemplateToDay — 0-indexed input rendered 1-indexed', () => {
    expect(tApplyTemplateToDay(0)).toBe('套用 template 到第 1 天');
    setLocale('en');
    expect(tApplyTemplateToDay(0)).toBe('Apply template to Day 1');
    expect(tApplyTemplateToDay(6)).toBe('Apply template to Day 7');
  });

  test('tApplyIntensityToCycle — 0-indexed input rendered 1-indexed', () => {
    expect(tApplyIntensityToCycle(2)).toBe('套用強度到第 3 週期');
    setLocale('en');
    expect(tApplyIntensityToCycle(2)).toBe('Apply intensity to Cycle 3');
  });

  test('tCycleHeader — wraps tCycleN with 0-indexed input', () => {
    expect(tCycleHeader(0)).toBe('週期 1');
    setLocale('en');
    expect(tCycleHeader(0)).toBe('Cycle 1');
  });

  test('tDiscardFilledCells', () => {
    expect(tDiscardFilledCells(5)).toBe('將砍掉 5 格已填內容（template + 強度）。此動作無法復原。');
    setLocale('en');
    expect(tDiscardFilledCells(5)).toBe(
      '5 filled cells (template + intensity) will be discarded. This cannot be undone.',
    );
  });
});

describe('replay prompts', () => {
  test('tReplaySoloPrompt — both locales include set count', () => {
    expect(tReplaySoloPrompt(8)).toContain('8 組記錄');
    setLocale('en');
    expect(tReplaySoloPrompt(8)).toContain("session's 8 sets");
  });

  test('tReplayClusterPrompt — both locales include set count', () => {
    expect(tReplayClusterPrompt(12)).toContain('12 組記錄');
    setLocale('en');
    expect(tReplayClusterPrompt(12)).toContain("session's 12 sets");
  });
});

describe('template create/update feedback', () => {
  test('tTemplateCreated / tTemplateUpdated', () => {
    expect(tTemplateCreated('Push Day')).toBe('模板「Push Day」已建立。');
    expect(tTemplateUpdated('Push Day')).toBe('模板「Push Day」已更新。');
    setLocale('en');
    expect(tTemplateCreated('Push Day')).toBe('Template "Push Day" created.');
    expect(tTemplateUpdated('Push Day')).toBe('Template "Push Day" updated.');
  });

  test('tDuplicateTemplateTriple', () => {
    setLocale('en');
    expect(tDuplicateTemplateTriple('Push Day')).toContain('"Push Day"');
    expect(tDuplicateTemplateTriple('Push Day')).toContain('already exists');
  });

  test('tDeleteTemplateVariant / tDeleteAllTemplateVariants', () => {
    setLocale('en');
    const single = tDeleteTemplateVariant('Push Day', 'Hypertrophy-Q1 · 10-12RM');
    expect(single).toContain('"Push Day"');
    expect(single).toContain('Hypertrophy-Q1');
    expect(single).toContain('Historical session records are unaffected.');

    const all = tDeleteAllTemplateVariants('Push Day', 3, '• v1\n• v2\n• v3');
    expect(all).toContain('All 3 variants');
    expect(all).toContain('Historical session records are unaffected.');
  });
});

describe('misc inline templates', () => {
  test('tIntensityFilterCount', () => {
    expect(tIntensityFilterCount(3)).toBe('3 副');
    setLocale('en');
    expect(tIntensityFilterCount(3)).toBe('3 intensities');
  });

  test('tRestSecondsHeader / tExerciseNoteHeader', () => {
    expect(tRestSecondsHeader('Bench Press')).toBe('⏱️ 休息秒數 · Bench Press');
    expect(tExerciseNoteHeader('Bench Press')).toBe('📝 Bench Press 備註');
    setLocale('en');
    expect(tRestSecondsHeader('Bench Press')).toBe('⏱️ Rest Seconds · Bench Press');
    expect(tExerciseNoteHeader('Bench Press')).toBe('📝 Bench Press Note');
  });

  test('tLastBodyweightLine', () => {
    expect(tLastBodyweightLine('75 kg')).toBe('\n上次紀錄：75 kg');
    setLocale('en');
    expect(tLastBodyweightLine('75 kg')).toBe('\nLast record: 75 kg');
  });

  test('tViewExerciseDetails / tSwitchToPartner', () => {
    expect(tViewExerciseDetails('Bench Press')).toBe('查看 Bench Press 詳情');
    expect(tSwitchToPartner('Chest Dip')).toBe('切換到 Chest Dip');
    setLocale('en');
    expect(tViewExerciseDetails('Bench Press')).toBe('View Bench Press details');
    expect(tSwitchToPartner('Chest Dip')).toBe('Switch to Chest Dip');
  });

  test('tBodyweightWithValue / tBodyweightWithUnit', () => {
    expect(tBodyweightWithValue('75 kg')).toBe('體重 75 kg');
    expect(tBodyweightWithUnit('kg')).toBe('體重 (kg)');
    setLocale('en');
    expect(tBodyweightWithValue('75 kg')).toBe('Bodyweight 75 kg');
    expect(tBodyweightWithUnit('kg')).toBe('Bodyweight (kg)');
  });

  test('tPrDeltaLine / tAssistedEffective / tHistoryWithCount', () => {
    expect(tPrDeltaLine('100 kg', '120 kg')).toBe('· 從 100 kg → 120 kg');
    expect(tAssistedEffective('60 kg', '20 kg')).toBe('60 kg（助力 20 kg）');
    expect(tHistoryWithCount(5)).toBe('歷史 (5)');
    setLocale('en');
    expect(tPrDeltaLine('100 kg', '120 kg')).toBe('· From 100 kg → 120 kg');
    expect(tAssistedEffective('60 kg', '20 kg')).toBe('60 kg (assisted 20 kg)');
    expect(tHistoryWithCount(5)).toBe('History (5)');
  });

  test('tMuscleGroupOverlapError — joins overlap list', () => {
    expect(tMuscleGroupOverlapError(['胸', '背'])).toBe('肌群不可同時為主要與次要：胸, 背');
    setLocale('en');
    expect(tMuscleGroupOverlapError(['Chest', 'Back'])).toBe(
      'A muscle group cannot be both primary and secondary: Chest, Back',
    );
  });

  test('tSaveOrSaving — both branches', () => {
    expect(tSaveOrSaving(false)).toBe('儲存');
    expect(tSaveOrSaving(true)).toBe('儲存中…');
    setLocale('en');
    expect(tSaveOrSaving(false)).toBe('Save');
    expect(tSaveOrSaving(true)).toBe('Saving…');
  });

  test('tDuplicateRsPairError — includes existing id (dev prefix)', () => {
    expect(tDuplicateRsPairError('rs-abc-123')).toContain('rs-abc-123');
    expect(tDuplicateRsPairError('rs-abc-123')).toContain('duplicate RS pair');
    setLocale('en');
    expect(tDuplicateRsPairError('rs-abc-123')).toContain('a superset with this exercise pair');
  });

  test('tMainTagLine — legacy program detail row', () => {
    expect(tMainTagLine('Hypertrophy-Q1')).toBe('主標籤：Hypertrophy-Q1');
    setLocale('en');
    expect(tMainTagLine('Hypertrophy-Q1')).toBe('Main tag: Hypertrophy-Q1');
  });
});

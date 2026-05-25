/**
 * Tests for `src/i18n/strings.ts`.
 *
 * Coverage:
 *   - Shape invariant: every zh key has an en counterpart (and vice versa).
 *   - `t()` lookup: at least one case per namespace.
 *   - Locale switching: `setLocale` flips return values.
 *   - Defensive fallback (locale set but key looked up via `t`).
 *   - DB mapping helpers: `tEquipment` / `tMuscleGroup` / `tLoadType`.
 */

import {
  setLocale,
  getLocale,
  t,
  tEquipment,
  tMuscleGroup,
  tExercise,
  tLoadType,
  strings,
  type Locale,
  type Namespace,
} from '../../src/i18n/strings';

// Always reset locale so test ordering doesn't matter.
afterEach(() => {
  setLocale('zh');
});

describe('shape invariant: zh and en have the same keys', () => {
  const namespaces = Object.keys(strings.zh) as Namespace[];

  for (const ns of namespaces) {
    test(`namespace '${ns}' has identical key sets in zh and en`, () => {
      const zhKeys = Object.keys(strings.zh[ns]).sort();
      const enKeys = Object.keys(strings.en[ns] as Record<string, string>).sort();
      expect(enKeys).toEqual(zhKeys);
    });
  }

  test('namespace tree itself is identical between locales', () => {
    expect(Object.keys(strings.zh).sort()).toEqual(Object.keys(strings.en).sort());
  });
});

describe('t() lookup', () => {
  test('common.cancel — zh', () => {
    expect(t('common', 'cancel')).toBe('取消');
  });

  test('common.cancel — en', () => {
    setLocale('en');
    expect(t('common', 'cancel')).toBe('Cancel');
  });

  test('domain.intensity — locked user-decision Intensity (en)', () => {
    setLocale('en');
    expect(t('domain', 'intensity')).toBe('Intensity');
  });

  test('domain.warmupChip / supersetChip — chip-shortform W / SS (en)', () => {
    setLocale('en');
    expect(t('domain', 'warmupChip')).toBe('W');
    expect(t('domain', 'supersetChip')).toBe('SS');
  });

  test('button.cues — locked user-decision Cues (en)', () => {
    setLocale('en');
    expect(t('button', 'cues')).toBe('Cues');
  });

  test('button.replay — locked user-decision Replay (en)', () => {
    setLocale('en');
    expect(t('button', 'replay')).toBe('↻ Replay');
  });

  test('page.wizardStep1 — Program Name + Intensity (en)', () => {
    setLocale('en');
    expect(t('page', 'wizardStep1')).toBe('Program Name + Intensity');
  });

  test('alert.programNameExists — both locales', () => {
    expect(t('alert', 'programNameExists')).toBe('計畫名稱已存在');
    setLocale('en');
    expect(t('alert', 'programNameExists')).toBe('Program name already exists');
  });

  test('status.noTrainingRecords — both locales', () => {
    expect(t('status', 'noTrainingRecords')).toBe('還沒有訓練紀錄');
    setLocale('en');
    expect(t('status', 'noTrainingRecords')).toBe('No training records yet');
  });

  test('common.default — locked user-decision Default (en)', () => {
    setLocale('en');
    expect(t('common', 'default')).toBe('Default');
  });
});

describe('locale switching', () => {
  test('default locale is zh', () => {
    expect(getLocale()).toBe('zh');
  });

  test('setLocale flips return value', () => {
    expect(t('common', 'save')).toBe('儲存');
    setLocale('en');
    expect(t('common', 'save')).toBe('Save');
    setLocale('zh');
    expect(t('common', 'save')).toBe('儲存');
  });

  test('setLocale persists across multiple lookups', () => {
    setLocale('en');
    expect(t('common', 'cancel')).toBe('Cancel');
    expect(t('button', 'cues')).toBe('Cues');
    expect(t('alert', 'deleteFailed')).toBe('Delete failed');
  });

  test('getLocale reflects current state', () => {
    expect(getLocale()).toBe('zh');
    setLocale('en');
    expect(getLocale()).toBe('en');
  });
});

describe('defensive fallback', () => {
  // Shape invariant covers the case in practice, but if a future commit drops
  // an en key by accident, t() should still return zh — not undefined.
  test('t() returns a string for every locale+ns+key combination', () => {
    const namespaces = Object.keys(strings.zh) as Namespace[];
    for (const ns of namespaces) {
      const keys = Object.keys(strings.zh[ns]);
      for (const locale of ['zh', 'en'] as Locale[]) {
        setLocale(locale);
        for (const key of keys) {
          // @ts-expect-error — runtime key sweep, intentional dynamic key
          const result = t(ns, key);
          expect(typeof result).toBe('string');
          expect(result.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('tEquipment', () => {
  test('known zh DB value passes through in zh locale', () => {
    expect(tEquipment('槓鈴')).toBe('槓鈴');
  });

  test('known zh DB value maps to en label in en locale', () => {
    setLocale('en');
    expect(tEquipment('槓鈴')).toBe('Barbell');
    expect(tEquipment('啞鈴')).toBe('Dumbbell');
    expect(tEquipment('史密斯機')).toBe('Smith Machine');
    expect(tEquipment('滑輪')).toBe('Cable');
    expect(tEquipment('固定機械')).toBe('Machine');
    expect(tEquipment('自重')).toBe('Bodyweight');
    expect(tEquipment('壺鈴')).toBe('Kettlebell');
    expect(tEquipment('其他')).toBe('Other');
  });

  test('unknown DB value returns input as-is (no crash)', () => {
    setLocale('en');
    expect(tEquipment('彈力帶')).toBe('彈力帶');
    expect(tEquipment('')).toBe('');
  });
});

describe('tMuscleGroup', () => {
  test('primary muscle group maps in en', () => {
    setLocale('en');
    expect(tMuscleGroup('胸')).toBe('Chest');
    expect(tMuscleGroup('背')).toBe('Back');
    expect(tMuscleGroup('腿')).toBe('Legs');
  });

  test('legacy zh names (前臂 / 二頭長頭 / 二頭短頭) map to post-v010 en labels', () => {
    setLocale('en');
    expect(tMuscleGroup('前臂')).toBe('Forearms'); // legacy → same as 小臂
    expect(tMuscleGroup('小臂')).toBe('Forearms');
    expect(tMuscleGroup('二頭長頭')).toBe('Outer Biceps'); // legacy → same as 外側二頭
    expect(tMuscleGroup('二頭短頭')).toBe('Inner Biceps');
    expect(tMuscleGroup('外側二頭')).toBe('Outer Biceps');
    expect(tMuscleGroup('內側二頭')).toBe('Inner Biceps');
  });

  test('unknown muscle name returns input as-is', () => {
    setLocale('en');
    expect(tMuscleGroup('心肌')).toBe('心肌');
  });

  test('zh locale passes through unchanged', () => {
    expect(tMuscleGroup('胸')).toBe('胸');
    expect(tMuscleGroup('外側二頭')).toBe('外側二頭');
  });
});

describe('tExercise', () => {
  // The 66-entry seed map lives in strings.{zh,en}.exercise; we sample-test
  // a handful per muscle group rather than enumerating every key (the
  // shape-invariant + defensive-fallback sweeps above already iterate the
  // full set automatically).

  test('zh locale: built-in compound names map to zh display labels', () => {
    expect(tExercise('Bench Press')).toBe('槓鈴臥推');
    expect(tExercise('Deadlift')).toBe('硬舉');
    expect(tExercise('Pull-up')).toBe('引體向上');
    expect(tExercise('Back Squat')).toBe('槓鈴深蹲');
    expect(tExercise('Overhead Press')).toBe('肩推');
  });

  test('zh locale: equipment-prefixed variants are distinct', () => {
    expect(tExercise('Bench Press')).toBe('槓鈴臥推');
    expect(tExercise('Dumbbell Bench Press')).toBe('啞鈴臥推');
    expect(tExercise('Incline Bench Press')).toBe('上斜槓鈴臥推');
    expect(tExercise('Decline Bench Press')).toBe('下斜槓鈴臥推');
    // Each must be unique — no accidental dup mapping.
    const set = new Set([
      tExercise('Bench Press'),
      tExercise('Dumbbell Bench Press'),
      tExercise('Incline Bench Press'),
      tExercise('Decline Bench Press'),
    ]);
    expect(set.size).toBe(4);
  });

  test('zh locale: dip-family names use 雙槓臂屈伸 (user-locked)', () => {
    expect(tExercise('Chest Dip')).toBe('雙槓臂屈伸');
    expect(tExercise('Assisted Dip')).toBe('輔助雙槓臂屈伸');
  });

  test('zh locale: simplified-char names round-trip exactly', () => {
    // User locked '仰卧臂屈伸' (simplified 卧, not traditional 臥) — preserve.
    expect(tExercise('Skull Crusher')).toBe('仰卧臂屈伸');
  });

  test('zh locale: lunge variant is 弓箭步 (user-locked, not 弓步蹲)', () => {
    expect(tExercise('Lunge')).toBe('弓箭步');
  });

  test('en locale: built-in names pass through as identity', () => {
    setLocale('en');
    expect(tExercise('Bench Press')).toBe('Bench Press');
    expect(tExercise('Pull-up')).toBe('Pull-up');
    expect(tExercise('Skull Crusher')).toBe('Skull Crusher');
  });

  test('fallback: unknown user-created exercise name passes through in both locales', () => {
    // 用戶自建的動作 — name 不在 v006 seed mapping，應該 verbatim 顯示。
    expect(tExercise('Pec Deck')).toBe('Pec Deck');
    expect(tExercise('我的自訂動作')).toBe('我的自訂動作');
    setLocale('en');
    expect(tExercise('Pec Deck')).toBe('Pec Deck');
    expect(tExercise('我的自訂動作')).toBe('我的自訂動作');
  });

  test('fallback: empty string returns empty (no crash)', () => {
    expect(tExercise('')).toBe('');
    setLocale('en');
    expect(tExercise('')).toBe('');
  });
});

describe('tLoadType', () => {
  test('zh locale renders the original labels', () => {
    expect(tLoadType('bodyweight')).toBe('徒手');
    expect(tLoadType('weighted')).toBe('加重');
    expect(tLoadType('assisted')).toBe('助力');
  });

  test('en locale maps bodyweight to Unloaded (NOT Bodyweight)', () => {
    setLocale('en');
    expect(tLoadType('bodyweight')).toBe('Unloaded');
    expect(tLoadType('weighted')).toBe('Weighted');
    expect(tLoadType('assisted')).toBe('Assisted');
  });

  test('load_type Unloaded does NOT collide with equipment Bodyweight in en', () => {
    setLocale('en');
    // equipment 自重 → Bodyweight (machine class)
    expect(tEquipment('自重')).toBe('Bodyweight');
    // load_type bodyweight → Unloaded (PR weight modifier)
    expect(tLoadType('bodyweight')).toBe('Unloaded');
    expect(tEquipment('自重')).not.toBe(tLoadType('bodyweight'));
  });
});

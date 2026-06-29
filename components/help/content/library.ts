/**
 * Help content — 動作庫 (`app/(tabs)/library.tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩 for the three things a new user
 * won't discover on their own (sidebar tree + equipment dropdown + card meta).
 *
 * EVERY control verified against source on 2026-06-29 (not inferred):
 *   - Sidebar `<Sidebar>` (rendered :378-387; component :463): left column is a
 *     list of muscle groups; tapping one expands its sub-muscles
 *     (`subMuscles` / `onSelectMuscle`, sub-rows :505-516); the bottom「超級組」
 *     row (`onSelectSuperset`, :520-530) switches to the reusable-superset tab
 *     (`isSupersetTab`).
 *   - Equipment filter `<EquipmentFilterDropdown>` (:406-409; component :553):
 *     a button that opens the shared `MgEquipmentPicker` bottom sheet
 *     (:605) to filter the grid by equipment.
 *   - Exercise card `ExerciseCard` (:768): circle thumbnail, a「N 次」session
 *     count badge (`sessionCount`), and a blue「講解」cues pill when the move
 *     has form cues; tap opens the detail page.
 *
 * Only browse-mode anchors are spotlighted (the tab's normal state). Picker
 * mode (isPickerMode) adds dim/✕/done chrome but the same three anchors exist.
 *
 * Spotlight targets (useCoachMarkTarget, in LibraryScreen):
 *   library.sidebar / library.equipment / library.grid.
 */
import type { LocalizedPageHelp } from '../types';

export const libraryHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'library.sidebar',
        title: '左側分類',
        body: '左欄依肌群分類；點一個肌群可展開它的細分肌肉。最下面的「超級組」分頁切到你建立的超級組。',
      },
      {
        targetId: 'library.equipment',
        title: '器材篩選',
        body: '點這裡用器材（槓鈴／啞鈴／機械…）再篩一次動作。',
      },
      {
        targetId: 'library.grid',
        title: '動作卡',
        body: '每張卡右上角的「N 次」= 你練過幾次；藍色「講解」標籤 = 有動作要點。點卡片進詳情頁看示範與肌群。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'library.sidebar',
        title: 'Categories',
        body: 'The left column groups moves by muscle; tap a group to expand its sub-muscles. The「超級組」tab at the bottom switches to your supersets.',
      },
      {
        targetId: 'library.equipment',
        title: 'Equipment filter',
        body: 'Tap here to filter the moves by equipment (barbell / dumbbell / machine…).',
      },
      {
        targetId: 'library.grid',
        title: 'Exercise card',
        body: 'On each card, “N times” (top-right) = how often you’ve trained it; a blue “cues” pill = it has form notes. Tap a card for its detail page.',
      },
    ],
  },
};

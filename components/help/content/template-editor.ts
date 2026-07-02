/**
 * Help content — 模板編輯器 (`components/template-editor/template-editor-view.tsx`).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour. Steps that point at a real
 * on-screen element use a spotlight; steps a ring can't frame (the ⚙️ pop-up
 * menu, the per-set gestures) use a screenshot card interleaved in the same
 * sequence (CoachStep.image).
 *
 * 2026-07-01 — per-gesture split (user request「set 編輯的 i 補一頁，左滑/右滑/
 * 長按各一張小截圖」): the single combined sets card became a tap-only card +
 * three real-capture gesture cards. swipe-left / long-press shots are SHARED with
 * session-detail + today-session; the RIGHT-swipe uses a template-specific shot
 * because the editor's green button reads「加」(add a set) not「＋1」— ⚠ the old
 * docstring claimed「複製」, which the live UI DISPROVED on 2026-07-01 (sim-verified:
 * the green reveal is「加」). All gesture assets live in `assets/help/gestures/`.
 *
 * Verified against source + live sim on 2026-07-01:
 *   - ⚙️ menu = 備註 · 休息時間 · 移動動作 · 設為常設/一般 · 刪除 (NO「改器材」)
 *   - 點標籤 = 3-way cycle 正式→熱身→遞減組; 點數字格 = inline 直接輸入
 *   - 左滑=刪除 (red) / 右滑=加一組·備註 (green「加」+ blue「備註」) / 長按=拖曳排序
 *
 * 2026-07-01 (b) — 動作卡 step 2 spotlight → screenshot card (user request「建立模板，
 * 2 動作卡，用截圖」). The card lives in the ScrollView body, so a spotlight ring
 * measured the below-fold section and「沒切到」(missed the card). A real-capture card
 * (`template-editor/card.png`) dodges it — same rule as session-detail/today-session.
 * The now-dead `template.card` useCoachMarkTarget + its firstCardRef wiring in
 * `template-editor-view.tsx` were removed.
 *
 * Spotlight targets (useCoachMarkTarget, FIXED chrome only):
 *   template.addExercise / template.start
 */
import type { LocalizedPageHelp } from '../types';

const CARD_AR = 1140 / 168; // template-editor/card.png (collapsed 動作卡 row — tap / long-press / ⚙️)
const GEAR_AR = 720 / 1057; // gear-menu.png
const SETS_AR = 1000 / 673; // sets.png (tap ops)
const SWIPE_LEFT_AR = 1030 / 190;
const SWIPE_RIGHT_AR = 1030 / 175; // template「加」variant
const DRAG_AR = 1030 / 350;

export const templateEditorHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'template.addExercise',
        title: '加入動作',
        body: '點這裡，從動作庫挑動作加進模板。',
      },
      {
        image: require('@/assets/help/template-editor/card.png'),
        aspectRatio: CARD_AR,
        title: '動作卡',
        body: '點卡片展開看組；長按換順序；點右側 ⚙️ 開更多。',
      },
      {
        image: require('@/assets/help/template-editor/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ 選單',
        body: '備註、休息時間、移動動作、設為常設、刪除。',
      },
      {
        image: require('@/assets/help/template-editor/sets.png'),
        aspectRatio: SETS_AR,
        title: '點一下改',
        body: '點數字格改重量·次數。',
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle-template.png'),
        aspectRatio: SETS_AR,
        title: '切換組別',
        body: '點紅框內的編號標籤，可循環切換 正式組 / 熱身組 / 遞減組。',
      },
      {
        image: require("@/assets/help/gestures/swipe-left.png"),
        aspectRatio: SWIPE_LEFT_AR,
        title: '左滑刪除',
        body: '在一組上向左滑，出現紅色「刪除」，放開即刪掉這組。',
      },
      {
        image: require("@/assets/help/gestures/swipe-right-template.png"),
        aspectRatio: SWIPE_RIGHT_AR,
        title: '右滑加組・備註',
        body: '向右滑，綠色「加」加一組、藍色「備註」寫這組的筆記。',
      },
      {
        image: require("@/assets/help/gestures/long-press.png"),
        aspectRatio: DRAG_AR,
        title: '長按排序',
        body: '長按一組拖曳，可調整這個動作內各組的順序。',
      },
      {
        targetId: 'template.start',
        title: '儲存或開始',
        body: '編好按左上「儲存」，或按「開始訓練」直接開練。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'template.addExercise',
        title: 'Add exercises',
        body: 'Tap here to pick moves from the library.',
      },
      {
        image: require('@/assets/help/template-editor/card.png'),
        aspectRatio: CARD_AR,
        title: 'Exercise card',
        body: 'Tap to expand; long-press to reorder; tap ⚙️ for more.',
      },
      {
        image: require('@/assets/help/template-editor/gear-menu.png'),
        aspectRatio: GEAR_AR,
        title: '⚙️ menu',
        body: 'Note, rest time, move, make evergreen, delete.',
      },
      {
        image: require('@/assets/help/template-editor/sets.png'),
        aspectRatio: SETS_AR,
        title: 'Tap to edit',
        body: 'Tap a number cell to edit weight / reps.',
      },
      {
        image: require('@/assets/help/gestures/set-label-cycle-template.png'),
        aspectRatio: SETS_AR,
        title: 'Switch set type',
        body: 'Tap the boxed set-number label to cycle working / warm-up / drop set.',
      },
      {
        image: require("@/assets/help/gestures/swipe-left.png"),
        aspectRatio: SWIPE_LEFT_AR,
        title: 'Swipe left to delete',
        body: 'Swipe a set left to reveal the red “Delete”, then release to remove it.',
      },
      {
        image: require("@/assets/help/gestures/swipe-right-template.png"),
        aspectRatio: SWIPE_RIGHT_AR,
        title: 'Swipe right to add / note',
        body: 'Swipe right: green “Add” adds a set, blue “Note” jots a note for it.',
      },
      {
        image: require("@/assets/help/gestures/long-press.png"),
        aspectRatio: DRAG_AR,
        title: 'Long-press to reorder',
        body: 'Long-press a set and drag to reorder the sets within this move.',
      },
      {
        targetId: 'template.start',
        title: 'Save or start',
        body: 'Tap Save (top-left), or Start workout to begin.',
      },
    ],
  },
};

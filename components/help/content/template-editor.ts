/**
 * Help content — 模板編輯器 (`components/template-editor/template-editor-view.tsx`).
 *
 * style: 'coach' — a 3-step orientation over the build flow (add → arrange
 * → save/start). Numbered: it's a procedure. The editor's flow is freer
 * than a wizard, so passive coach (not interactive) is the right fit.
 * Targets tagged in the page via useCoachMarkTarget:
 *   template.addExercise / template.list / template.start
 */
import type { LocalizedPageHelp } from '../types';

export const templateEditorHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'template.addExercise',
        title: '加入動作',
        body: '從這裡把動作加進模板。',
      },
      {
        targetId: 'template.list',
        title: '排列動作',
        body: '動作列在這裡，長按可拖曳排序、左滑刪除。',
      },
      {
        targetId: 'template.start',
        title: '存或開始',
        body: '編好按左上「儲存」，或直接「開始訓練」。',
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
        body: 'Add moves to this template from here.',
      },
      {
        targetId: 'template.list',
        title: 'Arrange them',
        body: 'Moves list here; long-press to reorder, swipe to delete.',
      },
      {
        targetId: 'template.start',
        title: 'Save or start',
        body: 'Tap Save (top-left), or Start workout to begin.',
      },
    ],
  },
};

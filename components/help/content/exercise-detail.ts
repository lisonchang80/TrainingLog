/**
 * Help content — 動作詳情頁 (`app/exercise/[id].tsx`).
 *
 * style: 'coach' but NOT numbered — 功能說明遮罩.
 *
 * Verified against source on 2026-06-29:
 *   - The media card `<ExerciseMediaFrames>` (:154) AUTO-crossfades between a
 *     start + end frame on a setInterval (component :31) — it is NOT a
 *     swipeable carousel, so there's nothing to teach; deliberately not a step.
 *   - Muscle diagram `<MuscleBodyTagger mode="readonly">` (:161-165, only when
 *     `highlight.size > 0`): per its header (:21-22) the colours are
 *     primary → #F26B3A (orange), secondary → #7CB6E0 (blue). NOT a
 *     depth/shade scale — copy must say orange=primary / blue=secondary.
 *   - Footer buttons `styles.footer` (:175-232): 歷史 → exercise-history,
 *     圖表 → exercise-chart, 備註 → SetNoteSheet, 編輯/刪除 disabled unless
 *     `is_custom === 1` (built-ins alert instead).
 *
 * Spotlight targets (useCoachMarkTarget, in ExerciseDetailScreen):
 *   exercise.diagram / exercise.footer.
 */
import type { LocalizedPageHelp } from '../types';

export const exerciseDetailHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'exercise.diagram',
        title: '練到哪些肌肉',
        body: '人體圖標出這個動作會練到的肌群：橘色是主要、藍色是次要。',
      },
      {
        targetId: 'exercise.footer',
        title: '下方按鈕',
        body: '看這個動作的 歷史、圖表，或編輯它的全域「備註」；「編輯／刪除」只有自訂動作才能用。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: false,
    coach: [
      {
        targetId: 'exercise.diagram',
        title: 'Muscles worked',
        body: 'The figure highlights the muscles this move trains: orange = primary, blue = secondary.',
      },
      {
        targetId: 'exercise.footer',
        title: 'Bottom buttons',
        body: 'Open this move’s History or Chart, or edit its global Note; Edit / Delete only work for custom moves.',
      },
    ],
  },
};

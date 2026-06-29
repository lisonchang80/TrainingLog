/**
 * Help content — 建立超級組頁 (`app/superset/new.tsx`).
 *
 * style: 'coach' — a 2-step orientation over the create flow. The exercise
 * grid is self-evident (a big visible grid), so we spotlight only the two
 * non-obvious bits: where picks appear (numbered) and the Combine button.
 * Numbered: it's a 1→2 procedure. Targets tagged via useCoachMarkTarget:
 *   superset.selected / superset.combine  (superset.grid left tagged, unused)
 */
import type { LocalizedPageHelp } from '../types';

export const supersetNewHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'superset.selected',
        title: '挑兩個動作',
        body: '點下方卡片選 2 個，會標 1、2 顯示在這。',
      },
      {
        targetId: 'superset.combine',
        title: '建立',
        body: '兩個都選好，按「組合」就完成。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'superset.selected',
        title: 'Pick two moves',
        body: 'Tap two cards below; they show up here tagged 1 and 2.',
      },
      {
        targetId: 'superset.combine',
        title: 'Create it',
        body: 'With both chosen, tap Combine to finish.',
      },
    ],
  },
};

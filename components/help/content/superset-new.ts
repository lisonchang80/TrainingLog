/**
 * Help content — 建立超級組頁 (`app/superset/new.tsx`).
 *
 * style: 'coach' — ONE numbered 引導遮罩 tour over the whole create flow.
 * Every step is a spotlight — the happy path has NO pop-up sheets and NO hidden
 * gestures, so no screenshot card is warranted (constraint #6: cards only when a
 * ring genuinely can't frame the thing).
 *
 * EVERY operation verified against source on 2026-06-29 (not inferred from
 * handler names):
 *   - The page IS the picker: an inline 2-col exercise grid, filtered by muscle
 *     sidebar / equipment chips / search (`app/superset/new.tsx:254-263`, search
 *     placeholder 「輸入動作名字搜索」 strings.ts:346).
 *   - Selection is capped at 2 with FIFO replacement: a 3rd distinct tap drops
 *     the oldest (`toggleSelect` :144-155); picks show numbered badges 1/2
 *     (:527-531) and removable ✕ chips (`removeFromSelection` :157-159).
 *   - Commit = the「組合」footer button, enabled only at exactly 2
 *     (`onCombine` :161-215, disabled :279). There is NO name field — the name
 *     is auto-generated 「A + B」 (`defaultSupersetName` supersetManager.ts:38-40).
 *   - There is NO reorder / combine-config / rest-between control on this page.
 *
 * Spotlight targets (already registered in the page via useCoachMarkTarget):
 *   superset.grid (:259) / superset.selected (:246) / superset.combine (:274).
 */
import type { LocalizedPageHelp } from '../types';

export const supersetNewHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'superset.grid',
        title: '挑動作',
        body: '用左側肌群、上方器材或搜尋過濾，點卡片選取。',
      },
      {
        targetId: 'superset.selected',
        title: '選 2 個',
        body: '點 2 張卡會標 1、2；點 ✕ 移除，已滿再點會換掉最舊的。',
      },
      {
        targetId: 'superset.combine',
        title: '組合',
        body: '兩個都選好按「組合」，名稱自動用「A＋B」。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'superset.grid',
        title: 'Pick moves',
        body: 'Filter by muscle, equipment or search, then tap cards.',
      },
      {
        targetId: 'superset.selected',
        title: 'Choose two',
        body: 'Two taps tag them 1 and 2; ✕ removes; a 3rd swaps the oldest.',
      },
      {
        targetId: 'superset.combine',
        title: 'Combine',
        body: 'With both chosen, tap Combine — auto-named “A + B”.',
      },
    ],
  },
};

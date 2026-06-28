/**
 * Page help — 訓練/今日 tab, 計劃模式 (pageId `today-plan`).
 *
 * Coach-only (引導遮罩, per 2026-06-29 feedback — no text-only InfoModal). Each
 * caption is ≤ 2 lines and explains ONLY the current (計劃) mode. The 極簡 split
 * lives in `today-minimal.ts`. The three start methods are parallel choices
 * (not an ordered procedure) so the tour is NOT numbered.
 *
 * Coach targetIds (the page tags these via useCoachMarkTarget):
 *   - today.planPanel    — 計劃訓練 區（only mounts when !isMinimal）
 *   - today.templateList — 模板訓練 (TemplateListSection)
 *   - today.blankStart   — 空白訓練
 */

import type { LocalizedPageHelp } from '../types';

export const todayPlanHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coach: [
      {
        targetId: 'today.planPanel',
        title: '計劃訓練',
        body: '今天計劃排定的內容，點一下直接開始。',
      },
      {
        targetId: 'today.templateList',
        title: '模板訓練',
        body: '挑一個存好的模板，先選計劃與強度再開始。',
      },
      {
        targetId: 'today.blankStart',
        title: '空白訓練',
        body: '不用模板，從零開始記錄。',
      },
    ],
  },
  en: {
    style: 'coach',
    coach: [
      {
        targetId: 'today.planPanel',
        title: 'Planned',
        body: 'What today’s program scheduled — tap to start.',
      },
      {
        targetId: 'today.templateList',
        title: 'Templates',
        body: 'Pick a saved template; choose program + intensity first.',
      },
      {
        targetId: 'today.blankStart',
        title: 'Freestyle',
        body: 'Log from scratch with no template.',
      },
    ],
  },
};

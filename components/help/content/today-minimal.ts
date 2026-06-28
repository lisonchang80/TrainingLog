/**
 * Page help — 訓練/今日 tab, 極簡模式 (pageId `today-minimal`, ADR-0026).
 *
 * Coach-only. 極簡模式 has no 計劃 concept (the 計劃訓練 區 is hidden and templates
 * always start as 通用), so the tour covers ONLY 模板/空白 and never mentions
 * programs or intensity — explaining the current mode and nothing else
 * (2026-06-29 feedback). Captions ≤ 2 lines; parallel choices, not numbered.
 *
 * Coach targetIds:
 *   - today.templateList — 模板訓練 (TemplateListSection)
 *   - today.blankStart   — 空白訓練
 */

import type { LocalizedPageHelp } from '../types';

export const todayMinimalHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coach: [
      {
        targetId: 'today.templateList',
        title: '模板訓練',
        body: '挑一個存好的模板，直接開始訓練。',
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
        targetId: 'today.templateList',
        title: 'Templates',
        body: 'Pick a saved template and start training.',
      },
      {
        targetId: 'today.blankStart',
        title: 'Freestyle',
        body: 'Log from scratch with no template.',
      },
    ],
  },
};

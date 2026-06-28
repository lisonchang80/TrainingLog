/**
 * AUTHORED-CONTENT TEMPLATE — copy this to `components/help/content/<pageId>.ts`
 * when adding help to a page. NOT imported anywhere; it only documents the shape.
 *
 * Rules:
 *   - Both `zh` and `en` are required and must have the SAME `style`.
 *   - 'info'  → fill `info` (sections, optional images). For 「解讀畫面」型難頁.
 *   - 'coach' → fill `coach` (steps). For 「教操作」型難頁. The page must host a
 *               <CoachMarkProvider> and tag each highlighted element with
 *               useCoachMarkTarget('<targetId>') matching `step.targetId`.
 *   - 'mixed' → fill both; the InfoModal opens first with a「操作教學」button.
 *
 * Screenshots (chosen project default): put PNGs under
 * `assets/help/<pageId>/<name>.png` and reference them with
 *   images: [{ source: require('@/assets/help/today/idle.png'), caption: '…' }]
 * NEVER `require()` a file that doesn't exist yet — it breaks the Metro bundler.
 * See `assets/help/README.md` for the capture/refresh pipeline.
 */

import type { LocalizedPageHelp } from '../types';

export const exampleHelp: LocalizedPageHelp = {
  zh: {
    style: 'mixed',
    info: {
      title: '這一頁在做什麼',
      sections: [
        {
          heading: '概念',
          body: '用一兩句說明這頁的用途、以及最容易被誤解的地方（例如某個數字怎麼算、某個顏色代表什麼）。',
        },
        {
          heading: '怎麼看',
          body: '列出 1–3 個解讀重點。保持精簡，細節留給「操作教學」一步步帶。',
        },
      ],
      // images: [{ source: require('@/assets/help/<pageId>/overview.png'),
      //            caption: '範例：標出關鍵區塊', aspectRatio: 16 / 9 }],
    },
    coach: [
      {
        targetId: 'example.primaryAction',
        title: '主要操作',
        body: '指向這頁最重要、但不一定看得出來的按鈕或手勢，說明點下去會發生什麼。',
      },
      {
        targetId: 'example.hiddenGesture',
        title: '隱藏手勢',
        body: '例如長按、左滑、雙擊等不明顯的互動，這裡逐一示範。',
      },
    ],
  },
  en: {
    style: 'mixed',
    info: {
      title: 'What this page does',
      sections: [
        {
          heading: 'Concept',
          body: 'One or two sentences on what this page is for and the part most people misread (how a number is computed, what a colour means).',
        },
        {
          heading: 'How to read it',
          body: 'List 1–3 reading tips. Keep it short — leave the step-by-step to the tour.',
        },
      ],
    },
    coach: [
      {
        targetId: 'example.primaryAction',
        title: 'Primary action',
        body: 'Point at the most important — but not obvious — button or gesture and say what it does.',
      },
      {
        targetId: 'example.hiddenGesture',
        title: 'Hidden gesture',
        body: 'Long-press, swipe, double-tap and other non-obvious interactions, demonstrated one at a time.',
      },
    ],
  },
};

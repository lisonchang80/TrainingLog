/**
 * Page help content — 訓練 / 今日 tab (`app/(tabs)/index.tsx`, pageId `today`).
 *
 * Pilot scope: the IDLE view only (三區 計劃 / 空白 / 模板, 計劃 vs 通用, 極簡模式).
 * The in-session set-logger gestures (打勾 / 長按遞減 / 左滑投影) live in a
 * memoized child component and are intentionally NOT covered here — see the
 * author's report for the deferred follow-up.
 *
 * Coach targetIds (the wirer must tag these via useCoachMarkTarget):
 *   - today.planPanel    — 計劃訓練 section / today-plan banner area
 *   - today.blankStart   — 空白訓練 button
 *   - today.templateList — 模板訓練 (TemplateListSection)
 *
 * Screenshots: none bundled yet — see the TODO(screenshot) markers below.
 */

import type { LocalizedPageHelp } from '../types';

export const todayHelp: LocalizedPageHelp = {
  zh: {
    style: 'mixed',
    info: {
      title: '今日訓練怎麼開始',
      sections: [
        {
          heading: '三種開始方式',
          // 三區 = app/(tabs)/index.tsx idle branch: 計劃訓練 (2769) /
          // 模板訓練 TemplateListSection (2840) / 空白訓練 (2850).
          body: '這一頁有三個開始訓練的方式：「計劃訓練」帶出今天計劃排定的內容、「模板訓練」讓你挑一個自己存好的模板、「空白訓練」則是不照任何模板從零開始。由上到下亮度遞減，代表建議的優先順序：計劃 > 模板 > 空白。',
        },
        {
          heading: '計劃 vs 通用',
          // 通用 = program=NULL, sub_tag=NULL; minimal start resolves to
          // ensureTemplateVariantReady(name, null, null) at index.tsx:1324.
          body: '同一個模板可以綁在不同「計劃」與「強度」下成為不同變體；沒有綁任何計劃的那一份叫「通用」。從「模板訓練」點一個模板時，會先讓你選計劃與強度（沒選就用通用）。沒有啟用中的計劃時，「計劃訓練」區會顯示提示並引導你去建立或啟用計劃。',
        },
        {
          heading: '極簡模式',
          // ADR-0026: isMinimal hides the entire 計劃 concept; 計劃訓練 section
          // is gated by !isMinimal (index.tsx:2769); template start auto-uses 通用.
          body: '在「設定」把模式切成「極簡模式」後，整個「計劃」概念會從畫面消失：看不到「計劃訓練」區、也不再選計劃與強度，點任何模板一律以「通用」開始。想專心練、不想管週期排程的人適合用它；隨時切回「計劃模式」資料原封不動。',
        },
      ],
      // TODO(screenshot): idle 三區全景 — 標出「計劃訓練 / 模板訓練 / 空白訓練」三個區塊
      // TODO(screenshot): 極簡模式下的同一頁 — 顯示「計劃訓練」區已消失
    },
    coach: [
      {
        targetId: 'today.planPanel',
        title: '計劃訓練',
        body: '今天計劃排定的訓練會出現在這裡，點一下直接開始。今天是休息日或沒啟用計劃時，這裡會顯示對應提示。（極簡模式下整區隱藏。）',
      },
      {
        targetId: 'today.templateList',
        title: '模板訓練',
        body: '點任一個你存好的模板開始訓練。會先讓你挑計劃與強度，沒選就用「通用」那一份。',
      },
      {
        targetId: 'today.blankStart',
        title: '空白訓練',
        body: '不照任何模板、從零開始記錄。適合臨時練或還沒建模板時用。',
      },
    ],
  },
  en: {
    style: 'mixed',
    info: {
      title: 'How to start today',
      sections: [
        {
          heading: 'Three ways to start',
          body: 'This tab gives you three ways to begin: "Planned" pulls up what today’s active program scheduled, "Templates" lets you pick a workout you saved, and "Freestyle" starts from scratch without any template. Brightness fades top-to-bottom, mirroring the suggested order: planned > template > freestyle.',
        },
        {
          heading: 'Plan vs General',
          body: 'A single template can have variants tied to different programs and intensities; the one tied to no program is called "General". Tapping a template under "Templates" first asks which program and intensity to use (skip it to use the General variant). With no active program, the "Planned" section shows a prompt and points you to create or activate one.',
        },
        {
          heading: 'Minimal mode',
          body: 'Switching to "Minimal mode" in Settings removes the whole "program" concept from the UI: the "Planned" section disappears, you never pick a program or intensity, and every template starts as "General". It suits people who just want to train without periodised scheduling. Switch back to "Plan mode" any time — your data is untouched.',
        },
      ],
      // TODO(screenshot): idle three-zone overview — label 計劃/模板/空白
      // TODO(screenshot): same page in Minimal mode — the Planned section gone
    },
    coach: [
      {
        targetId: 'today.planPanel',
        title: 'Planned training',
        body: 'Whatever your active program scheduled for today shows here — tap to start. On a rest day or with no active program, you see the matching prompt instead. (Hidden in Minimal mode.)',
      },
      {
        targetId: 'today.templateList',
        title: 'Templates',
        body: 'Tap any template you saved to start. It asks for a program and intensity first, defaulting to the "General" variant if you skip.',
      },
      {
        targetId: 'today.blankStart',
        title: 'Freestyle',
        body: 'Log from scratch with no template. Handy for one-off sessions or before you build a template.',
      },
    ],
  },
};

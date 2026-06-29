/**
 * Help content — 課表精靈 (`app/program-wizard/new.tsx`).
 *
 * style: 'coach' — a 2-step orientation over the multi-step wizard
 * (where am I → fill + Next). Numbered: it's a procedure. Targets tagged
 * in the page via useCoachMarkTarget: wizard.stepHeader / wizard.panel.
 */
import type { LocalizedPageHelp } from '../types';

export const programWizardHelp: LocalizedPageHelp = {
  zh: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'wizard.stepHeader',
        title: '跟著精靈走',
        body: '這裡顯示目前第幾步與進度，共六步。',
      },
      {
        targetId: 'wizard.panel',
        title: '填好按下一步',
        body: '每步在這格填內容，右上「下一步」前進。',
      },
    ],
  },
  en: {
    style: 'coach',
    coachNumbered: true,
    coach: [
      {
        targetId: 'wizard.stepHeader',
        title: 'Follow the wizard',
        body: 'This shows which step you are on — six in all.',
      },
      {
        targetId: 'wizard.panel',
        title: 'Fill, then Next',
        body: 'Fill each step here; tap Next (top-right) to go on.',
      },
    ],
  },
};

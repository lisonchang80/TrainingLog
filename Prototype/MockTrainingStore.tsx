import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

export const PALETTE: readonly string[] = [
  '#FF3B30',
  '#FF9500',
  '#FFCC00',
  '#34C759',
  '#00C7BE',
  '#30B0C7',
  '#007AFF',
  '#5856D6',
  '#AF52DE',
  '#FF2D55',
  '#A2845E',
  '#8E8E93',
];

export const TODAY = '2026-05-12';

export type Session = {
  id: string;
  date: string;
  title: string;
  template_id: string | null;
  capacity: number;
  program_subtitle: string | null;
  program_main: string | null;
  exercise_count: number;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  watch_tracked: boolean;
  calories_kcal: number | null;
  hr_avg: number | null;
  hr_min: number | null;
  hr_max: number | null;
  hr_samples: number[] | null;
};

export type TemplateSet = {
  id: string;
  position: number;
  kind: 'warmup' | 'working' | 'dropset';
  reps: number;
  weight: number;
  parent_set_id?: string | null;
  notes?: string;
};

export type TemplateExercise = {
  id: string;
  name: string;
  position: number;
  section: '一般' | '常設動作';
  parent_id: string | null;
  sets: TemplateSet[];
  notes?: string;
  rest_seconds?: number;
};

export type Template = {
  id: string;
  name: string;
  color_hex: string;
  exercises: TemplateExercise[];
};

export type MockState = {
  sessions: Session[];
  templates: Template[];
};

type Action =
  | { type: 'RENAME_SESSION_TITLE'; session_id: string; title: string }
  | { type: 'RECOLOR_TEMPLATE'; template_name: string; color_hex: string }
  | { type: 'DELETE_SESSION'; session_id: string }
  | { type: 'SAVE_TEMPLATE_DRAFT'; draft: Template }
  | { type: 'DISCARD_TEMPLATE_DRAFT' }
  | { type: 'RESET' };

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx];
}

const TEMPLATE_PUSH_A_ID = 'tpl-push-a';
const TEMPLATE_PULL_B_ID = 'tpl-pull-b';
const TEMPLATE_LEG_C_ID = 'tpl-leg-c';
const TEMPLATE_UPPER_D_ID = 'tpl-upper-d';

const INITIAL_TEMPLATES: Template[] = [
  {
    id: TEMPLATE_PUSH_A_ID,
    name: '推日 A',
    color_hex: hashColor('推日 A'),
    exercises: [
      {
        id: 'ex-push-a-1',
        name: '槓鈴臥推',
        position: 0,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pa-1-1', position: 0, kind: 'warmup', reps: 10, weight: 40 },
          { id: 'ts-pa-1-2', position: 1, kind: 'working', reps: 8, weight: 60 },
          { id: 'ts-pa-1-3', position: 2, kind: 'working', reps: 6, weight: 70 },
          { id: 'ts-pa-1-4', position: 3, kind: 'working', reps: 4, weight: 80 },
        ],
      },
      {
        id: 'ex-push-a-2',
        name: '上斜啞鈴握推',
        position: 1,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pa-2-1', position: 0, kind: 'working', reps: 10, weight: 22 },
          { id: 'ts-pa-2-2', position: 1, kind: 'working', reps: 10, weight: 24 },
          { id: 'ts-pa-2-3', position: 2, kind: 'working', reps: 8, weight: 26 },
        ],
      },
      {
        id: 'ex-push-a-3',
        name: '雙槓臂屈伸',
        position: 2,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pa-3-1', position: 0, kind: 'working', reps: 10, weight: 0 },
          { id: 'ts-pa-3-2', position: 1, kind: 'working', reps: 10, weight: 0 },
          { id: 'ts-pa-3-3', position: 2, kind: 'working', reps: 8, weight: 0 },
        ],
      },
      {
        id: 'ex-push-a-4',
        name: '繩索下壓',
        position: 3,
        section: '一般',
        parent_id: 'ex-push-a-3',
        sets: [
          { id: 'ts-pa-4-1', position: 0, kind: 'working', reps: 12, weight: 25 },
          { id: 'ts-pa-4-2', position: 1, kind: 'working', reps: 12, weight: 25 },
          { id: 'ts-pa-4-3', position: 2, kind: 'working', reps: 10, weight: 27 },
        ],
      },
      {
        id: 'ex-push-a-5',
        name: '側平舉 (含 dropset)',
        position: 4,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pa-5-1', position: 0, kind: 'working', reps: 12, weight: 10 },
          { id: 'ts-pa-5-2', position: 1, kind: 'working', reps: 12, weight: 10 },
          { id: 'ts-pa-5-3', position: 2, kind: 'working', reps: 10, weight: 12 },
          { id: 'ts-pa-5-4', position: 3, kind: 'dropset', reps: 8, weight: 8 },
          {
            id: 'ts-pa-5-5',
            position: 4,
            kind: 'dropset',
            reps: 6,
            weight: 6,
            parent_set_id: 'ts-pa-5-4',
          },
        ],
      },
      {
        id: 'ex-push-a-6',
        name: '滾輪 (核心)',
        position: 5,
        section: '常設動作',
        parent_id: null,
        sets: [
          { id: 'ts-pa-6-1', position: 0, kind: 'working', reps: 10, weight: 0 },
          { id: 'ts-pa-6-2', position: 1, kind: 'working', reps: 10, weight: 0 },
          { id: 'ts-pa-6-3', position: 2, kind: 'working', reps: 8, weight: 0 },
        ],
      },
    ],
  },
  {
    id: TEMPLATE_PULL_B_ID,
    name: '拉日 B',
    color_hex: hashColor('拉日 B'),
    exercises: [
      {
        id: 'ex-pull-b-1',
        name: '引體向上',
        position: 0,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pb-1-1', position: 0, kind: 'warmup', reps: 5, weight: 0 },
          { id: 'ts-pb-1-2', position: 1, kind: 'working', reps: 8, weight: 0 },
          { id: 'ts-pb-1-3', position: 2, kind: 'working', reps: 6, weight: 5 },
        ],
      },
      {
        id: 'ex-pull-b-2',
        name: '槓鈴划船',
        position: 1,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-pb-2-1', position: 0, kind: 'working', reps: 10, weight: 50 },
          { id: 'ts-pb-2-2', position: 1, kind: 'working', reps: 8, weight: 60 },
          { id: 'ts-pb-2-3', position: 2, kind: 'working', reps: 6, weight: 65 },
        ],
      },
    ],
  },
  {
    id: TEMPLATE_LEG_C_ID,
    name: '腿日 C',
    color_hex: hashColor('腿日 C'),
    exercises: [
      {
        id: 'ex-leg-c-1',
        name: '深蹲',
        position: 0,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-lc-1-1', position: 0, kind: 'warmup', reps: 10, weight: 40 },
          { id: 'ts-lc-1-2', position: 1, kind: 'working', reps: 8, weight: 80 },
          { id: 'ts-lc-1-3', position: 2, kind: 'working', reps: 6, weight: 95 },
          { id: 'ts-lc-1-4', position: 3, kind: 'working', reps: 4, weight: 105 },
        ],
      },
      {
        id: 'ex-leg-c-2',
        name: '羅馬尼亞硬舉',
        position: 1,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-lc-2-1', position: 0, kind: 'working', reps: 10, weight: 70 },
          { id: 'ts-lc-2-2', position: 1, kind: 'working', reps: 8, weight: 80 },
          { id: 'ts-lc-2-3', position: 2, kind: 'working', reps: 6, weight: 90 },
        ],
      },
    ],
  },
  {
    id: TEMPLATE_UPPER_D_ID,
    name: '上肢 D',
    color_hex: hashColor('上肢 D'),
    exercises: [
      {
        id: 'ex-upper-d-1',
        name: '肩推',
        position: 0,
        section: '一般',
        parent_id: null,
        sets: [
          { id: 'ts-ud-1-1', position: 0, kind: 'working', reps: 8, weight: 40 },
          { id: 'ts-ud-1-2', position: 1, kind: 'working', reps: 6, weight: 45 },
        ],
      },
    ],
  },
];

const SESSION_PLAN: ReadonlyArray<{
  date: string;
  template_id: string | null;
  title: string;
  capacity: number;
  program_subtitle: string | null;
}> = [
  { date: '2026-03-13', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 8200, program_subtitle: '10-12RM' },
  { date: '2026-03-15', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 6900, program_subtitle: '8-10RM' },
  { date: '2026-03-16', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 9400, program_subtitle: '6-8RM' },
  { date: '2026-03-18', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 8500, program_subtitle: '10-12RM' },
  { date: '2026-03-20', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7100, program_subtitle: '8-10RM' },
  { date: '2026-03-23', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 9600, program_subtitle: '6-8RM' },
  { date: '2026-03-25', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A (重訓加強)', capacity: 8800, program_subtitle: '10-12RM' },
  { date: '2026-03-27', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7200, program_subtitle: '8-10RM' },
  { date: '2026-03-30', template_id: TEMPLATE_UPPER_D_ID, title: '上肢 D', capacity: 4200, program_subtitle: null },
  { date: '2026-04-01', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 8700, program_subtitle: '10-12RM' },
  { date: '2026-04-03', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 9700, program_subtitle: '6-8RM' },
  { date: '2026-04-05', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7300, program_subtitle: '8-10RM' },

  { date: '2026-04-08', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 8900, program_subtitle: '10-12RM' },
  { date: '2026-04-10', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7400, program_subtitle: '8-10RM' },
  { date: '2026-04-12', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 9900, program_subtitle: '6-8RM' },
  { date: '2026-04-14', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 9000, program_subtitle: '10-12RM' },
  { date: '2026-04-16', template_id: null, title: '', capacity: 3800, program_subtitle: null },
  { date: '2026-04-18', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7600, program_subtitle: '8-10RM' },
  { date: '2026-04-20', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 10100, program_subtitle: '6-8RM' },
  { date: '2026-04-22', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 9100, program_subtitle: '10-12RM' },
  { date: '2026-04-24', template_id: TEMPLATE_UPPER_D_ID, title: '上肢 D', capacity: 4500, program_subtitle: null },
  { date: '2026-04-25', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7700, program_subtitle: '8-10RM' },
  { date: '2026-04-27', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C (加重)', capacity: 10500, program_subtitle: '6-8RM' },
  { date: '2026-04-29', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 9200, program_subtitle: '10-12RM' },

  { date: '2026-05-02', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7800, program_subtitle: '8-10RM' },
  { date: '2026-05-04', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 10300, program_subtitle: '6-8RM' },
  { date: '2026-05-05', template_id: TEMPLATE_UPPER_D_ID, title: '上肢 D 補強', capacity: 4800, program_subtitle: null },
  { date: '2026-05-06', template_id: TEMPLATE_PUSH_A_ID, title: '推日 A', capacity: 9300, program_subtitle: '10-12RM' },
  { date: '2026-05-08', template_id: TEMPLATE_PULL_B_ID, title: '拉日 B', capacity: 7900, program_subtitle: '8-10RM' },
  { date: '2026-05-10', template_id: TEMPLATE_LEG_C_ID, title: '腿日 C', capacity: 10400, program_subtitle: '6-8RM' },
  { date: '2026-05-10', template_id: TEMPLATE_UPPER_D_ID, title: '上肢 D', capacity: 4600, program_subtitle: null },
  { date: '2026-05-12', template_id: TEMPLATE_PUSH_A_ID, title: '', capacity: 9100, program_subtitle: '10-12RM' },
];

const PROGRAM_BY_TEMPLATE: Record<string, string | null> = {
  [TEMPLATE_PUSH_A_ID]: '5x5 強度週',
  [TEMPLATE_PULL_B_ID]: '5x5 強度週',
  [TEMPLATE_LEG_C_ID]: '肌肥大期',
  [TEMPLATE_UPPER_D_ID]: null,
};

const WATCH_TRACKED_DATES = new Set(['2026-05-12', '2026-05-06', '2026-04-22']);

function exerciseCountFor(template_id: string | null): number {
  if (template_id == null) return 5;
  const tpl = INITIAL_TEMPLATES.find((t) => t.id === template_id);
  return tpl?.exercises.length ?? 6;
}

function minutesToHHMM(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = Math.floor(totalMin % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function pseudoRand(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function generateHRSamples(
  seedKey: string,
  durationSec: number,
  hrMin: number,
  hrAvg: number,
  hrMax: number,
): number[] {
  const count = Math.max(30, Math.min(90, Math.floor(durationSec / 60)));
  const seed = hashCode(seedKey);
  const samples: number[] = [];
  let cur = hrMin + 5;
  for (let i = 0; i < count; i++) {
    const phase = (i / count) * Math.PI * 5;
    const target = hrAvg + Math.sin(phase) * (hrMax - hrMin) * 0.3;
    const noise = (pseudoRand(seed + i) - 0.5) * 14;
    cur = cur * 0.55 + target * 0.45 + noise;
    cur = Math.max(hrMin - 5, Math.min(hrMax + 5, cur));
    samples.push(Math.round(cur));
  }
  return samples;
}

function buildInitialSessions(): Session[] {
  return SESSION_PLAN.map((row, idx) => {
    const durationMin = Math.round(row.capacity / 100 + 30);
    const startMin = 14 * 60 + 30 + ((idx * 7) % 90);
    const endMin = startMin + durationMin;
    const watch = WATCH_TRACKED_DATES.has(row.date);
    const id = `sess-${idx.toString().padStart(3, '0')}`;
    const hrAvg = watch ? 150 + (idx % 12) : null;
    const hrMin = watch ? 105 + (idx % 10) : null;
    const hrMax = watch ? 178 + (idx % 8) : null;
    return {
      id,
      date: row.date,
      title: row.title,
      template_id: row.template_id,
      capacity: row.capacity,
      program_subtitle: row.program_subtitle,
      program_main: row.template_id != null ? PROGRAM_BY_TEMPLATE[row.template_id] ?? null : null,
      exercise_count: exerciseCountFor(row.template_id),
      started_at: minutesToHHMM(startMin),
      ended_at: minutesToHHMM(endMin),
      duration_seconds: durationMin * 60,
      watch_tracked: watch,
      calories_kcal: watch ? Math.round(durationMin * 8.5 + row.capacity / 30) : null,
      hr_avg: hrAvg,
      hr_min: hrMin,
      hr_max: hrMax,
      hr_samples:
        watch && hrAvg != null && hrMin != null && hrMax != null
          ? generateHRSamples(id, durationMin * 60, hrMin, hrAvg, hrMax)
          : null,
    };
  });
}

const INITIAL_STATE: MockState = {
  sessions: buildInitialSessions(),
  templates: INITIAL_TEMPLATES,
};

function reducer(state: MockState, action: Action): MockState {
  switch (action.type) {
    case 'RENAME_SESSION_TITLE':
      return {
        ...state,
        sessions: state.sessions.map((s) =>
          s.id === action.session_id ? { ...s, title: action.title } : s,
        ),
      };
    case 'RECOLOR_TEMPLATE':
      return {
        ...state,
        templates: state.templates.map((t) =>
          t.name === action.template_name ? { ...t, color_hex: action.color_hex } : t,
        ),
      };
    case 'DELETE_SESSION':
      return {
        ...state,
        sessions: state.sessions.filter((s) => s.id !== action.session_id),
      };
    case 'SAVE_TEMPLATE_DRAFT': {
      const exists = state.templates.some((t) => t.id === action.draft.id);
      const templates = exists
        ? state.templates.map((t) => (t.id === action.draft.id ? action.draft : t))
        : [...state.templates, action.draft];
      return { ...state, templates };
    }
    case 'DISCARD_TEMPLATE_DRAFT':
      return state;
    case 'RESET':
      return { sessions: buildInitialSessions(), templates: INITIAL_TEMPLATES };
    default:
      return state;
  }
}

type StoreApi = {
  state: MockState;
  renameSessionTitle: (session_id: string, title: string) => void;
  recolorTemplate: (template_name: string, color_hex: string) => void;
  deleteSession: (session_id: string) => void;
  saveTemplateDraft: (draft: Template) => void;
  discardTemplateDraft: () => void;
  reset: () => void;
  templateColorByName: (name: string) => string;
  templateById: (id: string | null) => Template | null;
  sessionsByDate: (date: string) => Session[];
  mainSessionByDate: (date: string) => Session | null;
};

const MockStoreContext = createContext<StoreApi | null>(null);

export function MockTrainingStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const renameSessionTitle = useCallback((session_id: string, title: string) => {
    dispatch({ type: 'RENAME_SESSION_TITLE', session_id, title });
  }, []);

  const recolorTemplate = useCallback((template_name: string, color_hex: string) => {
    dispatch({ type: 'RECOLOR_TEMPLATE', template_name, color_hex });
  }, []);

  const deleteSession = useCallback((session_id: string) => {
    dispatch({ type: 'DELETE_SESSION', session_id });
  }, []);

  const saveTemplateDraft = useCallback((draft: Template) => {
    dispatch({ type: 'SAVE_TEMPLATE_DRAFT', draft });
  }, []);

  const discardTemplateDraft = useCallback(() => {
    dispatch({ type: 'DISCARD_TEMPLATE_DRAFT' });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);

  const api = useMemo<StoreApi>(() => {
    const templateColorByName = (name: string): string => {
      const found = state.templates.find((t) => t.name === name);
      return found ? found.color_hex : hashColor(name);
    };
    const templateById = (id: string | null): Template | null => {
      if (id == null) return null;
      return state.templates.find((t) => t.id === id) ?? null;
    };
    const sessionsByDate = (date: string): Session[] => {
      return state.sessions
        .filter((s) => s.date === date)
        .sort((a, b) => b.capacity - a.capacity);
    };
    const mainSessionByDate = (date: string): Session | null => {
      const list = sessionsByDate(date);
      return list.length === 0 ? null : list[0];
    };
    return {
      state,
      renameSessionTitle,
      recolorTemplate,
      deleteSession,
      saveTemplateDraft,
      discardTemplateDraft,
      reset,
      templateColorByName,
      templateById,
      sessionsByDate,
      mainSessionByDate,
    };
  }, [
    state,
    renameSessionTitle,
    recolorTemplate,
    deleteSession,
    saveTemplateDraft,
    discardTemplateDraft,
    reset,
  ]);

  return <MockStoreContext.Provider value={api}>{children}</MockStoreContext.Provider>;
}

export function useMockStore(): StoreApi {
  const ctx = useContext(MockStoreContext);
  if (ctx == null) {
    throw new Error('useMockStore must be used inside MockTrainingStoreProvider');
  }
  return ctx;
}

export function formatCapacity(kg: number): string {
  return Math.round(kg).toString();
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h === 0) return `${m} 分鐘`;
  return `${h} 小時 ${m} 分鐘`;
}

export function displaySessionTitle(session: Session, templates: Template[]): string {
  if (session.title.length > 0) return session.title;
  if (session.template_id != null) {
    const tpl = templates.find((t) => t.id === session.template_id);
    if (tpl) return tpl.name;
  }
  return '自由訓練';
}

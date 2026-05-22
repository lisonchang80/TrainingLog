/**
 * Slice 9.5 Template editor — production component (ADR-0016).
 *
 * Ported from `Prototype/TemplateEditorView.tsx` with the hook layer
 * rewired to the v2 repository:
 *   - load:    getTemplateFull(db, id)        — committed snapshot
 *   - save:    commitTemplateDraft(db, ...)   — batch UPSERT-DELETE
 *   - rename:  applyRenameSiblings(...)       — same-name templates connect
 *   - recolor: applyRecolorSiblings(...)      — same-name templates re-tint
 *   - start:   commit draft first, then startSessionFromTemplate
 *
 * Domain field name deltas vs prototype:
 *   - TemplateExercise.position  →  ordering
 *   - TemplateExercise.section   →  'general' | 'evergreen' (display
 *                                    strings stay 一般/常設動作)
 *   - notes / rest_seconds       →  nullable (prototype was optional)
 *   - TemplateExercise.name      →  optional (joined from exercise table)
 *
 * "+ 動作" opens a minimal bottom-sheet exercise picker that hydrates a
 * new exercise row from 動作記憶 (queryMemoryCandidates +
 * deriveLatestSetsForExercise); the new row lands in draft only.
 *
 * Gesture wiring (ADR-0016 2026-05-13 amendment): set rows wrap in
 * `SwipeableSetRow`; cluster head + followers share one `SwipeableSetRow`
 * so swipe-left deletes the whole cluster. Cluster followers have
 * `enabled={false}` (no swipe). Superset rows pair parent + child columns
 * per-row-index inside one `SwipeableSetRow`.
 */

import { randomUUID } from 'expo-crypto';
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { TemplateMetaSheet } from '@/components/session/template-meta-sheet';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import { listPrograms, type ProgramSummary } from '@/src/adapters/sqlite/programRepository';
import { startSessionFromTemplate } from '@/src/adapters/sqlite/sessionFromTemplate';
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  applyRecolorSiblings,
  applyRenameSiblings,
  attachTemplateToProgram,
  commitTemplateDraft,
  deleteTemplate,
  findTemplateByTriple,
  getTemplateFull,
  queryMemoryCandidates,
  queryReusableSupersetMemory,
} from '@/src/adapters/sqlite/templateRepository';
import {
  getReusableSupersetWithExercises,
  incrementUseCount,
} from '@/src/adapters/sqlite/supersetRepository';
import { explodeSupersetForTemplate } from '@/src/domain/superset/supersetManager';
import { computeTemplateClusterStat } from '@/src/domain/template/clusterStat';
import { cloneTemplate, templatesEqual } from '@/src/domain/template/templateDraft';
import { formatTemplateTriple } from '@/src/domain/template/templateManager';
import { deriveLatestSetsForExercise } from '@/src/domain/template/templateMemory';
import {
  cycleSetKindAcrossExercises,
  isTemplateDeletable,
  reorderTemplateClusterCycles,
  reorderTemplateExercises,
  reorderTemplateSetsByGroups,
} from '@/src/domain/template/templateOps';
import { consumePick } from '@/src/domain/exercise/pickerBridge';
import type { Exercise } from '@/src/domain/exercise/types';
import type {
  ExerciseSection,
  Template,
  TemplateExercise,
  TemplateSet,
} from '@/src/domain/template/types';

import { PALETTE, hashColor } from './palette';
import { ReorderExercisesSheet } from '../shared/reorder-exercises-sheet';
import { SetRowContent } from '../shared/set-row-content';
import { SwipeableSetRow, type SwipeAction } from '../shared/swipeable-set-row';
import { getLocale, t as tt } from '@/src/i18n';

/**
 * Inline dynamic helpers for template-editor-view. Kept local rather than
 * added to `src/i18n/dynamic.ts` (editor-only usage).
 */
function tEditorDeleteTemplateBody(name: string, triple: string): string {
  return getLocale() === 'en'
    ? `"${name}" (${triple}) will be permanently deleted. This cannot be undone.\n\nOnly this (program · intensity) variant is deleted; other siblings with the same name are preserved.\nHistorical session records are unaffected.`
    : `將永久刪除「${name}」(${triple})。此操作無法復原。\n\n只刪此 (計畫 · 強度) 變體，其他同名 sibling 保留。\n歷史 session 紀錄不受影響。`;
}

function tEditorDeleteClusterBody(name: string): string {
  return getLocale() === 'en'
    ? `Superset "${name}" and all paired sets will be deleted.`
    : `將刪除超級組「${name}」及配對動作的所有 sets。`;
}

function tEditorDeleteSoloBody(name: string): string {
  return getLocale() === 'en'
    ? `"${name}" and all its sets will be deleted.`
    : `將刪除「${name}」及其所有 sets。`;
}

function tEditorRestLabel(seconds: number): string {
  return getLocale() === 'en' ? `Rest Time (${seconds}s)` : `休息時間（${seconds}s）`;
}

// SECTION_LABEL — section header labels (一般動作 / 常設動作). The constant
// stayed zh-only during Phase 4 cleanup; Phase 4.5 batch 2 wraps it as
// a getter so the locale switch propagates without changing render sites.
function getSectionLabel(section: ExerciseSection): string {
  const en = getLocale() === 'en';
  if (section === 'general') return en ? 'General Exercises' : '一般動作';
  return en ? 'Evergreen Exercises' : '常設動作';
}

function newId(prefix: string): string {
  if (typeof randomUUID === 'function') {
    try {
      return `${prefix}-${randomUUID()}`;
    } catch {
      // Fallthrough for tests without expo-crypto
    }
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function colorForTemplate(t: Template): string {
  if (t.color_hex && t.color_hex.length > 0) return t.color_hex;
  return hashColor(t.name || 'unnamed');
}

export default function TemplateEditorView() {
  // `dpid` / `dst` = display program_id / display sub_tag (#50 C1):
  // 用戶當初在 start-template-sheet 選的 (P, S)；fallback 路徑下 editor 載入
  // representative 但 header 仍顯示 user's pick。sentinel `__none__` 表
  // explicitly NULL (通用 program / no intensity)，param 不存在 = no override
  // → fallback to actual draft.program_id / draft.sub_tag。
  const {
    id,
    dpid,
    dst,
    fromProgram,
    fromKind,
    fromCycle,
    fromDay,
    fromSubTag,
  } = useLocalSearchParams<{
    id: string;
    dpid?: string;
    dst?: string;
    // Programs tab "+ 建立新模板" import context (round 15 polish).
    // When present the editor enters "import mode": top-right action becomes
    // 「建立並導入」, draft.program_id pre-fills to fromProgram, and tap-save
    // redirects to /(tabs)/programs with apply params instead of staying.
    fromProgram?: string;
    fromKind?: 'cell' | 'column';
    fromCycle?: string;
    fromDay?: string;
    fromSubTag?: string;
  }>();
  const importMode =
    fromProgram != null && fromKind != null && fromDay != null;
  const importFromProgramId = fromProgram
    ? decodeURIComponent(fromProgram)
    : null;
  const importFromSubTag = fromSubTag
    ? decodeURIComponent(fromSubTag)
    : null;
  const importFromCycle = fromCycle != null ? Number(fromCycle) : null;
  const importFromDay = fromDay != null ? Number(fromDay) : null;
  const db = useDatabase();
  const router = useRouter();

  /** Display override resolver — undefined = no override; null = 通用 / no
   *  intensity; string = explicit value. */
  const displayProgramOverride: string | null | undefined = dpid === undefined
    ? undefined
    : dpid === '__none__'
      ? null
      : decodeURIComponent(dpid);
  const displaySubTagOverride: string | null | undefined = dst === undefined
    ? undefined
    : dst === '__none__'
      ? null
      : decodeURIComponent(dst);

  const [committed, setCommitted] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [expandedExId, setExpandedExId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [noteEditing, setNoteEditing] = useState<
    | {
        target:
          | { kind: 'exercise'; ex_id: string }
          | { kind: 'set'; ex_id: string; set_id: string };
        draft: string;
      }
    | null
  >(null);
  const [restEditing, setRestEditing] = useState<{
    ex_id: string;
    draft: number;
  } | null>(null);
  // overnight #45 第 3 點 — 排序動作 modal 開關（mirror app/(tabs)/index.tsx
  // 的 reorderSheetOpen pattern；長按卡片 header + ⚙️「移動動作」共用入口）。
  const [reorderSheetOpen, setReorderSheetOpen] = useState(false);
  // Round 15 polish — 儲存 / 建立並導入 都先跳 TemplateMetaSheet 讓使用者選
  // (program, sub_tag)。`saveSheetMode` 為 null = 不跳；'save' = 跑完
  // persistDraft + Alert 留在編輯器；'import' = 跑完 persistDraft + router.replace
  // 回 programs tab 帶 apply context。
  const [saveSheetMode, setSaveSheetMode] = useState<'save' | 'import' | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setMissing(true);
        setLoaded(true);
        return;
      }
      try {
        const [tpl, lib, progs] = await Promise.all([
          getTemplateFull(db, id),
          listExercises(db),
          listPrograms(db),
        ]);
        if (cancelled) return;
        if (!tpl) {
          setMissing(true);
          setLoaded(true);
          return;
        }
        setCommitted(tpl);
        // Import mode pre-fill (round 15 polish, programs tab "+ 建立新模板"):
        // a brand-new template loaded here has program_id=null + sub_tag=null
        // from createTemplate. If the user entered via the programs picker,
        // hydrate program_id from the cell's program so the new template
        // auto-attaches to it (Q3a). User can still change it in the editor
        // — final draft.program_id wins at import time.
        const initialDraft = cloneTemplate(tpl);
        if (
          importMode &&
          tpl.program_id == null &&
          importFromProgramId != null
        ) {
          initialDraft.program_id = importFromProgramId;
        }
        setDraft(initialDraft);
        setExerciseLibrary(lib);
        setPrograms(progs);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        Alert.alert('Load failed', e instanceof Error ? e.message : String(e));
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, id]);

  const dirty = useMemo(() => {
    if (!draft || !committed) return false;
    return !templatesEqual(draft, committed);
  }, [draft, committed]);

  const onExit = useCallback(() => router.back(), [router]);

  const onCancel = useCallback(() => {
    if (!dirty) {
      onExit();
      return;
    }
    Alert.alert(tt('alert', 'discardChangesQ'), tt('alert', 'discardChangesLong'), [
      { text: tt('button', 'editKeep'), style: 'cancel' },
      { text: tt('button', 'discardSimple'), style: 'destructive', onPress: onExit },
    ]);
  }, [dirty, onExit]);

  const persistDraft = useCallback(async () => {
    if (!committed || !draft) return false;
    const now = () => Date.now();
    // If color changed, cascade to all same-name siblings (group-wide).
    // commitTemplateDraft also updates this template's color, but
    // applyRecolorSiblings catches sibling templates that share the name.
    if (draft.color_hex !== committed.color_hex) {
      await applyRecolorSiblings(db, {
        name: draft.name,
        color_hex: draft.color_hex,
        now,
      });
    }
    // If name changed, cascade rename to siblings.
    if (draft.name !== committed.name) {
      await applyRenameSiblings(db, {
        oldName: committed.name,
        newName: draft.name,
        now,
      });
    }
    await commitTemplateDraft(db, { committed, draft, now });

    // Commit-time `use_count` bump (slice 9.8b grill Q6): count newly-added
    // parent rows of reusable clusters in the diff. Each cluster contributes
    // exactly +1 bump (counting parents only avoids double-counting since
    // each explode produces one parent + one child both stamped with the
    // same rs_id). Adding-then-removing a cluster within the same editor
    // session is a no-op — the row never lands in the committed diff.
    const committedIds = new Set(committed.exercises.map((e) => e.id));
    const bumps = draft.exercises.filter(
      (e) =>
        !committedIds.has(e.id) &&
        e.parent_id === null &&
        e.reusable_superset_id !== null
    );
    for (const row of bumps) {
      await incrementUseCount(db, row.reusable_superset_id as string, now);
    }
    return true;
  }, [committed, draft, db]);

  // Open TemplateMetaSheet — both 儲存 and 建立並導入 routes go through it
  // so the user can confirm / change (program, sub_tag) before commit.
  // saveSheetMode determines the post-confirm behaviour.
  const onSave = useCallback(() => {
    if (!dirty || !draft || busy) return;
    setSaveSheetMode('save');
  }, [dirty, draft, busy]);

  const onCreateAndImport = useCallback(() => {
    if (!draft || busy || !importMode) return;
    setSaveSheetMode('import');
  }, [draft, busy, importMode]);

  /**
   * TemplateMetaSheet 確認 — 套用 (program_id, sub_tag) 進 draft 後跑 commit。
   * 兩種模式：
   *   - 'save'   → persistDraft + Alert「已儲存」+ 留在編輯器
   *   - 'import' → persistDraft + router.replace 回 programs tab 帶 apply params
   *
   * 「建立並導入」允許 !dirty commit (使用者可能完全沒改、純粹按 import 把
   * 預設 (program, sub_tag) 寫回 cell)。「儲存」沿用 dirty guard。
   */
  const onSaveSheetConfirm = useCallback(
    async (args: {
      name: string;
      program_id: string | null;
      sub_tag: string | null;
    }) => {
      if (!draft || busy) return;
      const mode = saveSheetMode;
      if (!mode) return;
      setBusy(true);
      try {
        // Apply sheet's (name, program_id, sub_tag) to draft. We mutate the
        // working draft directly via setDraft so persistDraft sees the new
        // values; the next render shows them in the header label too.
        const patchedDraft: Template = {
          ...draft,
          name: args.name || draft.name,
          program_id: args.program_id,
          sub_tag: args.sub_tag,
        };
        setDraft(patchedDraft);
        // Dup-triple guard: changing (name, program_id, sub_tag) must not
        // collide with an existing sibling. Mirror convertSessionToTemplate
        // pattern (findTemplateByTriple + throw DUPLICATE_TEMPLATE_TRIPLE).
        const classificationChanging =
          patchedDraft.name !== committed?.name ||
          patchedDraft.program_id !== committed?.program_id ||
          patchedDraft.sub_tag !== committed?.sub_tag;
        if (classificationChanging) {
          const existing = await findTemplateByTriple(db, {
            name: patchedDraft.name,
            program_id: patchedDraft.program_id ?? null,
            sub_tag: patchedDraft.sub_tag ?? null,
          });
          if (existing && existing.id !== patchedDraft.id) {
            throw new Error('DUPLICATE_TEMPLATE_TRIPLE');
          }
        }

        // persistDraft reads `draft` from closure — pass an inline commit
        // using the patched draft directly via commitTemplateDraft to avoid
        // a stale-closure race. We replicate the rename-siblings + commit +
        // use_count bump dance with patchedDraft. `now` is a function thunk
        // per the repo helper signatures (() => Date.now()).
        const now = () => Date.now();
        if (committed && patchedDraft.name !== committed.name) {
          await applyRenameSiblings(db, {
            oldName: committed.name,
            newName: patchedDraft.name,
            now,
          });
        }
        // ★ commitTemplateDraft 只寫 name / color_hex / updated_at + exercises,
        // 不寫 program_id / sub_tag。identity 三元組改動必須走
        // attachTemplateToProgram（同一個 UPDATE template SET program_id=?,
        // sub_tag=?, updated_at=? 的 helper）。在 commit 之前先 attach 確保
        // re-hydrate 的 row 帶到新的 classification。
        if (classificationChanging) {
          await attachTemplateToProgram(db, {
            template_id: patchedDraft.id,
            program_id: patchedDraft.program_id ?? null,
            sub_tag: patchedDraft.sub_tag ?? null,
            now,
          });
        }
        if (committed) {
          await commitTemplateDraft(db, {
            committed,
            draft: patchedDraft,
            now,
          });
          const committedIds = new Set(committed.exercises.map((e) => e.id));
          const bumps = patchedDraft.exercises.filter(
            (e) =>
              !committedIds.has(e.id) &&
              e.parent_id === null &&
              e.reusable_superset_id !== null,
          );
          for (const row of bumps) {
            await incrementUseCount(db, row.reusable_superset_id as string, now);
          }
        }
        // Re-hydrate so any DB-side cascade lands in committed.
        const refreshed = id ? await getTemplateFull(db, id) : null;
        if (refreshed) {
          setCommitted(refreshed);
          setDraft(cloneTemplate(refreshed));
        }
        if (mode === 'save') {
          setSaveSheetMode(null);
          Alert.alert(tt('status', 'saved'), '', [{ text: tt('common', 'ok') }]);
        } else {
          // import mode — redirect with apply params.
          const finalProgramId =
            refreshed?.program_id ?? patchedDraft.program_id ?? null;
          const finalSubTag =
            refreshed?.sub_tag ?? patchedDraft.sub_tag ?? null;
          const params = new URLSearchParams();
          params.set('applyTpl', encodeURIComponent(id));
          params.set(
            'applyProgram',
            finalProgramId == null
              ? '__none__'
              : encodeURIComponent(finalProgramId),
          );
          params.set(
            'applySubTag',
            finalSubTag == null
              ? '__none__'
              : encodeURIComponent(finalSubTag),
          );
          params.set('applyKind', fromKind!);
          params.set('applyDay', String(importFromDay!));
          if (fromKind === 'cell' && importFromCycle != null) {
            params.set('applyCycle', String(importFromCycle));
          }
          if (importFromSubTag != null && finalSubTag == null) {
            params.set('applySubTag', encodeURIComponent(importFromSubTag));
          }
          setSaveSheetMode(null);
          router.replace(`/(tabs)/programs?${params.toString()}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'DUPLICATE_TEMPLATE_TRIPLE') {
          Alert.alert(
            tt('alert', 'variantExists'),
            tt('alert', 'duplicateTemplateTripleEditorBody'),
          );
        } else {
          Alert.alert(tt('alert', 'saveFailed'), msg);
        }
      } finally {
        setBusy(false);
      }
    },
    [
      draft,
      busy,
      saveSheetMode,
      committed,
      db,
      id,
      fromKind,
      importFromCycle,
      importFromDay,
      importFromSubTag,
      router,
    ],
  );

  const onDeleteTemplate = useCallback(() => {
    if (!id || !draft || busy) return;
    const programName = draft.program_id
      ? programs.find((p) => p.id === draft.program_id)?.name ?? tt('common', 'default')
      : null;
    const triple = formatTemplateTriple(programName, draft.sub_tag ?? null);
    Alert.alert(
      tt('alert', 'deleteTemplateQ'),
      tEditorDeleteTemplateBody(draft.name, triple),
      [
        { text: tt('common', 'cancel'), style: 'cancel' },
        {
          text: tt('common', 'delete'),
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteTemplate(db, id);
              router.back();
            } catch (e) {
              Alert.alert(tt('alert', 'deleteFailed'), e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }, [id, draft, busy, db, programs, router]);

  const onStartSession = useCallback(async () => {
    if (!id || !draft || busy) return;
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          tt('alert', 'sessionAlreadyInProgress'),
          tt('alert', 'endActiveSessionFirst'),
        );
        return;
      }
      if (draft.exercises.length === 0) {
        Alert.alert(tt('alert', 'addExerciseFirst'));
        return;
      }
      if (dirty) {
        await persistDraft();
      }
      await startSessionFromTemplate(db, { template_id: id, uuid: randomUUID });
      router.replace('/');
    } catch (e) {
      Alert.alert(tt('alert', 'cannotStartSession'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [id, draft, busy, db, dirty, persistDraft, router]);

  // -----------------------------------------------------------------------
  // Draft mutators (mirror the prototype's per-set CRUD; pure ops live in
  // `src/domain/template/templateOps.ts` but the editor still inlines small
  // patches for simplicity — we keep the prototype's structure verbatim and
  // only swap field names where production differs).
  // -----------------------------------------------------------------------

  const updateName = (name: string) => draft && setDraft({ ...draft, name });

  const updateColor = (color_hex: string) => {
    if (!draft) return;
    setDraft({ ...draft, color_hex });
    setShowColorPicker(false);
  };

  const toggleExpanded = (ex_id: string) => {
    setExpandedExId((cur) => (cur === ex_id ? null : ex_id));
  };

  const updateSet = (
    ex_id: string,
    set_id: string,
    patch: Partial<TemplateSet>,
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) =>
        ex.id !== ex_id
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s) =>
                s.id !== set_id ? s : { ...s, ...patch },
              ),
            },
      ),
    });
  };

  const findTrailingClusterHeadIdx = (sets: TemplateSet[]): number => {
    for (let i = sets.length - 1; i >= 0; i--) {
      const s = sets[i];
      if (s.kind === 'dropset' && (s.parent_set_id ?? null) === null) {
        return i;
      }
    }
    return -1;
  };

  const normalizePositions = (sets: TemplateSet[]): TemplateSet[] =>
    sets.map((s, i) => (s.position === i ? s : { ...s, position: i }));

  const addSet = (ex_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const nextPos = ex.sets.length;

        if (last?.kind === 'dropset') {
          const headIdx = findTrailingClusterHeadIdx(ex.sets);
          if (headIdx === -1) return ex;
          const cluster = ex.sets.slice(headIdx);
          const newHeadId = newId('set');
          const cloned: TemplateSet[] = cluster.map((s, idx) => ({
            id: idx === 0 ? newHeadId : newId('set'),
            position: nextPos + idx,
            kind: s.kind,
            reps: s.reps,
            weight: s.weight,
            parent_set_id: idx === 0 ? null : newHeadId,
            notes: null,
          }));
          return { ...ex, sets: [...ex.sets, ...cloned] };
        }

        const next: TemplateSet = {
          id: newId('set'),
          position: nextPos,
          kind: last?.kind ?? 'working',
          reps: last?.reps ?? 8,
          weight: last?.weight ?? 20,
          parent_set_id: null,
          notes: null,
        };
        return { ...ex, sets: [...ex.sets, next] };
      }),
    });
  };

  const addDropsetRow = (ex_id: string, after_set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const afterIdx = ex.sets.findIndex((s) => s.id === after_set_id);
        if (afterIdx === -1) return ex;
        const afterSet = ex.sets[afterIdx];
        if (afterSet.kind !== 'dropset') return ex;
        const headId =
          (afterSet.parent_set_id ?? null) === null
            ? afterSet.id
            : (afterSet.parent_set_id as string);
        const newSet: TemplateSet = {
          id: newId('set'),
          position: 0,
          kind: 'dropset',
          reps: afterSet.reps,
          weight: afterSet.weight,
          parent_set_id: headId,
          notes: null,
        };
        const inserted = [
          ...ex.sets.slice(0, afterIdx + 1),
          newSet,
          ...ex.sets.slice(afterIdx + 1),
        ];
        return { ...ex, sets: normalizePositions(inserted) };
      }),
    });
  };

  const removeDropsetRow = (ex_id: string, set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const set = ex.sets.find((s) => s.id === set_id);
        if (!set || set.kind !== 'dropset') return ex;
        const headId =
          (set.parent_set_id ?? null) === null
            ? set.id
            : (set.parent_set_id as string);
        const clusterSize = ex.sets.filter(
          (x) => x.id === headId || x.parent_set_id === headId,
        ).length;
        if (clusterSize <= 2) {
          Alert.alert(
            tt('alert', 'cannotDelete'),
            tt('alert', 'dropsetMinimum'),
          );
          return ex;
        }
        return {
          ...ex,
          sets: normalizePositions(ex.sets.filter((s) => s.id !== set_id)),
        };
      }),
    });
  };

  const deleteSet = (ex_id: string, set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) =>
        ex.id !== ex_id
          ? ex
          : {
              ...ex,
              sets: normalizePositions(ex.sets.filter((s) => s.id !== set_id)),
            },
      ),
    });
  };

  const deleteCluster = (ex_id: string, head_set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) =>
        ex.id !== ex_id
          ? ex
          : {
              ...ex,
              sets: normalizePositions(
                ex.sets.filter(
                  (s) =>
                    s.id !== head_set_id &&
                    (s.parent_set_id ?? null) !== head_set_id,
                ),
              ),
            },
      ),
    });
  };

  const cloneSetAfter = (ex_id: string, set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const idx = ex.sets.findIndex((s) => s.id === set_id);
        if (idx === -1) return ex;
        const src = ex.sets[idx];
        const next: TemplateSet = {
          id: newId('set'),
          position: 0,
          kind: src.kind,
          reps: src.reps,
          weight: src.weight,
          parent_set_id: null,
          notes: null,
        };
        const inserted = [
          ...ex.sets.slice(0, idx + 1),
          next,
          ...ex.sets.slice(idx + 1),
        ];
        return { ...ex, sets: normalizePositions(inserted) };
      }),
    });
  };

  const addClusterAfter = (ex_id: string, head_set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        let clusterEndIdx = -1;
        ex.sets.forEach((s, i) => {
          if (s.id === head_set_id || s.parent_set_id === head_set_id) {
            clusterEndIdx = i;
          }
        });
        if (clusterEndIdx === -1) return ex;
        const headRef = ex.sets.find((s) => s.id === head_set_id);
        if (!headRef) return ex;
        const newHeadId = newId('set');
        const newHead: TemplateSet = {
          id: newHeadId,
          position: 0,
          kind: 'dropset',
          reps: headRef.reps,
          weight: headRef.weight,
          parent_set_id: null,
          notes: null,
        };
        const newFollower: TemplateSet = {
          id: newId('set'),
          position: 0,
          kind: 'dropset',
          reps: headRef.reps,
          weight: headRef.weight,
          parent_set_id: newHeadId,
          notes: null,
        };
        const inserted = [
          ...ex.sets.slice(0, clusterEndIdx + 1),
          newHead,
          newFollower,
          ...ex.sets.slice(clusterEndIdx + 1),
        ];
        return { ...ex, sets: normalizePositions(inserted) };
      }),
    });
  };

  // Slice 10c Phase 2 commit 3 — delegate to pure ops. Cluster mirror +
  // solo dispatch lives in `cycleSetKindAcrossExercises` so the session
  // set logger (Phase 2+) can share the exact same logic.
  const cycleSetKind = (ex_id: string, set_id: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      exercises: cycleSetKindAcrossExercises(draft.exercises, ex_id, set_id, {
        uuid: () => newId('set'),
      }),
    });
  };

  const deleteSupersetRowAt = (
    parent_id: string,
    child_ids: string[],
    index: number,
  ) => {
    if (!draft) return;
    const ids = new Set([parent_id, ...child_ids]);
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (!ids.has(ex.id)) return ex;
        if (index < 0 || index >= ex.sets.length) return ex;
        return {
          ...ex,
          sets: normalizePositions(ex.sets.filter((_, i) => i !== index)),
        };
      }),
    });
  };

  const cloneSupersetRowAt = (
    parent_id: string,
    child_ids: string[],
    index: number,
  ) => {
    if (!draft) return;
    const ids = new Set([parent_id, ...child_ids]);
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (!ids.has(ex.id)) return ex;
        if (index < 0 || index >= ex.sets.length) return ex;
        const src = ex.sets[index];
        const cloned: TemplateSet = {
          id: newId('set'),
          position: index + 1,
          kind: src.kind,
          reps: src.reps,
          weight: src.weight,
          parent_set_id: null,
          notes: null,
        };
        const next = [
          ...ex.sets.slice(0, index + 1),
          cloned,
          ...ex.sets.slice(index + 1),
        ];
        return { ...ex, sets: normalizePositions(next) };
      }),
    });
  };

  const addSetToSuperset = (parent_id: string, child_ids: string[]) => {
    if (!draft) return;
    const ids = new Set([parent_id, ...child_ids]);
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (!ids.has(ex.id)) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const nextPos = ex.sets.length;
        if (last?.kind === 'dropset') {
          const headIdx = findTrailingClusterHeadIdx(ex.sets);
          if (headIdx === -1) return ex;
          const cluster = ex.sets.slice(headIdx);
          const newHeadId = newId('set');
          const cloned: TemplateSet[] = cluster.map((s, idx) => ({
            id: idx === 0 ? newHeadId : newId('set'),
            position: nextPos + idx,
            kind: s.kind,
            reps: s.reps,
            weight: s.weight,
            parent_set_id: idx === 0 ? null : newHeadId,
            notes: null,
          }));
          return { ...ex, sets: [...ex.sets, ...cloned] };
        }
        const next: TemplateSet = {
          id: newId('set'),
          position: nextPos,
          kind: last?.kind ?? 'working',
          reps: last?.reps ?? 8,
          weight: last?.weight ?? 20,
          parent_set_id: null,
          notes: null,
        };
        return { ...ex, sets: [...ex.sets, next] };
      }),
    });
  };

  // overnight #45 第 3 點 — 排序動作 modal handler。Mirror session pattern
  // (app/(tabs)/index.tsx:2092 ReorderExercisesSheet)：長按 ex 卡 header
  // 或 ⚙️「移動動作」打開 modal、用戶長按列拖拽 → 完成 commit 新 ordering。
  // template editor 為 draft-based 編輯模型，不直寫 DB；改 draft.exercises
  // 的 ordering（parents 重排 + children 留在 parent 旁、保留 parent_id 對），
  // 等用戶按右上「儲存」走 commitTemplateDraft path（既有邏輯會 UPDATE
  // template_exercise.ordering）。
  const showReorderPlaceholder = () => {
    setReorderSheetOpen(true);
  };

  // Build the parent-row list for the reorder modal: 1 row per parent
  // (solo or cluster-parent). Cluster 顯示 "A + B" 名稱 (mirror header
  // layout)。Children rows 不出現 — sheet 只動 parent ordering；A+B 配對
  // 不可拆是 cluster 不變式。
  const reorderParents = useMemo(() => {
    if (!draft) return [];
    return draft.exercises
      .filter((e) => e.parent_id == null)
      .map((parent) => {
        const childNames = draft.exercises
          .filter((c) => c.parent_id === parent.id)
          .map((c) => c.name ?? '(動作)');
        const name = childNames.length === 0
          ? parent.name ?? '(動作)'
          : [parent.name ?? '(動作)', ...childNames].join(' + ');
        return { id: parent.id, name };
      });
  }, [draft]);

  const onConfirmReorder = (orderedParentIds: string[]) => {
    setReorderSheetOpen(false);
    if (!draft) return;
    // Pure-domain helper handles rebuild + ordering re-key + safety guard
    // (missing parents appended). Exercised by tests in templateOps.test.ts.
    const rebuilt = reorderTemplateExercises(draft.exercises, orderedParentIds);
    setDraft({ ...draft, exercises: rebuilt });
  };

  // overnight #49 — inline 長按拖曳 reorder for SETS within a solo card.
  // Mirror session pattern (app/(tabs)/index.tsx:2432 onDragEnd path), but
  // works on draft (no DB write — commitTemplateDraft on 儲存 will UPDATE
  // template_set.position). Pure helper `reorderTemplateSetsByGroups` handles
  // dropset cluster cohesion (head + followers stay contiguous as 1 group).
  const onConfirmReorderSets = useCallback(
    (ex_id: string, orderedGroupIds: string[]) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          exercises: prev.exercises.map((e) =>
            e.id === ex_id
              ? reorderTemplateSetsByGroups(e, orderedGroupIds)
              : e,
          ),
        };
      });
    },
    [],
  );

  // overnight #49 — inline 長按拖曳 reorder for cluster CYCLES (A+B paired).
  // Mirror session pattern (components/session/cluster-card.tsx:291 + the
  // session-level onConfirmReorderCycles handler at app/(tabs)/index.tsx:1825).
  // Pure helper `reorderTemplateClusterCycles` walks both sides in lockstep so
  // a cycle drag never breaks the A.sets[i] ↔ B.sets[i] pairing.
  const onConfirmReorderClusterCycles = useCallback(
    (
      parent_id: string,
      child_id: string,
      orderedCycleKeys: string[],
    ) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const exA = prev.exercises.find((e) => e.id === parent_id);
        const exB = prev.exercises.find((e) => e.id === child_id);
        if (!exA || !exB) return prev;
        const next = reorderTemplateClusterCycles(exA, exB, orderedCycleKeys);
        return {
          ...prev,
          exercises: prev.exercises.map((e) => {
            if (e.id === parent_id) return next.exA;
            if (e.id === child_id) return next.exB;
            return e;
          }),
        };
      });
    },
    [],
  );

  // Template editor 「動作歷史」 button → exercise-history page (slice 9.5 stub
  // 落地, 2026-05-21 wave 13 mini wave). Template editor is design-time so we
  // don't have a `session_exercise_id` to pass — caller pattern mirrors
  // `app/superset/[id].tsx::FooterButton` (no `currentSeId*` params).
  //
  // Solo card → clusterMode=exclude_cluster (mirror session detail page solo
  // card at app/session/[id].tsx:1547).
  // Cluster card → clusterMode=cluster_only + partner + side=A (mirror session
  // detail page cluster card at app/session/[id].tsx:1437). For manual clusters
  // with N>1 children, treat children[0] as B side (matches how the cluster
  // header reads pair info in `computeTemplateClusterStat`).
  const showExerciseHistory = (ex: TemplateExercise) => {
    router.push(`/exercise-history/${ex.exercise_id}?clusterMode=exclude_cluster`);
  };

  const showSupersetHistory = (parent: TemplateExercise, children: TemplateExercise[]) => {
    const b = children[0];
    if (!b) {
      // Defensive: no B side → fall back to solo view.
      router.push(`/exercise-history/${parent.exercise_id}?clusterMode=exclude_cluster`);
      return;
    }
    router.push(
      `/exercise-history/${parent.exercise_id}?clusterMode=cluster_only&partner=${b.exercise_id}&side=A`,
    );
  };

  const openExerciseNoteEditor = (ex: TemplateExercise) => {
    setNoteEditing({
      target: { kind: 'exercise', ex_id: ex.id },
      draft: ex.notes ?? '',
    });
  };

  const openSetNoteEditor = (ex_id: string, set: TemplateSet) => {
    setNoteEditing({
      target: { kind: 'set', ex_id, set_id: set.id },
      draft: set.notes ?? '',
    });
  };

  const saveNote = () => {
    if (!noteEditing || !draft) return;
    const { target, draft: noteText } = noteEditing;
    const text = noteText.trim().length === 0 ? null : noteText;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (target.kind === 'exercise') {
          if (ex.id !== target.ex_id) return ex;
          return { ...ex, notes: text };
        }
        if (ex.id !== target.ex_id) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s) =>
            s.id !== target.set_id ? s : { ...s, notes: text },
          ),
        };
      }),
    });
    setNoteEditing(null);
  };

  const openRestEditor = (ex: TemplateExercise) => {
    setRestEditing({ ex_id: ex.id, draft: ex.rest_seconds ?? 90 });
  };

  const saveRest = () => {
    if (!restEditing || !draft) return;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) =>
        ex.id !== restEditing.ex_id
          ? ex
          : { ...ex, rest_seconds: restEditing.draft },
      ),
    });
    setRestEditing(null);
  };

  const toggleSection = (ex_id: string) => {
    if (!draft) return;
    // Target + superset siblings (parent + all children) flip together.
    const target = draft.exercises.find((e) => e.id === ex_id);
    if (!target) return;
    const groupHeadId = target.parent_id ?? target.id;
    const affectedIds = new Set<string>([groupHeadId]);
    for (const e of draft.exercises) {
      if (e.parent_id === groupHeadId) affectedIds.add(e.id);
    }
    const flip = (s: ExerciseSection): ExerciseSection =>
      s === 'general' ? 'evergreen' : 'general';
    setDraft({
      ...draft,
      exercises: draft.exercises.map((e) =>
        affectedIds.has(e.id) ? { ...e, section: flip(e.section) } : e,
      ),
    });
  };

  const deleteExercise = (ex: TemplateExercise) => {
    if (!draft) return;
    // overnight #45 第 2 點 — cluster (rs_id NOT NULL) parent row 觸發
    // ⚙️ 刪除 → cascade-delete A+B 整 cluster（mirror session #18 behavior）。
    // 既有 filter 已正確處理（parent_id === ex.id 的 children 一併刪），
    // 只是 alert copy 要點明刪超級組以對齊 session UX。
    const isCluster = draft.exercises.some((e) => e.parent_id === ex.id);
    const title = isCluster ? tt('alert', 'deleteSupersetQ') : tt('alert', 'confirmDeleteQ');
    const exName = ex.name ?? tt('common', 'unknownExercise');
    const body = isCluster
      ? tEditorDeleteClusterBody(exName)
      : tEditorDeleteSoloBody(exName);
    Alert.alert(title, body, [
      { text: tt('common', 'cancel'), style: 'cancel' },
      {
        text: tt('common', 'delete'),
        style: 'destructive',
        onPress: () => {
          setDraft({
            ...draft,
            exercises: draft.exercises.filter(
              (e) => e.id !== ex.id && e.parent_id !== ex.id,
            ),
          });
        },
      },
    ]);
  };

  const openGearMenu = (ex: TemplateExercise) => {
    // overnight #45 第 2 點 — 補 cluster gear menu 3 項 (新增/編輯備註、
    // 休息時間、移動動作)。原設計把 rs_id NOT NULL 的 cluster metadata
    // 全鎖死（ADR-0016 amendment / slice 9.8b grill Q5）— 該鎖過嚴。正解：
    // cluster 內 A+B 兩動作「配對不可拆」是要保的（不能把 A 拆出 cluster
    // 變 solo），但 cluster **外層位置可動**、cluster level metadata
    // (parent 的 notes/rest_seconds) 也應可設，mirror session cluster card
    // (app/(tabs)/index.tsx:1156-1164 cluster gear)。
    //
    // notes 是 per-Exercise GLOBAL（ADR-0017 amendment）— 透過 parent 的
    // exercise_id 寫到 exercise.notes（A 側），mirror session 行為（session
    // 也是用 parent.exercise_id 寫 exercise.notes）。rest_seconds 寫在
    // template_exercise parent row 上、不 leak 到 children rows。
    const hasNotes = (ex.notes ?? '').trim().length > 0;
    const restLabel = tEditorRestLabel(ex.rest_seconds ?? 90);
    const options = [
      hasNotes ? tt('button', 'editNote') : tt('button', 'addNote'),
      restLabel,
      tt('button', 'moveExercise'),
      ex.section === 'general' ? tt('button', 'setAsEvergreen') : tt('button', 'setAsGeneral'),
      tt('common', 'delete'),
      tt('common', 'cancel'),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: ex.name ?? undefined,
        options,
        destructiveButtonIndex: 4,
        cancelButtonIndex: 5,
      },
      (idx) => {
        if (idx === 0) openExerciseNoteEditor(ex);
        else if (idx === 1) openRestEditor(ex);
        else if (idx === 2) showReorderPlaceholder();
        else if (idx === 3) toggleSection(ex.id);
        else if (idx === 4) deleteExercise(ex);
      },
    );
  };

  const onPickExercise = async (ex: Exercise, section: ExerciseSection) => {
    if (!draft || !id) return;
    setShowExercisePicker(false);
    // Pull 動作記憶 candidates and derive prefill sets.
    let prefilled: TemplateSet[] | null = null;
    try {
      const candidates = await queryMemoryCandidates(db, { exercise_id: ex.id });
      prefilled = deriveLatestSetsForExercise({
        exercise_id: ex.id,
        candidates,
        uuid: () => newId('set'),
      });
    } catch {
      prefilled = null;
    }
    const nextOrdering = draft.exercises.length;
    const seedSets: TemplateSet[] =
      prefilled && prefilled.length > 0
        ? prefilled
        : [
            {
              id: newId('set'),
              position: 0,
              kind: 'working',
              reps: 8,
              weight: 20,
              parent_set_id: null,
              notes: null,
            },
          ];
    const newExerciseRow: TemplateExercise = {
      id: newId('te'),
      template_id: id,
      exercise_id: ex.id,
      name: ex.name,
      ordering: nextOrdering,
      section,
      parent_id: null,
      notes: null,
      rest_seconds: null,
      reusable_superset_id: null,
      sets: seedSets,
    };
    setDraft({ ...draft, exercises: [...draft.exercises, newExerciseRow] });
    setExpandedExId(newExerciseRow.id);
  };

  const hydrateExercisesByIds = useCallback(
    async (exerciseIds: readonly string[]) => {
      if (!id || exerciseIds.length === 0) return;

      // Refetch the library here. The cached `exerciseLibrary` state was
      // captured at editor mount and does NOT include exercises created
      // mid-session via the picker's "+ 新動作" flow — relying on the cache
      // silently dropped them on hydrate.
      const freshLibrary = await listExercises(db);

      const newRows: TemplateExercise[] = [];
      for (const exId of exerciseIds) {
        const exercise = freshLibrary.find((x) => x.id === exId);
        if (!exercise) continue;

        let prefilled: TemplateSet[] | null = null;
        try {
          const candidates = await queryMemoryCandidates(db, { exercise_id: exId });
          prefilled = deriveLatestSetsForExercise({
            exercise_id: exId,
            candidates,
            uuid: () => newId('set'),
          });
        } catch {
          prefilled = null;
        }

        const seedSets: TemplateSet[] =
          prefilled && prefilled.length > 0
            ? prefilled
            : [
                {
                  id: newId('set'),
                  position: 0,
                  kind: 'working',
                  reps: 8,
                  weight: 20,
                  parent_set_id: null,
                  notes: null,
                },
              ];

        newRows.push({
          id: newId('te'),
          template_id: id,
          exercise_id: exId,
          name: exercise.name,
          ordering: 0, // re-assigned below relative to draft.exercises.length
          section: 'general',
          parent_id: null,
          notes: null,
          rest_seconds: null,
          reusable_superset_id: null,
          sets: seedSets,
        });
      }

      if (newRows.length === 0) return;

      setDraft((prev) => {
        if (!prev) return prev;
        const base = prev.exercises.length;
        const stamped = newRows.map((r, i) => ({ ...r, ordering: base + i }));
        return { ...prev, exercises: [...prev.exercises, ...stamped] };
      });
      setExpandedExId(newRows[newRows.length - 1].id);
    },
    [id, db],
  );

  /**
   * Explode each reusable-superset id into a parent + child `TemplateExercise`
   * pair and append to the draft (slice 9.8b grill Q3/Q4/Q5/Q8).
   *
   * Per-(rs_id, position) memory: try `queryReusableSupersetMemory(rs_id)` —
   * if a prior cluster exists, both rows derive sets from that cluster's
   * parent + child via `deriveLatestSetsForExercise`. First-ever explode
   * falls back to system default (1 working set @ 8 reps × 20 kg), matching
   * the solo-without-memory branch.
   *
   * Both rows stamp `reusable_superset_id = sId` (handled inside
   * `explodeSupersetForTemplate`) so future explodes route correctly and
   * the ADR-0016 cluster lock rules can gate destructive operations.
   *
   * `use_count` is NOT bumped here — bump happens at draft commit time
   * (slice 9.8b grill Q6) so adding-then-removing a cluster in the same
   * editor session does not inflate the count.
   */
  const hydrateReusableSupersets = useCallback(
    async (supersetIds: readonly string[]) => {
      if (!id || supersetIds.length === 0) return;

      const newClusters: TemplateExercise[] = [];
      for (const sId of supersetIds) {
        const data = await getReusableSupersetWithExercises(db, sId);
        if (!data || data.exercises.length !== 2) continue;
        const [exA, exB] = data.exercises;

        let parentSeed: TemplateSet[] | null = null;
        let childSeed: TemplateSet[] | null = null;
        try {
          const candidates = await queryReusableSupersetMemory(db, {
            reusable_superset_id: sId,
          });
          if (candidates.length === 2) {
            parentSeed = deriveLatestSetsForExercise({
              exercise_id: exA.id,
              candidates,
              uuid: () => newId('set'),
            });
            childSeed = deriveLatestSetsForExercise({
              exercise_id: exB.id,
              candidates,
              uuid: () => newId('set'),
            });
          }
        } catch {
          parentSeed = null;
          childSeed = null;
        }

        const defaultSeed = (): TemplateSet[] => [
          {
            id: newId('set'),
            position: 0,
            kind: 'working',
            reps: 8,
            weight: 20,
            parent_set_id: null,
            notes: null,
          },
        ];

        const [parent, child] = explodeSupersetForTemplate({
          superset: data.superset,
          exercises: [exA, exB],
          template_id: id,
          ordering_start: 0, // re-assigned below relative to draft.exercises.length
          idGen: () => newId('te'),
        });
        parent.sets =
          parentSeed && parentSeed.length > 0 ? parentSeed : defaultSeed();
        child.sets =
          childSeed && childSeed.length > 0 ? childSeed : defaultSeed();

        newClusters.push(parent, child);
      }

      if (newClusters.length === 0) return;

      setDraft((prev) => {
        if (!prev) return prev;
        const base = prev.exercises.length;
        const stamped = newClusters.map((r, i) => ({
          ...r,
          ordering: base + i,
        }));
        return { ...prev, exercises: [...prev.exercises, ...stamped] };
      });
      setExpandedExId(newClusters[newClusters.length - 1].id);
    },
    [id, db],
  );

  // Two-stage drain: useFocusEffect captures the picker payload as soon as
  // the editor re-focuses, but hydration is deferred until the exercise
  // library has finished loading. Without the stage gap, a cold remount
  // (e.g. user navigates back through Today instead of the back stack) sees
  // empty exerciseLibrary and silently drops every picked id.
  const [pendingPick, setPendingPick] = useState<{
    exerciseIds: readonly string[];
    reusableSupersetIds: readonly string[];
  } | null>(null);

  useFocusEffect(
    useCallback(() => {
      const payload = consumePick();
      if (
        payload &&
        (payload.exerciseIds.length > 0 ||
          payload.reusableSupersetIds.length > 0)
      ) {
        setPendingPick({
          exerciseIds: payload.exerciseIds,
          reusableSupersetIds: payload.reusableSupersetIds,
        });
      }
    }, []),
  );

  useEffect(() => {
    if (!pendingPick) return;
    if (!draft || !id) return;
    // Reusable supersets explode FIRST, then solo exercises append after —
    // slice 9.8b grill Q1 dual-array convention.
    void (async () => {
      await hydrateReusableSupersets(pendingPick.reusableSupersetIds);
      await hydrateExercisesByIds(pendingPick.exerciseIds);
    })();
    setPendingPick(null);
  }, [
    pendingPick,
    draft,
    id,
    hydrateExercisesByIds,
    hydrateReusableSupersets,
  ]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Wave 18g smoke fix — headerShown is set statically at the layout
  // level (app/_layout.tsx Stack.Screen name="template/[id]"). Inline
  // `<Stack.Screen options={{ headerShown: false }} />` here caused a
  // remount loop when this route was opened from inside the modal-
  // presentation wizard (expo-router treats inline option changes inside
  // a modal context as a "rebuild screen" trigger).
  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.muted}>{tt('status', 'loading')}</Text>
      </SafeAreaView>
    );
  }
  if (missing || !draft || !committed) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{tt('alert', 'templateNotFound')}</Text>
          <Pressable style={styles.backBtn} onPress={onExit}>
            <Text style={styles.backBtnText}>{tt('common', 'backArrow')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const renderSection = (section: ExerciseSection, emptyText: string) => {
    if (!draft) return null;
    const inSection = draft.exercises.filter((e) => e.section === section);
    const parents = inSection.filter((e) => e.parent_id == null);
    if (parents.length === 0) {
      return <Text style={styles.emptySection}>{emptyText}</Text>;
    }
    return parents.map((parent) => {
      const children = inSection.filter((c) => c.parent_id === parent.id);
      const isSuper = children.length > 0;
      if (!isSuper) {
        return (
          <View key={parent.id} style={styles.exCard}>
            <ExerciseBody
              exercise={parent}
              expanded={expandedExId === parent.id}
              onToggle={() => toggleExpanded(parent.id)}
              onUpdateSet={(set_id, patch) =>
                updateSet(parent.id, set_id, patch)
              }
              onAddSet={() => addSet(parent.id)}
              onAddDropsetRow={(set_id) => addDropsetRow(parent.id, set_id)}
              onRemoveDropsetRow={(set_id) =>
                removeDropsetRow(parent.id, set_id)
              }
              onDeleteSet={(set_id) => deleteSet(parent.id, set_id)}
              onCloneSetAfter={(set_id) => cloneSetAfter(parent.id, set_id)}
              onDeleteCluster={(head_id) => deleteCluster(parent.id, head_id)}
              onAddClusterAfter={(head_id) =>
                addClusterAfter(parent.id, head_id)
              }
              onLongPressHeader={() => setReorderSheetOpen(true)}
              onShowHistory={() => showExerciseHistory(parent)}
              onGearTap={() => openGearMenu(parent)}
              onShowSetNote={(set) => openSetNoteEditor(parent.id, set)}
              onShowExerciseNote={() => openExerciseNoteEditor(parent)}
              onCycleLabel={(s) => cycleSetKind(parent.id, s.id)}
              onConfirmReorderSets={(orderedGroupIds) =>
                onConfirmReorderSets(parent.id, orderedGroupIds)
              }
            />
          </View>
        );
      }
      const isExpanded = expandedExId === parent.id;
      // overnight #48 第 1 點 / wave 12 dropset 納入修正 (2026-05-20):
      // cluster header 顯示「{warmup}熱+{working}組」用 cycle 概念算。1 chain =
      // 1 unit — dropset HEAD 算 1 組、follower-only cycle 不另計。詳見
      // `computeTemplateClusterStat` JSDoc。2-side rule → 只取 children[0]
      // (mirror runtime groupClusterSides). 為空 cluster → 0熱+0組.
      const clusterStat = computeTemplateClusterStat(
        parent.sets.map((s) => ({
          kind: s.kind,
          parent_set_id: s.parent_set_id ?? null,
        })),
        (children[0]?.sets ?? []).map((s) => ({
          kind: s.kind,
          parent_set_id: s.parent_set_id ?? null,
        })),
      );
      // overnight #45 第 1 點：mirror session cluster-card.tsx:216-224 layout
      // — 「超」chip 獨佔行 1 + 標題分行（兩動作名 + 「 + 」連接）獨佔行 2。
      // template 無 progress bar 概念，故只兩行（session 是三行 — chip / 標題 / progress）。
      return (
        <View key={parent.id} style={styles.exCard}>
          <View style={styles.exHeader}>
            <Pressable
              onPress={() => toggleExpanded(parent.id)}
              onLongPress={() => setReorderSheetOpen(true)}
              delayLongPress={400}
              style={styles.exHeaderTapZone}
              hitSlop={4}>
              <View style={styles.clusterText}>
                {/*
                  Row 1: 「超」chip + 「X熱+X組」+ ▼ 同列。把 stat 從標題列搬上來
                  —— 標題往往被兩個動作名 + " + " 連接撐長到 3 行（如
                  「Cable Crossover + Chest Dip」），同列再塞 stat / chevron
                  會壓縮標題空間。用戶反饋：移走後標題拿到 row 2 full-width。
                */}
                <View style={styles.clusterTagRow}>
                  <Text style={styles.supersetTag}>{tt('domain', 'supersetChip')}</Text>
                  <View style={styles.flexFill} />
                  <Text style={styles.exSummary}>
                    {clusterStat.warmupCount}熱+{clusterStat.workingCount}組
                  </Text>
                  {isExpanded ? (
                    <Text style={styles.exChevron}>▼</Text>
                  ) : null}
                </View>
                <Text style={styles.clusterName}>
                  {parent.name ?? '(動作)'}
                  {children.map((c) => (
                    <Fragment key={c.id}>
                      <Text style={styles.clusterPlus}> + </Text>
                      {c.name ?? '(動作)'}
                    </Fragment>
                  ))}
                </Text>
              </View>
            </Pressable>
            {parent.notes && parent.notes.trim().length > 0 ? (
              <Pressable
                onPress={() => openExerciseNoteEditor(parent)}
                style={styles.exNoteIndicator}
                hitSlop={8}>
                <Text style={styles.exNoteIndicatorText}>📝</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => openGearMenu(parent)}
              style={styles.exGearBtn}
              hitSlop={8}>
              <Text style={styles.exGear}>⚙</Text>
            </Pressable>
          </View>
          {isExpanded ? (
            <>
              <View style={[styles.exSuperRow, styles.exSuperCycleRow]}>
                {/* Leading spacer matching shared `#` btn column width (28). */}
                <View style={styles.exClusterSharedLabelSpacer} />
                <View style={styles.exSuperCol}>
                  <Text style={styles.supersetColName} numberOfLines={1}>
                    {parent.name ?? '(動作)'}
                  </Text>
                </View>
                {children.map((child) => (
                  <Fragment key={child.id}>
                    <View style={styles.exSuperDivider} />
                    <View
                      style={[styles.exSuperCol, styles.exSuperColWithLeftPad]}>
                      <Text style={styles.supersetColName} numberOfLines={1}>
                        {child.name ?? '(動作)'}
                      </Text>
                    </View>
                  </Fragment>
                ))}
                <View style={styles.supersetRowNoteSlot} />
              </View>
              <View style={[styles.setsBox, styles.setsBoxCompact]}>
                {(() => {
                  // overnight #49 — cluster cycle inline drag. Two-side rule
                  // (children[0]) mirrors session cluster-card.tsx::groupClusterSides
                  // (slice 10c #45 amendment §A: cluster 內 A+B 配對不可拆).
                  // Build cycle[] (paired rows) and feed NestableDraggableFlatList;
                  // onDragEnd extracts key per cycle (a_set?.id ?? b_set?.id) and
                  // delegates to pure helper `reorderTemplateClusterCycles`.
                  const parentMeta = computeExMeta(parent);
                  const childMetas = children.map((c) => computeExMeta(c));
                  const childIds = children.map((c) => c.id);
                  const sideB = children[0] ?? null;
                  const aLen = parent.sets.length;
                  const bLen = sideB?.sets.length ?? 0;
                  const maxSets = Math.max(aLen, bLen);

                  interface CycleItem {
                    key: string;
                    cycle_idx: number; // = original index i (0-based)
                  }
                  const cycles: CycleItem[] = Array.from(
                    { length: maxSets },
                    (_, i) => ({
                      key:
                        parent.sets[i]?.id ??
                        sideB?.sets[i]?.id ??
                        `cycle-${i}`,
                      cycle_idx: i,
                    }),
                  );

                  const renderCell = (
                    ex: TemplateExercise,
                    meta: ReturnType<typeof computeExMeta>,
                    i: number,
                  ) => {
                    const s = ex.sets[i];
                    if (!s) return <View style={styles.setRowPlaceholder} />;
                    const isDropset = s.kind === 'dropset';
                    const isDropsetFollower =
                      isDropset && (s.parent_set_id ?? null) !== null;
                    const isClusterLast = meta.clusterInfo[i].isClusterLast;
                    const minusDisabled = meta.clusterInfo[i].clusterSize <= 2;
                    return (
                      <SetRowContent
                        set={s}
                        setLabel={meta.setLabels[i]}
                        compact
                        hideLabel
                        isDropsetFollower={isDropsetFollower}
                        isClusterLast={isClusterLast}
                        minusDisabled={minusDisabled}
                        hideNoteIndicator
                        onUpdateSet={(set_id, patch) =>
                          updateSet(ex.id, set_id, patch)
                        }
                        onShowSetNote={(setObj) =>
                          openSetNoteEditor(ex.id, setObj)
                        }
                        onRemoveDropsetRow={(set_id) =>
                          removeDropsetRow(ex.id, set_id)
                        }
                        onAddDropsetRow={(set_id) =>
                          addDropsetRow(ex.id, set_id)
                        }
                        onCycleLabel={(setObj) => cycleSetKind(ex.id, setObj.id)}
                      />
                    );
                  };

                  if (cycles.length === 0) return null;
                  return (
                    <NestableDraggableFlatList
                      data={cycles}
                      keyExtractor={(c) => c.key}
                      activationDistance={20}
                      onDragEnd={({ data }) => {
                        const newKeys = data.map((c) => c.key);
                        const oldKeys = cycles.map((c) => c.key);
                        const changed = newKeys.some(
                          (k, idx) => k !== oldKeys[idx],
                        );
                        if (changed && sideB) {
                          onConfirmReorderClusterCycles(
                            parent.id,
                            sideB.id,
                            newKeys,
                          );
                        }
                      }}
                      renderItem={({
                        item: c,
                        drag,
                        isActive,
                      }: RenderItemParams<CycleItem>) => {
                        const i = c.cycle_idx;
                        const parentSet = parent.sets[i];
                        const rowHasNote = !!(
                          parentSet?.notes && parentSet.notes.trim().length > 0
                        );
                        return (
                          <SwipeableSetRow
                            swipeLeftActions={[
                              {
                                key: 'del-superset-row',
                                label: '刪',
                                color: '#FF3B30',
                                onPress: () =>
                                  deleteSupersetRowAt(parent.id, childIds, i),
                              },
                            ]}
                            swipeRightActions={[
                              {
                                key: 'clone-superset-row',
                                label: '加',
                                color: '#34C759',
                                onPress: () =>
                                  cloneSupersetRowAt(parent.id, childIds, i),
                              },
                              {
                                key: 'note-superset-row',
                                label: '備註',
                                color: '#007AFF',
                                onPress: () => {
                                  if (parentSet)
                                    openSetNoteEditor(parent.id, parentSet);
                                },
                              },
                            ]}
                            onLongPress={drag}>
                            <View
                              style={[
                                styles.exSuperRow,
                                styles.exSuperCycleRow,
                                isActive && styles.dragActiveRow,
                              ]}>
                              {/*
                                Shared `#` button at row start — mirror session
                                cluster-card.tsx pattern (overnight #52 follow-up):
                                A+B 共用一個 label，避免 row 內出現兩個 #。Tap
                                觸發 cycleSetKindAcrossExercises（透過 cycleSetKind
                                wrapper），cluster path 內自動 mirror 到對側、A 跟
                                B 兩側 set_kind atomic flip。
                                Disabled if both A and B sides have no set at idx i.
                              */}
                              {(() => {
                                const sharedLabelSrc =
                                  parent.sets[i] ?? children[0]?.sets[i] ?? null;
                                const sharedLabel = sharedLabelSrc
                                  ? parent.sets[i]
                                    ? parentMeta.setLabels[i]
                                    : childMetas[0]?.setLabels[i] ?? ''
                                  : '';
                                const disabled = sharedLabelSrc === null;
                                return (
                                  <Pressable
                                    onPress={() => {
                                      if (disabled || !sharedLabelSrc) return;
                                      // Tap A side first (parent); if A empty, tap B side.
                                      // cycleSetKindAcrossExercises auto-mirrors to the
                                      // other side regardless of which is tapped.
                                      const tapEx = parent.sets[i]
                                        ? parent
                                        : children[0];
                                      cycleSetKind(tapEx.id, sharedLabelSrc.id);
                                    }}
                                    disabled={disabled}
                                    hitSlop={6}
                                    style={({ pressed }) => [
                                      styles.exClusterSharedLabel,
                                      pressed &&
                                        !disabled &&
                                        styles.exClusterSharedLabelPressed,
                                      disabled &&
                                        styles.exClusterSharedLabelDisabled,
                                    ]}
                                  >
                                    <Text style={styles.exClusterSharedLabelText}>
                                      {sharedLabel}
                                    </Text>
                                  </Pressable>
                                );
                              })()}
                              <View style={styles.exSuperCol}>
                                {renderCell(parent, parentMeta, i)}
                              </View>
                              {children.map((child, ci) => (
                                <Fragment key={child.id}>
                                  <View style={styles.exSuperDivider} />
                                  <View
                                    style={[
                                      styles.exSuperCol,
                                      styles.exSuperColWithLeftPad,
                                    ]}>
                                    {renderCell(child, childMetas[ci], i)}
                                  </View>
                                </Fragment>
                              ))}
                              <View style={styles.supersetRowNoteSlot}>
                                {rowHasNote ? (
                                  <Pressable
                                    onPress={() => {
                                      if (parentSet)
                                        openSetNoteEditor(parent.id, parentSet);
                                    }}
                                    hitSlop={6}>
                                    <Text style={styles.setNoteIndicatorText}>
                                      📝
                                    </Text>
                                  </Pressable>
                                ) : null}
                              </View>
                            </View>
                          </SwipeableSetRow>
                        );
                      }}
                    />
                  );
                })()}
              </View>
              <View style={styles.supersetFooter}>
                <Pressable
                  onPress={() =>
                    addSetToSuperset(
                      parent.id,
                      children.map((c) => c.id),
                    )
                  }
                  style={styles.exFooterBtn}>
                  <Text style={styles.exFooterBtnText}>{tt('button', 'addOneSet')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => showSupersetHistory(parent, children)}
                  style={styles.exFooterBtn}>
                  <Text style={styles.exFooterBtnText}>{tt('page', 'exerciseHistory')}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      );
    });
  };

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* headerShown handled by layout (see app/_layout.tsx) — see comment
            above the loading early-return for the modal-remount-loop context. */}
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} style={styles.topBtn}>
            <Text style={styles.topBtnText}>{tt('common', 'cancel')}</Text>
          </Pressable>
          <View style={styles.topCenter}>
            {/*
              overnight #45 第 4 點 — 標題欄精簡。原 3 行 (name / [swatch] +
              「per name 配色（同名連動）」/ triple)，精簡為 2 行：
                row 1: [swatch] [name input]
                row 2: triple (program · sub_tag)
              刪「per name 配色（同名連動）」 — swatch 點開既有 colorPicker
              modal，UX 一目了然不需註解。
            */}
            <View style={styles.nameRow}>
              <Pressable
                onPress={() => setShowColorPicker(true)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: colorForTemplate(draft) },
                ]}
                hitSlop={6}
              />
              <TextInput
                value={draft.name}
                onChangeText={updateName}
                style={styles.nameInput}
                placeholder={tt('page', 'templateNamePlaceholder')}
              />
            </View>
            <Text style={styles.tripleText}>
              {/* #50 C1 — display override prefers URL query (user's pick in
                  start-template-sheet) over actual draft.program_id/sub_tag.
                  Fallback path (#50): editor loads representative but shows
                  user's selection here. undefined = no override = use draft.
                  Resolves program_id → program_name via local lookup. */}
              {(() => {
                const programIdForDisplay =
                  displayProgramOverride === undefined
                    ? draft.program_id ?? null
                    : displayProgramOverride;
                const subTagForDisplay =
                  displaySubTagOverride === undefined
                    ? draft.sub_tag ?? null
                    : displaySubTagOverride;
                const programNameForDisplay = programIdForDisplay
                  ? programs.find((p) => p.id === programIdForDisplay)?.name ??
                    tt('common', 'default')
                  : null;
                return formatTemplateTriple(
                  programNameForDisplay,
                  subTagForDisplay,
                );
              })()}
            </Text>
          </View>
          {/*
            Import mode (programs tab "+ 建立新模板"): top-right action becomes
            「建立並導入」 + always enabled (even when !dirty) — user may keep
            defaults and still want to bind the (just-created) template back
            into the originating programs cell/column.
          */}
          <Pressable
            onPress={importMode ? onCreateAndImport : onSave}
            disabled={importMode ? busy : !dirty || busy}
            style={[
              styles.topBtn,
              (importMode ? busy : !dirty || busy) && styles.topBtnDisabled,
            ]}>
            <Text
              style={[
                styles.topBtnText,
                (importMode ? busy : !dirty || busy) &&
                  styles.topBtnTextDisabled,
                styles.topBtnSave,
              ]}>
              {busy ? '...' : importMode ? tt('button', 'createAndImport') : tt('common', 'save')}
            </Text>
          </Pressable>
        </View>

        {/*
          overnight #49 — set/cycle 改 inline 長按拖曳。
          外層 ScrollView 必須換成 NestableScrollContainer 才能讓 cluster /
          solo body 內巢狀的 NestableDraggableFlatList 正確接住手勢 (mirror
          session app/(tabs)/index.tsx:1648).
        */}
        <NestableScrollContainer contentContainerStyle={styles.body}>
          <SectionHeader label={getSectionLabel('general')} />
          {renderSection('general', tt('status', 'noGeneralExercises'))}

          <SectionHeader label={getSectionLabel('evergreen')} />
          {renderSection('evergreen', tt('status', 'noEvergreenExercises'))}
        </NestableScrollContainer>

        <View style={styles.actionBar}>
          <Pressable
            style={styles.actionBtn}
            onPress={() => router.push('/exercise-picker?mode=picker')}>
            <Text style={styles.actionBtnText}>{tt('button', 'addExercise')}</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={onStartSession}
            disabled={busy}>
            <Text style={styles.actionBtnText}>{tt('button', 'startSession')}</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={() => setShowColorPicker(true)}>
            <Text style={styles.actionBtnText}>{tt('button', 'selectColorAction')}</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={() => {
              // overnight #46 第 1 點 — 「通用」變體（program_id IS NULL OR
              // sub_tag IS NULL）是 3-tier prefill resolver 的 base fallback、
              // 不可刪。disabledButtonIndices = [1] 讓「刪除模板」灰字 + 點到 noop.
              const canDelete = isTemplateDeletable({
                program_id: draft.program_id ?? null,
                sub_tag: draft.sub_tag ?? null,
              });
              ActionSheetIOS.showActionSheetWithOptions(
                {
                  title: draft.name,
                  options: [
                    tt('button', 'saveAsTemplate'),
                    tt('button', 'deleteTemplate'),
                    tt('common', 'cancel'),
                  ],
                  destructiveButtonIndex: 1,
                  cancelButtonIndex: 2,
                  disabledButtonIndices: canDelete ? [] : [1],
                },
                (idx) => {
                  if (idx === 0)
                    Alert.alert(
                      tt('button', 'saveAsTemplate'),
                      tt('alert', 'saveAsTemplateStubBody'),
                    );
                  else if (idx === 1 && canDelete) onDeleteTemplate();
                },
              );
            }}>
            <Text style={styles.actionBtnText}>⋯</Text>
          </Pressable>
        </View>

        <Modal
          visible={showColorPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowColorPicker(false)}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setShowColorPicker(false)}>
            <Pressable style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{tt('page', 'selectColor')}</Text>
                <Pressable onPress={() => setShowColorPicker(false)}>
                  <Text style={styles.sheetDone}>{tt('common', 'done')}</Text>
                </Pressable>
              </View>
              <View style={styles.paletteGrid}>
                {PALETTE.map((color) => {
                  const selected = color === draft.color_hex;
                  return (
                    <Pressable
                      key={color}
                      onPress={() => updateColor(color)}
                      style={[
                        styles.paletteSwatch,
                        { backgroundColor: color },
                      ]}>
                      {selected ? (
                        <Text style={styles.paletteCheck}>✓</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.sheetFootnote}>
                {tt('status', 'colorPickerFootnote')}
              </Text>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={showExercisePicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowExercisePicker(false)}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setShowExercisePicker(false)}>
            <Pressable style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{tt('page', 'selectExercise')}</Text>
                <Pressable onPress={() => setShowExercisePicker(false)}>
                  <Text style={styles.sheetCancel}>{tt('common', 'cancel')}</Text>
                </Pressable>
              </View>
              <ScrollView style={styles.exercisePickerScroll}>
                {exerciseLibrary.map((ex) => (
                  <Pressable
                    key={ex.id}
                    onPress={() => onPickExercise(ex, 'general')}
                    style={styles.exercisePickerRow}>
                    <Text style={styles.exercisePickerName}>{ex.name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={styles.sheetFootnote}>
                {tt('status', 'exercisePickerFootnote')}
              </Text>
            </Pressable>
          </Pressable>
        </Modal>

        <Modal
          visible={noteEditing != null}
          transparent
          animationType="slide"
          onRequestClose={() => setNoteEditing(null)}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setNoteEditing(null)}>
            <Pressable style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Pressable onPress={() => setNoteEditing(null)}>
                  <Text style={styles.sheetCancel}>{tt('common', 'cancel')}</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>{tt('domain', 'note')}</Text>
                <Pressable onPress={saveNote}>
                  <Text style={styles.sheetDone}>{tt('common', 'done')}</Text>
                </Pressable>
              </View>
              <TextInput
                value={noteEditing?.draft ?? ''}
                onChangeText={(t) =>
                  setNoteEditing(
                    noteEditing ? { ...noteEditing, draft: t } : null,
                  )
                }
                placeholder={tt('page', 'noteEditorPlaceholder')}
                multiline
                autoFocus
                style={styles.noteInput}
              />
              <Text style={styles.sheetFootnote}>
                {tt('status', 'noteEditorFootnote')}
              </Text>
            </Pressable>
          </Pressable>
        </Modal>

        <ReorderExercisesSheet
          visible={reorderSheetOpen}
          initialItems={reorderParents}
          onConfirm={onConfirmReorder}
          onCancel={() => setReorderSheetOpen(false)}
        />

        {/*
          儲存 / 建立並導入 — round 15 polish (programs tab "+ 建立新模板").
          The sheet confirms (program_id, sub_tag) at commit time; name is
          edited inline in the editor body so we pass omitName=true. Title
          adapts to mode so user sees which flow they're confirming.
        */}
        {/*
          `defaultProgramDimensions` — import mode 才傳，讓 sheet 內的「+ 新增
          計畫」inline helper 繼承 fromProgram 的 cycle dimensions / start_date，
          避免新建 program 落回 1×3 預設值（round 15 bug fix）。session-detail
          caller 不受影響（沒傳 = 保留既有最小預設）。
        */}
        <TemplateMetaSheet
          visible={saveSheetMode != null}
          title={saveSheetMode === 'import' ? tt('page', 'createAndImportSheet') : tt('page', 'saveTemplateSheet')}
          omitName
          defaultName={draft?.name ?? ''}
          defaultProgramId={draft?.program_id ?? null}
          defaultSubTag={draft?.sub_tag ?? null}
          defaultProgramDimensions={(() => {
            if (saveSheetMode !== 'import' || !importFromProgramId) {
              return undefined;
            }
            const fromProg = programs.find(
              (p) => p.id === importFromProgramId,
            );
            if (!fromProg) return undefined;
            return {
              cycle_length: fromProg.cycle_length,
              cycle_count: fromProg.cycle_count,
              start_date: fromProg.start_date,
            };
          })()}
          programs={programs}
          busy={busy}
          onCancel={() => setSaveSheetMode(null)}
          onConfirm={onSaveSheetConfirm}
        />

        <Modal
          visible={restEditing != null}
          transparent
          animationType="slide"
          onRequestClose={() => setRestEditing(null)}>
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setRestEditing(null)}>
            <Pressable style={styles.sheet}>
              <View style={styles.sheetHeader}>
                <Pressable onPress={() => setRestEditing(null)}>
                  <Text style={styles.sheetCancel}>{tt('common', 'cancel')}</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>{tt('page', 'restTime')}</Text>
                <Pressable onPress={saveRest}>
                  <Text style={styles.sheetDone}>{tt('common', 'done')}</Text>
                </Pressable>
              </View>
              <View style={styles.restEditorRow}>
                <Pressable
                  onPress={() =>
                    setRestEditing(
                      restEditing
                        ? {
                            ...restEditing,
                            draft: Math.max(0, restEditing.draft - 15),
                          }
                        : null,
                    )
                  }
                  style={styles.restStepBtn}>
                  <Text style={styles.restStepBtnText}>−15s</Text>
                </Pressable>
                <View style={styles.restValueWrap}>
                  <TextInput
                    value={String(restEditing?.draft ?? 0)}
                    onChangeText={(t) => {
                      const cleaned = t.replace(/[^0-9]/g, '');
                      const parsed = cleaned === '' ? 0 : Number(cleaned);
                      setRestEditing(
                        restEditing ? { ...restEditing, draft: parsed } : null,
                      );
                    }}
                    keyboardType="number-pad"
                    selectTextOnFocus
                    style={styles.restValueInput}
                  />
                  <Text style={styles.restValueUnit}>秒</Text>
                </View>
                <Pressable
                  onPress={() =>
                    setRestEditing(
                      restEditing
                        ? { ...restEditing, draft: restEditing.draft + 15 }
                        : null,
                    )
                  }
                  style={styles.restStepBtn}>
                  <Text style={styles.restStepBtnText}>+15s</Text>
                </Pressable>
              </View>
              <Text style={styles.sheetFootnote}>
                {tt('status', 'restTimeFootnote')}
              </Text>
            </Pressable>
          </Pressable>
        </Modal>
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHr} />
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionHr} />
    </View>
  );
}

function computeExMeta(ex: TemplateExercise) {
  const clusterInfo = ex.sets.map((s) => {
    if (s.kind !== 'dropset') return { clusterSize: 0, isClusterLast: false };
    const headId =
      (s.parent_set_id ?? null) === null
        ? s.id
        : (s.parent_set_id as string);
    const members = ex.sets.filter(
      (x) =>
        x.kind === 'dropset' && (x.id === headId || x.parent_set_id === headId),
    );
    const lastMember = members[members.length - 1];
    return {
      clusterSize: members.length,
      isClusterLast: lastMember?.id === s.id,
    };
  });
  let workIdx = 0;
  let clusterIdx = 0;
  const setLabels = ex.sets.map((s) => {
    if (s.kind === 'warmup') return tt('domain', 'warmupChip');
    if (s.kind === 'dropset') {
      if ((s.parent_set_id ?? null) === null) {
        clusterIdx += 1;
        return `D${clusterIdx}`;
      }
      return '';
    }
    workIdx += 1;
    return String(workIdx);
  });
  return { clusterInfo, setLabels };
}

type ExerciseBodyProps = {
  exercise: TemplateExercise;
  expanded: boolean;
  onToggle: () => void;
  onUpdateSet: (set_id: string, patch: Partial<TemplateSet>) => void;
  onAddSet: () => void;
  onAddDropsetRow: (after_set_id: string) => void;
  onRemoveDropsetRow: (set_id: string) => void;
  onDeleteSet: (set_id: string) => void;
  onCloneSetAfter: (set_id: string) => void;
  onDeleteCluster: (head_set_id: string) => void;
  onAddClusterAfter: (head_set_id: string) => void;
  /**
   * overnight #45 第 3 點 — 長按 card header 開啟「排序動作」modal
   * (mirror session exercise-card pattern, app/(tabs)/index.tsx:2328).
   */
  onLongPressHeader: () => void;
  onShowHistory: () => void;
  onGearTap: () => void;
  onShowSetNote: (set: TemplateSet) => void;
  onShowExerciseNote: () => void;
  onCycleLabel: (set: TemplateSet) => void;
  /**
   * overnight #49 — set inline drag confirm. orderedGroupIds is the new
   * order of group heads (solo set id OR cluster head id); the helper in
   * `templateOps.reorderTemplateSetsByGroups` rebuilds the sets array so
   * dropset followers stay attached to their head as one contiguous group.
   */
  onConfirmReorderSets: (orderedGroupIds: string[]) => void;
  compact?: boolean;
};

function ExerciseBody({
  exercise,
  expanded,
  onToggle,
  onUpdateSet,
  onAddSet,
  onAddDropsetRow,
  onRemoveDropsetRow,
  onDeleteSet,
  onCloneSetAfter,
  onDeleteCluster,
  onAddClusterAfter,
  onLongPressHeader,
  onShowHistory,
  onGearTap,
  onShowSetNote,
  onShowExerciseNote,
  onCycleLabel,
  onConfirmReorderSets,
  compact,
}: ExerciseBodyProps) {
  // 「{warmup}熱+{working}組」— 對齊 wave 12 (2026-05-20) 的「1 chain = 1
  // unit」進度條規則：每個 working row 算 1 組、每條 dropset chain HEAD 算
  // 1 組、follower row 不另計（被 head 吸收）。pre-fix 用 `kind !== 'warmup'`
  // 把整 chain 的每個 row 都當 1 組計、4×3 chain 顯示「12組」實際只有 4 個
  // unit（用戶 reload 反映）。
  const warmups = exercise.sets.filter((s) => s.kind === 'warmup').length;
  const workings = exercise.sets.filter(
    (s) =>
      s.kind === 'working' ||
      (s.kind === 'dropset' && (s.parent_set_id ?? null) === null),
  ).length;
  const { setLabels } = computeExMeta(exercise);

  // overnight #49 — build groups for inline drag. A group = 1 solo set OR
  // 1 dropset cluster (head + N followers). Each group renders as ONE
  // draggable list item; followers never split from their head (cluster B3
  // invariant). The id used as the drag key is the group's head id
  // (= solo set id OR cluster head id) — same id space `reorderTemplateSetsByGroups`
  // consumes.
  interface SetGroup {
    headId: string;
    headIdx: number; // index of head row in exercise.sets
    head: TemplateSet;
    followers: TemplateSet[];
    followerIndices: number[]; // for setLabels[i] lookup
  }
  const groups: SetGroup[] = (() => {
    const out: SetGroup[] = [];
    let i = 0;
    while (i < exercise.sets.length) {
      const s = exercise.sets[i];
      const isDropset = s.kind === 'dropset';
      const isFollower =
        isDropset && (s.parent_set_id ?? null) !== null;
      const isHead = isDropset && !isFollower;
      if (isHead) {
        const followers: TemplateSet[] = [];
        const followerIndices: number[] = [];
        let j = i + 1;
        while (j < exercise.sets.length) {
          const next = exercise.sets[j];
          if (
            next.kind === 'dropset' &&
            next.parent_set_id === s.id
          ) {
            followers.push(next);
            followerIndices.push(j);
            j++;
          } else {
            break;
          }
        }
        out.push({
          headId: s.id,
          headIdx: i,
          head: s,
          followers,
          followerIndices,
        });
        i = j;
      } else if (isFollower) {
        // Orphan follower — should be unreachable. Treat as standalone so
        // we never silently drop a row.
        out.push({
          headId: s.id,
          headIdx: i,
          head: s,
          followers: [],
          followerIndices: [],
        });
        i++;
      } else {
        out.push({
          headId: s.id,
          headIdx: i,
          head: s,
          followers: [],
          followerIndices: [],
        });
        i++;
      }
    }
    return out;
  })();

  return (
    <>
      <View style={[styles.exHeader, compact && styles.exHeaderCompact]}>
        <Pressable
          onPress={onToggle}
          onLongPress={onLongPressHeader}
          delayLongPress={400}
          style={styles.exHeaderTapZone}
          hitSlop={4}>
          <Text
            style={[styles.exName, compact && styles.exNameCompact]}
            numberOfLines={1}>
            {exercise.name ?? '(動作)'}
          </Text>
          {exercise.notes && exercise.notes.trim().length > 0 ? (
            <Pressable
              onPress={onShowExerciseNote}
              style={styles.exNoteIndicator}
              hitSlop={8}>
              <Text style={styles.exNoteIndicatorText}>📝</Text>
            </Pressable>
          ) : null}
          <View style={styles.flexFill} />
          <Text style={styles.exSummary}>
            {warmups}熱+{workings}組
          </Text>
          {expanded ? <Text style={styles.exChevron}>▼</Text> : null}
        </Pressable>
        <Pressable onPress={onGearTap} style={styles.exGearBtn} hitSlop={8}>
          <Text style={styles.exGear}>⚙</Text>
        </Pressable>
      </View>
      {expanded ? (
        <View style={[styles.setsBox, compact && styles.setsBoxCompact]}>
          {groups.length === 0 ? null : (
            <NestableDraggableFlatList
              data={groups}
              keyExtractor={(g) => g.headId}
              activationDistance={20}
              onDragEnd={({ data }) => {
                const newIds = data.map((g) => g.headId);
                const oldIds = groups.map((g) => g.headId);
                const changed = newIds.some((id, idx) => id !== oldIds[idx]);
                if (changed) onConfirmReorderSets(newIds);
              }}
              renderItem={({
                item: g,
                drag,
                isActive,
              }: RenderItemParams<SetGroup>) => {
                const head = g.head;
                const isCluster =
                  head.kind === 'dropset' && head.parent_set_id === null;
                if (isCluster) {
                  const clusterSize = 1 + g.followers.length;
                  const swipeLeftActions: SwipeAction[] = [
                    {
                      key: 'delete-cluster',
                      label: '刪',
                      color: '#FF3B30',
                      onPress: () => onDeleteCluster(head.id),
                    },
                  ];
                  const swipeRightActions: SwipeAction[] = [
                    {
                      key: 'add-cluster',
                      label: '加',
                      color: '#34C759',
                      onPress: () => onAddClusterAfter(head.id),
                    },
                    {
                      key: 'note-cluster',
                      label: '備註',
                      color: '#007AFF',
                      onPress: () => onShowSetNote(head),
                    },
                  ];
                  return (
                    <SwipeableSetRow
                      swipeLeftActions={swipeLeftActions}
                      swipeRightActions={swipeRightActions}
                      onLongPress={drag}>
                      <View
                        style={[
                          styles.clusterStack,
                          isActive && styles.dragActiveRow,
                        ]}>
                        <SetRowContent
                          set={head}
                          setLabel={setLabels[g.headIdx]}
                          compact={compact}
                          isDropsetFollower={false}
                          isClusterLast={false}
                          minusDisabled={false}
                          onUpdateSet={onUpdateSet}
                          onShowSetNote={onShowSetNote}
                          onRemoveDropsetRow={onRemoveDropsetRow}
                          onAddDropsetRow={onAddDropsetRow}
                          onCycleLabel={onCycleLabel}
                        />
                        {g.followers.map((fset, fIdx) => (
                          <SetRowContent
                            key={fset.id}
                            set={fset}
                            setLabel={setLabels[g.followerIndices[fIdx]]}
                            compact={compact}
                            isDropsetFollower
                            isClusterLast={fIdx === g.followers.length - 1}
                            minusDisabled={clusterSize <= 2}
                            onUpdateSet={onUpdateSet}
                            onShowSetNote={onShowSetNote}
                            onRemoveDropsetRow={onRemoveDropsetRow}
                            onAddDropsetRow={onAddDropsetRow}
                            onCycleLabel={onCycleLabel}
                          />
                        ))}
                      </View>
                    </SwipeableSetRow>
                  );
                }
                const swipeLeftActions: SwipeAction[] = [
                  {
                    key: 'delete-set',
                    label: '刪',
                    color: '#FF3B30',
                    onPress: () => onDeleteSet(head.id),
                  },
                ];
                const swipeRightActions: SwipeAction[] = [
                  {
                    key: 'clone-set',
                    label: '加',
                    color: '#34C759',
                    onPress: () => onCloneSetAfter(head.id),
                  },
                  {
                    key: 'note',
                    label: '備註',
                    color: '#007AFF',
                    onPress: () => onShowSetNote(head),
                  },
                ];
                return (
                  <SwipeableSetRow
                    swipeLeftActions={swipeLeftActions}
                    swipeRightActions={swipeRightActions}
                    onLongPress={drag}>
                    <View
                      style={[
                        styles.setRowWrapper,
                        isActive && styles.dragActiveRow,
                      ]}>
                      <SetRowContent
                        set={head}
                        setLabel={setLabels[g.headIdx]}
                        compact={compact}
                        isDropsetFollower={false}
                        isClusterLast={false}
                        minusDisabled={false}
                        onUpdateSet={onUpdateSet}
                        onShowSetNote={onShowSetNote}
                        onRemoveDropsetRow={onRemoveDropsetRow}
                        onAddDropsetRow={onAddDropsetRow}
                        onCycleLabel={onCycleLabel}
                      />
                    </View>
                  </SwipeableSetRow>
                );
              }}
            />
          )}
          <View
            style={[
              styles.exFooterBtns,
              compact && styles.exFooterBtnsCompact,
            ]}>
            <Pressable
              onPress={onAddSet}
              style={[
                styles.exFooterBtn,
                compact && styles.exFooterBtnCompact,
              ]}>
              <Text
                style={[
                  styles.exFooterBtnText,
                  compact && styles.exFooterBtnTextCompact,
                ]}>
                {tt('button', 'addOneSet')}
              </Text>
            </Pressable>
            <Pressable
              onPress={onShowHistory}
              style={[
                styles.exFooterBtn,
                compact && styles.exFooterBtnCompact,
              ]}>
              <Text
                style={[
                  styles.exFooterBtnText,
                  compact && styles.exFooterBtnTextCompact,
                ]}>
                {tt('page', 'exerciseHistory')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  gestureRoot: { flex: 1 },
  container: { flex: 1 },
  flexFill: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyText: { fontSize: 15, color: '#6B7280' },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  backBtnText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },
  muted: { fontSize: 14, opacity: 0.6, padding: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
    gap: 8,
  },
  topBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  topBtnDisabled: { opacity: 0.4 },
  topBtnText: { fontSize: 15, color: '#007AFF' },
  topBtnTextDisabled: { color: '#9CA3AF' },
  topBtnSave: { fontWeight: '700' },
  topCenter: { flex: 1, gap: 4, alignItems: 'center' },
  // overnight #45 第 4 點 — name row: [swatch][nameInput] horizontal layout.
  // swatch 縮成 12px、靠左貼 nameInput；nameInput 仍 center-aligned 文字。
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameInput: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    minWidth: 140,
    paddingVertical: 2,
  },
  colorSwatch: { width: 14, height: 14, borderRadius: 7 },
  tripleText: { fontSize: 12, color: '#6b7280' },
  body: { padding: 12, gap: 8, paddingBottom: 80 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
    paddingTop: 12,
  },
  sectionHr: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D1D5DB',
  },
  sectionLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  emptySection: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
    paddingHorizontal: 12,
  },
  exCard: {
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    overflow: 'hidden',
  },
  supersetTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#5856D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  supersetNames: { flex: 1, fontSize: 15, fontWeight: '600' },
  // overnight #45 第 1 點 — cluster header mirror session layout (decoupled
  // styles, own copy). Row 1: tag (alignSelf flex-start). Row 2: 標題分行。
  clusterText: { flex: 1, gap: 4 },
  clusterTagRow: { flexDirection: 'row', alignItems: 'center' },
  clusterName: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  clusterPlus: { fontSize: 14, opacity: 0.5 },
  supersetColName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: 2,
  },
  exSuperRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // overnight #52 follow-up — cycle row wrapper (規格 B): paddingVertical 8 + gap 6
  // (撐爆 fine-tune)。與 session cluster-card `cycleRow` 對齊；column-header 用 exSuperRow。
  exSuperCycleRow: {
    paddingVertical: 8,
    gap: 6,
    alignItems: 'center',
  },
  // Shared `#` button — mirror session cluster-card.tsx::sharedLabelBtn (28×22 fs:11).
  // A+B 共用一個 label，tap 觸發 atomic A+B set_kind cycle (cycleSetKindAcrossExercises
  // 自動 mirror). 視覺對齊 set-row-content.tsx `setLabelBtnCompact`.
  exClusterSharedLabel: {
    width: 28,
    height: 22,
    borderRadius: 4,
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 2,
    borderTopColor: '#f3f4f6',
    borderLeftColor: '#d1d5db',
    borderRightColor: '#9ca3af',
    borderBottomColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    elevation: 2,
  },
  exClusterSharedLabelPressed: {
    backgroundColor: '#e5e7eb',
    borderTopWidth: 2,
    borderBottomWidth: 1,
    borderTopColor: '#6b7280',
    borderLeftColor: '#9ca3af',
    borderRightColor: '#d1d5db',
    borderBottomColor: '#f3f4f6',
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 1 }],
  },
  exClusterSharedLabelDisabled: {
    backgroundColor: 'transparent',
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  exClusterSharedLabelText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#374151',
  },
  // Column-header spacer matching shared `#` btn column width.
  exClusterSharedLabelSpacer: { width: 28 },
  exSuperCol: { flex: 1, minWidth: 0 },
  exSuperColWithLeftPad: { paddingLeft: 6 },
  exSuperDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(127,127,127,0.35)',
  },
  exHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  exHeaderCompact: { paddingHorizontal: 8, paddingVertical: 8, gap: 4 },
  exHeaderTapZone: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exName: { flexShrink: 1, fontSize: 15, fontWeight: '600' },
  exNameCompact: { fontSize: 13 },
  exSummary: { fontSize: 12, color: '#6B7280' },
  exChevron: { fontSize: 11, color: '#9CA3AF' },
  exGearBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  exGear: { fontSize: 16, color: '#9CA3AF' },
  setsBox: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    // overnight #52 — 規格 A: solo row 間距 gap 4→12（setsBox standard）
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
    paddingTop: 8,
  },
  // overnight #52 — 規格 B (cluster): cycle gap 4→8
  setsBoxCompact: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 6,
    gap: 8,
  },
  // overnight #52 — placeholder 配合 compact row 增高 (label 24 + padV 8×2 ≈ 40)
  setRowPlaceholder: { height: 40 },
  // overnight #52 — solo set row wrapper（line 2216 bare <View> 取代用）
  // 規格 A: paddingVertical 8（與 session exerciseCardSetRowWrapper 對齊）
  setRowWrapper: { paddingVertical: 8 },
  // dropset cluster head + followers 群組：spec A 內 paddingVertical 套在 wrapper、
  // 群組內 head/follower 不再加（避免雙重 padding 撐爆 cluster）。
  clusterStack: { gap: 4, paddingVertical: 8 },
  // overnight #49 follow-up — drag-active visual feedback for inline reorder
  // (set / cycle row 長按拖曳啟動時)。Mirror session 端
  // `exerciseCardSetRowDragActive` / `cycleRowDragActive` 模式，用戶要求「跟
  // session 一樣，長按可拖曳時變白色」。Background `#ffffff` 比 session 的
  // `#f3f4f6` 更白，因為 template editor cluster card 內已是淡彩色 tinted 底，
  // pure white 對比更明顯。
  dragActiveRow: {
    backgroundColor: '#ffffff',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    borderRadius: 8,
  },
  supersetRowNoteSlot: {
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Note: setRow / setLabelBtn{,Compact,Disabled,Pressed} / setLabelText{,Compact,Disabled} /
  // setInput{,Compact} / setUnit / setNoteIndicator / dropsetInlineBtn{,Text} /
  // dropsetTailBtn{Disabled,TextDisabled} now live in components/shared/set-row-content.tsx.
  // setNoteIndicatorText kept here because the cluster card render (line ~1379) still uses it
  // outside SetRowContent.
  setNoteIndicatorText: { fontSize: 14 },
  exNoteIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginRight: 4,
  },
  exNoteIndicatorText: { fontSize: 16 },
  dropsetInlineBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,149,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  dropsetInlineBtnText: { fontSize: 14, fontWeight: '700', color: '#FF9500' },
  dropsetTailBtnDisabled: { opacity: 0.35 },
  dropsetTailBtnTextDisabled: { color: '#9CA3AF' },
  exFooterBtns: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
  },
  supersetFooter: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
  },
  exFooterBtnsCompact: { marginTop: 6, paddingTop: 6, gap: 4 },
  exFooterBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(0,122,255,0.10)',
    alignItems: 'center',
  },
  exFooterBtnCompact: { paddingVertical: 4, paddingHorizontal: 4 },
  exFooterBtnText: { fontSize: 12, fontWeight: '600', color: '#007AFF' },
  exFooterBtnTextCompact: { fontSize: 10 },
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.12)',
    alignItems: 'center',
  },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    gap: 12,
    maxHeight: '80%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  sheetCancel: { fontSize: 15, color: '#007AFF' },
  sheetDone: { fontSize: 15, color: '#007AFF', fontWeight: '600' },
  noteInput: {
    minHeight: 96,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  restEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 12,
  },
  restStepBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(0,122,255,0.10)',
  },
  restStepBtnText: { fontSize: 15, fontWeight: '600', color: '#007AFF' },
  restValueWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    minWidth: 90,
    justifyContent: 'center',
  },
  restValue: { fontSize: 40, fontWeight: '700', color: '#111827' },
  restValueInput: {
    fontSize: 40,
    fontWeight: '700',
    color: '#111827',
    minWidth: 80,
    textAlign: 'center',
    paddingVertical: 0,
  },
  restValueUnit: { fontSize: 16, color: '#6B7280' },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    paddingVertical: 4,
  },
  paletteSwatch: {
    width: 64,
    height: 64,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteCheck: { color: '#fff', fontSize: 26, fontWeight: '700' },
  sheetFootnote: { fontSize: 11, color: '#6B7280', textAlign: 'center' },
  exercisePickerScroll: { maxHeight: 360 },
  exercisePickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.15)',
  },
  exercisePickerName: { fontSize: 15, fontWeight: '500' },
});

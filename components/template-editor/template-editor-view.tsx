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
  Stack,
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import { startSessionFromTemplate } from '@/src/adapters/sqlite/sessionFromTemplate';
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  applyRecolorSiblings,
  applyRenameSiblings,
  commitTemplateDraft,
  getTemplateFull,
  queryMemoryCandidates,
  queryReusableSupersetMemory,
} from '@/src/adapters/sqlite/templateRepository';
import {
  getReusableSupersetWithExercises,
  incrementUseCount,
} from '@/src/adapters/sqlite/supersetRepository';
import { explodeSupersetForTemplate } from '@/src/domain/superset/supersetManager';
import { cloneTemplate, templatesEqual } from '@/src/domain/template/templateDraft';
import { deriveLatestSetsForExercise } from '@/src/domain/template/templateMemory';
import { cycleSetKindAcrossExercises } from '@/src/domain/template/templateOps';
import { consumePick } from '@/src/domain/exercise/pickerBridge';
import type { Exercise } from '@/src/domain/exercise/types';
import type {
  ExerciseSection,
  Template,
  TemplateExercise,
  TemplateSet,
} from '@/src/domain/template/types';

import { PALETTE, hashColor } from './palette';
import { SetRowContent } from '../shared/set-row-content';
import { SwipeableSetRow, type SwipeAction } from '../shared/swipeable-set-row';

const SECTION_LABEL: Record<ExerciseSection, string> = {
  general: '一般動作',
  evergreen: '常設動作',
};

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();

  const [committed, setCommitted] = useState<Template | null>(null);
  const [draft, setDraft] = useState<Template | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const [expandedExId, setExpandedExId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [exerciseLibrary, setExerciseLibrary] = useState<Exercise[]>([]);
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) {
        setMissing(true);
        setLoaded(true);
        return;
      }
      try {
        const [tpl, lib] = await Promise.all([
          getTemplateFull(db, id),
          listExercises(db),
        ]);
        if (cancelled) return;
        if (!tpl) {
          setMissing(true);
          setLoaded(true);
          return;
        }
        setCommitted(tpl);
        setDraft(cloneTemplate(tpl));
        setExerciseLibrary(lib);
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
    Alert.alert('捨棄變更？', '尚未儲存的修改將會遺失。', [
      { text: '繼續編輯', style: 'cancel' },
      { text: '捨棄', style: 'destructive', onPress: onExit },
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

  const onSave = useCallback(async () => {
    if (!dirty || !draft || busy) return;
    setBusy(true);
    try {
      await persistDraft();
      // Re-hydrate to pick up DB-side timestamps / cascaded sibling changes.
      const refreshed = id ? await getTemplateFull(db, id) : null;
      if (refreshed) {
        setCommitted(refreshed);
        setDraft(cloneTemplate(refreshed));
      }
      Alert.alert('已儲存', '', [{ text: 'OK' }]);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [dirty, draft, busy, persistDraft, id, db]);

  const onStartSession = useCallback(async () => {
    if (!id || !draft || busy) return;
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          'Session already in progress',
          'End the current session in the Today tab before starting a new one.',
        );
        return;
      }
      if (draft.exercises.length === 0) {
        Alert.alert('Add at least one exercise before starting a session.');
        return;
      }
      if (dirty) {
        await persistDraft();
      }
      await startSessionFromTemplate(db, { template_id: id, uuid: randomUUID });
      router.replace('/');
    } catch (e) {
      Alert.alert('Start failed', e instanceof Error ? e.message : String(e));
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
            '無法刪除',
            'Dropset cluster 至少需要 2 組（head + 1 follower）。如要整組刪除，請左滑 cluster head。',
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

  const showReorderPlaceholder = () => {
    Alert.alert(
      '長按拖排序',
      '尚未實作（v1 ship 階段補）。',
    );
  };

  const showExerciseHistory = (ex: TemplateExercise) => {
    Alert.alert(
      `${ex.name ?? '(動作)'}· 動作歷史`,
      'production 會跳到動作歷史頁。slice 9.5 暫顯示對話框。',
    );
  };

  const showSupersetHistory = (parent: TemplateExercise, children: TemplateExercise[]) => {
    const names = [parent.name ?? '(動作)', ...children.map((c) => c.name ?? '(動作)')].join(' + ');
    Alert.alert(`${names} · 動作歷史`, 'production 整 superset 跨動作歷史。');
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
    Alert.alert(
      '確認刪除？',
      `將刪除「${ex.name ?? '(動作)'}」及其所有 sets。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
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
      ],
    );
  };

  const openGearMenu = (ex: TemplateExercise) => {
    // Reusable cluster lock (ADR-0016 amendment / slice 9.8b grill Q5):
    // rs_id NOT NULL → 動作組合鎖死, the only ⚙-menu actions are toggling
    // the section (cluster moves as a pair via existing groupHeadId logic)
    // and deleting the whole cluster. Notes / rest_seconds / 移動 are
    // intentionally hidden because they imply per-row mutation that breaks
    // the locked-pair invariant.
    if (ex.reusable_superset_id !== null) {
      const options = [
        ex.section === 'general' ? '設為常設運動' : '設為一般運動',
        '刪除',
        '取消',
      ];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: ex.name ?? undefined,
          options,
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
        },
        (idx) => {
          if (idx === 0) toggleSection(ex.id);
          else if (idx === 1) deleteExercise(ex);
        },
      );
      return;
    }

    const hasNotes = (ex.notes ?? '').trim().length > 0;
    const restLabel = `休息時間（${ex.rest_seconds ?? 90}s）`;
    const options = [
      hasNotes ? '編輯備註' : '新增備註',
      restLabel,
      '移動動作',
      ex.section === 'general' ? '設為常設運動' : '設為一般運動',
      '刪除',
      '取消',
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
        else if (idx === 2)
          Alert.alert('移動動作', '尚未實作（v1 ship 階段補）。');
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

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }
  if (missing || !draft || !committed) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>找不到此 template</Text>
          <Pressable style={styles.backBtn} onPress={onExit}>
            <Text style={styles.backBtnText}>‹ 返回</Text>
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
              onLongPressRow={showReorderPlaceholder}
              onShowHistory={() => showExerciseHistory(parent)}
              onGearTap={() => openGearMenu(parent)}
              onShowSetNote={(set) => openSetNoteEditor(parent.id, set)}
              onShowExerciseNote={() => openExerciseNoteEditor(parent)}
              onCycleLabel={(s) => cycleSetKind(parent.id, s.id)}
            />
          </View>
        );
      }
      const isExpanded = expandedExId === parent.id;
      const allNames = [parent.name ?? '(動作)', ...children.map((c) => c.name ?? '(動作)')].join(' + ');
      return (
        <View key={parent.id} style={styles.exCard}>
          <View style={styles.exHeader}>
            <Pressable
              onPress={() => toggleExpanded(parent.id)}
              style={styles.exHeaderTapZone}
              hitSlop={4}>
              <Text style={styles.supersetTag}>超級組</Text>
              <Text style={styles.supersetNames} numberOfLines={2}>
                {allNames}
              </Text>
              <View style={styles.flexFill} />
              {isExpanded ? <Text style={styles.exChevron}>▼</Text> : null}
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
              <View style={styles.exSuperRow}>
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
                  const parentMeta = computeExMeta(parent);
                  const childMetas = children.map((c) => computeExMeta(c));
                  const maxSets = Math.max(
                    parent.sets.length,
                    ...children.map((c) => c.sets.length),
                  );
                  const childIds = children.map((c) => c.id);
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
                  return Array.from({ length: maxSets }, (_, i) => {
                    const parentSet = parent.sets[i];
                    const rowHasNote = !!(
                      parentSet?.notes && parentSet.notes.trim().length > 0
                    );
                    return (
                      <SwipeableSetRow
                        key={i}
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
                        onLongPress={showReorderPlaceholder}>
                        <View style={styles.exSuperRow}>
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
                  });
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
                  <Text style={styles.exFooterBtnText}>新增 1 組</Text>
                </Pressable>
                <Pressable
                  onPress={() => showSupersetHistory(parent, children)}
                  style={styles.exFooterBtn}>
                  <Text style={styles.exFooterBtnText}>動作歷史</Text>
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
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} style={styles.topBtn}>
            <Text style={styles.topBtnText}>取消</Text>
          </Pressable>
          <View style={styles.topCenter}>
            <TextInput
              value={draft.name}
              onChangeText={updateName}
              style={styles.nameInput}
              placeholder="Template 名稱"
            />
            <View style={styles.metaRow}>
              <Pressable
                onPress={() => setShowColorPicker(true)}
                style={[
                  styles.colorSwatch,
                  { backgroundColor: colorForTemplate(draft) },
                ]}
              />
              <Text style={styles.metaText}>per name 配色（同名連動）</Text>
            </View>
          </View>
          <Pressable
            onPress={onSave}
            disabled={!dirty || busy}
            style={[styles.topBtn, (!dirty || busy) && styles.topBtnDisabled]}>
            <Text
              style={[
                styles.topBtnText,
                (!dirty || busy) && styles.topBtnTextDisabled,
                styles.topBtnSave,
              ]}>
              {busy ? '...' : '儲存'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <SectionHeader label={SECTION_LABEL.general} />
          {renderSection('general', '（無一般動作）')}

          <SectionHeader label={SECTION_LABEL.evergreen} />
          {renderSection('evergreen', '（無常設動作）')}
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            style={styles.actionBtn}
            onPress={() => router.push('/exercise-picker?mode=picker')}>
            <Text style={styles.actionBtnText}>+ 動作</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={onStartSession}
            disabled={busy}>
            <Text style={styles.actionBtnText}>開始訓練</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={() => setShowColorPicker(true)}>
            <Text style={styles.actionBtnText}>配色</Text>
          </Pressable>
          <Pressable
            style={styles.actionBtn}
            onPress={() =>
              ActionSheetIOS.showActionSheetWithOptions(
                {
                  title: draft.name,
                  options: ['另存模板', '刪除模板', '取消'],
                  destructiveButtonIndex: 1,
                  cancelButtonIndex: 2,
                },
                (idx) => {
                  if (idx === 0)
                    Alert.alert(
                      '另存模板',
                      'production 補齊三元組 UI（ADR-0014）。slice 9.5 暫不實作。',
                    );
                  else if (idx === 1)
                    Alert.alert(
                      '刪除模板',
                      '請從 Templates list 進入 swipe-to-delete（slice 9.5 暫不實作 inline 刪除）。',
                    );
                },
              )
            }>
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
                <Text style={styles.sheetTitle}>選擇配色</Text>
                <Pressable onPress={() => setShowColorPicker(false)}>
                  <Text style={styles.sheetDone}>完成</Text>
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
                選色後會 group-wide 連動所有同 name sibling templates。
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
                <Text style={styles.sheetTitle}>選擇動作</Text>
                <Pressable onPress={() => setShowExercisePicker(false)}>
                  <Text style={styles.sheetCancel}>取消</Text>
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
                點選動作即加入「一般動作區」；用 ⚙「設為常設」改類別。
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
                  <Text style={styles.sheetCancel}>取消</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>備註</Text>
                <Pressable onPress={saveNote}>
                  <Text style={styles.sheetDone}>完成</Text>
                </Pressable>
              </View>
              <TextInput
                value={noteEditing?.draft ?? ''}
                onChangeText={(t) =>
                  setNoteEditing(
                    noteEditing ? { ...noteEditing, draft: t } : null,
                  )
                }
                placeholder="提示、cue、注意事項…"
                multiline
                autoFocus
                style={styles.noteInput}
              />
              <Text style={styles.sheetFootnote}>
                備註用於記錄動作 cue / 注意事項。
              </Text>
            </Pressable>
          </Pressable>
        </Modal>

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
                  <Text style={styles.sheetCancel}>取消</Text>
                </Pressable>
                <Text style={styles.sheetTitle}>休息時間</Text>
                <Pressable onPress={saveRest}>
                  <Text style={styles.sheetDone}>完成</Text>
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
                Session 對此動作 set ✓ 後自動跳此秒數倒數。
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
    if (s.kind === 'warmup') return '熱';
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
  onLongPressRow: () => void;
  onShowHistory: () => void;
  onGearTap: () => void;
  onShowSetNote: (set: TemplateSet) => void;
  onShowExerciseNote: () => void;
  onCycleLabel: (set: TemplateSet) => void;
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
  onLongPressRow,
  onShowHistory,
  onGearTap,
  onShowSetNote,
  onShowExerciseNote,
  onCycleLabel,
  compact,
}: ExerciseBodyProps) {
  const warmups = exercise.sets.filter((s) => s.kind === 'warmup').length;
  const workings = exercise.sets.filter((s) => s.kind !== 'warmup').length;
  const { setLabels } = computeExMeta(exercise);

  return (
    <>
      <View style={[styles.exHeader, compact && styles.exHeaderCompact]}>
        <Pressable
          onPress={onToggle}
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
          {(() => {
            const items: React.ReactNode[] = [];
            let i = 0;
            while (i < exercise.sets.length) {
              const s = exercise.sets[i];
              const isDropset = s.kind === 'dropset';
              const isFollower =
                isDropset && (s.parent_set_id ?? null) !== null;
              const isHead = isDropset && !isFollower;

              if (isHead) {
                const headIdx = i;
                const followerIndices: number[] = [];
                let j = i + 1;
                while (j < exercise.sets.length) {
                  const next = exercise.sets[j];
                  if (
                    next.kind === 'dropset' &&
                    next.parent_set_id === s.id
                  ) {
                    followerIndices.push(j);
                    j++;
                  } else {
                    break;
                  }
                }
                const clusterSize = 1 + followerIndices.length;
                const swipeLeftActions: SwipeAction[] = [
                  {
                    key: 'delete-cluster',
                    label: '刪',
                    color: '#FF3B30',
                    onPress: () => onDeleteCluster(s.id),
                  },
                ];
                const swipeRightActions: SwipeAction[] = [
                  {
                    key: 'add-cluster',
                    label: '加',
                    color: '#34C759',
                    onPress: () => onAddClusterAfter(s.id),
                  },
                  {
                    key: 'note-cluster',
                    label: '備註',
                    color: '#007AFF',
                    onPress: () => onShowSetNote(s),
                  },
                ];
                items.push(
                  <SwipeableSetRow
                    key={s.id}
                    swipeLeftActions={swipeLeftActions}
                    swipeRightActions={swipeRightActions}
                    onLongPress={onLongPressRow}>
                    <View style={styles.clusterStack}>
                      <SetRowContent
                        set={s}
                        setLabel={setLabels[headIdx]}
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
                      {followerIndices.map((fi, fIdx) => {
                        const fset = exercise.sets[fi];
                        return (
                          <SetRowContent
                            key={fset.id}
                            set={fset}
                            setLabel={setLabels[fi]}
                            compact={compact}
                            isDropsetFollower
                            isClusterLast={fIdx === followerIndices.length - 1}
                            minusDisabled={clusterSize <= 2}
                            onUpdateSet={onUpdateSet}
                            onShowSetNote={onShowSetNote}
                            onRemoveDropsetRow={onRemoveDropsetRow}
                            onAddDropsetRow={onAddDropsetRow}
                            onCycleLabel={onCycleLabel}
                          />
                        );
                      })}
                    </View>
                  </SwipeableSetRow>,
                );
                i = j;
              } else if (isFollower) {
                items.push(
                  <SetRowContent
                    key={s.id}
                    set={s}
                    setLabel={setLabels[i]}
                    compact={compact}
                    isDropsetFollower
                    isClusterLast
                    minusDisabled
                    onUpdateSet={onUpdateSet}
                    onShowSetNote={onShowSetNote}
                    onRemoveDropsetRow={onRemoveDropsetRow}
                    onAddDropsetRow={onAddDropsetRow}
                    onCycleLabel={onCycleLabel}
                  />,
                );
                i++;
              } else {
                const swipeLeftActions: SwipeAction[] = [
                  {
                    key: 'delete-set',
                    label: '刪',
                    color: '#FF3B30',
                    onPress: () => onDeleteSet(s.id),
                  },
                ];
                const swipeRightActions: SwipeAction[] = [
                  {
                    key: 'clone-set',
                    label: '加',
                    color: '#34C759',
                    onPress: () => onCloneSetAfter(s.id),
                  },
                  {
                    key: 'note',
                    label: '備註',
                    color: '#007AFF',
                    onPress: () => onShowSetNote(s),
                  },
                ];
                items.push(
                  <SwipeableSetRow
                    key={s.id}
                    swipeLeftActions={swipeLeftActions}
                    swipeRightActions={swipeRightActions}
                    onLongPress={onLongPressRow}>
                    <SetRowContent
                      set={s}
                      setLabel={setLabels[i]}
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
                  </SwipeableSetRow>,
                );
                i++;
              }
            }
            return items;
          })()}
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
                新增 1 組
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
                動作歷史
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
  nameInput: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    minWidth: 140,
    paddingVertical: 2,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  colorSwatch: { width: 14, height: 14, borderRadius: 7 },
  metaText: { fontSize: 11, color: '#6B7280' },
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
  },
  supersetNames: { flex: 1, fontSize: 15, fontWeight: '600' },
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
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
    paddingTop: 8,
  },
  setsBoxCompact: { paddingHorizontal: 8, paddingBottom: 8, paddingTop: 6 },
  setRowPlaceholder: { height: 32 },
  clusterStack: { gap: 4 },
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

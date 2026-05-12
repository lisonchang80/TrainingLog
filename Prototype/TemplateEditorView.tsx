import { Fragment, useMemo, useState } from 'react';
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

import {
  PALETTE,
  useMockStore,
  type Template,
  type TemplateExercise,
  type TemplateSet,
} from './MockTrainingStore';
import { SwipeableSetRow, type SwipeAction } from './SwipeableSetRow';

type TemplateEditorViewProps = {
  template_id: string;
  onExit: () => void;
};

function cloneTemplate(t: Template): Template {
  return {
    ...t,
    exercises: t.exercises.map((ex) => ({
      ...ex,
      sets: ex.sets.map((s) => ({ ...s })),
    })),
  };
}

function setsEqual(a: TemplateSet[], b: TemplateSet[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.position !== y.position ||
      x.kind !== y.kind ||
      x.reps !== y.reps ||
      x.weight !== y.weight ||
      (x.parent_set_id ?? null) !== (y.parent_set_id ?? null) ||
      (x.notes ?? '') !== (y.notes ?? '')
    ) {
      return false;
    }
  }
  return true;
}

function exercisesEqual(a: TemplateExercise[], b: TemplateExercise[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.position !== y.position ||
      x.section !== y.section ||
      x.parent_id !== y.parent_id ||
      (x.notes ?? '') !== (y.notes ?? '') ||
      (x.rest_seconds ?? 0) !== (y.rest_seconds ?? 0) ||
      !setsEqual(x.sets, y.sets)
    ) {
      return false;
    }
  }
  return true;
}

function templatesEqual(a: Template, b: Template): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.color_hex === b.color_hex &&
    exercisesEqual(a.exercises, b.exercises)
  );
}

export function TemplateEditorView({ template_id, onExit }: TemplateEditorViewProps) {
  const store = useMockStore();
  const committed = store.templateById(template_id);

  const [draft, setDraft] = useState<Template | null>(
    committed ? cloneTemplate(committed) : null,
  );
  const [expandedExId, setExpandedExId] = useState<string | null>(null);
  const [showColorPicker, setShowColorPicker] = useState(false);
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

  const dirty = useMemo(() => {
    if (!draft || !committed) return false;
    return !templatesEqual(draft, committed);
  }, [draft, committed]);

  if (!draft || !committed) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>找不到此 template</Text>
        <Pressable style={styles.backBtn} onPress={onExit}>
          <Text style={styles.backBtnText}>‹ 返回</Text>
        </Pressable>
      </View>
    );
  }

  const onCancel = () => {
    if (!dirty) {
      onExit();
      return;
    }
    Alert.alert('捨棄變更？', '尚未儲存的修改將會遺失。', [
      { text: '繼續編輯', style: 'cancel' },
      {
        text: '捨棄',
        style: 'destructive',
        onPress: () => {
          store.discardTemplateDraft();
          onExit();
        },
      },
    ]);
  };

  const onSave = () => {
    if (!dirty) return;
    store.saveTemplateDraft(draft);
    if (draft.color_hex !== committed.color_hex) {
      store.recolorTemplate(draft.name, draft.color_hex);
    }
    Alert.alert('已儲存', '本 prototype 已 commit draft 到 mock store。', [
      { text: 'OK', onPress: onExit },
    ]);
  };

  const updateName = (name: string) => setDraft({ ...draft, name });

  const updateColor = (color_hex: string) => {
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
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) =>
        ex.id !== ex_id
          ? ex
          : {
              ...ex,
              sets: ex.sets.map((s) => (s.id !== set_id ? s : { ...s, ...patch })),
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

  const addSet = (ex_id: string) => {
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const nextPos =
          ex.sets.length === 0 ? 0 : Math.max(...ex.sets.map((s) => s.position)) + 1;
        const baseTs = Date.now();

        if (last?.kind === 'dropset') {
          const headIdx = findTrailingClusterHeadIdx(ex.sets);
          if (headIdx === -1) return ex;
          const cluster = ex.sets.slice(headIdx);
          const newHeadId = `${ex.id}-c-${baseTs}-0`;
          const cloned: TemplateSet[] = cluster.map((s, idx) => ({
            id: idx === 0 ? newHeadId : `${ex.id}-c-${baseTs}-${idx}`,
            position: nextPos + idx,
            kind: s.kind,
            reps: s.reps,
            weight: s.weight,
            parent_set_id: idx === 0 ? null : newHeadId,
          }));
          return { ...ex, sets: [...ex.sets, ...cloned] };
        }

        const newSet: TemplateSet = {
          id: `${ex.id}-s-${baseTs}`,
          position: nextPos,
          kind: last?.kind ?? 'working',
          reps: last?.reps ?? 8,
          weight: last?.weight ?? 20,
          parent_set_id: null,
        };
        return { ...ex, sets: [...ex.sets, newSet] };
      }),
    });
  };

  const addDropsetRow = (ex_id: string, after_set_id: string) => {
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
          id: `${ex.id}-d-${Date.now()}`,
          position: 0,
          kind: 'dropset',
          reps: afterSet.reps,
          weight: afterSet.weight,
          parent_set_id: headId,
        };
        const inserted = [
          ...ex.sets.slice(0, afterIdx + 1),
          newSet,
          ...ex.sets.slice(afterIdx + 1),
        ].map((s, idx) => ({ ...s, position: idx }));
        return { ...ex, sets: inserted };
      }),
    });
  };

  const removeDropsetRow = (ex_id: string, set_id: string) => {
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
        const filtered = ex.sets
          .filter((s) => s.id !== set_id)
          .map((s, idx) => ({ ...s, position: idx }));
        return { ...ex, sets: filtered };
      }),
    });
  };

  const deleteSet = (ex_id: string, set_id: string) => {
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const filtered = ex.sets
          .filter((s) => s.id !== set_id)
          .map((s, idx) => ({ ...s, position: idx }));
        return { ...ex, sets: filtered };
      }),
    });
  };

  const deleteCluster = (ex_id: string, head_set_id: string) => {
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const filtered = ex.sets
          .filter(
            (s) =>
              s.id !== head_set_id && (s.parent_set_id ?? null) !== head_set_id,
          )
          .map((s, idx) => ({ ...s, position: idx }));
        return { ...ex, sets: filtered };
      }),
    });
  };

  const cloneSetAfter = (ex_id: string, set_id: string) => {
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        const idx = ex.sets.findIndex((s) => s.id === set_id);
        if (idx === -1) return ex;
        const src = ex.sets[idx];
        const newSet: TemplateSet = {
          id: `${ex.id}-s-${Date.now()}`,
          position: 0,
          kind: src.kind,
          reps: src.reps,
          weight: src.weight,
          parent_set_id: null,
        };
        const inserted = [
          ...ex.sets.slice(0, idx + 1),
          newSet,
          ...ex.sets.slice(idx + 1),
        ].map((s, i) => ({ ...s, position: i }));
        return { ...ex, sets: inserted };
      }),
    });
  };

  const addClusterAfter = (ex_id: string, head_set_id: string) => {
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id !== ex_id) return ex;
        // Find the last index belonging to the cluster anchored on head_set_id.
        let clusterEndIdx = -1;
        ex.sets.forEach((s, i) => {
          if (s.id === head_set_id || s.parent_set_id === head_set_id) {
            clusterEndIdx = i;
          }
        });
        if (clusterEndIdx === -1) return ex;
        const headRef = ex.sets.find((s) => s.id === head_set_id);
        if (!headRef) return ex;
        const baseTs = Date.now();
        const newHeadId = `${ex.id}-c-${baseTs}-0`;
        const newHead: TemplateSet = {
          id: newHeadId,
          position: 0,
          kind: 'dropset',
          reps: headRef.reps,
          weight: headRef.weight,
          parent_set_id: null,
        };
        const newFollower: TemplateSet = {
          id: `${ex.id}-c-${baseTs}-1`,
          position: 0,
          kind: 'dropset',
          reps: headRef.reps,
          weight: headRef.weight,
          parent_set_id: newHeadId,
        };
        const inserted = [
          ...ex.sets.slice(0, clusterEndIdx + 1),
          newHead,
          newFollower,
          ...ex.sets.slice(clusterEndIdx + 1),
        ].map((s, i) => ({ ...s, position: i }));
        return { ...ex, sets: inserted };
      }),
    });
  };

  const showReorderPlaceholder = () => {
    Alert.alert(
      '待實作 reorder',
      '長按拖排序尚未實作（沒裝 reorder library），v1 ship 階段補。',
    );
  };

  const showExerciseHistory = (ex: TemplateExercise) => {
    Alert.alert(
      `${ex.name} · 動作歷史`,
      'prototype 略 — production 會顯示此動作跨 sessions/templates 的最近紀錄、PR、E1RM 趨勢圖。',
    );
  };

  const addSetToSuperset = (parent_id: string, child_ids: string[]) => {
    const ids = new Set([parent_id, ...child_ids]);
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (!ids.has(ex.id)) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const nextPos =
          ex.sets.length === 0 ? 0 : Math.max(...ex.sets.map((s) => s.position)) + 1;
        const baseTs = Date.now();
        if (last?.kind === 'dropset') {
          const headIdx = findTrailingClusterHeadIdx(ex.sets);
          if (headIdx === -1) return ex;
          const cluster = ex.sets.slice(headIdx);
          const newHeadId = `${ex.id}-c-${baseTs}-0`;
          const cloned: TemplateSet[] = cluster.map((s, idx) => ({
            id: idx === 0 ? newHeadId : `${ex.id}-c-${baseTs}-${idx}`,
            position: nextPos + idx,
            kind: s.kind,
            reps: s.reps,
            weight: s.weight,
            parent_set_id: idx === 0 ? null : newHeadId,
          }));
          return { ...ex, sets: [...ex.sets, ...cloned] };
        }
        const newSet: TemplateSet = {
          id: `${ex.id}-s-${baseTs}`,
          position: nextPos,
          kind: last?.kind ?? 'working',
          reps: last?.reps ?? 8,
          weight: last?.weight ?? 20,
          parent_set_id: null,
        };
        return { ...ex, sets: [...ex.sets, newSet] };
      }),
    });
  };

  const showSupersetHistory = (
    parent: TemplateExercise,
    children: TemplateExercise[],
  ) => {
    const names = [parent.name, ...children.map((c) => c.name)].join(' + ');
    Alert.alert(
      `${names} · 動作歷史`,
      'prototype 略 — production 會顯示此超級組（cluster of exercises）的最近紀錄。',
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
    if (noteEditing == null) return;
    const { target, draft: noteText } = noteEditing;
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (target.kind === 'exercise') {
          if (ex.id !== target.ex_id) return ex;
          return { ...ex, notes: noteText };
        }
        if (ex.id !== target.ex_id) return ex;
        return {
          ...ex,
          sets: ex.sets.map((s) =>
            s.id !== target.set_id ? s : { ...s, notes: noteText },
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
    if (restEditing == null) return;
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
    const flip = (s: '一般' | '常設動作'): '一般' | '常設動作' =>
      s === '一般' ? '常設動作' : '一般';
    setDraft({
      ...draft,
      exercises: draft.exercises.map((ex) => {
        if (ex.id === ex_id || ex.parent_id === ex_id) {
          return { ...ex, section: flip(ex.section) };
        }
        return ex;
      }),
    });
  };

  const deleteExercise = (ex: TemplateExercise) => {
    Alert.alert('確認刪除？', `將刪除「${ex.name}」及其所有 sets。`, [
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
    ]);
  };

  const openGearMenu = (ex: TemplateExercise) => {
    const hasNotes = (ex.notes ?? '').trim().length > 0;
    const restLabel = `休息時間（${ex.rest_seconds ?? 90}s）`;
    const options = [
      hasNotes ? '編輯備註' : '新增備註',
      restLabel,
      '移動動作',
      ex.section === '一般' ? '設為常設運動' : '設為一般運動',
      '刪除',
      '取消',
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: ex.name,
        options,
        destructiveButtonIndex: 4,
        cancelButtonIndex: 5,
      },
      (idx) => {
        if (idx === 0) openExerciseNoteEditor(ex);
        else if (idx === 1) openRestEditor(ex);
        else if (idx === 2)
          Alert.alert(
            '移動動作',
            'prototype 略 — production 進 ADR-0013 重排列表畫面（拖排序 + 跨 section 邊界改類型）。',
          );
        else if (idx === 3) toggleSection(ex.id);
        else if (idx === 4) deleteExercise(ex);
      },
    );
  };

  const addExercise = (section: '一般' | '常設動作') => {
    const newId = `ex-draft-${Date.now()}`;
    const nextPos =
      draft.exercises.length === 0
        ? 0
        : Math.max(...draft.exercises.map((e) => e.position)) + 1;
    const newEx: TemplateExercise = {
      id: newId,
      name: '新動作',
      position: nextPos,
      section,
      parent_id: null,
      sets: [
        {
          id: `${newId}-s1`,
          position: 0,
          kind: 'working',
          reps: 10,
          weight: 20,
        },
      ],
    };
    setDraft({ ...draft, exercises: [...draft.exercises, newEx] });
    setExpandedExId(newId);
  };

  const renderSection = (section: '一般' | '常設動作', emptyText: string) => {
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
              onUpdateSet={(set_id, patch) => updateSet(parent.id, set_id, patch)}
              onAddSet={() => addSet(parent.id)}
              onAddDropsetRow={(set_id) => addDropsetRow(parent.id, set_id)}
              onRemoveDropsetRow={(set_id) => removeDropsetRow(parent.id, set_id)}
              onDeleteSet={(set_id) => deleteSet(parent.id, set_id)}
              onCloneSetAfter={(set_id) => cloneSetAfter(parent.id, set_id)}
              onDeleteCluster={(head_id) => deleteCluster(parent.id, head_id)}
              onAddClusterAfter={(head_id) => addClusterAfter(parent.id, head_id)}
              onLongPressRow={showReorderPlaceholder}
              onShowHistory={() => showExerciseHistory(parent)}
              onGearTap={() => openGearMenu(parent)}
              onShowSetNote={(set) => openSetNoteEditor(parent.id, set)}
            />
          </View>
        );
      }
      const isExpanded = expandedExId === parent.id;
      const allNames = [parent.name, ...children.map((c) => c.name)].join(' + ');
      return (
        <View key={parent.id} style={styles.exCard}>
          <View style={styles.exHeader}>
            <Pressable
              onPress={() => toggleExpanded(parent.id)}
              style={styles.exHeaderTapZone}
              hitSlop={4}>
              <Text style={styles.supersetTag}>超級組</Text>
              <Text style={styles.supersetNames} numberOfLines={1}>
                {allNames}
              </Text>
              {isExpanded ? <Text style={styles.exChevron}>▼</Text> : null}
            </Pressable>
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
                    {parent.name}
                  </Text>
                  <ExerciseBody
                    exercise={parent}
                    expanded
                    onToggle={() => toggleExpanded(parent.id)}
                    onUpdateSet={(set_id, patch) => updateSet(parent.id, set_id, patch)}
                    onAddSet={() => addSet(parent.id)}
                    onAddDropsetRow={(set_id) => addDropsetRow(parent.id, set_id)}
                    onRemoveDropsetRow={(set_id) => removeDropsetRow(parent.id, set_id)}
                    onDeleteSet={(set_id) => deleteSet(parent.id, set_id)}
                    onCloneSetAfter={(set_id) => cloneSetAfter(parent.id, set_id)}
                    onDeleteCluster={(head_id) => deleteCluster(parent.id, head_id)}
                    onAddClusterAfter={(head_id) => addClusterAfter(parent.id, head_id)}
                    onLongPressRow={showReorderPlaceholder}
                    onShowHistory={() => showExerciseHistory(parent)}
                    onGearTap={() => openGearMenu(parent)}
                    onShowSetNote={(set) => openSetNoteEditor(parent.id, set)}
                    compact
                    hideHeader
                    hideFooterBtns
                  />
                </View>
                {children.map((child) => (
                  <Fragment key={child.id}>
                    <View style={styles.exSuperDivider} />
                    <View style={[styles.exSuperCol, styles.exSuperColWithLeftPad]}>
                      <Text style={styles.supersetColName} numberOfLines={1}>
                        {child.name}
                      </Text>
                      <ExerciseBody
                        exercise={child}
                        expanded
                        onToggle={() => toggleExpanded(parent.id)}
                        onUpdateSet={(set_id, patch) => updateSet(child.id, set_id, patch)}
                        onAddSet={() => addSet(child.id)}
                        onAddDropsetRow={(set_id) => addDropsetRow(child.id, set_id)}
                        onRemoveDropsetRow={(set_id) => removeDropsetRow(child.id, set_id)}
                        onDeleteSet={(set_id) => deleteSet(child.id, set_id)}
                        onCloneSetAfter={(set_id) => cloneSetAfter(child.id, set_id)}
                        onDeleteCluster={(head_id) => deleteCluster(child.id, head_id)}
                        onAddClusterAfter={(head_id) => addClusterAfter(child.id, head_id)}
                        onLongPressRow={showReorderPlaceholder}
                        onShowHistory={() => showExerciseHistory(child)}
                        onGearTap={() => openGearMenu(child)}
                        onShowSetNote={(set) => openSetNoteEditor(child.id, set)}
                        compact
                        hideHeader
                        hideFooterBtns
                      />
                    </View>
                  </Fragment>
                ))}
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
    <View style={styles.container}>
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
              style={[styles.colorSwatch, { backgroundColor: draft.color_hex }]}
            />
            <Text style={styles.metaText}>per Template name 顏色 (group-wide)</Text>
          </View>
        </View>
        <Pressable
          onPress={onSave}
          disabled={!dirty}
          style={[styles.topBtn, !dirty && styles.topBtnDisabled]}>
          <Text style={[styles.topBtnText, !dirty && styles.topBtnTextDisabled, styles.topBtnSave]}>
            儲存
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <SectionHeader label="一般動作" />
        {renderSection('一般', '（無一般動作）')}

        <SectionHeader label="常設動作" />
        {renderSection('常設動作', '（無常設動作）')}
      </ScrollView>

      <View style={styles.actionBar}>
        <Pressable style={styles.actionBtn} onPress={() => addExercise('一般')}>
          <Text style={styles.actionBtnText}>+ 動作</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() =>
            Alert.alert(
              '開始訓練',
              'prototype 略 — production 會把 draft commit → atomic op 啟動 session（ADR-0016 ⋯ 更多 → 開始訓練 原規格）。',
            )
          }>
          <Text style={styles.actionBtnText}>開始訓練</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => setShowColorPicker(true)}>
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
                    'prototype 略 — production 補齊三元組 UI（ADR-0014）。',
                  );
                else if (idx === 1)
                  Alert.alert('刪除模板', '此 prototype 不實際 delete Template。');
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
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowColorPicker(false)}>
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
                    style={[styles.paletteSwatch, { backgroundColor: color }]}>
                    {selected ? <Text style={styles.paletteCheck}>✓</Text> : null}
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
                setNoteEditing(noteEditing ? { ...noteEditing, draft: t } : null)
              }
              placeholder="提示、cue、注意事項…"
              multiline
              autoFocus
              style={styles.noteInput}
            />
            <Text style={styles.sheetFootnote}>
              備註用於記錄動作 cue / 注意事項，累積使用。
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
                      ? { ...restEditing, draft: Math.max(0, restEditing.draft - 15) }
                      : null,
                  )
                }
                style={styles.restStepBtn}>
                <Text style={styles.restStepBtnText}>−15s</Text>
              </Pressable>
              <View style={styles.restValueWrap}>
                <Text style={styles.restValue}>{restEditing?.draft ?? 0}</Text>
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
    </View>
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
  compact,
  hideHeader,
  hideFooterBtns,
}: {
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
  compact?: boolean;
  hideHeader?: boolean;
  hideFooterBtns?: boolean;
}) {
  const warmups = exercise.sets.filter((s) => s.kind === 'warmup').length;
  const workings = exercise.sets.filter((s) => s.kind !== 'warmup').length;

  const clusterInfo = exercise.sets.map((s, i) => {
    if (s.kind !== 'dropset') return { clusterSize: 0, isClusterLast: false };
    const headId =
      (s.parent_set_id ?? null) === null
        ? s.id
        : (s.parent_set_id as string);
    const members = exercise.sets.filter(
      (x) =>
        x.kind === 'dropset' && (x.id === headId || x.parent_set_id === headId),
    );
    let isClusterLast = true;
    for (let j = i + 1; j < exercise.sets.length; j++) {
      const next = exercise.sets[j];
      if (
        next.kind === 'dropset' &&
        (next.id === headId || next.parent_set_id === headId)
      ) {
        isClusterLast = false;
        break;
      }
    }
    return { clusterSize: members.length, isClusterLast };
  });

  let workIdx = 0;
  let clusterIdx = 0;
  const setLabels = exercise.sets.map((s) => {
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

  return (
    <>
      {!hideHeader ? (
        <View style={[styles.exHeader, compact && styles.exHeaderCompact]}>
          <Pressable
            onPress={onToggle}
            style={styles.exHeaderTapZone}
            hitSlop={4}>
            <Text
              style={[styles.exName, compact && styles.exNameCompact]}
              numberOfLines={1}>
              {exercise.name}
            </Text>
            <Text style={styles.exSummary}>
              {warmups}熱+{workings}組
            </Text>
            {expanded ? <Text style={styles.exChevron}>▼</Text> : null}
          </Pressable>
          <Pressable onPress={onGearTap} style={styles.exGearBtn} hitSlop={8}>
            <Text style={styles.exGear}>⚙</Text>
          </Pressable>
        </View>
      ) : null}
      {expanded ? (
        <View style={[styles.setsBox, compact && styles.setsBoxCompact]}>
          {exercise.sets.map((s, i) => {
            const isDropset = s.kind === 'dropset';
            const isDropsetFollower =
              isDropset && (s.parent_set_id ?? null) !== null;
            const isDropsetHead = isDropset && !isDropsetFollower;
            const isClusterLast = clusterInfo[i].isClusterLast;
            const minusDisabled = clusterInfo[i].clusterSize <= 2;

            let leftActions: SwipeAction[];
            let rightActions: SwipeAction[];
            if (isDropsetHead) {
              leftActions = [
                {
                  key: 'delete-cluster',
                  label: '刪',
                  color: '#FF3B30',
                  onPress: () => onDeleteCluster(s.id),
                },
              ];
              rightActions = [
                {
                  key: 'add-cluster',
                  label: '加',
                  color: '#34C759',
                  onPress: () => onAddClusterAfter(s.id),
                },
                {
                  key: 'note',
                  label: '備註',
                  color: '#007AFF',
                  onPress: () => onShowSetNote(s),
                },
              ];
            } else if (isDropsetFollower) {
              leftActions = [
                {
                  key: 'delete-follower',
                  label: '刪',
                  color: '#FF3B30',
                  onPress: () => onRemoveDropsetRow(s.id),
                },
              ];
              rightActions = [
                {
                  key: 'add-follower',
                  label: '加',
                  color: '#34C759',
                  onPress: () => onAddDropsetRow(s.id),
                },
                {
                  key: 'note',
                  label: '備註',
                  color: '#007AFF',
                  onPress: () => onShowSetNote(s),
                },
              ];
            } else {
              leftActions = [
                {
                  key: 'delete-set',
                  label: '刪',
                  color: '#FF3B30',
                  onPress: () => onDeleteSet(s.id),
                },
              ];
              rightActions = [
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
            }

            return (
              <SwipeableSetRow
                key={s.id}
                leftActions={leftActions}
                rightActions={rightActions}
                onLongPress={onLongPressRow}>
                <View style={styles.setRow}>
                  <Text style={[styles.setLabel, compact && styles.setLabelCompact]}>
                    {setLabels[i]}
                  </Text>
                  <TextInput
                    style={[styles.setInput, compact && styles.setInputCompact]}
                    value={String(s.reps)}
                    onChangeText={(t) =>
                      onUpdateSet(s.id, { reps: Number(t.replace(/[^0-9]/g, '')) || 0 })
                    }
                    keyboardType="numeric"
                  />
                  <Text style={styles.setUnit}>{compact ? '×' : 'reps'}</Text>
                  <TextInput
                    style={[styles.setInput, compact && styles.setInputCompact]}
                    value={String(s.weight)}
                    onChangeText={(t) =>
                      onUpdateSet(s.id, {
                        weight: Number(t.replace(/[^0-9.]/g, '')) || 0,
                      })
                    }
                    keyboardType="numeric"
                  />
                  <Text style={styles.setUnit}>kg</Text>
                  {isDropsetFollower ? (
                    <Pressable
                      onPress={() => onRemoveDropsetRow(s.id)}
                      disabled={minusDisabled}
                      style={[
                        styles.dropsetInlineBtn,
                        minusDisabled && styles.dropsetTailBtnDisabled,
                      ]}
                      hitSlop={6}>
                      <Text
                        style={[
                          styles.dropsetInlineBtnText,
                          minusDisabled && styles.dropsetTailBtnTextDisabled,
                        ]}>
                        −
                      </Text>
                    </Pressable>
                  ) : null}
                  {isDropsetFollower && isClusterLast ? (
                    <Pressable
                      onPress={() => onAddDropsetRow(s.id)}
                      style={styles.dropsetInlineBtn}
                      hitSlop={6}>
                      <Text style={styles.dropsetInlineBtnText}>+</Text>
                    </Pressable>
                  ) : null}
                </View>
              </SwipeableSetRow>
            );
          })}
          {!hideFooterBtns ? (
            <View style={[styles.exFooterBtns, compact && styles.exFooterBtnsCompact]}>
              <Pressable
                onPress={onAddSet}
                style={[styles.exFooterBtn, compact && styles.exFooterBtnCompact]}>
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
                style={[styles.exFooterBtn, compact && styles.exFooterBtnCompact]}>
                <Text
                  style={[
                    styles.exFooterBtnText,
                    compact && styles.exFooterBtnTextCompact,
                  ]}>
                  動作歷史
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  sectionHr: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#D1D5DB' },
  sectionLabel: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  emptySection: { fontSize: 12, color: '#9CA3AF', fontStyle: 'italic', paddingHorizontal: 12 },
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
  supersetBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#5856D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: 8,
    marginLeft: 10,
    marginBottom: -2,
  },
  exSuperRow: {
    flexDirection: 'row',
    gap: 0,
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
  exHeaderCompact: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 4,
  },
  exHeaderTapZone: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  exName: { flex: 1, fontSize: 15, fontWeight: '600' },
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
  setsBoxCompact: {
    paddingHorizontal: 8,
    paddingBottom: 8,
    paddingTop: 6,
  },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabel: { width: 26, fontSize: 13, fontWeight: '600', color: '#374151' },
  setLabelCompact: { width: 18, fontSize: 11 },
  setInput: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  setInputCompact: {
    minWidth: 34,
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontSize: 11,
  },
  setUnit: { fontSize: 12, color: '#6B7280' },
  noteBtn: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginLeft: 2,
  },
  noteBtnIcon: { fontSize: 14 },
  noteBtnIconEmpty: { opacity: 0.3 },
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
  restValueUnit: { fontSize: 16, color: '#6B7280' },
  paletteGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  paletteSwatch: {
    width: '22%',
    aspectRatio: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paletteCheck: { color: '#fff', fontSize: 26, fontWeight: '700' },
  sheetFootnote: { fontSize: 11, color: '#6B7280', textAlign: 'center' },
});

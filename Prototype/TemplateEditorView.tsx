import { useMemo, useState } from 'react';
import {
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
      x.weight !== y.weight
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showColorPicker, setShowColorPicker] = useState(false);

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
    setExpanded({ ...expanded, [ex_id]: !expanded[ex_id] });
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
    setExpanded({ ...expanded, [newId]: true });
  };

  const generalEx = draft.exercises.filter((e) => e.section === '一般');
  const fixedEx = draft.exercises.filter((e) => e.section === '常設動作');

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
        {generalEx.length === 0 ? (
          <Text style={styles.emptySection}>（無一般動作）</Text>
        ) : (
          generalEx.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              expanded={!!expanded[ex.id]}
              onToggle={() => toggleExpanded(ex.id)}
              onUpdateSet={(set_id, patch) => updateSet(ex.id, set_id, patch)}
            />
          ))
        )}

        <SectionHeader label="常設動作" />
        {fixedEx.length === 0 ? (
          <Text style={styles.emptySection}>（無常設動作）</Text>
        ) : (
          fixedEx.map((ex) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              expanded={!!expanded[ex.id]}
              onToggle={() => toggleExpanded(ex.id)}
              onUpdateSet={(set_id, patch) => updateSet(ex.id, set_id, patch)}
            />
          ))
        )}
      </ScrollView>

      <View style={styles.actionBar}>
        <Pressable style={styles.actionBtn} onPress={() => addExercise('一般')}>
          <Text style={styles.actionBtnText}>+ 動作</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => addExercise('常設動作')}>
          <Text style={styles.actionBtnText}>+ 常設</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={() => setShowColorPicker(true)}>
          <Text style={styles.actionBtnText}>配色</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() =>
            Alert.alert('更多', '[開始訓練] [另存模板] [刪除模板] — prototype 略')
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

function ExerciseCard({
  exercise,
  expanded,
  onToggle,
  onUpdateSet,
}: {
  exercise: TemplateExercise;
  expanded: boolean;
  onToggle: () => void;
  onUpdateSet: (set_id: string, patch: Partial<TemplateSet>) => void;
}) {
  const warmups = exercise.sets.filter((s) => s.kind === 'warmup').length;
  const workings = exercise.sets.filter((s) => s.kind !== 'warmup').length;

  return (
    <View style={styles.exCard}>
      <Pressable onPress={onToggle} style={styles.exHeader}>
        <Text style={styles.exName}>
          {exercise.parent_id != null ? '↳ ' : ''}
          {exercise.name}
        </Text>
        <Text style={styles.exSummary}>
          {warmups} 暖身 + {workings} 工作組
        </Text>
        <Text style={styles.exGear}>{expanded ? '▼' : '⚙'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.setsBox}>
          {exercise.sets.map((s, i) => (
            <View key={s.id} style={styles.setRow}>
              <Text style={styles.setLabel}>
                {s.kind === 'warmup'
                  ? '熱'
                  : s.kind === 'dropset'
                    ? `D${i + 1}`
                    : `${i + 1}`}
              </Text>
              <TextInput
                style={styles.setInput}
                value={String(s.reps)}
                onChangeText={(t) =>
                  onUpdateSet(s.id, { reps: Number(t.replace(/[^0-9]/g, '')) || 0 })
                }
                keyboardType="numeric"
              />
              <Text style={styles.setUnit}>reps</Text>
              <TextInput
                style={styles.setInput}
                value={String(s.weight)}
                onChangeText={(t) =>
                  onUpdateSet(s.id, {
                    weight: Number(t.replace(/[^0-9.]/g, '')) || 0,
                  })
                }
                keyboardType="numeric"
              />
              <Text style={styles.setUnit}>kg</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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
  exHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  exName: { flex: 1, fontSize: 15, fontWeight: '600' },
  exSummary: { fontSize: 12, color: '#6B7280' },
  exGear: { fontSize: 14, color: '#9CA3AF', marginLeft: 4 },
  setsBox: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
    paddingTop: 8,
  },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabel: { width: 26, fontSize: 13, fontWeight: '600', color: '#374151' },
  setInput: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  setUnit: { fontSize: 12, color: '#6B7280' },
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
  sheetDone: { fontSize: 15, color: '#007AFF', fontWeight: '600' },
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

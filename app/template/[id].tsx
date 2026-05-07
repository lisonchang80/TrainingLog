import { randomUUID } from 'expo-crypto';
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';
import { startSessionFromTemplate } from '@/src/adapters/sqlite/sessionFromTemplate';
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  addTemplateExercise,
  deleteTemplate,
  getTemplate,
  listTemplateExerciseRows,
  removeTemplateExercise,
  setTemplateExerciseEvergreen,
  updateTemplateName,
  type TemplateExerciseRow,
} from '@/src/adapters/sqlite/templateRepository';
import type { Exercise } from '@/src/domain/exercise/types';

/**
 * Template editor — pen to a single Template.
 *
 * Reached from:
 *   - Templates tab → tap row (existing template)
 *   - Templates tab → "+ New" (freshly-created stub)
 *
 * Capabilities:
 *   - Rename
 *   - Append an exercise (pill picker + sets/reps/weight inputs)
 *   - Remove an exercise row
 *   - Start a Session from this template (snapshot)
 *   - Delete the entire template
 *
 * On focus we re-query everything from the DB so changes from sibling routes
 * (e.g. just-deleted exercises) reflect immediately.
 */
export default function TemplateEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [rows, setRows] = useState<TemplateExerciseRow[]>([]);
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);

  const [pickedExerciseId, setPickedExerciseId] = useState<string | null>(null);
  const [defaultSets, setDefaultSets] = useState('3');
  const [defaultReps, setDefaultReps] = useState('10');
  const [defaultWeight, setDefaultWeight] = useState('');
  const [addAsEvergreen, setAddAsEvergreen] = useState(false);

  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [exs, tpl, exRows] = await Promise.all([
      listExercises(db),
      getTemplate(db, id),
      listTemplateExerciseRows(db, id),
    ]);
    setExercises(exs);
    setPickedExerciseId((prev) => prev ?? exs[0]?.id ?? null);
    if (!tpl) {
      setMissing(true);
      setLoaded(true);
      return;
    }
    setName(tpl.name);
    setRows(exRows);
    setLoaded(true);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onCommitName = async (next: string) => {
    if (!id) return;
    const trimmed = next.trim();
    if (!trimmed) {
      Alert.alert('Name cannot be empty');
      setName(name); // revert
      return;
    }
    try {
      await updateTemplateName(db, { id, name: trimmed });
    } catch (e) {
      Alert.alert('Rename failed', e instanceof Error ? e.message : String(e));
    }
  };

  const onAddExercise = async () => {
    if (!id || !pickedExerciseId) {
      Alert.alert('Pick an exercise first');
      return;
    }
    const sets = Number(defaultSets);
    const reps = defaultReps.trim() === '' ? null : Number(defaultReps);
    const weight = defaultWeight.trim() === '' ? null : Number(defaultWeight);
    if (!Number.isFinite(sets) || sets <= 0) {
      Alert.alert('Sets must be a positive number');
      return;
    }
    if (reps != null && (!Number.isFinite(reps) || reps < 0)) {
      Alert.alert('Reps must be a non-negative number');
      return;
    }
    if (weight != null && (!Number.isFinite(weight) || weight < 0)) {
      Alert.alert('Weight must be a non-negative number');
      return;
    }
    setBusy(true);
    try {
      await addTemplateExercise(db, {
        template_id: id,
        exercise_id: pickedExerciseId,
        default_sets: sets,
        default_reps: reps,
        default_weight_kg: weight,
        is_evergreen: addAsEvergreen ? 1 : 0,
        uuid: randomUUID,
      });
      await refresh();
    } catch (e) {
      Alert.alert('Add failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveRow = async (rowId: string) => {
    setBusy(true);
    try {
      await removeTemplateExercise(db, { template_exercise_id: rowId });
      await refresh();
    } catch (e) {
      Alert.alert('Remove failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onToggleEvergreen = async (rowId: string, current: 0 | 1) => {
    setBusy(true);
    try {
      await setTemplateExerciseEvergreen(db, {
        template_exercise_id: rowId,
        is_evergreen: current === 1 ? 0 : 1,
      });
      await refresh();
    } catch (e) {
      Alert.alert('Update failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onStartSession = async () => {
    if (!id) return;
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          'Session already in progress',
          'End the current session in the Today tab before starting a new one.'
        );
        return;
      }
      if (rows.length === 0) {
        Alert.alert('Add at least one exercise before starting a session.');
        return;
      }
      await startSessionFromTemplate(db, { template_id: id, uuid: randomUUID });
      router.replace('/');
    } catch (e) {
      Alert.alert('Start failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    if (!id) return;
    Alert.alert(
      'Delete this template?',
      'Past sessions started from this template are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await deleteTemplate(db, id);
              router.back();
            } catch (e) {
              Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Template' }} />
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }
  if (missing) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Template' }} />
        <Text style={styles.error}>Template not found.</Text>
      </SafeAreaView>
    );
  }

  const exById = (exId: string) => exercises.find((e) => e.id === exId);
  const evergreenRows = rows.filter((r) => r.is_evergreen === 1);
  const generalRows = rows.filter((r) => r.is_evergreen === 0);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Template' }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onEndEditing={(e) => onCommitName(e.nativeEvent.text)}
            placeholder="Template name"
            placeholderTextColor="#999"
          />

          <Pressable
            accessibilityRole="button"
            onPress={onStartSession}
            disabled={busy}
            style={({ pressed }) => [
              styles.startBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.startBtnText}>
              {busy ? 'Starting…' : 'Start Session from this Template'}
            </Text>
          </Pressable>

          {rows.length === 0 ? (
            <>
              <Text style={styles.section}>Exercises in this template</Text>
              <Text style={styles.muted}>No exercises yet — add one below.</Text>
            </>
          ) : (
            <>
              <View style={styles.zoneHeader}>
                <Text style={styles.zoneTitle}>常設動作區</Text>
                <Text style={styles.zoneHint}>每次都做的固定動作</Text>
              </View>
              {evergreenRows.length === 0 ? (
                <Text style={styles.zoneEmpty}>
                  No evergreen exercises — tap ☆ on a general row to mark it.
                </Text>
              ) : (
                evergreenRows.map((r) => (
                  <ExerciseRow
                    key={r.id}
                    row={r}
                    name={exById(r.exercise_id)?.name ?? '(unknown)'}
                    onRemove={() => onRemoveRow(r.id)}
                    onToggleEvergreen={() => onToggleEvergreen(r.id, r.is_evergreen)}
                  />
                ))
              )}

              <View style={styles.zoneHeader}>
                <Text style={styles.zoneTitle}>一般動作區</Text>
                <Text style={styles.zoneHint}>跟著週期化變化的動作</Text>
              </View>
              {generalRows.length === 0 ? (
                <Text style={styles.zoneEmpty}>
                  No general-zone exercises.
                </Text>
              ) : (
                generalRows.map((r) => (
                  <ExerciseRow
                    key={r.id}
                    row={r}
                    name={exById(r.exercise_id)?.name ?? '(unknown)'}
                    onRemove={() => onRemoveRow(r.id)}
                    onToggleEvergreen={() => onToggleEvergreen(r.id, r.is_evergreen)}
                  />
                ))
              )}
            </>
          )}

          <Text style={styles.section}>Add exercise</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsRow}>
            {exercises.map((ex) => {
              const isActive = ex.id === pickedExerciseId;
              return (
                <Pressable
                  key={ex.id}
                  accessibilityRole="button"
                  onPress={() => setPickedExerciseId(ex.id)}
                  style={({ pressed }) => [
                    styles.pill,
                    isActive && styles.pillActive,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={[styles.pillText, isActive && styles.pillTextActive]}>
                    {ex.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.inputsRow}>
            <View style={styles.inputCol}>
              <Text style={styles.smallLabel}>Sets</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={defaultSets}
                onChangeText={setDefaultSets}
              />
            </View>
            <View style={styles.inputCol}>
              <Text style={styles.smallLabel}>Reps</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={defaultReps}
                onChangeText={setDefaultReps}
                placeholder="—"
                placeholderTextColor="#999"
              />
            </View>
            <View style={styles.inputCol}>
              <Text style={styles.smallLabel}>Weight (kg)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={defaultWeight}
                onChangeText={setDefaultWeight}
                placeholder="—"
                placeholderTextColor="#999"
              />
            </View>
          </View>

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: addAsEvergreen }}
            onPress={() => setAddAsEvergreen((v) => !v)}
            style={styles.evergreenChk}>
            <Text style={styles.evergreenChkBox}>{addAsEvergreen ? '☑︎' : '☐'}</Text>
            <Text style={styles.evergreenChkLabel}>
              加入常設動作區（不會被 Save-back 移除）
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onAddExercise}
            disabled={busy}
            style={({ pressed }) => [
              styles.addBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.addBtnText}>{busy ? 'Adding…' : 'Add to template'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={onDelete}
            disabled={busy}
            style={({ pressed }) => [
              styles.deleteBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.deleteBtnText}>Delete template</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ExerciseRow({
  row,
  name,
  onRemove,
  onToggleEvergreen,
}: {
  row: TemplateExerciseRow;
  name: string;
  onRemove: () => void;
  onToggleEvergreen: () => void;
}) {
  const star = row.is_evergreen === 1 ? '★' : '☆';
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          row.is_evergreen === 1 ? 'Move to general zone' : 'Mark as evergreen'
        }
        onPress={onToggleEvergreen}
        style={({ pressed }) => [styles.starBtn, pressed && styles.btnPressed]}>
        <Text style={[styles.starText, row.is_evergreen === 1 && styles.starActive]}>
          {star}
        </Text>
      </Pressable>
      <View style={styles.rowMain}>
        <Text style={styles.rowOrdering}>#{row.ordering}</Text>
        <View style={styles.rowText}>
          <Text style={styles.rowName}>{name}</Text>
          <Text style={styles.rowDetails}>
            {row.default_sets} × {row.default_reps ?? '—'}
            {row.default_weight_kg != null ? ` @ ${row.default_weight_kg} kg` : ''}
          </Text>
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onRemove}
        style={({ pressed }) => [styles.removeBtn, pressed && styles.btnPressed]}>
        <Text style={styles.removeBtnText}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  body: { padding: 24, gap: 12, paddingBottom: 48 },
  label: { fontSize: 13, fontWeight: '500', opacity: 0.7 },
  smallLabel: { fontSize: 12, opacity: 0.65 },
  section: { fontSize: 16, fontWeight: '600', marginTop: 16 },
  nameInput: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 18,
    fontWeight: '600',
  },
  startBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  startBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginTop: 16,
    marginBottom: 4,
  },
  zoneTitle: { fontSize: 16, fontWeight: '700' },
  zoneHint: { fontSize: 12, opacity: 0.6 },
  zoneEmpty: { fontSize: 13, opacity: 0.55, fontStyle: 'italic', paddingVertical: 4 },
  starBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 22, opacity: 0.45 },
  starActive: { color: '#cc7a00', opacity: 1 },
  evergreenChk: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  evergreenChkBox: { fontSize: 18, width: 24 },
  evergreenChkLabel: { fontSize: 13, opacity: 0.85 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 10,
    gap: 12,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowOrdering: { fontSize: 12, opacity: 0.6, width: 24 },
  rowText: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowDetails: { fontSize: 13, opacity: 0.75 },
  removeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(220,53,69,0.15)',
  },
  removeBtnText: { color: '#dc3545', fontSize: 12, fontWeight: '600' },
  pillsRow: { gap: 8, paddingVertical: 4 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  pillActive: { backgroundColor: '#0a7ea4' },
  pillText: { fontSize: 14, fontWeight: '500' },
  pillTextActive: { color: 'white' },
  inputsRow: { flexDirection: 'row', gap: 8 },
  inputCol: { flex: 1, gap: 4 },
  input: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 16,
  },
  addBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(10,126,164,0.85)',
    alignItems: 'center',
  },
  addBtnText: { color: 'white', fontSize: 14, fontWeight: '600' },
  deleteBtn: {
    marginTop: 32,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(220,53,69,0.12)',
    alignItems: 'center',
  },
  deleteBtnText: { color: '#dc3545', fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  muted: { fontSize: 14, opacity: 0.6 },
  error: { fontSize: 14, color: '#dc3545' },
});

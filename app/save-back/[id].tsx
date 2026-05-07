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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { applySaveBack } from '@/src/adapters/sqlite/saveBackRepository';
import { listSessionExercises } from '@/src/adapters/sqlite/sessionRepository';
import { listSetsBySession } from '@/src/adapters/sqlite/setRepository';
import {
  aggregateActuals,
  computeSaveBackDiff,
  type SaveBackChange,
} from '@/src/domain/template/saveBackDiff';

/**
 * Save-back review screen — one-shot intercept between End Session and the
 * session detail page.
 *
 * Reached only when the just-ended Session was started from a Template (i.e.
 * its `session_exercise` rows have a non-null `template_id`). For blank
 * Sessions the Today tab navigates straight to `/session/[id]`.
 *
 * UX:
 *   - We render one card per `SaveBackChange` (modify / remove / add).
 *   - Each card has a toggle: ✓ accept, ✗ skip. Default: all accepted.
 *   - 'Apply' calls `applySaveBack` with only the accepted entries, then
 *     navigates to the session summary. 'Skip all' navigates directly without
 *     any DB writes.
 *   - When the diff is empty (everything matched) we show a "No changes"
 *     state with a single Continue button.
 *
 * Per ADR-0005 + slice 4 acceptance criteria: evergreen entries only ever
 * appear here as 'modify' (the diff layer suppresses 'remove' for them).
 */
export default function SaveBackScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();

  const [changes, setChanges] = useState<SaveBackChange[]>([]);
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const [exerciseNames, setExerciseNames] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [planRows, actualSets] = await Promise.all([
      listSessionExercises(db, id),
      listSetsBySession(db, id),
    ]);
    const tplId = planRows.find((p) => p.template_id != null)?.template_id ?? null;
    setTemplateId(tplId);
    const diff = computeSaveBackDiff({
      plan: planRows.map((r) => ({
        exercise_id: r.exercise_id,
        ordering: r.ordering,
        planned_sets: r.planned_sets,
        planned_reps: r.planned_reps,
        planned_weight_kg: r.planned_weight_kg,
        is_evergreen: r.is_evergreen,
      })),
      actual: aggregateActuals(actualSets),
    });
    setChanges(diff);
    setAccepted(
      Object.fromEntries(diff.map((_, i) => [i, true]))
    );
    // Build a name lookup so cards can show the exercise name without a JOIN.
    // Names come from set rows (which already join exercise.name); for planned
    // exercises that were never logged we don't have a name, so cards fall back
    // to the exercise_id (acceptable for the rare 'remove' card).
    const names: Record<string, string> = {};
    for (const set of actualSets) names[set.exercise_id] = set.exercise_name;
    setExerciseNames(names);
    setLoaded(true);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const toggle = (idx: number) => {
    setAccepted((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const onApply = async () => {
    if (!id) return;
    if (!templateId) {
      router.replace(`/session/${id}`);
      return;
    }
    const acceptedChanges = changes.filter((_, i) => accepted[i]);
    setBusy(true);
    try {
      await applySaveBack(db, {
        template_id: templateId,
        accepted: acceptedChanges,
        uuid: randomUUID,
      });
      router.replace(`/session/${id}`);
    } catch (e) {
      Alert.alert('Save-back failed', e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onSkipAll = () => {
    if (!id) return;
    router.replace(`/session/${id}`);
  };

  if (!loaded) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={{ title: 'Save-back' }} />
        <Text style={styles.muted}>Loading…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <Stack.Screen options={{ title: 'Save-back' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Update template?</Text>
        <Text style={styles.subhead}>
          What you actually did differs from the plan. Pick which changes to
          apply back to the template.
        </Text>

        {changes.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>
              No changes — your sets matched the plan exactly.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onSkipAll}
              style={({ pressed }) => [styles.applyBtn, pressed && styles.btnPressed]}>
              <Text style={styles.applyBtnText}>Continue</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {changes.map((c, i) => (
              <ChangeCard
                key={`${c.type}-${c.exercise_id}-${i}`}
                change={c}
                exerciseName={exerciseNames[c.exercise_id] ?? c.exercise_id}
                accepted={!!accepted[i]}
                onToggle={() => toggle(i)}
              />
            ))}

            <Pressable
              accessibilityRole="button"
              onPress={onApply}
              disabled={busy}
              style={({ pressed }) => [
                styles.applyBtn,
                busy && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.applyBtnText}>
                {busy ? 'Applying…' : 'Apply selected'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={onSkipAll}
              disabled={busy}
              style={({ pressed }) => [
                styles.skipAllBtn,
                busy && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.skipAllText}>Skip all — don&apos;t change template</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ChangeCard({
  change,
  exerciseName,
  accepted,
  onToggle,
}: {
  change: SaveBackChange;
  exerciseName: string;
  accepted: boolean;
  onToggle: () => void;
}) {
  const isEvergreen = change.is_evergreen === 1;
  return (
    <View style={[styles.card, accepted && styles.cardAccepted]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        onPress={onToggle}
        style={styles.cardCheckbox}>
        <Text style={styles.cardCheckboxMark}>{accepted ? '✓' : '✗'}</Text>
      </Pressable>
      <View style={styles.cardBody}>
        <View style={styles.cardHeader}>
          <Text style={[styles.cardType, badgeColors[change.type]]}>
            {labelForType(change.type)}
          </Text>
          {isEvergreen && <Text style={styles.evergreenBadge}>常設</Text>}
          <Text style={styles.cardName}>{exerciseName}</Text>
        </View>
        {change.type === 'modify' && change.planned && change.actual && (
          <Text style={styles.cardDetails}>
            {fmtSet(change.planned)}{'  →  '}{fmtSet(change.actual)}
          </Text>
        )}
        {change.type === 'remove' && change.planned && (
          <Text style={styles.cardDetails}>
            Planned {fmtSet(change.planned)} · skipped this session
          </Text>
        )}
        {change.type === 'add' && change.actual && (
          <Text style={styles.cardDetails}>
            New: {fmtSet(change.actual)}
          </Text>
        )}
      </View>
    </View>
  );
}

function fmtSet(v: { sets: number; reps: number | null; weight_kg: number | null }) {
  return `${v.sets} × ${v.reps ?? '—'}${v.weight_kg != null ? ` @ ${v.weight_kg} kg` : ''}`;
}

function labelForType(t: SaveBackChange['type']): string {
  switch (t) {
    case 'modify': return 'Modify';
    case 'remove': return 'Remove';
    case 'add': return 'Add';
  }
}

const badgeColors = StyleSheet.create({
  modify: { backgroundColor: 'rgba(10,126,164,0.15)', color: '#0a7ea4' },
  add: { backgroundColor: 'rgba(40,167,69,0.15)', color: '#28a745' },
  remove: { backgroundColor: 'rgba(220,53,69,0.15)', color: '#dc3545' },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700' },
  subhead: { fontSize: 14, opacity: 0.65, marginBottom: 8 },
  emptyBlock: { alignItems: 'center', gap: 16, paddingVertical: 32 },
  emptyText: { fontSize: 15, opacity: 0.65, textAlign: 'center' },
  muted: { fontSize: 14, opacity: 0.6, padding: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 10,
    opacity: 0.55,
  },
  cardAccepted: { opacity: 1, backgroundColor: 'rgba(127,127,127,0.16)' },
  cardCheckbox: {
    width: 32, height: 32, alignItems: 'center', justifyContent: 'center',
    borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.15)',
  },
  cardCheckboxMark: { fontSize: 18, fontWeight: '700' },
  cardBody: { flex: 1, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardType: {
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  evergreenBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,165,0,0.18)',
    color: '#cc7a00',
    overflow: 'hidden',
  },
  cardName: { fontSize: 15, fontWeight: '600' },
  cardDetails: { fontSize: 13, opacity: 0.85 },
  applyBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  applyBtnText: { color: 'white', fontSize: 16, fontWeight: '700' },
  skipAllBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.10)',
  },
  skipAllText: { fontSize: 14, opacity: 0.75, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
});

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { hashColor } from '@/components/template-editor/palette';
import {
  filterExercises,
  type ExerciseFilter,
} from '@/src/domain/exercise/exerciseLibrary';
import {
  EQUIPMENT_VALUES,
  type Equipment,
  type Exercise,
  type ExerciseMuscleLink,
  type Muscle,
  type MuscleGroup,
} from '@/src/domain/exercise/types';
import {
  getExerciseSessionCounts,
  listExercisesWithLinks,
  listMuscleGroups,
  listMuscles,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';

/**
 * Library screen (slice 9.6 / ADR-0017 Q1, Q6, Q7, Q15).
 *
 * Left vertical sidebar (11 MG + 「超級組」tab) + horizontal Equipment chip
 * row + 2-col grid of cards (circle thumbnail / N 次 badge / 講解 pill / name).
 * Selecting a MG indents its sub-muscles below it; tapping a sub-muscle
 * filters the grid further.
 *
 * Two route modes (Q15):
 *   - default / browse: from tab bar; tap a card → /exercise/[id]
 *   - picker: not yet wired here (L2 step) — multi-select + 完成 footer
 */
export default function LibraryScreen() {
  const db = useDatabase();
  const router = useRouter();

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [links, setLinks] = useState<ExerciseMuscleLink[]>([]);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [sessionCounts, setSessionCounts] = useState<Map<string, number>>(
    new Map()
  );

  const [selectedMgId, setSelectedMgId] = useState<string | null>(null);
  const [isSupersetTab, setIsSupersetTab] = useState(false);
  const [selectedMuscleId, setSelectedMuscleId] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(
    null
  );
  const [search, setSearch] = useState('');

  const refresh = useCallback(async () => {
    const [{ exercises, links }, mgs, ms, counts] = await Promise.all([
      listExercisesWithLinks(db),
      listMuscleGroups(db),
      listMuscles(db),
      getExerciseSessionCounts(db),
    ]);
    setExercises(exercises);
    setLinks(links);
    setMuscleGroups(mgs);
    setMuscles(ms);
    setSessionCounts(counts);
    // Default to first MG on first load if none selected yet.
    if (selectedMgId === null && !isSupersetTab && mgs.length > 0) {
      setSelectedMgId(mgs[0].id);
    }
  }, [db, selectedMgId, isSupersetTab]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const subMuscles = useMemo(() => {
    if (!selectedMgId) return [];
    return muscles
      .filter((m) => m.mg_id === selectedMgId)
      .sort((a, b) => a.display_order - b.display_order);
  }, [muscles, selectedMgId]);

  const filter: ExerciseFilter = useMemo(
    () => ({
      muscleGroupId: isSupersetTab ? null : selectedMgId,
      muscleId: selectedMuscleId,
      equipment: selectedEquipment,
      search,
    }),
    [isSupersetTab, selectedMgId, selectedMuscleId, selectedEquipment, search]
  );

  const visible = useMemo(
    () => filterExercises(exercises, links, filter),
    [exercises, links, filter]
  );

  const selectMg = (id: string) => {
    setIsSupersetTab(false);
    setSelectedMgId(id);
    setSelectedMuscleId(null);
  };

  const selectSuperset = () => {
    setIsSupersetTab(true);
    setSelectedMuscleId(null);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="輸入動作名字搜索"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新增動作"
          onPress={() => router.push('/exercise/new')}
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Sidebar
          muscleGroups={muscleGroups}
          selectedMgId={isSupersetTab ? null : selectedMgId}
          isSupersetTab={isSupersetTab}
          subMuscles={subMuscles}
          selectedMuscleId={selectedMuscleId}
          onSelectMg={selectMg}
          onSelectSuperset={selectSuperset}
          onSelectMuscle={setSelectedMuscleId}
        />
        <View style={styles.content}>
          {isSupersetTab ? (
            <SupersetTabPlaceholder />
          ) : (
            <>
              <EquipmentChipRow
                value={selectedEquipment}
                onChange={setSelectedEquipment}
              />
              <ExerciseGrid
                exercises={visible}
                sessionCounts={sessionCounts}
                onTap={(ex) => router.push(`/exercise/${ex.id}`)}
              />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

// ---------- Sidebar ----------

interface SidebarProps {
  muscleGroups: MuscleGroup[];
  selectedMgId: string | null;
  isSupersetTab: boolean;
  subMuscles: Muscle[];
  selectedMuscleId: string | null;
  onSelectMg: (id: string) => void;
  onSelectSuperset: () => void;
  onSelectMuscle: (id: string | null) => void;
}

function Sidebar(props: SidebarProps) {
  const {
    muscleGroups,
    selectedMgId,
    isSupersetTab,
    subMuscles,
    selectedMuscleId,
    onSelectMg,
    onSelectSuperset,
    onSelectMuscle,
  } = props;
  return (
    <ScrollView
      style={styles.sidebar}
      contentContainerStyle={styles.sidebarContent}
      showsVerticalScrollIndicator={false}>
      {muscleGroups.map((mg) => {
        const isActive = selectedMgId === mg.id;
        return (
          <View key={mg.id}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelectMg(mg.id)}
              style={styles.sidebarRow}>
              {isActive && <View style={styles.sidebarActiveBar} />}
              <Text
                style={[
                  styles.sidebarText,
                  isActive && styles.sidebarTextActive,
                ]}>
                {mg.name}
              </Text>
            </Pressable>
            {isActive &&
              subMuscles.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  onPress={() =>
                    onSelectMuscle(selectedMuscleId === m.id ? null : m.id)
                  }
                  style={styles.sidebarSubRow}>
                  <Text
                    style={[
                      styles.sidebarSubText,
                      selectedMuscleId === m.id && styles.sidebarSubTextActive,
                    ]}>
                    {m.name}
                  </Text>
                </Pressable>
              ))}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={onSelectSuperset}
        style={styles.sidebarRow}>
        {isSupersetTab && <View style={styles.sidebarActiveBar} />}
        <Text
          style={[
            styles.sidebarText,
            isSupersetTab && styles.sidebarTextActive,
          ]}>
          超級組
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------- Equipment chip row ----------

function EquipmentChipRow({
  value,
  onChange,
}: {
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.equipRow}>
      <EquipmentChip
        label="全部"
        active={value === null}
        onPress={() => onChange(null)}
      />
      {EQUIPMENT_VALUES.map((eq) => (
        <EquipmentChip
          key={eq}
          label={eq}
          active={value === eq}
          onPress={() => onChange(value === eq ? null : eq)}
        />
      ))}
    </ScrollView>
  );
}

function EquipmentChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.equipChip,
        active && styles.equipChipActive,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.equipText, active && styles.equipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- Exercise grid ----------

function ExerciseGrid({
  exercises,
  sessionCounts,
  onTap,
}: {
  exercises: Exercise[];
  sessionCounts: Map<string, number>;
  onTap: (ex: Exercise) => void;
}) {
  if (exercises.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>沒有符合條件的動作</Text>
      </View>
    );
  }
  return (
    <ScrollView
      contentContainerStyle={styles.grid}
      showsVerticalScrollIndicator={false}>
      {exercises.map((ex) => (
        <ExerciseCard
          key={ex.id}
          exercise={ex}
          sessionCount={sessionCounts.get(ex.id) ?? 0}
          onPress={() => onTap(ex)}
        />
      ))}
    </ScrollView>
  );
}

function ExerciseCard({
  exercise,
  sessionCount,
  onPress,
}: {
  exercise: Exercise;
  sessionCount: number;
  onPress: () => void;
}) {
  const hasCues = exercise.cues_text != null && exercise.cues_text.length > 0;
  const thumbnail = exercise.media_path;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      {hasCues && (
        <View style={styles.cuesPill}>
          <Text style={styles.cuesPillText}>講解</Text>
        </View>
      )}
      {sessionCount > 0 && (
        <Text style={styles.countBadge}>{sessionCount} 次</Text>
      )}
      <View style={styles.thumbWrap}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbImage} />
        ) : (
          <PlaceholderThumb exercise={exercise} />
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {exercise.name}
      </Text>
      {hasCues && <Text style={styles.cardCueLink}>查看動作要點</Text>}
    </Pressable>
  );
}

function PlaceholderThumb({ exercise }: { exercise: Exercise }) {
  // Hash-color circle with first character — ADR-0017 Q8 v1 placeholder.
  const bg = hashColor(exercise.name || exercise.id);
  const ch = exercise.name?.charAt(0) ?? '?';
  return (
    <View style={[styles.thumbPlaceholder, { backgroundColor: bg }]}>
      <Text style={styles.thumbInitial}>{ch}</Text>
    </View>
  );
}

// ---------- 超級組 placeholder (real content lands in S1) ----------

function SupersetTabPlaceholder() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>尚未建立超級組</Text>
      <Text style={styles.emptySubText}>S1 階段會接：creation flow + flat list</Text>
    </View>
  );
}

// ---------- Styles ----------

const SIDEBAR_WIDTH = 92;
const CARD_GAP = 10;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.20)',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: 6, color: 'rgba(255,255,255,0.6)' },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '600', lineHeight: 26 },

  body: { flex: 1, flexDirection: 'row' },

  sidebar: { width: SIDEBAR_WIDTH },
  sidebarContent: { paddingVertical: 12 },
  sidebarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 42,
    paddingLeft: 12,
  },
  sidebarActiveBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    backgroundColor: '#34C759',
    borderRadius: 2,
  },
  sidebarText: { color: 'rgba(255,255,255,0.55)', fontSize: 17, fontWeight: '500' },
  sidebarTextActive: { color: '#fff', fontWeight: '700' },
  sidebarSubRow: {
    height: 36,
    paddingLeft: 24,
    justifyContent: 'center',
  },
  sidebarSubText: { color: 'rgba(255,255,255,0.45)', fontSize: 15 },
  sidebarSubTextActive: { color: '#34C759', fontWeight: '600' },

  content: { flex: 1 },
  equipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  equipChip: {
    paddingHorizontal: 14,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(127,127,127,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipChipActive: { backgroundColor: 'rgba(52,199,89,0.18)' },
  equipText: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  equipTextActive: { color: '#34C759', fontWeight: '600' },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 24,
    gap: CARD_GAP,
  },
  card: {
    width: '48%',
    aspectRatio: 0.92,
    backgroundColor: 'rgba(127,127,127,0.15)',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cuesPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#34C759',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cuesPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  countBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: 8,
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  cardName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  cardCueLink: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 4,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
  emptySubText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },

  pressed: { opacity: 0.7 },
});

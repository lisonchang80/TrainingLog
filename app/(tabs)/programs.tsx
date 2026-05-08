import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  listPrograms,
  setActiveProgram,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';

/**
 * Programs tab — list of Programs with the active one badged. Tapping opens
 * the Program detail view; "+ New" launches the 6-step wizard.
 */
export default function ProgramsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ps = await listPrograms(db);
    setPrograms(ps);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onActivate = async (id: string) => {
    setBusy(true);
    try {
      await setActiveProgram(db, { id });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Programs</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/program-wizard/new')}
            style={({ pressed }) => [
              styles.newBtn,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
        </View>

        {programs.length === 0 ? (
          <Text style={styles.empty}>
            No programs yet. Tap “+ New” to launch the 6-step wizard.
          </Text>
        ) : (
          programs.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              onPress={() => router.push(`/program/${p.id}`)}
              style={({ pressed }) => [
                styles.row,
                p.is_active === 1 && styles.rowActive,
                pressed && styles.btnPressed,
              ]}>
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>
                  {p.name}
                  {p.main_tag ? ` · ${p.main_tag}` : ''}
                </Text>
                <Text style={styles.rowDetails}>
                  {p.cycle_count} × {p.cycle_length} days · starts {p.start_date} · {p.cellCount} cells
                </Text>
              </View>
              {p.is_active === 1 ? (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>ACTIVE</Text>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={(e) => {
                    e.stopPropagation();
                    onActivate(p.id);
                  }}
                  style={({ pressed }) => [
                    styles.activateBtn,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.activateBtnText}>Activate</Text>
                </Pressable>
              )}
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, gap: 12 },
  heading: { fontSize: 28, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontWeight: '600' },
  empty: { fontSize: 14, opacity: 0.6, fontStyle: 'italic', marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.10)',
  },
  rowActive: { backgroundColor: 'rgba(10,126,164,0.16)' },
  rowMain: { flex: 1, gap: 4 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 12, opacity: 0.7 },
  activeBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
  },
  activeBadgeText: { color: 'white', fontSize: 11, fontWeight: '700' },
  activateBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(10,126,164,0.20)',
  },
  activateBtnText: { color: '#0a7ea4', fontSize: 12, fontWeight: '600' },
  btnPressed: { opacity: 0.85 },
});

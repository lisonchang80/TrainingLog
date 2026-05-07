import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  createTemplate,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';

/**
 * Templates tab — list of saved Templates, newest-edited first.
 *
 * Tap a row → editor (`/template/[id]`).
 * Tap "+ New" → create an empty template, then push the editor.
 */
export default function TemplatesScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [rows, setRows] = useState<TemplateSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await listTemplates(db);
    setRows(list);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onCreate = async () => {
    setBusy(true);
    try {
      const id = randomUUID();
      await createTemplate(db, { id, name: 'New Template' });
      router.push(`/template/${id}`);
    } catch (e) {
      Alert.alert('Could not create template', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Templates</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          disabled={busy}
          style={({ pressed }) => [
            styles.newBtn,
            busy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.newBtnText}>+ New</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          rows.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No templates yet — tap “+ New” to create your first one.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push(`/template/${item.id}`)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowDetails}>
              {item.exerciseCount} exercise{item.exerciseCount === 1 ? '' : 's'} ·{' '}
              edited {formatTimestamp(item.updated_at)}
            </Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    padding: 24,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 28, fontWeight: '700' },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontSize: 14, fontWeight: '600' },
  listContent: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 4,
  },
  rowPressed: { opacity: 0.85 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 13, opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
});

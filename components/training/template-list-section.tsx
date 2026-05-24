/**
 * `<TemplateListSection>` — shared component for the 模板訓練 region of the
 * 訓練 tab (ADR-0024 § 2.c) and the standalone Templates surface (slated for
 * deletion once 訓練 tab重構 lands).
 *
 * Behaviour:
 *   - reads templates via `listTemplates` on focus
 *   - dedupes by name with `listTemplateGroupsByName` (ADR-0024 § 2.c)
 *   - header row: heading + [+ 新建模板] btn → creates a blank template and
 *     navigates to the editor (`/template/[id]`)
 *   - tap a row → invokes `onPickTemplate` if supplied, otherwise falls back
 *     to the legacy "open editor" behaviour. The start-sheet wiring (which
 *     turns a tap into a `startSessionFromTemplate` call) is the parent's
 *     responsibility — Section just surfaces which template was picked.
 *   - empty state: "沒有模板，點 [+ 新建] 開始建立" + [+ 新建模板] btn still
 *     visible (parent never needs to hide it)
 *
 * The component keeps its own list state but is otherwise stateless from the
 * parent's POV — drop it into the 訓練 tab idle scroll once or into the
 * legacy Templates tab once, no shared store needed.
 */

import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDatabase } from '@/components/database-provider';
import {
  createTemplate,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import { listTemplateGroupsByName } from '@/src/domain/training/templateListGroups';

interface Props {
  /**
   * Called when a template row is tapped. If omitted, the row push the
   * editor route (`/template/[id]`) — matches the legacy Templates-tab
   * behaviour. When supplied (e.g. from the 訓練 tab) the parent should
   * open the start-template flow.
   */
  onPickTemplate?: (template: TemplateSummary) => void;
  /** Optional override for the heading text (defaults to "模板訓練"). */
  heading?: string;
}

export function TemplateListSection({
  onPickTemplate,
  heading = '模板訓練',
}: Props): React.ReactElement {
  const db = useDatabase();
  const router = useRouter();
  const [rows, setRows] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await listTemplates(db);
    setRows(listTemplateGroupsByName(list));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

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

  const onRowPress = (row: TemplateSummary) => {
    if (onPickTemplate) {
      onPickTemplate(row);
      return;
    }
    router.push(`/template/${row.id}`);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>{heading}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新建模板"
          onPress={onCreate}
          disabled={busy}
          style={({ pressed }) => [
            styles.newBtn,
            busy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.newBtnText}>+ 新建模板</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            沒有模板，點 [+ 新建模板] 開始建立。
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`使用模板 ${row.name}`}
              onPress={() => onRowPress(row)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <Text style={styles.rowName}>{row.name}</Text>
              <Text style={styles.rowDetails}>
                {row.exerciseCount} 個動作 · 編輯於 {formatTimestamp(row.updated_at)}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 18, fontWeight: '700' },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontSize: 14, fontWeight: '600' },
  list: { gap: 8 },
  emptyBox: {
    padding: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.06)',
    alignItems: 'center',
  },
  emptyText: { fontSize: 14, opacity: 0.7, textAlign: 'center' },
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

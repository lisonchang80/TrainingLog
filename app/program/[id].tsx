import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { getProgram } from '@/src/adapters/sqlite/programRepository';
import { listTemplates, type TemplateSummary } from '@/src/adapters/sqlite/templateRepository';
import type { ProgramWithCells } from '@/src/domain/program/types';
import { t, tMainTagLine, tWeekdayLabels } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Program detail screen — calendar grid showing the fan-out of cycles ×
 * days, with each cell rendering its template name + sub_tag.
 *
 * ADR-0025 — all colors flow from useTheme().tokens via makeStyles below.
 */
export default function ProgramDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [data, setData] = useState<ProgramWithCells | null>(null);
  const [templatesById, setTemplatesById] = useState<Record<string, TemplateSummary>>({});

  const refresh = useCallback(async () => {
    if (!id) return;
    const [d, ts] = await Promise.all([getProgram(db, id), listTemplates(db)]);
    setData(d);
    const map: Record<string, TemplateSummary> = {};
    for (const t of ts) map[t.id] = t;
    setTemplatesById(map);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.empty}>{t('status', 'loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { program, cells } = data;
  const showWeekdays = program.cycle_length === 7;
  const weekdayLabels = tWeekdayLabels();

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{program.name}</Text>
        {program.main_tag ? (
          <Text style={styles.tag}>{tMainTagLine(program.main_tag)}</Text>
        ) : null}
        <Text style={styles.meta}>
          {program.cycle_count} × {program.cycle_length} days · starts {program.start_date}
          {program.is_active === 1 ? ' · ACTIVE' : ''}
        </Text>

        {/* Header row */}
        <View style={styles.row}>
          <View style={styles.cycleLabelHeader} />
          {Array.from({ length: program.cycle_length }).map((_, d) => (
            <View key={d} style={styles.cellHeader}>
              <Text style={styles.headerLabel}>
                {showWeekdays ? weekdayLabels[d] : `D${d + 1}`}
              </Text>
            </View>
          ))}
        </View>

        {/* Body rows */}
        {Array.from({ length: program.cycle_count }).map((_, c) => (
          <View key={c} style={styles.row}>
            <View style={styles.cycleLabelHeader}>
              <Text style={styles.headerLabel}>C{c + 1}</Text>
            </View>
            {Array.from({ length: program.cycle_length }).map((_, d) => {
              const cell = cells.find(
                (x) => x.cycle_index === c && x.day_index === d
              );
              const tpl = cell?.template_id ? templatesById[cell.template_id] : null;
              return (
                <View key={d} style={styles.cell}>
                  <Text style={styles.cellName} numberOfLines={1}>
                    {tpl ? tpl.name : '—'}
                  </Text>
                  {cell?.sub_tag ? (
                    <Text style={styles.cellTag} numberOfLines={1}>
                      {cell.sub_tag}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    body: { padding: 16, gap: 8 },
    heading: { fontSize: 24, fontWeight: '700', color: tokens.text.primary },
    tag: { fontSize: 13, color: tokens.text.secondary },
    meta: { fontSize: 12, color: tokens.text.secondary, marginBottom: 8 },
    row: { flexDirection: 'row' },
    cycleLabelHeader: {
      width: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellHeader: {
      flex: 1,
      paddingVertical: 6,
      alignItems: 'center',
    },
    headerLabel: { fontSize: 12, fontWeight: '700', color: tokens.text.secondary },
    cell: {
      flex: 1,
      margin: 2,
      minHeight: 56,
      padding: 6,
      borderRadius: 6,
      backgroundColor: tokens.bg.elevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    cellName: {
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
      color: tokens.text.primary,
    },
    cellTag: {
      fontSize: 9,
      color: tokens.text.tertiary,
      marginTop: 2,
      textAlign: 'center',
    },
    empty: {
      fontSize: 14,
      color: tokens.text.tertiary,
      fontStyle: 'italic',
    },
  });
}

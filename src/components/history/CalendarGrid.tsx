/**
 * CalendarGrid — shared calendar-month grid (ADR-0015 § Q9.4).
 *
 * Plugin pattern: this component owns the 7×4-6 layout, the weekday header,
 * the three month-navigation affordances (← / →, month label → date picker
 * modal, horizontal swipe), and the today-derived "next month disabled" rule.
 * It does NOT know anything about sessions or capacity — the caller passes a
 * `renderCell` callback and receives the per-cell `CalendarDayCell` payload.
 *
 * History month grid uses this with a session-aware cell renderer (see
 * MonthGridView). Future Program calendar (ADR-0004) keeps its cycle-based
 * grid separate per ADR-0015's explicit "不採完全共用" decision; the two views
 * only share cell-style atoms (palette, chip radius, font sizes) — not the
 * grid itself.
 *
 * Date picker note: we use `@react-native-community/datetimepicker` with
 * `display="spinner"` so the modal works on both iOS Simulator and Expo Go
 * (the alternative `display="inline"` is iOS 14+ only and inline does not
 * give the user a quick year-jump affordance, which is the whole point of
 * the label-tap entry per the ADR).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import {
  PanGestureHandler,
  type PanGestureHandlerStateChangeEvent,
  State,
} from 'react-native-gesture-handler';

import {
  buildMonthGrid,
  defaultCanGoNext,
  todayISO,
  type CalendarDayCell,
} from '../../domain/calendar/monthGrid';
import { t, useLocale } from '@/src/i18n';
import { tYearMonthTitle } from '@/src/i18n/dynamic';
import { useTheme, type ThemeTokens } from '@/src/theme';

export type { CalendarDayCell };

type CalendarGridProps = {
  year: number;
  month: number; // 1-12
  onMonthChange: (year: number, month: number) => void;
  renderCell: (cell: CalendarDayCell) => React.ReactNode;
  /**
   * Whether the user can navigate forward. Defaults to deriving from "current
   * month is at or before today's month" so future months are disabled (we
   * don't have data there yet). Caller can override to e.g. open up future
   * navigation for testing.
   */
  canGoNext?: boolean;
};

/**
 * Sun-first weekday labels. zh literals are single characters (日/一/二/…);
 * EN locale renders 3-letter abbreviations (Sun/Mon/Tue/…) via the i18n
 * dictionary keys `domain.weekdaySun..Sat`. The EN abbreviations are wider
 * than the zh single chars — the calendar grid's `weekdayLabel` flex cell
 * absorbs this without visual overflow (5 char abbrev fits in 1/7 column at
 * 11 fontSize), but reviewer note: if locale=en + small device width
 * combine to cause clipping in the future, switch to 1-letter abbrev (S /
 * M / T / W / T / F / S) per Apple iOS Calendar.
 */
const WEEKDAY_LABEL_KEYS = [
  'weekdaySun',
  'weekdayMon',
  'weekdayTue',
  'weekdayWed',
  'weekdayThu',
  'weekdayFri',
  'weekdaySat',
] as const;

export function CalendarGrid({
  year,
  month,
  onMonthChange,
  renderCell,
  canGoNext: canGoNextProp,
}: CalendarGridProps) {
  // React Compiler i18n gotcha: opt out of memoization + subscribe to locale so
  // weekday labels, the month-picker modal text, and tYearMonthTitle re-evaluate
  // on language switch (this grid stays mounted under the History tab).
  'use no memo';
  useLocale();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(
    () => new Date(year, month - 1, 1)
  );

  const today = useMemo(() => todayISO(), []);
  const cells = useMemo(
    () => buildMonthGrid(year, month, today),
    [year, month, today]
  );

  const canGoNext =
    canGoNextProp !== undefined ? canGoNextProp : defaultCanGoNext(year, month);

  const goPrev = useCallback(() => {
    if (month === 1) onMonthChange(year - 1, 12);
    else onMonthChange(year, month - 1);
  }, [year, month, onMonthChange]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    if (month === 12) onMonthChange(year + 1, 1);
    else onMonthChange(year, month + 1);
  }, [year, month, canGoNext, onMonthChange]);

  const onSwipeStateChange = useCallback(
    (event: PanGestureHandlerStateChangeEvent) => {
      if (event.nativeEvent.state !== State.END) return;
      const { translationX, velocityX } = event.nativeEvent;
      // Threshold from spec: dx > 50 OR velocityX > 500.
      const passDx = Math.abs(translationX) > 50;
      const passV = Math.abs(velocityX) > 500;
      if (!passDx && !passV) return;
      if (translationX < 0) {
        // Swipe left → next month.
        goNext();
      } else {
        goPrev();
      }
    },
    [goPrev, goNext]
  );

  const openPicker = useCallback(() => {
    setPickerDate(new Date(year, month - 1, 1));
    setShowPicker(true);
  }, [year, month]);

  const onPickerChange = useCallback(
    (_event: DateTimePickerEvent, selected?: Date) => {
      if (selected) {
        setPickerDate(selected);
        // On Android the user typically dismisses via the dialog button so
        // we apply immediately and close. On iOS spinner mode the user
        // scrubs the wheels and we wait for the explicit 「完成」tap.
        if (Platform.OS === 'android') {
          setShowPicker(false);
          onMonthChange(selected.getFullYear(), selected.getMonth() + 1);
        }
      } else if (Platform.OS === 'android') {
        // User cancelled.
        setShowPicker(false);
      }
    },
    [onMonthChange]
  );

  const applyPicker = useCallback(() => {
    setShowPicker(false);
    onMonthChange(pickerDate.getFullYear(), pickerDate.getMonth() + 1);
  }, [pickerDate, onMonthChange]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={goPrev} style={styles.navBtn}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Pressable onPress={openPicker} style={styles.titleBtn}>
          <Text style={styles.headerTitle}>{tYearMonthTitle(year, month)}</Text>
        </Pressable>
        <Pressable
          onPress={goNext}
          style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}
          disabled={!canGoNext}>
          <Text
            style={[styles.navBtnText, !canGoNext && styles.navBtnTextDisabled]}>
            ›
          </Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABEL_KEYS.map((key) => (
          <Text key={key} style={styles.weekdayLabel}>
            {t('domain', key)}
          </Text>
        ))}
      </View>

      <PanGestureHandler
        onHandlerStateChange={onSwipeStateChange}
        activeOffsetX={[-20, 20]}>
        <View style={styles.grid}>
          {cells.map((cell) => (
            <View
              key={`${cell.date}-${cell.inMonth ? 'in' : 'out'}`}
              style={styles.cellWrap}>
              {renderCell(cell)}
            </View>
          ))}
        </View>
      </PanGestureHandler>

      {/* Date picker modal. On iOS we render a spinner inside a modal sheet
          with a 「完成」button; on Android the system dialog auto-closes via
          onChange. */}
      <Modal
        visible={showPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPicker(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{t('page', 'selectMonth')}</Text>
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onPickerChange}
            />
            {Platform.OS === 'ios' ? (
              <View style={styles.modalActions}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setShowPicker(false)}>
                  <Text style={styles.modalCancelText}>{t('common', 'cancel')}</Text>
                </Pressable>
                <Pressable style={styles.modalDoneBtn} onPress={applyPicker}>
                  <Text style={styles.modalDoneText}>{t('common', 'done')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * ADR-0025 — token-driven calendar chrome. Weekday header / month nav /
 * picker modal all flow from tokens.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 6,
    },
    titleBtn: { paddingHorizontal: 12, paddingVertical: 4 },
    headerTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: tokens.text.primary,
    },
    navBtn: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    navBtnDisabled: { opacity: 0.3 },
    navBtnText: {
      fontSize: 20,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    navBtnTextDisabled: { color: tokens.text.tertiary },
    weekdayRow: {
      flexDirection: 'row',
      paddingHorizontal: 4,
    },
    weekdayLabel: {
      flex: 1,
      textAlign: 'center',
      fontSize: 11,
      fontWeight: '600',
      color: tokens.text.secondary,
      paddingVertical: 3,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 4,
      paddingBottom: 4,
    },
    cellWrap: { width: `${100 / 7}%` },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: tokens.bg.modal,
      paddingTop: 12,
      paddingBottom: 24,
      paddingHorizontal: 16,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
      marginBottom: 4,
      color: tokens.text.primary,
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
      gap: 12,
    },
    modalCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      backgroundColor: tokens.bg.elevated,
      borderRadius: 10,
      alignItems: 'center',
    },
    modalCancelText: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.text.secondary,
    },
    modalDoneBtn: {
      flex: 1,
      paddingVertical: 12,
      backgroundColor: tokens.action.primary,
      borderRadius: 10,
      alignItems: 'center',
    },
    modalDoneText: {
      fontSize: 16,
      fontWeight: '700',
      color: tokens.action.onPrimary,
    },
  });
}

/**
 * MiniBarChart — compact 6-bar histogram with optional average line.
 *
 * Used by the Stats sub-tab for:
 *   - 運動時長 over 6 periods (#6)
 *   - 各部位容量 over 6 periods, one per MG (#5)
 *
 * Pure presentational — caller hands in 6 BarData entries (oldest → newest)
 * and an optional average line value. Render via react-native-svg.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { t } from '@/src/i18n';

interface BarData {
  label: string;
  value: number;
}

interface MiniBarChartProps {
  data: readonly BarData[];
  /** Y value for a horizontal dashed avg line. Skipped if undefined / 0. */
  avgLine?: number;
  /** Pixel width of the chart area (excluding outer padding). */
  width: number;
  /** Pixel height of the chart area (excluding outer padding). */
  height: number;
  barColor?: string;
  /** Optional formatter for the avg-line label, e.g. ms → "1h 30m". */
  formatAvg?: (n: number) => string;
  /** Optional formatter for the per-bar label printed above each bar. */
  formatBarValue?: (n: number) => string;
  /** Show numeric values above each bar. */
  showBarValues?: boolean;
}

const PAD_TOP = 16;
const PAD_BOTTOM = 28; // extra space for rotated X-axis labels
// Asymmetric horizontal padding: left needs more room because rotated -30°
// X-axis labels with textAnchor="end" extend up-and-left from each tick.
// Without this, the first label (e.g. "2021") gets clipped to "021".
const PAD_LEFT = 22;
const PAD_RIGHT = 4;
const AVG_LINE_COLOR = '#EF4444';
const TRACK_COLOR = '#E5E7EB';

export function MiniBarChart({
  data,
  avgLine,
  width,
  height,
  barColor = '#6366F1',
  formatAvg = (n) => String(Math.round(n)),
  formatBarValue = (n) => String(Math.round(n)),
  showBarValues = false,
}: MiniBarChartProps) {
  const usableHeight = height - PAD_TOP - PAD_BOTTOM;
  const usableWidth = width - PAD_LEFT - PAD_RIGHT;
  const max = Math.max(
    ...data.map((d) => d.value),
    avgLine ?? 0,
    1 // avoid divide-by-zero
  );
  const barSlot = data.length > 0 ? usableWidth / data.length : 0;
  const barWidth = Math.max(barSlot * 0.6, 2);
  const barInset = (barSlot - barWidth) / 2;

  const yFor = (value: number) =>
    PAD_TOP + usableHeight * (1 - value / max);

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        {/* Baseline */}
        <Line
          x1={PAD_LEFT}
          y1={PAD_TOP + usableHeight}
          x2={width - PAD_RIGHT}
          y2={PAD_TOP + usableHeight}
          stroke={TRACK_COLOR}
          strokeWidth={1}
        />
        {/* Bars */}
        {data.map((d, i) => {
          const x = PAD_LEFT + i * barSlot + barInset;
          const y = yFor(d.value);
          const h = PAD_TOP + usableHeight - y;
          if (d.value <= 0) return null;
          return (
            <Rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              fill={barColor}
              rx={2}
            />
          );
        })}
        {/* Average line */}
        {avgLine != null && avgLine > 0 ? (
          <Line
            x1={PAD_LEFT}
            y1={yFor(avgLine)}
            x2={width - PAD_RIGHT}
            y2={yFor(avgLine)}
            stroke={AVG_LINE_COLOR}
            strokeWidth={1.2}
            strokeDasharray="3,3"
          />
        ) : null}
        {/* X-axis labels rendered as SvgText so rotation doesn't get clipped
            by RN flex slot width (smoke round-3: "2021" was truncating to
            "20..."). textAnchor="end" + rotate around (cx, cy) gives a
            tick-anchored, upward-tilted label. */}
        {data.map((d, i) => {
          const cx = PAD_LEFT + i * barSlot + barSlot / 2;
          const cy = PAD_TOP + usableHeight + 14;
          return (
            <SvgText
              key={`x-${i}`}
              x={cx}
              y={cy}
              fontSize={10}
              fill="#6B7280"
              textAnchor="end"
              transform={`rotate(-30 ${cx} ${cy})`}>
              {d.label}
            </SvgText>
          );
        })}
      </Svg>
      {/* Optional bar value labels */}
      {showBarValues ? (
        <View style={[styles.barValueRow, { width: usableWidth, left: PAD_LEFT }]}>
          {data.map((d, i) => (
            <Text key={i} style={styles.barValueLabel} numberOfLines={1}>
              {d.value > 0 ? formatBarValue(d.value) : ''}
            </Text>
          ))}
        </View>
      ) : null}
      {/* Avg line label (top-right corner) */}
      {avgLine != null && avgLine > 0 ? (
        <Text style={styles.avgLabel}>{t('status', 'avgPrefix')} {formatAvg(avgLine)}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // (X-axis labels are now SvgText inside the Svg — see render above.)
  barValueRow: {
    position: 'absolute',
    top: 0,
    flexDirection: 'row',
  },
  barValueLabel: {
    flex: 1,
    fontSize: 9,
    textAlign: 'center',
    color: '#374151',
    fontVariant: ['tabular-nums'],
  },
  avgLabel: {
    position: 'absolute',
    top: 0,
    right: 4,
    fontSize: 9,
    color: AVG_LINE_COLOR,
    fontWeight: '600',
  },
});

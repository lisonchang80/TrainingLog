import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import type {
  BodyChartVisibility,
  BodyMetric,
  UnitPreference,
} from '@/src/domain/body/types';
import { kgToDisplay } from '@/src/domain/body/unitConversion';
import { t } from '@/src/i18n';

/**
 * Body Trend Chart — three series (bodyweight / PBF / SMM) on a dual-Y-axis
 * canvas. Pure component: caller owns visibility state.
 *
 * Left Y axis: weight (bodyweight + SMM share the same axis since both kg/lb).
 * Right Y axis: PBF (%).
 *
 * Empty arrays are handled — renders a placeholder. Single-point series get
 * a dot but no line.
 */

const WIDTH = 320;
const HEIGHT = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 36;
const PAD_LEFT = 40;
const PAD_RIGHT = 40;

const CHART_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

const COLOR_BW = '#0a7ea4'; // teal
const COLOR_PBF = '#F26B3A'; // orange (matches body diagram primary)
const COLOR_SMM = '#5b8a3a'; // green
const COLOR_AXIS = '#999';
const COLOR_GRID = '#E5E5EA';

interface Props {
  metrics: BodyMetric[];
  visibility: BodyChartVisibility;
  unit: UnitPreference;
}

interface SeriesPoint {
  t: number;
  v: number;
}

export function BodyTrendChart({ metrics, visibility, unit }: Props) {
  if (metrics.length === 0) {
    return (
      <View style={[styles.placeholderBox, { width: WIDTH, height: HEIGHT }]}>
        <Text style={styles.placeholderText}>{t('status', 'noRecords')}</Text>
        {/* TODO(i18n): no key for "在上方輸入體重 / PBF / SMM 開始記錄" hint paragraph */}
        <Text style={styles.placeholderHint}>
          在上方輸入體重 / PBF / SMM 開始記錄
        </Text>
      </View>
    );
  }

  // Build per-metric point arrays, dropping nulls and converting weights.
  const bwPoints: SeriesPoint[] = [];
  const pbfPoints: SeriesPoint[] = [];
  const smmPoints: SeriesPoint[] = [];

  for (const m of metrics) {
    if (m.bodyweight_kg != null) {
      bwPoints.push({ t: m.recorded_at, v: kgToDisplay(m.bodyweight_kg, unit) });
    }
    if (m.pbf != null) {
      pbfPoints.push({ t: m.recorded_at, v: m.pbf });
    }
    if (m.smm_kg != null) {
      smmPoints.push({ t: m.recorded_at, v: kgToDisplay(m.smm_kg, unit) });
    }
  }

  // X scale spans across all visible measurements (regardless of which series
  // they belong to) so points line up by time, not by series-index.
  const tMin = Math.min(...metrics.map((m) => m.recorded_at));
  const tMax = Math.max(...metrics.map((m) => m.recorded_at));
  const tSpan = Math.max(1, tMax - tMin);

  // Left Y: weight (bw + smm). Right Y: PBF.
  const weightVals: number[] = [];
  if (visibility.bodyweight) weightVals.push(...bwPoints.map((p) => p.v));
  if (visibility.smm) weightVals.push(...smmPoints.map((p) => p.v));
  const wMin = weightVals.length ? Math.min(...weightVals) : 0;
  const wMax = weightVals.length ? Math.max(...weightVals) : 1;
  const wSpan = Math.max(1, wMax - wMin);

  const pbfMin = visibility.pbf && pbfPoints.length ? Math.min(...pbfPoints.map((p) => p.v)) : 0;
  const pbfMax = visibility.pbf && pbfPoints.length ? Math.max(...pbfPoints.map((p) => p.v)) : 1;
  const pbfSpan = Math.max(1, pbfMax - pbfMin);

  const x = (t: number) => PAD_LEFT + ((t - tMin) / tSpan) * CHART_W;
  const yWeight = (v: number) => PAD_TOP + (1 - (v - wMin) / wSpan) * CHART_H;
  const yPbf = (v: number) => PAD_TOP + (1 - (v - pbfMin) / pbfSpan) * CHART_H;

  const buildPath = (points: { x: number; y: number }[]): string => {
    if (points.length === 0) return '';
    const segments = points.map((p, i) =>
      i === 0 ? `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}` : `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    );
    return segments.join(' ');
  };

  const bwScreen = bwPoints.map((p) => ({ x: x(p.t), y: yWeight(p.v) }));
  const smmScreen = smmPoints.map((p) => ({ x: x(p.t), y: yWeight(p.v) }));
  const pbfScreen = pbfPoints.map((p) => ({ x: x(p.t), y: yPbf(p.v) }));

  // Grid lines: 4 horizontal evenly-spaced.
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => PAD_TOP + f * CHART_H);

  return (
    <View style={styles.container}>
      <Svg width={WIDTH} height={HEIGHT}>
        {/* Grid */}
        {gridLines.map((y, i) => (
          <Line
            key={`g${i}`}
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={y}
            y2={y}
            stroke={COLOR_GRID}
            strokeWidth={1}
          />
        ))}

        {/* Y axis (left) */}
        <Line
          x1={PAD_LEFT}
          x2={PAD_LEFT}
          y1={PAD_TOP}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={COLOR_AXIS}
          strokeWidth={1}
        />
        {/* Y axis (right) */}
        <Line
          x1={WIDTH - PAD_RIGHT}
          x2={WIDTH - PAD_RIGHT}
          y1={PAD_TOP}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={COLOR_AXIS}
          strokeWidth={1}
        />
        {/* X axis */}
        <Line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={HEIGHT - PAD_BOTTOM}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={COLOR_AXIS}
          strokeWidth={1}
        />

        {/* Left axis labels (weight unit) */}
        {weightVals.length > 0 && (
          <>
            <SvgText x={PAD_LEFT - 6} y={PAD_TOP + 4} fontSize="10" textAnchor="end" fill={COLOR_AXIS}>
              {wMax.toFixed(1)}
            </SvgText>
            <SvgText x={PAD_LEFT - 6} y={HEIGHT - PAD_BOTTOM} fontSize="10" textAnchor="end" fill={COLOR_AXIS}>
              {wMin.toFixed(1)}
            </SvgText>
            <SvgText x={4} y={PAD_TOP + CHART_H / 2} fontSize="9" fill={COLOR_AXIS}>
              {unit}
            </SvgText>
          </>
        )}
        {/* Right axis labels (PBF) */}
        {visibility.pbf && pbfPoints.length > 0 && (
          <>
            <SvgText x={WIDTH - PAD_RIGHT + 6} y={PAD_TOP + 4} fontSize="10" fill={COLOR_AXIS}>
              {pbfMax.toFixed(1)}
            </SvgText>
            <SvgText x={WIDTH - PAD_RIGHT + 6} y={HEIGHT - PAD_BOTTOM} fontSize="10" fill={COLOR_AXIS}>
              {pbfMin.toFixed(1)}
            </SvgText>
            <SvgText x={WIDTH - PAD_RIGHT + 6} y={PAD_TOP + CHART_H / 2} fontSize="9" fill={COLOR_AXIS}>
              %
            </SvgText>
          </>
        )}

        {/* X axis labels (first / last date) */}
        <SvgText x={PAD_LEFT} y={HEIGHT - PAD_BOTTOM + 14} fontSize="9" fill={COLOR_AXIS}>
          {formatDateShort(tMin)}
        </SvgText>
        <SvgText
          x={WIDTH - PAD_RIGHT}
          y={HEIGHT - PAD_BOTTOM + 14}
          fontSize="9"
          textAnchor="end"
          fill={COLOR_AXIS}>
          {formatDateShort(tMax)}
        </SvgText>

        {/* Series paths + points */}
        {visibility.bodyweight && bwScreen.length > 0 && (
          <>
            <Path d={buildPath(bwScreen)} stroke={COLOR_BW} strokeWidth={2} fill="none" />
            {bwScreen.map((p, i) => (
              <Circle key={`bw${i}`} cx={p.x} cy={p.y} r={3} fill={COLOR_BW} />
            ))}
          </>
        )}
        {visibility.smm && smmScreen.length > 0 && (
          <>
            <Path d={buildPath(smmScreen)} stroke={COLOR_SMM} strokeWidth={2} fill="none" />
            {smmScreen.map((p, i) => (
              <Circle key={`smm${i}`} cx={p.x} cy={p.y} r={3} fill={COLOR_SMM} />
            ))}
          </>
        )}
        {visibility.pbf && pbfScreen.length > 0 && (
          <>
            <Path d={buildPath(pbfScreen)} stroke={COLOR_PBF} strokeWidth={2} fill="none" />
            {pbfScreen.map((p, i) => (
              <Circle key={`pbf${i}`} cx={p.x} cy={p.y} r={3} fill={COLOR_PBF} />
            ))}
          </>
        )}
      </Svg>
    </View>
  );
}

function formatDateShort(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${m}/${day}`;
}

export const SERIES_COLORS = {
  bodyweight: COLOR_BW,
  pbf: COLOR_PBF,
  smm: COLOR_SMM,
};

const styles = StyleSheet.create({
  container: { alignItems: 'flex-start' },
  placeholderBox: {
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  placeholderText: { fontSize: 14, fontWeight: '600' },
  placeholderHint: { fontSize: 12, opacity: 0.6, paddingHorizontal: 16, textAlign: 'center' },
});

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  bpmToY,
  buildSamplePath,
  formatElapsedShort,
  shouldShowEmptyHint,
  type HRSample,
  Y_BPM_MAX,
  Y_BPM_MIN,
  yAxisTicks,
  zoneBands,
} from './hr-zone-chart.behavior';

/**
 * Heart Rate Zone Chart — Slice 13a Phase A placeholder canvas.
 *
 * Renders the full chart chrome (Y/X axes, 4 horizontal grid lines, 5 colored
 * Z1-Z5 background bands, axis labels) deterministically. When `samples` is
 * null / empty (Phase A default — HealthKit not wired), a centered grey
 * overlay shows the empty-state hint. Phase B will pass a populated samples
 * array → the existing zone bands stay, the empty hint disappears, and a
 * polyline path is drawn through the samples.
 *
 * Pure-layout maths live in `./hr-zone-chart.behavior.ts` so the chart shape
 * can be tested under `testEnvironment: node` (no RN renderer). This wrapper
 * is just JSX + theme tokens.
 *
 * Chrome (axes, grid, labels) flows through theme tokens (ADR-0025 chart
 * convention). The 5 zone band colors are intentionally fixed brand-data
 * hues (Polar / Garmin convention: Z1 cool · Z2 green · Z3 yellow · Z4
 * orange · Z5 red) — exported from behavior.ts as `ZONE_COLORS` for any
 * legend chips downstream.
 */

const WIDTH = 320;
const HEIGHT = 220;
const PAD_TOP = 16;
const PAD_BOTTOM = 36;
const PAD_LEFT = 40;
const PAD_RIGHT = 16;

const DIMS = {
  width: WIDTH,
  height: HEIGHT,
  padTop: PAD_TOP,
  padBottom: PAD_BOTTOM,
  padLeft: PAD_LEFT,
  padRight: PAD_RIGHT,
};

const CHART_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const CHART_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

/** Translucent fill alpha for zone bands so axis labels stay readable. */
const ZONE_BAND_OPACITY = 0.18;

interface Props {
  /**
   * HR samples (Phase B HealthKit ingest). `null` or `[]` → render bands +
   * axes only, with centered empty hint overlay (Phase A default).
   */
  samples: HRSample[] | null;
  /** User HRmax (220 - age). Drives zone-band BPM bounds. */
  hrmax: number;
  /** Session duration in seconds. Drives X axis span. */
  durationSec: number;
  /** Session start timestamp (ms). Samples are positioned as `ts - startTs`. */
  sessionStartTs?: number;
}

export function HRZoneChart({
  samples,
  hrmax,
  durationSec,
  sessionStartTs = 0,
}: Props) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const colorAxis = tokens.text.tertiary;
  const colorGrid = tokens.border.subtle;

  const bands = useMemo(() => zoneBands(hrmax, DIMS), [hrmax]);
  const ticks = useMemo(() => yAxisTicks(), []);
  const path = useMemo(
    () => buildSamplePath(samples, sessionStartTs, durationSec, DIMS),
    [samples, sessionStartTs, durationSec],
  );

  const showHint = shouldShowEmptyHint(samples);

  return (
    <View style={styles.container} testID="hr-zone-chart">
      <Svg width={WIDTH} height={HEIGHT}>
        {/* Zone bands (background) */}
        <G testID="hr-zone-bands">
          {bands.map((band) => (
            <Rect
              key={`band-z${band.zone}`}
              x={PAD_LEFT}
              y={band.yTop}
              width={CHART_W}
              height={Math.max(0, band.yBottom - band.yTop)}
              fill={band.color}
              fillOpacity={ZONE_BAND_OPACITY}
            />
          ))}
        </G>

        {/* Grid lines at Y tick BPM values */}
        {ticks.map((bpm) => (
          <Line
            key={`grid-${bpm}`}
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={bpmToY(bpm, DIMS)}
            y2={bpmToY(bpm, DIMS)}
            stroke={colorGrid}
            strokeWidth={1}
          />
        ))}

        {/* Y axis */}
        <Line
          x1={PAD_LEFT}
          x2={PAD_LEFT}
          y1={PAD_TOP}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={colorAxis}
          strokeWidth={1}
        />
        {/* X axis */}
        <Line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={HEIGHT - PAD_BOTTOM}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={colorAxis}
          strokeWidth={1}
        />

        {/* Y axis tick labels */}
        {ticks.map((bpm) => (
          <SvgText
            key={`y-label-${bpm}`}
            x={PAD_LEFT - 6}
            y={bpmToY(bpm, DIMS) + 3}
            fontSize="10"
            textAnchor="end"
            fill={colorAxis}>
            {bpm}
          </SvgText>
        ))}
        <SvgText
          x={4}
          y={PAD_TOP + CHART_H / 2}
          fontSize="9"
          fill={colorAxis}>
          {t('domain', 'bpm')}
        </SvgText>

        {/* X axis tick labels (start / mid / end) */}
        <SvgText
          x={PAD_LEFT}
          y={HEIGHT - PAD_BOTTOM + 14}
          fontSize="9"
          fill={colorAxis}>
          {formatElapsedShort(0)}
        </SvgText>
        <SvgText
          x={PAD_LEFT + CHART_W / 2}
          y={HEIGHT - PAD_BOTTOM + 14}
          fontSize="9"
          textAnchor="middle"
          fill={colorAxis}>
          {formatElapsedShort(durationSec / 2)}
        </SvgText>
        <SvgText
          x={WIDTH - PAD_RIGHT}
          y={HEIGHT - PAD_BOTTOM + 14}
          fontSize="9"
          textAnchor="end"
          fill={colorAxis}>
          {formatElapsedShort(durationSec)}
        </SvgText>

        {/* Sample polyline (Phase B; absent when samples null/empty) */}
        {path !== '' && (
          <Path
            d={path}
            stroke={tokens.text.primary}
            strokeWidth={2}
            fill="none"
          />
        )}
      </Svg>

      {/* Empty-state overlay — semi-transparent veil + centered hint */}
      {showHint && (
        <View style={styles.emptyOverlay} pointerEvents="none">
          <View style={styles.emptyBadge}>
            <Text style={styles.emptyText}>
              {t('status', 'hrChartEmptyHint')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

/** Re-export band palette for legend chips downstream (e.g. zone summary). */
export { ZONE_COLORS } from './hr-zone-chart.behavior';
export { Y_BPM_MIN, Y_BPM_MAX };

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: {
      width: WIDTH,
      height: HEIGHT,
      alignItems: 'flex-start',
      position: 'relative',
    },
    emptyOverlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: WIDTH,
      height: HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyBadge: {
      backgroundColor: tokens.bg.elevated,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      opacity: 0.92,
    },
    emptyText: {
      color: tokens.text.secondary,
      fontSize: 12,
      textAlign: 'center',
    },
  });
}

/**
 * HeatmapLegend
 * ─────────────────────────────────────────────────────────────────────────────
 * Compact gradient bar with labels, positioned top-right of the map.
 * Only shows when heatmap is active.
 *
 * Usage:
 *   <HeatmapLegend visible={heatmapFilter !== 'off'} />
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface Props {
  visible: boolean;
}

const MUTED = '#7A8FA6';
const TEXT  = '#FFFFFF';

export default function HeatmapLegend({ visible }: Props) {
  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>CRASH DENSITY</Text>

      <View style={styles.row}>
        {/* Labels */}
        <View style={styles.labels}>
          <Text style={styles.label}>High</Text>
          <Text style={styles.label}>Med</Text>
          <Text style={styles.label}>Low</Text>
        </View>

        {/* Gradient bar — red at top, navy at bottom */}
        <LinearGradient
          colors={['#FF003C', '#F46036', '#F7DC08', '#00D2B4', '#0096D2', '#092078']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.bar}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 60,
    right: 12,
    backgroundColor: 'rgba(11, 17, 32, 0.85)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(26, 188, 147, 0.25)',
    alignItems: 'center',
  },
  title: {
    color: MUTED,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  labels: {
    height: 80,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  label: {
    color: TEXT,
    fontSize: 9,
    fontWeight: '500',
  },
  bar: {
    width: 10,
    height: 80,
    borderRadius: 5,
  },
});
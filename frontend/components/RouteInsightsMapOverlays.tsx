import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

type RoutePoint = { latitude: number; longitude: number };

const CYAN = 'rgba(0, 229, 255,';

function chunkCoords(coords: RoutePoint[], maxChunks: number): RoutePoint[][] {
  if (coords.length < 2) return [];
  const n = Math.min(maxChunks, Math.max(8, Math.floor(coords.length / 4)));
  const step = Math.max(1, Math.floor((coords.length - 1) / n));
  const out: RoutePoint[][] = [];
  for (let start = 0; start < coords.length - 1; start += step) {
    const end = Math.min(coords.length, start + step + 1);
    out.push(coords.slice(start, end));
  }
  return out.filter(c => c.length > 1);
}

/** Variable-width cyan “flow” polylines (AADT proxy: width cycles by segment). */
export function AadtFlowPolylines({ coords }: { coords: RoutePoint[] }) {
  const chunks = useMemo(() => chunkCoords(coords, 22), [coords]);
  return (
    <>
      {chunks.map((seg, i) => {
        const w = 3.5 + (i % 7) * 1.15;
        const a = 0.28 + (i % 5) * 0.07;
        return (
          <Polyline
            key={`aadt-bg-${i}`}
            coordinates={seg}
            strokeColor={`${CYAN}${a})`}
            strokeWidth={w + 5}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
      {chunks.map((seg, i) => (
        <Polyline
          key={`aadt-fg-${i}`}
          coordinates={seg}
          strokeColor={i % 3 === 0 ? 'rgba(200, 255, 255, 0.95)' : 'rgba(0, 212, 255, 0.88)'}
          strokeWidth={2.2 + (i % 5) * 0.35}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </>
  );
}

function FlowDot({ delayMs, rushFactor }: { delayMs: number; rushFactor: number }) {
  const op = useRef(new RNAnimated.Value(0.35)).current;
  useEffect(() => {
    const slow = 900 + (1 - rushFactor) * 700;
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.delay(delayMs),
        RNAnimated.timing(op, { toValue: 1, duration: slow, useNativeDriver: true }),
        RNAnimated.timing(op, { toValue: 0.3, duration: slow, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [delayMs, op, rushFactor]);
  return (
    <RNAnimated.View
      style={[
        styles.flowDot,
        {
          opacity: op,
          backgroundColor: rushFactor > 0.72 ? '#FFD54A' : '#FFFFFF',
        },
      ]}
    />
  );
}

/** Soft kinetic dots along the route (peak flow). */
export function PeakFlowMarkers({
  coords,
  rushFactor,
}: {
  coords: RoutePoint[];
  rushFactor: number;
}) {
  const pts = useMemo(() => {
    if (coords.length < 2) return [];
    const n = 7;
    const out: RoutePoint[] = [];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const pos = t * (coords.length - 1);
      const idx = Math.floor(pos);
      const f = pos - idx;
      const a = coords[idx]!;
      const b = coords[Math.min(idx + 1, coords.length - 1)]!;
      out.push({
        latitude: a.latitude + (b.latitude - a.latitude) * f,
        longitude: a.longitude + (b.longitude - a.longitude) * f,
      });
    }
    return out;
  }, [coords]);

  return (
    <>
      {pts.map((c, i) => (
        <Marker key={`pf-${i}`} coordinate={c} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <FlowDot delayMs={i * 140} rushFactor={rushFactor} />
        </Marker>
      ))}
    </>
  );
}

type FactorRow = { label: string; count?: number; pct?: number };

export function ShapLogicMarkers({
  coords,
  factors,
}: {
  coords: RoutePoint[];
  factors: FactorRow[] | undefined;
}) {
  const items = useMemo(() => {
    if (!coords.length || !factors?.length) return [];
    const rows = factors.slice(0, 6);
    return rows.map((row, i) => {
      const idx = Math.min(
        coords.length - 1,
        Math.max(0, Math.floor(((i + 1) / (rows.length + 1)) * (coords.length - 1))),
      );
      const low = /light|wide|calm|low|clear|safe/i.test(row.label);
      return { ...row, coord: coords[idx]!, low, shape: i % 2 === 0 ? 'triangle' : 'square' as const };
    });
  }, [coords, factors]);

  return (
    <>
      {items.map((it, i) => (
        <Marker key={`shap-${i}`} coordinate={it.coord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View
            style={[
              styles.shapBadge,
              { borderColor: it.low ? 'rgba(80, 200, 255, 0.9)' : 'rgba(255, 100, 100, 0.95)', backgroundColor: it.low ? 'rgba(26, 188, 147, 0.2)' : 'rgba(255, 80, 80, 0.18)' },
            ]}
          >
            {it.shape === 'triangle' ? (
              <Ionicons name="caret-up" size={14} color={it.low ? '#7FE8FF' : '#FF8A80'} />
            ) : (
              <Ionicons name="stop-outline" size={12} color={it.low ? '#7FE8FF' : '#FF8A80'} />
            )}
          </View>
        </Marker>
      ))}
    </>
  );
}

function PulseRing() {
  const scale = useRef(new RNAnimated.Value(1)).current;
  const opacity = useRef(new RNAnimated.Value(0.55)).current;
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.parallel([
        RNAnimated.sequence([
          RNAnimated.timing(scale, { toValue: 1.35, duration: 1400, useNativeDriver: true }),
          RNAnimated.timing(scale, { toValue: 1, duration: 1400, useNativeDriver: true }),
        ]),
        RNAnimated.sequence([
          RNAnimated.timing(opacity, { toValue: 0.15, duration: 1400, useNativeDriver: true }),
          RNAnimated.timing(opacity, { toValue: 0.55, duration: 1400, useNativeDriver: true }),
        ]),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity, scale]);

  return (
    <RNAnimated.View
      style={[
        styles.pulseRing,
        {
          opacity,
          transform: [{ scale }],
        },
      ]}
    />
  );
}

export function HotspotPulseMarkers({
  spots,
  onPressSpot,
}: {
  spots: RoutePoint[];
  onPressSpot: (index: number) => void;
}) {
  return (
    <>
      {spots.map((coord, i) => (
        <Marker
          key={`hs-pulse-${i}`}
          coordinate={coord}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={() => onPressSpot(i)}
        >
          <Pressable onPress={() => onPressSpot(i)} hitSlop={12} style={styles.hotspotPress}>
            <PulseRing />
            <View style={styles.hotspotCore}>
              <Text style={styles.hotspotCoreText}>{i + 1}</Text>
            </View>
          </Pressable>
        </Marker>
      ))}
    </>
  );
}

export function HotspotGlassModal({
  visible,
  onClose,
  index,
  reasonTitle,
  reasonBody,
  accentColor,
}: {
  visible: boolean;
  onClose: () => void;
  index: number;
  reasonTitle: string;
  reasonBody: string;
  accentColor: string;
}) {
  const scan = useRef(new RNAnimated.Value(0)).current;
  const [cardH, setCardH] = useState(200);

  useEffect(() => {
    if (!visible) return;
    scan.setValue(0);
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(scan, { toValue: 1, duration: 2000, useNativeDriver: true }),
        RNAnimated.timing(scan, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scan, visible]);

  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(80, cardH - 24)] });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable style={styles.glassCard} onPress={() => {}} onLayout={e => setCardH(e.nativeEvent.layout.height)}>
          <RNAnimated.View style={[styles.scanLine, { transform: [{ translateY: scanY }] }]} />
          <View style={styles.modalHeader}>
            <View style={[styles.modalBadge, { borderColor: accentColor }]}>
              <Ionicons name="warning" size={16} color={accentColor} />
              <Text style={[styles.modalBadgeText, { color: accentColor }]}>Hot spot {index + 1}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color="rgba(255,255,255,0.85)" />
            </Pressable>
          </View>
          <Text style={styles.modalTitle}>{reasonTitle}</Text>
          <View style={styles.iconRow}>
            <Ionicons name="car-outline" size={18} color={accentColor} />
            <Ionicons name="flash" size={16} color="#FFB74D" style={{ marginLeft: 8 }} />
          </View>
          <Text style={styles.modalBody}>{reasonBody}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  shapBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255, 80, 60, 0.25)',
    borderWidth: 2,
    borderColor: 'rgba(255, 120, 90, 0.5)',
  },
  hotspotPress: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  hotspotCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(183, 28, 28, 0.95)',
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hotspotCoreText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  glassCard: {
    borderRadius: 20,
    padding: 20,
    overflow: 'hidden',
    backgroundColor: 'rgba(18, 22, 48, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(26, 188, 147, 0.85)',
    zIndex: 2,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  modalBadgeText: { fontSize: 12, fontWeight: '800' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '800', marginBottom: 8 },
  iconRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  modalBody: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20 },
});

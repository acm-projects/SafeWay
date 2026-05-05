import React, { useRef, useState } from 'react';
import { Animated, PanResponder, StyleProp, View, ViewStyle } from 'react-native';
import MapView from 'react-native-maps';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import StreetViewModal from '@/components/StreetViewModal';

const GMAPS_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  '';

export type MapRegionLike = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export default function MapPegmanStreetView({
  mapRef,
  currentRegion,
  fallbackLatLng,
  top,
  controlBg,
  dragHighlightBg,
  /** When true, pegman + coverage stay under bottom sheets (z-index capped). */
  stackBelowSheet = false,
  /**
   * When true, omit absolute positioning so parent can stack with zoom/layers.
   * Omit `top` in this mode.
   */
  embedInStack = false,
  containerStyle,
}: {
  mapRef: React.RefObject<MapView | null>;
  currentRegion: MapRegionLike;
  fallbackLatLng: { lat: number; lng: number };
  /** Ignored when embedInStack */
  top?: number;
  controlBg: string;
  dragHighlightBg?: string;
  stackBelowSheet?: boolean;
  embedInStack?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [showStreetView, setShowStreetView] = useState(false);
  const [streetLat, setStreetLat] = useState(0);
  const [streetLng, setStreetLng] = useState(0);
  const [isDraggingPegman, setIsDraggingPegman] = useState(false);
  const [showCoverageLayer, setShowCoverageLayer] = useState(false);
  const coverageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pegmanPos = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const pegmanButtonLayout = useRef({ x: 0, y: 0, width: 42, height: 42 });

  const CANCEL_RADIUS = 70;
  const highlight = dragHighlightBg ?? controlBg;
  const chromeZ = stackBelowSheet ? 6 : 80;
  const coverageZ = stackBelowSheet ? 5 : 70;
  const peakElev = stackBelowSheet ? 5 : 24;

  const pegmanPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setIsDraggingPegman(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        pegmanPos.setValue({ x: 0, y: 0 });
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        coverageTimerRef.current = setTimeout(() => setShowCoverageLayer(true), 1000);
      },
      onPanResponderMove: Animated.event([null, { dx: pegmanPos.x, dy: pegmanPos.y }], { useNativeDriver: false }),
      onPanResponderRelease: async (_, gs) => {
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        setIsDraggingPegman(false);
        setShowCoverageLayer(false);
        pegmanPos.setValue({ x: 0, y: 0 });
        const dist = Math.sqrt(gs.dx * gs.dx + gs.dy * gs.dy);
        if (dist < CANCEL_RADIUS) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }
        const dropX = pegmanButtonLayout.current.x + pegmanButtonLayout.current.width / 2 + gs.dx;
        const dropY = pegmanButtonLayout.current.y + pegmanButtonLayout.current.height / 2 + gs.dy;
        try {
          const coord = await mapRef.current?.coordinateForPoint({ x: dropX, y: dropY });
          if (coord) {
            setStreetLat(coord.latitude);
            setStreetLng(coord.longitude);
            setShowStreetView(true);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch {
          setStreetLat(fallbackLatLng.lat);
          setStreetLng(fallbackLatLng.lng);
          setShowStreetView(true);
        }
      },
      onPanResponderTerminate: () => {
        if (coverageTimerRef.current) clearTimeout(coverageTimerRef.current);
        setIsDraggingPegman(false);
        setShowCoverageLayer(false);
        pegmanPos.setValue({ x: 0, y: 0 });
      },
    }),
  ).current;

  const outerStyle: StyleProp<ViewStyle> = embedInStack
    ? [{ width: 42, height: 42, borderRadius: 21, zIndex: chromeZ }, containerStyle]
    : [{ position: 'absolute' as const, right: 14, top: top ?? 0, width: 42, height: 42, borderRadius: 21, zIndex: chromeZ }, containerStyle];

  return (
    <>
      {isDraggingPegman && GMAPS_KEY ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: coverageZ }}
          pointerEvents="none"
        >
          <WebView
            style={{ flex: 1, opacity: showCoverageLayer ? 0.9 : 0 }}
            source={{
              html: `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{margin:0;padding:0}html,body,#map{width:100%;height:100%;background:transparent}</style></head><body><div id="map"></div><script>function init(){new google.maps.StreetViewCoverageLayer().setMap(new google.maps.Map(document.getElementById('map'),{center:{lat:${currentRegion.latitude},lng:${currentRegion.longitude}},zoom:Math.round(Math.log2(360/${currentRegion.longitudeDelta})),disableDefaultUI:true,backgroundColor:'transparent',gestureHandling:'none',mapTypeId:'roadmap'}));}</script><script src="https://maps.googleapis.com/maps/api/js?key=${GMAPS_KEY}&callback=init" async defer></script></body></html>`,
            }}
            javaScriptEnabled
            originWhitelist={['*']}
            mixedContentMode="always"
            scrollEnabled={false}
            backgroundColor="#00000000"
          />
        </View>
      ) : null}

      <View
        style={outerStyle}
        onLayout={e => {
          e.target.measure((_x, _y, w, h, px, py) => {
            pegmanButtonLayout.current = { x: px, y: py, width: w, height: h };
          });
        }}
      >
        <Animated.View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: isDraggingPegman ? highlight : controlBg,
            justifyContent: 'center',
            alignItems: 'center',
            transform: pegmanPos.getTranslateTransform(),
            shadowColor: '#000',
            shadowOffset: { width: 0, height: isDraggingPegman ? 6 : 2 },
            shadowOpacity: isDraggingPegman ? 0.35 : 0.18,
            shadowRadius: isDraggingPegman ? 8 : 6,
            elevation: isDraggingPegman ? peakElev : 4,
            zIndex: chromeZ,
          }}
          {...pegmanPanResponder.panHandlers}
        >
          <Ionicons name="walk" size={22} color="#FFFFFF" />
        </Animated.View>
      </View>

      <StreetViewModal
        visible={showStreetView}
        lat={streetLat}
        lng={streetLng}
        placeName="Street View"
        onClose={() => setShowStreetView(false)}
        onNoCoverage={() => {
          Animated.spring(pegmanPos, { toValue: { x: 0, y: 0 }, useNativeDriver: false, friction: 5, tension: 80 }).start();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      />
    </>
  );
}

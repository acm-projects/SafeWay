/**
 * StreetViewModal
 *
 * Fully interactive Google Street View using react-native-webview +
 * Google Maps JavaScript API. Same engine as the Google Maps app.
 *
 * Features:
 *  - 360° drag-to-look (touch & mouse)
 *  - Pinch to zoom FOV
 *  - Click-to-walk (Street View pegman links)
 *  - "Pegman" dropped at the tapped map location
 *  - Shows place name overlay
 *  - Graceful "no coverage" state
 *
 * Install once:   npx expo install react-native-webview
 */

import { useEffect, useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useTheme } from '@/providers/theme-context';

// react-native-webview is optional — gracefully degrade if not installed
let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch {}

const GOOGLE_KEY: string =
  (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string | undefined) ||
  '';

interface Props {
  visible: boolean;
  lat: number;
  lng: number;
  placeName?: string;
  onClose: () => void;
  onNoCoverage?: () => void;
}

export default function StreetViewModal({ visible, lat, lng, placeName, onClose, onNoCoverage }: Props) {
  const { T } = useTheme();
  const webviewRef = useRef<any>(null);

  // When lat/lng change (user dropped pegman somewhere new), tell the webview
  useEffect(() => {
    if (!visible) return;
    webviewRef.current?.injectJavaScript(`
      if (window.panorama) {
        window.panorama.setPosition({ lat: ${lat}, lng: ${lng} });
      }
      true;
    `);
  }, [lat, lng, visible]);

  // The full Google Maps JS API Street View HTML, injected as a data URI
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #pano { width: 100%; height: 100%; overflow: hidden; background: #0b1120; }
    #no-coverage {
      display: none;
      position: absolute; inset: 0;
      background: #0b1120;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: #7A8FA6;
      font-family: system-ui, sans-serif;
      font-size: 16px;
    }
    #no-coverage.show { display: flex; }
    #no-coverage svg { opacity: 0.4; }
    #loading {
      position: absolute; inset: 0;
      background: #0b1120;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .spinner {
      width: 40px; height: 40px;
      border: 3px solid #1E2D45;
      border-top-color: #1ABC93;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    /* Hide Google's default close/links UI since we have our own header */
    .gm-svpc, .gm-bundled-control, a[href*="maps.google"] { display: none !important; }
  </style>
</head>
<body>
  <div id="loading"><div class="spinner"></div></div>
  <div id="no-coverage">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#7A8FA6" stroke-width="1.5">
      <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
    </svg>
    <span>No Street View here</span>
    <span style="font-size:13px;opacity:0.6">Try a nearby location</span>
  </div>
  <div id="pano"></div>

  <script>
    function initStreetView() {
      var sv = new google.maps.StreetViewService();
      var target = { lat: ${lat}, lng: ${lng} };

      sv.getPanorama({ location: target, radius: 100, preference: google.maps.StreetViewPreference.NEAREST }, function(data, status) {
        document.getElementById('loading').style.display = 'none';

        if (status !== google.maps.StreetViewStatus.OK) {
          window.ReactNativeWebView.postMessage('NO_COVERAGE');
          return;
        }

        var panorama = new google.maps.StreetViewPanorama(
          document.getElementById('pano'),
          {
            position: data.location.latLng,
            pov: { heading: 0, pitch: 0 },
            zoom: 0,
            addressControl: false,
            showRoadLabels: true,
            motionTracking: false,
            motionTrackingControl: false,
            linksControl: true,
            panControl: false,
            enableCloseButton: false,
            fullscreenControl: false,
          }
        );

        // Expose panorama globally so React Native can update position
        window.panorama = panorama;
      });
    }
  </script>
  <script
    src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&callback=initStreetView"
    async defer
  ></script>
</body>
</html>`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.container}>
        {/* Header bar */}
        <View style={[styles.header, { backgroundColor: T.isDark ? 'rgba(11,17,32,0.95)' : 'rgba(255,255,255,0.95)' }]}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={T.TEXT_PRI} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, { color: T.TEXT_PRI }]} numberOfLines={1}>
              {placeName ?? 'Street View'}
            </Text>
            <Text style={[styles.subtitle, { color: T.TEXT_MUT }]}>
              Drag to look · Tap arrows to walk
            </Text>
          </View>
          <View style={[styles.badge, { backgroundColor: T.ITEM }]}>
            <Ionicons name="walk-outline" size={16} color={T.ACCENT} />
          </View>
        </View>

        {/* Street View WebView */}
        {!WebView ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <Ionicons name="alert-circle-outline" size={48} color={T.TEXT_MUT} />
            <Text style={{ color: T.TEXT_MUT, marginTop: 12, fontSize: 14 }}>
              Street View requires react-native-webview
            </Text>
          </View>
        ) : (
        <WebView
          ref={webviewRef}
          style={styles.webview}
          originWhitelist={['*']}
          source={{ html, baseUrl: 'https://maps.googleapis.com' }}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled={false}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          mixedContentMode="always"
          onMessage={(e: any) => {
            if (e.nativeEvent.data === 'NO_COVERAGE') {
              onClose();
              onNoCoverage?.();
            }
          }}
          onError={() => {}}
        />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' /* Previous: '#030427' */ },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 16,
    gap: 12,
    zIndex: 10,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerText: { flex: 1 },
  title: { fontSize: 16, fontWeight: '700' },
  subtitle: { fontSize: 11, marginTop: 1 },
  badge: {
    width: 36, height: 36, borderRadius: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  webview: { flex: 1 },
});
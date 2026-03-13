import { useEffect, useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AuthProvider } from '@/providers/auth-provider';
import { palette } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { GlobalTabBar } from '@/components/global-tab-bar';

// Inline the splash so there is zero module resolution ambiguity
import { Image, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from 'react-native-reanimated';

function AppSplash({ onFinish }: { onFinish: () => void }) {
  const opacity     = useSharedValue(0);
  const scale       = useSharedValue(0.72);
  const logoY       = useSharedValue(20);
  const textOpacity = useSharedValue(0);
  const textY       = useSharedValue(14);
  const bgOpacity   = useSharedValue(1);

  useEffect(() => {
    opacity.value     = withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) });
    scale.value       = withSpring(1, { damping: 14, stiffness: 120 });
    logoY.value       = withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) });
    textOpacity.value = withDelay(380, withTiming(1, { duration: 380 }));
    textY.value       = withDelay(380, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
    bgOpacity.value   = withDelay(1600, withTiming(0, { duration: 420, easing: Easing.in(Easing.cubic) }));
    const t = setTimeout(onFinish, 2060);
    return () => clearTimeout(t);
  }, []);

  const containerStyle = useAnimatedStyle(() => ({ opacity: bgOpacity.value }));
  const logoStyle      = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { translateY: logoY.value }],
  }));
  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textY.value }],
  }));

  return (
    <Animated.View style={[sp.container, containerStyle]}>
      <Animated.View style={[sp.logoWrap, logoStyle]}>
        <Image
          source={require('../assets/safeway-logo.png')}
          style={sp.logo}
          resizeMode="contain"
        />
      </Animated.View>
      <Animated.View style={[sp.textWrap, textStyle]}>
        <Text style={sp.appName}>SafeWay</Text>
        <Text style={sp.tagline}>Navigate safely</Text>
      </Animated.View>
    </Animated.View>
  );
}

const sp = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F8F7FF',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  logoWrap: { width: 148, height: 148, justifyContent: 'center', alignItems: 'center' },
  logo:     { width: 148, height: 148 },
  textWrap: { alignItems: 'center', marginTop: 22, gap: 4 },
  appName:  { color: palette.deepPurple, fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  tagline:  { color: palette.brightPurple, fontSize: 14, fontWeight: '500', letterSpacing: 1.2, textTransform: 'uppercase' },
});

// ─────────────────────────────────────────────────────────────────────────────

// Custom themes matching our purple palette
const SafeWayDark = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: palette.deepPurple,
    card: palette.darkPurple,
    primary: palette.brightPurple,
    text: '#FFFFFF',
    border: 'rgba(255,255,255,0.08)',
  },
};

const SafeWayLight = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#F8F7FF',
    card: '#FFFFFF',
    primary: palette.brightPurple,
    text: palette.deepPurple,
    border: 'rgba(0,0,0,0.06)',
  },
};

export const unstable_settings = { anchor: '(tabs)' };

const SEEN_KEY = 'safeway_hasSeenLanding';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [splashDone, setSplashDone] = useState(false);
  const [checkedLanding, setCheckedLanding] = useState(false);

  // After splash, check if user has seen landing
  useEffect(() => {
    if (!splashDone) return;
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_KEY);
        if (!seen) {
          router.replace('/landing');
        }
      } catch {}
      setCheckedLanding(true);
    })();
  }, [splashDone]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ThemeProvider value={colorScheme === 'dark' ? SafeWayDark : SafeWayLight}>
          <View style={{ flex: 1 }}>
          <Stack>
            <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
            <Stack.Screen name="landing"     options={{ headerShown: false }} />
            <Stack.Screen name="onboarding"  options={{ headerShown: false }} />
            <Stack.Screen name="search"      options={{ headerShown: false, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="destination" options={{ headerShown: false }} />
            <Stack.Screen name="directions"  options={{ headerShown: false }} />
            <Stack.Screen name="login"       options={{ headerShown: false, presentation: 'modal', contentStyle: { flex: 1, backgroundColor: 'transparent' } }} />
          </Stack>

          <GlobalTabBar />
          </View>

          <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

          {!splashDone && (
            <AppSplash onFinish={() => setSplashDone(true)} />
          )}
        </ThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

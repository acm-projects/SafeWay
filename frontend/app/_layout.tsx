import { useState } from 'react';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { AuthProvider } from '@/providers/auth-provider';
import { ThemeProvider as AppThemeProvider } from '@/providers/theme-context';

// Inline the splash so there is zero module resolution ambiguity
import { useEffect } from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withDelay,
  Easing,
} from 'react-native-reanimated';

const launchSurfaceColor = '#030427';

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
          source={require('../assets/safeway-logo-transparent.png')}
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
    backgroundColor: launchSurfaceColor,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  logoWrap: { width: 148, height: 148, justifyContent: 'center', alignItems: 'center' },
  logo:     { width: 148, height: 148 },
  textWrap: { alignItems: 'center', marginTop: 22, gap: 4 },
  appName:  { color: '#FFFFFF', fontSize: 34, fontWeight: '800', letterSpacing: 0.5 },
  tagline:  { color: '#1ABC93', fontSize: 14, fontWeight: '500', letterSpacing: 1.2, textTransform: 'uppercase' },
});

// ─────────────────────────────────────────────────────────────────────────────

export const unstable_settings = { anchor: '(tabs)' };

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [splashDone, setSplashDone] = useState(false);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: launchSurfaceColor }}>
      <AuthProvider>
        <AppThemeProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <Stack>
              <Stack.Screen name="(tabs)"      options={{ headerShown: false }} />
              <Stack.Screen name="search"      options={{ headerShown: false, animation: 'slide_from_bottom' }} />
              <Stack.Screen name="destination" options={{ headerShown: false }} />
              <Stack.Screen name="directions"  options={{ headerShown: false }} />
              <Stack.Screen name="route-insights" options={{ headerShown: false }} />
              <Stack.Screen name="login"       options={{ headerShown: false, presentation: 'modal' }} />
            </Stack>

            <StatusBar style="auto" />

            {!splashDone && (
              <AppSplash onFinish={() => setSplashDone(true)} />
            )}
          </ThemeProvider>
        </AppThemeProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
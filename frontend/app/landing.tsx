import { useEffect } from 'react';
import { Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
} from 'react-native-reanimated';

import { Gradients, palette } from '@/constants/theme';

const SEEN_KEY = 'safeway_hasSeenLanding';

export default function LandingScreen() {
  const insets = useSafeAreaInsets();

  // Animations
  const titleY = useSharedValue(30);
  const titleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const btnOpacity = useSharedValue(0);
  const btnY = useSharedValue(20);

  useEffect(() => {
    titleOpacity.value = withDelay(400, withTiming(1, { duration: 600 }));
    titleY.value = withDelay(400, withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) }));
    subtitleOpacity.value = withDelay(650, withTiming(1, { duration: 500 }));
    subtitleY.value = withDelay(650, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
    btnOpacity.value = withDelay(900, withTiming(1, { duration: 500 }));
    btnY.value = withDelay(900, withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }));
  }, []);

  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleY.value }],
  }));
  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ translateY: btnY.value }],
  }));

  async function markSeen() {
    await AsyncStorage.setItem(SEEN_KEY, 'true');
  }

  function handleGetStarted() {
    markSeen();
    router.replace('/login');
  }

  function handleSkip() {
    markSeen();
    router.replace('/(tabs)');
  }

  return (
    <ImageBackground
      source={require('../assets/images/landing-bg.png')}
      style={s.container}
      resizeMode="cover"
    >
      {/* Black fade overlay at bottom only */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.95)']}
        locations={[0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {/* Skip button (always visible) */}
      <Pressable style={[s.skipBtn, { top: insets.top + 12 }]} onPress={handleSkip}>
        <Text style={s.skipText}>Skip</Text>
      </Pressable>

      {/* Logo */}
      <View style={[s.logoRow, { marginTop: insets.top + 16 }]}>
        <Image source={require('../assets/safeway-logo.png')} style={s.logoIcon} resizeMode="contain" />
        <Text style={s.logoText}>SafeWay</Text>
      </View>

      <View style={s.spacer} />

      {/* Tagline */}
      <View style={s.taglineWrap}>
        <Text style={s.navLabel}>NAVIGATE SAFELY</Text>
        <Animated.View style={titleStyle}>
          <Text style={s.heroTitle}>Find Your{'\n'}Safer Routes.</Text>
        </Animated.View>
        <Animated.View style={subtitleStyle}>
          <Text style={s.heroAccent}>Smarter Travel.</Text>
        </Animated.View>
      </View>

      {/* Bottom action */}
      <Animated.View style={[s.bottomWrap, { paddingBottom: Math.max(insets.bottom, 12) + 100 }, btnStyle]}>
        <Pressable onPress={handleGetStarted} style={s.getStartedBtn}>
          <LinearGradient
            colors={[...Gradients.button]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={s.getStartedText}>Get Started</Text>
          <View style={s.arrowCircle}>
            <Text style={s.arrow}>→</Text>
          </View>
        </Pressable>
      </Animated.View>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },

  skipBtn: { position: 'absolute', right: 20, zIndex: 10, paddingHorizontal: 16, paddingVertical: 8 },
  skipText: { color: '#FFFFFF', fontSize: 15, fontWeight: '500', textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  logoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, gap: 10 },
  logoIcon: { width: 36, height: 36 },
  logoText: { color: '#FFFFFF', fontSize: 22, fontWeight: '700', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.3)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },

  spacer: { flex: 1 },
  taglineWrap: { paddingHorizontal: 28, marginBottom: 20 },
  navLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 2.5,
    marginBottom: 12,
  },
  heroTitle: { color: '#FFFFFF', fontSize: 38, fontWeight: '800', lineHeight: 46 },
  heroAccent: {
    color: palette.brightPurple,
    fontSize: 38,
    fontWeight: '800',
    lineHeight: 46,
  },

  bottomWrap: { paddingHorizontal: 28 },
  getStartedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 58,
    borderRadius: 29,
    overflow: 'hidden',
    gap: 12,
  },
  getStartedText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', zIndex: 1 },
  arrowCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  arrow: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
});

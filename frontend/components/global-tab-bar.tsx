import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, Glass } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

const CENTER_SIZE = 64;

/**
 * Global tab bar shown on all pages.
 * Layout: [Explore] —— [▲ Navigate] —— [Profile]
 */
export function GlobalTabBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const colorScheme = useColorScheme() ?? 'light';
  const isDark = colorScheme === 'dark';
  const glass = Glass[colorScheme];

  const isExploreActive = pathname.includes('explore');
  const isHomeActive = pathname.includes('(tabs)') && !pathname.includes('explore') && !pathname.includes('profile');
  const isProfileActive = pathname.includes('profile');

  function goToExplore() {
    router.replace('/(tabs)/explore');
  }
  function goToHome() {
    router.replace('/(tabs)');
  }
  function goToProfile() {
    router.replace('/(tabs)/profile');
  }

  return (
    <View style={[s.tabBarOuter, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <View style={s.capsuleWrapper}>
        <View style={[s.capsule, { borderColor: glass.border }]}>
          {Platform.OS === 'android' ? (
            {/* Previous: 'rgba(45, 27, 78, 0.92)' */}
            <View style={[StyleSheet.absoluteFill, s.capsuleRadius, { backgroundColor: isDark ? 'rgba(20, 20, 20, 0.94)' : 'rgba(255, 255, 255, 0.92)' }]} />
          ) : (
            <BlurView intensity={glass.intensity} tint={isDark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, s.capsuleRadius]} />
          )}

          <Pressable style={s.sideTab} onPress={goToExplore}>
            <Ionicons
              name={isExploreActive ? 'compass' : 'compass-outline'}
              size={22}
              color={isExploreActive ? palette.brightPurple : palette.mutedGray}
            />
          </Pressable>

          <View style={s.centerSpacer} />

          <Pressable style={s.sideTab} onPress={goToProfile}>
            <Ionicons
              name={isProfileActive ? 'person' : 'person-outline'}
              size={22}
              color={isProfileActive ? palette.brightPurple : palette.mutedGray}
            />
          </Pressable>
        </View>

        <View style={s.centerBtnOuter}>
          <Pressable style={s.centerBtnWrap} onPress={goToHome}>
            <LinearGradient
              colors={isHomeActive ? [palette.brightPurple, palette.royalBlue] : [palette.mediumPurple, palette.navyBlue]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[StyleSheet.absoluteFill, { borderRadius: 32 }]}
            />
            <Ionicons name="navigate" size={26} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tabBarOuter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  capsuleWrapper: {
    width: 220,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 220,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    overflow: 'hidden',
  },
  capsuleRadius: { borderRadius: 30 },
  sideTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  centerSpacer: { width: CENTER_SIZE },
  centerBtnOuter: {
    position: 'absolute',
    top: -(CENTER_SIZE - 60) / 2,
    left: (220 - CENTER_SIZE) / 2,
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBtnWrap: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 10,
    shadowColor: palette.brightPurple,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    overflow: 'hidden',
  },
});

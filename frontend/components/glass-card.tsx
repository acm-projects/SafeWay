import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Glass, AppTheme } from '@/constants/theme';

type Props = {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  /** Use stronger opacity for cards that need more contrast */
  strong?: boolean;
  /** Border radius override */
  radius?: number;
};

export function GlassCard({ children, style, intensity, strong, radius }: Props) {
  const colorScheme = useColorScheme() ?? 'light';
  const glass = Glass[colorScheme];
  const bg = strong ? glass.backgroundStrong : glass.background;
  const border = strong ? glass.borderStrong : glass.border;
  const blurIntensity = intensity ?? glass.intensity;
  const borderRadius = radius ?? AppTheme.radius.xl;

  // expo-blur BlurView works well on iOS; on Android it can be less performant
  // so we fall back to a solid semi-transparent background
  if (Platform.OS === 'android') {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: bg,
            borderColor: border,
            borderRadius,
          },
          style,
        ]}
      >
        {children}
      </View>
    );
  }

  return (
    <View style={[styles.container, { borderColor: border, borderRadius, overflow: 'hidden' }, style]}>
      <BlurView intensity={blurIntensity} tint={colorScheme === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: bg }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  content: {
    flex: 1,
  },
});

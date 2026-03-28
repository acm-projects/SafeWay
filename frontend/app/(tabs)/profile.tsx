import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/providers/auth-provider';
import { palette, Colors, Gradients } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function ProfileScreen() {
  const { user, session, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];

  const initials    = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Guest';
  const email       = user?.email ?? '';

  async function handleViewWelcomeScreenAgain() {
    await AsyncStorage.removeItem('safeway_hasSeenLanding');
    router.replace('/landing');
  }

  const menuItems = [
    {
      icon: 'bookmark-outline' as const,
      label: 'Saved Places',
      color: palette.brightPurple,
      onPress: () => router.replace('/(tabs)'),
    },
    {
      icon: 'people-outline' as const,
      label: 'Emergency Contacts',
      color: palette.teal,
      onPress: () => router.push({ pathname: '/onboarding', params: { step: '1' } }),
    },
    {
      icon: 'shield-checkmark-outline' as const,
      label: 'SOS Settings',
      color: palette.danger,
      onPress: () => router.push({ pathname: '/onboarding', params: { step: '2' } }),
    },
    {
      icon: 'map-outline' as const,
      label: 'Offline Maps',
      color: palette.royalBlue,
      onPress: () => Alert.alert('Offline Maps', 'Offline maps are not available yet.'),
    },
    {
      icon: 'settings-outline' as const,
      label: 'Settings',
      color: palette.mutedGray,
      onPress: () => router.push({ pathname: '/onboarding', params: { step: '2' } }),
    },
    {
      icon: 'play-circle-outline' as const,
      label: 'View Welcome Screen Again',
      color: palette.mediumPurple,
      onPress: handleViewWelcomeScreenAgain,
    },
  ];

  if (!session) {
    return (
      <View style={[s.container, { backgroundColor: c.background }]}>
        <View style={[s.centered, { paddingTop: insets.top + 40 }]}>
          <Ionicons name="person-circle-outline" size={80} color={palette.mutedGray} />
          <Text style={[s.guestTitle, { color: c.text }]}>Sign in to SafeWay</Text>
          <Text style={[s.guestSub, { color: c.textSecondary }]}>
            Access saved places, emergency contacts, and more.
          </Text>
          <Pressable style={s.signInBtn} onPress={() => router.push('/login')}>
            <LinearGradient colors={[...Gradients.button]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
            <Text style={s.signInText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[s.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + info */}
        <View style={s.avatarSection}>
          <LinearGradient colors={[palette.brightPurple, palette.royalBlue]} style={s.avatarCircle}>
            <Text style={s.avatarText}>{initials}</Text>
          </LinearGradient>
          <Text style={[s.displayName, { color: c.text }]}>{displayName}</Text>
          <Text style={[s.emailText, { color: c.textSecondary }]}>{email}</Text>
        </View>

        {/* Menu */}
        <View style={[s.menuCard, { backgroundColor: c.cardSolid, borderRadius: 20, borderWidth: 1, borderColor: c.divider }]}>
          {menuItems.map((item, i) => (
            <View key={item.label}>
              <Pressable style={s.menuRow} onPress={item.onPress}>
                <View style={[s.menuIconWrap, { backgroundColor: item.color + '22' }]}>
                  <Ionicons name={item.icon} size={20} color={item.color} />
                </View>
                <Text style={[s.menuLabel, { color: c.text }]}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={palette.mutedGray} />
              </Pressable>
              {i < menuItems.length - 1 && <View style={[s.menuDiv, { backgroundColor: c.divider }]} />}
            </View>
          ))}
        </View>

        {/* Sign out */}
        <Pressable style={s.signOutRow} onPress={signOut}>
          <Ionicons name="log-out-outline" size={20} color={palette.danger} />
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  scroll: { paddingHorizontal: 20 },

  guestTitle: { fontSize: 22, fontWeight: '700', marginTop: 16 },
  guestSub: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  signInBtn: { width: '100%', height: 50, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  signInText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '700' },
  displayName: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  emailText: { fontSize: 14 },

  menuCard: { padding: 4, marginBottom: 24 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 14 },
  menuIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  menuDiv: { height: 1, marginLeft: 66 },

  signOutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 },
  signOutText: { color: palette.danger, fontSize: 15, fontWeight: '600' },
});

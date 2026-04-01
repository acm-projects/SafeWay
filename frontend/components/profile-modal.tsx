import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/providers/auth-provider';
import { palette, Colors, Gradients } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
}

export function ProfileModal({ visible, onClose }: ProfileModalProps) {
  const { user, session, signOut } = useAuth();
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];

  const initials    = user?.email ? user.email.slice(0, 2).toUpperCase() : '?';
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? 'Guest';
  const email       = user?.email ?? '';

  async function handleViewWelcomeScreenAgain() {
    onClose();
    await AsyncStorage.removeItem('safeway_hasSeenLanding');
    router.replace('/landing');
  }

  function handleSignOut() {
    onClose();
    signOut();
  }

  const menuItems = [
    {
      icon: 'bookmark-outline' as const,
      label: 'Saved Places',
      color: palette.brightPurple,
      onPress: () => { onClose(); },
    },
    {
      icon: 'people-outline' as const,
      label: 'Emergency Contacts',
      color: palette.teal,
      onPress: () => { onClose(); router.push({ pathname: '/onboarding', params: { step: '1' } }); },
    },
    {
      icon: 'shield-checkmark-outline' as const,
      label: 'SOS Settings',
      color: palette.danger,
      onPress: () => { onClose(); router.push({ pathname: '/onboarding', params: { step: '2' } }); },
    },
    {
      icon: 'compass-outline' as const,
      label: 'Explore News',
      color: palette.royalBlue,
      onPress: () => { onClose(); router.replace('/(tabs)/explore'); },
    },
    {
      icon: 'play-circle-outline' as const,
      label: 'View Welcome Screen',
      color: palette.mediumPurple,
      onPress: handleViewWelcomeScreenAgain,
    },
  ];

  if (!session) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={[s.card, { backgroundColor: colorScheme === 'dark' ? palette.darkPurple : '#FFFFFF' }]} onPress={() => {}}>
            <View style={s.closeRow}>
              <Pressable onPress={onClose}>
                <View style={[s.closeBtnCircle, { backgroundColor: c.cardSolid }]}>
                  <Ionicons name="close" size={16} color={c.text} />
                </View>
              </Pressable>
            </View>
            <View style={s.guestContent}>
              <Ionicons name="person-circle-outline" size={64} color={palette.mutedGray} />
              <Text style={[s.guestTitle, { color: c.text }]}>Sign in to SafeWay</Text>
              <Text style={[s.guestSub, { color: c.textSecondary }]}>
                Access saved places, emergency contacts, and more.
              </Text>
              <Pressable style={s.signInBtn} onPress={() => { onClose(); router.push('/login'); }}>
                <LinearGradient colors={[...Gradients.button]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
                <Text style={s.signInText}>Sign In</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.card, { backgroundColor: colorScheme === 'dark' ? palette.darkPurple : '#FFFFFF' }]} onPress={() => {}}>
          {/* Close */}
          <View style={s.closeRow}>
            <Pressable onPress={onClose}>
              <View style={[s.closeBtnCircle, { backgroundColor: c.cardSolid }]}>
                <Ionicons name="close" size={16} color={c.text} />
              </View>
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
            {/* Avatar + info */}
            <View style={s.avatarSection}>
              <LinearGradient colors={[palette.brightPurple, palette.royalBlue]} style={s.avatarCircle}>
                <Text style={s.avatarText}>{initials}</Text>
              </LinearGradient>
              <Text style={[s.displayName, { color: c.text }]}>{displayName}</Text>
              <Text style={[s.emailText, { color: c.textSecondary }]}>{email}</Text>
            </View>

            {/* Menu */}
            <View style={[s.menuCard, { backgroundColor: c.cardSolid, borderColor: c.divider }]}>
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
            <Pressable style={s.signOutRow} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={20} color={palette.danger} />
              <Text style={s.signOutText}>Sign Out</Text>
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card: { borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 40, maxHeight: '80%' },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  closeBtnCircle: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  scroll: { paddingBottom: 12 },

  guestContent: { alignItems: 'center', paddingVertical: 20, gap: 10 },
  guestTitle: { fontSize: 20, fontWeight: '700' },
  guestSub: { fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  signInBtn: { width: '100%', height: 48, borderRadius: 14, overflow: 'hidden', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  signInText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  avatarSection: { alignItems: 'center', marginBottom: 24 },
  avatarCircle: { width: 72, height: 72, borderRadius: 36, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  avatarText: { color: '#FFFFFF', fontSize: 26, fontWeight: '700' },
  displayName: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  emailText: { fontSize: 13 },

  menuCard: { borderRadius: 18, padding: 4, marginBottom: 20, borderWidth: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  menuIconWrap: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  menuDiv: { height: 1, marginLeft: 66 },

  signOutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
  signOutText: { color: palette.danger, fontSize: 15, fontWeight: '600' },
});

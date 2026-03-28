import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { palette, Colors, Gradients } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/auth-provider';
import { createEmergencyContact, updateUserSettings } from '@/lib/api';

const TOTAL_STEPS = 4;
const ONBOARDING_KEY = 'safeway_hasCompletedOnboarding';

type Contact = { name: string; phone: string; relationship: string };

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const jwt = session?.access_token ?? '';
  const colorScheme = useColorScheme() ?? 'light';
  const c = Colors[colorScheme];
  const params = useLocalSearchParams<{ step?: string }>();

  const [step, setStep] = useState(0);
  const [contacts, setContacts] = useState<Contact[]>([{ name: '', phone: '', relationship: '' }]);
  const [sosDirect911, setSosDirect911] = useState(true);
  const [sosSilentShare, setSosSilentShare] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const parsed = Number(params.step ?? '0');
    if (Number.isFinite(parsed)) {
      setStep(Math.min(Math.max(parsed, 0), TOTAL_STEPS - 1));
    }
  }, [params.step]);

  function handleSkip() {
    AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    router.replace('/(tabs)');
  }

  function handleNext() {
    if (step < TOTAL_STEPS - 1) {
      setStep(s => s + 1);
    } else {
      handleFinish();
    }
  }

  function handleBack() {
    if (step > 0) setStep(s => s - 1);
  }

  async function handleFinish() {
    setSaving(true);
    try {
      if (jwt) {
        for (const ct of contacts) {
          if (ct.name.trim() && ct.phone.trim()) {
            await createEmergencyContact(jwt, {
              name: ct.name.trim(),
              phone: ct.phone.trim(),
              relationship: ct.relationship.trim() || '',
            });
          }
        }
        await updateUserSettings(jwt, {
          sos_direct_911: sosDirect911,
          sos_silent_share: sosSilentShare,
        });
      }
    } catch (e) {
      console.log('Onboarding save error:', e);
    }
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setSaving(false);
    router.replace('/(tabs)');
  }

  function addContact() {
    if (contacts.length < 3) {
      setContacts([...contacts, { name: '', phone: '', relationship: '' }]);
    }
  }

  function updateContact(index: number, field: keyof Contact, value: string) {
    const updated = [...contacts];
    updated[index] = { ...updated[index], [field]: value };
    setContacts(updated);
  }

  function removeContact(index: number) {
    if (contacts.length > 1) {
      setContacts(contacts.filter((_, i) => i !== index));
    }
  }

  return (
    <View style={[s.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) + 100 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header with progress */}
        <View style={s.headerRow}>
          {step > 0 ? (
            <Pressable onPress={handleBack} style={s.backBtn}>
              <Ionicons name="arrow-back" size={22} color={c.text} />
            </Pressable>
          ) : <View style={s.backBtn} />}
          <Text style={[s.logoText, { color: c.text }]}>SafeWay</Text>
          <Pressable onPress={handleSkip}>
            <Text style={[s.skipText, { color: c.textSecondary }]}>Skip</Text>
          </Pressable>
        </View>

        {/* Progress bar */}
        <View style={s.progressWrap}>
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <View key={i} style={[s.progressSegment, { backgroundColor: c.divider }, i <= step && s.progressActive]} />
          ))}
        </View>

        {/* Step content */}
        {step === 0 && (
          <View style={s.stepContent}>
            <Ionicons name="shield-checkmark" size={64} color={palette.teal} style={s.stepIcon} />
            <Text style={[s.stepTitle, { color: c.text }]}>Welcome to SafeWay</Text>
            <Text style={[s.stepDesc, { color: c.textSecondary }]}>
              Your safety-first navigation companion. Let's set up a few things to keep you safe on every trip.
            </Text>

            <View style={s.featureList}>
              {[
                { icon: 'navigate-outline', title: 'Safer Routes', desc: 'AI-powered route safety scoring' },
                { icon: 'alert-circle-outline', title: 'SOS Emergency', desc: 'One-tap emergency alerts' },
                { icon: 'map-outline', title: 'Safety Heatmap', desc: 'Real crash data visualization' },
              ].map(f => (
                <View key={f.title} style={[s.featureCard, { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.divider }]}>
                  <View style={s.featureRow}>
                    <View style={[s.featureIconWrap, { backgroundColor: palette.brightPurple + '22' }]}>
                      <Ionicons name={f.icon as any} size={22} color={palette.brightPurple} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.featureTitle, { color: c.text }]}>{f.title}</Text>
                      <Text style={[s.featureDesc, { color: c.textSecondary }]}>{f.desc}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {step === 1 && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: c.text }]}>Emergency Contacts</Text>
            <Text style={[s.stepDesc, { color: c.textSecondary }]}>
              Your trusted circle will be notified instantly if you trigger an alert.
            </Text>

            {contacts.map((ct, i) => (
              <View key={i} style={[s.contactCard, { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.divider }]}>
                <View style={s.contactHeader}>
                  <View style={[s.priorityBadge, { backgroundColor: i === 0 ? palette.brightPurple : palette.teal }]}>
                    <Text style={s.priorityText}>{i === 0 ? 'PRIORITY' : 'SECONDARY'}</Text>
                  </View>
                  {contacts.length > 1 && (
                    <Pressable onPress={() => removeContact(i)}>
                      <Ionicons name="trash-outline" size={18} color={palette.danger} />
                    </Pressable>
                  )}
                </View>
                <TextInput
                  value={ct.name}
                  onChangeText={v => updateContact(i, 'name', v)}
                  placeholder="Full Name"
                  placeholderTextColor={palette.mutedGray}
                  style={[s.onboardInput, { backgroundColor: c.inputBg, color: c.inputText, borderColor: c.divider }]}
                />
                <TextInput
                  value={ct.phone}
                  onChangeText={v => updateContact(i, 'phone', v)}
                  placeholder="Phone Number"
                  placeholderTextColor={palette.mutedGray}
                  keyboardType="phone-pad"
                  style={[s.onboardInput, { backgroundColor: c.inputBg, color: c.inputText, borderColor: c.divider }]}
                />
                <TextInput
                  value={ct.relationship}
                  onChangeText={v => updateContact(i, 'relationship', v)}
                  placeholder="Relationship (e.g. Mother, Brother)"
                  placeholderTextColor={palette.mutedGray}
                  style={[s.onboardInput, { backgroundColor: c.inputBg, color: c.inputText, borderColor: c.divider }]}
                />
              </View>
            ))}

            {contacts.length < 3 && (
              <Pressable style={[s.addContactBtn, { borderColor: c.divider }]} onPress={addContact}>
                <Ionicons name="person-add-outline" size={20} color={palette.brightPurple} />
                <Text style={s.addContactText}>Add New Contact</Text>
              </Pressable>
            )}

            <Text style={s.encryptNote}>SafeWay uses encrypted connections to protect your data.</Text>
          </View>
        )}

        {step === 2 && (
          <View style={s.stepContent}>
            <Text style={[s.stepTitle, { color: c.text }]}>Emergency Settings</Text>
            <Text style={[s.stepDesc, { color: c.textSecondary }]}>
              Choose how SafeWay should respond when you trigger an SOS signal. You can change these at any time.
            </Text>

            <View style={[s.settingCard, { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.divider }]}>
              <View style={s.settingRow}>
                <View style={s.settingInfo}>
                  <View style={s.settingIconRow}>
                    <Ionicons name="call-outline" size={20} color={palette.teal} />
                    <Text style={[s.settingTitle, { color: c.text }]}>Direct 911</Text>
                  </View>
                  <Text style={[s.settingDesc, { color: c.textSecondary }]}>
                    Automatically calls emergency services immediately when SOS is triggered.
                  </Text>
                  <Text style={s.settingStatus}>
                    STATUS: {sosDirect911 ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
                <Switch
                  value={sosDirect911}
                  onValueChange={setSosDirect911}
                  trackColor={{ false: palette.mutedGray, true: palette.teal }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>

            <View style={[s.settingCard, { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.divider }]}>
              <View style={s.settingRow}>
                <View style={s.settingInfo}>
                  <View style={s.settingIconRow}>
                    <Ionicons name="radio-outline" size={20} color={palette.teal} />
                    <Text style={[s.settingTitle, { color: c.text }]}>Silent Share</Text>
                  </View>
                  <Text style={[s.settingDesc, { color: c.textSecondary }]}>
                    Discreetly shares your live location and audio recording with your emergency contacts.
                  </Text>
                  <Text style={s.settingStatus}>
                    STATUS: {sosSilentShare ? 'ACTIVE' : 'INACTIVE'}
                  </Text>
                </View>
                <Switch
                  value={sosSilentShare}
                  onValueChange={setSosSilentShare}
                  trackColor={{ false: palette.mutedGray, true: palette.teal }}
                  thumbColor="#FFFFFF"
                />
              </View>
            </View>
          </View>
        )}

        {step === 3 && (
          <View style={s.stepContent}>
            <Ionicons name="checkmark-circle" size={80} color={palette.teal} style={s.stepIcon} />
            <Text style={[s.stepTitle, { color: c.text }]}>You're All Set!</Text>
            <Text style={[s.stepDesc, { color: c.textSecondary }]}>
              SafeWay is ready to help you navigate safely. Your emergency contacts and SOS settings have been configured.
            </Text>

            <View style={[s.summaryCard, { backgroundColor: c.cardSolid, borderRadius: 16, borderWidth: 1, borderColor: c.divider }]}>
              <View style={s.summaryRow}>
                <Ionicons name="people-outline" size={20} color={palette.brightPurple} />
                <Text style={[s.summaryText, { color: c.text }]}>
                  {contacts.filter(ct => ct.name.trim()).length} emergency contact(s) added
                </Text>
              </View>
              <View style={[s.summaryDiv, { backgroundColor: c.divider }]} />
              <View style={s.summaryRow}>
                <Ionicons name="shield-checkmark-outline" size={20} color={palette.teal} />
                <Text style={[s.summaryText, { color: c.text }]}>
                  SOS: {sosDirect911 ? '911 active' : '911 off'} | {sosSilentShare ? 'Silent share on' : 'Silent share off'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Action button */}
        <Pressable style={[s.actionBtn, saving && { opacity: 0.6 }]} onPress={handleNext} disabled={saving}>
          <LinearGradient
            colors={[...Gradients.button]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
          <Text style={s.actionText}>
            {saving ? 'Saving...' : step === TOTAL_STEPS - 1 ? 'Start Navigating' : step === 0 ? "Let's Go" : 'Next'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 24 },

  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  backBtn: { width: 40 },
  logoText: { fontSize: 18, fontWeight: '700' },
  skipText: { fontSize: 14, fontWeight: '500' },

  progressWrap: { flexDirection: 'row', gap: 8, marginBottom: 32 },
  progressSegment: { flex: 1, height: 4, borderRadius: 2 },
  progressActive: { backgroundColor: palette.teal },

  stepContent: { marginBottom: 32 },
  stepIcon: { alignSelf: 'center', marginBottom: 20 },
  stepTitle: { fontSize: 28, fontWeight: '800', marginBottom: 10 },
  stepDesc: { fontSize: 15, lineHeight: 22, marginBottom: 24 },

  featureList: { gap: 12 },
  featureCard: { padding: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIconWrap: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  featureTitle: { fontSize: 16, fontWeight: '700' },
  featureDesc: { fontSize: 13, marginTop: 2 },

  contactCard: { padding: 16, marginBottom: 12, gap: 10 },
  contactHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priorityBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 },
  priorityText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  onboardInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
  },

  addContactBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderWidth: 1.5,
    borderRadius: 16,
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  addContactText: { color: palette.brightPurple, fontSize: 14, fontWeight: '600' },
  encryptNote: { color: palette.mutedGray, fontSize: 12, textAlign: 'center' },

  settingCard: { padding: 20, marginBottom: 14 },
  settingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  settingInfo: { flex: 1 },
  settingIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  settingTitle: { fontSize: 16, fontWeight: '700' },
  settingDesc: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  settingStatus: { color: palette.teal, fontSize: 11, fontWeight: '700', letterSpacing: 1 },

  summaryCard: { padding: 20, gap: 14 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryText: { fontSize: 14, fontWeight: '500' },
  summaryDiv: { height: 1 },

  actionBtn: {
    height: 56,
    borderRadius: 16,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});

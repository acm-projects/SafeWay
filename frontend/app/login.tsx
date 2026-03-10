import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/providers/auth-provider';

const BG        = '#0B1120';
const NAVY_CARD = '#141D2E';
const TEXT      = '#FFFFFF';
const MUTED     = '#7A8FA6';
const INPUT_BG  = '#F0F4F8';
const DIVIDER   = '#1E2D45';

// Gradient via two-tone row of Views
function GradientButton({ label, onPress, busy, disabled }: {
  label: string; onPress: () => void; busy: boolean; disabled: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[gb.wrap, disabled && gb.disabled]}>
      {/* left half */}
      <View style={[gb.half, { backgroundColor: '#1ABC93', borderTopLeftRadius: 14, borderBottomLeftRadius: 14 }]} />
      {/* right half — slightly lighter teal→green */}
      <View style={[gb.half, { backgroundColor: '#7ED4A0', borderTopRightRadius: 14, borderBottomRightRadius: 14 }]} />
      {/* centre overlay for smooth blend */}
      <View style={gb.midBlend} />
      {/* label on top */}
      <View style={gb.labelWrap}>
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={gb.label}>{label}</Text>}
      </View>
    </Pressable>
  );
}

const gb = StyleSheet.create({
  wrap: { width: '100%', height: 54, borderRadius: 14, overflow: 'hidden', flexDirection: 'row', marginBottom: 18 },
  disabled: { opacity: 0.6 },
  half: { flex: 1, height: '100%' },
  midBlend: { position: 'absolute', left: '35%', right: '35%', top: 0, bottom: 0, backgroundColor: '#4FC9A0', opacity: 0.55 },
  labelWrap: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  label: { color: '#fff', fontSize: 18, fontWeight: '700' },
});

export default function LoginScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [isSignUp, setIsSignUp]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [showPass, setShowPass]     = useState(false);

  function goHome() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }

  async function handleAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (isSignUp) {
        await signUpWithPassword(email.trim(), password);
        Alert.alert('Check your inbox', 'Confirm your email then sign in.');
      } else {
        await signInWithPassword(email.trim(), password);
        goHome();
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Authentication failed.');
    } finally { setBusy(false); }
  }

  async function handleGoogle() {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      goHome();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!msg.toLowerCase().includes('cancel')) {
        Alert.alert('Google sign in failed', msg || 'Try again.');
      }
    } finally { setGoogleBusy(false); }
  }

  const anyBusy = busy || googleBusy;

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Logo */}
        <View style={s.logoWrap}>
          <Image source={require('../assets/safeway-logo.png')} style={s.logo} resizeMode="contain" />
        </View>
        <Text style={s.appName}>SafeWay</Text>
        <Text style={s.tagline}>Navigate Safer, Arrive Better</Text>

        {/* Inputs */}
        <View style={s.inputsWrap}>
          <TextInput value={email} onChangeText={setEmail}
            placeholder="Email Address" placeholderTextColor={MUTED}
            keyboardType="email-address" autoCapitalize="none" style={s.input} />
          <View style={s.passRow}>
            <TextInput value={password} onChangeText={setPassword}
              placeholder="Password" placeholderTextColor={MUTED}
              secureTextEntry={!showPass} style={[s.input, s.passInput]} />
            <Pressable style={s.eyeBtn} onPress={() => setShowPass(p => !p)}>
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={MUTED} />
            </Pressable>
          </View>
        </View>

        {/* Gradient login button */}
        <GradientButton
          label={isSignUp ? 'Create Account' : 'Login'}
          onPress={handleAuth} busy={busy} disabled={anyBusy} />

        {/* Divider */}
        <View style={s.divRow}>
          <View style={s.divLine} />
          <Text style={s.divText}>or</Text>
          <View style={s.divLine} />
        </View>

        {/* Google */}
        <Pressable style={[s.googleBtn, anyBusy && s.disabled]} onPress={handleGoogle} disabled={anyBusy}>
          {googleBusy ? <ActivityIndicator color={TEXT} /> : (
            <>
              <View style={s.gIconWrap}><Text style={s.gG}>G</Text></View>
              <Text style={s.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {/* Quick Access */}
        {!isSignUp && (
          <View style={s.quickWrap}>
            <Text style={s.quickLabel}>QUICK ACCESS</Text>
            <Pressable style={s.faceBtn}>
              <Ionicons name="scan-outline" size={32} color={TEXT} />
            </Pressable>
            <Text style={s.faceText}>Tap To Use Face ID</Text>
          </View>
        )}

        {/* Toggle */}
        <Pressable onPress={() => setIsSignUp(p => !p)} style={s.toggle}>
          <Text style={s.toggleText}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Text style={s.toggleAction}>{isSignUp ? 'Sign In' : 'Sign-Up'}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  scroll: { alignItems: 'center', paddingHorizontal: 28 },
  logoWrap: { width: 110, height: 110, marginBottom: 16, marginTop: 8, borderRadius: 22, overflow: 'hidden' },
  logo: { width: 110, height: 110 },
  appName: { color: TEXT, fontSize: 34, fontWeight: '800', marginBottom: 6 },
  tagline: { color: MUTED, fontSize: 15, marginBottom: 36 },
  inputsWrap: { width: '100%', gap: 14, marginBottom: 20 },
  input: { width: '100%', backgroundColor: INPUT_BG, borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, fontSize: 16, color: '#1A2B3C' },
  passRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: INPUT_BG, borderRadius: 14 },
  passInput: { flex: 1, width: undefined },
  eyeBtn: { paddingHorizontal: 16 },
  disabled: { opacity: 0.6 },
  divRow: { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12, marginBottom: 18 },
  divLine: { flex: 1, height: 1, backgroundColor: DIVIDER },
  divText: { color: MUTED, fontSize: 13 },
  googleBtn: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: NAVY_CARD, borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: DIVIDER, marginBottom: 32 },
  gIconWrap: { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  gG: { color: '#4285F4', fontSize: 15, fontWeight: '800' },
  googleText: { color: TEXT, fontSize: 16, fontWeight: '600' },
  quickWrap: { alignItems: 'center', gap: 12, marginBottom: 36 },
  quickLabel: { color: TEXT, fontSize: 11, fontWeight: '700', letterSpacing: 1.8 },
  faceBtn: { width: 60, height: 60, borderRadius: 16, borderWidth: 2, borderColor: TEXT, justifyContent: 'center', alignItems: 'center' },
  faceText: { color: MUTED, fontSize: 13 },
  toggle: { marginTop: 4 },
  toggleText: { color: TEXT, fontSize: 15, textAlign: 'center' },
  toggleAction: { color: '#1ABC93', fontWeight: '700' },
});
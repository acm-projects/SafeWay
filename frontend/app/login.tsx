import { useEffect, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/providers/auth-provider';
import { useTheme } from '@/providers/theme-context';

export default function LoginScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle, session } = useAuth();
  const insets = useSafeAreaInsets();
  const { T } = useTheme();

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [isSignUp, setIsSignUp]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [showPass, setShowPass]     = useState(false);

  useEffect(() => {
    if (session) router.replace('/(tabs)');
  }, [session]);

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
      }
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      if (!msg.toLowerCase().includes('cancel')) {
        Alert.alert('Google sign in failed', msg || 'Try again.');
      }
    } finally {
      setGoogleBusy(false);
    }
  }

  const anyBusy = busy || googleBusy;

  // Light mode: purple-accented white theme
  const inputBg       = T.isDark ? '#F0F4F8' : '#EEF0F8';
  const inputColor    = '#1A2B3C';
  const googleBtnBg   = T.isDark ? '#1A1A1A' : '#FFFFFF'; /* Previous: '#141D2E' */
  const googleBorder  = T.isDark ? '#2A2A2A' : '#DDE0F0'; /* Previous: '#1E2D45' */
  const googleTextCol = T.isDark ? '#FFFFFF' : T.TEXT_PRI;
  const dividerCol    = T.isDark ? '#1E2D45' : '#DDE0F0';
  const faceBorderCol = T.isDark ? '#FFFFFF' : T.PURPLE;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.BG }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo */}
        <View style={s.logoWrap}>
          <Image source={require('../assets/safeway-logo.png')} style={s.logo} resizeMode="contain" />
        </View>
        <Text style={[s.appName, { color: T.TEXT_PRI }]}>SafeWay</Text>
        <Text style={[s.tagline, { color: T.TEXT_MUT }]}>Navigate Safer, Arrive Better</Text>

        {/* Inputs */}
        <View style={s.inputsWrap}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email Address"
            placeholderTextColor={T.TEXT_MUT}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[s.input, { backgroundColor: inputBg, color: inputColor }]}
          />
          <View style={[s.passRow, { backgroundColor: inputBg }]}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={T.TEXT_MUT}
              secureTextEntry={!showPass}
              style={[s.input, s.passInput, { backgroundColor: 'transparent', color: inputColor }]}
            />
            <Pressable style={s.eyeBtn} onPress={() => setShowPass(p => !p)}>
              <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={20} color={T.TEXT_MUT} />
            </Pressable>
          </View>
        </View>

        {/* Gradient Login / Sign Up button */}
        <Pressable style={[s.gradBtn, anyBusy && s.disabled]} onPress={handleAuth} disabled={anyBusy}>
          <LinearGradient
            colors={['#0A9E6E', '#1ABC93', '#44D9B8']}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={s.gradBtnContent}>
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.gradBtnLabel}>{isSignUp ? 'Create Account' : 'Login'}</Text>
            }
          </View>
        </Pressable>

        {/* Divider */}
        <View style={s.divRow}>
          <View style={[s.divLine, { backgroundColor: dividerCol }]} />
          <Text style={[s.divText, { color: T.TEXT_MUT }]}>or</Text>
          <View style={[s.divLine, { backgroundColor: dividerCol }]} />
        </View>

        {/* Google */}
        <Pressable
          style={[s.googleBtn, { backgroundColor: googleBtnBg, borderColor: googleBorder }, anyBusy && s.disabled]}
          onPress={handleGoogle} disabled={anyBusy}
        >
          {googleBusy
            ? <ActivityIndicator color={T.TEXT_PRI} />
            : (
              <>
                <View style={s.gIconWrap}><Text style={s.gG}>G</Text></View>
                <Text style={[s.googleText, { color: googleTextCol }]}>Continue with Google</Text>
              </>
            )
          }
        </Pressable>

        {/* Quick Access */}
        {!isSignUp && (
          <View style={s.quickWrap}>
            <Text style={[s.quickLabel, { color: T.TEXT_PRI }]}>QUICK ACCESS</Text>
            <Pressable style={[s.faceBtn, { borderColor: faceBorderCol }]}>
              <Ionicons name="scan-outline" size={32} color={T.isDark ? '#FFFFFF' : T.PURPLE} />
            </Pressable>
            <Text style={[s.faceText, { color: T.TEXT_MUT }]}>Tap To Use Face ID</Text>
          </View>
        )}

        {/* Toggle */}
        <Pressable onPress={() => setIsSignUp(p => !p)} style={s.toggle}>
          <Text style={[s.toggleText, { color: T.TEXT_PRI }]}>
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Text style={s.toggleAction}>{isSignUp ? 'Sign In' : 'Sign-Up'}</Text>
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  scroll:       { alignItems: 'center', paddingHorizontal: 28 },
  logoWrap:     { width: 110, height: 110, marginBottom: 16, marginTop: 8, borderRadius: 22, overflow: 'hidden' },
  logo:         { width: 110, height: 110 },
  appName:      { fontSize: 34, fontWeight: '800', marginBottom: 6 },
  tagline:      { fontSize: 15, marginBottom: 36 },
  inputsWrap:   { width: '100%', gap: 14, marginBottom: 20 },
  input:        { width: '100%', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 16, fontSize: 16 },
  passRow:      { flexDirection: 'row', alignItems: 'center', borderRadius: 14 },
  passInput:    { flex: 1, width: undefined },
  eyeBtn:       { paddingHorizontal: 16 },
  gradBtn:      { width: '100%', height: 54, borderRadius: 14, overflow: 'hidden', marginBottom: 18 },
  disabled:     { opacity: 0.6 },
  gradBtnContent: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  gradBtnLabel: { color: '#fff', fontSize: 18, fontWeight: '700' },
  divRow:       { flexDirection: 'row', alignItems: 'center', width: '100%', gap: 12, marginBottom: 18 },
  divLine:      { flex: 1, height: 1 },
  divText:      { fontSize: 13 },
  googleBtn:    { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, marginBottom: 32 },
  gIconWrap:    { width: 26, height: 26, borderRadius: 13, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  gG:           { color: '#4285F4', fontSize: 15, fontWeight: '800' },
  googleText:   { fontSize: 16, fontWeight: '600' },
  quickWrap:    { alignItems: 'center', gap: 12, marginBottom: 36 },
  quickLabel:   { fontSize: 11, fontWeight: '700', letterSpacing: 1.8 },
  faceBtn:      { width: 60, height: 60, borderRadius: 16, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  faceText:     { fontSize: 13 },
  toggle:       { marginTop: 4 },
  toggleText:   { fontSize: 15, textAlign: 'center' },
  toggleAction: { color: '#1ABC93', fontWeight: '700' },
});
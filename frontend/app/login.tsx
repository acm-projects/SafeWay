import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '@/providers/auth-provider';
import { Gradients, palette } from '@/constants/theme';

const UI = { card: '#FFFFFF', text: '#000000', textSec: '#333333', inputBg: '#F8F7FF', border: '#E5E7EB' };

export default function LoginScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle, session } = useAuth();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const [email, setEmail]           = useState('');
  const [password, setPassword]     = useState('');
  const [isSignUp, setIsSignUp]     = useState(false);
  const [busy, setBusy]             = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [showPass, setShowPass]     = useState(false);

  useEffect(() => {
    if (session) {
      router.replace('/(tabs)');
    }
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

  function handleSkip() {
    router.replace('/(tabs)');
  }

  const anyBusy = busy || googleBusy;

  return (
    <ImageBackground
      source={require('../assets/images/landing-bg.png')}
      style={[s.container, { backgroundColor: '#1A0A2E', minWidth: width, minHeight: height }]}
      resizeMode="cover"
    >
      {/* White-ish fade overlay at bottom only */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.95)']}
        locations={[0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: Math.max(insets.bottom, 12) + 100 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Skip */}
          <Pressable style={s.skipBtn} onPress={handleSkip}>
            <Text style={s.skipText}>Skip</Text>
          </Pressable>

          {/* Logo */}
          <View style={s.logoWrap}>
            <Image source={require('../assets/safeway-logo.png')} style={s.logo} resizeMode="contain" />
          </View>
          <Text style={s.appName}>SafeWay</Text>

          {/* Form card */}
          <View style={[s.formCard, { backgroundColor: UI.card, borderRadius: 24, borderWidth: 1, borderColor: UI.border, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 12, elevation: 4 }]}>
            <Text style={[s.formTitle, { color: UI.text }]}>{isSignUp ? 'Create Account' : 'Welcome Back'}</Text>
            <Text style={[s.formSubtitle, { color: UI.textSec }]}>
              {isSignUp ? 'Sign up to start navigating safely' : 'Sign in to continue'}
            </Text>

            {/* Email */}
            <View style={s.inputWrap}>
              <Text style={[s.inputLabel, { color: UI.text }]}>Email Address</Text>
              <View style={[s.inputRow, { backgroundColor: UI.inputBg, borderColor: UI.border }]}>
                <Ionicons name="mail-outline" size={18} color={palette.mutedGray} style={s.inputIcon} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="name@company.com"
                  placeholderTextColor={UI.textSec}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={s.input}
                />
              </View>
            </View>

            {/* Password */}
            <View style={s.inputWrap}>
              <View style={s.passwordHeader}>
                <Text style={s.inputLabel}>Password</Text>
                {!isSignUp && (
                  <Pressable onPress={() => Alert.alert('Forgot Password', 'A password reset email feature would go here.')}>
                    <Text style={s.forgotText}>Forgot Password?</Text>
                  </Pressable>
                )}
              </View>
              <View style={[s.inputRow, { backgroundColor: UI.inputBg, borderColor: UI.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={palette.mutedGray} style={s.inputIcon} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  placeholderTextColor={UI.textSec}
                  secureTextEntry={!showPass}
                  style={[s.input, { flex: 1 }]}
                />
                <Pressable style={s.eyeBtn} onPress={() => setShowPass(p => !p)}>
                  <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={palette.mutedGray} />
                </Pressable>
              </View>
            </View>

            {/* Primary button */}
            <Pressable
              style={[s.primaryBtn, anyBusy && s.disabled]}
              onPress={handleAuth}
              disabled={anyBusy}
            >
              <LinearGradient
                colors={[...Gradients.button]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
              />
              <View style={s.btnContent}>
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.btnLabel}>{isSignUp ? 'Create Account' : 'Log In'}</Text>
                }
              </View>
            </Pressable>

            {/* Divider */}
            <View style={s.divRow}>
              <View style={[s.divLine, { backgroundColor: UI.border }]} />
              <Text style={[s.divText, { color: UI.textSec }]}>OR CONTINUE WITH</Text>
              <View style={s.divLine} />
            </View>

            {/* OAuth buttons */}
            <View style={s.oauthRow}>
              <Pressable style={[s.oauthBtn, { backgroundColor: UI.inputBg, borderColor: UI.border }, anyBusy && s.disabled]} onPress={handleGoogle} disabled={anyBusy}>
                {googleBusy
                  ? <ActivityIndicator color={palette.brightPurple} size="small" />
                  : (
                    <>
                      <View style={s.gIconWrap}><Text style={s.gG}>G</Text></View>
                      <Text style={[s.oauthText, { color: UI.text }]}>Google</Text>
                    </>
                  )
                }
              </Pressable>
              {Platform.OS === 'ios' && (
                <Pressable style={[s.oauthBtn, { backgroundColor: UI.inputBg, borderColor: UI.border }, anyBusy && s.disabled]} disabled={anyBusy}>
                  <Ionicons name="logo-apple" size={20} color={UI.text} />
                  <Text style={[s.oauthText, { color: UI.text }]}>Apple</Text>
                </Pressable>
              )}
            </View>

            {/* Toggle */}
            <Pressable onPress={() => setIsSignUp(p => !p)} style={s.toggle}>
              <Text style={[s.toggleText, { color: UI.textSec }]}>
                {isSignUp ? 'Already have an account? ' : 'New to SafeWay? '}
                <Text style={s.toggleAction}>{isSignUp ? 'Sign In' : 'Create Account'}</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  scroll: { alignItems: 'center', paddingHorizontal: 24 },

  skipBtn: { alignSelf: 'flex-end', paddingHorizontal: 8, paddingVertical: 6, marginBottom: 8 },
  skipText: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontWeight: '500' },

  logoWrap: { width: 80, height: 80, marginBottom: 10, borderRadius: 20, overflow: 'hidden' },
  logo: { width: 80, height: 80 },
  appName: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', marginBottom: 24, letterSpacing: 0.5 },

  formCard: { width: '100%', padding: 24, marginBottom: 20 },
  formTitle: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', marginBottom: 4 },
  formSubtitle: { color: palette.mutedGray, fontSize: 14, marginBottom: 24 },

  inputWrap: { marginBottom: 16 },
  inputLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  passwordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forgotText: { color: palette.brightPurple, fontSize: 13, fontWeight: '600' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: '#1A0A2E', fontSize: 15, paddingVertical: 14 },
  eyeBtn: { paddingHorizontal: 8, paddingVertical: 4 },

  primaryBtn: { width: '100%', height: 52, borderRadius: 14, overflow: 'hidden', marginTop: 8, marginBottom: 20 },
  disabled: { opacity: 0.6 },
  btnContent: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  btnLabel: { color: '#fff', fontSize: 17, fontWeight: '700' },

  divRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  divText: { color: palette.mutedGray, fontSize: 11, fontWeight: '600', letterSpacing: 1 },

  oauthRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  oauthBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  gIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center' },
  gG: { color: '#4285F4', fontSize: 13, fontWeight: '800' },
  oauthText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },

  toggle: { alignItems: 'center' },
  toggleText: { color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center' },
  toggleAction: { color: palette.brightPurple, fontWeight: '700' },
});

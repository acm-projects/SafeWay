import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { ThemedText } from '@/components/themed-text';
import { AppTheme } from '@/constants/theme';
import { useAuth } from '@/providers/auth-provider';

export default function LoginScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithGoogle } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUpMode, setIsSignUpMode] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleEmailAuth() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Please enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (isSignUpMode) {
        await signUpWithPassword(email.trim(), password);
        Alert.alert('Check your inbox', 'Confirm your email, then sign in.');
      } else {
        await signInWithPassword(email.trim(), password);
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/');
        }
      }
    } catch (error) {
      Alert.alert('Auth error', error instanceof Error ? error.message : 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleAuth() {
    setBusy(true);
    try {
      await signInWithGoogle();
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    } catch (error) {
      Alert.alert('Google sign in failed', error instanceof Error ? error.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrapper}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled">
        {/* Back button */}
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={AppTheme.palette.midnightViolet} />
        </Pressable>

        <View style={styles.header}>
          <ThemedText style={styles.title}>SafeWay</ThemedText>
          <ThemedText style={styles.subtitle}>Navigate safer routes</ThemedText>
        </View>

        <View style={styles.card}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor="#FCFCFC55"
            autoCapitalize="none"
            style={styles.input}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor="#FCFCFC55"
            secureTextEntry
            style={styles.input}
          />
          <Pressable
            style={[styles.button, styles.primaryButton, busy && styles.disabled]}
            onPress={handleEmailAuth}
            disabled={busy}>
            {busy ? (
              <ActivityIndicator size="small" color={AppTheme.palette.white} />
            ) : (
              <ThemedText style={styles.buttonText}>
                {isSignUpMode ? 'Create account' : 'Sign in'}
              </ThemedText>
            )}
          </Pressable>
          <Pressable
            style={[styles.button, styles.googleButton, busy && styles.disabled]}
            onPress={handleGoogleAuth}
            disabled={busy}>
            <ThemedText style={styles.buttonText}>Continue with Google</ThemedText>
          </Pressable>
        </View>

        <Pressable onPress={() => setIsSignUpMode((prev) => !prev)} style={styles.toggleLink}>
          <ThemedText style={styles.toggleText}>
            {isSignUpMode ? 'Already have an account? Sign in' : 'Need an account? Sign up'}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: AppTheme.palette.white,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: AppTheme.spacing.xl,
    gap: AppTheme.spacing.xxl,
  },
  backButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    padding: AppTheme.spacing.sm,
  },
  header: {
    alignItems: 'center',
    gap: AppTheme.spacing.xs,
  },
  title: {
    color: AppTheme.palette.midnightViolet,
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 1,
  },
  subtitle: {
    color: AppTheme.palette.rosewood,
    fontSize: AppTheme.typography.body,
  },
  card: {
    backgroundColor: AppTheme.palette.midnightViolet,
    borderRadius: AppTheme.radius.lg,
    padding: AppTheme.spacing.xl,
    gap: AppTheme.spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: '#FCFCFC20',
    borderRadius: AppTheme.radius.md,
    backgroundColor: '#FCFCFC10',
    paddingHorizontal: AppTheme.spacing.lg,
    paddingVertical: 14,
    color: AppTheme.palette.white,
    fontSize: AppTheme.typography.body,
  },
  button: {
    borderRadius: AppTheme.radius.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  primaryButton: {
    backgroundColor: AppTheme.palette.teal,
  },
  googleButton: {
    backgroundColor: AppTheme.palette.rosewood,
  },
  disabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: AppTheme.palette.white,
    fontWeight: '600',
    fontSize: 15,
  },
  toggleLink: {
    alignItems: 'center',
  },
  toggleText: {
    color: AppTheme.palette.teal,
    fontSize: AppTheme.typography.caption,
    fontWeight: '500',
  },
});

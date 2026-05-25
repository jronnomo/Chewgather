import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Animated,
  LayoutAnimation,
  UIManager,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Mail, Lock, User, Phone, ChevronRight, Eye, EyeOff, CheckCircle, Ticket } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import { updateProfile } from '../services/auth';
import type { UserPreferences } from '../types';
import { useThemeTransition, buildSignInChompConfig, buildSignUpChompConfig, buildGuestEntryChompConfig } from '../context/ThemeTransitionContext';
import NibbleFeedback from '../components/NibbleFeedback';
import CrumbTrail from '../components/CrumbTrail';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import { readPendingPicks, clearPendingPicks } from '../lib/pendingPicks';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const Colors = StaticColors;

type Tab = 'signin' | 'signup';

type FieldErrors = {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  form?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(val: string): boolean {
  return EMAIL_RE.test(val.trim());
}

function mapErrorToFields(message: string, tab: Tab): FieldErrors {
  // Network / timeout — not field errors
  if (message.includes('Cannot connect to server') || message.includes('Request timed out')) {
    return { form: message };
  }

  // Rate limiting
  if (message.includes('Too many')) {
    return { form: 'Too many attempts. Please wait a minute and try again.' };
  }

  // Server error
  if (message === 'Server error') {
    return { form: 'Something went wrong on our end. Please try again.' };
  }

  // Login errors
  if (tab === 'signin') {
    if (message === 'Invalid credentials') {
      return {
        password: "That email and password combo didn't work. Double-check and try again.",
      };
    }
    if (message === 'Password must be at least 8 characters') {
      return { password: 'Password must be at least 8 characters.' };
    }
  }

  // Register errors
  if (tab === 'signup') {
    if (message === 'Email already registered') {
      return { email: 'This email already has an account. Try signing in instead.' };
    }
    if (message === 'Invalid email format') {
      return { email: 'Please enter a valid email address.' };
    }
    if (message === 'Password must be at least 8 characters') {
      return { password: 'Password must be at least 8 characters.' };
    }
    if (message === 'name, email, and password are required') {
      return { form: 'Please fill in all required fields.' };
    }
  }

  // Fallback
  return { form: message };
}

function InlineFieldError({ message }: { message?: string }) {
  const Colors = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-8)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message) {
      setVisible(true);
      translateY.setValue(-8);
      opacity.setValue(0);
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 200,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setVisible(false);
      });
    }
  }, [message]);

  if (!visible && !message) return null;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '500',
          color: Colors.error,
          paddingLeft: 14,
          marginTop: 4,
        }}
      >
        {message ?? ''}
      </Text>
    </Animated.View>
  );
}

function ChecklistItem({ label, met }: { label: string; met: boolean }) {
  const Colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const prevMet = useRef(false);

  useEffect(() => {
    if (met && !prevMet.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 80, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 10, stiffness: 200 }),
      ]).start();
    }
    prevMet.current = met;
  }, [met]);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <CheckCircle
          size={14}
          color={met ? Colors.success : Colors.textTertiary}
        />
      </Animated.View>
      <Text
        style={{
          fontSize: 12,
          color: met ? Colors.success : Colors.textTertiary,
          marginLeft: 6,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ReadyBadge() {
  const Colors = useColors();
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      damping: 12,
      stiffness: 200,
    }).start();
  }, []);

  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 4,
        transform: [{ scale }],
      }}
    >
      <CheckCircle size={14} color={Colors.success} />
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: Colors.success,
          marginLeft: 6,
        }}
      >
        Ready!
      </Text>
    </Animated.View>
  );
}

function PasswordChecklist({ password }: { password: string }) {
  const Colors = useColors();
  const prevMet = useRef<Record<string, boolean>>({});
  const lengthMet = password.length >= 8;
  const digitMet = /\d/.test(password);
  const letterMet = /[A-Za-z]/.test(password);
  const allMet = lengthMet && digitMet && letterMet;

  useEffect(() => {
    if (allMet && !prevMet.current.all) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevMet.current.all = allMet;
  }, [allMet]);

  return (
    <View
      style={{
        marginTop: 6,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        backgroundColor: Colors.surfaceElevated,
      }}
    >
      {allMet ? (
        <ReadyBadge />
      ) : (
        <>
          <ChecklistItem
            label={`8+ characters (${password.length}/8)`}
            met={lengthMet}
          />
          <ChecklistItem label="Contains a number" met={digitMet} />
          <ChecklistItem label="Contains a letter" met={letterMet} />
        </>
      )}
    </View>
  );
}

function hasNonDefaultPreferences(prefs: Omit<UserPreferences, 'name'>): boolean {
  return prefs.cuisines.length > 0
    || prefs.budget.some((b) => b !== '$$')
    || prefs.dietary.length > 0
    || prefs.atmosphere.some((a) => a !== 'Moderate')
    || prefs.groupSize.some((g) => g !== '2')
    || prefs.distance !== '5';
}

export default function AuthScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { intent, invite } = useLocalSearchParams<{ intent?: string; invite?: string | string[] }>();
  const { signIn, signUp } = useAuth();
  const { setGuestMode, isGuest, preferences } = useApp();
  const { requestChomp } = useThemeTransition();

  const [tab, setTab] = useState<Tab>(intent === 'signup' ? 'signup' : 'signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodePrefilled, setInviteCodePrefilled] = useState(false);

  // Inline field errors
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [emailValid, setEmailValid] = useState(false);
  const [nameValid, setNameValid] = useState(false);

  // Track which fields should show error border without error text
  // (used for "Invalid credentials" where both fields are implicated)
  const [errorBorderFields, setErrorBorderFields] = useState<Set<string>>(new Set());

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const inviteCodeRef = useRef<TextInput>(null);

  const clearForm = useCallback((newTab: Tab) => {
    setTab(newTab);
    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
    setInviteCode('');
    setInviteCodePrefilled(false);
    setShowPassword(false);
    setFieldErrors({});
    setPasswordTouched(false);
    setEmailValid(false);
    setNameValid(false);
    setErrorBorderFields(new Set());
  }, []);

  const handleEmailChange = useCallback((val: string) => {
    setEmail(val);
    const valid = isValidEmail(val);
    setEmailValid(valid);
    // Only clear error once the email becomes valid — not on every keystroke (#164)
    if (valid && fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
    if (valid && errorBorderFields.has('email')) {
      setErrorBorderFields(new Set());
    }
  }, [fieldErrors.email, errorBorderFields]);

  const handleNameChange = useCallback((val: string) => {
    setName(val);
    if (fieldErrors.name) {
      setFieldErrors((prev) => ({ ...prev, name: undefined }));
    }
    setNameValid(val.trim().length >= 2);
  }, [fieldErrors.name]);

  const handlePhoneChange = useCallback((val: string) => {
    setPhone(val);
    if (fieldErrors.phone) {
      setFieldErrors((prev) => ({ ...prev, phone: undefined }));
    }
  }, [fieldErrors.phone]);

  const handleInviteCodeChange = useCallback((val: string) => {
    setInviteCode(val.toUpperCase());
    setInviteCodePrefilled(false);
  }, []);

  // One-shot prefill on mount: read ?invite= param from the deep link
  useEffect(() => {
    const raw = Array.isArray(invite) ? invite[0] : invite;
    if (raw && tab === 'signup') {
      setInviteCode(raw.toUpperCase().slice(0, 8));
      setInviteCodePrefilled(true);
    }
  // intentionally empty deps — one-shot on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePasswordChange = useCallback((val: string) => {
    setPassword(val);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
    if (errorBorderFields.has('password')) {
      setErrorBorderFields(new Set());
    }
    if (!passwordTouched && val.length > 0) {
      setPasswordTouched(true);
    }
  }, [fieldErrors.password, passwordTouched, errorBorderFields]);

  const handleSubmit = useCallback(async () => {
    setFieldErrors({});
    setErrorBorderFields(new Set());

    // Client-side validation
    const errors: FieldErrors = {};

    if (tab === 'signup' && !name.trim()) {
      errors.name = 'Please enter your full name.';
    }
    if (!email.trim()) {
      errors.email = 'Email address is required.';
    } else if (!isValidEmail(email)) {
      errors.email = 'Please enter a valid email address.';
    }
    if (!password.trim()) {
      errors.password = 'Password is required.';
    } else if (tab === 'signup') {
      // Mirror PasswordChecklist: length 8+, contains digit, contains letter.
      if (password.length < 8) {
        errors.password = 'Password must be at least 8 characters.';
        setPasswordTouched(true);
      } else if (!/\d/.test(password)) {
        errors.password = 'Password must contain a number.';
        setPasswordTouched(true);
      } else if (!/[A-Za-z]/.test(password)) {
        errors.password = 'Password must contain a letter.';
        setPasswordTouched(true);
      }
    }
    // Phone is optional, but if provided it must be a plausible number.
    // Strip separators ((), -, space, +) and require 7–15 digits, matching
    // the ITU E.164 max length while allowing 7-digit US locals.
    if (tab === 'signup' && phone.trim()) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) {
        errors.phone = 'Please enter a valid phone number.';
      }
    }

    if (Object.keys(errors).length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFieldErrors(errors);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      if (tab === 'signin') {
        const returnedUser = await signIn(email.trim(), password);
        await clearPendingPicks(); // HIGH-4: clear any stale guest picks from a previous guest session
        if (returnedUser.preferences) {
          await AsyncStorage.setItem('chewabl_onboarded', 'true');
          requestChomp(buildSignInChompConfig(Colors.primary), () => {
            router.replace('/(tabs)' as never);
          });
        } else {
          requestChomp(buildSignInChompConfig(Colors.primary), () => {
            router.replace('/onboarding' as never);
          });
        }
      } else {
        const wasGuest = isGuest;
        const { name: _n, ...migrablePrefs } = preferences;
        await signUp(name.trim(), email.trim(), password, phone.trim() || undefined, inviteCode.trim() || undefined);

        // Preference migration — unchanged, runs before routing branch
        if (wasGuest && hasNonDefaultPreferences(migrablePrefs)) {
          try {
            await updateProfile({ preferences: migrablePrefs as UserPreferences });
          } catch {
            // best-effort — discard error, never blocks signup
          }
        }

        // Read pending picks BEFORE requestChomp — awaited here (not in callback) to avoid latency
        const pending = wasGuest ? await readPendingPicks() : [];

        requestChomp(buildSignUpChompConfig(Colors.primary), () => {
          if (pending.length > 0) {
            router.replace('/review-picks' as never);
          } else {
            router.replace('/onboarding' as never);
          }
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';

      if (message.includes('Cannot connect to server')) {
        Alert.alert(
          'Server Unavailable',
          'The server is not reachable right now. You can continue as a guest to explore the app — your preferences will be saved locally.',
          [
            { text: 'Try Again', style: 'cancel' },
            {
              text: 'Continue as Guest',
              onPress: async () => {
                await setGuestMode(true);
                await AsyncStorage.setItem('chewabl_onboarded', 'true');
                requestChomp(buildGuestEntryChompConfig(Colors.primary), () => {
                  router.replace('/(tabs)' as never);
                });
              },
            },
          ]
        );
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const mapped = mapErrorToFields(message, tab);

      // For "Invalid credentials" on login, mark email border red too
      if (message === 'Invalid credentials') {
        setErrorBorderFields(new Set(['email']));
      }

      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFieldErrors(mapped);
    } finally {
      setLoading(false);
    }
  }, [tab, name, email, password, phone, inviteCode, signIn, signUp, router, setGuestMode, requestChomp, Colors.primary, isGuest, preferences]);

  const hasEmailError = !!fieldErrors.email || errorBorderFields.has('email');
  const hasPasswordError = !!fieldErrors.password || errorBorderFields.has('password');
  const hasNameError = !!fieldErrors.name;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoWrap}>
            <View style={[styles.logoCircle, { backgroundColor: Colors.primaryLight }]}>
              <Text style={styles.logoEmoji}>🍽️</Text>
            </View>
            <Text style={[styles.appName, { color: Colors.text }]}>Chewabl</Text>
            <Text style={[styles.tagline, { color: Colors.textSecondary }]}>Find your next great meal</Text>
          </View>

          <View style={[styles.tabRow, { backgroundColor: Colors.card }]}>
            <Pressable
              style={[styles.tab, tab === 'signin' && styles.tabActive]}
              onPress={() => clearForm('signin')}
            >
              <Text style={[styles.tabText, { color: Colors.textSecondary }, tab === 'signin' && styles.tabTextActive]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, tab === 'signup' && styles.tabActive]}
              onPress={() => clearForm('signup')}
            >
              <Text style={[styles.tabText, { color: Colors.textSecondary }, tab === 'signup' && styles.tabTextActive]}>
                Create Account
              </Text>
            </Pressable>
          </View>

          <View style={styles.form}>
            {/* Name field (signup only) */}
            {tab === 'signup' && (
              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.inputWrap,
                    { backgroundColor: Colors.card, borderColor: hasNameError ? Colors.error : Colors.border },
                  ]}
                >
                  <User size={18} color={hasNameError ? Colors.error : Colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: Colors.text }]}
                    placeholder="Full name"
                    placeholderTextColor={Colors.textTertiary}
                    value={name}
                    onChangeText={handleNameChange}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                  />
                  {nameValid && !hasNameError && (
                    <CheckCircle size={16} color={Colors.success} />
                  )}
                </View>
                <InlineFieldError message={fieldErrors.name} />
              </View>
            )}

            {/* Email field */}
            <View style={styles.fieldGroup}>
              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: Colors.card, borderColor: hasEmailError ? Colors.error : Colors.border },
                ]}
              >
                <Mail size={18} color={hasEmailError ? Colors.error : Colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  ref={emailRef}
                  style={[styles.input, { color: Colors.text }]}
                  placeholder="Email address"
                  placeholderTextColor={Colors.textTertiary}
                  value={email}
                  onChangeText={handleEmailChange}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                />
                {emailValid && !hasEmailError && (
                  <CheckCircle size={16} color={Colors.success} />
                )}
              </View>
              <InlineFieldError message={fieldErrors.email} />
            </View>

            {/* Password field */}
            <View style={styles.fieldGroup}>
              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: Colors.card, borderColor: hasPasswordError ? Colors.error : Colors.border },
                ]}
              >
                <Lock size={18} color={hasPasswordError ? Colors.error : Colors.textSecondary} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { color: Colors.text }]}
                  placeholder="Password"
                  placeholderTextColor={Colors.textTertiary}
                  value={password}
                  onChangeText={handlePasswordChange}
                  secureTextEntry={!showPassword}
                  returnKeyType={tab === 'signup' ? 'next' : 'done'}
                  onSubmitEditing={tab === 'signin' ? handleSubmit : () => phoneRef.current?.focus()}
                />
                <Pressable
                  onPress={() => setShowPassword(!showPassword)}
                  hitSlop={8}
                  accessibilityLabel="Toggle password visibility"
                  accessibilityRole="button"
                >
                  {showPassword ? (
                    <EyeOff size={18} color={Colors.textSecondary} />
                  ) : (
                    <Eye size={18} color={Colors.textSecondary} />
                  )}
                </Pressable>
              </View>
              <InlineFieldError message={fieldErrors.password} />
              {tab === 'signup' && passwordTouched && (
                <PasswordChecklist password={password} />
              )}
            </View>

            {/* Phone field (signup only) */}
            {tab === 'signup' && (
              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: Colors.card,
                      borderColor: fieldErrors.phone ? Colors.error : Colors.border,
                    },
                  ]}
                >
                  <Phone
                    size={18}
                    color={fieldErrors.phone ? Colors.error : Colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={phoneRef}
                    style={[styles.input, { color: Colors.text }]}
                    placeholder="Phone number (optional)"
                    placeholderTextColor={Colors.textTertiary}
                    value={phone}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    returnKeyType="next"
                    onSubmitEditing={() => inviteCodeRef.current?.focus()}
                    maxLength={20}
                  />
                </View>
                <InlineFieldError message={fieldErrors.phone} />
              </View>
            )}

            {/* Invite code field (signup only) */}
            {tab === 'signup' && (
              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: inviteCodePrefilled ? Colors.primaryLight : Colors.card,
                      borderColor: inviteCodePrefilled ? Colors.primary : Colors.border,
                    },
                  ]}
                >
                  <Ticket size={18} color={Colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    ref={inviteCodeRef}
                    style={[styles.input, { color: Colors.text, flex: 1 }]}
                    placeholder="Invite code"
                    placeholderTextColor={Colors.textTertiary}
                    value={inviteCode}
                    onChangeText={handleInviteCodeChange}
                    autoCapitalize="characters"
                    maxLength={8}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '500',
                      color: inviteCodePrefilled ? Colors.primary : Colors.textTertiary,
                    }}
                  >
                    Optional
                  </Text>
                </View>
              </View>
            )}

            {/* Submit button */}
            <NibbleFeedback
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
              accessibilityLabel={tab === 'signin' ? 'Sign In Button' : 'Create Account Button'}
            >
              {loading ? (
                <CrumbTrail color="#FFF" />
              ) : (
                <>
                  <Text style={styles.submitBtnText}>
                    {tab === 'signin' ? 'Sign In' : 'Create Account'}
                  </Text>
                  <ChevronRight size={18} color="#FFF" />
                </>
              )}
            </NibbleFeedback>

            {/* Form-level error */}
            {fieldErrors.form && (
              <Text
                style={{
                  fontSize: 13,
                  fontWeight: '500',
                  color: Colors.error,
                  textAlign: 'center',
                  marginTop: 8,
                }}
              >
                {fieldErrors.form}
              </Text>
            )}
          </View>

          <Pressable
            style={styles.skipBtn}
            onPress={async () => {
              await setGuestMode(true);
              await AsyncStorage.setItem('chewabl_onboarded', 'true');
              requestChomp(buildGuestEntryChompConfig(Colors.primary), () => {
                router.replace('/(tabs)' as never);
              });
            }}
          >
            <Text style={[styles.skipBtnText, { color: Colors.textSecondary }]}>
              Continue without an account
            </Text>
          </Pressable>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    flexGrow: 1,
    justifyContent: 'center',
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoEmoji: {
    fontSize: 36,
  },
  appName: {
    fontSize: 32,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  tagline: {
    fontSize: 15,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 4,
    marginBottom: 28,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.primary,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: '#FFF',
  },
  form: {},
  fieldGroup: {
    marginBottom: 14,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 14,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: Colors.text,
  },
  submitBtn: {
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 28,
    gap: 6,
    marginTop: 6,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '500' as const,
    textDecorationLine: 'underline' as const,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
});

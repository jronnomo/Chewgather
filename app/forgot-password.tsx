import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  LayoutAnimation,
  UIManager,
  Animated,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Mail,
  Lock,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  CheckCircle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import AppText from '../components/AppText';
import NibbleFeedback from '../components/NibbleFeedback';
import CrumbTrail from '../components/CrumbTrail';
import CodeInput, { CodeInputHandle } from '../components/CodeInput';
import { requestPasswordReset, resetPassword } from '../services/auth';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const Colors = StaticColors;

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = 'email' | 'reset';

type ForgotFieldErrors = {
  email?: string;
  code?: string;
  password?: string;
  form?: string;
};

// ─── Helpers (module-level; each calls useColors() inside body) ───────────────

function mapForgotErrorToFields(message: string, step: Step): ForgotFieldErrors {
  if (message.includes('Cannot connect') || message.includes('Request timed out')) {
    return { form: message };
  }
  if (message.includes('Too many')) {
    return { form: 'Hang tight — too many requests. Try again in a minute.' };
  }
  if (message === 'Server error') {
    return { form: 'Something went wrong on our end. Please try again.' };
  }
  if (message.includes('No account found')) {
    return { email: 'No account found for that email. Want to create one?' };
  }
  if (message.includes('Code expired')) {
    return { code: 'That code expired. Tap Resend for a fresh one.' };
  }
  if (message.includes('Invalid code')) {
    return { code: "That code didn't match. Give it another shot." };
  }
  if (message.includes('Invalid or expired code')) {
    return { code: "That code didn't match. Give it another shot." };
  }
  if (message.includes('Password must be at least 8 characters')) {
    return { password: 'Password must be at least 8 characters.' };
  }
  if (step === 'reset') {
    return { form: message };
  }
  return { form: message };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(val: string): boolean {
  return EMAIL_RE.test(val.trim());
}

// ─── InlineFieldError (copied from auth.tsx; calls useColors() inside body) ───

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message]);

  if (!visible && !message) return null;

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AppText
        variant="dense"
        style={{
          fontSize: 13,
          fontWeight: '500',
          color: Colors.error,
          paddingLeft: 14,
          marginTop: 4,
        }}
      >
        {message ?? ''}
      </AppText>
    </Animated.View>
  );
}

// ─── ChecklistItem (copied from auth.tsx; calls useColors() inside body) ──────

function ChecklistItem({ label, met }: { label: string; met: boolean }) {
  const Colors = useColors();
  const scale = useRef(new Animated.Value(1)).current;
  const prevMet = useRef(false);

  useEffect(() => {
    if (met && !prevMet.current) {
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.2, duration: 80, useNativeDriver: true }),
        Animated.spring(scale, {
          toValue: 1,
          useNativeDriver: true,
          damping: 10,
          stiffness: 200,
        }),
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
      <AppText
        variant="dense"
        style={{
          fontSize: 12,
          color: met ? Colors.success : Colors.textTertiary,
          marginLeft: 6,
        }}
      >
        {label}
      </AppText>
    </View>
  );
}

// ─── ReadyBadge (copied from auth.tsx; calls useColors() inside body) ─────────

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
      <AppText
        variant="dense"
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: Colors.success,
          marginLeft: 6,
        }}
      >
        Ready!
      </AppText>
    </Animated.View>
  );
}

// ─── PasswordChecklist (copied from auth.tsx; calls useColors() inside body) ──

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

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ForgotPasswordScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const CODE_LENGTH = 6;

  // State
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState<string>(' '.repeat(CODE_LENGTH));
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<ForgotFieldErrors>({});
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [emailValid, setEmailValid] = useState(false);
  const [resendCooldown, setResendCooldown] = useState<number>(0);
  const [codeLockedOut, setCodeLockedOut] = useState(false);

  // Refs
  const emailRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const codeInputRef = useRef<CodeInputHandle>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Auto-focus first code box when entering reset step
  useEffect(() => {
    if (step === 'reset') {
      // Small delay to allow the layout animation to settle
      const t = setTimeout(() => {
        codeInputRef.current?.focusFirst();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [step]);

  // ── Cooldown timer ──────────────────────────────────────────────────────────

  function startCooldownTimer() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleEmailChange = useCallback(
    (val: string) => {
      setEmail(val);
      const valid = isValidEmail(val);
      setEmailValid(valid);
      if (valid && fieldErrors.email) {
        setFieldErrors((prev) => ({ ...prev, email: undefined }));
      }
    },
    [fieldErrors.email]
  );

  const handlePasswordChange = useCallback(
    (val: string) => {
      setNewPassword(val);
      if (fieldErrors.password) {
        setFieldErrors((prev) => ({ ...prev, password: undefined }));
      }
      if (!passwordTouched && val.length > 0) {
        setPasswordTouched(true);
      }
    },
    [fieldErrors.password, passwordTouched]
  );

  const handleSendCode = useCallback(async () => {
    // Client-side validation
    if (!email.trim() || !isValidEmail(email.trim())) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFieldErrors({ email: 'Enter a valid email address.' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setStep('reset');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFieldErrors(mapForgotErrorToFields(message, 'email'));
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleResend = useCallback(async () => {
    // Clear code and errors; NO animation, NO setStep
    setCode(' '.repeat(CODE_LENGTH));
    setCodeLockedOut(false);
    setFieldErrors({});
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setResendCooldown(30);
      startCooldownTimer();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setFieldErrors({ form: mapForgotErrorToFields(message, 'reset').form ?? message });
    } finally {
      setLoading(false);
    }
  }, [email]);

  const handleReset = useCallback(async () => {
    const trimmedCode = code.trim();

    // Client-side validation
    const errors: ForgotFieldErrors = {};
    if (!(/^\d{6}$/.test(trimmedCode))) {
      errors.code = 'Please enter the 6-digit code.';
    }
    if (newPassword.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    }
    if (Object.keys(errors).length > 0) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setFieldErrors(errors);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setLoading(true);
    try {
      await resetPassword(email, trimmedCode, newPassword);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(
        `/auth?intent=signin&email=${encodeURIComponent(email)}&reset=success` as never
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const mapped = mapForgotErrorToFields(message, 'reset');

      // Over-attempt lockout
      if (
        message.includes('Invalid or expired code') &&
        !message.includes('Code expired')
      ) {
        setCodeLockedOut(true);
        setResendCooldown(0);
        setFieldErrors({ code: 'Too many tries. Request a new code.' });
      } else {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setFieldErrors(mapped);
      }
    } finally {
      setLoading(false);
    }
  }, [code, newPassword, email, router]);

  const hasEmailError = !!fieldErrors.email;
  const hasPasswordError = !!fieldErrors.password;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {/* Back button */}
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            testID="forgot-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.backBtn}
          >
            <ChevronLeft size={22} color={Colors.textSecondary} />
          </Pressable>

          {/* Step: email */}
          {step === 'email' && (
            <>
              {/* Logo */}
              <View style={styles.logoWrap}>
                <Image
                  source={require('../assets/images/chewgather-mouth.png')}
                  style={styles.logoMouth}
                  resizeMode="contain"
                  accessibilityLabel="Chewgather"
                />
              </View>

              <AppText
                variant="dense"
                style={[styles.title, { color: Colors.text }]}
              >
                Locked out? Let's fix that.
              </AppText>
              <AppText
                variant="dense"
                style={[styles.subtitle, { color: Colors.textSecondary }]}
              >
                Pop in your email and we'll send a fresh 6-digit code.
              </AppText>

              {/* Email field */}
              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: Colors.card,
                      borderColor: hasEmailError ? Colors.error : Colors.border,
                    },
                  ]}
                >
                  <Mail
                    size={18}
                    color={hasEmailError ? Colors.error : Colors.textSecondary}
                    style={styles.inputIcon}
                  />
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
                    returnKeyType="done"
                    onSubmitEditing={handleSendCode}
                    maxFontSizeMultiplier={1.3}
                    testID="forgot-email-input"
                  />
                  {emailValid && !hasEmailError && (
                    <CheckCircle size={16} color={Colors.success} />
                  )}
                </View>
                <InlineFieldError message={fieldErrors.email} />
                {fieldErrors.email?.includes('Want to create one') && (
                  <Pressable
                    onPress={() => router.push('/auth?intent=signup' as never)}
                    hitSlop={8}
                    accessibilityRole="button"
                  >
                    <AppText
                      variant="dense"
                      style={{
                        fontSize: 13,
                        fontWeight: '500',
                        color: Colors.primary,
                        paddingLeft: 14,
                        marginTop: 4,
                      }}
                    >
                      Create account →
                    </AppText>
                  </Pressable>
                )}
              </View>

              {/* Send code button */}
              <NibbleFeedback
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                onPress={handleSendCode}
                disabled={loading}
                testID="forgot-send-code-btn"
                accessibilityLabel="Send my code"
              >
                {loading ? (
                  <CrumbTrail color="#FFF" />
                ) : (
                  <>
                    <AppText variant="dense" style={styles.submitBtnText}>
                      Send my code
                    </AppText>
                    <ChevronRight size={18} color="#FFF" />
                  </>
                )}
              </NibbleFeedback>

              <InlineFieldError message={fieldErrors.form} />

              {/* Back to sign in */}
              <Pressable
                onPress={() => router.back()}
                style={styles.skipBtn}
                accessibilityRole="button"
              >
                <AppText
                  variant="dense"
                  style={[styles.skipBtnText, { color: Colors.textSecondary }]}
                >
                  Remembered it? Sign in
                </AppText>
              </Pressable>
            </>
          )}

          {/* Step: reset */}
          {step === 'reset' && (
            <>
              {/* Logo */}
              <View style={styles.logoWrap}>
                <Image
                  source={require('../assets/images/chewgather-mouth.png')}
                  style={styles.logoMouth}
                  resizeMode="contain"
                  accessibilityLabel="Chewgather"
                />
              </View>

              <AppText
                variant="dense"
                style={[styles.title, { color: Colors.text }]}
              >
                Enter your code
              </AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 20 }}>
                <AppText
                  variant="dense"
                  style={{ fontSize: 14, color: Colors.textSecondary }}
                >
                  {'We sent a 6-digit code to '}
                </AppText>
                <AppText
                  variant="dense"
                  style={{ fontSize: 14, fontWeight: '600', color: Colors.text }}
                >
                  {email}
                </AppText>
              </View>

              {/* Code input */}
              <View style={{ marginBottom: 8 }}>
                <CodeInput
                  ref={codeInputRef}
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    setFieldErrors((e) => ({ ...e, code: undefined }));
                  }}
                  length={CODE_LENGTH}
                  onComplete={() => {
                    // Auto-submit only when the new password is already valid;
                    // otherwise advance focus to the password field so the user
                    // can finish — never submit with an empty password.
                    if (newPassword.length >= 8) {
                      handleReset();
                    } else {
                      passwordRef.current?.focus();
                    }
                  }}
                  error={!!fieldErrors.code}
                  disabled={codeLockedOut}
                  testID="forgot-code-input"
                />
              </View>
              <InlineFieldError message={fieldErrors.code} />

              {/* Resend link */}
              <Pressable
                onPress={handleResend}
                disabled={resendCooldown > 0 || loading}
                testID="forgot-resend-link"
                accessibilityRole="button"
                hitSlop={12}
                style={{ marginTop: 8, marginBottom: 16 }}
              >
                <AppText
                  variant="dense"
                  style={{
                    fontSize: 14,
                    color:
                      resendCooldown > 0 || loading
                        ? Colors.textSecondary
                        : Colors.primary,
                  }}
                >
                  {resendCooldown > 0
                    ? `Resend in 0:${String(resendCooldown).padStart(2, '0')}`
                    : "Didn't get it? Resend"}
                </AppText>
              </Pressable>

              {/* Password field */}
              <View style={styles.fieldGroup}>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      backgroundColor: Colors.card,
                      borderColor: hasPasswordError ? Colors.error : Colors.border,
                    },
                  ]}
                >
                  <Lock
                    size={18}
                    color={hasPasswordError ? Colors.error : Colors.textSecondary}
                    style={styles.inputIcon}
                  />
                  <TextInput
                    ref={passwordRef}
                    style={[styles.input, { color: Colors.text }]}
                    placeholder="New password"
                    placeholderTextColor={Colors.textTertiary}
                    value={newPassword}
                    onChangeText={handlePasswordChange}
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleReset}
                    maxFontSizeMultiplier={1.3}
                  />
                  <Pressable
                    onPress={() => setShowPassword((v) => !v)}
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
                {passwordTouched && <PasswordChecklist password={newPassword} />}
                <InlineFieldError message={fieldErrors.password} />
              </View>

              <InlineFieldError message={fieldErrors.form} />

              {/* Reset button */}
              <NibbleFeedback
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                onPress={handleReset}
                disabled={loading}
                testID="forgot-reset-btn"
                accessibilityLabel="Reset password"
              >
                {loading ? (
                  <CrumbTrail color="#FFF" />
                ) : (
                  <>
                    <AppText variant="dense" style={styles.submitBtnText}>
                      Reset password
                    </AppText>
                    <ChevronRight size={18} color="#FFF" />
                  </>
                )}
              </NibbleFeedback>
            </>
          )}

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
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 16,
    padding: 4,
  },
  logoWrap: {
    alignItems: 'center',
    marginBottom: 28,
    marginTop: 8,
  },
  logoMouth: {
    width: 120,
    height: 90,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 24,
    lineHeight: 20,
  },
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
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 8,
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
  submitBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFF',
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipBtnText: {
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
});

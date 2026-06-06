import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Lock, Eye, EyeOff, AlertTriangle, Check } from 'lucide-react-native';
import { useAuth } from '../../../context/AuthContext';
import { NetworkError } from '../../../services/api';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';
import AppText from '@/components/AppText';

const Colors = StaticColors; // module-level: for StyleSheet.create()

// ─── Module-level helper components ────────────────────────────────────────────

function InlineFieldError({ message }: { message?: string }) {
  const Colors = useColors(); // REQUIRED: module-level component must own its colors
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
  }, [message]); // eslint-disable-line react-hooks/exhaustive-deps

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

function WhatsErasedCard() {
  const Colors = useColors(); // REQUIRED: module-level component must own its colors
  const bullets = [
    'Your profile and preferences',
    'Plans you created (for everyone in them)',
    "Your spot in friends' plans",
    'Your friendships',
    'Your notifications',
  ];
  return (
    <View
      style={{
        backgroundColor: `${Colors.error}1F`,
        borderRadius: 14,
        padding: 16,
        marginTop: 20,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <AlertTriangle size={16} color={Colors.error} />
        <AppText variant="dense" style={{ fontWeight: '700', color: Colors.error }}>
          What gets deleted
        </AppText>
      </View>
      {bullets.map((b, i) => (
        <AppText
          key={i}
          variant="dense"
          style={{
            color: Colors.textSecondary,
            marginBottom: i < bullets.length - 1 ? 6 : 0,
          }}
        >
          {'• '}{b}
        </AppText>
      ))}
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function DeleteAccountScreen() {
  const Colors = useColors(); // shadows module-level Colors for reactive dark mode
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { deleteAccount } = useAuth();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const hasError = Boolean(errorMessage);
  const isDisabled = !password.trim() || !checked || loading;

  const handlePasswordChange = useCallback((text: string) => {
    setPassword(text);
    setErrorMessage(undefined);
  }, []);

  const toggleCheckbox = useCallback(() => {
    setChecked(prev => !prev);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!password.trim() || !checked || loading) return;
    setLoading(true);
    setErrorMessage(undefined);
    try {
      await deleteAccount(password);
      // Success: local state already cleared by deleteAccount; navigate away
      router.replace('/auth' as never);
    } catch (err: unknown) {
      // IMPORTANT: Test NetworkError FIRST — it is a subclass of Error.
      // Testing `instanceof Error` first makes the NetworkError branch unreachable.
      if (err instanceof NetworkError) {
        setErrorMessage("Couldn't connect. Check your connection and try again.");
      } else if (err instanceof Error && err.message === 'Incorrect password') {
        // Wrong password: stay on screen, show inline error
        setErrorMessage('Incorrect password. Try again.');
      } else if (
        err instanceof Error &&
        (err.message === 'Unauthorized' || err.message === 'Invalid token')
      ) {
        // Expired/invalid session: inform user and let them navigate back to sign in
        setErrorMessage('Your session has expired. Please go back and sign in again.');
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }, [password, checked, loading, deleteAccount, router]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.root, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back button */}
          <Pressable
            style={styles.backBtn}
            onPress={() => router.back()}
            hitSlop={12}
            testID="delete-back-btn"
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ChevronLeft size={22} color={Colors.textSecondary} />
          </Pressable>

          {/* Title */}
          <AppText variant="display" style={[styles.title, { color: Colors.text }]}>
            Delete account
          </AppText>

          {/* Warning */}
          <AppText variant="dense" style={[styles.warning, { color: Colors.textSecondary }]}>
            This permanently deletes your account. This can't be undone.
          </AppText>

          {/* What gets deleted card */}
          <WhatsErasedCard />

          {/* Password label */}
          <AppText variant="dense" style={[styles.passwordLabel, { color: Colors.textSecondary }]}>
            Confirm your password
          </AppText>

          {/* Password input */}
          <View
            style={[
              styles.inputWrap,
              {
                backgroundColor: Colors.card,
                borderColor: hasError ? Colors.error : Colors.border,
              },
            ]}
          >
            <Lock
              size={18}
              color={hasError ? Colors.error : Colors.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: Colors.text }]}
              placeholder="Password"
              placeholderTextColor={Colors.textTertiary}
              value={password}
              onChangeText={handlePasswordChange}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete="current-password"
              textContentType="password"
              maxFontSizeMultiplier={1.3}
              testID="delete-account-password"
            />
            <Pressable
              onPress={() => setShowPassword(prev => !prev)}
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

          {/* Inline field error */}
          <InlineFieldError message={errorMessage} />

          {/* Checkbox */}
          <Pressable
            style={styles.checkboxRow}
            onPress={toggleCheckbox}
            testID="delete-account-checkbox"
            accessibilityRole="checkbox"
            accessibilityLabel="I understand this is permanent."
            accessibilityState={{ checked }}
          >
            <View
              style={[
                styles.checkboxBox,
                {
                  borderColor: checked ? Colors.error : Colors.border,
                  backgroundColor: checked ? Colors.error : 'transparent',
                },
              ]}
            >
              {checked && <Check size={14} color="#FFF" />}
            </View>
            <AppText variant="dense" style={{ color: Colors.text }}>
              I understand this is permanent.
            </AppText>
          </Pressable>

          {/* Flexible spacer */}
          <View style={styles.spacer} />

          {/* Bottom area */}
          <View style={{ paddingBottom: insets.bottom + 16 }}>
            {/* Delete button */}
            <Pressable
              style={[
                styles.confirmBtn,
                {
                  backgroundColor: Colors.error,
                  opacity: isDisabled ? 0.5 : 1,
                },
              ]}
              onPress={handleDelete}
              disabled={isDisabled}
              testID="delete-account-confirm-btn"
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <AppText variant="dense" style={styles.confirmBtnText}>
                  Delete my account
                </AppText>
              )}
            </Pressable>

            {/* Cancel link */}
            <Pressable
              style={styles.cancelLink}
              onPress={() => router.back()}
              testID="delete-account-cancel"
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <AppText variant="dense" style={[styles.cancelText, { color: Colors.textSecondary }]}>
                Cancel
              </AppText>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 16,
    padding: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '800' as const,
    marginBottom: 8,
    color: Colors.text,
  },
  warning: {
    fontSize: 15,
    color: Colors.textSecondary,
  },
  passwordLabel: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    marginBottom: 6,
    marginTop: 24,
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
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 10,
    marginTop: 20,
  },
  checkboxBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    flex: 1,
    minHeight: 24,
  },
  confirmBtn: {
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  confirmBtnText: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  cancelLink: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
  },
});

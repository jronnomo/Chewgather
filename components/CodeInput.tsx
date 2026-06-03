import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  View,
  TextInput,
  Animated,
  AccessibilityInfo,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '../context/ThemeContext';

export interface CodeInputProps {
  value: string;                     // full string, always exactly `length` chars padded with ' '
  onChange: (v: string) => void;     // called on every change with the full padded string
  length?: number;                   // number of boxes; defaults to 6
  onComplete?: (v: string) => void;  // called once when value.replace(/ /g,'').length === length
  error?: boolean;                   // triggers red-border + shake animation
  disabled?: boolean;                // when true, all boxes are editable={false} + muted
  testID?: string;                   // root View testID; individual boxes get `${testID}-box-{i}`
}

export interface CodeInputHandle {
  focusFirst: () => void;
}

const CodeInput = forwardRef<CodeInputHandle, CodeInputProps>(function CodeInput(
  {
    value,
    onChange,
    length = 6,
    onComplete,
    error = false,
    disabled = false,
    testID,
  },
  ref
) {
  const Colors = useColors();

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [reduceMotion, setReduceMotion] = useState(false);

  const inputRefs = useRef<Array<React.ComponentRef<typeof TextInput> | null>>(
    Array.from({ length }, () => null)
  );
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Respect OS Reduce Motion setting
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!cancelled) setReduceMotion(reduced);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Shake + Error haptic when error prop becomes true
  useEffect(() => {
    if (!error) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (!reduceMotion) {
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: -8, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 8,  duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -6, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 6,  duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: -3, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 3,  duration: 45, useNativeDriver: true }),
        Animated.timing(shakeAnim, { toValue: 0,  duration: 45, useNativeDriver: true }),
      ]).start();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Expose focusFirst via imperative handle
  useImperativeHandle(ref, () => ({
    focusFirst: () => {
      inputRefs.current[0]?.focus();
    },
  }));

  function focusBox(index: number) {
    inputRefs.current[index]?.focus();
  }

  function handleChange(index: number, text: string) {
    if (text.length > 1) {
      // Paste: distribute across boxes starting at index
      const digits = text.replace(/\D/g, '').slice(0, length - index);
      const chars = value.padEnd(length, ' ').split('');
      for (let i = 0; i < digits.length; i++) {
        chars[index + i] = digits[i];
      }
      const newValue = chars.join('').padEnd(length, ' ');
      onChange(newValue);
      const nextFocus = Math.min(index + digits.length, length - 1);
      focusBox(nextFocus);
      if (newValue.replace(/ /g, '').length === length) {
        onComplete?.(newValue);
      }
    } else {
      const digit = text.replace(/\D/g, '').slice(-1);
      const chars = value.padEnd(length, ' ').split('');
      chars[index] = digit || ' ';
      const newValue = chars.join('');
      onChange(newValue);
      if (digit && index < length - 1) {
        focusBox(index + 1);
      }
      if (newValue.replace(/ /g, '').length === length) {
        onComplete?.(newValue);
      }
      if (digit && !reduceMotion) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }
  }

  function handleKeyPress(index: number, key: string) {
    if (key === 'Backspace' && (!value[index] || value[index] === ' ')) {
      if (index > 0) {
        const chars = value.padEnd(length, ' ').split('');
        chars[index - 1] = ' ';
        onChange(chars.join(''));
        focusBox(index - 1);
      }
    }
  }

  return (
    <View
      accessibilityLabel={`${length}-digit verification code`}
      testID={testID}
      style={{ flexDirection: 'row', gap: 12 }}
    >
      {Array.from({ length }, (_, index) => {
        // CRITICAL-1 fix: derive isFocused and isFilled inside the map body
        const isFocused = focusedIndex === index;
        const isFilled = !!(value[index] && value[index] !== ' ');

        return (
          <Animated.View
            key={index}
            style={{ transform: [{ translateX: shakeAnim }] }}
          >
            <TextInput
              ref={(r) => {
                inputRefs.current[index] = r;
              }}
              value={isFilled ? value[index] : ''}
              onChangeText={(t) => handleChange(index, t)}
              onKeyPress={(e) => handleKeyPress(index, e.nativeEvent.key)}
              onFocus={() => setFocusedIndex(index)}
              onBlur={() => setFocusedIndex((i) => (i === index ? null : i))}
              keyboardType="number-pad"
              maxLength={1}
              textContentType={index === 0 ? 'oneTimeCode' : undefined}
              editable={!disabled}
              selectTextOnFocus={true}
              testID={`${testID ?? 'code'}-box-${index}`}
              accessibilityLabel={`Digit ${index + 1} of ${length}`}
              style={{
                width: 46,
                height: 54,
                borderRadius: 10,
                textAlign: 'center',
                fontSize: 22,
                fontWeight: '700',
                borderWidth: isFocused || isFilled ? 2 : 1.5,
                borderColor: error
                  ? Colors.error
                  : isFilled
                  ? Colors.primary
                  : isFocused
                  ? Colors.primary
                  : Colors.border,
                backgroundColor: disabled
                  ? Colors.card
                  : isFilled
                  ? Colors.primaryLight
                  : Colors.card,
                color: disabled ? Colors.textSecondary : Colors.text,
                opacity: disabled ? 0.5 : 1,
              }}
            />
          </Animated.View>
        );
      })}
    </View>
  );
});

export default CodeInput;

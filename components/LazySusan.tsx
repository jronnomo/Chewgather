/**
 * Lazy Susan Carousel — currently UNUSED in production.
 *
 * Built as the round-2 Home action surface (rotating disc with 4 pie segments).
 * The metaphor is strong (dim sum / shared-meal iconography matches Chewgether)
 * but the spin mechanic didn't land in practice: gesture arbitration with the
 * Pressable segment labels is fiddly, uniform wood segments make rotation hard
 * to perceive, and auto-fire after settle felt presumptuous. See issue #283.
 *
 * NOTE: One root cause of the spin friction was the parent ScrollView eating
 * the vertical drag. The MenuTent solves the same issue via `scrollEnabled`
 * toggling + `onPanResponderTerminationRequest: () => false`. If this
 * component is ever revived, apply the same pattern: accept onSpinStart /
 * onSpinEnd props and lock parent scroll while the disc is being driven.
 *
 * PRESERVED for possible future reuse:
 *   - Rare-use "Spin to decide" mode (where spin friction becomes ceremony)
 *   - Future port to react-native-reanimated + gesture-handler (resolves the
 *     touch-arbitration issues at the framework level)
 *   - Easter egg / settings randomization UI
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AppText from '@/components/AppText';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import {
  Sandwich,
  ClipboardList,
  Cookie,
  Dices,
  ChevronUp,
  type LucideIcon,
} from 'lucide-react-native';
import StaticColors from '@/constants/colors';
import { useColors } from '@/context/ThemeContext';

const Colors = StaticColors;

const DISC_SIZE = 300;
const DISC_RADIUS = DISC_SIZE / 2;
const LABEL_DISTANCE = DISC_RADIUS * 0.62;
const ICON_SIZE = 28;
const SEGMENT_COUNT = 4;
const SEGMENT_DEG = 360 / SEGMENT_COUNT;
const AUTO_FIRE_PAUSE_MS = 800;

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface LazySusanProps {
  onPickSpot: () => void;
  onPlanFeast: () => void;
  onGroupChomp: () => void;
  onCurveball: () => void;
  testID?: string;
}

interface SegmentSpec {
  key: 'pick' | 'feast' | 'chomp' | 'curveball';
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  testID: string;
}

/**
 * LazySusan — Home action surface as a rotating wooden disc.
 *
 * 4 pie segments around the rim (Pick a Spot, Plan a Feast, Group Chomp,
 * Curveball), all visible at all times. Tap = navigate. Flick = the disc
 * spins with rotational momentum, tick-haptic per segment boundary crossed,
 * snaps to nearest segment under the bottom arrow, then auto-fires after a
 * short pause. "Tonight's Seat" = whichever segment the arrow points at.
 *
 * Replaces the round-1 DailyLunchPail (see issue #283 for full context).
 */
export default function LazySusan({
  onPickSpot,
  onPlanFeast,
  onGroupChomp,
  onCurveball,
  testID,
}: LazySusanProps) {
  const Colors = useColors();
  const [reduceMotion, setReduceMotion] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [highlightPulse, setHighlightPulse] = useState(false);

  const rotation = useRef(new Animated.Value(0)).current;
  const rotationValueRef = useRef(0);
  const lastTickBoundaryRef = useRef(0);
  const gestureStartAngleRef = useRef(0);
  const gestureStartRotationRef = useRef(0);
  const recentMovesRef = useRef<Array<{ angle: number; time: number }>>([]);
  const autoFireTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSpinningRef = useRef(false);

  // Reduced motion detection
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => sub.remove();
  }, []);

  // Listen to rotation: update selectedIndex + fire tick haptics on boundary crossings
  useEffect(() => {
    const id = rotation.addListener(({ value }) => {
      rotationValueRef.current = value;

      // Segment under the arrow (which is at the bottom of the disc).
      // Disc rotates clockwise (positive = clockwise). At rotation 0, segment 0
      // sits under the arrow. Each 90° of clockwise rotation moves the previous
      // segment up and brings the next-counterclockwise one under the arrow.
      const idx = ((Math.round(-value / SEGMENT_DEG) % SEGMENT_COUNT) + SEGMENT_COUNT) % SEGMENT_COUNT;
      setSelectedIndex(prev => (prev === idx ? prev : idx));

      // Tick haptic: every time we cross a segment boundary (90° intervals,
      // offset by 45° so boundaries land between segment centers)
      const boundary = Math.floor((value + 45) / SEGMENT_DEG);
      if (boundary !== lastTickBoundaryRef.current && isSpinningRef.current) {
        lastTickBoundaryRef.current = boundary;
        Haptics.selectionAsync();
      }
    });
    return () => rotation.removeListener(id);
  }, [rotation]);

  const segments: SegmentSpec[] = useMemo(
    () => [
      { key: 'pick', icon: Sandwich, label: 'Pick a Spot', onPress: onPickSpot, testID: 'lazy-susan-pick' },
      { key: 'feast', icon: ClipboardList, label: 'Plan a Feast', onPress: onPlanFeast, testID: 'lazy-susan-feast' },
      { key: 'chomp', icon: Cookie, label: 'Group Chomp', onPress: onGroupChomp, testID: 'lazy-susan-chomp' },
      { key: 'curveball', icon: Dices, label: 'Curveball', onPress: onCurveball, testID: 'lazy-susan-curveball' },
    ],
    [onPickSpot, onPlanFeast, onGroupChomp, onCurveball],
  );

  // Pulse highlight on selected-index change (after settle)
  useEffect(() => {
    if (!isSpinningRef.current) {
      setHighlightPulse(true);
      const t = setTimeout(() => setHighlightPulse(false), 600);
      return () => clearTimeout(t);
    }
  }, [selectedIndex]);

  // Compute angle from disc center to a touch point (in container-local coords).
  // Returns degrees, 0 = top, increasing clockwise.
  const angleFromCenter = useCallback((x: number, y: number): number => {
    const dx = x - DISC_RADIUS;
    const dy = y - DISC_RADIUS;
    // atan2 returns radians from +x axis, counterclockwise positive.
    // Convert: add 90° so 0=top, negate so clockwise is positive.
    const rad = Math.atan2(dy, dx);
    let deg = (rad * 180) / Math.PI + 90;
    if (deg < 0) deg += 360;
    return deg;
  }, []);

  const cancelAutoFire = useCallback(() => {
    if (autoFireTimeoutRef.current) {
      clearTimeout(autoFireTimeoutRef.current);
      autoFireTimeoutRef.current = null;
    }
  }, []);

  const settleAndAutoFire = useCallback((finalRotation: number) => {
    isSpinningRef.current = false;
    // Snap to nearest segment boundary
    const snapTarget = Math.round(finalRotation / SEGMENT_DEG) * SEGMENT_DEG;
    Animated.spring(rotation, {
      toValue: snapTarget,
      tension: 80,
      friction: 9,
      useNativeDriver: true,
    }).start(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      // Auto-fire the selected segment after a pause
      cancelAutoFire();
      autoFireTimeoutRef.current = setTimeout(() => {
        const idx = ((Math.round(-rotationValueRef.current / SEGMENT_DEG) % SEGMENT_COUNT) + SEGMENT_COUNT) % SEGMENT_COUNT;
        segments[idx]?.onPress();
      }, AUTO_FIRE_PAUSE_MS);
    });
  }, [rotation, segments, cancelAutoFire]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        // Don't capture taps — let child Pressables handle tap-to-navigate.
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        // BUT preempt children on drag so the spin works even when the touch
        // started on a segment label Pressable.
        onMoveShouldSetPanResponder: (_, gesture) =>
          !reduceMotion && (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6),
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !reduceMotion && (Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (evt) => {
          cancelAutoFire();
          rotation.stopAnimation();
          isSpinningRef.current = false;
          const startAngle = angleFromCenter(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
          gestureStartAngleRef.current = startAngle;
          gestureStartRotationRef.current = rotationValueRef.current;
          recentMovesRef.current = [{ angle: startAngle, time: Date.now() }];
          lastTickBoundaryRef.current = Math.floor((rotationValueRef.current + 45) / SEGMENT_DEG);
        },
        onPanResponderMove: (evt) => {
          const currentAngle = angleFromCenter(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
          // Compute shortest-path delta (handle wrap around 0/360)
          let delta = currentAngle - gestureStartAngleRef.current;
          if (delta > 180) delta -= 360;
          if (delta < -180) delta += 360;
          rotation.setValue(gestureStartRotationRef.current + delta);
          recentMovesRef.current.push({ angle: currentAngle, time: Date.now() });
          if (recentMovesRef.current.length > 8) recentMovesRef.current.shift();
        },
        onPanResponderRelease: () => {
          // Compute angular velocity from recent moves (deg/ms)
          const moves = recentMovesRef.current;
          if (moves.length < 2) {
            settleAndAutoFire(rotationValueRef.current);
            return;
          }
          const first = moves[0];
          const last = moves[moves.length - 1];
          const elapsed = last.time - first.time;
          if (elapsed <= 0) {
            settleAndAutoFire(rotationValueRef.current);
            return;
          }
          let angularDelta = last.angle - first.angle;
          if (angularDelta > 180) angularDelta -= 360;
          if (angularDelta < -180) angularDelta += 360;
          const velocity = angularDelta / elapsed; // deg/ms

          if (Math.abs(velocity) < 0.05) {
            // Barely any flick — just snap from current position
            settleAndAutoFire(rotationValueRef.current);
            return;
          }

          // Convert deg/ms to a per-frame value for decay
          isSpinningRef.current = true;
          lastTickBoundaryRef.current = Math.floor((rotationValueRef.current + 45) / SEGMENT_DEG);
          Animated.decay(rotation, {
            velocity: velocity * 16.67, // convert deg/ms to deg/frame at 60fps
            deceleration: 0.997,
            useNativeDriver: true,
          }).start(({ finished }) => {
            if (finished) settleAndAutoFire(rotationValueRef.current);
          });
        },
        onPanResponderTerminate: () => {
          settleAndAutoFire(rotationValueRef.current);
        },
      }),
    [reduceMotion, rotation, angleFromCenter, cancelAutoFire, settleAndAutoFire],
  );

  // Cleanup auto-fire timeout on unmount
  useEffect(() => {
    return () => {
      cancelAutoFire();
    };
  }, [cancelAutoFire]);

  // Build segment paths (4 wedges, each 90°, centered at top/right/bottom/left)
  const segmentPaths = useMemo(() => buildSegmentPaths(DISC_RADIUS, SEGMENT_COUNT), []);

  const discRotateStr = rotation.interpolate({
    inputRange: [-360, 0, 360],
    outputRange: ['-360deg', '0deg', '360deg'],
  });

  return (
    <View style={styles.container} testID={testID}>
      <View style={styles.discWrapper} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.disc,
            { transform: [{ rotate: discRotateStr }] },
          ]}
        >
          <Svg width={DISC_SIZE} height={DISC_SIZE}>
            <Defs>
              <SvgLinearGradient id="woodGradient" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={Colors.card} />
                <Stop offset="1" stopColor={Colors.surfaceElevated} />
              </SvgLinearGradient>
            </Defs>
            {segmentPaths.map((d, i) => {
              const isSelected = i === selectedIndex;
              const isCurveball = segments[i].key === 'curveball';
              const fill = isSelected
                ? (isCurveball ? Colors.primary : Colors.primaryLight)
                : 'url(#woodGradient)';
              return (
                <Path
                  key={segments[i].key}
                  d={d}
                  fill={fill}
                  stroke={Colors.border}
                  strokeWidth={1.5}
                />
              );
            })}
          </Svg>

          {/* Labels (counter-rotated so they stay upright) */}
          {segments.map((seg, i) => (
            <SegmentLabel
              key={seg.key}
              spec={seg}
              segmentIndex={i}
              discRotation={rotation}
              isSelected={i === selectedIndex}
              highlightPulse={highlightPulse && i === selectedIndex}
              reduceMotion={reduceMotion}
            />
          ))}
        </Animated.View>

        {/* Fixed bottom arrow + "Tonight's Seat" label */}
        <View style={styles.arrowWrapper} pointerEvents="none">
          <View style={[styles.arrowDot, { backgroundColor: Colors.primary }]}>
            <ChevronUp size={16} color="#FFFFFF" strokeWidth={3} />
          </View>
          <AppText variant="dense" style={[styles.arrowLabel, { color: Colors.textSecondary }]}>
            TONIGHT'S SEAT
          </AppText>
        </View>
      </View>

      {/* Subtle hint footer */}
      <Text style={[styles.hint, { color: Colors.textSecondary }]}>
        {reduceMotion ? 'Tap a slice to go.' : 'Tap a slice — or flick the susan and let fate pick.'}
      </Text>
    </View>
  );
}

interface SegmentLabelProps {
  spec: SegmentSpec;
  segmentIndex: number;
  discRotation: Animated.Value;
  isSelected: boolean;
  highlightPulse: boolean;
  reduceMotion: boolean;
}

function SegmentLabel({
  spec,
  segmentIndex,
  discRotation,
  isSelected,
  highlightPulse,
  reduceMotion,
}: SegmentLabelProps) {
  const Colors = useColors();
  const Icon = spec.icon;
  const tapScale = useRef(new Animated.Value(1)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;

  // Segment center angle (degrees, 0=top, clockwise positive)
  const centerAngleDeg = segmentIndex * SEGMENT_DEG;
  const centerAngleRad = (centerAngleDeg - 90) * (Math.PI / 180); // convert to SVG coords (0=right)
  const labelX = DISC_RADIUS + LABEL_DISTANCE * Math.cos(centerAngleRad);
  const labelY = DISC_RADIUS + LABEL_DISTANCE * Math.sin(centerAngleRad);

  // Counter-rotate to keep label upright
  const counterRotate = discRotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['360deg', '-360deg'],
  });

  // Pulse animation on becoming selected (post-settle)
  useEffect(() => {
    if (highlightPulse && !reduceMotion) {
      pulseScale.setValue(1);
      Animated.sequence([
        Animated.timing(pulseScale, { toValue: 1.12, duration: 200, useNativeDriver: true }),
        Animated.timing(pulseScale, { toValue: 1, duration: 250, useNativeDriver: true }),
      ]).start();
    }
  }, [highlightPulse, reduceMotion, pulseScale]);

  const handlePress = () => {
    Haptics.selectionAsync();
    if (reduceMotion) {
      spec.onPress();
      return;
    }
    Animated.sequence([
      Animated.timing(tapScale, { toValue: 0.88, duration: 90, useNativeDriver: true }),
      Animated.timing(tapScale, { toValue: 0, duration: 120, useNativeDriver: true }),
    ]).start(() => {
      spec.onPress();
      tapScale.setValue(1);
    });
  };

  const isCurveball = spec.key === 'curveball';
  const iconColor = isSelected
    ? (isCurveball ? '#FFFFFF' : Colors.primary)
    : Colors.text;
  const labelColor = isSelected
    ? (isCurveball ? '#FFFFFF' : Colors.text)
    : Colors.text;

  return (
    <Animated.View
      style={[
        styles.labelWrapper,
        {
          left: labelX - 44,
          top: labelY - 32,
          transform: [
            { rotate: counterRotate },
            { scale: Animated.multiply(tapScale, pulseScale) },
          ],
        },
      ]}
    >
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`${spec.label}${isSelected ? ', currently in tonight’s seat' : ''}`}
        testID={spec.testID}
        style={styles.labelPress}
      >
        <Icon size={ICON_SIZE} color={iconColor} />
        <AppText variant="dense" style={[styles.labelText, { color: labelColor }]} numberOfLines={1}>
          {spec.label}
        </AppText>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Build SVG path strings for `n` equal pie segments, the first segment
 * centered at the top (12 o'clock) and going clockwise.
 */
function buildSegmentPaths(radius: number, n: number): string[] {
  const cx = radius;
  const cy = radius;
  const halfSeg = (Math.PI * 2) / n / 2;
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    // Segment i center angle in SVG coords (0 = right, clockwise positive)
    // Map our convention (0 = top, clockwise positive) to SVG: subtract π/2
    const center = (i * Math.PI * 2) / n - Math.PI / 2;
    const start = center - halfSeg;
    const end = center + halfSeg;
    const x1 = cx + radius * Math.cos(start);
    const y1 = cy + radius * Math.sin(start);
    const x2 = cx + radius * Math.cos(end);
    const y2 = cy + radius * Math.sin(end);
    paths.push(`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`);
  }
  return paths;
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  discWrapper: {
    width: DISC_SIZE,
    height: DISC_SIZE + 50,
    alignItems: 'center',
  },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_RADIUS,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },
  labelWrapper: {
    position: 'absolute',
    width: 88,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelPress: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  labelText: {
    fontSize: 11,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  arrowWrapper: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  arrowDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
    marginTop: -8,
  },
  arrowLabel: {
    fontSize: 9,
    fontWeight: '700' as const,
    letterSpacing: 1.2,
    marginTop: 4,
  },
  hint: {
    fontSize: 12,
    marginTop: 12,
    textAlign: 'center',
    fontStyle: 'italic' as const,
  },
});

import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  AccessibilityInfo,
  useWindowDimensions,
} from 'react-native';
import Svg, { Defs, Mask, Rect, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useThemeTransition, ChompConfig } from '../context/ThemeTransitionContext';
import { ScallopCircle, generateScallops, seededRandom } from '../lib/scallopUtils';
import CrumbParticles, { createBurst, animateBurst } from './CrumbParticles';

interface BiteSpec {
  cx: number;
  cy: number;
  targetRadius: number;
  scallops: ScallopCircle[];
}

type CrumbBurstState = ReturnType<typeof createBurst>;

const HAPTIC_STYLE_MAP: Record<string, Haptics.ImpactFeedbackStyle> = {
  Light: Haptics.ImpactFeedbackStyle.Light,
  Medium: Haptics.ImpactFeedbackStyle.Medium,
  Heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

// ─── Bite pattern generators ──────────────────────────────────────────────

function generateFixedBites(
  count: number,
  sw: number,
  sh: number,
  scallopBaseR: number,
  jitter: number,
): BiteSpec[] {
  const all: BiteSpec[] = [
    {
      cx: -sw * 0.15,
      cy: sh * 0.18,
      targetRadius: sh * 0.30,
      scallops: generateScallops(0, sh * 0.30, -1.0, 2.0, scallopBaseR, jitter),
    },
    {
      cx: sw * 1.15,
      cy: sh * 0.38,
      targetRadius: sh * 0.34,
      scallops: generateScallops(1, sh * 0.34, 1.5, 4.7, scallopBaseR, jitter),
    },
    {
      cx: -sw * 0.1,
      cy: sh * 0.65,
      targetRadius: sh * 0.38,
      scallops: generateScallops(2, sh * 0.38, -1.2, 1.8, scallopBaseR, jitter),
    },
    {
      cx: sw * 1.1,
      cy: sh * 0.88,
      targetRadius: sh * 0.45,
      scallops: generateScallops(3, sh * 0.45, 1.5, 4.5, scallopBaseR, jitter),
    },
    {
      cx: sw * 0.45,
      cy: sh * 0.45,
      targetRadius: sh * 0.85,
      scallops: generateScallops(4, sh * 0.85, -0.5, 6.8, scallopBaseR, jitter),
    },
  ];
  return all.slice(0, count);
}

function generateRandomizedBites(
  count: number,
  sw: number,
  sh: number,
  scallopBaseR: number,
  jitter: number,
  seed: number,
): BiteSpec[] {
  const bites: BiteSpec[] = [];
  for (let i = 0; i < count; i++) {
    const s = seed * 1000 + i;
    // Place along edges with some randomization
    const edge = Math.floor(seededRandom(s) * 4); // 0=top, 1=right, 2=bottom, 3=left
    let cx: number, cy: number;
    const edgeOffset = seededRandom(s + 1);

    switch (edge) {
      case 0: // top
        cx = sw * edgeOffset;
        cy = -sh * 0.05;
        break;
      case 1: // right
        cx = sw * 1.1;
        cy = sh * edgeOffset;
        break;
      case 2: // bottom
        cx = sw * edgeOffset;
        cy = sh * 1.05;
        break;
      default: // left
        cx = -sw * 0.1;
        cy = sh * edgeOffset;
        break;
    }

    // Escalating radius: later bites are bigger
    const baseRadius = sh * (0.25 + (i / Math.max(count - 1, 1)) * 0.35);
    const arcStart = seededRandom(s + 2) * Math.PI * 2 - Math.PI;
    const arcEnd = arcStart + Math.PI * (1.5 + seededRandom(s + 3) * 1.5);

    bites.push({
      cx,
      cy,
      targetRadius: baseRadius,
      scallops: generateScallops(i, baseRadius, arcStart, arcEnd, scallopBaseR, jitter),
    });
  }

  // Last bite always large and near center to clear everything
  if (count > 1) {
    const last = bites[count - 1];
    last.cx = sw * (0.3 + seededRandom(seed + 999) * 0.4);
    last.cy = sh * (0.3 + seededRandom(seed + 998) * 0.4);
    last.targetRadius = sh * 0.85;
    last.scallops = generateScallops(count - 1, sh * 0.85, -0.5, 6.8, scallopBaseR, jitter);
  }

  return bites;
}

function generateSpiralBites(
  count: number,
  sw: number,
  sh: number,
  scallopBaseR: number,
  jitter: number,
  seed: number,
): BiteSpec[] {
  const bites: BiteSpec[] = [];
  const centerX = sw * 0.5;
  const centerY = sh * 0.5;
  const maxOrbitRadius = Math.max(sw, sh) * 0.6;
  // Golden angle progression for natural spiral
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i++) {
    // Spiral inward: first bites far, last bite at center
    const progress = i / Math.max(count - 1, 1);
    const orbitR = maxOrbitRadius * (1 - progress * 0.9);
    const angle = goldenAngle * i + (seed ? seededRandom(seed + i) * 0.3 : 0);

    const cx = centerX + Math.cos(angle) * orbitR;
    const cy = centerY + Math.sin(angle) * orbitR;
    const baseRadius = sh * (0.2 + progress * 0.5);

    const arcStart = angle - Math.PI * 0.8;
    const arcEnd = angle + Math.PI * 2.2;

    bites.push({
      cx,
      cy,
      targetRadius: baseRadius,
      scallops: generateScallops(i, baseRadius, arcStart, arcEnd, scallopBaseR, jitter),
    });
  }

  // Final bite: large, near center
  if (count > 1) {
    const last = bites[count - 1];
    last.cx = centerX;
    last.cy = centerY;
    last.targetRadius = sh * 0.85;
    last.scallops = generateScallops(count - 1, sh * 0.85, -0.5, 6.8, scallopBaseR, jitter);
  }

  return bites;
}

function generateEdgesInBites(
  count: number,
  sw: number,
  sh: number,
  scallopBaseR: number,
  jitter: number,
): BiteSpec[] {
  // All edge positions, then center finale
  const edgePositions: Array<{ cx: number; cy: number; arcStart: number; arcEnd: number }> = [
    { cx: -sw * 0.1, cy: sh * 0.25, arcStart: -1.0, arcEnd: 2.0 },
    { cx: sw * 1.1, cy: sh * 0.35, arcStart: 1.5, arcEnd: 4.7 },
    { cx: -sw * 0.1, cy: sh * 0.7, arcStart: -1.2, arcEnd: 1.8 },
    { cx: sw * 1.1, cy: sh * 0.8, arcStart: 1.5, arcEnd: 4.5 },
  ];

  const bites: BiteSpec[] = [];
  for (let i = 0; i < count; i++) {
    if (i === count - 1 && count > 1) {
      // Final bite: center
      bites.push({
        cx: sw * 0.45,
        cy: sh * 0.45,
        targetRadius: sh * 0.85,
        scallops: generateScallops(i, sh * 0.85, -0.5, 6.8, scallopBaseR, jitter),
      });
    } else {
      const pos = edgePositions[i % edgePositions.length];
      const radius = sh * (0.28 + (i / Math.max(count - 1, 1)) * 0.2);
      bites.push({
        cx: pos.cx,
        cy: pos.cy,
        targetRadius: radius,
        scallops: generateScallops(i, radius, pos.arcStart, pos.arcEnd, scallopBaseR, jitter),
      });
    }
  }
  return bites;
}

// ─── Easing resolver ──────────────────────────────────────────────────────

function resolveEasing(curve?: string): (t: number) => number {
  switch (curve) {
    case 'bounce':
      return Easing.out(Easing.bounce);
    case 'spring':
      return Easing.out(Easing.back(1.2));
    case 'cubic-out':
    default:
      return Easing.out(Easing.cubic);
  }
}

// ─── Component ────────────────────────────────────────────────────────────

export default function ChompOverlay() {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  // ── Component state ──────────────────────────────────────────────────────
  const [visible, setVisible] = useState(false);
  const [overlayColor, setOverlayColor] = useState('#F2F0ED');
  const activeConfigRef = useRef<ChompConfig | null>(null);
  const [activeBites, setActiveBites] = useState<BiteSpec[]>([]);
  const [crumbBursts, setCrumbBursts] = useState<CrumbBurstState[]>([]);
  const [showConfetti, setShowConfetti] = useState(false);
  const [confettiOrigin, setConfettiOrigin] = useState({ x: 0, y: 0 });

  const progressAnim = useRef(new Animated.Value(0)).current;
  const [progress, setProgress] = useState(0);

  const hapticFiredRef = useRef<Set<number>>(new Set());
  const crumbFiredRef = useRef<Set<number>>(new Set());
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listenerIdRef = useRef<string | null>(null);

  const { registerOverlayTrigger } = useThemeTransition();

  const buildBiteSpecs = useCallback(
    (config: ChompConfig): BiteSpec[] => {
      const scallopBaseR = screenWidth * 0.1;
      const jitter = config.scallopJitter ?? 1.0;
      const pattern = config.bitePattern ?? 'fixed';
      const seed = config.positionSeed ?? 42;

      let specs: BiteSpec[];
      switch (pattern) {
        case 'randomized':
          specs = generateRandomizedBites(config.biteCount, screenWidth, screenHeight, scallopBaseR, jitter, seed);
          break;
        case 'spiral':
          specs = generateSpiralBites(config.biteCount, screenWidth, screenHeight, scallopBaseR, jitter, seed);
          break;
        case 'edges-in':
          specs = generateEdgesInBites(config.biteCount, screenWidth, screenHeight, scallopBaseR, jitter);
          break;
        case 'fixed':
        default:
          specs = generateFixedBites(config.biteCount, screenWidth, screenHeight, scallopBaseR, jitter);
          break;
      }

      // Apply per-bite radius scaling
      if (config.radiusScale) {
        specs = specs.map((spec, i) => {
          const scale = config.radiusScale![i] ?? 1.0;
          if (scale === 1.0) return spec;
          return {
            ...spec,
            targetRadius: spec.targetRadius * scale,
            scallops: spec.scallops.map(sc => ({
              ...sc,
              radius: sc.radius * scale,
            })),
          };
        });
      }

      return specs;
    },
    [screenWidth, screenHeight],
  );

  const trigger = useCallback(
    async (config: ChompConfig, onCommit: () => void, onDone: () => void) => {
      const reducedMotion = await AccessibilityInfo.isReduceMotionEnabled();
      if (reducedMotion) {
        onCommit();
        onDone();
        return;
      }

      // Store config for this animation run
      activeConfigRef.current = config;

      // Build bite specs from config
      const specs = buildBiteSpecs(config);
      setActiveBites(specs);

      // 1. Show overlay with config color
      setOverlayColor(config.overlayColor);
      setProgress(0);
      setCrumbBursts([]);
      setShowConfetti(false);
      setVisible(true);

      // 2. Commit after commitDelay so new content renders underneath
      commitTimerRef.current = setTimeout(() => {
        commitTimerRef.current = null;

        let animationStarted = false;
        try {
          onCommit();

          // 3. Reset animation value and haptic tracker
          progressAnim.setValue(0);
          hapticFiredRef.current.clear();
          crumbFiredRef.current.clear();

          // 4. Build haptic thresholds from config
          const thresholds = Array.from(
            { length: config.biteCount },
            (_, i) => i + 0.01,
          );

          // Crumb thresholds: fire when bite is ~80% complete
          const crumbThresholds = Array.from(
            { length: config.biteCount },
            (_, i) => i + 0.8,
          );

          // 5. Attach listener to drive SVG re-renders + haptics + crumbs
          const listenerId = progressAnim.addListener(({ value }) => {
            setProgress(value);

            for (let i = 0; i < thresholds.length; i++) {
              const t = thresholds[i];
              if (value >= t && !hapticFiredRef.current.has(t)) {
                hapticFiredRef.current.add(t);
                const seq = config.hapticSequence[i];
                if (seq) {
                  Haptics.impactAsync(HAPTIC_STYLE_MAP[seq.style]);
                  if (seq.withSuccessNotification) {
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  }
                }
              }
            }

            // Fire crumb bursts
            if (config.enableCrumbs) {
              const style = config.crumbStyle ?? 'crumbs';
              const confettiOnFinal = config.confettiOnFinalOnly !== false; // default true

              for (let i = 0; i < crumbThresholds.length; i++) {
                const ct = crumbThresholds[i];
                if (value >= ct && !crumbFiredRef.current.has(ct)) {
                  crumbFiredRef.current.add(ct);
                  const spec = specs[i];
                  if (!spec) continue;

                  const isFinal = i === config.biteCount - 1;

                  if (style === 'confetti') {
                    if (!confettiOnFinal || isFinal) {
                      setConfettiOrigin({ x: spec.cx, y: spec.cy });
                      setShowConfetti(true);
                    }
                  } else {
                    // Crumb particles
                    const count = config.crumbCount ?? 5;
                    const burst = createBurst(spec.cx, spec.cy, count, config.overlayColor, i);
                    setCrumbBursts(prev => [...prev, burst]);
                    animateBurst(burst, i);
                  }
                }
              }
            }
          });
          listenerIdRef.current = listenerId;

          // 6. Build stepped animation with configurable easing
          const easing = resolveEasing(config.easingCurve);
          const steps: ReturnType<typeof Animated.timing>[] = [];
          for (let i = 0; i < config.biteCount; i++) {
            steps.push(
              Animated.timing(progressAnim, {
                toValue: i + 1 + (i === config.biteCount - 1 ? 0.01 : 0),
                duration: config.biteDuration,
                easing,
                useNativeDriver: false,
              })
            );
            if (i < config.biteCount - 1) {
              steps.push(Animated.delay(config.bitePause));
            }
          }

          animationStarted = true;
          Animated.sequence(steps).start(() => {
            progressAnim.removeListener(listenerId);
            listenerIdRef.current = null;
            setVisible(false);
            setShowConfetti(false);
            setCrumbBursts([]);
            activeConfigRef.current = null;
            onDone();
          });
        } finally {
          if (!animationStarted) {
            setVisible(false);
            setShowConfetti(false);
            setCrumbBursts([]);
            activeConfigRef.current = null;
            onDone();
          }
        }
      }, config.commitDelay);
    },
    [buildBiteSpecs], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Ref that always points to the latest trigger function
  const triggerRef = useRef(trigger);
  useEffect(() => {
    triggerRef.current = trigger;
  });

  // Register a STABLE WRAPPER once on mount
  useEffect(() => {
    registerOverlayTrigger((...args: Parameters<typeof trigger>) => {
      triggerRef.current(...args);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up timer and listener on component unmount
  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) {
        clearTimeout(commitTimerRef.current);
      }
      if (listenerIdRef.current !== null) {
        progressAnim.removeListener(listenerIdRef.current);
      }
    };
  }, [progressAnim]);

  if (!visible) return null;

  return (
    <View
      style={[StyleSheet.absoluteFillObject, { zIndex: 9999 }]}
      pointerEvents="none"
    >
      <Svg width={screenWidth} height={screenHeight}>
        <Defs>
          <Mask id="chompMask_overlay">
            <Rect
              x={0}
              y={0}
              width={screenWidth}
              height={screenHeight}
              fill="white"
            />
            {activeBites.map((spec, i) => {
              const t = Math.max(0, Math.min(1, progress - i));
              if (t <= 0) return null;

              const mainR = t * spec.targetRadius;
              const fillR = mainR * 0.95;

              return [
                <Circle
                  key={`fill-${i}`}
                  cx={spec.cx}
                  cy={spec.cy}
                  r={fillR}
                  fill="black"
                />,
                ...spec.scallops.map((sc, j) => (
                  <Circle
                    key={`sc-${i}-${j}`}
                    cx={spec.cx + mainR * Math.cos(sc.angle)}
                    cy={spec.cy + mainR * Math.sin(sc.angle)}
                    r={t * sc.radius}
                    fill="black"
                  />
                )),
              ];
            })}
          </Mask>
        </Defs>
        <Rect
          x={0}
          y={0}
          width={screenWidth}
          height={screenHeight}
          fill={overlayColor}
          mask="url(#chompMask_overlay)"
        />
      </Svg>
      <CrumbParticles bursts={crumbBursts} />
      {showConfetti && (
        <ConfettiCannon
          count={100}
          origin={confettiOrigin}
          autoStart
          fadeOut
          fallSpeed={3000}
          explosionSpeed={350}
        />
      )}
    </View>
  );
}

import { useRef, useEffect } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { seededRandom } from '../lib/scallopUtils';

interface Particle {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
  size: number;
  color: string;
}

export interface CrumbBurst {
  cx: number;
  cy: number;
  key: number;
  particles: Particle[];
}

/**
 * Derives 3 color variants from an overlay color hex string:
 * base at 80% saturation, a lighter variant, and a darker variant.
 */
function deriveColors(hex: string): string[] {
  // Parse hex
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const lighter = `rgb(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 40)})`;
  const darker = `rgb(${Math.max(0, r - 30)}, ${Math.max(0, g - 30)}, ${Math.max(0, b - 30)})`;
  const base = `rgb(${r}, ${g}, ${b})`;

  return [base, lighter, darker];
}

interface CrumbParticlesProps {
  bursts: CrumbBurst[];
}

export function createBurst(
  cx: number,
  cy: number,
  count: number,
  overlayColor: string,
  seed: number,
): CrumbBurst {
  const colors = deriveColors(overlayColor);
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const s = seed * 100 + i;
    particles.push({
      x: new Animated.Value(cx),
      y: new Animated.Value(cy),
      opacity: new Animated.Value(1),
      scale: new Animated.Value(0),
      size: 3 + seededRandom(s) * 5, // 3–8px
      color: colors[Math.floor(seededRandom(s + 1) * colors.length)],
    });
  }

  return { cx, cy, key: seed, particles };
}

export function animateBurst(burst: CrumbBurst, seed: number): void {
  burst.particles.forEach((p, i) => {
    const s = seed * 100 + i;
    // Random velocity in all directions
    const angle = seededRandom(s + 10) * Math.PI * 2;
    const speed = 40 + seededRandom(s + 20) * 80; // 40–120px travel
    const targetX = burst.cx + Math.cos(angle) * speed;
    const targetY = burst.cy + Math.sin(angle) * speed + 30; // slight gravity bias

    Animated.parallel([
      Animated.spring(p.scale, {
        toValue: 1,
        tension: 300,
        friction: 8,
        useNativeDriver: true,
      }),
      Animated.timing(p.x, {
        toValue: targetX,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.timing(p.y, {
        toValue: targetY,
        duration: 400,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(150),
        Animated.timing(p.opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  });
}

export default function CrumbParticles({ bursts }: CrumbParticlesProps) {
  if (bursts.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {bursts.map((burst) =>
        burst.particles.map((p, i) => (
          <Animated.View
            key={`${burst.key}-${i}`}
            style={{
              position: 'absolute',
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: p.color,
              transform: [
                { translateX: p.x },
                { translateY: p.y },
                { scale: p.scale },
              ],
              opacity: p.opacity,
            }}
          />
        )),
      )}
    </View>
  );
}
